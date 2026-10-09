import { useState, type ReactNode } from "react";
import { Link, Modal, cn, db, files, formatRelative, useNavigate, useStore } from "@lifehub/sdk";
import { contextById, isSnoozed, kindById, kindOf } from "../lib/kinds.ts";
import { KIND_LABEL } from "../lib/links.ts";
import { eventWhen, hostOf, preview, shortDate, titleOf } from "../lib/text.ts";
import { DEFAULT_PREFS, type LinkCard, type Note, type NoteDoc, type NoteEvent, type Prefs, type TopicDoc } from "../lib/types.ts";

export function usePrefs() {
  const [p, set] = useStore<Prefs>("prefs", DEFAULT_PREFS);
  return { prefs: { ...DEFAULT_PREFS, ...p }, setPrefs: (patch: Partial<Prefs>) => set((prev) => ({ ...DEFAULT_PREFS, ...prev, ...patch })) };
}

/** Шапка страницы в стиле модуля. */
export function Head({ title, sub, back, right }: { title: ReactNode; sub?: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      {back && (
        <Link to={back} className="nt-mic -ml-1 mt-0.5 !h-9 !w-9 !text-base" aria-label="Назад">
          ←
        </Link>
      )}
      <div className="min-w-0 flex-1">
        {title && <h1 className="nt-h1">{title}</h1>}
        {sub && <p className="nt-muted mt-1 text-sm">{sub}</p>}
      </div>
      {right && <div className="flex flex-none items-center gap-2">{right}</div>}
    </header>
  );
}

export function Wrap({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pb-10 pt-5 sm:px-6 sm:pt-8", wide ? "max-w-5xl" : "max-w-2xl")}>{children}</div>;
}

export function KindTag({ note, id, className }: { note?: Pick<Note, "kind" | "shelf" | "event">; id?: string; className?: string }) {
  const k = note ? kindOf(note) : kindById(id);
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", className)} style={{ color: k.color }}>
      {k.emoji} {k.name}
    </span>
  );
}

export function TopicTag({ topic }: { topic?: TopicDoc }) {
  if (!topic) return null;
  return (
    <Link to={`/t/${topic.id}`} onClick={(e) => e.stopPropagation()} className="nt-chip !h-6 !px-2 !text-xs">
      {topic.emoji} {topic.name}
    </Link>
  );
}

