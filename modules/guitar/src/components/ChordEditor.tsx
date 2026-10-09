import { useState } from "react";
import { cn } from "@lifehub/sdk";
import { parseChord } from "../lib/chords";
import { parseSheet, placeChords, type SheetFormat } from "../lib/sheet";
import { Btn } from "./kit";

/*
 * Редактор аккордов над текстом: выбираешь аккорд в палитре и нажимаешь на слово — аккорд встаёт над ним.
 * Повторное нажатие тем же аккордом убирает его, «ластик» стирает. Сохраняется в формате UG ([ch] над словами).
 */

type EChord = { col: number; name: string };
type ELine = { t: "section"; label: string } | { t: "blank" } | { t: "raw"; text: string } | { t: "lyric"; text: string; chords: EChord[] };

function toModel(body: string, format?: SheetFormat): ELine[] {
  return parseSheet(body, format).flatMap((l): ELine[] => {
    if (l.t === "section") return [{ t: "section", label: l.label }];
    if (l.t === "blank") return [{ t: "blank" }];
    if (l.t === "text") return [{ t: "lyric", text: l.text, chords: [] }];
    if (l.t === "tab") return l.lines.map((text) => ({ t: "raw" as const, text }));
    return [{ t: "lyric", text: l.lyric, chords: placeChords(l.chords).map((c) => ({ col: c.col, name: c.chord })) }];
  });
}

function chordLine(chords: EChord[]) {
  let vis = "";
  let out = "";
  for (const c of [...chords].sort((a, b) => a.col - b.col)) {
    const col = Math.max(c.col, vis.length ? vis.length + 1 : 0);
    out += " ".repeat(col - vis.length) + `[ch]${c.name}[/ch]`;
    vis = vis.padEnd(col, " ") + c.name;
  }
  return out;
}

export function serialize(lines: ELine[]): string {
  return lines
    .flatMap((l) => {
      if (l.t === "section") return [`[${l.label}]`];
      if (l.t === "blank") return [""];
      if (l.t === "raw") return [l.text];
      const out: string[] = [];
      if (l.chords.length) out.push(chordLine(l.chords));
      if (l.text) out.push(l.text);
      return out;
    })
    .join("\n");
}

