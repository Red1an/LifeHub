import { ExerciseMeta, findExercise } from "../data/exercises";
import type { StatsMap } from "./train-stats";

export interface PlanItem {
  exercise: ExerciseMeta;
  reason: string;
}

function seeded(seedText: string) {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

/** Recent average; exercises never tried count as fairly weak so they come up. */
function weakness(stats: StatsMap, id: string): number {
  const history = stats[id]?.history ?? [];
  if (!history.length) return 55;
  const recent = history.slice(-3);
  return 100 - recent.reduce((s, p) => s + p.score, 0) / recent.length;
}

/**
 * A ~30-minute session, stable for the whole day: warm up the hands, one
 * rhythm drill, the weakest ear/picking skill, improvisation, neck knowledge,
 * and two vocal blocks. Slots rotate day to day; weak skills come up more.
 */
export function buildDailyPlan(stats: StatsMap, day: string): PlanItem[] {
  const rand = seeded(day);
  const pick = (ids: string[]) => ids[Math.floor(rand() * ids.length)];
  const weakest = (ids: string[]) =>
    [...ids].sort((a, b) => weakness(stats, b) - weakness(stats, a) || rand() - 0.5)[0];

  const slots: { id: string; reason: string }[] = [
    { id: pick(["chord-changes", "fingerstyle", "chord-check"]), reason: "разогрев рук" },
    { id: pick(["rhythm-mic", "speed", "rhythm-reading"]), reason: "ритм и техника" },
    { id: weakest(["intervals", "chords-ear", "progressions", "key-finder"]), reason: "слабое место — слух" },
    { id: pick(["jam", "call-response"]), reason: "импровизация" },
    { id: pick(["fretboard", "caged", "scales", "bend"]), reason: "знание грифа" },
    { id: "warmup", reason: "распевка перед вокалом" },
    { id: weakest(["pitch-match", "pitch-graph", "sustain", "sing-interval", "harmony", "breath"]), reason: "слабое место — голос" },
  ];

  const seen = new Set<string>();
  return slots.flatMap(({ id, reason }) => {
    const exercise = findExercise(id);
    if (!exercise || seen.has(id)) return [];
    seen.add(id);
    return [{ exercise, reason }];
  });
}
