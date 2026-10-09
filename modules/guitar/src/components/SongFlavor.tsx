import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@lifehub/sdk";
import { unlockAudio } from "@modules/audio";
import { playGuitarNote, strumChord } from "../lib/audio/guitar-synth";
import { bestShape, parseChord } from "../lib/chords";
import { bassMidi, bassWalks, isSpecial, originalShapes, variantsFor, type OriginalShape } from "../lib/embellish";
import { bpmAt, type Part } from "../lib/songsterr";
import { nameOf, playStrum, simplify, strumsFromPart, suggest, type Stroke, type StrumPattern } from "../lib/strum";
import { markPractice } from "../lib/train-stats";
import type { UgStrum } from "../lib/ug";
import { ChordDiagram } from "./ChordDiagram";
import { Panel, Section } from "./kit";

/* ───────────── бой ───────────── */

interface Option {
  id: string;
  source: string;
  pattern: StrumPattern;
  tip?: string;
}

function fromUg(s: UgStrum): StrumPattern {
  const step = 1 / (s.denominator || 8);
  const strokes: Stroke[] = s.pattern.flatMap((c, i) => (c === "-" ? [] : [{ at: i * step, dir: c === "U" ? ("U" as const) : ("D" as const), mute: false }])).filter((x) => x.at < 1);
  return { name: nameOf(strokes, [4, 4]), sig: [4, 4], strokes };
}

