import { useCallback, useEffect, useRef, useState } from "react";
import { ExerciseShell, ScoreBadge } from "../../../components/train/ExerciseShell";
import { playBlip } from "@modules/audio";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { getAudioContext, unlockAudio } from "@modules/audio";
import { analyzeTiming, OnsetMatch } from "@modules/audio";
import { pickRandom } from "../../../lib/ear-training";
import { recordScore } from "../../../lib/train-stats";

type TokenKind = "q" | "h" | "r" | "ee" | "er" | "syn";

// Onsets are in beats from the token start.
const TOKENS: Record<TokenKind, { beats: number; onsets: number[] }> = {
  q: { beats: 1, onsets: [0] },
  h: { beats: 2, onsets: [0] },
  r: { beats: 1, onsets: [] },
  ee: { beats: 1, onsets: [0, 0.5] },
  er: { beats: 1, onsets: [0.5] },
  syn: { beats: 2, onsets: [0, 0.5, 1.5] },
};

const LEVELS = [
  { id: "easy", label: "Четверти и паузы", kinds: ["q", "q", "h", "r"] as TokenKind[] },
  { id: "mid", label: "+ восьмые", kinds: ["q", "h", "r", "ee", "ee"] as TokenKind[] },
  { id: "hard", label: "+ синкопы", kinds: ["q", "r", "ee", "er", "syn", "syn"] as TokenKind[] },
];

const ROUNDS = 8;
const BPM = 80;
const BARS = 2;

function makeBar(kinds: TokenKind[]): TokenKind[] {
  for (;;) {
    const bar: TokenKind[] = [];
    let beats = 0;
    while (beats < 4) {
      const options = kinds.filter((k) => TOKENS[k].beats <= 4 - beats);
      const kind = pickRandom(options);
      bar.push(kind);
      beats += TOKENS[kind].beats;
    }
    // A bar of only rests is not worth tapping.
    if (bar.some((k) => TOKENS[k].onsets.length)) return bar;
  }
}

function onsetBeats(bars: TokenKind[][]): number[] {
  const out: number[] = [];
  bars.forEach((bar, b) => {
    let beat = b * 4;
    for (const kind of bar) {
      TOKENS[kind].onsets.forEach((o) => out.push(beat + o));
      beat += TOKENS[kind].beats;
    }
  });
  return out;
}

const BEAT_W = 56;

function Glyph({ kind, x, colors }: { kind: TokenKind; x: number; colors: string[] }) {
  const head = (cx: number, color: string, hollow = false) => (
    <g>
      <ellipse cx={cx} cy={44} rx={7} ry={5} transform={`rotate(-20 ${cx} 44)`} fill={hollow ? "none" : color} stroke={color} strokeWidth={hollow ? 2 : 0} />
      <line x1={cx + 6} x2={cx + 6} y1={42} y2={12} stroke={color} strokeWidth={1.8} />
    </g>
  );
  const flag = (cx: number, color: string) => <path d={`M${cx + 6} 12 q 10 8 6 20`} fill="none" stroke={color} strokeWidth={1.8} />;
  const quarterRest = (cx: number) => <path d={`M${cx} 22 l6 8 l-6 6 l6 8 q-8 -2 -4 6`} fill="none" className="stroke-zinc-500" strokeWidth={2} />;
  const eighthRest = (cx: number) => (
    <g className="stroke-zinc-500 fill-zinc-500">
      <circle cx={cx} cy={30} r={2.5} />
      <line x1={cx} y1={30} x2={cx + 7} y2={28} strokeWidth={1.8} />
      <line x1={cx + 7} y1={28} x2={cx + 2} y2={46} strokeWidth={1.8} />
    </g>
  );
  const c = (i: number) => colors[i] ?? "currentColor";
  switch (kind) {
    case "q":
      return head(x + 10, c(0));
    case "h":
      return head(x + 10, c(0), true);
    case "r":
      return quarterRest(x + 12);
    case "ee":
      return (
        <g>
          {head(x + 6, c(0))}
          {head(x + 6 + BEAT_W / 2, c(1))}
          <line x1={x + 12} x2={x + 12 + BEAT_W / 2} y1={12} y2={12} stroke="currentColor" strokeWidth={4} />
        </g>
      );
    case "er":
      return (
        <g>
          {eighthRest(x + 6)}
          {head(x + 6 + BEAT_W / 2, c(0))}
          {flag(x + 6 + BEAT_W / 2, c(0))}
        </g>
      );
    case "syn":
      return (
        <g>
          {head(x + 6, c(0))}
          {flag(x + 6, c(0))}
          {head(x + 6 + BEAT_W / 2, c(1))}
          {head(x + 6 + BEAT_W * 1.5, c(2))}
          {flag(x + 6 + BEAT_W * 1.5, c(2))}
        </g>
      );
  }
}

