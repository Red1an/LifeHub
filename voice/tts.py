"""
Голос Джарвиса, офлайн. Числа — словами, латиница — кириллицей, паузы — из разметки хаба.

  piper  — ONNX, ~120 МБ памяти, голоса dmitri, ruslan, denis, irina. По умолчанию.
  silero — v5 на torch: звучит естественнее, но вместе с torch это ~700 МБ памяти.
"""

import os
import re
import urllib.request
import warnings

import numpy as np
from num2words import num2words

# Silero собран старым torch.package — предупреждение о TypedStorage только засоряет журнал.
warnings.filterwarnings("ignore", message=".*TypedStorage is deprecated.*")

SILERO_MODELS = [
    ("v5_ru", "https://models.silero.ai/models/tts/ru/v5_ru.pt"),
    ("v4_ru", "https://models.silero.ai/models/tts/ru/v4_ru.pt"),
]
SILERO_SPEAKERS = ["aidar", "eugene", "baya", "kseniya", "xenia"]
PIPER_SPEAKERS = ["dmitri", "ruslan", "denis", "irina"]
PIPER_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/{v}/medium/ru_RU-{v}-medium.{ext}"

WORDS = {
    "youtube": "ютуб", "google": "гугл", "telegram": "телеграм", "discord": "дискорд", "steam": "стим", "chrome": "хром",
    "spotify": "спотифай", "github": "гитхаб", "windows": "виндоус", "vs": "ви эс", "code": "код", "devpath": "девпас",
    "claude": "клод", "chatgpt": "чат джи пи ти", "ok": "окей", "wi-fi": "вай фай", "wifi": "вай фай", "bluetooth": "блютуз",
    "word": "ворд", "excel": "эксель", "photoshop": "фотошоп", "obs": "о б эс", "vivaldi": "вивальди", "yandex": "яндекс",
    "ozon": "озон", "wildberries": "вайлдберриз", "twitch": "твич", "explorer": "эксплорер", "notepad": "блокнот",
    "lifehub": "лайфхаб", "hub": "хаб", "the": "зе", "and": "энд", "pc": "пи си", "gpu": "джи пи ю", "cpu": "цэ пэ у",
    "pycharm": "пайчарм", "blender": "блендер", "obsidian": "обсидиан", "lofi": "лоу фай", "lo-fi": "лоу фай",
}

LAT = [
    ("sch", "щ"), ("sh", "ш"), ("ch", "ч"), ("zh", "ж"), ("kh", "х"), ("ts", "ц"), ("th", "т"), ("ph", "ф"), ("ya", "я"),
    ("yu", "ю"), ("yo", "ё"), ("oo", "у"), ("ee", "и"), ("ck", "к"), ("qu", "кв"), ("a", "а"), ("b", "б"), ("c", "к"),
    ("d", "д"), ("e", "е"), ("f", "ф"), ("g", "г"), ("h", "х"), ("i", "и"), ("j", "дж"), ("k", "к"), ("l", "л"), ("m", "м"),
    ("n", "н"), ("o", "о"), ("p", "п"), ("q", "к"), ("r", "р"), ("s", "с"), ("t", "т"), ("u", "у"), ("v", "в"), ("w", "в"),
    ("x", "кс"), ("y", "й"), ("z", "з"),
]


def _latin(word: str) -> str:
    low = word.lower()
    if low in WORDS:
        return WORDS[low]
    out, i = "", 0
    while i < len(low):
        for a, b in LAT:
            if low.startswith(a, i):
                out += b
                i += len(a)
                break
        else:
            i += 1
    return out


def _number(m: re.Match) -> str:
    s = m.group(0).replace(",", ".")
    try:
        if "." in s:
            whole, frac = s.split(".", 1)
            return f"{num2words(int(whole), lang='ru')} и {num2words(int(frac), lang='ru')}"
        return num2words(int(s), lang="ru")
    except Exception:
        return s


def prepare(text: str) -> list[tuple[str, int]]:
    """Текст → куски для синтеза и паузы после них (мс). Паузы — разметка хаба «sil <[300]>»."""
    parts = re.split(r"\s*sil\s*<\[(\d+)\]>\s*", text)
    out: list[tuple[str, int]] = []
    for i in range(0, len(parts), 2):
        chunk = parts[i]
        pause = int(parts[i + 1]) if i + 1 < len(parts) else 0
        chunk = re.sub(r"https?://\S+", "", chunk)
        chunk = chunk.replace("%", " процентов").replace("₽", " рублей").replace("№", "номер ")
        chunk = re.sub(r"(\d)\s+(\d{3})(?!\d)", r"\1\2", chunk)
        chunk = re.sub(r"\d+([.,]\d+)?", _number, chunk)
        chunk = re.sub(r"[A-Za-z][A-Za-z\-]*", lambda m: _latin(m.group(0)), chunk)
        chunk = re.sub(r"[^\w\s.,!?:;+\-—()«»\"']", " ", chunk)
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if chunk:
            out.append((chunk, pause))
        elif out and pause:
            out[-1] = (out[-1][0], out[-1][1] + pause)
    return out


def _sentences(chunk: str, limit: int = 700) -> list[str]:
    groups, buf = [], ""
    for s in re.split(r"(?<=[.!?])\s+", chunk):
        if len(buf) + len(s) > limit and buf:
            groups.append(buf)
            buf = ""
        buf = (buf + " " + s).strip()
    if buf:
        groups.append(buf)
    return groups


def _rate(r: float) -> str:
    if r < 0.8:
        return "x-slow"
    if r < 0.95:
        return "slow"
    if r < 1.1:
        return "medium"
    if r < 1.3:
        return "fast"
    return "x-fast"


