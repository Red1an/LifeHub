import { useMemo, useState } from "react";
import { cn, useSearchParams } from "@lifehub/sdk";
import { unlockAudio } from "@modules/audio";
import { ChordCard } from "../components/ChordCard";
import { ChordDiagram } from "../components/ChordDiagram";
import { Header, Panel, Screen, Section, Segments } from "../components/kit";
import { strumChord } from "../lib/audio/guitar-synth";
import { identify, parseChord, ROOTS, SUFFIX_GROUPS, voicings } from "../lib/chords";
import { SHARP_NOTES, GUITAR_OPEN_STRINGS_MIDI } from "../lib/music-theory";

const SUFFIX_LABEL: Record<string, string> = { "": "мажор", m: "минор" };

export function ChordsPage() {
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<"find" | "name">("find");
  const [query, setQuery] = useState(params.get("c") ?? "Am");
  const parsed = parseChord(query);
  const [root, setRoot] = useState(parsed?.rootName ?? "A");
  const [suffix, setSuffix] = useState(parsed?.suffix ?? "m");

  const pick = (r: string, s: string) => {
    setRoot(r);
    setSuffix(s);
    setQuery(r + s);
    setParams({ c: r + s });
  };
  const valid = !!parsed;

  return (
    <Screen>
      <Header title="Аккорды" subtitle="Любой аккорд — все аппликатуры по грифу, ноты и звук. Или наоборот: зажми лады — узнай аккорд." />
      <Segments
        value={mode}
        onChange={setMode}
        className="mb-4"
        items={[
          { id: "find", label: "🔎 Найти аккорд" },
          { id: "name", label: "🤔 Что за аккорд?" },
        ]}
      />

      {mode === "find" ? (
        <>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              const p = parseChord(e.target.value);
              if (p) {
                setRoot(p.rootName);
                setSuffix(p.suffix);
                setParams({ c: e.target.value });
              }
            }}
            placeholder="Например: F#m7, Hm, Dsus4, G/B"
            className="gt-input gt-mono text-lg"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Panel className="mt-4">
            {valid ? (
              <>
                <div className="gt-display mb-2 text-center text-4xl font-bold text-[var(--gt-brass)]">{parsed!.name}</div>
                <ChordCard chord={query.trim()} size={180} />
              </>
            ) : (
              <div className="py-8 text-center text-sm text-[var(--gt-muted)]">Не понимаю такое обозначение. Начни с ноты: C, D, E, F, G, A, B (или H).</div>
            )}
          </Panel>

          {valid && <AllVoicings chord={query.trim()} />}

          <Section title="Выбрать">
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {ROOTS.map((r) => (
                <button key={r} onClick={() => pick(r, suffix)} className={cn("gt-btn !min-h-10 !rounded-xl !px-0 text-sm", r === root ? "gt-btn-brass" : "gt-btn-ghost")}>
                  {r}
                </button>
              ))}
            </div>
            {SUFFIX_GROUPS.map((g) => (
              <div key={g.title} className="mt-3">
                <div className="mb-1.5 text-xs text-[var(--gt-muted)]">{g.title}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((s) => (
                    <button key={s} data-on={s === suffix} onClick={() => pick(root, s)} className="gt-chip !min-h-8 text-xs">
                      {root}
                      {s}
                      {SUFFIX_LABEL[s] ? <span className="opacity-60"> {SUFFIX_LABEL[s]}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Section>
        </>
      ) : (
        <ChordNamer />
      )}
    </Screen>
  );
}

function AllVoicings({ chord }: { chord: string }) {
  const list = useMemo(() => voicings(chord, 8), [chord]);
  if (list.length < 2) return null;
  return (
    <Section title="Все позиции на грифе">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {list.map((v, i) => (
          <button
            key={i}
            onClick={async () => {
              await unlockAudio();
              strumChord(v.frets, { gain: 0.6 });
            }}
            className="gt-panel flex flex-col items-center !rounded-2xl p-2 transition hover:-translate-y-0.5"
          >
            <ChordDiagram chord={chord} shape={v} size={86} label={false} />
            <span className="mt-1 text-[11px] text-[var(--gt-muted)]">{v.frets.map((f) => (f < 0 ? "x" : f)).join(" ")}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

const FRETS = 13;
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];

/** Гриф, на котором можно зажать лады и узнать название аккорда. */
function ChordNamer() {
  const [frets, setFrets] = useState<number[]>([-1, 3, 2, 0, 1, 0]);
  const names = identify(frets);
  const set = (s: number, f: number) => setFrets((cur) => cur.map((x, i) => (i === s ? (x === f ? (f === 0 ? -1 : 0) : f) : x)));

  return (
    <>
      <Panel className="!p-3">
        <div className="mb-2 text-sm text-[var(--gt-muted)]">Нажимай на лады. Повторное нажатие на «0» глушит струну.</div>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {[5, 4, 3, 2, 1, 0].map((s) => (
              <div key={s} className="flex items-center">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-[var(--gt-muted)]">{STRING_NAMES[s]}</span>
                {Array.from({ length: FRETS }).map((_, f) => {
                  const on = frets[s] === f;
                  const muted = frets[s] === -1 && f === 0;
                  const note = SHARP_NOTES[(GUITAR_OPEN_STRINGS_MIDI[s] + f) % 12];
                  return (
                    <button
                      key={f}
                      onClick={() => set(s, f)}
                      className={cn("relative grid h-9 flex-1 place-items-center border-r text-[11px]", f === 0 ? "border-r-4 border-[var(--gt-fg)]/60" : "border-[var(--gt-line)]")}
                      aria-label={`${STRING_NAMES[s]} лад ${f}`}
                    >
                      <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--gt-muted)]/50" />
                      {on && <span className="relative grid size-7 place-items-center rounded-full bg-[var(--gt-brass)] font-bold text-black">{note}</span>}
                      {muted && <span className="relative font-bold text-[var(--gt-red)]">×</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="flex pl-6">
              {Array.from({ length: FRETS }).map((_, f) => (
                <span key={f} className="flex-1 text-center text-[10px] text-[var(--gt-muted)]">
                  {[3, 5, 7, 9, 12].includes(f) ? f : f === 0 ? "0" : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="mt-4 text-center">
        <div className="text-xs uppercase tracking-wider text-[var(--gt-muted)]">Это</div>
        {names.length ? (
          <>
            <div className="gt-display mt-1 text-4xl font-bold text-[var(--gt-brass)]">{names[0]}</div>
            {names.length > 1 && <div className="mt-1 text-sm text-[var(--gt-muted)]">или {names.slice(1).join(", ")}</div>}
          </>
        ) : (
          <div className="mt-1 text-lg text-[var(--gt-muted)]">не похоже на известный аккорд</div>
        )}
        <div className="mt-3 flex justify-center gap-2">
          <button
            className="gt-btn gt-btn-brass"
            onClick={async () => {
              await unlockAudio();
              strumChord(frets, { gain: 0.6 });
            }}
          >
            🔊 Сыграть
          </button>
          <button className="gt-btn gt-btn-ghost" onClick={() => setFrets([-1, -1, -1, -1, -1, -1])}>
            Очистить
          </button>
        </div>
      </Panel>
    </>
  );
}
