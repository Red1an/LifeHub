// Matches played note onsets against the beats they were meant to land on.
// Pure logic so it can be tested outside the browser.

export interface Onset {
  time: number; // seconds, audio clock
  strength: number; // detector peak height
}

export interface OnsetMatch {
  expected: number;
  onset: number | null;
  errorMs: number | null; // positive = late
}

export interface TimingSummary {
  matches: OnsetMatch[];
  hits: number;
  missed: number;
  extra: number;
  meanMs: number; // signed: >0 dragging, <0 rushing
  spreadMs: number; // standard deviation — consistency
  good: number;
  score: number; // 0..100
}

/**
 * Collapses candidates within `gap` of a cluster's first candidate into one
 * event: a strum hits six strings over ~60 ms and must count as one note.
 * Clusters are anchored at their start rather than chained, or a run of faint
 * ring-out peaks ~50 ms apart would glue neighbouring notes together.
 *
 * The event takes the time of its earliest reasonably strong candidate — the
 * first string of a strum, not a faint bump just before it — and the strength
 * of its strongest one.
 */
export function mergeOnsets(onsets: Onset[], gap = 0.06): Onset[] {
  const sorted = [...onsets].sort((a, b) => a.time - b.time);
  const clusters: Onset[][] = [];
  for (const onset of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && onset.time - last[0].time < gap) last.push(onset);
    else clusters.push([onset]);
  }
  return clusters.map((cluster) => {
    const strongest = Math.max(...cluster.map((o) => o.strength));
    const first = cluster.find((o) => o.strength >= strongest * 0.4) ?? cluster[0];
    return { time: first.time, strength: strongest };
  });
}

/**
 * Matches each expected beat to a played onset within `window` seconds.
 *
 * The detector runs with a low threshold, so ring-out and string beating
 * leave faint candidates between notes. An unmatched onset only counts as an
 * extra note when it is nearly as strong as the notes that landed on beats —
 * under-reporting an extra note is better than punishing ring-out.
 */
export function analyzeTiming(
  expected: number[],
  rawOnsets: Onset[],
  window: number,
  goodMs = 40
): TimingSummary {
  // Raw strength depends heavily on what was sounding before: a note out of
  // silence scores ~25, the same note over a still-ringing one ~2-5. Comparing
  // on a log scale keeps real notes of both kinds well above ring-out noise.
  const merged = mergeOnsets(rawOnsets, Math.min(0.05, window * 0.8)).map((o) => ({
    time: o.time,
    strength: Math.log1p(o.strength),
  }));

  // Typical note strength: the strongest candidate near each beat. Candidates
  // far weaker than that are ring-out noise, not notes — without this filter a
  // faint bump close to the beat would beat a genuinely late note to the match.
  const nearBeat = expected
    .map((time) =>
      Math.max(0, ...merged.filter((o) => Math.abs(o.time - time) <= window).map((o) => o.strength))
    )
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const typical = nearBeat.length ? nearBeat[nearBeat.length >> 1] : 0;
  const onsets = merged.filter((o) => o.strength >= typical * 0.25);

  // For each beat take the strongest candidate in its window — a real note,
  // even a late one, almost always out-muscles nearby ring-out noise. Only
  // when several candidates are comparably strong does proximity decide.
  const expectedTaken = new Array<number>(expected.length).fill(-1);
  const onsetTaken = new Array<boolean>(onsets.length).fill(false);
  expected.forEach((time, e) => {
    const inWindow = onsets
      .map((onset, o) => ({ onset, o }))
      .filter(({ onset, o }) => !onsetTaken[o] && Math.abs(onset.time - time) <= window);
    if (inWindow.length === 0) return;
    const strongest = Math.max(...inWindow.map(({ onset }) => onset.strength));
    const pick = inWindow
      .filter(({ onset }) => onset.strength >= strongest * 0.6)
      .sort((a, b) => Math.abs(a.onset.time - time) - Math.abs(b.onset.time - time))[0];
    expectedTaken[e] = pick.o;
    onsetTaken[pick.o] = true;
  });

  const matches: OnsetMatch[] = expected.map((time, e) => {
    const o = expectedTaken[e];
    if (o < 0) return { expected: time, onset: null, errorMs: null };
    return { expected: time, onset: onsets[o].time, errorMs: (onsets[o].time - time) * 1000 };
  });

  const matchedStrengths = expectedTaken
    .filter((o) => o >= 0)
    .map((o) => onsets[o].strength)
    .sort((a, b) => a - b);
  const typicalStrength = matchedStrengths.length
    ? matchedStrengths[matchedStrengths.length >> 1]
    : 0;

  const errors = matches.flatMap((m) => (m.errorMs === null ? [] : [m.errorMs]));
  const span = expected.length
    ? [Math.min(...expected) - window, Math.max(...expected) + window]
    : [0, 0];
  const matchedTimes = expectedTaken.filter((o) => o >= 0).map((o) => onsets[o].time);
  const extra = onsets.filter(
    (onset, o) =>
      !onsetTaken[o] &&
      onset.time >= span[0] &&
      onset.time <= span[1] &&
      onset.strength >= typicalStrength * 0.6 &&
      // the tail of a strum or a double peak of the same note is not a new note
      matchedTimes.every((t) => Math.abs(t - onset.time) > 0.07)
  ).length;
  const meanMs = errors.length ? errors.reduce((s, v) => s + v, 0) / errors.length : 0;
  const spreadMs = errors.length
    ? Math.sqrt(errors.reduce((s, v) => s + (v - meanMs) ** 2, 0) / errors.length)
    : 0;
  const good = errors.filter((e) => Math.abs(e) <= goodMs).length;
  const score = expected.length
    ? Math.max(0, Math.round((100 * (good - 0.5 * extra)) / expected.length))
    : 0;

  return {
    matches,
    hits: errors.length,
    missed: expected.length - errors.length,
    extra,
    meanMs,
    spreadMs,
    good,
    score,
  };
}