/** Сетка ударов: стрелки по шестнадцатым или восьмым, текущий удар подсвечен. */
export function StrumGrid({ pattern, active }: { pattern: StrumPattern; active: number | null }) {
  const sixteenths = pattern.strokes.some((s) => Math.round(s.at * 16) % 2 === 1);
  const step = sixteenths ? 1 / 16 : 1 / 8;
  const cells = Math.round((pattern.sig[0] / pattern.sig[1]) / step);
  const perBeat = sixteenths ? 4 : 2;
  const count = sixteenths ? ["", "и", "", "а"] : ["", "и"];
  return (
    <div className="flex flex-wrap gap-y-2">
      {Array.from({ length: cells }).map((_, i) => {
        const si = pattern.strokes.findIndex((s) => Math.abs(s.at - i * step) < 1e-6);
        const s = si >= 0 ? pattern.strokes[si] : null;
        const beat = i % perBeat === 0;
        return (
          <div key={i} className={cn("flex flex-col items-center", beat && i > 0 && "ml-1.5")}>
            <span
              className={cn(
                "gt-num grid h-11 place-items-center rounded-lg text-xl font-bold transition",
                sixteenths ? "w-6" : "w-8",
                !s ? "text-[var(--gt-line)]" : s.mute ? "bg-[var(--gt-red)]/15 text-[var(--gt-red)]" : s.dir === "D" ? "bg-[var(--gt-brass)]/15 text-[var(--gt-brass)]" : "bg-[var(--gt-sky)]/15 text-[var(--gt-sky)]",
                si >= 0 && si === active && "scale-110 ring-2 ring-[var(--gt-fg)]",
              )}
            >
              {!s ? "·" : s.mute ? "✕" : s.dir === "D" ? "↓" : "↑"}
            </span>
            <span className="mt-0.5 text-[10px] text-[var(--gt-muted)]">{beat ? i / perBeat + 1 : count[i % perBeat]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StrumSection({ part, loading, ugStrums, progression }: { part: Part | null; loading: boolean; ugStrums: UgStrum[]; progression: string[] }) {
  const songBpm = part ? Math.round(bpmAt(part, 0)) : ugStrums.find((s) => s.bpm)?.bpm ?? null;
  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    if (part) for (const s of strumsFromPart(part)) out.push({ id: `o-${s.label}`, source: `в оригинале · ${s.label}`, pattern: s.pattern });
    ugStrums.slice(0, 3).forEach((s, i) => out.push({ id: `u-${i}`, source: `от автора таба${s.part ? ` · ${s.part}` : ""}`, pattern: fromUg(s) }));
    const sig: [number, number] = out[0]?.pattern.sig ?? [4, 4];
    for (const l of suggest(songBpm, sig).slice(0, out.length ? 2 : 4)) out.push({ id: `l-${l.id}`, source: out.length ? "попроще" : "подходит по темпу", pattern: l, tip: l.tip });
    return out;
  }, [part, ugStrums, songBpm]);

  const [sel, setSel] = useState(0);
  const [simple, setSimple] = useState(false);
  const [bpm, setBpm] = useState<number>(songBpm ?? 90);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState<{ bar: number; stroke: number } | null>(null);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (songBpm) setBpm(songBpm);
  }, [songBpm]);
  useEffect(() => setSel(0), [options.length]);

  const opt = options[Math.min(sel, options.length - 1)];
  const has16 = !!opt && opt.pattern.strokes.some((s) => Math.round(s.at * 16) % 2 === 1);
  const pattern: StrumPattern | null = opt ? (simple && has16 ? { ...opt.pattern, strokes: simplify(opt.pattern.strokes), name: nameOf(simplify(opt.pattern.strokes), opt.pattern.sig) } : opt.pattern) : null;
  const chords = progression.length ? progression : ["Am"];

  const stop = () => {
    stopRef.current();
    setPlaying(false);
    setStep(null);
  };
  const play = async () => {
    if (!pattern) return;
    stop();
    await unlockAudio();
    markPractice("strum");
    stopRef.current = playStrum({ chords, pattern, bpm, click: false, onStep: (bar, stroke) => setStep({ bar, stroke }) });
    setPlaying(true);
  };
  useEffect(() => {
    if (playing) void play();
  }, [bpm, simple, sel]);
  useEffect(() => () => stopRef.current(), []);

  if (loading && !options.length) return <Panel className="text-sm text-[var(--gt-muted)]">Ищу бой из оригинала…</Panel>;
  if (!pattern) return null;
  return (
    <Panel>
      <div className="gt-scroll-x mb-3">
        {options.map((o, i) => (
          <button key={o.id} data-on={i === sel} onClick={() => setSel(i)} className="gt-chip !min-h-9 shrink-0 !flex-col !items-start !gap-0 !py-1 text-left text-xs">
            <span className="font-bold">{o.pattern.name}</span>
            <span className="text-[10px] opacity-70">{o.source}</span>
          </button>
        ))}
      </div>
      <StrumGrid pattern={pattern} active={step?.stroke ?? null} />
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--gt-muted)]">
        <span><b className="text-[var(--gt-brass)]">↓</b> вниз</span>
        <span><b className="text-[var(--gt-sky)]">↑</b> вверх</span>
        <span><b className="text-[var(--gt-red)]">✕</b> с глушением (ребром ладони)</span>
        <span>· — рука проходит мимо, но не останавливается</span>
      </div>
      {opt.tip && <div className="mt-2 text-sm text-[var(--gt-muted)]">{opt.tip}</div>}
      {has16 && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} className="accent-[var(--gt-brass)]" />
          Упростить (только восьмые) — для начала
        </label>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button className={cn("gt-btn shrink-0", playing ? "gt-btn-ghost" : "gt-btn-brass")} onClick={() => (playing ? stop() : play())}>
          {playing ? "⏹ Стоп" : "▶ Играть с аккордами"}
        </button>
        <label className="min-w-0 flex-1 text-xs">
          <span className="text-[var(--gt-muted)]">темп </span>
          <b className="gt-num">{bpm}</b>
          {songBpm && bpm !== songBpm && <span className="text-[var(--gt-muted)]"> (в оригинале {songBpm})</span>}
          <input type="range" min={40} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[var(--gt-brass)]" />
        </label>
      </div>
      {playing && step && (
        <div className="mt-2 text-sm">
          Аккорд: <b className="text-[var(--gt-brass)]">{chords[step.bar % chords.length]}</b>
          <span className="text-[var(--gt-muted)]"> → {chords[(step.bar + 1) % chords.length]}</span>
        </div>
      )}
    </Panel>
  );
}

/* ───────────── фишки ───────────── */

async function playFrets(frets: number[], delay = 0) {
  await unlockAudio();
  strumChord(frets, { when: delay, gain: 0.55 });
}

function OriginalCard({ s, plain }: { s: OriginalShape; plain: string | null }) {
  return (
    <div className="gt-panel flex flex-col items-center !rounded-2xl p-2 text-center">
      <button onClick={() => playFrets(s.frets)} aria-label={`Сыграть ${s.name}`}>
        <ChordDiagram chord={s.name} shape={s.shape} size={92} />
      </button>
      {plain && plain !== s.name && <div className="text-[11px] text-[var(--gt-muted)]">вместо {plain}</div>}
      <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--gt-muted)]">{s.where.join(", ")}</div>
      {plain && (
        <button
          className="mt-1 text-[11px] text-[var(--gt-brass)]"
          onClick={async () => {
            const base = bestShape(plain);
            if (base) await playFrets(base.frets);
            await playFrets(s.frets, 1.1);
          }}
        >
          ▶ сравнить
        </button>
      )}
    </div>
  );
}

