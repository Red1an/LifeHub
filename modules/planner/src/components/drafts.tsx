import { useEffect, useState } from "react";
import { Modal, cn } from "@lifehub/sdk";
import { CATEGORIES, type CalEvent, type Category, type Draft } from "../lib/types.ts";
import { conflicts, draftWhen } from "../lib/planner.ts";
import { RRULE_DAYS, WEEKDAYS, dayLabel } from "../lib/time.ts";
import { Btn } from "./kit.tsx";
import { AutoTextarea } from "./input.tsx";

const OPS = {
  create: { label: "новое", cls: "pl-op-create", sign: "+" },
  update: { label: "изменить", cls: "pl-op-update", sign: "✎" },
  delete: { label: "удалить", cls: "pl-op-delete", sign: "−" },
};

export function DraftCard({ d, events, onToggle, onEdit }: { d: Draft; events: CalEvent[]; onToggle: () => void; onEdit: () => void }) {
  const cat = CATEGORIES[d.category];
  const clash = conflicts(d, events);
  const op = OPS[d.op];
  return (
    <div className={cn("pl-draft flex items-stretch", d.skip && "pl-draft-skip")}>
      <button onClick={onToggle} className="flex w-12 flex-none items-center justify-center" aria-label={d.skip ? "Включить" : "Не добавлять"}>
        <span
          className={cn("flex size-6 items-center justify-center rounded-lg border text-sm font-bold", d.skip ? "border-[var(--pl-line)]" : "border-transparent text-white")}
          style={d.skip ? undefined : { background: cat.color }}
        >
          {d.skip ? "" : "✓"}
        </span>
      </button>
      <button onClick={onEdit} className="min-w-0 flex-1 py-3 pr-3 text-left">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("font-semibold", op.cls)}>
            {op.sign} {op.label}
          </span>
          <span className="pl-muted">{dayLabel(d.date)}</span>
        </div>
        <div className={cn("mt-0.5 font-semibold", d.op === "delete" && "line-through")}>{d.title}</div>
        <div className="pl-muted mt-0.5 text-sm">
          {cat.icon} {draftWhen(d)}
          {d.location ? ` · 📍 ${d.location}` : ""}
        </div>
        {clash.length > 0 && !d.skip && <div className="mt-1 text-xs text-[#ffd166]">⚠ пересекается с «{clash[0].title}»{clash.length > 1 ? ` и ещё ${clash.length - 1}` : ""}</div>}
      </button>
    </div>
  );
}

export function DraftEditor({ draft, onClose, onSave, onDelete }: { draft: Draft | null; onClose: () => void; onSave: (d: Draft) => void; onDelete: () => void }) {
  const [d, setD] = useState<Draft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return <Modal open={false} onClose={onClose} />;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const allDay = !d.start;
  const rec = d.recurrence;
  return (
    <Modal
      open
      onClose={onClose}
      title={d.op === "create" ? "Новое событие" : d.op === "update" ? "Изменение события" : "Удаление события"}
      footer={
        <div className="flex w-full gap-2">
          <Btn onClick={onDelete} className="text-[#ff7a7a]">
            Убрать
          </Btn>
          <div className="flex-1" />
          <Btn main onClick={() => onSave(d)}>
            Готово
          </Btn>
        </div>
      }
    >
      <div className="space-y-3">
        <input className="pl-input text-lg font-semibold" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 text-sm sm:col-span-1">
            <span className="pl-muted mb-1 block text-xs">Дата{rec ? " первого раза" : ""}</span>
            <input type="date" className="pl-input" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </label>
          <label className="col-span-2 flex items-end gap-2 pb-3 text-sm sm:col-span-1">
            <input type="checkbox" checked={allDay} onChange={(e) => set(e.target.checked ? { start: undefined, end: undefined } : { start: "09:00", end: "10:00" })} />
            Весь день
          </label>
          {!allDay && (
            <>
              <label className="text-sm">
                <span className="pl-muted mb-1 block text-xs">Начало</span>
                <input type="time" className="pl-input" value={d.start} onChange={(e) => e.target.value && set({ start: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="pl-muted mb-1 block text-xs">Конец</span>
                <input type="time" className="pl-input" value={d.end ?? ""} onChange={(e) => set({ end: e.target.value || undefined })} />
              </label>
            </>
          )}
        </div>

        <div>
          <span className="pl-muted mb-1.5 block text-xs">Категория</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORIES) as Category[]).map((c) => (
              <button key={c} className="pl-chip" aria-pressed={d.category === c} onClick={() => set({ category: c })}>
                {CATEGORIES[c].icon} {CATEGORIES[c].label}
              </button>
            ))}
          </div>
        </div>

        {d.op === "create" && (
          <div>
            <span className="pl-muted mb-1.5 block text-xs">Повтор</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: "", label: "нет" },
                { id: "DAILY", label: "каждый день" },
                { id: "WEEKLY", label: "по неделям" },
                { id: "MONTHLY", label: "каждый месяц" },
              ].map((o) => (
                <button
                  key={o.id}
                  className="pl-chip"
                  aria-pressed={(rec?.freq ?? "") === o.id}
                  onClick={() => set({ recurrence: o.id ? { ...rec, freq: o.id as "DAILY" } : undefined })}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {rec?.freq === "WEEKLY" && (
              <div className="mt-2 grid grid-cols-7 gap-1">
                {RRULE_DAYS.map((day, i) => {
                  const on = rec.byDay?.includes(day) ?? false;
                  return (
                    <button
                      key={day}
                      className="pl-chip justify-center px-0"
                      aria-pressed={on}
                      onClick={() => set({ recurrence: { ...rec, byDay: on ? rec.byDay!.filter((x) => x !== day) : [...(rec.byDay ?? []), day].sort((a, b) => RRULE_DAYS.indexOf(a) - RRULE_DAYS.indexOf(b)) } })}
                    >
                      {WEEKDAYS[i]}
                    </button>
                  );
                })}
              </div>
            )}
            {rec && (
              <label className="mt-2 block text-sm">
                <span className="pl-muted mb-1 block text-xs">До (необязательно)</span>
                <input type="date" className="pl-input" value={rec.until ?? ""} onChange={(e) => set({ recurrence: { ...rec, until: e.target.value || undefined, count: undefined } })} />
              </label>
            )}
          </div>
        )}

        <input className="pl-input" placeholder="Место" value={d.location ?? ""} onChange={(e) => set({ location: e.target.value || undefined })} />
        <AutoTextarea minRows={2} placeholder="Описание" value={d.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
        <label className="block text-sm">
          <span className="pl-muted mb-1 block text-xs">Напоминание</span>
          <select
            className="pl-input"
            value={d.reminder === undefined ? "default" : d.reminder === null ? "none" : String(d.reminder)}
            onChange={(e) => set({ reminder: e.target.value === "default" ? undefined : e.target.value === "none" ? null : Number(e.target.value) })}
          >
            <option value="default">как в настройках</option>
            <option value="none">без напоминания</option>
            {[0, 5, 10, 15, 30, 60, 120, 1440].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "в момент начала" : m < 60 ? `за ${m} мин` : m === 1440 ? "за день" : `за ${m / 60} ч`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
