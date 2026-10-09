import { useMemo, useState } from "react";
import { Link, cn, dayKey, startOfWeek, useSearchParams } from "@lifehub/sdk";
import { Btn, CalendarSetup, ConnectCard, ErrorBox, EventModal, EventRow, Panel, Skeleton } from "../components/kit.tsx";
import { useEvents, usePrefs } from "../lib/gcal.ts";
import { MoveModal } from "../components/move.tsx";
import { DaySummary } from "../components/summary.tsx";
import { WEEKDAYS, dayLabel, fromKey, monthTitle, shiftKey } from "../lib/time.ts";
import type { CalEvent } from "../lib/types.ts";

/** События, которые попадают на день (многодневные — на каждый свой день). */
function eventsOn(events: CalEvent[], k: string) {
  const s = fromKey(k).getTime();
  const e = s + 86_400_000;
  return events.filter((x) => x.start.getTime() < e && x.end.getTime() > s);
}

export function WeekPage() {
  const [params, setParams] = useSearchParams();
  const today = dayKey();
  const selected = params.get("d") ?? today;
  const weekStart = dayKey(startOfWeek(fromKey(selected)));
  const from = useMemo(() => fromKey(weekStart), [weekStart]);
  const to = useMemo(() => fromKey(shiftKey(weekStart, 7)), [weekStart]);
  const { events, error, google, calendars } = useEvents(from, to);
  const { prefs } = usePrefs();
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [moving, setMoving] = useState<CalEvent | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => shiftKey(weekStart, i));
  const go = (k: string) => setParams({ d: k });

  let body;
  if (!google) body = <Skeleton />;
  else if (!google.connected) body = <ConnectCard configured={google.configured} />;
  else if (calendars && !prefs.calendarId) body = <CalendarSetup calendars={calendars} />;
  else if (error) body = <ErrorBox text={error} />;
  else if (!events) body = <Skeleton rows={4} />;
  else
    body = (
      <>
        <DaySummary k={selected} events={events} />
        {/* Телефон: выбранный день */}
        <div className="lg:hidden">
          <DayList k={selected} events={eventsOn(events, selected)} onOpen={setOpen} />
        </div>
        {/* Компьютер: вся неделя */}
        <div className="hidden gap-3 lg:grid lg:grid-cols-7">
          {days.map((k) => (
            <div key={k} className="min-w-0">
              <button onClick={() => go(k)} className={cn("mb-2 w-full text-left text-sm font-semibold", k === today && "text-[var(--pl-pink)]")}>
                {WEEKDAYS[days.indexOf(k)]} {fromKey(k).getDate()}
              </button>
              <div className="space-y-2">
                {eventsOn(events, k).map((e) => (
                  <button
                    key={e.calendarId + e.id}
                    onClick={() => setOpen(e)}
                    className={cn("pl-event block p-2.5 pl-3 text-xs", e.end.getTime() < Date.now() && "pl-event-past")}
                    style={{ ["--c" as string]: e.color }}
                  >
                    <div className="pl-muted tabular-nums">{e.allDay ? "весь день" : e.start.toTimeString().slice(0, 5)}</div>
                    <div className="line-clamp-3 font-semibold">{e.title}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="pl-title text-2xl sm:text-3xl">{monthTitle(fromKey(selected))}</h1>
          <div className="pl-muted text-sm">{dayLabel(selected)}</div>
        </div>
        <div className="flex gap-1.5">
          <Btn className="pl-icon-btn" aria-label="Предыдущая неделя" onClick={() => go(shiftKey(selected, -7))}>
            ‹
          </Btn>
          {selected !== today && (
            <Btn onClick={() => go(today)} className="px-3 text-sm">
              Сегодня
            </Btn>
          )}
          <Btn className="pl-icon-btn" aria-label="Следующая неделя" onClick={() => go(shiftKey(selected, 7))}>
            ›
          </Btn>
        </div>
      </div>

      <div className="pl-panel mb-4 grid grid-cols-7 gap-1 p-1.5">
        {days.map((k, i) => {
          const dots = events ? eventsOn(events, k).slice(0, 3) : [];
          return (
            <button key={k} className={cn("pl-day", k === today && "pl-day-today")} aria-selected={k === selected} onClick={() => go(k)}>
              <span className="text-[11px] uppercase opacity-70">{WEEKDAYS[i]}</span>
              <span className="pl-day-num">{fromKey(k).getDate()}</span>
              <span className="flex h-[5px] gap-0.5">
                {dots.map((e) => (
                  <span key={e.calendarId + e.id} className="pl-dot" style={{ background: k === selected ? "#fff" : e.color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {body}

      {google?.connected && prefs.calendarId && (
        <Link to={`/ask`} className="pl-btn pl-btn-main pl-fab">
          ✨ Запланировать
        </Link>
      )}
      <EventModal e={open} onClose={() => setOpen(null)} onMove={setMoving} />
      <MoveModal target={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function DayList({ k, events, onOpen }: { k: string; events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  if (!events.length)
    return (
      <Panel className="py-10 text-center">
        <div className="text-3xl">🌙</div>
        <div className="mt-2 font-semibold">Свободный день</div>
        <div className="pl-muted mt-1 text-sm">Попросите расписание — например, «поставь тренировку и 2 часа учёбы»</div>
      </Panel>
    );
  const isToday = k === dayKey();
  const now = Date.now();
  const nowIdx = isToday ? events.findIndex((e) => !e.allDay && e.start.getTime() > now) : -1;
  return (
    <div className="space-y-2">
      {events.map((e, i) => (
        <div key={e.calendarId + e.id}>
          {i === nowIdx && <div className="pl-now mb-2" />}
          <EventRow e={e} onClick={() => onOpen(e)} />
        </div>
      ))}
    </div>
  );
}