export function TricksSection({ chords, progression, keyName, part }: { chords: string[]; progression: string[]; keyName: string | null; part: Part | null }) {
  const originals = useMemo(() => (part ? originalShapes(part).filter(isSpecial) : []), [part]);
  const [openChord, setOpenChord] = useState<string | null>(null);
  const [pick, setPick] = useState<number>(0);
  const walks = useMemo(() => bassWalks(progression, keyName), [progression, keyName]);
  const list = chords.slice(0, 8);
  const cur = openChord ?? list[0] ?? null;
  const variants = useMemo(() => (cur ? variantsFor(cur) : []), [cur]);
  useEffect(() => setPick(0), [cur]);
  const plainFor = (s: OriginalShape) => {
    const r = parseChord(s.name)?.root;
    return chords.find((c) => parseChord(c)?.root === r) ?? null;
  };
  // Совпадает ли тональность выбранной версии с оригиналом: большинство аккордов оригинала есть в песне.
  const sameKey = originals.filter((s) => plainFor(s)).length >= originals.length / 2;

  return (
    <>
      {originals.length > 0 && (
        <Section title="Как играют в оригинале">
          <div className="mb-2 text-sm text-[var(--gt-muted)]">
            Аппликатуры из ритм-партии: гитарист добавляет или меняет ноты — отсюда «тот самый» звук.
            {!sameKey && " Оригинал в другой тональности — сравнивай по названиям."}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {originals.map((s) => (
              <OriginalCard key={s.frets.join()} s={s} plain={sameKey ? plainFor(s) : null} />
            ))}
          </div>
        </Section>
      )}

      {cur && (
        <Section title="Украшения аккордов">
          <div className="mb-2 text-sm text-[var(--gt-muted)]">Соседние аккорды в один-два пальца от основной формы. Чередуй их с основным внутри такта — так звучат «прикольные штуки» из разборов.</div>
          <div className="gt-scroll-x mb-3">
            {list.map((c) => (
              <button key={c} data-on={c === cur} onClick={() => setOpenChord(c)} className="gt-chip !min-h-8 shrink-0 text-xs">
                {c}
              </button>
            ))}
          </div>
          {variants.length === 0 ? (
            <Panel className="text-sm text-[var(--gt-muted)]">Для этого аккорда простых украшений рядом нет.</Panel>
          ) : (
            <Panel>
              <div className="flex items-start gap-3 overflow-x-auto">
                <div className="shrink-0 text-center">
                  <ChordDiagram chord={cur} size={86} />
                  <div className="text-[10px] text-[var(--gt-muted)]">основной</div>
                </div>
                {variants.map((v, i) => (
                  <button key={v.name} onClick={() => setPick(i)} className={cn("shrink-0 rounded-xl p-1 text-center transition", i === pick ? "bg-[var(--gt-brass)]/15 ring-1 ring-[var(--gt-brass)]" : "opacity-80")}>
                    <ChordDiagram chord={v.name} shape={v.shape} size={86} />
                    <div className="text-[10px] text-[var(--gt-muted)]">{v.moves <= 1 ? "1 палец" : `${v.moves} пальца`}</div>
                  </button>
                ))}
              </div>
              {variants[pick] && (
                <div className="mt-3">
                  <div className="text-sm">
                    <b className="text-[var(--gt-brass)]">{variants[pick].name}</b> — {variants[pick].how}
                  </div>
                  <button
                    className="gt-btn gt-btn-ghost mt-2 !min-h-9 text-sm"
                    onClick={async () => {
                      const base = bestShape(cur);
                      if (!base) return;
                      await playFrets(base.frets);
                      await playFrets(variants[pick].shape.frets, 0.9);
                      await playFrets(base.frets, 1.8);
                    }}
                  >
                    ▶ {cur} → {variants[pick].name} → {cur}
                  </button>
                </div>
              )}
            </Panel>
          )}
        </Section>
      )}

      {walks.length > 0 && (
        <Section title="Басовые переходы">
          <div className="mb-2 text-sm text-[var(--gt-muted)]">На последнюю долю перед сменой аккорда сыграй басом проходящие ноты — переход станет «живым».</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {walks.map((w) => (
              <Panel key={`${w.from}-${w.to}`} className="!p-3">
                <div className="mb-1 flex items-center justify-between">
                  <b>
                    {w.from} → {w.to}
                  </b>
                  <button
                    className="text-xs text-[var(--gt-brass)]"
                    onClick={async () => {
                      await unlockAudio();
                      const from = bestShape(w.from);
                      const to = bestShape(w.to);
                      if (from) strumChord(from.frets, { gain: 0.45 });
                      w.notes.slice(1, -1).forEach((n, i) => playGuitarNote(bassMidi(n), { when: 0.8 + i * 0.33, gain: 0.7, duration: 0.3 }));
                      if (to) strumChord(to.frets, { when: 0.8 + (w.notes.length - 2) * 0.33, gain: 0.5 });
                    }}
                  >
                    ▶ послушать
                  </button>
                </div>
                <BassTab notes={w.notes} />
              </Panel>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function BassTab({ notes }: { notes: { string: number; fret: number; name: string }[] }) {
  const strings = [2, 1, 0].filter((s) => notes.some((n) => n.string === s) || s < 2);
  const label = ["E", "A", "D"];
  return (
    <div className="gt-mono overflow-x-auto text-xs leading-5">
      {strings.map((s) => (
        <div key={s} className="whitespace-pre">
          <span className="text-[var(--gt-muted)]">{label[s]}|</span>
          {notes.map((n, i) => (
            <span key={i}>{n.string === s ? <b className={i === 0 || i === notes.length - 1 ? "text-[var(--gt-muted)]" : "text-[var(--gt-copper)]"}>{String(n.fret).padEnd(2, "-")}</b> : "--"}-</span>
          ))}
          |
        </div>
      ))}
      <div className="mt-1 text-[var(--gt-muted)]">{notes.map((n) => n.name).join(" → ")}</div>
    </div>
  );
}

