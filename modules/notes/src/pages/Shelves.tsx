import { useMemo } from "react";
import { Link, cn, useCollection, useParams, useSearchParams } from "@lifehub/sdk";
import { Empty, Head, NoteCard, Wrap, topicMap, useDone } from "../components/kit.tsx";
import { CONTEXTS, KINDS, isSnoozed, kindById, kindOf } from "../lib/kinds.ts";
import { localKey, titleOf } from "../lib/text.ts";
import type { ContextId, KindId, Note, NoteDoc, Topic } from "../lib/types.ts";

const at = (n: NoteDoc) => n.capturedAt ?? n.createdAt;

/** Подборки — как «умные папки»: что делать дальше, а не где лежит. */
const COLLECTIONS: { id: string; title: string; emoji: string; kinds: KindId[] }[] = [
  { id: "watch", title: "Посмотреть", emoji: "🍿", kinds: ["movie", "media"] },
  { id: "read", title: "Почитать", emoji: "📖", kinds: ["book", "link"] },
  { id: "try", title: "Попробовать", emoji: "🧪", kinds: ["app"] },
  { id: "go", title: "Сходить", emoji: "🚶", kinds: ["place"] },
  { id: "buy", title: "Купить", emoji: "🛒", kinds: ["buy"] },
  { id: "wish", title: "Хотелки", emoji: "🌠", kinds: ["wish"] },
  { id: "do", title: "Сделать", emoji: "✅", kinds: ["task"] },
];

/** Не подборка по типам, а всё отложенное «на потом» — с датой, когда всплывёт. */
const LATER = { id: "later", title: "Отложено", emoji: "⏰" };

/** Открытые элементы очереди: не готово, не в архиве, не отложено. */
function openQueue(filed: NoteDoc[], kinds: KindId[], ctx: ContextId | null, today: string) {
  return filed.filter((n) => kinds.includes(kindOf(n).id) && !n.done && !isSnoozed(n, today) && (!ctx || n.context?.includes(ctx)));
}

