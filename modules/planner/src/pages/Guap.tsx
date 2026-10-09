import { useEffect, useMemo, useState, type ReactNode } from "react";
import { confirm, plural, toast, useGoogle, useNavigate } from "@lifehub/sdk";
import { Btn, CalendarSetup, ConnectCard, ErrorBox, Panel, Skeleton } from "../components/kit.tsx";
import { AutoTextarea } from "../components/input.tsx";
import { applyDraft, deleteById, eventsChanged, listOurBySource, useCalendars, usePrefs } from "../lib/gcal.ts";
import { defaultUntil, fetchSchedule, lessonsToDrafts, parseText, type GuapSchedule, type Parity } from "../lib/guap.ts";
import { WEEKDAYS_LONG, dayLabel } from "../lib/time.ts";
import { reminderLabel } from "../lib/types.ts";

const PARITY: Record<Parity, { mark: string; label: string }> = {
  odd: { mark: "▲", label: "верхняя (нечётная)" },
  even: { mark: "▼", label: "нижняя (чётная)" },
  both: { mark: "●", label: "каждую неделю" },
};

export function GuapPage() {
  const { status } = useGoogle();
  const { calendars } = useCalendars();
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();
  const [group, setGroup] = useState(prefs.guapGroup);
  const [until, setUntil] = useState(prefs.guapUntil || defaultUntil());
  const [schedule, setSchedule] = useState<GuapSchedule | null>(null);
  const [parity, setParity] = useState<Parity>("odd");
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<number | null>(null);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => setGroup((g) => g || prefs.guapGroup), [prefs.guapGroup]);
  useEffect(() => {
    if (status?.connected && prefs.calendarId) listOurBySource(prefs, "guap").then((l) => setExisting(l.length)).catch(() => setExisting(null));
  }, [status?.connected, prefs.calendarId]);

  const accept = (s: GuapSchedule) => {
    if (!s.lessons.length) throw new Error("Не нашёл занятий. Проверьте, что вставлен текст расписания с днями и парами.");
    setSchedule(s);
    if (s.currentParity) setParity(s.currentParity);
    if (s.group && !group) setGroup(s.group);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      accept(await fetchSchedule(group));
      update({ guapGroup: group.trim() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const drafts = useMemo(() => (schedule ? lessonsToDrafts(schedule, parity, until, prefs.guapReminder) : []), [schedule, parity, until, prefs.guapReminder]);

  const apply = async () => {
    if (!schedule) return;
    const old = existing ? await listOurBySource(prefs, "guap") : [];
    if (old.length && !(await confirm(`В календаре уже есть расписание ГУАП (${old.length} ${plural(old.length, ["серия", "серии", "серий"])}). Заменить его новым?`))) return;
    const total = old.length + drafts.length;
    setApplying({ done: 0, total });
    let failed = 0;
    let lastError = "";
    const tick = () => setApplying((a) => a && { ...a, done: a.done + 1 });
    for (const o of old) {
      await deleteById(prefs.calendarId ?? "primary", o.id).catch(() => {});
      tick();
    }
    for (const d of drafts) {
      try {
        await applyDraft(d, prefs);
      } catch (e) {
        failed++;
        lastError = (e as Error).message;
      }
      tick();
    }
    setApplying(null);
    update({ guapGroup: schedule.group || group, guapUntil: until });
    eventsChanged();
    if (failed) toast(`Не получилось ${failed} из ${drafts.length}: ${lastError}`, "error");
    else toast(`Расписание поставлено: ${drafts.length} ${plural(drafts.length, ["занятие", "занятия", "занятий"])} до ${dayLabel(until).toLowerCase()}`, "success");
    navigate(`/?d=${drafts.map((d) => d.date).sort()[0] ?? ""}`);
  };

  const removeAll = async () => {
    const old = await listOurBySource(prefs, "guap");
    if (!old.length) return;
    if (!(await confirm(`Убрать расписание ГУАП из календаря (${old.length} ${plural(old.length, ["серия", "серии", "серий"])})?`, { danger: true, confirmText: "Убрать" }))) return;
    for (const o of old) await deleteById(prefs.calendarId ?? "primary", o.id).catch(() => {});
    setExisting(0);
    eventsChanged();
    toast("Расписание ГУАП убрано", "success");
  };

  if (!status) return <Wrap><Skeleton /></Wrap>;
  if (!status.connected) return <Wrap><ConnectCard configured={status.configured} /></Wrap>;
  if (calendars && !prefs.calendarId) return <Wrap><CalendarSetup calendars={calendars} /></Wrap>;

  return (
    <Wrap>
      <h1 className="pl-title mb-1 text-2xl sm:text-3xl">🎓 Расписание ГУАП</h1>
      <p className="pl-muted mb-4 text-sm">
        Загружу пары с guap.ru/rasp и поставлю их повторами до конца семестра — с учётом верхней ▲ и нижней ▼ недели. Нейронка не нужна: разбирается точно.
      </p>

      <Panel className="mb-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Группа">
            <input className="pl-input" inputMode="numeric" placeholder="4316" value={group} onChange={(e) => setGroup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && group.trim() && load()} />
          </Row>
          <Row label="До (конец семестра)">
            <input type="date" className="pl-input" value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} />
          </Row>
        </div>
        <Btn main className="w-full" loading={loading} disabled={!group.trim()} onClick={load}>
          Загрузить с сайта
        </Btn>
        <button className="pl-muted text-sm underline" onClick={() => setShowPaste((v) => !v)}>
          {showPaste ? "Скрыть" : "Или вставить текст со страницы расписания"}
        </button>
        {showPaste && (
          <div className="space-y-2">
            <AutoTextarea minRows={4} placeholder="Скопируйте страницу расписания целиком (с днями и парами) и вставьте сюда" value={paste} onChange={(e) => setPaste(e.target.value)} />
            <Btn
              disabled={!paste.trim()}
              onClick={() => {
                setError(null);
                try {
                  accept(parseText(paste));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Разобрать текст
            </Btn>
          </div>
        )}
        {error && <ErrorBox text={error} />}
      </Panel>

      {schedule && (
        <>
          <Panel className="mb-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">
                Гр. {schedule.group || group}: {schedule.lessons.length} {plural(schedule.lessons.length, ["занятие", "занятия", "занятий"])} в неделю-цикл
              </div>
            </div>
            <div>
              <div className="pl-muted mb-1.5 text-xs">Эта неделя{schedule.currentParity ? " (по данным сайта)" : " — выберите"}</div>
              <div className="flex gap-1.5">
                {(["odd", "even"] as Parity[]).map((p) => (
                  <button key={p} className="pl-chip" aria-pressed={parity === p} onClick={() => setParity(p)}>
                    {PARITY[p].mark} {PARITY[p].label}
                  </button>
                ))}
              </div>
            </div>
            <Row label="Напоминание перед парой">
              <select className="pl-input" value={prefs.guapReminder} onChange={(e) => update({ guapReminder: Number(e.target.value) })}>
                <option value={-1}>без напоминания</option>
                {[0, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {reminderLabel(m)}
                  </option>
                ))}
              </select>
            </Row>
            {schedule.extra.length > 0 && <div className="pl-muted text-xs">Вне сетки (не ставлю): {schedule.extra.join("; ")}</div>}
          </Panel>

          <div className="mb-3 space-y-3">
            {WEEKDAYS_LONG.map((name, wd) => {
              const list = schedule.lessons.filter((l) => l.weekday === wd);
              if (!list.length) return null;
              return (
                <div key={wd}>
                  <div className="pl-muted mb-1.5 text-xs uppercase tracking-wide">{name}</div>
                  <div className="space-y-1.5">
                    {list.map((l, i) => (
                      <div key={i} className="pl-soft flex gap-3 p-3 text-sm">
                        <div className="w-12 flex-none tabular-nums">
                          <div className="font-semibold">{l.start}</div>
                          <div className="pl-muted text-xs">{l.end}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{l.subject}</div>
                          <div className="pl-muted text-xs">
                            {PARITY[l.parity].mark} {l.type}
                            {l.room ? ` · ${l.room}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] lg:bottom-4">
            <Btn main className="w-full" loading={!!applying} onClick={apply}>
              {applying ? `Ставлю ${applying.done}/${applying.total}…` : existing ? "Заменить расписание в календаре" : "Поставить в календарь"}
            </Btn>
          </div>
        </>
      )}

      {!schedule && !!existing && (
        <Panel className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            В календаре стоит расписание ГУАП{prefs.guapGroup ? `, гр. ${prefs.guapGroup}` : ""} ({existing} {plural(existing, ["серия", "серии", "серий"])})
          </span>
          <Btn onClick={removeAll} className="text-[#ff7a7a]">
            Убрать
          </Btn>
        </Panel>
      )}
    </Wrap>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="pl-muted mb-1 block text-xs">{label}</span>
      {children}
    </label>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4 sm:px-6">{children}</div>;
}
