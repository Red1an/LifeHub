import { useEffect, useMemo, useState } from "react";
import { Link, Modal, cn, dayKey, toast, uid, useCollection } from "@lifehub/sdk";
import { applyDraft, eventsChanged, loadBusy, usePrefs } from "../lib/gcal.ts";
import { busyFromEvents, nextSlots, type Slot } from "../lib/slots.ts";
import { categoryOf, linkNote, markNoteDone, todosFrom, type NoteTodo } from "../lib/notes.ts";
import { dayLabel, fromMinutes } from "../lib/time.ts";
import type { Draft, NoteLink } from "../lib/types.ts";
import { Btn, ErrorBox, Panel, Skeleton } from "./kit.tsx";

/**
 * Открытые дела из «Заметок», которым ещё не назначено время. Сами дела живут в «Заметках»
 * (нужно разрешение read:notes); если модуля нет или он старый — available = false.
 */
export function useNoteTodos() {
  const notes = useCollection<Record<string, unknown>>("notes", { from: "notes" });
  const links = useCollection<NoteLink>("links");
  const today = dayKey();
  const linkOf = useMemo(() => new Map(links.items.map((l) => [l.id, l])), [links.items]);
  // Отмечено здесь, а «Заметки» ещё не открывали — уже не показываем. Дошло и там сняли галочку — дело снова открыто.
  const todos = useMemo(() => todosFrom(notes.items, today).filter((t) => {
    const l = linkOf.get(t.id);
    return !(l?.done && (l.doneAt ?? 0) > t.seen);
  }), [notes.items, linkOf, today]);
  // Без времени: ещё не ставили, всё поставленное уже прошло или отметка старая.
  const unplanned = todos.filter((t) => {
    const l = linkOf.get(t.id);
    return !l || l.done || l.date < today;
  });
  /** Заметки, закрытые в «Заметках», — чтобы подсказать закрыть и задачу. */
  const doneInNotes = useMemo(() => new Set(notes.items.filter((n) => n.done === true).map((n) => n.id)), [notes.items]);
  return { todos, unplanned, linkOf, doneInNotes, loading: notes.loading, available: !notes.error };
}

const preview = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function NoteTodos({ onDeadline, openId, onOpened }: { onDeadline: (t: NoteTodo) => void; openId?: string | null; onOpened?: () => void }) {
  const { todos, unplanned, linkOf, loading, available } = useNoteTodos();
  const [placing, setPlacing] = useState<NoteTodo | null>(null);
  const [all, setAll] = useState(false);

  // ?note=<id> — «Найти время» из самой заметки.
  useEffect(() => {
    if (!openId || loading) return;
    const t = todos.find((x) => x.id === openId);
    if (t) setPlacing(t);
    else toast("Это дело уже закрыто или ещё не разобрано в «Заметках»", "info");
    onOpened?.();
  }, [openId, loading]);

  if (!available || loading || !todos.length) return null;
  const list = all ? todos : unplanned;

  return (
    <Panel className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">📝 Дела из заметок</div>
        {todos.length > unplanned.length && (
          <button className="pl-muted text-xs underline" onClick={() => setAll((v) => !v)}>
            {all ? "только без времени" : `все (${todos.length})`}
          </button>
        )}
      </div>
      {!list.length && <div className="pl-muted text-sm">Всем делам уже назначено время ✨</div>}
      {list.map((t) => {
        const l = linkOf.get(t.id);
        const ahead = l && !l.done && l.date >= dayKey();
        return (
          <div key={t.id} className="pl-soft flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t.title}</div>
              <div className="pl-muted text-xs">
                {[
                  t.due && `срок — ${dayLabel(t.due).toLowerCase()}`,
                  t.effort && `~${t.effort} ч`,
                  l && !l.done && (ahead ? `в календаре: ${dayLabel(l.date).toLowerCase()}${l.start ? `, ${l.start}` : ""}` : `было ${dayLabel(l.date).toLowerCase()} — не успел?`),
                ]
                  .filter(Boolean)
                  .join(" · ") || "без срока"}
              </div>
            </div>
            <Btn className="px-3 text-sm" onClick={() => setPlacing(t)}>
              ⏱ Найти время
            </Btn>
            {t.due && (
              <Btn className="px-3 text-sm" onClick={() => onDeadline(t)}>
                🎯 До срока
              </Btn>
            )}
            <Btn className="px-3 text-sm" aria-label="Сделал" title="Сделал — закроется и в «Заметках»" onClick={() => markNoteDone(t.id, t.title).then(() => toast("Сделано ✅", "success"))}>
              ✅
            </Btn>
          </div>
        );
      })}
      <div className="pl-muted text-xs">
        Сами дела — в <Link to="~/m/notes/shelves" className="underline">«Заметках»</Link>. Отметка «сделал» здесь или в событии закроет дело и там.
      </div>
      <PlaceModal todo={placing} onClose={() => setPlacing(null)} />
    </Panel>
  );
}

