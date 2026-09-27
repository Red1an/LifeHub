@../LIFEHUB_GUIDE.md

# Аудио (библиотека)

Общий аудиодвижок, вынесенный из GuitarHub. Им пользуются модули guitar и любые будущие
(тренер речи, вокал). Код загружается в браузер один раз, поэтому AudioContext один на всю страницу.

## Заметки по модулю

- `getAudioContext()` — единственный AudioContext; не создавай свои.
- `openMic()` / `startPitchTracking()` — микрофон и высота тона (автокорреляция).
- Хуки: `useMicPitch`, `useMicSource`, `useOnsetRecorder`, `useHoldTimer`.
- Калибровка задержки (`getLatencyMs`/`setLatencyMs`) хранится в localStorage намеренно:
  она своя у каждого устройства (у телефона и компьютера разная задержка).
- Меняешь API несовместимо — повышай мажорную версию в lifehub.json.
