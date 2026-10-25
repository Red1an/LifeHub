"""
Только мой голос: отпечаток голоса владельца (WeSpeaker ResNet34, ONNX, ~80 МБ памяти, ~0.05 с на фразу).

Запись: владелец повторяет несколько фраз → отпечатки сохраняются в ~/.lifehub/voice/owner.npz.
Проверка: косинусная похожесть фразы на голос владельца (0…1) — лучшая из «на средний отпечаток»
и «на самую похожую записанную фразу»: голос в разных фразах звучит по-разному, среднее одно этого не ловит.
Считается только по кускам с речью — фон, тишина и сигналы Джарвиса сильно портят отпечаток.

«Это был я» (кнопка в модуле) добавляет последнюю фразу к записанным — отпечаток подстраивается под
реальный микрофон и комнату. Хранится не больше MAX_SAMPLES фраз; повторы и явно чужие фразы выбрасываются.

«Это был не я» запоминает чужой голос (и голос из своих колонок — сам). Фраза, которая похожа на
запомненного чужого сильнее, чем на владельца, получает штраф: голос из видео, который случайно
похож на владельца, после одного нажатия перестаёт проходить.

Это защита от соседа по комнате и голоса из видео, а не от целенаправленной атаки записью голоса.
"""

import os

import numpy as np
import webrtcvad

MODEL = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
RATE = 16000
FRAME = 480 * 2  # 30 мс, 16 бит
MIN_SPEECH = int(RATE * 0.8)  # меньше 0.8 с речи — отпечаток ненадёжный
MAX_SAMPLES = 24
MAX_OTHERS = 60
SAME = 0.97  # почти одинаковые отпечатки — одна и та же фраза дважды
OUTLIER = 0.3  # фраза похожа на остальные записи меньше этого — чужая, попала по ошибке
FOREIGN = 0.25  # «Это был я» для фразы, совсем не похожей на владельца, — не принимаем
MARGIN = 0.1  # насколько владелец должен быть ближе запомненных чужих


def speech_only(pcm: bytes) -> bytes:
    """Только кадры с речью (плюс по кадру вокруг) — без тишины, фона и щелчков."""
    vad = webrtcvad.Vad(3)
    frames = [pcm[i : i + FRAME] for i in range(0, len(pcm) - FRAME + 1, FRAME)]
    flags = [vad.is_speech(f, RATE) for f in frames]
    keep = [flags[i] or (i > 0 and flags[i - 1]) or (i + 1 < len(flags) and flags[i + 1]) for i in range(len(frames))]
    return b"".join(f for f, k in zip(frames, keep) if k)


def clean_samples(samples: np.ndarray) -> np.ndarray:
    """Без повторов и без записей, которые не похожи на остальные (попали по ошибке «Это был я»)."""
    keep: list[int] = []
    for i in range(len(samples)):
        if all(float(samples[i] @ samples[j]) < SAME for j in keep):
            keep.append(i)
    s = samples[keep]
    if len(s) < 6:
        return s
    m = s @ s.T
    np.fill_diagonal(m, np.nan)
    near = np.nanmean(m, axis=1)
    good = near >= min(OUTLIER, float(np.median(near)) - 0.1)
    return s[good] if good.sum() >= 5 else s


