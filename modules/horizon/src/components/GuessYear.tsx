import { useMemo, useState } from "react";
import { cn, db, dayKey, plural, toast } from "@lifehub/sdk";
import { cap } from "./kit";
import { shuffle } from "../lib/sources";
import type { DayDoc, DayEvent, GameDoc } from "../lib/types";

const ROUNDS = 5;
const MIN_YEAR = 1000;
const NOW = new Date().getFullYear();

/** Очки за раунд: точно — 100, ошибка в 30 лет — около 37. */
const pointsFor = (diff: number) => Math.round(100 * Math.exp(-diff / 30));

function pick(doc: DayDoc, seed: string): DayEvent[] {
  const pool = [...doc.selected, ...doc.events].filter((e, i, a) => e.year >= MIN_YEAR && e.year <= NOW && a.findIndex((x) => x.text === e.text) === i);
  // Разные эпохи: делим по векам и берём по одному.
  const byCentury = new Map<number, DayEvent[]>();
  for (const e of shuffle(pool, seed)) {
    const c = Math.floor(e.year / 100);
    byCentury.set(c, [...(byCentury.get(c) ?? []), e]);
  }
  const out: DayEvent[] = [];
  while (out.length < ROUNDS && [...byCentury.values()].some((l) => l.length)) {
    for (const l of shuffle([...byCentury.values()], seed + out.length)) {
      const e = l.shift();
      if (e && out.length < ROUNDS) out.push(e);
    }
  }
  return shuffle(out, seed + "order");
}

/** «Угадай год»: пять событий этого дня из разных веков, ползунок по шкале времени. */
export function GuessYear({ doc, best, onDone }: { doc: DayDoc; best: number | null; onDone?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const events = useMemo(() => pick(doc, `${doc.day}-${attempt}`), [doc, attempt]);
  const [round, setRound] = useState(0);
  const [guess, setGuess] = useState(1900);
  const [shown, setShown] = useState(false);
  const [results, setResults] = useState<GameDoc["rounds"]>([]);
  const finished = results.length === events.length && events.length > 0;

  if (events.length < 3) return <p className="text-sm text-[#9aa3b8]">Для игры мало событий в этот день.</p>;

  const e = events[round];
  const total = results.reduce((a, r) => a + r.points, 0);

  async function submit() {
    const diff = Math.abs(guess - e.year);
    const r = { year: e.year, guess, points: pointsFor(diff) };
    const next = [...results, r];
    setResults(next);
    setShown(true);
    if (next.length === events.length) {
      const score = next.reduce((a, x) => a + x.points, 0);
      await db.collection<GameDoc>("games").add({ day: dayKey(), score, rounds: next, at: Date.now() });
      if (best === null || score > best) toast(`Новый рекорд: ${score} из ${ROUNDS * 100}!`, "success");
      onDone?.();
    }
  }

  if (finished && !shown) {
    return (
      <div className="text-center">
        <div className="horizon-serif text-[44px] font-bold text-[#f5b453]">{total}</div>
        <div className="text-sm text-[#9aa3b8]">из {ROUNDS * 100} · {verdict(total)}</div>
        <div className="mt-4 space-y-1.5 text-left text-sm">
          {events.map((ev, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-24 shrink-0 tabular-nums text-[#9aa3b8]">
                {results[i].guess} → <b className="text-[#ece6da]">{ev.year}</b>
              </span>
              <span className="min-w-0 flex-1 truncate">{cap(ev.text)}</span>
              <span className="tabular-nums text-[#f5b453]">+{results[i].points}</span>
            </div>
          ))}
        </div>
        <button
          className="horizon-btn horizon-btn-main mt-5"
          onClick={() => {
            setAttempt((a) => a + 1);
            setRound(0);
            setResults([]);
            setGuess(1900);
          }}
        >
          Ещё раз — другие события
        </button>
      </div>
    );
  }

  const last = results[round];
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-[#9aa3b8]">
        <span>
          Событие {round + 1} из {events.length}
        </span>
        <span className="tabular-nums">
          {total} {plural(total, ["очко", "очка", "очков"])}
        </span>
      </div>
      <p className="horizon-serif mt-3 min-h-[4.5em] text-[18px] leading-snug">{cap(e.text)}</p>

      {!shown ? (
        <>
          <div className="horizon-serif mt-2 text-center text-[40px] font-bold tabular-nums text-[#f5b453]">{guess}</div>
          <input type="range" min={MIN_YEAR} max={NOW} value={guess} onChange={(x) => setGuess(Number(x.target.value))} className="horizon-range" aria-label="Год" />
          <div className="flex justify-between text-xs text-[#9aa3b8]">
            <span>{MIN_YEAR}</span>
            <div className="flex gap-1">
              {[-10, -1, 1, 10].map((d) => (
                <button key={d} className="rounded-lg bg-white/5 px-2.5 py-1.5 tabular-nums hover:bg-white/10" onClick={() => setGuess((g) => Math.min(NOW, Math.max(MIN_YEAR, g + d)))}>
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
            </div>
            <span>{NOW}</span>
          </div>
          <button className="horizon-btn horizon-btn-main mt-4 w-full" onClick={submit}>
            Ответить
          </button>
        </>
      ) : (
        <div className="horizon-pop mt-2 text-center">
          <div className="text-sm text-[#9aa3b8]">
            Твой ответ {last.guess} · на самом деле
          </div>
          <div className="horizon-serif text-[40px] font-bold tabular-nums text-[#f5b453]">{e.year}</div>
          <div className={cn("text-sm font-semibold", last.points >= 80 ? "text-[#34d399]" : last.points >= 40 ? "text-[#f5b453]" : "text-[#fb7185]")}>
            {last.year === last.guess ? "Точно в год! " : `Ошибка ${Math.abs(last.year - last.guess)} ${plural(Math.abs(last.year - last.guess), ["год", "года", "лет"])} · `}+{last.points}
          </div>
          {e.link && (
            <a href={e.link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-[#9aa3b8] underline underline-offset-4">
              {e.title ?? "Подробнее"} ↗
            </a>
          )}
          <button
            className="horizon-btn horizon-btn-main mt-4 w-full"
            onClick={() => {
              setShown(false);
              if (round + 1 < events.length) setRound(round + 1);
            }}
          >
            {round + 1 < events.length ? "Дальше" : "Итог"}
          </button>
        </div>
      )}
    </div>
  );
}

function verdict(score: number) {
  if (score >= 450) return "машина времени в голове";
  if (score >= 350) return "отличное чувство истории";
  if (score >= 250) return "неплохо";
  if (score >= 150) return "есть куда расти";
  return "история полна сюрпризов";
}