export function ChordEditor({
  body,
  format,
  palette: initialPalette,
  onSave,
  onCancel,
  saving,
}: {
  body: string;
  format?: SheetFormat;
  palette: string[];
  onSave: (body: string) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [lines, setLines] = useState<ELine[]>(() => toModel(body, format));
  const [palette, setPalette] = useState<string[]>(() => (initialPalette.length ? initialPalette : ["Am", "C", "G", "Em", "D", "F"]));
  const [brush, setBrush] = useState<string | "erase">(palette[0] ?? "erase");
  const [custom, setCustom] = useState("");

  const update = (i: number, fn: (l: Extract<ELine, { t: "lyric" }>) => Extract<ELine, { t: "lyric" }>) =>
    setLines((ls) => ls.map((l, k) => (k === i && l.t === "lyric" ? fn(l) : l)));

  const tapWord = (i: number, start: number, end: number, at: number) =>
    update(i, (l) => {
      const inWord = l.chords.filter((c) => c.col >= start && c.col < end);
      const rest = l.chords.filter((c) => !(c.col >= start && c.col < end));
      if (brush === "erase") return { ...l, chords: rest };
      if (inWord.length === 1 && inWord[0].name === brush) return { ...l, chords: rest };
      return { ...l, chords: [...rest, { col: at, name: brush }] };
    });

  const addCustom = () => {
    const c = custom.trim();
    if (!parseChord(c)) return;
    if (!palette.includes(c)) setPalette([...palette, c]);
    setBrush(c);
    setCustom("");
  };

  return (
    <div>
      <div className="sticky top-[calc(2.75rem+env(safe-area-inset-top))] z-20 -mx-1 mb-3 rounded-2xl border border-[var(--gt-line)] bg-[var(--gt-panel)]/95 p-2 backdrop-blur lg:top-2">
        <div className="mb-2 text-xs text-[var(--gt-muted)]">Выбери аккорд и нажимай на слова. Повторное нажатие — убрать.</div>
        <div className="flex flex-wrap gap-1.5">
          {palette.map((c) => (
            <button key={c} data-on={brush === c} onClick={() => setBrush(c)} className="gt-chip gt-mono !min-h-9 text-sm">
              {c}
            </button>
          ))}
          <button data-on={brush === "erase"} onClick={() => setBrush("erase")} className="gt-chip !min-h-9 text-sm">
            🧽 Ластик
          </button>
          <form
            className="flex"
            onSubmit={(e) => {
              e.preventDefault();
              addCustom();
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="+ аккорд"
              className={cn("gt-input gt-mono !w-24 !rounded-full !py-1.5 text-sm", custom && !parseChord(custom) && "!border-[var(--gt-red)]")}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </form>
        </div>
        <div className="mt-2 flex gap-2">
          <Btn className="!min-h-9 text-sm" onClick={() => onSave(serialize(lines))} loading={saving}>
            💾 Сохранить
          </Btn>
          <Btn tone="ghost" className="!min-h-9 text-sm" onClick={onCancel}>
            Отмена
          </Btn>
        </div>
      </div>

      <div className="gt-mono space-y-1 text-[15px]">
        {lines.map((l, i) => {
          if (l.t === "blank") return <div key={i} className="h-3" />;
          if (l.t === "section")
            return (
              <div key={i} className="pt-2">
                <span className="gt-section rounded-md bg-[var(--gt-sky)]/10 px-2 py-0.5 font-sans text-xs font-bold uppercase text-[var(--gt-sky)]">{l.label}</span>
              </div>
            );
          if (l.t === "raw") return <div key={i} className="whitespace-pre text-xs text-[var(--gt-muted)]">{l.text}</div>;
          if (!l.text)
            // Строка из одних аккордов (проигрыш): аккорды — кнопки, «+» добавляет выбранный.
            return (
              <div key={i} className="flex flex-wrap items-center gap-1">
                {l.chords.map((c, k) => (
                  <button
                    key={k}
                    className="rounded-md px-1.5 font-bold text-[var(--gt-brass)] hover:bg-[var(--gt-brass)]/15"
                    onClick={() => update(i, (x) => ({ ...x, chords: brush === "erase" || brush === c.name ? x.chords.filter((_, j) => j !== k) : x.chords.map((y, j) => (j === k ? { ...y, name: brush } : y)) }))}
                  >
                    {c.name}
                  </button>
                ))}
                {brush !== "erase" && (
                  <button
                    className="rounded-md px-1.5 text-xs text-[var(--gt-muted)] hover:text-[var(--gt-fg)]"
                    onClick={() => update(i, (x) => ({ ...x, chords: [...x.chords, { col: (x.chords.at(-1)?.col ?? -4) + (x.chords.at(-1)?.name.length ?? 0) + 4, name: brush }] }))}
                  >
                    + {brush}
                  </button>
                )}
              </div>
            );
          const words = [...l.text.matchAll(/\S+/g)];
          return (
            <div key={i} className="flex flex-wrap items-end gap-x-1.5 gap-y-1">
              {words.map((w, k) => {
                // Слову принадлежат аккорды от его начала до начала следующего слова (включая пробел).
                const start = k === 0 ? -1000 : w.index!;
                const end = words[k + 1]?.index ?? 100000;
                const over = l.chords.filter((c) => c.col >= start && c.col < end);
                return (
                  <button key={w.index} onClick={() => tapWord(i, start, end, w.index!)} className="group flex flex-col items-start rounded-md px-0.5 text-left hover:bg-white/5">
                    <span className={cn("h-5 text-sm font-bold leading-5", over.length ? "text-[var(--gt-brass)]" : "text-transparent group-hover:text-[var(--gt-brass)]/40")}>
                      {over.length ? over.map((c) => c.name).join(" ") : brush === "erase" ? "·" : brush}
                    </span>
                    <span className="leading-5">{w[0]}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
