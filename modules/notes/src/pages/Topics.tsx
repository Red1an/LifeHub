import { useMemo, useState } from "react";
import { Link, Modal, cn, confirm, formatDate, formatRelative, plural, prompt, toast, useCollection, useNavigate, useParams } from "@lifehub/sdk";
import { Empty, Head, NoteCard, Wrap, useAreas } from "../components/kit.tsx";
import { localKey, shortDate } from "../lib/text.ts";
import type { AreaId, Note, Topic, TopicDoc, TopicKind, TopicLog, TopicLogDoc } from "../lib/types.ts";

/** null вместо undefined: undefined в JSON пропадает и поле не сбросится. */
const clear = null as unknown as undefined;

const kindOfTopic = (t: Topic): TopicKind => t.kind ?? "area";

/**
 * Проекты (PARA): дело с результатом, которое закончится, — внутри одной из постоянных сфер.
 * Старые темы-сферы (до 2.4) показываются отдельно как «Другие темы».
 */
export function TopicsPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { areas, areaOf } = useAreas();
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes.items) if (n.topicId && n.status !== "inbox") m.set(n.topicId, (m.get(n.topicId) ?? 0) + 1);
    return m;
  }, [notes.items]);
  const sorted = [...topics.items].sort((a, b) => b.updatedAt - a.updatedAt);
  const projects = sorted.filter((t) => kindOfTopic(t) === "project" && !t.closedAt);
  const others = sorted.filter((t) => kindOfTopic(t) === "area");
  const closed = sorted.filter((t) => kindOfTopic(t) === "project" && t.closedAt);
  const byArea = [...areas.map((a) => ({ area: a, list: projects.filter((t) => t.area === a.id) })), { area: null, list: projects.filter((t) => !areaOf(t.area)) }].filter((g) => g.list.length);

  const card = (t: TopicDoc) => (
    <Link key={t.id} to={`/t/${t.id}`} className={cn("nt-paper block p-4", !!t.closedAt && "opacity-60")}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{t.emoji}</span>
        <span className="nt-h2 min-w-0 flex-1 truncate">{t.name}</span>
        <span className="nt-muted text-xs">{count.get(t.id) ?? 0}</span>
      </div>
      {t.goal && <div className="mt-1 text-sm">🎯 {t.goal}</div>}
      {t.summary && <p className="nt-muted mt-1.5 line-clamp-2 whitespace-pre-line text-sm">{t.summary}</p>}
      <div className="nt-muted mt-2 flex gap-2 text-xs">
        {t.due && !t.closedAt && <span className={cn(t.due < localKey(new Date()) && "text-danger")}>срок {shortDate(t.due)}</span>}
        <span>{t.closedAt ? `завершён ${formatRelative(t.closedAt)}` : `обновлено ${formatRelative(t.updatedAt)}`}</span>
      </div>
    </Link>
  );

  return (
    <Wrap>
      <Head
        title="Проекты"
        sub="Дела с результатом, которые когда-нибудь закончатся. Постоянные сферы — на «Полках»."
        right={
          <>
            <Link to="/graph" className="nt-mic !h-9 !w-9 !text-base" aria-label="Граф связей">
              🕸️
            </Link>
            <button type="button" className="nt-btn nt-btn-ghost nt-btn-sm" onClick={() => setCreating(true)}>
              ＋ Проект
            </button>
          </>
        }
      />
      {!topics.items.length ? (
        <Empty icon="🚀" title="Проектов пока нет" text="Нейронка предложит проект, когда увидит, что ты несколько раз пишешь про одно дело с результатом. Или создай сам." />
      ) : (
        <div className="space-y-6">
          {byArea.map(({ area, list }) => (
            <section key={area?.id ?? "none"}>
              <h2 className="nt-h2 mb-2">{area ? `${area.emoji} ${area.name}` : "🚀 Без сферы"}</h2>
              <div className="grid gap-3 sm:grid-cols-2">{list.map(card)}</div>
            </section>
          ))}
          {others.length > 0 && (
            <section>
              <h2 className="nt-h2 mb-2">🗂️ Другие темы</h2>
              <div className="grid gap-3 sm:grid-cols-2">{others.map(card)}</div>
            </section>
          )}
          {closed.length > 0 && (
            <section>
              <button type="button" className="nt-muted text-sm" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? "▾" : "▸"} Завершённые проекты ({closed.length})
              </button>
              {showClosed && <div className="mt-2 grid gap-3 sm:grid-cols-2">{closed.map(card)}</div>}
            </section>
          )}
        </div>
      )}
      <NewTopic open={creating} onClose={() => setCreating(false)} onCreate={(t) => topics.add(t)} />
    </Wrap>
  );
}