const LENGTHS = [15, 30, 60, 90, 120];

/** Ближайшие свободные окна для дела; выбор сразу ставит событие, привязанное к заметке. */
function PlaceModal({ todo, onClose }: { todo: NoteTodo | null; onClose: () => void }) {
  const { prefs } = usePrefs();
  const [minutes, setMinutes] = useState(30);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (todo) setMinutes(todo.effort ? LENGTHS.reduce((a, b) => (Math.abs(b - todo.effort! * 60) < Math.abs(a - todo.effort! * 60) ? b : a)) : 30);
  }, [todo?.id]);

  useEffect(() => {
    if (!todo) return;
    setSlots(null);
    setError(null);
    let alive = true;
    (async () => {
      const events = await loadBusy(prefs, 14);
      // Есть срок — только окна до конца дня срока.
      const before = todo.due ? new Date(`${todo.due}T${prefs.dayEnd === "00:00" ? "23:59" : prefs.dayEnd}:00`) : undefined;
      if (alive) setSlots(nextSlots(busyFromEvents(events), minutes, prefs, { before, count: 6 }));
    })().catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [todo?.id, minutes]);

  if (!todo) return <Modal open={false} onClose={onClose} />;

  const pick = async (s: Slot) => {
    setBusy(true);
    try {
      const draft: Draft = {
        key: uid(),
        op: "create",
        kind: "event",
        title: `✅ ${todo.title}`,
        date: s.date,
        start: fromMinutes(s.start),
        end: fromMinutes(s.end),
        category: categoryOf(todo.area),
        description: [todo.body && todo.body !== todo.title ? preview(todo.body, 400) : "", "Дело из «Заметок»."].filter(Boolean).join("\n\n"),
        reminders: [10],
        source: "notes",
        noteId: todo.id,
      };
      const eventId = await applyDraft(draft, prefs);
      await linkNote(todo.id, todo.title, [{ draft, eventId, calendarId: prefs.calendarId ?? "primary" }]);
      eventsChanged();
      toast(`Поставил: ${dayLabel(s.date).toLowerCase()}, ${draft.start}`, "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Найти время">
      <div className="space-y-3">
        <div className="text-sm">
          <b>{todo.title}</b>
          {todo.due && <div className="pl-muted">успеть до {dayLabel(todo.due).toLowerCase()}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LENGTHS.map((m) => (
            <button key={m} className={cn("pl-chip")} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
              {m < 60 ? `${m} мин` : `${m / 60} ч`}
            </button>
          ))}
        </div>
        {error && <ErrorBox text={error} />}
        {!slots && !error && <Skeleton rows={3} />}
        {slots && slots.length === 0 && <ErrorBox text={todo.due ? "До срока нет свободного окна такой длины — попробуйте короче." : "В ближайшие две недели нет свободного окна такой длины."} />}
        {slots && slots.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((s) => (
              <Btn key={`${s.date}-${s.start}`} loading={busy} onClick={() => pick(s)} className="justify-start text-left">
                {dayLabel(s.date)}, {fromMinutes(s.start)}–{fromMinutes(s.end)}
              </Btn>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