function Notation({ bars, matches }: { bars: TokenKind[][]; matches: OnsetMatch[] | null }) {
  let onsetIndex = 0;
  const colorFor = (m?: OnsetMatch) =>
    !m ? "currentColor" : m.errorMs === null ? "#ef4444" : Math.abs(m.errorMs) <= 60 ? "#10b981" : "#f59e0b";
  const width = BARS * 4 * BEAT_W + 40;
  return (
    <svg viewBox={`0 0 ${width} 64`} className="w-full text-zinc-800 dark:text-zinc-100">
      <line x1={0} x2={width} y1={44} y2={44} className="stroke-zinc-300 dark:stroke-zinc-700" />
      {bars.map((bar, b) => {
        let beat = 0;
        const base = 20 + b * 4 * BEAT_W;
        return (
          <g key={b}>
            {b > 0 && <line x1={base - 6} x2={base - 6} y1={20} y2={54} className="stroke-zinc-400" />}
            {bar.map((kind, i) => {
              const x = base + beat * BEAT_W;
              beat += TOKENS[kind].beats;
              const colors = TOKENS[kind].onsets.map(() => colorFor(matches?.[onsetIndex++]));
              return <Glyph key={i} kind={kind} x={x} colors={colors} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

export default function RhythmReading() {
  const [level, setLevel] = useState(LEVELS[0]);
  const [bars, setBars] = useState<TokenKind[][]>([["q", "q", "q", "q"], ["h", "q", "r"]]);
  const [phase, setPhase] = useState<"idle" | "listen" | "countin" | "tapping" | "done">("idle");
  const [matches, setMatches] = useState<OnsetMatch[] | null>(null);
  const [stats, setStats] = useState({ score: 0, rounds: 0 });
  const tapsRef = useRef<{ time: number; strength: number }[]>([]);
  const armedRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random pattern is picked client-side
    setBars([makeBar(LEVELS[0].kinds), makeBar(LEVELS[0].kinds)]);
  }, []);

  const beatS = 60 / BPM;

  function listen() {
    void unlockAudio();
    setPhase("listen");
    for (let i = 0; i < BARS * 4; i++) playBlip(i % 4 === 0, 0.2 + i * beatS, 0.6);
    onsetBeats(bars).forEach((b) => playGuitarNote(45, { when: 0.2 + b * beatS, gain: 0.7, duration: 0.18 }));
    window.setTimeout(() => setPhase("idle"), (0.2 + BARS * 4 * beatS) * 1000);
  }

  const tap = useCallback(() => {
    if (!armedRef.current) return;
    tapsRef.current.push({ time: getAudioContext().currentTime, strength: 1 });
    playGuitarNote(45, { gain: 0.35, duration: 0.12 });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  async function perform() {
    await unlockAudio();
    const audio = getAudioContext();
    const start = audio.currentTime + 0.2 + 4 * beatS;
    for (let i = 0; i < 4 + BARS * 4; i++) playBlip(i % 4 === 0, 0.2 + i * beatS, i < 4 ? 1 : 0.5);
    tapsRef.current = [];
    armedRef.current = true;
    setMatches(null);
    setPhase("countin");
    window.setTimeout(() => setPhase("tapping"), (start - audio.currentTime - 0.2) * 1000);
    window.setTimeout(() => {
      armedRef.current = false;
      const expected = onsetBeats(bars).map((b) => start + b * beatS);
      const summary = analyzeTiming(expected, tapsRef.current, beatS * 0.25, 60);
      setMatches(summary.matches);
      setPhase("done");
      const nextStats = { score: stats.score + summary.score, rounds: stats.rounds + 1 };
      setStats(nextStats);
      if (nextStats.rounds === ROUNDS) recordScore("rhythm-reading", Math.round(nextStats.score / ROUNDS));
    }, (start - audio.currentTime + BARS * 4 * beatS + 0.3) * 1000);
  }

  function nextPattern(nextLevel = level) {
    setBars([makeBar(nextLevel.kinds), makeBar(nextLevel.kinds)]);
    setMatches(null);
    setPhase("idle");
  }

  function restart(nextLevel = level) {
    setLevel(nextLevel);
    setStats({ score: 0, rounds: 0 });
    nextPattern(nextLevel);
  }

  const busy = phase === "listen" || phase === "countin" || phase === "tapping";
  const finished = stats.rounds >= ROUNDS;
  const lastScore = matches ? Math.round((matches.filter((m) => m.errorMs !== null && Math.abs(m.errorMs) <= 60).length / matches.length) * 100) : null;

  return (
    <ExerciseShell
      title="Чтение ритма"
      description="Прочитай ритм по нотам и простучи его после отсчёта — кнопкой или пробелом. Зелёные ноты попали, жёлтые неточные, красные пропущены."
      accent="amber"
      aside={<ScoreBadge correct={stats.rounds} total={ROUNDS} label="Ритмов" />}
    >
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((item) => (
          <button key={item.id} onClick={() => restart(item)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${level.id === item.id ? "bg-amber-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {finished ? (
        <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <div className="text-5xl font-bold text-amber-500">{Math.round(stats.score / ROUNDS)}%</div>
          <p className="text-sm text-zinc-500">Средняя точность за {ROUNDS} ритмов</p>
          <button onClick={() => restart()} className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white">Ещё раунд</button>
        </div>
      ) : (
        <>
          <div className="my-4 overflow-x-auto rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="min-w-[480px]">
              <Notation bars={bars} matches={matches} />
            </div>
          </div>

          <button
            onPointerDown={tap}
            disabled={phase !== "countin" && phase !== "tapping"}
            className="mb-4 w-full rounded-3xl bg-amber-500 py-14 text-2xl font-bold text-white transition-transform active:scale-[0.98] disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800"
          >
            {phase === "countin" ? "Раз, два, три, четыре…" : phase === "tapping" ? "СТУЧИ" : "Кнопка для ритма"}
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={listen} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800">▶ Послушать</button>
            <button onClick={perform} disabled={busy} className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">🥁 Простучать</button>
            {phase === "done" && (
              <>
                <span className="text-sm">Точность: <b>{lastScore}%</b></span>
                <button onClick={() => nextPattern()} className="ml-auto rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white">Следующий ритм →</button>
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Считай вслух «раз-и-два-и». Восьмые — это «раз» и «и» внутри одной доли; синкопа начинается на «и» и тянется через сильную долю.
          </p>
        </>
      )}
    </ExerciseShell>
  );
}
