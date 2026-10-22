import { useState } from "react";
import { ai, cn, db, toast } from "@lifehub/sdk";
import { usePrefs } from "../lib/store";
import type { CardDoc, PuzzleData, PuzzleState } from "../lib/types";
import { Prose, SubHead } from "./kit";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const numberIn = (s: string) => {
  const m = String(s).replace(/\s/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

function check(p: PuzzleData, input: string): boolean {
  if (p.answerType === "number") {
    const a = numberIn(p.answer);
    const b = numberIn(input);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
  }
  if (p.answerType === "choice") return norm(input) === norm(p.answer) || (p.options ?? []).indexOf(input) === Number(p.answer);
  return p.answer.split("|").some((a) => norm(a) && norm(a) === norm(input));
}

/** Задачка: ответ, подсказки по одной, «сдаюсь» и разбор. Сложность следующих подстраивается. */
export function PuzzleBody({ card }: { card: CardDoc & { id: string } }) {
  const p = card.data as PuzzleData;
  const st: PuzzleState = card.puzzle ?? { solved: false, tries: 0, hints: 0 };
  const [prefs, setPrefs] = usePrefs();
  const [input, setInput] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const finished = st.solved || st.gaveUp;

  async function save(next: PuzzleState) {
    await db.collection<CardDoc>("cards").update(card.id, { puzzle: next, ...(next.solved || next.gaveUp ? { done: true, doneAt: Date.now() } : {}) });
  }
  function adjust(delta: number) {
    setPrefs({ ...prefs, level: Math.min(5, Math.max(1, prefs.level + delta)) });
  }

  async function answer(value: string) {
    if (finished || !value.trim()) return;
    if (check(p, value)) {
      await save({ ...st, tries: st.tries + 1, solved: true });
      if (st.hints === 0 && st.tries <= 1) adjust(0.5);
      toast(st.tries === 0 && st.hints === 0 ? "С первой попытки! 🎯" : "Верно! 🎉", "success");
    } else {
      setWrong(value);
      await save({ ...st, tries: st.tries + 1 });
    }
  }

  /** Ответ словами мог быть верным, но записан иначе — пусть рассудит нейронка. */
  async function judge() {
    if (!wrong) return;
    setJudging(true);
    try {
      const r = await ai.json<{ ok: boolean }>(
        `Задача: ${p.text}\nПравильный ответ: ${p.answer}\nРазбор: ${p.solution}\nОтвет человека: «${wrong}»\nЭто по сути правильный ответ (другая формулировка того же)? JSON: {"ok": true|false}`,
        { model: "fast" },
      );
      if (r.ok) {
        await save({ ...st, solved: true });
        toast("Засчитано — это тот же ответ 🎉", "success");
      } else toast("Нет, это другой ответ", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setJudging(false);
    }
  }

  return (
    <div>
      <Prose text={p.text} />

      {!finished && (
        <div className="mt-4">
          {p.answerType === "choice" ? (
            <div className="grid gap-2">
              {(p.options ?? []).map((o) => (
                <button
                  key={o}
                  className={cn("horizon-btn !justify-start !py-2.5 text-left !font-medium", wrong === o && "!border-[#fb7185]/60 !text-[#fb7185]")}
                  onClick={() => answer(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void answer(input);
              }}
            >
              <input
                className="horizon-input"
                inputMode={p.answerType === "number" ? "decimal" : "text"}
                placeholder={p.answerType === "number" ? "Ответ — число" : "Твой ответ"}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setWrong(null);
                }}
              />
              <button className="horizon-btn horizon-btn-main shrink-0" disabled={!input.trim()}>
                Проверить
              </button>
            </form>
          )}
          {wrong && (
            <div className="horizon-pop mt-2 flex flex-wrap items-center gap-2 text-sm text-[#fb7185]">
              Не то. Попробуй ещё{st.hints < p.hints.length ? " или возьми подсказку" : ""}.
              {p.answerType === "word" && (
                <button className="underline underline-offset-4" onClick={judge} disabled={judging}>
                  {judging ? "Сверяю…" : "Я ответил верно, просто иначе"}
                </button>
              )}
            </div>
          )}

          {p.hints.slice(0, st.hints).map((h, i) => (
            <div key={i} className="horizon-pop mt-3 rounded-xl border border-[#a78bfa]/25 bg-[#a78bfa]/10 px-3.5 py-2.5 text-[15px]">
              <span className="mr-1.5">💡</span>
              {h}
            </div>
          ))}

          <div className="mt-4 flex flex-wrap gap-2">
            {st.hints < p.hints.length && (
              <button className="horizon-btn" onClick={() => save({ ...st, hints: st.hints + 1 })}>
                Подсказка {st.hints + 1}/{p.hints.length}
              </button>
            )}
            <button
              className="horizon-btn !text-[#9aa3b8]"
              onClick={async () => {
                await save({ ...st, gaveUp: true });
                adjust(-0.5);
              }}
            >
              Сдаюсь — покажи
            </button>
          </div>
        </div>
      )}

      {finished && (
        <div className="horizon-pop">
          <div className={cn("mt-4 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold", st.solved ? "bg-[#34d399]/12 text-[#34d399]" : "bg-white/5 text-[#ece6da]")}>
            {st.solved ? `✓ Решено${st.hints ? ` с ${st.hints} подсказк${st.hints === 1 ? "ой" : "ами"}` : ""}${st.tries > 1 ? ` с ${st.tries}-й попытки` : ""}.` : "Ответ:"}{" "}
            <span className="font-normal">{st.solved ? "Ответ: " : ""}{p.answer.split("|")[0]}</span>
          </div>
          <SubHead color="#a78bfa">Разбор</SubHead>
          <Prose text={p.solution} />
        </div>
      )}
    </div>
  );
}
