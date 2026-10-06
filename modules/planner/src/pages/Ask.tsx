import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, files, formatRelative, plural, toast, useCollection, useGoogle, useNavigate, useStore } from "@lifehub/sdk";
import { Btn, CalendarSetup, ConnectCard, ErrorBox, Panel, Skeleton } from "../components/kit.tsx";
import { DraftCard, DraftEditor } from "../components/drafts.tsx";
import { AutoTextarea, MicButton, appendText, useDictation } from "../components/input.tsx";
import { applyDraft, eventsChanged, listEvents, loadCalendars, useCalendars, usePrefs, visibleCalendars } from "../lib/gcal.ts";
import { makePlan } from "../lib/planner.ts";
import { SOURCES, loadSource, type SourceState } from "../lib/sources.ts";
import type { CalEvent, Draft, HistoryEntry, Plan } from "../lib/types.ts";

const EXAMPLES = [
  "Завтра в 19:00 созвон с командой на час",
  "Поставь тренировки 3 раза в неделю вечером",
  "Каждый будний день 2 часа учёбы утром до работы",
  "Перенеси сегодняшнюю тренировку на завтра",
];

const THINKING = ["Смотрю календарь…", "Ищу свободные окна…", "Раскладываю по дням…", "Проверяю пересечения…"];

interface Photo {
  id: string;
  url: string;
}

