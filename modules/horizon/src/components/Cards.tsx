import { useState, type ReactNode } from "react";
import { cn, db, Link } from "@lifehub/sdk";
import { isStale } from "../lib/store";
import {
  KIND_INFO, type ArtData, type CardDoc, type ConceptData, type FactData, type HistoryData, type JokeData, type Kind, type QuoteData, type PoemData, type PuzzleData, type TechData, type WordData,
} from "../lib/types";
import { Deeper, ExtLink, Kicker, Prose, SubHead, useSpeak, yearsAgo } from "./kit";
import { PuzzleBody } from "./Puzzle";
import { PoemLines } from "./Poem";

type Card = CardDoc & { id: string };

const cards = db.collection<CardDoc>("cards");
const markDone = (c: Card) => {
  if (!c.done) void cards.update(c.id, { done: true, doneAt: Date.now() });
};

/** Карточка рубрики: загрузка, ошибка или содержимое с «читать дальше», оценкой и «копнуть глубже». */
export function CardView({ kind, card, onRetry, onReroll, open: startOpen }: { kind: Kind; card?: Card; onRetry?: () => void; onReroll?: () => void; open?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  const [deeper, setDeeper] = useState(false);
  const color = KIND_INFO[kind].color;

  if (!card || (card.status === "loading" && !isStale(card))) {
    return (
      <article className="horizon-panel p-5">
        <Kicker kind={kind} extra="готовлю…" />
        <div className="horizon-skeleton mt-4 h-6 w-3/4" />
        <div className="horizon-skeleton mt-3 h-4 w-full" />
        <div className="horizon-skeleton mt-2 h-4 w-5/6" />
      </article>
    );
  }
  if (card.status !== "ready" || !card.data) {
    return (
      <article className="horizon-panel p-5">
        <Kicker kind={kind} />
        <p className="mt-3 text-sm text-[#9aa3b8]">{card.status === "error" ? card.error : "Генерация прервалась."}</p>
        {onRetry && (
          <button className="horizon-btn mt-3" onClick={onRetry}>
            Попробовать ещё раз
          </button>
        )}
      </article>
    );
  }

  const expand = () => {
    setOpen(true);
    if (kind !== "puzzle") markDone(card);
  };
  const body = renderBody(kind, card, open, expand);

  return (
    <article className="horizon-panel horizon-pop overflow-hidden" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      {body.cover}
      <div className="p-5">
        <div className="flex items-center justify-between gap-2">
          <Kicker kind={kind} extra={body.extra} />
          {card.done && <span className="text-xs text-[#9aa3b8]">✓</span>}
        </div>
        {body.content}
        {!open && body.more && (
          <button className="horizon-btn mt-4" style={{ color }} onClick={expand}>
            {body.more}
          </button>
        )}
        {(open || kind === "puzzle") && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
            <button className="horizon-btn" onClick={() => setDeeper(true)}>
              🔎 Копнуть глубже{card.chat?.length ? ` · ${Math.ceil(card.chat.length / 2)}` : ""}
            </button>
            <div className="ml-auto flex gap-1.5">
              {onReroll && (
                <button title="Другой вариант" aria-label="Другой вариант" className="grid h-10 w-10 place-items-center rounded-xl border border-white/5 bg-white/[0.03] text-lg opacity-60 hover:opacity-100" onClick={onReroll}>
                  ↻
                </button>
              )}
              <Rate card={card} value={1} label="Интересно">
                👍
              </Rate>
              <Rate card={card} value={-1} label="Скучно, меньше такого">
                👎
              </Rate>
            </div>
          </div>
        )}
      </div>
      {deeper && <Deeper card={card} open={deeper} onClose={() => setDeeper(false)} />}
    </article>
  );
}

function Rate({ card, value, label, children }: { card: Card; value: 1 | -1; label: string; children: ReactNode }) {
  const on = card.reaction === value;
  return (
    <button
      title={label}
      aria-label={label}
      className={cn("grid h-10 w-10 place-items-center rounded-xl border text-lg transition", on ? "border-white/40 bg-white/15" : "border-white/5 bg-white/[0.03] opacity-60 hover:opacity-100")}
      onClick={() => cards.update(card.id, { reaction: on ? null : value })}
    >
      {children}
    </button>
  );
}

interface Body {
  cover?: ReactNode;
  extra?: ReactNode;
  content: ReactNode;
  more?: string;
}

const Title = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h2 className={cn("horizon-serif mt-3 text-[22px] font-semibold leading-snug sm:text-[24px]", className)}>{children}</h2>
);