export function ShelvesPage() {
  const notes = useCollection<Note>("notes");
  const [params, setParams] = useSearchParams();
  const ctx = (params.get("ctx") as ContextId | null) ?? null;
  const today = localKey(new Date());
  const filed = useMemo(() => notes.items.filter((n) => n.status !== "inbox" && n.status !== "archived"), [notes.items]);
  const inbox = notes.items.filter((n) => n.status === "inbox").length;
  const snoozed = filed.filter((n) => isSnoozed(n, today)).length;

  const byKind = useMemo(() => {
    const m = new Map<KindId, NoteDoc[]>();
    for (const n of filed) {
      if (ctx && !n.context?.includes(ctx)) continue;
      const id = kindOf(n).id;
      m.set(id, [...(m.get(id) ?? []), n]);
    }
    for (const list of m.values()) list.sort((a, b) => at(b) - at(a));
    return m;
  }, [filed, ctx]);

  return (
    <Wrap>
      <Head
        title="Полки"
        sub={`${filed.length} разложено${inbox ? ` · ${inbox} ждут в воронке` : ""}${snoozed ? ` · ${snoozed} отложено` : ""}`}
        right={
          <Link to="/all" className="nt-btn nt-btn-ghost nt-btn-sm">
            🔎 Все
          </Link>
        }
      />

      <div className="nt-scroll-x -mx-4 mb-4 flex gap-1.5 px-4">
        <button type="button" className={cn("nt-chip", !ctx && "nt-chip-on")} onClick={() => setParams({ ctx: null })}>
          Когда угодно
        </button>
        {CONTEXTS.map((c) => (
          <button key={c.id} type="button" className={cn("nt-chip", ctx === c.id && "nt-chip-on")} onClick={() => setParams({ ctx: ctx === c.id ? null : c.id })}>
            {c.emoji} {c.name}
          </button>
        ))}
      </div>

      <section className="mb-6">
        <div className="grid grid-cols-4 gap-2">
          {[...COLLECTIONS, LATER].map((c) => {
            const count = "kinds" in c ? openQueue(filed, c.kinds as KindId[], ctx, today).length : filed.filter((n) => isSnoozed(n, today) && (!ctx || n.context?.includes(ctx))).length;
            return (
              <Link
                key={c.id}
                to={`/c/${c.id}${ctx ? `?ctx=${ctx}` : ""}`}
                className={cn("nt-paper flex flex-col items-center gap-0.5 px-1 py-2.5 text-center", !count && "opacity-50")}
              >
                <span className="text-xl">{c.emoji}</span>
                <span className="w-full truncate text-[11px] font-semibold leading-tight sm:text-sm">{c.title}</span>
                <span className="nt-muted text-[11px]">{count || "—"}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <h2 className="nt-h2 mb-2">По типам</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {KINDS.map((k) => {
          const list = byKind.get(k.id) ?? [];
          const open = k.queue ? list.filter((n) => !n.done).length : list.length;
          if (!list.length && (k.id === "other" || ctx)) return null;
          return (
            <Link key={k.id} to={`/shelves/${k.id}`} className={cn("nt-paper relative flex min-h-[104px] flex-col overflow-hidden p-3.5", !list.length && "opacity-55")}>
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: k.color }} />
              <div className="flex items-start justify-between">
                <span className="text-2xl">{k.emoji}</span>
                <span className="nt-serif text-2xl font-semibold" style={{ color: k.color }}>
                  {open}
                </span>
              </div>
              <div className="mt-1 font-semibold leading-tight">{k.plural}</div>
              <div className="nt-muted mt-auto line-clamp-1 pt-1 text-xs">{list[0] ? titleOf(list[0]) : "пусто"}</div>
            </Link>
          );
        })}
      </div>
    </Wrap>
  );
}

type Tab = "open" | "done" | "archive";

function NoteList({ items, kinds, title, sub, back }: { items: NoteDoc[]; kinds: KindId[]; title: string; sub?: string; back: string }) {
  const topics = useCollection<Topic>("topics");
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "open";
  const ctx = (params.get("ctx") as ContextId | null) ?? null;
  const today = localKey(new Date());
  const done = useDone();
  const isQueue = kinds.some((k) => kindById(k).queue);

  const mine = items.filter((n) => kinds.includes(kindOf(n).id) && n.status !== "inbox" && (!ctx || n.context?.includes(ctx)));
  const groups: Record<Tab, NoteDoc[]> = {
    open: mine.filter((n) => n.status !== "archived" && !n.done).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(isSnoozed(a, today)) - Number(isSnoozed(b, today)) || at(b) - at(a)),
    done: mine.filter((n) => n.status !== "archived" && n.done).sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt)),
    archive: mine.filter((n) => n.status === "archived").sort((a, b) => b.updatedAt - a.updatedAt),
  };
  const list = groups[tab];
  const tabs: { id: Tab; label: string }[] = [
    { id: "open", label: isQueue ? `В очереди ${groups.open.length}` : `Все ${groups.open.length}` },
    ...(isQueue ? [{ id: "done" as Tab, label: `Готово ${groups.done.length}` }] : []),
    { id: "archive", label: `Архив ${groups.archive.length}` },
  ];

  return (
    <Wrap>
      <Head title={title} sub={sub} back={back} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={cn("nt-chip", tab === t.id && "nt-chip-on")} onClick={() => setParams({ tab: t.id === "open" ? null : t.id })}>
            {t.label}
          </button>
        ))}
        {ctx && (
          <button type="button" className="nt-chip" onClick={() => setParams({ ctx: null })}>
            {CONTEXTS.find((c) => c.id === ctx)?.emoji} {CONTEXTS.find((c) => c.id === ctx)?.name} ✕
          </button>
        )}
      </div>
      {!list.length ? (
        <Empty
          icon={kindById(kinds[0]).emoji}
          title={tab === "done" ? "Пока ничего не закрыто" : tab === "archive" ? "Архив пуст" : "Пусто"}
          text={tab === "open" ? "Сюда попадёт то, что разберётся из воронки" : undefined}
        />
      ) : (
        <div className="space-y-2">
          {list.map((n) => (
            <NoteCard key={n.id} note={n} topic={n.topicId ? tmap.get(n.topicId) : undefined} onDone={kindOf(n).queue && tab !== "archive" ? () => done.toggle(n) : undefined} />
          ))}
        </div>
      )}
      {done.modal}
    </Wrap>
  );
}

export function ShelfPage() {
  const { id } = useParams<{ id: string }>();
  const kind = kindById(id);
  const notes = useCollection<Note>("notes");
  return <NoteList items={notes.items} kinds={[kind.id]} title={`${kind.emoji} ${kind.plural}`} sub={kind.hint} back="/shelves" />;
}

export function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const notes = useCollection<Note>("notes");
  if (id === LATER.id) return <LaterList items={notes.items} />;
  return <NoteList items={notes.items} kinds={c.kinds} title={`${c.emoji} ${c.title}`} sub={c.kinds.map((k) => kindById(k).plural).join(", ")} back="/shelves" />;
}

/** Отложенное: что и когда всплывёт. */
function LaterList({ items }: { items: NoteDoc[] }) {
  const topics = useCollection<Topic>("topics");
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const today = localKey(new Date());
  const list = items.filter((n) => n.status !== "inbox" && n.status !== "archived" && isSnoozed(n, today)).sort((a, b) => a.snoozeUntil!.localeCompare(b.snoozeUntil!));
  return (
    <Wrap>
      <Head title={`${LATER.emoji} ${LATER.title}`} sub="Не видно на полках до своего дня — потом всплывёт в «Обзоре»" back="/shelves" />
      {!list.length ? (
        <Empty icon="⏰" title="Ничего не отложено" text="В заметке нажми «Отложить» — или скажи при записи «напомни через неделю»" />
      ) : (
        <div className="space-y-2">
          {list.map((n) => (
            <NoteCard key={n.id} note={n} topic={n.topicId ? tmap.get(n.topicId) : undefined} />
          ))}
        </div>
      )}
    </Wrap>
  );
}