export function AskPage() {
  const { status } = useGoogle();
  const { calendars } = useCalendars();
  const { prefs } = usePrefs();
  const navigate = useNavigate();
  const [plan, setPlan] = useStore<Plan | null>("plan", null);
  const history = useCollection<HistoryEntry>("history");

  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, SourceState>>({});
  const [thinking, setThinking] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [refine, setRefine] = useState("");
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useDictation((t) => setText((p) => appendText(p, t)));
  const refineVoice = useDictation((t) => setRefine((p) => appendText(p, t)));

  useEffect(() => {
    for (const s of SOURCES) loadSource(s).then((st) => setSources((p) => ({ ...p, [s.id]: st })));
  }, []);

  useEffect(() => {
    if (!thinking) return;
    const t = setInterval(() => setStep((s) => (s + 1) % THINKING.length), 2200);
    return () => clearInterval(t);
  }, [thinking]);

  /** Занятость на горизонт планирования. */
  const loadBusy = async () => {
    const all = await loadCalendars();
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + (prefs.horizon + 1) * 86_400_000);
    const ev = await listEvents(visibleCalendars(all, prefs), from, to);
    setEvents(ev);
    return ev;
  };

  // Для подсветки пересечений в сохранённом черновике.
  useEffect(() => {
    if (plan && status?.connected && !events.length) loadBusy().catch(() => {});
  }, [plan?.createdAt, status?.connected]);

  const addPhotos = async (list: FileList | File[]) => {
    const imgs = [...list].filter((f) => f.type.startsWith("image/")).slice(0, 5 - photos.length);
    if (!imgs.length) return;
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try {
        const meta = await files.upload(f, f.name || "фото.jpg");
        setPhotos((p) => [...p, { id: meta.id, url: files.url(meta.id) }]);
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const run = async (refineText?: string) => {
    voice.stop();
    refineVoice.stop();
    setThinking(true);
    setError(null);
    try {
      const ev = await loadBusy();
      const src: Record<string, string> = {};
      const used = refineText && plan ? plan.sources : picked;
      for (const id of used) if (sources[id]?.text) src[id] = sources[id].text!;
      const request = refineText && plan ? plan.request : text;
      const images = refineText && plan ? plan.images : photos.map((p) => p.id);
      const r = await makePlan({
        request,
        images,
        sources: src,
        events: ev,
        prefs,
        refine: refineText && plan ? { drafts: plan.drafts, feedback: refineText } : undefined,
      });
      if (!r.drafts.length && !r.questions.length) throw new Error(r.summary || "Нейронка не предложила изменений — попробуйте сформулировать иначе");
      setPlan({ request, summary: r.summary, questions: r.questions, drafts: r.drafts, images, sources: used, createdAt: Date.now() });
      setRefine("");
      if (!refineText) {
        setText("");
        setPhotos([]);
        setPicked([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    const todo = plan.drafts.filter((d) => !d.skip);
    setApplying({ done: 0, total: todo.length });
    const counts = { created: 0, updated: 0, deleted: 0, failed: 0 };
    const failed: Draft[] = [];
    let lastError = "";
    for (const d of todo) {
      try {
        await applyDraft(d, prefs);
        counts[d.op === "create" ? "created" : d.op === "update" ? "updated" : "deleted"]++;
      } catch (e) {
        counts.failed++;
        failed.push(d);
        lastError = (e as Error).message;
      }
      setApplying((a) => a && { ...a, done: a.done + 1 });
    }
    setApplying(null);
    eventsChanged();
    await history.add({ request: plan.request, summary: plan.summary, images: plan.images, sources: plan.sources, ...counts }).catch(() => {});
    if (failed.length) {
      setPlan({ ...plan, drafts: failed });
      toast(`Не получилось ${failed.length} из ${todo.length}: ${lastError}`, "error");
      return;
    }
    setPlan(null);
    toast(`Готово: ${todo.length} ${plural(todo.length, ["изменение", "изменения", "изменений"])} в календаре`, "success");
    navigate(`/?d=${todo[0]?.date ?? ""}`);
  };

  const updateDraft = (d: Draft) => plan && setPlan({ ...plan, drafts: plan.drafts.map((x) => (x.key === d.key ? d : x)) });
  const active = plan?.drafts.filter((d) => !d.skip).length ?? 0;
  const recent = useMemo(() => [...history.items].reverse().slice(0, 5), [history.items]);

  if (!status) return <Shell><Skeleton /></Shell>;
  if (!status.connected) return <Shell><ConnectCard configured={status.configured} /></Shell>;
  if (calendars && !prefs.calendarId) return <Shell><CalendarSetup calendars={calendars} /></Shell>;

  if (thinking)
    return (
      <Shell>
        <Panel className="space-y-4 py-8 text-center">
          <div className="text-4xl">✨</div>
          <div className="pl-title text-lg">{THINKING[step]}</div>
          <div className="pl-muted text-sm">Обычно 10–40 секунд</div>
        </Panel>
        <div className="mt-3">
          <Skeleton rows={3} />
        </div>
      </Shell>
    );

  if (plan)
    return (
      <Shell>
        <Panel className="mb-3 space-y-2">
          {plan.request && <div className="pl-muted text-sm">«{plan.request}»</div>}
          {plan.summary && <div className="leading-relaxed">{plan.summary}</div>}
          {plan.questions.length > 0 && (
            <div className="rounded-xl bg-[#ffd16614] p-3 text-sm">
              <div className="mb-1 font-semibold text-[#ffd166]">Нужно уточнить</div>
              <ul className="list-disc space-y-1 pl-4">
                {plan.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <div className="space-y-2">
          {plan.drafts.map((d) => (
            <DraftCard key={d.key} d={d} events={events} onToggle={() => updateDraft({ ...d, skip: !d.skip })} onEdit={() => setEditing(d)} />
          ))}
        </div>

        {error && <div className="mt-3"><ErrorBox text={error} /></div>}

        <div className="mt-4 space-y-2">
          <AutoTextarea
            minRows={1}
            placeholder={plan.questions.length ? "Ответьте или попросите поправить…" : "Поправить: «сдвинь всё на час позже»"}
            value={refine}
            onChange={(e) => setRefine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && refine.trim()) {
                e.preventDefault();
                run(refine.trim());
              }
            }}
          />
          {refineVoice.interim && <div className="pl-muted px-1 text-sm italic">{refineVoice.interim}…</div>}
          <div className="flex gap-2">
            <MicButton listening={refineVoice.listening} onClick={refineVoice.toggle} />
            <Btn className="ml-auto" disabled={!refine.trim()} onClick={() => run(refine.trim())}>
              ↻ Поправить
            </Btn>
          </div>
        </div>

        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] mt-4 flex gap-2 lg:bottom-4">
          <Btn onClick={() => setPlan(null)} disabled={!!applying}>
            Сбросить
          </Btn>
          <Btn main className="flex-1" disabled={!active} loading={!!applying} onClick={apply}>
            {applying ? `Добавляю ${applying.done}/${applying.total}…` : `Добавить в календарь · ${active}`}
          </Btn>
        </div>

        <DraftEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={(d) => {
            updateDraft(d);
            setEditing(null);
          }}
          onDelete={() => {
            if (editing) setPlan({ ...plan, drafts: plan.drafts.filter((x) => x.key !== editing.key) });
            setEditing(null);
          }}
        />
      </Shell>
    );

  const canRun = (text.trim() || photos.length || picked.length) && !uploading;
  return (
    <Shell>
      <h1 className="pl-title mb-1 text-2xl sm:text-3xl">
        Что <span className="pl-grad">запланировать?</span>
      </h1>
      <p className="pl-muted mb-4 text-sm">Напишите своими словами, приложите фото расписания или возьмите данные из модулей. Перед добавлением покажу черновик.</p>

      <Panel className="space-y-3">
        <AutoTextarea
          minRows={4}
          className="text-base"
          placeholder="Например: в четверг в 18:30 стоматолог, а пары с фото поставь до конца семестра"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addPhotos(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canRun) run();
          }}
        />
        {voice.interim && <div className="pl-muted -mt-1 px-1 text-sm italic">{voice.interim}…</div>}

        {(photos.length > 0 || uploading > 0) && (
          <div className="flex gap-2 overflow-x-auto">
            {photos.map((p) => (
              <div key={p.id} className="pl-thumb">
                <img src={p.url} alt="" />
                <button
                  aria-label="Убрать фото"
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-xs"
                  onClick={() => {
                    setPhotos((l) => l.filter((x) => x.id !== p.id));
                    files.remove(p.id).catch(() => {});
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <div key={i} className="pl-thumb pl-shimmer" />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addPhotos(e.target.files).then(() => (e.target.value = ""))} />
          <MicButton listening={voice.listening} onClick={voice.toggle} />
          <button className="pl-chip" onClick={() => fileRef.current?.click()} disabled={photos.length >= 5}>
            📷 Фото
          </button>
          {SOURCES.map((s) => {
            const st = sources[s.id];
            const on = picked.includes(s.id);
            return (
              <button
                key={s.id}
                className="pl-chip"
                aria-pressed={on}
                disabled={!st?.available}
                title={st?.error ?? s.hint}
                onClick={() => {
                  setPicked((l) => (on ? l.filter((x) => x !== s.id) : [...l, s.id]));
                  if (!on && !text.trim()) setText(s.hint);
                }}
              >
                {s.icon} {s.label}
              </button>
            );
          })}
        </div>
        {SOURCES.some((s) => sources[s.id] && !sources[s.id].available) && (
          <div className="pl-muted text-xs">
            {SOURCES.filter((s) => sources[s.id] && !sources[s.id].available)
              .map((s) => `${s.icon} ${sources[s.id].error}`)
              .join(" · ")}
          </div>
        )}

        {error && <ErrorBox text={error} />}

        <Btn main className="w-full" disabled={!canRun} onClick={() => run()}>
          ✨ Составить расписание
        </Btn>
      </Panel>

      <div className="mt-5">
        <div className="pl-muted mb-2 text-xs uppercase tracking-wide">Можно так</div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} className="pl-chip text-left" onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-6">
          <div className="pl-muted mb-2 text-xs uppercase tracking-wide">Недавние запросы</div>
          <div className="space-y-2">
            {recent.map((h) => (
              <button key={h.id} className="pl-soft block w-full p-3 text-left" onClick={() => setText(h.request)}>
                <div className="truncate text-sm font-medium">{h.request || (h.images.length ? "📷 по фото" : "из модулей")}</div>
                <div className="pl-muted mt-0.5 text-xs">
                  {formatRelative(h.createdAt)} · {[h.created && `+${h.created}`, h.updated && `✎${h.updated}`, h.deleted && `−${h.deleted}`, h.failed && `ошибок: ${h.failed}`].filter(Boolean).join(" ")}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-2xl px-4 pb-28 pt-4 sm:px-6")}>{children}</div>;
}