function NewTopic({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (t: Topic) => Promise<unknown> }) {
  const { areas } = useAreas();
  const [name, setName] = useState("");
  const [area, setArea] = useState<AreaId | undefined>();
  const [goal, setGoal] = useState("");
  const [due, setDue] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    await onCreate({ name: name.trim(), emoji: "🚀", summary: "", kind: "project", area, goal: goal.trim() || undefined, due: due || undefined });
    setName("");
    setGoal("");
    setDue("");
    setArea(undefined);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Новый проект">
      <div className="nt-root -mx-5 -my-4 space-y-3 px-5 py-4">
        <p className="nt-muted text-xs">Есть результат, к которому идёшь, и когда-нибудь проект закончится.</p>
        <input className="nt-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" />
        <input className="nt-field" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Цель: что будет, когда закончишь" />
        <div className="flex flex-wrap gap-1.5">
          {areas.map((a) => (
            <button key={a.id} type="button" className={cn("nt-chip", area === a.id && "nt-chip-on")} onClick={() => setArea(a.id)}>
              {a.emoji} {a.name}
            </button>
          ))}
        </div>
        <label className="nt-muted flex items-center gap-2 text-sm">
          Срок
          <input type="date" className="nt-field !w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button type="button" className="nt-btn w-full" disabled={!name.trim()} onClick={create}>
          Создать
        </button>
      </div>
    </Modal>
  );
}

