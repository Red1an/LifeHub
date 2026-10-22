/*
 * Формат настроек читает расширение браузера (voice/browser-extension/focus/focus.js, там же значения
 * по умолчанию) — менять только вместе с ним.
 */

export interface Site {
  id: string;
  name: string;
  /** Домены: сайт и все его поддомены. */
  hosts: string[];
  on: boolean;
  /** YouTube — без рекомендаций и Shorts, Инстаграм — без Reels и «Интересного». */
  clean: boolean;
  /** Минут в день; дальше вход только на 5 минут и с долгим ожиданием. 0 — без лимита. */
  dailyMin: number;
}

export interface FocusConfig {
  enabled: boolean;
  sites: Site[];
  /** Ожидание перед входом, секунд, и прибавка за каждый сеанс сегодня. */
  waitSec: number;
  waitStepSec: number;
  /** Варианты таймера, минут. */
  minutes: number[];
  /** Рабочее время: ожидание вдвое дольше и не больше 10 минут. days: 0 = воскресенье … 6 = суббота. */
  work: { on: boolean; days: number[]; from: string; to: string };
  /** Пауза: начинается через pauseDelayMin после requestedAt и длится до until. */
  pause: { requestedAt: number; until: number } | null;
  pauseDelayMin: number;
  /** Ослабленные настройки ждут applyAt (через pauseDelayMin), потом действуют вместо этих. */
  pending?: (Omit<FocusConfig, "pending"> & { applyAt: number }) | null;
}

export const DEFAULT_CONFIG: FocusConfig = {
  enabled: true,
  sites: [
    { id: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"], on: true, clean: true, dailyMin: 60 },
    { id: "instagram", name: "Инстаграм", hosts: ["instagram.com"], on: true, clean: true, dailyMin: 30 },
    { id: "vk", name: "ВКонтакте", hosts: ["vk.com", "vk.ru"], on: false, clean: false, dailyMin: 30 },
    { id: "tiktok", name: "TikTok", hosts: ["tiktok.com"], on: false, clean: false, dailyMin: 15 },
  ],
  waitSec: 15,
  waitStepSec: 15,
  minutes: [5, 10, 20, 30],
  work: { on: true, days: [1, 2, 3, 4, 5], from: "10:00", to: "19:00" },
  pause: null,
  pauseDelayMin: 10,
};

/** Сеанс на сайте — пишет расширение (через сервер хаба). */
export interface Session {
  site: string;
  siteName: string;
  purpose: string;
  minutes: number;
  startedAt: number;
  endsAt: number | null;
  endedAt: number | null;
  /** timer — время вышло, self — «Я всё», closed — закрыл вкладки сам; null — идёт. */
  endedBy: "timer" | "self" | "closed" | null;
  waited: number;
  titles: string[];
}

export interface Channel {
  channelId: string;
  title: string;
  topic: string;
  thumb?: string;
}

export interface Video {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  /** ISO-дата публикации. */
  published: string;
  thumb: string;
  views?: number;
}

export interface Watched {
  videoId: string;
  title: string;
  channelTitle: string;
  topic: string;
  at: number;
}

export const DEFAULT_TOPICS = ["Обучение", "Научпоп", "Путешествия"];
