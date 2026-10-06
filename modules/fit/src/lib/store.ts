import { useMemo } from "react";
import { dayKey, startOfWeek, useCollection, useStore } from "@lifehub/sdk";
import { DEFAULT_PLACES } from "../data/library.ts";
import type { Routine } from "../data/routines.ts";
import { minutesOf, type Hist } from "./analysis.ts";
import { dayStreak, rankFor, weekStreak } from "./game.ts";
import type { Profile, Workout } from "./types.ts";

export const DEFAULT_PROFILE: Profile = {
  onboarded: false,
  experience: 1,
  goal: "health",
  perWeek: 3,
  minutes: 30,
  limits: [],
  places: DEFAULT_PLACES,
  place: "home",
  breaksPerDay: 4,
  remindEvery: 60,
  workFrom: 10,
  workTo: 19,
  sound: true,
  voice: true,
};

export interface Active {
  w: Workout;
  step: number;
  /** Когда завершилась пауза отдыха (для восстановления после перезагрузки). */
  restUntil?: number;
}

export function useProfile() {
  const [p, set, meta] = useStore<Profile>("profile", DEFAULT_PROFILE);
  const profile = { ...DEFAULT_PROFILE, ...p };
  return [profile, set, meta] as const;
}

/** Все данные модуля одним хуком. */
export function useFit() {
  const workouts = useCollection<Workout>("workouts");
  const [profile, setProfile, pMeta] = useProfile();
  const [levels, setLevels, lMeta] = useStore<Record<string, string>>("levels", {});
  const [hidden, setHidden] = useStore<string[]>("hidden", []);
  const [active, setActive, aMeta] = useStore<Active | null>("active", null);

  const derived = useMemo(() => {
    const hist: Hist[] = workouts.items.filter((w) => w.finishedAt).sort((a, b) => a.finishedAt! - b.finishedAt!);
    const xp = hist.reduce((n, w) => n + (w.xp ?? 0), 0);
    const today = dayKey();
    const weekStart = startOfWeek().getTime();
    const todays = hist.filter((w) => dayKey(w.finishedAt!) === today);
    const week = hist.filter((w) => w.finishedAt! >= weekStart);
    const lastBreak = [...hist].reverse().find((w) => w.kind === "break" || w.kind === "morning" || w.kind === "workout");
    return {
      hist,
      xp,
      rank: rankFor(xp),
      week: weekStreak(hist, profile.perWeek),
      days: dayStreak(hist),
      breaksToday: todays.filter((w) => w.kind === "break").length,
      minutesToday: todays.reduce((n, w) => n + minutesOf(w), 0),
      minutesWeek: week.reduce((n, w) => n + minutesOf(w), 0),
      lastMoveAt: lastBreak?.finishedAt ?? 0,
    };
  }, [workouts.items, profile.perWeek]);

  const place = profile.places.find((p) => p.id === profile.place) ?? profile.places[0] ?? DEFAULT_PLACES[0];

  return {
    loading: workouts.loading || pMeta.loading || lMeta.loading || aMeta.loading,
    workouts,
    profile,
    setProfile,
    place,
    levels,
    setLevels,
    hidden,
    setHidden,
    active,
    setActive,
    ...derived,
  };
}

export type Fit = ReturnType<typeof useFit>;

/** Готовый комплекс → тренировка для плеера. */
export function routineWorkout(r: Routine): Workout {
  return {
    kind: r.kind,
    title: r.title,
    startedAt: 0,
    items: r.items.map(([ex, sec, reps]) => ({ ex, block: "main", plan: { sets: 1, sec, reps: reps ? [reps, reps] : undefined, rest: 0 }, sets: [{ done: false, sec }] })),
  };
}

