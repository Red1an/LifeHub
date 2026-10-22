import { cn, dayKey, Link, plural, useParams } from "@lifehub/sdk";
import { PageHead, Shell } from "../components/kit";
import { dayLabel, isStale, streakOf, useDaily, useDue } from "../lib/store";
import {
  KIND_INFO, type ArtData, type CardDoc, type FactData, type HistoryData, type JokeData, type Kind, type PoemData, type PuzzleData, type QuoteData,
} from "../lib/types";

/** Ссылка на экран рубрики: сегодня — /k/:kind, день из архива — /d/:day/:kind. */
export const readerPath = (day: string, kind: Kind) => (day === dayKey() ? `/k/${kind}` : `/d/${day}/${kind}`);

/** Порция дня плитками (или прошлый день из архива: /d/:day). Нажатие — рубрика на весь экран. */
export function Today() {
  const { day: param } = useParams();
  const day = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : dayKey();
  const isToday = day === dayKey();
  const { all, kinds, byKind } = useDaily(day);
  const done = kinds.filter((k) => byKind(k)?.done).length;
  const streak = streakOf(all.items);
  const due = useDue().due.length;
  const next = kinds.find((k) => !byKind(k)?.done);

  return (
    <Shell>
      <PageHead
        kicker={isToday ? "Порция дня" : "Архив"}
        title={dayLabel(day)}
        sub={
          kinds.length > 0 && (
            <span>
              Прочитано {done} из {kinds.length}
              {isToday && streak > 1 && <> · 🔥 {streak} {plural(streak, ["день", "дня", "дней"])} подряд</>}
            </span>
          )
        }
      />

      {isToday && due > 0 && (
        <Link to="/review" className="horizon-panel mb-3 flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
          <span className="text-xl">🔁</span>
          <span className="flex-1 text-[15px]">
            Вспомнить прошлое: <b>{due}</b> {plural(due, ["вопрос", "вопроса", "вопросов"])}
          </span>
          <span className="text-[#9aa3b8]">→</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kinds.map((k) => (
          <Tile key={k} day={day} kind={k} card={byKind(k)} />
        ))}
      </div>

      {!isToday && !kinds.length && <p className="text-center text-[#9aa3b8]">В этот день карточек не было.</p>}

      {next && kinds.length > 0 && (
        <Link to={readerPath(day, done ? next : kinds[0])} className="horizon-btn horizon-btn-main mt-5 w-full !min-h-12 text-[15px]">
          {done ? "Продолжить" : "Начать по порядку"} → {KIND_INFO[done ? next : kinds[0]].icon}
        </Link>
      )}

      {isToday && kinds.length > 0 && done === kinds.length && (
        <div className="horizon-pop mt-8 text-center">
          <div className="text-4xl">🌌</div>
          <p className="horizon-serif mt-2 text-xl">Порция дня прочитана</p>
          <p className="mt-1 text-sm text-[#9aa3b8]">
            Завтра будет новая. А пока — <Link to="/day" className="underline underline-offset-4">угадай год</Link> или{" "}
            <Link to="/puzzles" className="underline underline-offset-4">ещё задачка</Link>.
          </p>
        </div>
      )}
    </Shell>
  );
}

/** Плитка рубрики: что внутри одной-двумя строками, у истории и картины — фоном картинка. */
function Tile({ day, kind, card }: { day: string; kind: Kind; card?: CardDoc & { id: string } }) {
  const info = KIND_INFO[kind];
  const ready = card?.status === "ready" && card.data;
  const loading = !card || (card.status === "loading" && !isStale(card));
  const wide = kind === "history";
  const image = ready ? (kind === "history" ? (card!.data as HistoryData).image : kind === "art" ? (card!.data as ArtData).image : undefined) : undefined;

  return (
    <Link
      to={readerPath(day, kind)}
      className={cn(
        "horizon-panel group relative flex min-h-[150px] flex-col overflow-hidden p-4 transition active:scale-[0.98]",
        wide && "col-span-2 min-h-[190px] sm:col-span-3",
        card?.done && "opacity-60",
      )}
      style={{ boxShadow: `inset 0 3px 0 ${info.color}` }}
    >
      {image && (
        <>
          <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45 transition group-hover:opacity-55" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e1a] via-[#0a0e1a]/60 to-transparent" />
        </>
      )}
      <div className="relative flex items-center justify-between">
        <span className="horizon-kicker" style={{ color: info.color }}>
          <span className="mr-1.5 text-[15px]">{info.icon}</span>
          {info.label}
        </span>
        {card?.done && <span className="text-sm text-[#34d399]">✓</span>}
      </div>
      <div className="relative mt-auto pt-3">
        {loading ? (
          <>
            <div className="horizon-skeleton h-4 w-full" />
            <div className="horizon-skeleton mt-2 h-4 w-2/3" />
          </>
        ) : !ready ? (
          <p className="text-sm text-[#fb7185]">Не получилось — открой, чтобы повторить</p>
        ) : (
          <Preview kind={kind} card={card!} wide={wide} />
        )}
      </div>
    </Link>
  );
}

function Preview({ kind, card, wide }: { kind: Kind; card: CardDoc; wide: boolean }) {
  const d = card.data as any;
  const big = (text: string, lines = 3) => (
    <p className={cn("horizon-serif font-semibold leading-snug", wide ? "text-[22px]" : "text-[16px]")} style={{ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
      {text}
    </p>
  );
  const sub = (text: string) => <p className="mt-1 truncate text-xs text-[#9aa3b8]">{text}</p>;
  switch (kind) {
    case "history":
      return (
        <>
          <div className="horizon-serif text-[34px] font-bold leading-none text-[#f5b453]">{(d as HistoryData).year}</div>
          <div className="mt-1.5">{big((d as HistoryData).title, 2)}</div>
        </>
      );
    case "fact":
      return big("…" + (d as FactData).teaser.replace(/^./, (c) => c.toLowerCase()), 4);
    case "quote":
      return (
        <>
          {big(`«${(d as QuoteData).text}»`, 3)}
          {sub((d as QuoteData).author)}
        </>
      );
    case "puzzle": {
      const p = d as PuzzleData;
      const st = card.puzzle;
      return (
        <>
          {big(p.title, 2)}
          {sub(st?.solved ? "✓ решена" : st?.gaveUp ? "разобрана" : `${p.topic} · ${"●".repeat(p.level)}`)}
        </>
      );
    }
    case "tech":
    case "concept":
      return big(d.name, 3);
    case "word":
      return big(d.stress || d.word, 2);
    case "joke":
      return (
        <>
          {big((d as JokeData).topic, 2)}
          {sub("угадаешь концовку?")}
        </>
      );
    case "poem":
      return (
        <>
          {big((d as PoemData).title, 2)}
          {sub((d as PoemData).author)}
        </>
      );
    case "art":
      return (
        <>
          {big((d as ArtData).title, 2)}
          {sub((d as ArtData).artist)}
        </>
      );
  }
}
