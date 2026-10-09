import { useState } from "react";
import { Modal, cn, files, uid } from "@lifehub/sdk";
import { CONTEXTS, KINDS, contextById, kindById } from "../lib/kinds.ts";
import { eventWhen, extractUrls, preview, shortDate } from "../lib/text.ts";
import type { TriageItem, TriagePlan } from "../lib/triage.ts";
import type { ContextId, KindId, NoteDoc, TopicDoc, TopicKind } from "../lib/types.ts";

interface Props {
  plan: TriagePlan;
  inbox: Map<string, NoteDoc>;
  filed: Map<string, NoteDoc>;
  topics: TopicDoc[];
  onChange: (p: TriagePlan) => void;
}

/** План разбора: вертикальные карточки «обрывки → заметка», правка и пропуск каждой. */
export function PlanView({ plan, inbox, filed, topics, onChange }: Props) {
  const [editing, setEditing] = useState<TriageItem | null>(null);
  const setItem = (key: string, next: TriageItem | TriageItem[]) =>
    onChange({ ...plan, items: plan.items.flatMap((x) => (x.key === key ? next : [x])) });

  const split = (it: TriageItem) =>
    setItem(
      it.key,
      it.from.map((id) => {
        const n = inbox.get(id);
        return {
          ...it,
          key: uid(),
          from: [id],
          title: preview(n?.body ?? "", 60) || "Фото",
          body: n?.body ?? "",
          props: {},
          links: it.links.filter((l) => extractUrls(n?.body ?? "").includes(l.url)),
          images: n?.images ?? [],
          event: null,
          due: undefined,
          related: [],
          topicSummary: undefined,
          topicLog: undefined,
        };
      }),
    );

  return (
    <div className="space-y-3">
      {plan.items.map((it, i) => (
        <PlanCard
          key={it.key}
          n={i + 1}
          item={it}
          inbox={inbox}
          filed={filed}
          topics={topics}
          onEdit={() => setEditing(it)}
          onSkip={() => setItem(it.key, { ...it, skip: !it.skip })}
          onSplit={() => split(it)}
        />
      ))}
      {plan.questions.length > 0 && (
        <div className="nt-paper p-4">
          <div className="nt-h2 mb-2">❓ Вопросы</div>
          <ul className="space-y-2 text-sm">
            {plan.questions.map((q, i) => (
              <li key={i}>
                {inbox.get(q.from)?.body && <span className="nt-muted">«{preview(inbox.get(q.from)!.body, 50)}» — </span>}
                {q.text}
              </li>
            ))}
          </ul>
          <p className="nt-muted mt-2 text-xs">Ответь, поправив карточку, или допиши ответ в воронку — учту при следующем разборе.</p>
        </div>
      )}
      <ItemEditor item={editing} topics={topics} onClose={() => setEditing(null)} onSave={(it) => (setItem(it.key, it), setEditing(null))} />
    </div>
  );
}