class Tts:
    """Синтез: synth(text) → (float32 моно, частота)."""

    def __init__(self, models_dir: str, engine: str = "piper", speaker: str = "", on_status=lambda s: None):
        self.dir = models_dir
        self.engine = "silero" if engine == "silero" else "piper"
        self.speaker = speaker
        self.model = None
        self.voices: dict = {}
        if self.engine == "silero":
            self._load_silero(on_status)
        else:
            self._piper(self.speaker if self.speaker in PIPER_SPEAKERS else PIPER_SPEAKERS[0], on_status)

    @property
    def speakers(self) -> list[str]:
        return SILERO_SPEAKERS if self.engine == "silero" else PIPER_SPEAKERS

    # ───────────── Piper ─────────────

    def _piper(self, name: str, on_status=lambda s: None):
        if name in self.voices:
            return self.voices[name]
        from piper import PiperVoice

        d = os.path.join(self.dir, "piper")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"ru_RU-{name}-medium.onnx")
        for ext in ("onnx", "onnx.json"):
            f = os.path.join(d, f"ru_RU-{name}-medium.{ext}")
            if not os.path.exists(f):
                on_status(f"Скачиваю голос {name} (~60 МБ)")
                urllib.request.urlretrieve(PIPER_URL.format(v=name, ext=ext), f + ".part")
                os.replace(f + ".part", f)
        voice = PiperVoice.load(path)
        self.voices = {name: voice}  # держим в памяти один голос
        return voice

    # ───────────── Silero ─────────────

    def _load_silero(self, on_status):
        import torch

        torch.set_num_threads(4)
        d = os.path.join(self.dir, "silero")
        os.makedirs(d, exist_ok=True)
        last = None
        for name, url in SILERO_MODELS:
            path = os.path.join(d, name + ".pt")
            try:
                if not os.path.exists(path):
                    on_status("Скачиваю голос Silero (~100 МБ)")
                    urllib.request.urlretrieve(url, path + ".part")
                    os.replace(path + ".part", path)
                self.model = torch.package.PackageImporter(path).load_pickle("tts_models", "model")
                self.model.to(torch.device("cpu"))
                return
            except Exception as e:
                last = e
                print(f"Голос {name} не загрузился: {e}", flush=True)
        raise RuntimeError(f"Голос Silero не загрузился: {last}")

    # ───────────── синтез ─────────────

    def synth(self, text: str, speaker: str = "", rate: float = 1.0) -> tuple[np.ndarray, int]:
        pieces: list[np.ndarray] = []
        sr = 48000
        if self.engine == "piper":
            from piper import SynthesisConfig

            voice = self._piper(speaker if speaker in PIPER_SPEAKERS else (self.speaker if self.speaker in PIPER_SPEAKERS else PIPER_SPEAKERS[0]))
            sr = voice.config.sample_rate
            cfg = SynthesisConfig(length_scale=1 / max(0.5, min(2.0, rate)))
            for chunk, pause in prepare(text):
                for c in voice.synthesize(chunk.replace("+", ""), syn_config=cfg):
                    pieces.append(c.audio_float_array.astype(np.float32))
                if pause:
                    pieces.append(np.zeros(int(sr * pause / 1000), dtype=np.float32))
        else:
            from xml.sax.saxutils import escape

            spk = speaker if speaker in SILERO_SPEAKERS else "aidar"
            for chunk, pause in prepare(text):
                for g in _sentences(chunk):
                    ssml = f'<speak><prosody rate="{_rate(rate)}">{escape(g)}</prosody></speak>'
                    try:
                        audio = self.model.apply_tts(ssml_text=ssml, speaker=spk, sample_rate=sr)
                    except Exception:
                        audio = self.model.apply_tts(text=g, speaker=spk, sample_rate=sr)
                    pieces.append(audio.numpy().astype(np.float32))
                if pause:
                    pieces.append(np.zeros(int(sr * pause / 1000), dtype=np.float32))
        if not pieces:
            return np.zeros(0, dtype=np.float32), sr
        return np.concatenate(pieces), sr


def jarvis_fx(audio: np.ndarray, sr: int, amount: float) -> np.ndarray:
    """
    Голос «как у ИИ из фильма»: чуть ниже, с лёгким металлом и отзвуком. amount 0…1.
    Тон понижается пересэмплированием (речь при этом замедляется — synth заранее ускоряет её на столько же).
    """
    if amount <= 0 or not len(audio):
        return audio
    x = audio.astype(np.float32)
    # Ниже на 3–7%.
    p = fx_pitch(amount)
    n = int(len(x) / p)
    x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    # Убираем гул ниже ~90 Гц.
    a = np.exp(-2 * np.pi * 90 / sr)
    hp = np.empty_like(x)
    prev_x = prev_y = 0.0
    for i in range(len(x)):  # однополюсный фильтр, быстро на коротких фразах
        prev_y = a * (prev_y + x[i] - prev_x)
        prev_x = x[i]
        hp[i] = prev_y
    x = hp

    def delay(sig: np.ndarray, ms: float) -> np.ndarray:
        d = int(sr * ms / 1000)
        return np.concatenate([np.zeros(d, np.float32), sig[:-d]]) if 0 < d < len(sig) else np.zeros_like(sig)

    # Металл: короткая гребёнка; комната: пара ранних отражений и мягкий хвост.
    y = x + 0.28 * amount * delay(x, 4.2) + 0.12 * amount * delay(x, 7.9)
    y = y + 0.14 * amount * delay(y, 29) + 0.09 * amount * delay(y, 53) + 0.05 * amount * delay(y, 97)
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.92).astype(np.float32)


def fx_pitch(amount: float) -> float:
    return 1.0 + 0.07 * max(0.0, min(1.0, amount))
