import { useEffect } from "react";
import { useCollection, useStore, startOfDay, startOfWeek, addDays, dayKey } from "@lifehub/sdk";
import { DEFAULT_CONFIG, DEFAULT_TOPICS, type Channel, type FocusConfig, type PhoneApps, type Session, type Video, type Watched } from "./types";

type Plain = Omit<FocusConfig, "pending">;

const maxOf = (xs: number[]) => Math.max(0, ...xs);
const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Стало ли с b свободнее, чем с a: такие изменения вступают в силу только через pauseDelayMin. */
export function isLooser(a: Plain, b: Plain): boolean {
  if (a.enabled && !b.enabled) return true;
  for (const s of a.sites) {
    const t = b.sites.find((x) => x.id === s.id);
    if (!s.on) continue;
    if (!t || !t.on) return true;
    if (s.clean && !t.clean) return true;
    if (s.dailyMin > 0 && (t.dailyMin === 0 || t.dailyMin > s.dailyMin)) return true;
    if (s.hosts.some((h) => !t.hosts.includes(h))) return true;
    if ((s.apps ?? []).some((a) => !(t.apps ?? []).includes(a))) return true;
  }
  if (b.waitSec < a.waitSec || b.waitStepSec < a.waitStepSec) return true;
  if (maxOf(b.minutes) > maxOf(a.minutes)) return true;
  if (b.pauseDelayMin < a.pauseDelayMin) return true;
  const w = a.work;
  if (w.on) {
    if (!b.work.on) return true;
    if (w.days.some((d) => !b.work.days.includes(d))) return true;
    if (mins(b.work.from) > mins(w.from) || mins(b.work.to) < mins(w.to)) return true;
  }
  return false;
}

function strip(c: FocusConfig): Plain {
  const { pending: _p, ...rest } = c;
  return rest;
}

/**
 * Настройки: действующие (config), черновик с задержкой (pending) и сохранение по правилу
 * «ужесточить — сразу, ослабить — через pauseDelayMin».
 */
export function useConfig() {
  const [stored, setStored, { loading }] = useStore<FocusConfig | null>("config", null);
  const raw: FocusConfig = { ...DEFAULT_CONFIG, ...(stored ?? {}) };
  const now = Date.now();
  // Отложенные изменения дождались своего часа — делаем их основными.
  const ripe = raw.pending && now >= raw.pending.applyAt;
  useEffect(() => {
    if (!loading && ripe && raw.pending) {
      const { applyAt: _a, ...next } = raw.pending;
      setStored({ ...next, pending: null });
    }
  }, [loading, ripe]);
  // Новые встроенные сайты (Озон, Wildberries…) и приложения к старым — дописать в сохранённые настройки.
  // Это только ужесточает, поэтому сразу.
  const upgrade = (c: Omit<FocusConfig, "pending">) => {
    let changed = false;
    const sites = c.sites.map((s) => {
      const d = DEFAULT_CONFIG.sites.find((x) => x.id === s.id);
      if (d?.apps && !s.apps) {
        changed = true;
        return { ...s, apps: d.apps };
      }
      return s;
    });
    for (const d of DEFAULT_CONFIG.sites)
      if (!sites.some((s) => s.id === d.id)) {
        sites.push(d);
        changed = true;
      }
    return changed ? { ...c, sites } : null;
  };
  useEffect(() => {
    if (loading || !stored) return;
    const base = upgrade(raw);
    const pend = raw.pending ? upgrade(raw.pending) : null;
    if (base || pend) setStored({ ...(base ?? raw), pending: raw.pending ? { ...(pend ?? raw.pending), applyAt: raw.pending.applyAt } : null });
  }, [loading, stored]);
  const config: Plain = ripe && raw.pending ? (({ applyAt: _a, ...rest }) => rest)(raw.pending) : strip(raw);
  const pending = !ripe && raw.pending ? raw.pending : null;
  /** То, что видно в настройках: ждущее изменение или действующее. */
  const draft: Plain = pending ? (({ applyAt: _a, ...rest }) => rest)(pending) : config;

  function save(next: Plain) {
    if (isLooser(config, next)) {
      // Уже ждём и новое не свободнее ждущего — таймер не сбрасываем.
      const applyAt = pending && !isLooser(draft, next) ? pending.applyAt : Date.now() + config.pauseDelayMin * 60_000;
      setStored({ ...config, pending: { ...next, applyAt } });
    } else setStored({ ...next, pending: null });
  }
  function cancelPending() {
    setStored({ ...config, pending: null });
  }
  /** Пауза своей задержкой управляет сама (её отсчитывает расширение), поэтому пишется сразу. */
  function setPause(pause: FocusConfig["pause"]) {
    setStored({ ...config, pause, pending: pending ? { ...pending, pause } : null });
  }
  return { config, draft, pending, loading, save, cancelPending, setPause };
}

export type PauseState = "off" | "waiting" | "on";
export function pauseState(c: Plain, now = Date.now()): PauseState {
  const p = c.pause;
  if (!p || now >= p.until) return "off";
  return now < p.requestedAt + c.pauseDelayMin * 60_000 ? "waiting" : "on";
}

export const useSessions = () => useCollection<Session>("sessions");
export const useChannels = () => useCollection<Channel>("channels");
export const useWatched = () => useCollection<Watched>("watched");
export const useTopics = () => useStore<string[]>("topics", DEFAULT_TOPICS);
export const useFeedCache = () => useStore<{ at: number; videos: Video[]; failed: string[] } | null>("feed", null);
export const useExtension = () => useStore<{ seenAt: number; version: string } | null>("extension", null);
export const usePhone = () => useStore<{ seenAt: number; version: string } | null>("phone", null);
export const usePhoneApps = () => useStore<PhoneApps | null>("phoneApps", null);
export const useInstall = () => useStore<{ extensionPath: string } | null>("install", null);

/** Длительность сеанса в минутах (идущий — по сей момент). */
export function sessionMin(s: Session, now = Date.now()) {
  const end = s.endedAt ?? Math.min(now, s.endsAt ?? now);
  return Math.max(0, (end - s.startedAt) / 60_000);
}

export function minutesSince(sessions: Session[], from: number) {
  return sessions.filter((s) => s.startedAt >= from).reduce((a, s) => a + sessionMin(s), 0);
}

export const todayStart = () => startOfDay().getTime();
export const weekStart = (offset = 0) => addDays(startOfWeek(), offset * 7).getTime();
export const dayLabel = (d: Date) => ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
export { dayKey };

export function fmtMin(m: number) {
  const r = Math.round(m);
  if (r < 60) return `${r} мин`;
  return `${Math.floor(r / 60)} ч ${r % 60 ? `${r % 60} мин` : ""}`.trim();
}