function renderBody(kind: Kind, card: Card, open: boolean, expand: () => void): Body {
  switch (kind) {
    case "history":
      return historyBody(card.data as HistoryData, open);
    case "fact":
      return factBody(card.data as FactData, open);
    case "quote":
      return quoteBody(card.data as QuoteData, open);
    case "joke":
      return { ...jokeBody(card.data as JokeData, open), content: <JokeContent d={card.data as JokeData} id={card.id} open={open} /> };
    case "puzzle": {
      const p = card.data as PuzzleData;
      return {
        extra: <span title="Сложность">{"●".repeat(p.level) + "○".repeat(5 - p.level)}</span>,
        content: (
          <>
            <Title>{p.title}</Title>
            <div className="mb-3 mt-1 text-sm text-[#9aa3b8]">{p.topic}</div>
            <PuzzleBody card={card} />
          </>
        ),
      };
    }
    case "tech":
      return techBody(card.data as TechData, open);
    case "concept":
      return conceptBody(card.data as ConceptData, open);
    case "word":
      return wordBody(card.data as WordData, open);
    case "poem":
      return poemBody(card, open, expand);
    case "art":
      return artBody(card.data as ArtData, open);
  }
}

function paragraphs(s: string) {
  return String(s ?? "").trim().split(/\n\s*\n/);
}

function historyBody(d: HistoryData, open: boolean): Body {
  const ps = paragraphs(d.story);
  return {
    cover: (
      <div className="relative">
        {d.image && <img src={d.image} alt="" className="h-48 w-full object-cover opacity-70 sm:h-60" loading="lazy" />}
        <div className={cn("horizon-serif px-5 font-bold leading-none text-[#f5b453]", d.image ? "absolute bottom-3 left-0 text-[56px] drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]" : "pt-5 text-[48px]")}>
          {d.year}
        </div>
      </div>
    ),
    extra: yearsAgo(d.year),
    content: (
      <>
        <Title>{d.title}</Title>
        <div className="mt-3">
          {open ? <Prose text={d.story} /> : <Prose text={ps[0]} className="horizon-fade max-h-[7.5em] overflow-hidden" />}
        </div>
        {open && (
          <>
            <SubHead color="#f5b453">Что это значит сегодня</SubHead>
            <Prose text={d.why} />
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              <Link to="/day" className="text-sm text-[#f5b453] underline decoration-[#f5b453]/30 underline-offset-4">
                Весь этот день в истории и «Угадай год» →
              </Link>
              <ExtLink href={d.link}>Википедия</ExtLink>
            </div>
          </>
        )}
      </>
    ),
    more: "Читать историю",
  };
}