export function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const log = useCollection<TopicLog>("topic_log");
  const topic = topics.items.find((t) => t.id === id);
  const [editing, setEditing] = useState<string | null>(null);
  const { areas } = useAreas();

  const list = useMemo(
    () => notes.items.filter((n) => n.topicId === id && n.status !== "inbox").sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt)),
    [notes.items, id],
  );
  const history = useMemo(() => log.items.filter((l) => l.topicId === id).sort((a, b) => b.createdAt - a.createdAt), [log.items, id]);

  if (topics.loading) return null;
  if (!topic) {
    return (
      <Wrap>
        <Head title="Тема не найдена" back="/topics" />
      </Wrap>
    );
  }

  const kind = kindOfTopic(topic);
  const today = localKey(new Date());
  const addLog = (text: string) => log.add({ topicId: topic.id, date: today, text, noteIds: [], kind: "manual" });

  const saveSummary = async () => {
    if (editing === null) return;
    const next = editing.trim();
    if (next !== topic.summary) {
      await topics.update(topic.id, { summary: next });
      await addLog("Сводка поправлена вручную");
    }
    setEditing(null);
  };

  const rename = async () => {
    const name = (await prompt("Название темы", topic.name))?.trim();
    if (name && name !== topic.name) {
      await topics.update(topic.id, { name });
      await addLog(`Переименована: «${topic.name}» → «${name}»`);
    }
  };

  const changeEmoji = async () => {
    const emoji = (await prompt("Эмодзи темы", topic.emoji))?.trim();
    if (emoji) await topics.update(topic.id, { emoji: [...emoji][0] });
  };

  const editGoal = async () => {
    const goal = (await prompt("Цель проекта", topic.goal ?? ""))?.trim();
    if (goal === undefined || goal === (topic.goal ?? "")) return;
    await topics.update(topic.id, { goal: goal || clear });
    await addLog(topic.goal ? `Цель: «${topic.goal}» → «${goal}»` : `Цель: ${goal}`);
  };

  const setDue = async (due: string) => {
    await topics.update(topic.id, { due: due || clear });
    if (due) await addLog(topic.due ? `Срок: ${shortDate(topic.due)} → ${shortDate(due)}` : `Срок: ${shortDate(due)}`);
  };

  const switchKind = async () => {
    const next: TopicKind = kind === "project" ? "area" : "project";
    await topics.update(topic.id, { kind: next, closedAt: clear });
    await addLog(next === "project" ? "Стала проектом" : "Стала постоянной темой");
  };

  const toggleClosed = async () => {
    if (topic.closedAt) {
      await topics.update(topic.id, { closedAt: clear });
      await addLog("Проект снова в работе");
    } else {
      const result = (await prompt("Проект завершён. Чем закончился? (необязательно)", ""))?.trim();
      if (result === undefined) return;
      await topics.update(topic.id, { closedAt: Date.now() });
      await addLog(result ? `Завершён: ${result}` : "Проект завершён");
      toast("Проект завершён 🎉", "success");
    }
  };

  const del = async () => {
    if (!(await confirm(`Удалить тему «${topic.name}»? Заметки останутся, просто без темы.`, { danger: true, confirmText: "Удалить" }))) return;
    for (const n of list) await notes.update(n.id, { topicId: null });
    for (const l of history) await log.remove(l.id);
    await topics.remove(topic.id);
    toast("Тема удалена");
    navigate("/topics", { replace: true });
  };

  // История по дням: от новых к старым.
  const byDay = new Map<string, TopicLogDoc[]>();
  for (const l of history) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);
  const openCount = list.filter((n) => !n.done && n.status !== "archived").length;

  return (
    <Wrap>
      <Head
        title={
          <span>
            <button type="button" onClick={changeEmoji} className="mr-1">
              {topic.emoji}
            </button>
            <button type="button" onClick={rename} className="text-left">
              {topic.name}
            </button>
          </span>
        }
        sub={
          <>
            <button type="button" className="underline decoration-dotted underline-offset-2" onClick={switchKind}>
              {kind === "project" ? (topic.closedAt ? "завершённый проект" : "проект") : "тема"}
            </button>
            {` · ${list.length} ${plural(list.length, ["заметка", "заметки", "заметок"])} · с ${formatDate(topic.createdAt, "long")}`}
          </>
        }
        back="/topics"
        right={
          <button type="button" className="nt-mic !h-9 !w-9 !text-base" aria-label="Удалить тему" onClick={del}>
            🗑️
          </button>
        }
      />

      {kind === "project" && (
        <section className="nt-paper mb-4 space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {areas.map((a) => (
              <button key={a.id} type="button" className={cn("nt-chip", topic.area === a.id && "nt-chip-on")} onClick={() => topics.update(topic.id, { area: a.id })}>
                {a.emoji} {a.name}
              </button>
            ))}
          </div>
          <button type="button" className="block w-full text-left" onClick={editGoal}>
            <div className="nt-muted text-xs font-medium uppercase tracking-wide">Цель</div>
            <div className={cn("mt-0.5", !topic.goal && "nt-muted")}>{topic.goal ? `🎯 ${topic.goal}` : "Не задана — нажми, чтобы задать"}</div>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="nt-muted text-sm">Срок</span>
            <input type="date" className="nt-field !w-auto" value={topic.due ?? ""} onChange={(e) => setDue(e.target.value)} />
            {!topic.closedAt && <span className="nt-muted text-sm">· открыто {openCount}</span>}
          </div>
          <button type="button" className={cn("nt-btn w-full", !!topic.closedAt && "nt-btn-ghost")} onClick={toggleClosed}>
            {topic.closedAt ? "↩︎ Вернуть в работу" : "🏁 Завершить проект"}
          </button>
        </section>
      )}

      <section className="nt-paper p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="nt-h2">Что сейчас</h2>
          {editing === null ? (
            <button type="button" className="nt-accent text-sm" onClick={() => setEditing(topic.summary)}>
              Править
            </button>
          ) : (
            <button type="button" className="nt-btn nt-btn-sm" onClick={saveSummary}>
              Сохранить
            </button>
          )}
        </div>
        {editing !== null ? (
          <textarea className="nt-field min-h-32" value={editing} onChange={(e) => setEditing(e.target.value)} autoFocus />
        ) : topic.summary ? (
          <p className="whitespace-pre-line leading-relaxed">{topic.summary}</p>
        ) : (
          <p className="nt-muted text-sm">Сводки пока нет — появится после следующего разбора или напиши сам.</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="nt-h2 mb-2">Заметки</h2>
        {list.length ? (
          <div className="space-y-2">
            {list.map((n) => (
              <NoteCard key={n.id} note={n} compact />
            ))}
          </div>
        ) : (
          <p className="nt-muted text-sm">Пока ни одной.</p>
        )}
      </section>

      {history.length > 0 && (
        <section className="mt-6">
          <h2 className="nt-h2 mb-3">История</h2>
          <ol className="nt-line relative ml-2 space-y-4 border-l-2 pl-5">
            {[...byDay].map(([day, entries]) => (
              <li key={day} className="relative">
                <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-[var(--nt-paper)] bg-[var(--nt-accent)]" />
                <div className="nt-muted text-xs font-medium">{formatDate(day, "long")}</div>
                <ul className="mt-1 space-y-1">
                  {entries.map((l) => (
                    <li key={l.id} className="text-sm leading-snug">
                      {l.text}
                      {l.noteIds.map((nid) =>
                        notes.items.some((n) => n.id === nid) ? (
                          <Link key={nid} to={`/n/${nid}`} className="nt-accent ml-1">
                            →
                          </Link>
                        ) : null,
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Wrap>
  );
}