function PlanCard({
  n,
  item,
  inbox,
  filed,
  topics,
  onEdit,
  onSkip,
  onSplit,
}: {
  n: number;
  item: TriageItem;
  inbox: Map<string, NoteDoc>;
  filed: Map<string, NoteDoc>;
  topics: TopicDoc[];
  onEdit: () => void;
  onSkip: () => void;
  onSplit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const kind = kindById(item.kind);
  const topicId = item.topic && "id" in item.topic ? item.topic.id : null;
  const topic = topicId ? topics.find((t) => t.id === topicId) : null;
  const newTopic = item.topic && "name" in item.topic ? item.topic : null;
  const related = item.related.map((id) => filed.get(id)).filter((x): x is NoteDoc => !!x);
  const props = kind.fields.map((f) => item.props[f.key]).filter(Boolean).join(" · ");
  const target = item.mergeInto ? filed.get(item.mergeInto) : undefined;
  return (
    <div className={cn("nt-paper overflow-hidden", item.skip && "opacity-45")}>
      {target && (
        <div className="flex items-center gap-2 bg-[var(--nt-accent-soft)] px-4 py-2 text-sm">
          <span>🔁</span>
          <span className="min-w-0 flex-1">
            Уже есть: <b>{target.title || preview(target.body, 40)}</b>
            {target.done ? " (уже закрыто)" : target.status === "archived" ? " (в архиве — верну)" : ""} — допишу туда
          </span>
        </div>
      )}
      <div className="h-1" style={{ background: kind.color }} />
      <div className="p-4">
        <div className="nt-muted mb-1 flex items-center gap-2 text-xs">
          <span>{n}.</span>
          <button type="button" className="underline decoration-dotted underline-offset-2" onClick={() => setOpen(!open)}>
            {item.from.length > 1 ? `${item.from.length} обрывка → одна заметка` : "исходник"}
          </button>
          {item.confidence < 0.5 && <span className="rounded-full bg-[var(--nt-accent-soft)] px-2 py-0.5 text-[var(--nt-accent)]">не уверен</span>}
        </div>
        {open && (
          <div className="mb-2 space-y-1">
            {item.from.map((id) => (
              <div key={id} className="nt-slip px-2.5 py-1.5 text-sm">
                {inbox.get(id)?.body || (inbox.get(id)?.images?.length ? "📷 фото" : "")}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <div className={cn("text-[1.02rem] font-semibold leading-snug", item.skip && "line-through")}>{item.title}</div>
            {props && <div className="nt-muted text-xs">{props}</div>}
            <p className="nt-muted mt-1 line-clamp-3 whitespace-pre-line text-sm">{item.body}</p>
          </div>
          {item.images[0] && <img src={files.url(item.images[0])} alt="" className="size-14 flex-none rounded-lg object-cover" />}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <span className="nt-chip !h-6" style={{ color: kind.color }}>
            {kind.emoji} {kind.name}
          </span>
          {topic && (
            <span className="nt-chip !h-6">
              {topic.emoji} {topic.name}
            </span>
          )}
          {newTopic && (
            <span className="nt-chip !h-6">
              ✨ {newTopic.kind === "project" ? "новый проект" : "новая сфера"}: {newTopic.emoji} {newTopic.name}
            </span>
          )}
          {item.context.map((c) => (
            <span key={c} className="nt-chip !h-6">
              {contextById(c)?.emoji} {contextById(c)?.name}
            </span>
          ))}
          {item.event && <span className="nt-chip !h-6 nt-accent">📅 {eventWhen(item.event)}</span>}
          {item.due && (
            <span className="nt-chip !h-6 nt-accent">
              🎯 до {shortDate(item.due)}
              {item.effort ? `, ~${item.effort} ч` : ""}
            </span>
          )}
          {item.snoozeUntil && <span className="nt-chip !h-6">⏰ отложить до {shortDate(item.snoozeUntil)}</span>}
          {item.links.map((l) => (
            <span key={l.url} className="nt-chip !h-6 max-w-[220px] truncate">
              🔗 {l.title ?? l.site ?? l.url}
            </span>
          ))}
          {item.tags.map((t) => (
            <span key={t} className="nt-muted px-1 leading-6">
              #{t}
            </span>
          ))}
        </div>
        {related.length > 0 && <div className="nt-muted mt-2 text-xs">Связать с: {related.map((r) => `«${r.title || preview(r.body, 40)}»`).join(", ")}</div>}
        {item.topicLog && (topic || newTopic) && <div className="nt-muted mt-1 text-xs">В историю темы: {item.topicLog}</div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="nt-btn nt-btn-ghost nt-btn-sm" onClick={onEdit}>
            ✏️ Править
          </button>
          {item.from.length > 1 && (
            <button type="button" className="nt-btn nt-btn-ghost nt-btn-sm" onClick={onSplit}>
              ✂️ Разделить
            </button>
          )}
          <button type="button" className="nt-btn nt-btn-ghost nt-btn-sm" onClick={onSkip}>
            {item.skip ? "Вернуть" : "Пропустить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemEditor({ item, topics, onClose, onSave }: { item: TriageItem | null; topics: TopicDoc[]; onClose: () => void; onSave: (it: TriageItem) => void }) {
  return (
    <Modal open={!!item} onClose={onClose} title="Заметка из разбора">
      {item && <EditorBody key={item.key} item={item} topics={topics} onSave={onSave} />}
    </Modal>
  );
}

function EditorBody({ item, topics, onSave }: { item: TriageItem; topics: TopicDoc[]; onSave: (it: TriageItem) => void }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [kind, setKind] = useState<KindId>(item.kind);
  const [props, setProps] = useState(item.props);
  const [context, setContext] = useState<ContextId[]>(item.context);
  const [topicSel, setTopicSel] = useState(item.topic ? ("id" in item.topic ? item.topic.id : "__new") : "");
  const [newName, setNewName] = useState(item.topic && "name" in item.topic ? item.topic.name : "");
  const [newKind, setNewKind] = useState<TopicKind>(item.topic && "kind" in item.topic ? item.topic.kind : "project");
  const [keepEvent, setKeepEvent] = useState(!!item.event);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [merge, setMerge] = useState(!!item.mergeInto);
  const fields = kindById(kind).fields;

  const save = () => {
    const prev = item.topic && "name" in item.topic ? item.topic : null;
    const topic =
      topicSel === "__new"
        ? newName.trim()
          ? { name: newName.trim(), emoji: prev?.emoji ?? (newKind === "project" ? "🚀" : "🗂️"), kind: newKind, goal: prev?.goal }
          : null
        : topicSel
          ? { id: topicSel }
          : null;
    const keys = new Set(fields.map((f) => f.key));
    onSave({
      ...item,
      title: title.trim() || item.title,
      body,
      kind,
      props: Object.fromEntries(Object.entries(props).filter(([k, v]) => keys.has(k) && v.trim())),
      context,
      topic,
      event: keepEvent ? item.event : null,
      tags: tags.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean),
      mergeInto: merge ? item.mergeInto : undefined,
      confidence: 1,
    });
  };

  return (
    <div className="nt-root -mx-5 -my-4 space-y-3 px-5 py-4">
      {item.mergeInto && (
        <label className="nt-soft flex items-center gap-2 p-3 text-sm">
          <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
          🔁 Это то же, что уже сохранено — дописать туда, а не создавать новую
        </label>
      )}
      <input className="nt-field font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" />
      <textarea className="nt-field min-h-28" value={body} onChange={(e) => setBody(e.target.value)} />
      <div>
        <div className="nt-muted mb-1.5 text-xs">Что это</div>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className={cn("nt-chip", kind === k.id && "nt-chip-on")} onClick={() => setKind(k.id)}>
              {k.emoji} {k.name}
            </button>
          ))}
        </div>
      </div>
      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {fields.map((f) => (
            <input key={f.key} className="nt-field text-sm" value={props[f.key] ?? ""} onChange={(e) => setProps({ ...props, [f.key]: e.target.value })} placeholder={f.label} />
          ))}
        </div>
      )}
      <div>
        <div className="nt-muted mb-1.5 text-xs">Когда</div>
        <div className="flex flex-wrap gap-1.5">
          {CONTEXTS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn("nt-chip", context.includes(c.id) && "nt-chip-on")}
              onClick={() => setContext(context.includes(c.id) ? context.filter((x) => x !== c.id) : [...context, c.id])}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="nt-muted mb-1.5 text-xs">Проект или сфера</div>
        <select className="nt-field" value={topicSel} onChange={(e) => setTopicSel(e.target.value)}>
          <option value="">Без темы</option>
          {topics
            .filter((t) => !t.closedAt)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.name}
              </option>
            ))}
          <option value="__new">＋ Новая…</option>
        </select>
        {topicSel === "__new" && (
          <div className="mt-2 flex gap-2">
            <input className="nt-field" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название" />
            <select className="nt-field !w-auto" value={newKind} onChange={(e) => setNewKind(e.target.value as TopicKind)}>
              <option value="project">проект</option>
              <option value="area">сфера</option>
            </select>
          </div>
        )}
      </div>
      <input className="nt-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Теги через запятую" />
      {item.event && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepEvent} onChange={(e) => setKeepEvent(e.target.checked)} />
          📅 {item.event.title}, {eventWhen(item.event)}
        </label>
      )}
      <button type="button" className="nt-btn w-full" onClick={save}>
        Готово
      </button>
    </div>
  );
}
