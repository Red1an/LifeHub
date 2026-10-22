"""
Звук из своих колонок: не реагировать на «Джарвис», который прозвучал в видео или музыке.

В фоне пишем то, что компьютер воспроизводит (WASAPI loopback через soundcard), — только огибающую
громкости по 30 мс. Когда детектор услышал имя, сравниваем огибающую микрофона за последние секунды
с огибающей колонок (с поправкой на задержку до ±0.45 с): если микрофон почти точь-в-точь повторяет
колонки — это эхо, а не человек в комнате.

Человек поверх видео и наушники (звук колонок в микрофон не попадает) дают низкое совпадение.
"""

import collections
import threading
import time
import warnings

import numpy as np

RATE = 16000
FRAME = 480  # 30 мс
KEEP = 160  # ~5 с огибающей
MAX_LAG = 15  # кадров, ±0.45 с
WINDOW = 50  # кадров, 1.5 с
QUIET = 0.004  # колонки тише этого — сравнивать не с чем
ECHO_CORR = 0.7


def envelope(pcm16: bytes) -> np.ndarray:
    x = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    n = len(x) // FRAME
    if not n:
        return np.zeros(0, dtype=np.float32)
    return np.sqrt((x[: n * FRAME].reshape(n, FRAME) ** 2).mean(axis=1))


def best_corr(mic: np.ndarray, sysenv: np.ndarray) -> float:
    """Наибольшая корреляция огибающих при сдвиге до ±MAX_LAG кадров (в логарифме — громкость в дБ)."""
    m = np.log(mic[-WINDOW:] + 1e-4)
    best = 0.0
    for lag in range(-MAX_LAG, MAX_LAG + 1):
        end = len(sysenv) - max(0, lag)
        start = end - len(m)
        if start < 0 or end > len(sysenv):
            continue
        s = np.log(sysenv[start:end] + 1e-4)
        if s.std() < 1e-3 or m.std() < 1e-3:
            continue
        c = float(np.corrcoef(m, s)[0, 1])
        best = max(best, c)
    return best


class SystemAudio:
    """Огибающая того, что играет в колонках. Без soundcard или без устройства — молча выключено."""

    def __init__(self):
        self.env: "collections.deque[float]" = collections.deque(maxlen=KEEP)
        self.ok = False
        self._stop = False
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            import soundcard as sc
        except Exception as e:
            print(f"Звук колонок не слушается: {e}", flush=True)
            return
        warnings.filterwarnings("ignore", module="soundcard")
        while not self._stop:
            try:
                spk = sc.default_speaker()
                mic = sc.get_microphone(id=str(spk.name), include_loopback=True)
                name = spk.name
                with mic.recorder(samplerate=RATE, channels=1, blocksize=FRAME) as r:
                    self.ok = True
                    checked = time.monotonic()
                    while not self._stop:
                        d = r.record(numframes=FRAME)
                        x = d.reshape(-1) if d.ndim > 1 else d
                        self.env.append(float(np.sqrt(np.mean(x.astype(np.float32) ** 2))))
                        # Сменились колонки по умолчанию (наушники) — переподключаемся.
                        if time.monotonic() - checked > 10:
                            checked = time.monotonic()
                            if sc.default_speaker().name != name:
                                break
            except Exception as e:
                self.ok = False
                print(f"Звук колонок: {e}", flush=True)
                time.sleep(5)

    def is_echo(self, mic_pcm: bytes) -> tuple[bool, float]:
        """Имя прозвучало из колонок? Возвращает (да/нет, совпадение 0…1)."""
        if not self.ok or len(self.env) < WINDOW + MAX_LAG:
            return False, 0.0
        sysenv = np.array(self.env, dtype=np.float32)
        if float(sysenv[-(WINDOW + MAX_LAG) :].max()) < QUIET:
            return False, 0.0
        mic = envelope(mic_pcm)
        if len(mic) < WINDOW:
            return False, 0.0
        c = best_corr(mic, sysenv)
        return c >= ECHO_CORR, c

    def stop(self):
        self._stop = True
