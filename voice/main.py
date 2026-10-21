"""
Голос Джарвиса на компьютере. Запускает хаб (server/jarvis/voice.ts), вручную не нужно.

  микрофон → Vosk ждёт имя («джарвис») → запись фразы до паузы (webrtcvad)
  → GigaAM (или Whisper) → проверка, что имя прозвучало → хаб отвечает → Piper (или Silero) говорит.

На экране — орб (ui.py): появляется на разговор, показывает, что услышал и что ответил.

Если Джарвис задал вопрос, следующий ответ слушается без имени. Пока он говорит,
микрофон не слушается — чтобы не услышать самого себя.
"""

import argparse
import collections
import json
import os
import queue
import random
import re
import sys
import threading
import time
import traceback
import urllib.request
import zipfile

import numpy as np
import sounddevice as sd
import webrtcvad

from hub import Hub

RATE = 16000
FRAME_MS = 30
FRAME = RATE * FRAME_MS // 1000  # 480 сэмплов
FRAME_BYTES = FRAME * 2
PREROLL_SEC = 2.0
END_SILENCE_MS = 800
WAIT_COMMAND_SEC = 5.0
MAX_PHRASE_SEC = 15.0
FILLER_AFTER_SEC = 1.8

VOSK_MODEL = "vosk-model-small-ru-0.22"
VOSK_URL = f"https://alphacephei.com/vosk/models/{VOSK_MODEL}.zip"

WAKE_UP = re.compile(r"(просн|слушай|вернись|включись|просыпайся|подъем|подъём)", re.I)

def log(*a):
    print(*a, flush=True)


def norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    return re.sub(r"[^\w\s]", " ", s).split()


def similar(a: str, b: str) -> float:
    """Похожесть слов (0…1) по расстоянию Левенштейна."""
    if a == b:
        return 1.0
    dp = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(b) + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return 1 - dp[len(b)] / max(len(a), len(b), 1)


# Код выхода «перезапусти меня» (сменился режим окон) — хаб перезапускает сразу, без счёта сбоев.
EXIT_RESTART = 3

# Как распознавание иногда пишет «Джарвис».
WAKE_FORMS = {"джарвис", "jarvis", "жарвис", "джервис", "джарвиз", "джарвисс", "чарвис", "джарвес", "дарвис"}


class Mic:
    def __init__(self, device):
        self.q: "queue.Queue[bytes]" = queue.Queue(maxsize=2000)
        self.stream = sd.RawInputStream(samplerate=RATE, blocksize=FRAME, dtype="int16", channels=1, device=device, callback=self._cb)
        self.stream.start()

    def _cb(self, data, frames, t, status):
        try:
            self.q.put_nowait(bytes(data))
        except queue.Full:
            pass

    def read(self, timeout=0.2):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None

    def flush(self):
        while not self.q.empty():
            try:
                self.q.get_nowait()
            except queue.Empty:
                break

    def close(self):
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass


def input_devices() -> list[str]:
    seen, out = set(), []
    try:
        default_api = sd.query_hostapis(sd.default.hostapi)["name"] if sd.default.hostapi >= 0 else None
    except Exception:
        default_api = None
    for d in sd.query_devices():
        if d["max_input_channels"] <= 0:
            continue
        api = sd.query_hostapis(d["hostapi"])["name"]
        # Одно устройство видно через несколько API Windows — показываем из основного.
        if default_api and api != default_api:
            continue
        name = d["name"].strip()
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def find_device(name: str):
    if not name:
        return None
    devs = [(i, d) for i, d in enumerate(sd.query_devices()) if d["max_input_channels"] > 0]
    # Сначала устройства основного API (MME сам приводит частоту к 16 кГц).
    devs.sort(key=lambda x: x[1]["hostapi"] != sd.default.hostapi)
    for i, d in devs:
        if d["name"].strip() == name:
            return i
    for i, d in devs:
        if name.lower() in d["name"].lower():
            return i
    return None


def tone(freqs, ms=110, volume=0.25, rate=48000):
    out = []
    for f in freqs:
        t = np.arange(int(rate * ms / 1000)) / rate
        w = np.sin(2 * np.pi * f * t) * np.hanning(len(t)) ** 0.5
        out.append(w)
    return (np.concatenate(out) * volume).astype(np.float32)