export function Stars({ value, onChange, size = "sm" }: { value?: number; onChange?: (v: number) => void; size?: "sm" | "lg" }) {
  return (
    <span className={cn("inline-flex", size === "lg" ? "gap-1 text-3xl" : "text-xs")}>
      {[1, 2, 3, 4, 5].map((i) =>
        onChange ? (
          <button key={i} type="button" aria-label={`${i} из 5`} onClick={() => onChange(i)} className={cn("transition", (value ?? 0) >= i ? "" : "opacity-25 grayscale")}>
            ⭐
          </button>
        ) : (
          <span key={i} className={(value ?? 0) >= i ? "" : "opacity-20 grayscale"}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

/** Строка полей типа: «2024 · фантастика · посоветовал Лёша». */
export function propsLine(note: Note) {
  const k = kindOf(note);
  return k.fields
    .map((f) => note.props?.[f.key])
    .filter(Boolean)
    .join(" · ");
}

/** Карточка заметки в списках. */
export function NoteCard({ note, topic, onDone, compact }: { note: NoteDoc; topic?: TopicDoc; onDone?: () => void; compact?: boolean }) {
  const navigate = useNavigate();
  const k = kindOf(note);
  const link = note.links?.[0];
  const text = preview(note.body, compact ? 90 : 160);
  const props = propsLine(note);
  const cover = !compact && (note.cover ?? (note.images?.[0] ? files.url(note.images[0]) : link?.image));
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/n/${note.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/n/${note.id}`)}
      className={cn("nt-paper flex cursor-pointer gap-3 p-3.5 transition hover:shadow-md", note.done && "opacity-60")}
    >
      {onDone && (
        <button
          type="button"
          aria-label={note.done ? "Вернуть в очередь" : `Отметить: ${k.queue}`}
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
          className={cn(
            "mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border-2 text-xs",
            note.done ? "border-transparent bg-[var(--nt-accent)] text-white" : "border-[var(--nt-line)]",
          )}
        >
          {note.done && "✓"}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 font-semibold leading-snug">{titleOf(note)}</div>
          {note.pinned && <span className="text-sm">📌</span>}
        </div>
        {props && <div className="nt-muted mt-0.5 truncate text-xs">{props}</div>}
        {note.done && (note.rating || note.verdict) ? (
          <div className="mt-1 flex items-center gap-2 text-sm">
            {note.rating && <Stars value={note.rating} />}
            {note.verdict && <span className="nt-muted truncate italic">{note.verdict}</span>}
          </div>
        ) : (
          text && text !== titleOf(note) && <p className="nt-muted mt-1 line-clamp-2 text-sm">{text}</p>
        )}
        {link?.title && !compact && !cover && (
          <div className="nt-soft mt-2 flex items-center gap-2 p-2 text-xs">
            <span className="nt-muted">{KIND_LABEL[link.kind]}</span>
            <span className="truncate font-medium">{link.title}</span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindTag note={note} />
          <TopicTag topic={topic} />
          {note.event && <span className="nt-accent text-xs font-medium">📅 {eventWhen(note.event)}</span>}
          {note.due && !note.done && <span className="nt-accent text-xs font-medium">🎯 до {shortDate(note.due)}</span>}
          {note.context?.map((c) => (
            <span key={c} className="text-xs" title={contextById(c)?.name}>
              {contextById(c)?.emoji}
            </span>
          ))}
          {isSnoozed(note) && <span className="nt-muted text-xs">⏰ до {shortDate(note.snoozeUntil!)}</span>}
          {!!note.related?.length && <span className="nt-muted text-xs">🔗 {note.related.length}</span>}
          <span className="nt-muted ml-auto text-xs">{formatRelative(note.capturedAt ?? note.createdAt)}</span>
        </div>
      </div>
      {cover && <img src={cover} alt="" loading="lazy" className="size-16 flex-none rounded-lg object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
    </div>
  );
}

export function LinkPreview({ card }: { card: LinkCard }) {
  return (
    <a href={card.url} target="_blank" rel="noreferrer" className="nt-paper flex gap-3 overflow-hidden p-3">
      {card.image && <img src={card.image} alt="" loading="lazy" className="size-16 flex-none rounded-lg object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
      <div className="min-w-0 flex-1">
        <div className="nt-muted flex items-center gap-1.5 text-xs">
          <span className="nt-chip !h-5 !px-1.5 !text-[10px]">{KIND_LABEL[card.kind]}</span>
          <span className="truncate">{card.site ?? hostOf(card.url)}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{card.title ?? hostOf(card.url)}</div>
        {card.description && <div className="nt-muted mt-0.5 line-clamp-2 text-xs">{card.description}</div>}
      </div>
    </a>
  );
}

export function Gallery({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className={cn("grid gap-2", ids.length > 1 && "grid-cols-2")}>
      {ids.map((id) => (
        <a key={id} href={files.url(id)} target="_blank" rel="noreferrer">
          <img src={files.url(id)} alt="" loading="lazy" className="max-h-80 w-full rounded-xl object-cover" />
        </a>
      ))}
    </div>
  );
}

/** Строка запроса в «Расписание»: дата словами + контекст заметки. */
export function eventRequest(e: NoteEvent, note?: { title: string; body: string }) {
  const parts = [`${e.title} — ${eventWhen(e)} (${e.date})`];
  if (e.end) parts.push(`до ${e.end}`);
  if (e.place) parts.push(`место: ${e.place}`);
  const ctx = note ? preview(note.body, 300) : "";
  return `Добавь в календарь: ${parts.join(", ")}.${ctx ? `\nИз заметки: ${ctx}` : ""}`;
}

/** Запрос в «Дедлайны»: Расписание само разложит дело по свободным окнам. */
export function deadlineRequest(n: Note) {
  const ctx = preview(n.body, 300);
  return `Дедлайн: ${n.title} до ${n.due}${n.effort ? `, примерно ${n.effort} ч` : ""}.${ctx && ctx !== n.title ? `\nИз заметки: ${ctx}` : ""}`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const PLANNER_ASK = "~/m/planner/ask?text=";

/** Отправить событие заметки в «Расписание»: откроется его страница с заполненным запросом. */
export function useSendToCalendar() {
  const navigate = useNavigate();
  return async (note: NoteDoc) => {
    if (!note.event) return;
    await db.collection<Note>("notes").update(note.id, { event: { ...note.event, sentAt: Date.now() } });
    navigate(PLANNER_ASK + encodeURIComponent(eventRequest(note.event, note)));
  };
}

/** Дело со сроком → «Дедлайны» Расписания. */
export function useSendDeadline() {
  const navigate = useNavigate();
  return async (note: NoteDoc) => {
    if (!note.due) return;
    await db.collection<Note>("notes").update(note.id, { dueSentAt: Date.now() });
    navigate(PLANNER_ASK + encodeURIComponent(deadlineRequest(note)));
  };
}

export function EventBox({ event, onSend, compact }: { event: NoteEvent; onSend: () => void; compact?: boolean }) {
  return (
    <div className={cn("nt-soft flex items-center gap-3", compact ? "p-2.5" : "p-3.5")}>
      <div className="text-2xl">📅</div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{event.title}</div>
        <div className="nt-muted text-sm">
          {eventWhen(event)}
          {event.place && ` · ${event.place}`}
        </div>
      </div>
      <button type="button" className={cn("nt-btn nt-btn-sm", !!event.sentAt && "nt-btn-ghost")} onClick={onSend}>
        {event.sentAt ? "Ещё раз" : "В календарь"}
      </button>
    </div>
  );
}

/**
 * Закрыть очередь: «посмотрел» → оценка и впечатление (как в Letterboxd). Для дел — сразу, без оценки.
 * Возвращает функцию, которую вешают на галочку, и модалку, которую надо отрендерить.
 */
export function useDone() {
  const [target, setTarget] = useState<NoteDoc | null>(null);
  const toggle = (n: NoteDoc) => {
    const notes = db.collection<Note>("notes");
    if (n.done) return notes.update(n.id, { done: false, doneAt: null as unknown as undefined });
    if (!kindOf(n).rate) return notes.update(n.id, { done: true, doneAt: Date.now(), snoozeUntil: null as unknown as undefined });
    setTarget(n);
  };
  const modal = <DoneModal note={target} onClose={() => setTarget(null)} />;
  return { toggle, modal };
}

function DoneModal({ note, onClose }: { note: NoteDoc | null; onClose: () => void }) {
  return (
    <Modal open={!!note} onClose={onClose} title={note ? `${cap(kindOf(note).queue ?? "готово")}: ${titleOf(note)}` : ""}>
      {note && <DoneBody key={note.id} note={note} onClose={onClose} />}
    </Modal>
  );
}

function DoneBody({ note, onClose }: { note: NoteDoc; onClose: () => void }) {
  const [rating, setRating] = useState(note.rating ?? 0);
  const [verdict, setVerdict] = useState(note.verdict ?? "");
  const save = async (withRating: boolean) => {
    await db.collection<Note>("notes").update(note.id, {
      done: true,
      doneAt: Date.now(),
      rating: withRating && rating ? rating : undefined,
      verdict: withRating && verdict.trim() ? verdict.trim() : undefined,
      snoozeUntil: null as unknown as undefined,
    });
    onClose();
  };
  return (
    <div className="nt-root -mx-5 -my-4 space-y-4 px-5 py-5 text-center">
      <Stars value={rating} onChange={setRating} size="lg" />
      <input className="nt-field text-center" value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="Впечатление одной строкой (необязательно)" />
      <div className="flex gap-2">
        <button type="button" className="nt-btn nt-btn-ghost flex-1" onClick={() => save(false)}>
          Без оценки
        </button>
        <button type="button" className="nt-btn flex-1" onClick={() => save(true)}>
          Готово
        </button>
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <div className="nt-h2">{title}</div>
      {text && <p className="nt-muted mt-1 max-w-sm text-sm">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function topicMap(topics: TopicDoc[]) {
  return new Map(topics.map((t) => [t.id, t]));
}
