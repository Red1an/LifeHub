import { Link, dayKey, plural, useCollection } from "@lifehub/sdk";
import { usePrefs } from "../lib/gcal.ts";
import { blocksTime, busyFromEvents, freeSlots } from "../lib/slots.ts";
import { deadlineLabel } from "../lib/tasks.ts";
import { useNoteTodos } from "./notetodos.tsx";
import type { CalEvent, Task } from "../lib/types.ts";
import { fromKey, fromMinutes, hhmm, shiftKey } from "../lib/time.ts";

/** Сводка выбранного дня: сколько занято, свободные окна, дедлайны рядом, начало завтра. */
export function DaySummary({ k, events }: { k: string; events: CalEvent[] }) {
  const { prefs } = usePrefs();
  const tasks = useCollection<Task>("tasks");
  const { unplanned } = useNoteTodos();
  const today = dayKey();
  if (k < today) return null;

  const day0 = fromKey(k);
  const next0 = fromKey(shiftKey(k, 1));
  const onDay = events.filter((e) => e.start < next0 && e.end > day0);
  const timed = onDay.filter(blocksTime);
  const busyMin = timed.reduce((s, e) => s + (Math.min(e.end.getTime(), next0.getTime()) - Math.max(e.start.getTime(), day0.getTime())) / 60_000, 0);
  const from = k === today ? new Date() : day0;
  const free = freeSlots(busyFromEvents(events), from, next0, prefs).filter((s) => s.end - s.start >= 30);
  const reminders = onDay.filter((e) => e.kind === "reminder");
  const soon = tasks.items.filter((t) => !t.done && t.deadline >= today && t.deadline <= shiftKey(today, 3)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const tomorrow = k === today ? events.filter((e) => blocksTime(e) && dayKey(e.start) === shiftKey(today, 1)).sort((a, b) => a.start.getTime() - b.start.getTime())[0] : undefined;
  const left = k === today ? timed.filter((e) => e.end.getTime() > Date.now()).length : timed.length;

  return (
    <div className="pl-panel mb-3 space-y-2 p-4 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          📌 {k === today ? "впереди" : "всего"} <b>{left}</b> {plural(left, ["событие", "события", "событий"])}
        </span>
        <span>⏱ занято <b>{Math.round(busyMin / 6) / 10} ч</b></span>
        {reminders.length > 0 && <span>🔔 {reminders.length}</span>}
      </div>
      {free.length > 0 ? (
        <div className="pl-muted">
          Свободно: {free.slice(0, 4).map((s) => `${fromMinutes(s.start)}–${fromMinutes(s.end)}`).join(", ")}
          {free.length > 4 ? "…" : ""}
        </div>
      ) : (
        <div className="pl-muted">Свободных окон от 30 минут нет</div>
      )}
      {soon.length > 0 && (
        <Link to="/tasks" className="block text-[#ffd166]">
          ⏰ {soon.map((t) => `${t.title} — ${deadlineLabel(t)}`).join("; ")}
        </Link>
      )}
      {k === today && unplanned.length > 0 && (
        <Link to="/tasks" className="block text-[var(--pl-pink)]">
          📝 {unplanned.length} {plural(unplanned.length, ["дело", "дела", "дел"])} из заметок без времени — найти окно →
        </Link>
      )}
      {tomorrow && (
        <div className="pl-muted">
          🌅 Завтра первое — {hhmm(tomorrow.start)} «{tomorrow.title}»{tomorrow.location ? `, ${tomorrow.location}` : ""}
        </div>
      )}
    </div>
  );
}