# Частые и похожие на «джарвис» слова. Без них грамматика Vosk из двух слов («джарвис» или
# «не знаю») натягивает на имя почти любую речь; с ними ложных срабатываний почти нет.
DISTRACTORS = [
    "марвин", "дарвин", "джаз", "жарко", "чарльз", "привет", "погода", "правда", "сегодня", "как", "дела", "да", "нет", "это",
    "что", "так", "вот", "ну", "я", "ты", "мы", "он", "она", "в", "на", "и", "а", "не", "но", "давай", "хорошо", "ладно",
    "здравствуй", "спасибо", "пожалуйста", "слушай", "смотри", "джинсы", "журнал", "жарить", "дар", "вас", "вис", "джек", "жар",
    "арбуз", "ирис", "сервис", "парис", "борис", "денис", "алиса", "марс", "двери", "зарплата", "запись", "дарвиниз",
]


class Wake:
    def __init__(self, path: str):
        from vosk import KaldiRecognizer, Model, SetLogLevel

        SetLogLevel(-1)
        self.Rec = KaldiRecognizer
        self.model = Model(path)
        self.words = ["джарвис"]
        self.reset()

    def set_words(self, words):
        self.words = [w.strip().lower().replace("ё", "е") for w in words if w.strip()] or ["джарвис"]
        self.reset()

    def reset(self):
        grammar = self.words + [w for w in DISTRACTORS if w not in self.words] + ["[unk]"]
        self.rec = self.Rec(self.model, RATE, json.dumps(grammar, ensure_ascii=False))

    def feed(self, frame: bytes) -> bool:
        if self.rec.AcceptWaveform(frame):
            text = json.loads(self.rec.Result()).get("text", "")
        else:
            text = json.loads(self.rec.PartialResult()).get("partial", "")
        return any(w in text.split() for w in self.words)