function factBody(d: FactData, open: boolean): Body {
  return {
    content: (
      <>
        <div className="mt-3 flex gap-4">
          <p className="horizon-serif flex-1 text-[21px] leading-snug">
            <span className="text-[#5cc8f0]">…</span>
            {d.teaser.replace(/^./, (c) => c.toLowerCase())}
          </p>
          {d.image && <img src={d.image} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" />}
        </div>
        {!open && <p className="mt-2 text-sm text-[#9aa3b8]">Как так? Подумай, а потом открой разгадку.</p>}
        {open && (
          <div className="horizon-pop">
            <SubHead color="#5cc8f0">Разгадка</SubHead>
            <Prose text={d.answer} />
            <div className="mt-4">
              <ExtLink href={d.link}>Статья «{d.title}»</ExtLink>
            </div>
          </div>
        )}
      </>
    ),
    more: "Открыть разгадку",
  };
}

function quoteBody(d: QuoteData, open: boolean): Body {
  return {
    content: (
      <>
        <blockquote className="horizon-serif relative mt-4 pl-6 text-[21px] leading-snug sm:text-[23px]">
          <span className="absolute -left-0.5 -top-3 text-[48px] leading-none text-[#facc15]/60">“</span>
          {d.text}
        </blockquote>
        <div className="mt-3 pl-6">
          <div className="font-semibold">— {d.author}</div>
          <div className="text-sm text-[#9aa3b8]">{d.who}</div>
        </div>
        {open && (
          <div className="horizon-pop">
            <SubHead color="#facc15">Откуда она</SubHead>
            <Prose text={d.context} />
            <SubHead color="#facc15">О чём на самом деле</SubHead>
            <Prose text={d.meaning} />
            <SubHead color="#facc15">Когда ввернуть</SubHead>
            <p className="border-l-2 border-[#facc15]/40 pl-3 text-[15px] leading-relaxed">{d.use}</p>
          </div>
        )}
      </>
    ),
    more: "Откуда она и когда сказать",
  };
}

function jokeBody(d: JokeData, _open: boolean): Body {
  return { extra: d.topic, content: null, more: "Узнать концовку" };
}

function JokeContent({ d, id, open }: { d: JokeData; id: string; open: boolean }) {
  const speak = useSpeak(id);
  return (
    <>
      <Prose text={d.setup} className="mt-4" />
      {open ? (
        <div className="horizon-pop">
          <Prose text={d.punchline} className="mt-3 !text-[18px] font-semibold !text-white" />
          <SubHead color="#2dd4bf">Когда рассказать</SubHead>
          <p className="text-[15px] leading-relaxed text-[#ece6da]">{d.when}</p>
          {speak.supported && (
            <button className="horizon-btn mt-4" onClick={() => speak.toggle(`${d.setup}

${d.punchline}`, 1)}>
              {speak.on ? "⏹ Стоп" : "🔊 Послушать, как звучит"}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[#9aa3b8]">Угадаешь концовку?</p>
      )}
    </>
  );
}

function techBody(d: TechData, open: boolean): Body {
  return {
    content: (
      <>
        <Title>{d.name}</Title>
        <p className="mt-1.5 text-[15px] text-[#9aa3b8]">{d.tagline}</p>
        <SubHead color="#34d399">Какую проблему решает</SubHead>
        <Prose text={d.problem} className={open ? "" : "horizon-fade max-h-[5em] overflow-hidden"} />
        {open && (
          <>
            <SubHead color="#34d399">Как это работает</SubHead>
            <Prose text={d.how} />
            <SubHead color="#34d399">Где уже применяется</SubHead>
            <Prose text={d.where} />
            {d.try && (
              <>
                <SubHead color="#34d399">Потрогать самому</SubHead>
                <Prose text={d.try} />
              </>
            )}
            <div className="mt-4">
              <ExtLink href={d.link}>Источник</ExtLink>
            </div>
          </>
        )}
      </>
    ),
    more: "Как это работает",
  };
}

function conceptBody(d: ConceptData, open: boolean): Body {
  return {
    extra: d.field,
    content: (
      <>
        <Title>{d.name}</Title>
        <div className="mt-3">
          <Prose text={d.idea} className={open ? "" : "horizon-fade max-h-[6em] overflow-hidden"} />
        </div>
        {open && (
          <>
            <SubHead color="#fb7185">Пример</SubHead>
            <Prose text={d.example} />
            <SubHead color="#fb7185">Как применить</SubHead>
            <Prose text={d.use} />
          </>
        )}
      </>
    ),
    more: "Пример и как применить",
  };
}

function wordBody(d: WordData, open: boolean): Body {
  return {
    content: (
      <>
        <Title className="!text-[30px] tracking-wide">{d.stress || d.word}</Title>
        {!open && <p className="mt-1 text-sm text-[#9aa3b8]">Знаешь точно, что значит? Скажи про себя — и проверь.</p>}
        {open && (
          <div className="horizon-pop">
            <p className="horizon-serif mt-3 text-[18px] leading-relaxed">{d.meaning}</p>
            <SubHead color="#fb923c">Откуда слово</SubHead>
            <Prose text={d.origin} />
            <SubHead color="#fb923c">В речи</SubHead>
            <p className="horizon-serif border-l-2 border-[#fb923c]/40 pl-3 text-[16px] italic leading-relaxed">{d.example}</p>
          </div>
        )}
      </>
    ),
    more: "Проверить себя",
  };
}

function poemBody(card: Card, open: boolean, expand: () => void): Body {
  const d = card.data as PoemData;
  return {
    extra: d.author,
    content: (
      <>
        <Title>{d.title}</Title>
        <div className="mt-4">{open ? <PoemFull d={d} id={card.id} /> : <PoemLines lines={d.lines.slice(0, 6)} className="horizon-fade" onClick={expand} />}</div>
      </>
    ),
    more: "Читать полностью",
  };
}

function PoemFull({ d, id }: { d: PoemData; id: string }) {
  const speak = useSpeak(id);
  const [learn, setLearn] = useState(0);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {speak.supported && (
          <button className="horizon-btn" onClick={() => speak.toggle(d.lines.join("\n"), 0.9)}>
            {speak.on ? "⏹ Стоп" : "🔊 Прочитать вслух"}
          </button>
        )}
        <button className="horizon-btn" onClick={() => setLearn((l) => (l + 1) % 4)} style={learn ? { color: "#93a5ff" } : undefined}>
          {["🧠 Учить наизусть", "Скрыта треть слов", "Скрыты две трети", "Только первые буквы"][learn]}
        </button>
      </div>
      <PoemLines lines={d.lines} hide={learn} />
      {learn > 0 && <p className="mt-2 text-xs text-[#9aa3b8]">Нажми на строку, чтобы подсмотреть. Нажимай кнопку — слов будет скрыто больше.</p>}
      <SubHead color="#93a5ff">О стихотворении</SubHead>
      <Prose text={d.about} />
      <SubHead color="#93a5ff">На что обратить внимание</SubHead>
      <Prose text={d.notice} />
      <div className="mt-4">
        <ExtLink href={d.link}>Викитека</ExtLink>
      </div>
    </>
  );
}

function artBody(d: ArtData, open: boolean): Body {
  return {
    cover: d.image && (
      <a href={d.image} target="_blank" rel="noreferrer" className="block bg-black/40">
        <img src={d.image} alt={d.title} className={cn("mx-auto w-full object-contain", open ? "max-h-[70vh]" : "max-h-72")} loading="lazy" />
      </a>
    ),
    extra: d.year,
    content: (
      <>
        <Title>{d.title}</Title>
        <p className="mt-1 text-[15px] text-[#9aa3b8]">{d.artist}</p>
        {open && (
          <>
            <div className="mt-4">
              <Prose text={d.story} />
            </div>
            <SubHead color="#f472b6">На что смотреть</SubHead>
            <Prose text={d.look} />
            <div className="mt-4">
              <ExtLink href={d.link}>Википедия</ExtLink>
            </div>
          </>
        )}
      </>
    ),
    more: "История картины",
  };
}
