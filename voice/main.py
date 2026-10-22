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
import hashlib
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
PREROLL_SEC = 2.5
END_SILENCE_MS = 700
WAIT_COMMAND_SEC = 5.0
MAX_PHRASE_SEC = 10.0
# Речь — только то, что заметно громче фона: иначе разговоры и видео рядом не дают фразе закончиться.
SPEECH_OVER_NOISE = 2.2
MIN_SPEECH_RMS = 250
# Имени в распознанном тексте нет, а слов больше — скорее всего, это чужой разговор, а не команда.
MAX_WORDS_WITHOUT_NAME = 8
FILLER_AFTER_SEC = 1.8

VOSK_MODEL = "vosk-model-small-ru-0.22"
VOSK_URL = f"https://alphacephei.com/vosk/models/{VOSK_MODEL}.zip"

# «Джарвис, стоп» во время речи — просто замолчать.
STOP_WORDS = re.compile(r"^\W*(стоп|хватит|замолчи|молчи|тихо|достаточно|все|всё|остановись|прекрати|отмена|понял|ладно)\W*$", re.I)

WAKE_UP = re.compile(r"(просн|слушай|вернись|включись|просыпайся|подъем|подъём)", re.I)

def log(*a):
    print(*a, flush=True)


def norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    return re.sub(r"[^\w\s]", " ", s).split()


def frame_rms(f: bytes) -> float:
    return float(np.sqrt(np.mean(np.frombuffer(f, dtype=np.int16).astype(np.float32) ** 2)))


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
WAKE_FORMS = {
    "джарвис", "jarvis", "жарвис", "джервис", "джарвиз", "джарвисс", "чарвис", "джарвес", "дарвис", "джарюс", "жарвез",
    "джарос", "джервиз", "жарвиз", "джарвиc", "чарльз", "сервиз", "джарви", "жарви",
}


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