class Voice:
    def __init__(self, args):
        self.hub = Hub(args.hub, args.token, args.insecure)
        self.cfg: dict = {}
        self.mic: Mic | None = None
        self.mic_name = None
        self.vad = webrtcvad.Vad(2)
        self.ring = collections.deque(maxlen=int(PREROLL_SEC * 1000 / FRAME_MS))
        self.sleeping = False
        self.muted = False
        self.stt = None
        self.tts = None
        self.wake = None
        self.chime = tone([880, 1320])
        self.ack = tone([1320], ms=90, volume=0.18)
        self.fillers: list = []
        self.hub_url = args.hub
        self.ui = None

    # ───────────── состояние ─────────────

    def status(self, state, **kw):
        self.hub.state(state=state, **kw)
        if self.ui:
            self.ui.state(state)

    def wait_config(self):
        log("Жду хаб…")
        t0 = time.time()
        while time.time() - t0 < 60:
            try:
                e = self.hub.events.get(timeout=1)
            except queue.Empty:
                continue
            if e.get("type") == "config":
                self.cfg = e["config"]
                return
        log("Хаб не прислал настройки")
        sys.exit(1)

    def models_dir(self):
        return self.cfg.get("modelsDir") or os.path.expanduser("~/.lifehub/voice/models")

    # ───────────── загрузка ─────────────

    def load_wake(self):
        path = os.path.join(self.models_dir(), VOSK_MODEL)
        if not os.path.isdir(path):
            self.status("loading", detail="Скачиваю модель слова активации (45 МБ)")
            os.makedirs(self.models_dir(), exist_ok=True)
            tmp = path + ".zip"
            urllib.request.urlretrieve(VOSK_URL, tmp)
            with zipfile.ZipFile(tmp) as z:
                z.extractall(self.models_dir())
            os.remove(tmp)
        self.wake = Wake(path)
        self.wake.set_words(self.cfg.get("wakeWords") or ["джарвис"])

    def load_tts(self):
        from tts import Tts

        self.tts = Tts(
            self.models_dir(),
            engine=self.cfg.get("ttsEngine") or "piper",
            speaker=self.cfg.get("speaker") or "",
            on_status=lambda s: self.status("loading", detail=s),
        )
        self.synth("Проверка.")
        self.make_fillers()

    def make_fillers(self):
        addr = self.cfg.get("address") or ""
        phrases = ["Секунду.", "Сейчас.", f"Минуту, {addr}." if addr else "Минуту.", "Так."]
        self.fillers = [self.synth(p) for p in phrases]

    def load_stt(self):
        from stt import Stt

        if self.stt is None:
            self.stt = Stt(self.models_dir())
        self.stt.load(
            self.cfg.get("asr") or "gigaam",
            self.cfg.get("model") or "large-v3-turbo",
            self.cfg.get("device") or "auto",
            bool(self.cfg.get("game")),
            on_status=lambda s: self.status("loading", detail=s),
        )
        log(f"Распознавание: {self.stt.name} на {'видеокарте' if self.stt.gpu else 'процессоре'}")

    def open_mic(self):
        name = self.cfg.get("mic") or ""
        if self.mic and name == self.mic_name:
            return
        if self.mic:
            self.mic.close()
        device = find_device(name)
        self.mic = Mic(device)
        self.mic_name = name
        try:
            used = sd.query_devices(device if device is not None else sd.default.device[0])["name"]
        except Exception:
            used = name or "по умолчанию"
        self.hub.state(mics=input_devices(), mic=used)
        log(f"Микрофон: {used}")

    # ───────────── речь ─────────────

    def synth(self, text: str):
        return self.tts.synth(text, self.cfg.get("speaker", ""), float(self.cfg.get("rate", 1)))

    def play(self, audio, sr: int = 48000):
        """Проиграть звук (массив 48 кГц или пару (массив, частота)). Орб пульсирует в такт."""
        if isinstance(audio, tuple):
            audio, sr = audio
        if audio is None or not len(audio):
            return
        loud = float(self.cfg.get("loudness", 0.9))
        out = np.clip(audio * loud, -1, 1)
        stop = threading.Event()
        if self.ui and self.ui.visible:
            hop = max(1, int(sr * 0.04))
            frames = out[: len(out) // hop * hop].reshape(-1, hop)
            env = np.sqrt((frames ** 2).mean(axis=1))
            env = np.clip(env / (env.max() + 1e-6) * 1.1, 0, 1)

            def pulse():
                t0 = time.monotonic()
                for i, e in enumerate(env):
                    if stop.wait(max(0, t0 + i * 0.04 - time.monotonic())):
                        return
                    self.ui.level(float(e))

            threading.Thread(target=pulse, daemon=True).start()
        sd.play(out, sr)
        sd.wait()
        stop.set()
        if self.ui:
            self.ui.level(0)

    def say(self, tts: str, text: str = ""):
        if self.ui:
            self.ui.show()
            self.ui.answer(text or tts)
        if not self.cfg.get("tts", True):
            self.play(self.ack)
            return
        self.status("speaking", detail=text or tts)
        try:
            self.play(self.synth(tts))
        except Exception as e:
            log(f"Не получилось сказать: {e}")
        self.after_speech()

    def after_speech(self):
        # Всё, что микрофон слышал, пока мы говорили, — наш собственный голос.
        time.sleep(0.15)
        if self.mic:
            self.mic.flush()
        self.ring.clear()
        if self.wake:
            self.wake.reset()

    # ───────────── запись фразы ─────────────

    def capture(self, wait_start: float, on_pause=None) -> bytes | None:
        """
        Пишем до паузы после речи. Речь не началась за wait_start секунд — None.
        on_pause — вызвать, если сразу после начала записи тишина (сказали только имя и ждут).
        """
        frames = []
        quiet_start = 0
        voiced = 0
        silence = 0
        started = False
        t0 = time.time()
        end_frames = END_SILENCE_MS // FRAME_MS
        while True:
            f = self.mic.read(0.5)
            now = time.time()
            if f is None:
                if not started and now - t0 > wait_start:
                    return None
                continue
            if len(f) != FRAME_BYTES:
                continue
            frames.append(f)
            if self.ui:
                rms = float(np.sqrt(np.mean(np.frombuffer(f, dtype=np.int16).astype(np.float32) ** 2)))
                self.ui.level(min(1.0, rms / 2500))
            speech = self.vad.is_speech(f, RATE)
            if on_pause and not started:
                quiet_start = 0 if speech else quiet_start + 1
                if quiet_start >= 12:
                    on_pause()
                    on_pause = None
            if speech:
                voiced += 1
                silence = 0
                if voiced >= 5:
                    started = True
            else:
                silence += 1
                if not started:
                    voiced = max(0, voiced - 1)
            if started and silence >= end_frames:
                break
            if not started and now - t0 > wait_start:
                return None
            if now - t0 > MAX_PHRASE_SEC:
                break
        return b"".join(frames)

    def hotwords(self):
        return " ".join(w.capitalize() for w in (self.cfg.get("wakeWords") or ["джарвис"]))

    def strip_wake(self, text: str) -> tuple[bool, str]:
        """Было ли имя в начале фразы, и фраза без него."""
        forms = WAKE_FORMS | {w.lower() for w in self.cfg.get("wakeWords") or []}
        words = text.split()
        for i, w in enumerate(words):
            n = norm(w)
            if not n:
                continue
            n = n[0]
            if n in forms or any(similar(n, f) >= 0.72 for f in forms):
                rest = " ".join(words[i + 1 :]).lstrip(",.!?— -")
                return True, rest
        return False, text

    # ───────────── разговор ─────────────

    def ask(self, text: str):
        """Отправить фразу хабу и ответить. Возвращает True, если Джарвис ждёт ответ."""
        self.status("thinking", heard=text, heardAt=int(time.time() * 1000))
        if self.ui:
            self.ui.heard(text)
            self.ui.answer("")
        result: dict = {}

        def run():
            try:
                result.update(self.hub.ask(text))
            except Exception as e:
                result["error"] = str(e)

        th = threading.Thread(target=run, daemon=True)
        th.start()
        th.join(FILLER_AFTER_SEC)
        if th.is_alive() and self.cfg.get("tts", True) and self.fillers:
            self.play(random.choice(self.fillers))
            th.join()
        if "error" in result:
            log(f"Хаб не ответил: {result['error']}")
            self.say("Хаб не отвечает.")
            return False
        log(f"← {result.get('text', '')}  ({result.get('ms', 0)} мс)")
        if result.get("quiet"):
            self.play(self.ack)
            self.after_speech()
        else:
            self.say(result.get("tts") or result.get("text") or "", result.get("text", ""))
        return bool(result.get("expectReply"))

    def converse(self, first: str):
        expect = self.ask(first)
        follow = float(self.cfg.get("followUp", 6) or 0)
        while expect and follow > 0:
            self.status("hearing", detail="Слушаю ответ")
            pcm = self.capture(follow)
            if not pcm:
                break
            self.status("thinking", detail="Распознаю")
            text = self.stt.transcribe(pcm)
            log(f"→ {text}")
            if not text.strip():
                break
            expect = self.ask(text)

    def on_wake(self):
        if self.ui and not self.sleeping:
            self.ui.clear()
            self.ui.show()
        self.status("hearing", detail="Слушаю")
        pre = b"".join(self.ring)
        # Сигнал — только если после имени пауза: значит, ждут, что Джарвис отзовётся.
        # Говорят дальше без паузы — сигнал только мешал бы (и звенел бы на ложных срабатываниях).
        chimed = []

        def chime():
            if self.cfg.get("chime", True) and not self.sleeping and not chimed:
                chimed.append(1)
                self.play(self.chime)

        pcm = self.capture(WAIT_COMMAND_SEC, on_pause=chime)
        audio = pre + (pcm or b"")
        self.status("thinking", detail="Распознаю")
        t0 = time.time()
        text = self.stt.transcribe(audio, self.hotwords())
        log(f"→ {text!r} ({time.time() - t0:.2f} с)")
        found, command = self.strip_wake(text)
        if self.cfg.get("verifyWake", True) and not found:
            log("Имени во фразе нет — ложное срабатывание")
            return
        if self.sleeping:
            if WAKE_UP.search(command):
                self.sleeping = False
                self.say(f"Слушаю, {self.cfg.get('address') or ''}.".replace(", .", "."))
            return
        if not command.strip():
            # Прозвучало только имя — отзываемся и ждём саму просьбу.
            chime()
            self.status("hearing", detail="Слушаю")
            pcm = self.capture(WAIT_COMMAND_SEC)
            if not pcm:
                return
            self.status("thinking", detail="Распознаю")
            text = self.stt.transcribe(pcm, self.hotwords())
            log(f"→ {text!r}")
            command = self.strip_wake(text)[1] if self.strip_wake(text)[0] else text
            if not command.strip():
                return
        self.converse(command)

    def handle_events(self):
        handled = False
        while True:
            try:
                e = self.hub.events.get_nowait()
            except queue.Empty:
                if handled:
                    self.idle()
                return
            handled = True
            t = e.get("type")
            if t == "config":
                self.apply_config(e["config"])
            elif t == "say":
                if not self.muted:
                    if e.get("chime"):
                        self.play(self.chime)
                    self.say(e.get("tts") or e.get("text", ""), e.get("text", ""))
            elif t == "control":
                if e.get("mute") is not None:
                    self.muted = bool(e["mute"])
                if e.get("sleep") is not None:
                    self.sleeping = bool(e["sleep"])
                if e.get("panel") and self.ui:
                    self.ui.open_panel()
                self.after_speech()
            elif t == "test":
                self.say(f"Голос работает. Слушаю вас, {self.cfg.get('address') or ''}.".replace(", .", "."))
            elif t == "stop":
                log("Хаб просит остановиться")
                os._exit(0)

    def apply_config(self, cfg: dict):
        old = self.cfg
        self.cfg = cfg
        try:
            # Окно орба создаётся при запуске: включили или выключили его совсем — перезапуск.
            if (old.get("overlay") == "never") != (cfg.get("overlay") == "never"):
                log("Сменился режим орба — перезапускаюсь")
                os._exit(EXIT_RESTART)
            if self.ui:
                self.ui.mode = cfg.get("overlay") or "talk"
                if old.get("overlayPos") != cfg.get("overlayPos"):
                    self.ui.pos = cfg.get("overlayPos") or "br"
                    self.ui._place()
                if self.ui.mode == "always":
                    self.ui.show()
            keys = ("asr", "model", "device", "game")
            if any(old.get(k) != cfg.get(k) for k in keys):
                self.status("loading", detail="Переключаю распознавание")
                self.load_stt()
            if old.get("wakeWords") != cfg.get("wakeWords") and self.wake:
                self.wake.set_words(cfg.get("wakeWords") or ["джарвис"])
            if old.get("ttsEngine") != cfg.get("ttsEngine") and self.tts:
                self.status("loading", detail="Переключаю голос")
                self.tts = None
                import gc

                gc.collect()
                self.load_tts()
            elif (old.get("speaker"), old.get("rate"), old.get("address")) != (cfg.get("speaker"), cfg.get("rate"), cfg.get("address")) and self.tts:
                self.make_fillers()
            if old.get("mic") != cfg.get("mic"):
                self.open_mic()
        except Exception as e:
            log(f"Настройки не применились: {e}")
            self.status("error", error=str(e))
        self.idle()

    def idle(self):
        if self.ui:
            self.ui.update_tray(self.muted, self.sleeping)
            self.ui.hide(after=4.5)
        if self.muted:
            self.status("muted", detail="Микрофон выключен")
        elif self.sleeping:
            self.status("sleeping", detail="Режим ожидания: «Джарвис, проснись»")
        else:
            self.status(
                "listening",
                detail=f"Скажите «{(self.cfg.get('wakeWords') or ['джарвис'])[0].capitalize()}»",
                gpu=self.stt.gpu if self.stt else None,
                model=self.stt.name if self.stt else None,
                error=None,
            )

    def greet(self):
        h = time.localtime().tm_hour
        g = "Доброй ночи" if h < 5 else "Доброе утро" if h < 12 else "Добрый день" if h < 18 else "Добрый вечер"
        addr = self.cfg.get("address") or ""
        self.say(f"{g}{', ' + addr if addr else ''}. Все системы в норме.")

    def on_tray(self, action: str):
        if action == "mute":
            self.muted = not self.muted
        elif action == "sleep":
            self.sleeping = not self.sleeping
        elif action == "restart":
            os._exit(EXIT_RESTART)
        self.idle()

    # ───────────── главный цикл ─────────────

    def run(self):
        self.wait_config()
        if (self.cfg.get("overlay") or "talk") != "never":
            try:
                from ui import Ui

                self.ui = Ui(self.hub_url, self.cfg.get("overlay") or "talk", self.cfg.get("overlayPos") or "br", on_tray=self.on_tray)
            except Exception as e:
                log(f"Окно орба недоступно: {e}")
                self.ui = None
        if self.ui:
            # Окна — в главном потоке, голос — в рабочем.
            self.ui.start(self.guarded_loop)
            while True:
                time.sleep(3600)
        self.loop()

    def guarded_loop(self):
        try:
            self.loop()
        except Exception as e:
            traceback.print_exc()
            self.status("error", error=str(e))
            time.sleep(1.5)
            os._exit(1)

    def loop(self):
        self.status("loading", detail="Загружаю модели")
        self.load_wake()
        self.load_tts()
        self.load_stt()
        self.open_mic()
        if self.cfg.get("greet", True):
            self.greet()
        self.after_speech()
        self.idle()
        while True:
            self.handle_events()
            frame = self.mic.read(0.2)
            if frame is None or len(frame) != FRAME_BYTES:
                continue
            if self.muted:
                continue
            self.ring.append(frame)
            if self.wake.feed(frame):
                log("Услышал имя")
                try:
                    self.on_wake()
                except Exception as e:
                    traceback.print_exc()
                    self.status("error", error=str(e))
                self.after_speech()
                self.idle()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hub", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()
    v = Voice(args)
    try:
        v.run()
    except Exception as e:
        traceback.print_exc()
        v.status("error", error=str(e))
        time.sleep(1.5)
        sys.exit(1)


if __name__ == "__main__":
    main()