class Speaker:
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.path = os.path.join(os.path.dirname(models_dir.rstrip("/\\")), "owner.npz")
        self.model = None
        self.owner: np.ndarray | None = None
        self.samples: np.ndarray | None = None
        self.self_scores: list[float] = []
        self.others: np.ndarray | None = None
        self.last: np.ndarray | None = None
        self._load_owner()

    @property
    def enrolled(self) -> bool:
        return self.owner is not None

    def _load_owner(self):
        try:
            z = np.load(self.path)
            self.owner = z["owner"].astype(np.float32)
            self.samples = z["samples"].astype(np.float32) if "samples" in z else self.owner[None, :]
            self.self_scores = [float(x) for x in z["scores"]] if "scores" in z else []
            self.others = z["others"].astype(np.float32) if "others" in z and len(z["others"]) else None
        except Exception:
            self.owner = None
            self.samples = None
            return
        clean = clean_samples(self.samples)
        if len(clean) != len(self.samples):
            print(f"Голос владельца: убрал {len(self.samples) - len(clean)} лишних записей", flush=True)
            self._write(clean)

    def ensure_model(self):
        if self.model is not None:
            return
        from onnx_asr.loader import Manager

        self.model = Manager(providers=["CPUExecutionProvider"]).create_se(MODEL, os.path.join(self.models_dir, "wespeaker"))

    def embed(self, pcm: bytes, min_sec: float | None = None) -> np.ndarray | None:
        speech = speech_only(pcm)
        if len(speech) // 2 < (int(RATE * min_sec) if min_sec else MIN_SPEECH):
            return None
        audio = np.frombuffer(speech, dtype=np.int16).astype(np.float32) / 32768.0
        self.ensure_model()
        e = np.asarray(self.model.embedding(audio, sample_rate=RATE), dtype=np.float32).reshape(-1)
        n = float(np.linalg.norm(e))
        return e / n if n > 0 else None

    def score(self, pcm: bytes, min_sec: float | None = None, keep: bool = True) -> float | None:
        """Похожесть на владельца, 0…1. None — сравнить не с чем или речи слишком мало."""
        if self.owner is None:
            return None
        e = self.embed(pcm, min_sec)
        if keep:
            self.last = e
        if e is None:
            return None
        best = float(self.owner @ e)
        if self.samples is not None and len(self.samples):
            sims = np.sort(self.samples @ e)[::-1]
            # Среднее двух самых похожих записей: одна случайно похожая не решает.
            best = max(best, float(sims[: min(2, len(sims))].mean()))
        if self.others is not None and len(self.others):
            # Похоже на запомненного чужого не меньше, чем на владельца, — штраф.
            other = float(np.max(self.others @ e))
            best -= max(0.0, other - best + MARGIN)
        return max(0.0, best)

    def _write(self, samples: np.ndarray):
        owner = samples.mean(axis=0)
        owner /= np.linalg.norm(owner)
        scores = [float(owner @ e) for e in samples]
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        others = self.others if self.others is not None else np.zeros((0, samples.shape[1]), dtype=np.float32)
        np.savez(
            self.path,
            owner=owner.astype(np.float32),
            samples=samples.astype(np.float32),
            scores=np.array(scores, dtype=np.float32),
            others=others.astype(np.float32),
        )
        self.owner = owner.astype(np.float32)
        self.samples = samples.astype(np.float32)
        self.self_scores = scores
        return scores

    def save(self, embeddings: list[np.ndarray]):
        return self._write(np.stack(embeddings))

    def add_last(self) -> str:
        """«Это был я»: последняя проверенная фраза — к записанным. Возвращает ok | none | same | foreign."""
        if self.last is None or self.samples is None:
            return "none"
        sims = self.samples @ self.last
        if float(sims.max()) >= SAME:
            return "same"
        if float(self.owner @ self.last) < FOREIGN:
            return "foreign"
        # Если эта фраза раньше попала в чужие — убираем оттуда.
        if self.others is not None and len(self.others):
            self.others = self.others[(self.others @ self.last) < SAME]
        self._write(np.vstack([self.samples, self.last[None, :]])[-MAX_SAMPLES:])
        return "ok"

    def add_other(self, e: np.ndarray | None = None) -> bool:
        """«Это был не я» (последняя фраза) или голос из колонок: запомнить как чужой."""
        e = self.last if e is None else e
        if e is None or self.samples is None:
            return False
        if self.others is not None and len(self.others) and float(np.max(self.others @ e)) >= SAME:
            return True
        # Чужой, который точь-в-точь как записанная фраза владельца, — значит, эта запись была не его.
        keep = (self.samples @ e) < SAME
        samples = self.samples[keep] if keep.sum() >= 3 else self.samples
        self.others = (e[None, :] if self.others is None else np.vstack([self.others, e[None, :]]))[-MAX_OTHERS:]
        self._write(samples)
        return True

    def reset(self):
        try:
            os.remove(self.path)
        except OSError:
            pass
        self.owner = None
        self.samples = None
        self.self_scores = []
        self.others = None

    def unload(self):
        self.model = None
