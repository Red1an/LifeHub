import { useMemo, useState, type ReactNode } from "react";
import { Modal, Progress, cn, confirm, dayKey, plural, toast, useCollection, useGoogle, useNavigate, useStore } from "@lifehub/sdk";
import { Btn, ConnectCard, Panel, Skeleton } from "../components/kit.tsx";
import { MoveModal, type MoveTarget } from "../components/move.tsx";
import { AutoTextarea } from "../components/input.tsx";
import { deleteById, eventsChanged, loadBusy, usePrefs } from "../lib/gcal.ts";
import { deadlineLabel, doneMinutes, draftsForTasks, markBlock, newPending, remainingToPlan } from "../lib/tasks.ts";
import { CATEGORIES, type Category, type Plan, type Task, type TaskBlock } from "../lib/types.ts";
import { dayLabel, fromKey, shiftKey } from "../lib/time.ts";

type TaskDoc = Task & { id: string };

const hours = (m: number) => `${Math.round(m / 6) / 10} ч`;

function daysLeft(t: Task) {
  const end = new Date(`${t.deadline}T${t.deadlineTime ?? "23:59"}:00`).getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}

const blockEnd = (b: TaskBlock) => new Date(`${b.date}T${b.end}:00`).getTime();

export function TasksPage() {
  const { status } = useGoogle();
  const { prefs } = usePrefs();
  const tasks = useCollection<Task>("tasks");
  const [plan, setPlan] = useStore<Plan | null>("plan", null);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => tasks.items.filter((t) => !t.done).sort((a, b) => a.deadline.localeCompare(b.deadline)), [tasks.items]);
  const done = tasks.items.filter((t) => t.done);
  const now = Date.now();
  const toMark = open.flatMap((t) => t.blocks.filter((b) => !b.done && !b.missed && blockEnd(b) < now).map((b) => ({ t, b })));

  /** Черновик для задач → страница «Запланировать», где его можно поправить и применить. */
  const planDraft = async (items: ReturnType<typeof newPending>[], remaining: Record<string, number>, request: string) => {
    if (plan && !(await confirm("Сейчас есть неприменённый черновик. Заменить его?"))) return;
    const events = await loadBusy(prefs, 120);
    const r = draftsForTasks(items, remaining, events, [], prefs);
    if (!r.drafts.some((d) => d.taskRole === "block") && r.tasks.every((t) => !t.unplaced)) {
      toast("Нечего планировать — вся работа уже стоит в календаре", "info");
      return;
    }
    setPlan({ request, summary: "Разложил работу по свободному времени до срока — проверьте и добавьте в календарь.", questions: [], drafts: r.drafts, tasks: r.tasks, images: [], sources: [], createdAt: Date.now() });
    navigate("/ask");
  };

  const replan = async (t: TaskDoc) => {
    setBusy(t.id);
    try {
      const rest = remainingToPlan(t);
      await planDraft([{ ...t, id: t.id, existing: true }], { [t.id]: rest }, `Распланировать остаток задачи «${t.title}»`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const finish = async (t: TaskDoc) => {
    const future = t.blocks.filter((b) => !b.done && !b.missed && blockEnd(b) > Date.now());
    const ok = await confirm(
      future.length ? `Отметить «${t.title}» выполненной и убрать из календаря ${future.length} ${plural(future.length, ["будущий блок", "будущих блока", "будущих блоков"])}?` : `Отметить «${t.title}» выполненной?`,
      { confirmText: "Готово" },
    );
    if (!ok) return;
    setBusy(t.id);
    try {
      for (const b of future) await deleteById(b.calendarId, b.eventId).catch(() => {});
      if (t.deadlineEvent) await deleteById(t.deadlineEvent.calendarId, t.deadlineEvent.eventId).catch(() => {});
      await tasks.update(t.id, { done: true, blocks: t.blocks.filter((b) => !future.includes(b)) });
      eventsChanged();
      toast("Задача выполнена 🎉", "success");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: TaskDoc) => {
    if (!(await confirm(`Удалить задачу «${t.title}» и её будущие блоки из календаря?`, { danger: true, confirmText: "Удалить" }))) return;
    setBusy(t.id);
    try {
      for (const b of t.blocks.filter((x) => !x.done && blockEnd(x) > Date.now())) await deleteById(b.calendarId, b.eventId).catch(() => {});
      if (t.deadlineEvent) await deleteById(t.deadlineEvent.calendarId, t.deadlineEvent.eventId).catch(() => {});
      await tasks.remove(t.id);
      eventsChanged();
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <Wrap><Skeleton /></Wrap>;
  if (!status.connected) return <Wrap><ConnectCard configured={status.configured} /></Wrap>;

  return (
    <Wrap>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="pl-title text-2xl sm:text-3xl">Дедлайны</h1>
        <Btn main onClick={() => setAdding(true)}>
          + Задача
        </Btn>
      </div>

      {toMark.length > 0 && (
        <Panel className="mb-4 space-y-2">
          <div className="font-semibold">Как прошло?</div>
          <div className="pl-muted text-sm">Отметьте прошедшие блоки — так видно, сколько осталось, а пропущенное можно перенести.</div>
          {toMark.map(({ t, b }) => (
            <div key={b.eventId} className="pl-soft flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.title}</div>
                <div className="pl-muted text-xs">
                  {dayLabel(b.date)}, {b.start}–{b.end}
                </div>
              </div>
              <Btn className="px-3 text-sm" onClick={() => markBlock(t.id, b.eventId).then((r) => r?.finished && toast("Задача выполнена целиком 🎉", "success"))}>
                ✅ Сделал
              </Btn>
              <Btn
                className="px-3 text-sm"
                onClick={() => setMoving({ id: b.eventId, calendarId: b.calendarId, title: t.title, start: new Date(`${b.date}T${b.start}:00`), end: new Date(blockEnd(b)), taskId: t.id })}
              >
                ↪ Не успел
              </Btn>
            </div>
          ))}
        </Panel>
      )}

      {tasks.loading ? (
        <Skeleton />
      ) : open.length === 0 ? (
        <Panel className="py-10 text-center">
          <div className="text-3xl">🎯</div>
          <div className="mt-2 font-semibold">Дедлайнов нет</div>
          <div className="pl-muted mx-auto mt-1 max-w-sm text-sm">
            Добавьте задачу со сроком и объёмом — работа сама разложится по свободным окнам. Или напишите на «Запланировать»: «лаба по ИИС до 20 октября, часов на 6».
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          {open.map((t) => {
            const dn = doneMinutes(t);
            const left = daysLeft(t);
            const rest = remainingToPlan(t);
            const next = t.blocks.filter((b) => !b.done && !b.missed && blockEnd(b) > now).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
            const cat = CATEGORIES[t.category] ?? CATEGORIES.study;
            return (
              <Panel key={t.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{cat.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.title}</div>
                    <div className={cn("text-sm", left <= 1 ? "text-[#ff8a8a]" : left <= 3 ? "text-[#ffd166]" : "pl-muted")}>
                      срок — {deadlineLabel(t)}
                      {left >= 0 ? ` · ${left === 0 ? "сегодня" : `осталось ${left} ${plural(left, ["день", "дня", "дней"])}`}` : " · просрочено"}
                    </div>
                  </div>
                </div>
                <div>
                  <Progress value={dn} max={t.estimate} />
                  <div className="pl-muted mt-1 flex justify-between text-xs">
                    <span>
                      сделано {hours(dn)} из {hours(t.estimate)}
                    </span>
                    {next && (
                      <span>
                        дальше: {dayLabel(next.date).toLowerCase()}, {next.start}
                      </span>
                    )}
                  </div>
                </div>
                {rest > 0 && <div className="text-sm text-[#ffd166]">⚠ Не распланировано {hours(rest)} работы</div>}
                {t.notes && <div className="pl-muted whitespace-pre-wrap text-sm">{t.notes}</div>}
                <div className="flex flex-wrap gap-2">
                  {rest > 0 && (
                    <Btn main loading={busy === t.id} onClick={() => replan(t)}>
                      Распланировать {hours(rest)}
                    </Btn>
                  )}
                  <Btn loading={busy === t.id} onClick={() => finish(t)}>
                    ✓ Выполнено
                  </Btn>
                  <Btn loading={busy === t.id} onClick={() => remove(t)} className="text-[#ff7a7a]">
                    Удалить
                  </Btn>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <button className="pl-muted text-sm underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Скрыть выполненные" : `Выполненные (${done.length})`}
          </button>
          {showDone && (
            <div className="mt-2 space-y-2">
              {done.map((t) => (
                <div key={t.id} className="pl-soft flex items-center gap-2 p-3 text-sm">
                  <span className="flex-1 truncate line-through opacity-70">{t.title}</span>
                  <button className="pl-muted text-xs underline" onClick={() => tasks.remove(t.id)}>
                    убрать
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AddTask
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={async (p) => {
          setAdding(false);
          try {
            await planDraft([p], {}, `Задача «${p.title}» до ${deadlineLabel(p)}`);
          } catch (e) {
            toast((e as Error).message, "error");
          }
        }}
      />
      <MoveModal target={moving} onClose={() => setMoving(null)} />
    </Wrap>
  );
}

function AddTask({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (p: ReturnType<typeof newPending>) => void }) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState(shiftKey(dayKey(), 7));
  const [time, setTime] = useState("");
  const [est, setEst] = useState(4);
  const [chunk, setChunk] = useState(90);
  const [category, setCategory] = useState<Category>("study");
  const [notes, setNotes] = useState("");
  const valid = title.trim() && deadline && fromKey(deadline).getTime() >= fromKey(dayKey()).getTime() && est > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая задача"
      footer={
        <Btn
          main
          className="w-full"
          disabled={!valid}
          onClick={() => {
            onSubmit(newPending({ title: title.trim(), deadline, deadlineTime: time || undefined, estimate: est * 60, chunk, category, notes: notes.trim() || undefined, source: "form" }));
            setTitle("");
            setNotes("");
          }}
        >
          Разложить по свободному времени
        </Btn>
      }
    >
      <div className="space-y-3">
        <input className="pl-input text-lg font-semibold" placeholder="Лаба 3 по ИИС" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Row label="Срок">
            <input type="date" className="pl-input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Row>
          <Row label="Время (необяз.)">
            <input type="time" className="pl-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Row>
          <Row label="Работы, часов">
            <input type="number" min={0.5} step={0.5} className="pl-input" value={est} onChange={(e) => setEst(Math.max(0.5, Number(e.target.value) || 1))} />
          </Row>
          <Row label="Блок">
            <select className="pl-input" value={chunk} onChange={(e) => setChunk(Number(e.target.value))}>
              {[45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} мин` : `${m / 60} ч`}
                </option>
              ))}
            </select>
          </Row>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["study", "work", "personal", "other"] as Category[]).map((c) => (
            <button key={c} className="pl-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {CATEGORIES[c].icon} {CATEGORIES[c].label}
            </button>
          ))}
        </div>
        <AutoTextarea minRows={2} placeholder="Заметки: что сделать, ссылка на задание" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
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

