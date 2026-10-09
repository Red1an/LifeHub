import { useEffect, useState } from "react";
import { Modal, toast } from "@lifehub/sdk";
import { loadBusy, moveEvent, usePrefs } from "../lib/gcal.ts";
import { busyFromEvents, nextSlots, type Slot } from "../lib/slots.ts";
import { tasksDb } from "../lib/tasks.ts";
import { dayLabel, fromMinutes } from "../lib/time.ts";
import type { CalEvent } from "../lib/types.ts";
import { Btn, ErrorBox, Skeleton } from "./kit.tsx";

export interface MoveTarget {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  taskId?: string;
}

/** «Не успел»: ближайшие свободные окна той же длины; для блоков задачи — только до дедлайна. */
export function MoveModal({ target, onClose, onMoved }: { target: MoveTarget | null; onClose: () => void; onMoved?: () => void }) {
  const { prefs } = usePrefs();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setSlots(null);
    setError(null);
    (async () => {
      const minutes = Math.max(15, Math.round((target.end.getTime() - target.start.getTime()) / 60_000));
      let before: Date | undefined;
      if (target.taskId) {
        const t = await tasksDb().get(target.taskId);
        if (t) {
          before = new Date(`${t.deadline}T${t.deadlineTime ?? prefs.dayEnd}:00`);
          setDeadline(`${dayLabel(t.deadline).toLowerCase()}${t.deadlineTime ? ` ${t.deadlineTime}` : ""}`);
        }
      }
      const events = await loadBusy(prefs, 30);
      const others = events.filter((e: CalEvent) => !(e.id === target.id && e.calendarId === target.calendarId));
      setSlots(nextSlots(busyFromEvents(others), minutes, prefs, { from: new Date(), before, count: 6 }));
    })().catch((e) => setError((e as Error).message));
  }, [target?.id]);

  if (!target) return <Modal open={false} onClose={onClose} />;

  const pick = async (s: Slot) => {
    setBusy(true);
    try {
      const start = fromMinutes(s.start);
      const end = fromMinutes(s.end);
      await moveEvent({ id: target.id, calendarId: target.calendarId } as CalEvent, s.date, start, end);
      if (target.taskId) {
        const col = tasksDb();
        const t = await col.get(target.taskId);
        if (t) await col.update(target.taskId, { blocks: t.blocks.map((b) => (b.eventId === target.id ? { ...b, date: s.date, start, end, missed: false } : b)) });
      }
      toast(`Перенесено: ${dayLabel(s.date).toLowerCase()}, ${start}`, "success");
      onMoved?.();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Перенести">
      <div className="space-y-3">
        <div className="text-sm">
          <b>{target.title}</b>
          <div className="pl-muted">
            {Math.round((target.end.getTime() - target.start.getTime()) / 60_000)} мин{deadline ? ` · успеть до ${deadline}` : ""}
          </div>
        </div>
        {error && <ErrorBox text={error} />}
        {!slots && !error && <Skeleton rows={3} />}
        {slots && slots.length === 0 && (
          <ErrorBox text={deadline ? "До дедлайна нет свободного окна такой длины. Освободите время или сдвиньте границы дня в настройках." : "В ближайший месяц нет свободного окна такой длины."} />
        )}
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

