import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, Modal, Spinner, confirm, cn, toast } from "@lifehub/sdk";
import { CATEGORIES, type CalEvent, type CalendarInfo } from "../lib/types.ts";
import { createLifehubCalendar, deleteEvent, usePrefs } from "../lib/gcal.ts";
import { markBlock } from "../lib/tasks.ts";
import { dayLabel, hhmm } from "../lib/time.ts";
import { dayKey } from "@lifehub/sdk";

export function Btn({ main, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { main?: boolean; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cn("pl-btn", main && "pl-btn-main", className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("pl-panel p-4 sm:p-5", className)}>{children}</div>;
}

/** Google не подключён — объясняем, что делать. */
export function ConnectCard({ configured }: { configured: boolean }) {
  return (
    <Panel className="space-y-3">
      <div className="text-3xl">🔗</div>
      <h2 className="pl-title text-xl">Подключите Google Календарь</h2>
      <p className="pl-muted text-sm leading-relaxed">
        {configured
          ? "Клиент Google уже указан в хабе — осталось войти в аккаунт. Это делается один раз на компьютере, где запущен хаб."
          : "Один раз на компьютере с хабом: создайте OAuth-клиент Google (5 минут, пошаговая инструкция есть в настройках) и войдите в аккаунт. После этого расписание работает и с телефона."}
      </p>
      <Link to="~/settings" className="pl-btn pl-btn-main w-full sm:w-auto">
        Открыть настройки хаба → Google
      </Link>
    </Panel>
  );
}

/** Первый запуск: куда ставить события. */
export function CalendarSetup({ calendars }: { calendars: CalendarInfo[] }) {
  const { update } = usePrefs();
  const [busy, setBusy] = useState(false);
  const existing = calendars.find((c) => c.summary === "LifeHub" && c.accessRole === "owner");
  const primary = calendars.find((c) => c.primary);
  return (
    <Panel className="space-y-3">
      <div className="text-3xl">🗓️</div>
      <h2 className="pl-title text-xl">Куда ставить события?</h2>
      <p className="pl-muted text-sm leading-relaxed">
        Советую отдельный календарь «LifeHub»: его события видны рядом с остальными, их легко скрыть одной галочкой или удалить разом, а ваши
        собственные события модуль не трогает.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Btn
          main
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const cal = existing ?? (await createLifehubCalendar());
              update({ calendarId: cal.id });
              toast(existing ? "Выбран календарь «LifeHub»" : "Календарь «LifeHub» создан", "success");
            } catch (e) {
              toast((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {existing ? "Использовать «LifeHub»" : "Создать календарь «LifeHub»"}
        </Btn>
        {primary && <Btn onClick={() => update({ calendarId: primary.id })}>В основной календарь</Btn>}
      </div>
    </Panel>
  );
}

export function EventRow({ e, onClick }: { e: CalEvent; onClick: () => void }) {
  const past = e.end.getTime() < Date.now();
  return (
    <button className={cn("pl-event", past && "pl-event-past")} style={{ ["--c" as string]: e.color }} onClick={onClick}>
      <div className="w-12 flex-none pt-0.5 text-sm tabular-nums">
        {e.allDay ? <span className="pl-muted">весь день</span> : (
          <>
            <div className="font-semibold">{hhmm(e.start)}</div>
            {e.kind !== "reminder" && <div className="pl-muted text-xs">{hhmm(e.end)}</div>}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">
          {e.kind === "reminder" && "🔔 "}
          {e.title}
        </div>
        {(e.location || e.recurringEventId || e.ours) && (
          <div className="pl-muted mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {e.location && <span className="truncate">📍 {e.location}</span>}
            {e.recurringEventId && <span>🔁 повтор</span>}
            {e.ours && <span>✨ LifeHub</span>}
          </div>
        )}
      </div>
    </button>
  );
}

export function EventModal({ e, onClose, onMove }: { e: CalEvent | null; onClose: () => void; onMove?: (e: CalEvent) => void }) {
  const [busy, setBusy] = useState(false);
  if (!e) return <Modal open={false} onClose={onClose} />;
  const remove = async (series: boolean) => {
    const what = series ? "всю серию повторов" : e.recurringEventId ? "только этот день" : "событие";
    if (!(await confirm(`Удалить ${what} «${e.title}» из Google Календаря?`, { danger: true, confirmText: "Удалить" }))) return;
    setBusy(true);
    try {
      await deleteEvent(e, series);
      toast("Удалено", "success");
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const cat = e.category ? CATEGORIES[e.category] : null;
  return (
    <Modal open onClose={onClose} title={e.title}>
      <div className="space-y-3 text-sm">
        <div>
          {dayLabel(dayKey(e.start))}
          {e.allDay ? ", весь день" : `, ${hhmm(e.start)}–${hhmm(e.end)}`}
          {e.recurringEventId && " · 🔁 повторяется"}
        </div>
        {cat && (
          <div>
            {cat.icon} {cat.label}
          </div>
        )}
        {e.location && <div>📍 {e.location}</div>}
        {e.description && <div className="whitespace-pre-wrap text-muted">{e.description}</div>}
        {e.ours && <div className="text-muted">✨ Поставлено модулем «Расписание»</div>}
        <div className="flex flex-wrap gap-2 pt-2">
          {e.taskId && (
            <Btn
              main
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await markBlock(e.taskId!, e.id);
                  toast(r?.finished ? "Задача выполнена целиком 🎉" : "Отмечено: сделал", "success");
                  onClose();
                } catch (err) {
                  toast((err as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              ✅ Сделал
            </Btn>
          )}
          {e.canEdit && onMove && !e.allDay && (
            <Btn
              onClick={() => {
                onMove(e);
                onClose();
              }}
            >
              {e.end.getTime() < Date.now() ? "↪ Не успел — перенести" : "↪ Перенести"}
            </Btn>
          )}
          {e.htmlLink && (
            <a className="pl-btn" href={e.htmlLink} target="_blank" rel="noreferrer">
              Открыть в Google
            </a>
          )}
          {e.canEdit && (
            <Btn loading={busy} onClick={() => remove(false)} className="text-[#ff7a7a]">
              {e.recurringEventId ? "Удалить этот день" : "Удалить"}
            </Btn>
          )}
          {e.canEdit && e.recurringEventId && (
            <Btn loading={busy} onClick={() => remove(true)} className="text-[#ff7a7a]">
              Удалить серию
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="pl-shimmer h-16" />
      ))}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-2xl bg-[#ff5a5a1f] p-4 text-sm text-[#ff9b9b]">{text}</div>;
}
