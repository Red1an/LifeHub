import { useState } from "react";
import { dayKey } from "@lifehub/sdk";
import { CardView } from "../components/Cards";
import { PageHead, Shell } from "../components/kit";
import { cardId, runCard, useCards, usePrefs } from "../lib/store";
import type { PuzzleData } from "../lib/types";

const TOPICS = [
  { id: "", label: "Любая" },
  { id: "логика: рыцари и лжецы, взвешивания, переправы", label: "Логика" },
  { id: "математика на смекалку", label: "Математика" },
  { id: "вероятности и парадоксы", label: "Вероятности" },
  { id: "данетка — нестандартное мышление, ответ словами", label: "Данетка" },
  { id: "числовые и буквенные последовательности", label: "Ряды" },
  { id: "оценка «на салфетке» (задача Ферми), ответ — порядок числа", label: "Ферми" },
  { id: "пространственное мышление", label: "Пространство" },
];

/** Все задачки: текущие сверху, решённые — ниже. «Ещё задачка» нужного типа. */
export function Puzzles() {
  const cards = useCards();
  const [prefs, setPrefs] = usePrefs();
  const [topic, setTopic] = useState("");
  const list = cards.items.filter((c) => c.kind === "puzzle").sort((a, b) => b.startedAt - a.startedAt);
  const open = list.filter((c) => c.status !== "ready" || !(c.puzzle?.solved || c.puzzle?.gaveUp));
  const closed = list.filter((c) => !open.includes(c));
  const solved = closed.filter((c) => c.puzzle?.solved).length;
  const clean = closed.filter((c) => c.puzzle?.solved && !c.puzzle.hints).length;
  const level = Math.round(prefs.level);

  function more() {
    const today = dayKey();
    const n = list.filter((c) => c.day === today).length + 1;
    let id = cardId(today, "puzzle", n);
    for (let k = n; list.some((c) => c.id === id); k++) id = cardId(today, "puzzle", k + 1);
    runCard(id, "puzzle", today, cards.items, prefs, { topic: topic || undefined });
  }

  return (
    <Shell>
      <PageHead
        kicker="Гимнастика для ума"
        title="Задачки"
        sub={closed.length > 0 && `Решено ${solved} из ${closed.length}${clean ? `, без подсказок — ${clean}` : ""}`}
      />

      <section className="horizon-panel mb-6 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="horizon-kicker text-[#a78bfa]">Сложность</div>
            <div className="mt-1 text-lg tracking-[0.2em] text-[#a78bfa]">{"●".repeat(level) + "○".repeat(5 - level)}</div>
          </div>
          <div className="flex gap-1.5">
            <button className="horizon-btn !w-10 !px-0" aria-label="Проще" onClick={() => setPrefs({ ...prefs, level: Math.max(1, level - 1) })}>
              −
            </button>
            <button className="horizon-btn !w-10 !px-0" aria-label="Сложнее" onClick={() => setPrefs({ ...prefs, level: Math.min(5, level + 1) })}>
              +
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[#9aa3b8]">Подстраивается сама: решил с первой попытки — следующие сложнее, сдался — проще.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {TOPICS.map((t) => (
            <button key={t.label} className="horizon-chip" data-on={topic === t.id} onClick={() => setTopic(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="horizon-btn horizon-btn-main mt-4 w-full" onClick={more}>
          🧩 Ещё задачка
        </button>
      </section>

      <div className="space-y-4">
        {open.map((c) => (
          <CardView key={c.id} kind="puzzle" card={c} onRetry={() => runCard(c.id, "puzzle", c.day, cards.items, prefs)} />
        ))}
      </div>

      {closed.length > 0 && (
        <>
          <div className="horizon-kicker mb-3 mt-8 text-[#9aa3b8]">Решённые</div>
          <div className="space-y-2">
            {closed.map((c) => (
              <Solved key={c.id} card={c} />
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

function Solved({ card }: { card: Parameters<typeof CardView>[0]["card"] & {} }) {
  const [open, setOpen] = useState(false);
  const p = card.data as PuzzleData;
  if (open) return <CardView kind="puzzle" card={card} />;
  return (
    <button className="horizon-panel flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]" onClick={() => setOpen(true)}>
      <span className={card.puzzle?.solved ? "text-[#34d399]" : "text-[#9aa3b8]"}>{card.puzzle?.solved ? "✓" : "—"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{p.title}</span>
        <span className="text-xs text-[#9aa3b8]">
          {p.topic} · {"●".repeat(p.level)}
        </span>
      </span>
    </button>
  );
}
