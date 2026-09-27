/**
 * Общий аудиодвижок для модулей LifeHub: один AudioContext на всю страницу,
 * микрофон, определение высоты тона, метроном, распознавание ударов.
 * Подключение: "uses": { "audio": "^1" } и import { … } from "@modules/audio".
 */
export * from "./context";
export * from "./click";
export * from "./metronome";
export * from "./mic";
export * from "./autocorrelate";
export * from "./chroma";
export * from "./onset";
export * from "./rhythm-analysis";
export * from "./vibrato";
export * from "./karplus";
export * from "./hooks/useMicPitch";
export * from "./hooks/useMicSource";
export * from "./hooks/useOnsetRecorder";
export * from "./hooks/useHoldTimer";
