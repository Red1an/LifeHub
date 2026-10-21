"""
Распознавание фраз.

  gigaam  — GigaAM v3 от Сбера (ONNX, int8, процессор): лучший для русского, сразу с пунктуацией
            и цифрами, ~0.2 с на фразу и ~300 МБ памяти. Видеокарта не нужна. По умолчанию.
  whisper — faster-whisper на видеокарте (CUDA): тяжелее (~1 ГБ видеопамяти и ~600 МБ памяти),
            зато понимает смешанную русско-английскую речь. В игровом режиме — на процессоре.
"""

import gc
import glob
import os
import re
import site

import numpy as np

# Whisper на тишине и шуме иногда «слышит» титры из обучающих видео.
HALLUCINATIONS = re.compile(
    r"(субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|редактор|корректор|dimatorzok|"
    r"amara\.org|ставьте лайк|благодарю за внимание|до новых встреч)",
    re.I,
)

GIGAAM = "gigaam-v3-e2e-rnnt"
WHISPER_CPU = "small"


def add_cuda_paths():
    """CUDA-библиотеки стоят pip-пакетами nvidia-*: Windows сама их не найдёт."""
    for sp in site.getsitepackages():
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except (OSError, AttributeError):
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


class Stt:
    def __init__(self, models_dir: str):
        self.dir = models_dir
        self.model = None
        self.kind = ""
        self.key = None
        self.gpu = False
        self.name = ""

    def load(self, engine: str, whisper_model: str, device: str, game: bool, on_status=lambda s: None):
        if engine != "whisper":
            key = ("gigaam",)
            if key == self.key and self.model is not None:
                return
            self.unload()
            on_status("Загружаю распознавание речи GigaAM. В первый раз модель скачивается, ~250 МБ")
            import onnx_asr

            self.model = onnx_asr.load_model(
                GIGAAM, os.path.join(self.dir, GIGAAM), quantization="int8", providers=["CPUExecutionProvider"]
            )
            self.kind, self.gpu, self.name, self.key = "gigaam", False, "GigaAM v3", key
            self._warm()
            return

        want_gpu = device != "cpu" and not game
        key = ("whisper", whisper_model if want_gpu else WHISPER_CPU, want_gpu)
        if key == self.key and self.model is not None:
            return
        self.unload()
        add_cuda_paths()
        from faster_whisper import WhisperModel

        root = os.path.join(self.dir, "whisper")
        if want_gpu:
            try:
                on_status(f"Загружаю Whisper ({whisper_model}) на видеокарту. В первый раз модель скачивается, ~1.6 ГБ")
                self.model = WhisperModel(whisper_model, device="cuda", compute_type="int8_float16", download_root=root)
                self.kind, self.gpu, self.name, self.key = "whisper", True, whisper_model, key
                self._warm()
                return
            except Exception as e:  # нет CUDA, не хватило памяти — на процессор
                print(f"Видеокарта недоступна: {e}", flush=True)
                self.unload()
                if device == "cuda":
                    raise
        on_status(f"Загружаю Whisper ({WHISPER_CPU}) на процессор")
        self.model = WhisperModel(WHISPER_CPU, device="cpu", compute_type="int8", download_root=root, cpu_threads=4)
        self.kind, self.gpu, self.name, self.key = "whisper", False, WHISPER_CPU, ("whisper", WHISPER_CPU, False)
        self._warm()

    def _warm(self):
        # Первый проход медленный (инициализация) — делаем его сразу, не на первой фразе.
        self._run(np.zeros(16000, dtype=np.float32), "")

    def unload(self):
        self.model = None
        self.key = None
        gc.collect()

    def _run(self, audio: np.ndarray, hotwords: str) -> str:
        if self.kind == "gigaam":
            return str(self.model.recognize(audio, sample_rate=16000)).strip()
        segments, _ = self.model.transcribe(
            audio,
            language="ru",
            beam_size=3 if self.gpu else 1,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            vad_filter=False,
            hotwords=hotwords or None,
        )
        return " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.7).strip()

    def transcribe(self, pcm: bytes, hotwords: str = "") -> str:
        if self.model is None or not pcm:
            return ""
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        text = self._run(audio, hotwords)
        if HALLUCINATIONS.search(text):
            return ""
        return text
