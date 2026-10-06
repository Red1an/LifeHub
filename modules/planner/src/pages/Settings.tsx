import { useState, type ReactNode } from "react";
import { Link, confirm, toast } from "@lifehub/sdk";
import { Btn, ConnectCard, Panel, Skeleton } from "../components/kit.tsx";
import { createLifehubCalendar, useCalendars, usePrefs, visibleCalendars } from "../lib/gcal.ts";
import { DEFAULT_PREFS } from "../lib/types.ts";
import { timeZone } from "../lib/time.ts";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {hint && <span className="pl-muted mb-1.5 block text-xs">{hint}</span>}
      {children}
    </label>
  );
}

export function SettingsPage() {
  const { calendars, google, error } = useCalendars();
  const { prefs, update } = usePrefs();
  const [creating, setCreating] = useState(false);

  if (!google) return <Wrap><Skeleton /></Wrap>;
  if (!google.connected) return <Wrap><ConnectCard configured={google.configured} /></Wrap>;

  const writable = calendars?.filter((c) => c.accessRole === "owner" || c.accessRole === "writer") ?? [];
  const shown = calendars ? visibleCalendars(calendars, { ...prefs, calendarId: null }).map((c) => c.id) : [];

  return (
    <Wrap>
      <h1 className="pl-title mb-4 text-2xl">Настройки</h1>

      <Panel className="mb-3 space-y-1 text-sm">
        <div>
          Google: <b>{google.email ?? "подключён"}</b>
        </div>
        <div className="pl-muted">Часовой пояс: {timeZone()}</div>
        <Link to="~/settings" className="pl-muted text-xs underline">
          Сменить аккаунт — в настройках хаба
        </Link>
      </Panel>

      {error && <Panel className="mb-3 text-sm text-[#ff9b9b]">{error}</Panel>}

      <Panel className="mb-3 space-y-4">
        <Row label="Куда ставить события" hint="Модуль меняет и удаляет только события, которые поставил сам.">
          <div className="flex gap-2">
            <select className="pl-input" value={prefs.calendarId ?? ""} onChange={(e) => update({ calendarId: e.target.value || null })}>
              <option value="">— не выбран —</option>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                  {c.primary ? " (основной)" : ""}
                </option>
              ))}
            </select>
            {!writable.some((c) => c.summary === "LifeHub") && (
              <Btn
                loading={creating}
                onClick={async () => {
                  setCreating(true);
                  try {
                    const cal = await createLifehubCalendar();
                    update({ calendarId: cal.id });
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                + LifeHub
              </Btn>
            )}
          </div>
        </Row>

        <Row label="Какие календари показывать" hint="Их события видны на неделе и считаются занятым временем.">
          <div className="space-y-1.5">
            {calendars?.map((c) => {
              const on = shown.includes(c.id);
              return (
                <label key={c.id} className="pl-soft flex min-h-11 items-center gap-3 px-3">
                  <input
                    type="checkbox"
                    checked={on || c.id === prefs.calendarId}
                    disabled={c.id === prefs.calendarId}
                    onChange={() => update({ readCalendars: on ? shown.filter((x) => x !== c.id) : [...shown, c.id] })}
                  />
                  <span className="size-3 flex-none rounded-full" style={{ background: c.backgroundColor }} />
                  <span className="truncate text-sm">{c.summary}</span>
                </label>
              );
            }) ?? <Skeleton rows={2} />}
          </div>
        </Row>
      </Panel>

      <Panel className="mb-3 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Row label="День с">
            <input type="time" className="pl-input" value={prefs.dayStart} onChange={(e) => e.target.value && update({ dayStart: e.target.value })} />
          </Row>
          <Row label="до">
            <input type="time" className="pl-input" value={prefs.dayEnd} onChange={(e) => e.target.value && update({ dayEnd: e.target.value })} />
          </Row>
          <Row label="Длительность, мин" hint="если не указана">
            <input type="number" min={5} max={600} className="pl-input" value={prefs.defaultMinutes} onChange={(e) => update({ defaultMinutes: Math.max(5, Number(e.target.value) || 60) })} />
          </Row>
          <Row label="Перерыв, мин" hint="между событиями">
            <input type="number" min={0} max={120} className="pl-input" value={prefs.buffer} onChange={(e) => update({ buffer: Math.max(0, Number(e.target.value) || 0) })} />
          </Row>
          <Row label="Напоминание">
            <select className="pl-input" value={prefs.reminder} onChange={(e) => update({ reminder: Number(e.target.value) })}>
              <option value={-1}>без напоминания</option>
              {[0, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m ? `за ${m} мин` : "в момент начала"}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Смотреть вперёд" hint="дней занятости">
            <select className="pl-input" value={prefs.horizon} onChange={(e) => update({ horizon: Number(e.target.value) })}>
              {[7, 14, 31, 62].map((d) => (
                <option key={d} value={d}>
                  {d} дн.
                </option>
              ))}
            </select>
          </Row>
        </div>
        <Row label="Мои правила" hint="Нейронка учитывает их в каждом запросе.">
          <textarea
            className="pl-input min-h-28"
            placeholder={"Например:\nпо субботам до 12:00 ничего не ставить\nтренировки — только после 18:00\nобед 13:00–14:00"}
            defaultValue={prefs.notes}
            onBlur={(e) => e.target.value !== prefs.notes && update({ notes: e.target.value })}
          />
        </Row>
      </Panel>

      <Btn
        onClick={async () => {
          if (await confirm("Вернуть настройки по умолчанию? Выбор календаря сохранится.")) update({ ...DEFAULT_PREFS, calendarId: prefs.calendarId });
        }}
      >
        Сбросить настройки
      </Btn>
    </Wrap>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4 sm:px-6">{children}</div>;
}
