import { useEffect, useRef, useState } from "react";
import { cn, Link } from "@lifehub/sdk";
import { unlockAudio } from "@modules/audio";
import { startBacking } from "../lib/audio/backing";
import { bestShape } from "../lib/chords";
import { markPractice } from "../lib/train-stats";
import type { UgStrum } from "../lib/ug";
import { ChordDiagram } from "./ChordDiagram";
import { Btn, Panel, Section } from "./kit";

/** Играть вместе с аккомпанементом на аккордах песни (по такту на аккорд). */
export function PlayAlong({ chords, songId }: { chords: string[]; songId: string }) {
  const [bpm, setBpm] = useState(80);
  const [bars, setBars] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [bar, setBar] = useState(-1);
  const [beat, setBeat] = useState(0);
  const player = useRef<{ stop: () => void } | null>(null);
  const seq = chords.flatMap((c) => Array.from({ length: bars }, () => c));

  useEffect(() => {
    if (!playing || !seq.length) return;
    const p = startBacking({ chords: seq, bpm, loop: true, countIn: true, click: true, volume: 0.8, onBar: setBar, onBeat: setBeat });
    player.current = p;
    return () => p.stop();
  }, [playing, bpm, bars, chords.join()]);
  useEffect(() => () => player.current?.stop(), []);

  const idx = bar < 0 ? 0 : Math.floor(bar / bars) % chords.length;
  const cur = chords[idx];
  const next = chords[(idx + 1) % chords.length];

  if (!chords.length) return <div className="text-sm text-[var(--gt-muted)]">В песне не нашлось аккордов.</div>;
  return (
    <div>
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-[var(--gt-muted)]">{bar < 0 && playing ? "отсчёт" : "сейчас"}</div>
          <ChordDiagram chord={cur} shape={bestShape(cur)} size={120} />
        </div>
        <div className="text-center opacity-60">
          <div className="text-xs uppercase tracking-wider text-[var(--gt-muted)]">дальше</div>
          <ChordDiagram chord={next} shape={bestShape(next)} size={84} />
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-2">
        {[0, 1, 2, 3].map((b) => (
          <span key={b} className={cn("size-3 rounded-full transition", playing && beat === b ? (b === 0 ? "bg-[var(--gt-brass)]" : "bg-[var(--gt-fg)]") : "bg-[var(--gt-line)]")} />
        ))}
      </div>
      <div className="gt-scroll-x mt-4 justify-center">
        {chords.map((c, i) => (
          <span key={i} className={cn("rounded-lg px-2.5 py-1 text-sm font-bold", i === idx && playing ? "bg-[var(--gt-brass)] text-black" : "bg-[var(--gt-panel-2)]")}>
            {c}
          </span>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-[var(--gt-muted)]">Темп: </span>
          <b className="gt-num">{bpm}</b>
          <input type="range" min={50} max={150} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="mt-1 w-full accent-[var(--gt-brass)]" />
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--gt-muted)]">Тактов на аккорд:</span>
          {[1, 2].map((n) => (
            <button key={n} data-on={bars === n} onClick={() => setBars(n)} className="gt-chip !min-h-8">
              {n}
            </button>
          ))}
        </div>
      </div>
      <Btn
        block
        className="mt-4"
        tone={playing ? "ghost" : "brass"}
        onClick={async () => {
          if (!playing) {
            await unlockAudio();
            markPractice(`song:${songId}`);
          }
          setBar(-1);
          setPlaying(!playing);
        }}
      >
        {playing ? "⏹ Стоп" : "▶ Играть вместе"}
      </Btn>
    </div>
  );
}

const ARROW: Record<string, string> = { D: "↓", U: "↑", "-": "·" };

/** Схема боя: стрелки по восьмым. */
export function StrumView({ strums }: { strums: UgStrum[] }) {
  return (
    <div className="space-y-3">
      {strums.slice(0, 4).map((s, i) => (
        <div key={i}>
          <div className="mb-1 text-xs text-[var(--gt-muted)]">
            {s.part || "Бой"}
            {s.bpm ? ` · ${s.bpm} BPM` : ""}
          </div>
          <div className="flex flex-wrap gap-1">
            {s.pattern.slice(0, 16).map((p, j) => (
              <span key={j} className={cn("gt-num grid h-10 w-7 place-items-center rounded-md text-xl font-bold", p === "-" ? "text-[var(--gt-line)]" : p === "D" ? "bg-[var(--gt-brass)]/15 text-[var(--gt-brass)]" : "bg-[var(--gt-sky)]/15 text-[var(--gt-sky)]", j % 2 === 0 && "ring-1 ring-[var(--gt-line)]")}>
                {ARROW[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const COMMON_STRUMS: UgStrum[] = [
  { part: "Шестёрка — универсальный бой (4/4)", bpm: 0, denominator: 8, pattern: ["D", "-", "D", "U", "-", "U", "D", "U"] },
  { part: "Ровные восьмые — для быстрых песен", bpm: 0, denominator: 8, pattern: ["D", "U", "D", "U", "D", "U", "D", "U"] },
  { part: "Вальс (3/4)", bpm: 0, denominator: 8, pattern: ["D", "-", "D", "U", "D", "U"] },
];

const CHECKS = [
  { id: "chords", label: "Выучил все аккорды песни" },
  { id: "changes", label: "Меняю их в темпе без остановок" },
  { id: "strum", label: "Играю бой или перебор" },
  { id: "verse", label: "Куплет и припев с текстом" },
  { id: "full", label: "Песня целиком от начала до конца" },
];

/** Чек-лист разучивания песни. */
export function SongChecklist({ done, onToggle }: { done: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-1">
      {CHECKS.map((c, i) => {
        const on = done.includes(c.id);
        return (
          <button key={c.id} onClick={() => onToggle(c.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--gt-panel-2)]">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", on ? "bg-[var(--gt-green)] text-black" : "border border-[var(--gt-line)] text-[var(--gt-muted)]")}>{on ? "✓" : i + 1}</span>
            <span className={cn("text-sm", on && "text-[var(--gt-muted)] line-through")}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
export const CHECK_COUNT = CHECKS.length;

/** Вкладка «Практика» песни. */
export function SongPracticeTab({
  songId,
  chords,
  progression,
  keyName,
  strums,
  checks,
  onToggleCheck,
  onEar,
}: {
  songId: string;
  chords: string[];
  progression: string[];
  keyName: string | null;
  strums: UgStrum[];
  checks: string[];
  onToggleCheck: (id: string) => void;
  onEar: () => void;
}) {
  const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
  return (
    <div>
      <Section title="Разучить песню" className="!mt-0">
        <Panel>
          <SongChecklist done={checks} onToggle={onToggleCheck} />
        </Panel>
      </Section>

      <Section title="Играть вместе">
        <Panel>
          <div className="mb-3 text-sm text-[var(--gt-muted)]">Гитара-аккомпанемент играет основной ход песни — играй вместе, держи смену аккордов в ритме.</div>
          <PlayAlong chords={progression} songId={songId} />
        </Panel>
      </Section>

      <Section title="Бой">
        <Panel>
          {strums.length ? (
            <StrumView strums={strums} />
          ) : (
            <>
              <div className="mb-3 text-sm text-[var(--gt-muted)]">Автор не указал бой. Начни с одного из этих — и подстрой под оригинал на слух.</div>
              <StrumView strums={COMMON_STRUMS} />
            </>
          )}
        </Panel>
      </Section>

      <Section title="Упражнения под песню">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to={`/train/chord-changes${q({ chords: chords.slice(0, 8).join(",") })}`} className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">🤘</div>
            <div className="mt-1 font-bold">Смена аккордов песни</div>
            <div className="text-sm text-[var(--gt-muted)]">Тренажёр смены на аккордах {chords.slice(0, 5).join(" ")}{chords.length > 5 ? "…" : ""}</div>
          </Link>
          <Link to={`/train/jam${q({ chords: progression.join(","), key: keyName ?? "" })}`} className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">🔥</div>
            <div className="mt-1 font-bold">Импровизация под песню</div>
            <div className="text-sm text-[var(--gt-muted)]">Джем на ходе песни{keyName ? ` в ${keyName}` : ""}: гриф подсвечивает ноты гаммы и аккорда</div>
          </Link>
          <button onClick={onEar} className="gt-panel block p-4 text-left transition hover:-translate-y-0.5">
            <div className="text-2xl">🙈</div>
            <div className="mt-1 font-bold">Подобрать на слух</div>
            <div className="text-sm text-[var(--gt-muted)]">Аккорды скроются — подбирай по оригиналу и открывай по одному для проверки</div>
          </button>
          <Link to="/train/chord-check" className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">✅</div>
            <div className="mt-1 font-bold">Чистота аккордов</div>
            <div className="text-sm text-[var(--gt-muted)]">Микрофон проверит, звучат ли все струны</div>
          </Link>
        </div>
      </Section>
    </div>
  );
}