def activation(rate=48000):
    """Сигнал «слушаю»: восходящий аккорд с мягким хвостом, ~0.45 с — слышно даже на фоне музыки."""
    t = np.arange(int(rate * 0.45)) / rate
    out = np.zeros_like(t)
    for i, (f, start) in enumerate([(523.25, 0.0), (659.25, 0.07), (783.99, 0.14), (1046.5, 0.21)]):
        tt = t - start
        on = tt >= 0
        env = np.where(on, np.minimum(1, tt / 0.012) * np.exp(-np.clip(tt, 0, None) * 6.5), 0)
        # Основной тон + октава тише: звучит «стеклянно», как интерфейс.
        out += env * (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * (0.8 + 0.1 * i)
    return (out / np.max(np.abs(out)) * 0.32).astype(np.float32)


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
        self.chime = activation()
        self.ack = tone([1320], ms=70, volume=0.12)
        self.fillers: list = []
        self.hub_url = args.hub
        self.ui = None
        self.noise = 300.0
        self.stop_speech = threading.Event()
        self.sysaudio = None
        self.speaker = None
        self.tts_mem: "collections.OrderedDict[tuple, tuple]" = collections.OrderedDict()

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
        """Синтез с кэшем: частые короткие ответы («Готово», «Открываю Telegram») звучат мгновенно."""
        from tts import fx_pitch, jarvis_fx

        rate = float(self.cfg.get("rate", 1))
        fx = float(self.cfg.get("voiceFx", 0) or 0)
        key = (self.tts.engine, self.cfg.get("speaker", ""), rate, round(fx, 2), text)

        def make():
            # Эффект понижает тон замедлением — заранее ускоряем речь на столько же.
            a, sr = self.tts.synth(text, key[1], rate * fx_pitch(fx) if fx else rate)
            return (jarvis_fx(a, sr, fx), sr) if fx else (a, sr)

        if len(text) > 160:
            return make()
        hit = self.tts_mem.get(key)
        if hit:
            self.tts_mem.move_to_end(key)
            return hit
        path = os.path.join(self.cache_dir(), hashlib.sha1(repr(key).encode("utf-8")).hexdigest() + ".npz")
        try:
            z = np.load(path)
            out = (z["a"], int(z["sr"]))
        except Exception:
            out = make()
            try:
                np.savez(path, a=out[0].astype(np.float32), sr=out[1])
            except Exception:
                pass
        self.tts_mem[key] = out
        while len(self.tts_mem) > 200:
            self.tts_mem.popitem(last=False)
        return out

    def cache_dir(self):
        d = os.path.join(os.path.dirname(self.models_dir().rstrip("/\\")), "tts-cache")
        os.makedirs(d, exist_ok=True)
        return d

    def prewarm(self):
        """Частые ответы — в кэш заранее."""
        addr = self.cfg.get("address") or ""
        sir = f", {addr}" if addr else ""
        for p in [f"Да{sir}?", f"Слушаю{sir}.", f"Готово{sir}.", f"Сделано{sir}.", f"Есть{sir}.", "Отменил.", "Пауза.", "Продолжаю.", "Следующий."]:
            try:
                self.synth(p)
            except Exception:
                break

    def play(self, audio, sr: int = 48000, barge: bool = False) -> bool:
        """
        Проиграть звук (массив 48 кГц или пару (массив, частота)). Орб пульсирует в такт.
        barge — пока играет, слушать имя: «Джарвис…» перебивает речь. True — перебили.
        """
        if isinstance(audio, tuple):
            audio, sr = audio
        if audio is None or not len(audio):
            return False
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
        self.stop_speech.clear()
        sd.play(out, sr)
        interrupted = False
        if barge and self.mic and self.wake:
            # Пока говорим — кормим детектор имени микрофоном. Своё имя Джарвис почти не произносит,
            # так что сработает именно на «Джарвис» от человека.
            self.wake.reset()
            end = time.monotonic() + len(out) / sr
            while time.monotonic() < end:
                if self.stop_speech.is_set():
                    interrupted = True
                    break
                f = self.mic.read(0.03)
                if f and len(f) == FRAME_BYTES and self.wake.feed(f):
                    interrupted = True
                    break
            if interrupted:
                sd.stop()
            else:
                sd.wait()
        else:
            while not self.stop_speech.wait(0.03):
                if not sd.get_stream().active:
                    break
            if self.stop_speech.is_set():
                sd.stop()
                interrupted = True
        stop.set()
        if self.ui:
            self.ui.level(0)
        return interrupted

    def say(self, tts: str, text: str = ""):
        if not self.cfg.get("tts", True):
            if self.ui:
                self.ui.show()
                self.ui.answer(text or tts)
            self.play(self.ack)
            return
        self.status("speaking", detail=text or tts)
        try:
            audio = self.synth(tts)
            if self.ui:
                self.ui.show()
                self.ui.answer(text or tts, len(audio[0]) / audio[1])
            if self.play(audio, barge=True):
                self.interrupted()
                return
        except Exception as e:
            log(f"Не получилось сказать: {e}")
        self.after_speech()

    def interrupted(self):
        """Перебили: «Джарвис, стоп» — молчим; «Джарвис, <просьба>» — выполняем новую."""
        log("Перебили")
        self.mic.flush()
        self.ring.clear()
        self.wake.reset()
        if self.stop_speech.is_set():  # крестик на орбе
            return
        self.status("hearing", detail="Слушаю")
        pcm = self.capture(4.0)
        if not pcm:
            return
        text = self.stt.transcribe(pcm, self.hotwords())
        found, command = self.strip_wake(text)
        command = command if found else text
        log(f"→ {command!r} (перебил)")
        if not command.strip() or STOP_WORDS.match(command):
            if self.ui:
                self.ui.answer("")
            return
        owner, score = self.check_owner(pcm)
        if owner is False and self.denied():
            return
        self.converse(command, owner, score)

    def after_speech(self):
        # Всё, что микрофон слышал, пока мы говорили, — наш собственный голос.
        time.sleep(0.15)
        if self.mic:
            self.mic.flush()
        self.ring.clear()
        if self.wake:
            self.wake.reset()

    # ───────────── запись фразы ─────────────

    def capture(self, wait_start: float, on_pause=None, talking: bool = False) -> bytes | None:
        """
        Пишем до паузы после речи. Речь не началась за wait_start секунд — None.
        on_pause — вызвать, если сразу после начала записи тишина (сказали только имя и ждут).
        talking — речь уже идёт (фразу говорят без паузы после имени): ждём только её конца.
        """
        frames = []
        quiet_start = 0
        voiced = 0
        silence = 0
        started = talking
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
            rms = frame_rms(f)
            if self.ui:
                self.ui.level(min(1.0, rms / 2500))
            speech = self.vad.is_speech(f, RATE) and rms > max(MIN_SPEECH_RMS, self.noise * SPEECH_OVER_NOISE)
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

    def check_owner(self, pcm: bytes) -> tuple[bool | None, float | None]:
        """Голос владельца? None — проверка выключена, голос не записан или фраза слишком короткая."""
        lock = self.cfg.get("speakerLock") or "off"
        if lock == "off" or not self.speaker or not self.speaker.enrolled or not pcm:
            return None, None
        try:
            sc = self.speaker.score(pcm)
        except Exception as e:
            log(f"Проверка голоса не удалась: {e}")
            return None, None
        if sc is None:
            return None, None
        ok = sc >= float(self.cfg.get("speakerThreshold", 0.5))
        log(f"Голос: {sc:.2f} — {'владелец' if ok else 'не владелец'}")
        self.hub.state(speaker={"enrolled": True, "score": round(sc, 2), "owner": ok, "at": int(time.time() * 1000)})
        return ok, sc

    def name_heard(self, pre: bytes) -> bool:
        """
        Прозвучало ли имя на самом деле: распознаём последние ~1.8 с (там, где Vosk его услышал).
        Не нашли имени — пропускаем, только если голос точно владельца (распознавание иногда коверкает имя).
        """
        tail = pre[-int(RATE * 1.8) * 2 :]
        try:
            text = self.stt.transcribe(tail, self.hotwords())
        except Exception:
            return True
        found, _ = self.strip_wake(text)
        if found:
            return True
        if self.speaker and self.speaker.enrolled:
            try:
                sc = self.speaker.score(pre, min_sec=0.5, keep=False)
            except Exception:
                sc = None
            if sc is not None and sc >= float(self.cfg.get("speakerThreshold", 0.45)):
                log(f"Имени не расслышал ({text!r}), но голос ваш ({sc:.2f})")
                return True
        log(f"Имени не было: {text!r} — молчу")
        return False

    def stranger(self, pre: bytes) -> bool:
        """
        Проверка голоса в момент, когда прозвучало имя (по последним секундам записи). Только при
        «Только мой голос» и с запасом: короткая запись менее надёжна, своих отсекать нельзя.
        """
        if (self.cfg.get("speakerLock") or "off") == "off" or not self.speaker or not self.speaker.enrolled:
            return False
        try:
            sc = self.speaker.score(pre, min_sec=0.5, keep=False)
        except Exception:
            return False
        if sc is None:
            return False
        limit = float(self.cfg.get("speakerThreshold", 0.45)) - 0.15
        if sc < limit:
            log(f"Имя сказал не владелец ({sc:.2f}) — молчу")
            return True
        log(f"Имя: голос {sc:.2f}")
        return False

    def accept_without_name(self, command: str, owner: bool | None, audio: bytes) -> bool:
        """
        Детектор имени сработал, а в распознанном тексте имени нет. Так бывает и когда распознавание
        исказило «Джарвис», и когда это речь из видео. Решаем по голосу и длине фразы.
        """
        words = command.split()
        if not words or self.cfg.get("strictWake") or len(words) > MAX_WORDS_WITHOUT_NAME:
            return False  # пусто — шум; длинно — чужой разговор
        if self.speaker and self.speaker.enrolled:
            if owner is None:  # проверка выключена — сверяем голос всё равно
                try:
                    sc = self.speaker.score(audio)
                except Exception:
                    sc = None
                owner = sc is not None and sc >= float(self.cfg.get("speakerThreshold", 0.45))
            return bool(owner)
        return len(words) <= 4

    def denied(self) -> bool:
        """Режим «только мой голос» для всего — чужому не отвечаем совсем."""
        return (self.cfg.get("speakerLock") or "off") == "all"

    def hotwords(self):
        return " ".join(w.capitalize() for w in (self.cfg.get("wakeWords") or ["джарвис"]))

    def strip_wake(self, text: str) -> tuple[bool, str]:
        """Было ли имя во фразе, и фраза после него."""
        forms = WAKE_FORMS | {w.lower() for w in self.cfg.get("wakeWords") or []}
        words = text.split()
        for i, w in enumerate(words):
            n = norm(w)
            if not n:
                continue
            n = n[0]
            if n in forms or any(similar(n, f) >= 0.6 for f in forms):
                rest = " ".join(words[i + 1 :]).lstrip(",.!?— -")
                return True, rest
        return False, text

    # ───────────── разговор ─────────────

    def ask(self, text: str, owner: bool | None = None, score: float | None = None):
        """Отправить фразу хабу и ответить. Возвращает True, если Джарвис ждёт ответ."""
        self.status("thinking", heard=text, heardAt=int(time.time() * 1000))
        if self.ui:
            self.ui.heard(text)
            self.ui.answer("")
        result: dict = {}

        def run():
            try:
                result.update(self.hub.ask(text, owner, score))
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

    def converse(self, first: str, owner: bool | None = None, score: float | None = None):
        expect = self.ask(first, owner, score)
        follow = float(self.cfg.get("followUp", 6) or 0)
        while expect and follow > 0:
            self.status("hearing", detail="Слушаю ответ")
            pcm = self.capture(follow)
            if not pcm:
                break
            owner, score = self.check_owner(pcm)
            if owner is False and self.denied():
                break
            self.status("thinking", detail="Распознаю")
            text = self.stt.transcribe(pcm)
            log(f"→ {text}")
            if not text.strip():
                break
            expect = self.ask(text, owner, score)

    def on_wake(self):
        # Vosk срабатывает, когда имя ещё не договорено, — дослушиваем полсекунды, прежде чем проверять.
        extra = []
        for _ in range(17):  # 17 × 30 мс
            f = self.mic.read(0.2)
            if f and len(f) == FRAME_BYTES:
                extra.append(f)
        pre = b"".join(self.ring) + b"".join(extra)
        # Речь ещё идёт в конце дослушанного — фразу говорят слитно, начала ждать не нужно.
        talking = sum(1 for f in extra[-8:] if self.vad.is_speech(f, RATE)) >= 4
        # «Джарвис» прозвучал из своих же колонок (видео, музыка) — это не к нам.
        if self.sysaudio and self.cfg.get("echoGuard", True):
            echo, c = self.sysaudio.is_echo(pre)
            if echo:
                log(f"Имя прозвучало из колонок ({c:.2f}) — молчу")
                return
        # Имя сказал явно не владелец (видео, гости) — молчим сразу, без сигнала и орба.
        if self.stranger(pre):
            return
        # Второе ухо: Vosk часто «слышит» имя в любой речи. GigaAM на последних секундах точнее.
        if not self.name_heard(pre):
            return
        if self.ui and not self.sleeping:
            self.ui.clear()
            self.ui.show()
        self.status("hearing", detail="Слушаю")
        # Сигнал «слушаю» — сразу, как услышал имя: понятно, что Джарвис включился.
        # Микрофон в это время продолжает писать в очередь — фраза не теряется.
        if self.cfg.get("chime", True) and not self.sleeping:
            self.play(self.chime)
        pcm = self.capture(WAIT_COMMAND_SEC, talking=talking)
        if pcm and self.cfg.get("chime", True) and not self.sleeping:
            self.play(self.ack)
        audio = pre + (pcm or b"")
        owner, score = self.check_owner(audio)
        if owner is False and self.denied():
            log("Не голос владельца — молчу")
            if self.ui:
                self.ui.answer("Это не голос хозяина.")
            return
        self.status("thinking", detail="Распознаю")
        t0 = time.time()
        text = self.stt.transcribe(audio, self.hotwords())
        log(f"→ {text!r} ({time.time() - t0:.2f} с)")
        found, command = self.strip_wake(text)
        if not found and not self.accept_without_name(command, owner, audio):
            log(f"Имени во фразе нет — ложное срабатывание: {command!r}")
            if self.ui:
                self.ui.hide(now=True)
            return
        if self.sleeping:
            if WAKE_UP.search(command):
                self.sleeping = False
                self.say(f"Слушаю, {self.cfg.get('address') or ''}.".replace(", .", "."))
            return
        if not command.strip():
            # Прозвучало только имя (оно есть в распознанном тексте — иначе отсеяли выше) — отзываемся и ждём просьбу.
            addr = self.cfg.get("address") or ""
            self.say(f"Да{', ' + addr if addr else ''}?")
            self.status("hearing", detail="Слушаю")
            pcm = self.capture(WAIT_COMMAND_SEC)
            if not pcm:
                return
            owner, score = self.check_owner(pcm)
            if owner is False and self.denied():
                log("Не голос владельца — молчу")
                return
            self.status("thinking", detail="Распознаю")
            text = self.stt.transcribe(pcm, self.hotwords())
            log(f"→ {text!r}")
            command = self.strip_wake(text)[1] if self.strip_wake(text)[0] else text
            if not command.strip():
                return
        self.converse(command, owner, score)

    # ───────────── запись голоса владельца ─────────────

    def enroll(self, phrases: list[str]):
        if not self.speaker:
            return
        total = len(phrases)
        try:
            self.status("loading", detail="Готовлю запись голоса")
            self.speaker.ensure_model()
        except Exception as e:
            self.hub.state(enroll={"state": "error", "error": f"Модель голоса не загрузилась: {e}"})
            return
        if self.ui:
            self.ui.clear()
            self.ui.show()
        self.say("Запишу ваш голос. Повторяйте за мной фразы после сигнала.")
        embs = []
        for i, phrase in enumerate(phrases):
            self.hub.state(enroll={"state": "record", "step": i + 1, "total": total, "phrase": phrase})
            for attempt in range(2):
                if self.ui:
                    self.ui.heard(f"{i + 1} из {total}")
                self.say(phrase)
                self.play(self.chime)
                self.status("hearing", detail=f"Повторите: «{phrase}»")
                pcm = self.capture(6.0)
                e = self.speaker.embed(pcm) if pcm else None
                if e is not None:
                    embs.append(e)
                    self.play(self.ack)
                    break
                self.say("Не расслышал, ещё раз.")
        self.after_speech()
        if len(embs) < 3:
            self.hub.state(enroll={"state": "error", "error": "Слишком мало записей — попробуйте ещё раз в тишине"})
            self.say("Не получилось записать голос. Попробуйте ещё раз в тишине.")
            return
        scores = self.speaker.save(embs)
        log(f"Голос записан: {len(embs)} фраз, похожесть на себя {min(scores):.2f}–{max(scores):.2f}")
        self.hub.state(
            enroll={"state": "done", "count": len(embs)},
            speaker={"enrolled": True, "self": [round(min(scores), 2), round(max(scores), 2)]},
        )
        addr = self.cfg.get("address") or ""
        self.say(f"Готово{', ' + addr if addr else ''}. Теперь я узнаю ваш голос.")

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
            elif t == "enroll":
                self.enroll([str(x) for x in e.get("phrases") or []][:10])
            elif t == "owner.add":
                if self.speaker and self.speaker.add_last():
                    log("Последняя фраза добавлена к голосу владельца")
                    sc = self.speaker.self_scores
                    self.hub.state(speaker={"enrolled": True, "owner": True, "added": True, "self": [round(min(sc), 2), round(max(sc), 2)]})
                    self.say("Запомнил. Теперь узнаю вас лучше.")
            elif t == "enroll.reset":
                if self.speaker:
                    self.speaker.reset()
                self.hub.state(speaker={"enrolled": False}, enroll=None)
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
            elif (old.get("speaker"), old.get("rate"), old.get("address"), old.get("voiceFx")) != (cfg.get("speaker"), cfg.get("rate"), cfg.get("address"), cfg.get("voiceFx")) and self.tts:
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
        if action == "stop":
            self.stop_speech.set()
            return
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
        try:
            from speaker import Speaker

            self.speaker = Speaker(self.models_dir())
            if self.speaker.enrolled and (self.cfg.get("speakerLock") or "off") != "off":
                self.speaker.ensure_model()
            self.hub.state(
                speaker={"enrolled": self.speaker.enrolled, "self": [round(min(self.speaker.self_scores), 2), round(max(self.speaker.self_scores), 2)] if self.speaker.self_scores else None}
            )
        except Exception as e:
            log(f"Проверка голоса недоступна: {e}")
        self.prewarm()
        try:
            from echo import SystemAudio

            self.sysaudio = SystemAudio()
        except Exception as e:
            log(f"Звук колонок не слушается: {e}")
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
            rms = frame_rms(frame)
            if not self.vad.is_speech(frame, RATE):
                self.noise = self.noise * 0.98 + min(rms, 4000) * 0.02
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
