import { useMemo, useState, type ReactNode } from "react";
import { Link, cn, plural, prompt, toast, useCollection, useParams, useSearchParams } from "@lifehub/sdk";
import { Empty, Head, NoteCard, Wrap, topicMap, useAreas, useDone, usePrefs } from "../components/kit.tsx";
import { classifyAreas } from "../lib/areas.ts";
import { CONTEXTS, GROUPS, KINDS, isDueWord, isSnoozed, kindById, kindOf } from "../lib/kinds.ts";
import { localKey } from "../lib/text.ts";
import type { AreaId, ContextId, KindId, Note, NoteDoc, Topic } from "../lib/types.ts";

const at = (n: NoteDoc) => n.capturedAt ?? n.createdAt;
const isOpen = (n: NoteDoc) => n.status !== "inbox" && n.status !== "archived";

/** «Что дальше» — подборки по действию (как умные папки), а не по месту хранения. */
const COLLECTIONS: { id: string; title: string; emoji: string; kinds: KindId[] }[] = [
  { id: "watch", title: "Посмотреть", emoji: "🍿", kinds: ["movie", "media"] },
  { id: "read", title: "Почитать", emoji: "📖", kinds: ["book", "link"] },
  { id: "play", title: "Поиграть", emoji: "🎮", kinds: ["game"] },
  { id: "go", title: "Сходить", emoji: "🚶", kinds: ["place", "trip"] },
  { id: "try", title: "Попробовать", emoji: "🧪", kinds: ["app"] },
  { id: "buy", title: "Купить", emoji: "🛒", kinds: ["buy"] },
  { id: "do", title: "Сделать", emoji: "✅", kinds: ["task"] },
];

function openQueue(filed: NoteDoc[], kinds: KindId[], ctx: ContextId | null, today: string) {
  return filed.filter((n) => kinds.includes(kindOf(n).id) && !n.done && !isSnoozed(n, today) && (!ctx || n.context?.includes(ctx)));
}

export function ShelvesPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { areas } = useAreas();
  const { prefs } = usePrefs();
  const [params, setParams] = useSearchParams();
  const [sorting, setSorting] = useState<string | null>(null);
  const ctx = (params.get("ctx") as ContextId | null) ?? null;
  const today = localKey(new Date());
  const filed = useMemo(() => notes.items.filter(isOpen), [notes.items]);
  const inbox = notes.items.filter((n) => n.status === "inbox").length;
  const snoozed = filed.filter((n) => isSnoozed(n, today)).length;
  const dueWords = filed.filter((n) => isDueWord(n, today)).length;
  const noArea = notes.items.filter((n) => n.status !== "inbox" && !n.area).length;
  const inCtx = (n: NoteDoc) => !ctx || !!n.context?.includes(ctx);

  const byKind = useMemo(() => {
    const m = new Map<KindId, NoteDoc[]>();
    for (const n of filed) {
      if (ctx && !n.context?.includes(ctx)) continue;
      const id = kindOf(n).id;
      m.set(id, [...(m.get(id) ?? []), n]);
    }
    return m;
  }, [filed, ctx]);

  const sortAreas = async () => {
    setSorting("Смотрю заметки…");
    try {
      const n = await classifyAreas(notes.items, topics.items, areas, prefs, (d, t) => setSorting(`${d} из ${t}…`));
      toast(`Разложено по сферам: ${n}`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSorting(null);
    }
  };

  const tile = "nt-paper flex flex-col items-center gap-0.5 px-1 py-2.5 text-center";

  return (
    <Wrap>
      <Head
        title="Полки"
        sub={`${filed.length} разложено${inbox ? ` · ${inbox} ждут в воронке` : ""}`}
        right={
          <>
            <Link to="/days" className="nt-mic !h-9 !w-9 !text-base" aria-label="Дневник">
              📓
            </Link>
            <Link to="/all" className="nt-btn nt-btn-ghost nt-btn-sm">
              🔎 Все
            </Link>
          </>
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

      {noArea > 0 && (
        <div className="nt-soft mb-4 flex items-center gap-2 p-3 text-sm">
          <span className="flex-1">
            {noArea} {plural(noArea, ["заметка", "заметки", "заметок"])} без сферы
          </span>
          <button type="button" className="nt-accent" disabled={!!sorting} onClick={sortAreas}>
            {sorting ?? "Разложить по сферам"}
          </button>
        </div>
      )}

      <section className="mb-6">
        <h2 className="nt-h2 mb-2">Что дальше</h2>
        <div className="grid grid-cols-4 gap-2">
          {COLLECTIONS.map((c) => {
            const count = openQueue(filed, c.kinds, ctx, today).length;
            return (
              <Link key={c.id} to={`/c/${c.id}${ctx ? `?ctx=${ctx}` : ""}`} className={cn(tile, !count && "opacity-50")}>
                <span className="text-xl">{c.emoji}</span>
                <span className="w-full truncate text-[11px] font-semibold leading-tight sm:text-sm">{c.title}</span>
                <span className="nt-muted text-[11px]">{count || "—"}</span>
              </Link>
            );
          })}
          <Link to="/words" className={cn(tile, !dueWords && "opacity-50")}>
            <span className="text-xl">🔤</span>
            <span className="w-full truncate text-[11px] font-semibold leading-tight sm:text-sm">Слова</span>
            <span className={cn("text-[11px]", dueWords ? "nt-accent font-semibold" : "nt-muted")}>{dueWords ? `повторить ${dueWords}` : "—"}</span>
          </Link>
        </div>
        {snoozed > 0 && (
          <Link to="/c/later" className="nt-muted mt-2 inline-block text-sm">
            ⏰ Отложено: {snoozed} →
          </Link>
        )}
      </section>

      <section className="mb-6">
        <h2 className="nt-h2 mb-2">Сферы</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {areas.map((a) => {
            const list = filed.filter((n) => n.area === a.id && inCtx(n));
            const open = list.filter((n) => !n.done).length;
            const projects = topics.items.filter((t) => t.area === a.id && t.kind === "project" && !t.closedAt).length;
            return (
              <Link key={a.id} to={`/area/${a.id}`} className={cn("nt-paper relative flex items-center gap-2.5 overflow-hidden p-3", !list.length && !projects && "opacity-55")}>
                <div className="absolute inset-y-0 left-0 w-1" style={{ background: a.color }} />
                <span className="text-2xl">{a.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight">{a.name}</div>
                  <div className="nt-muted text-xs">
                    {open || "пусто"}
                    {projects ? ` · ${projects} ${plural(projects, ["проект", "проекта", "проектов"])}` : ""}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <h2 className="nt-h2 mb-2">По типам</h2>
      <div className="space-y-3">
        {GROUPS.map((g) => {
          const kinds = KINDS.filter((k) => k.group === g.id && (k.id !== "other" || (byKind.get("other")?.length ?? 0) > 0));
          return (
            <div key={g.id}>
              <div className="nt-muted mb-1.5 text-xs font-medium uppercase tracking-wide">
                {g.emoji} {g.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {kinds.map((k) => {
                  const list = byKind.get(k.id) ?? [];
                  const open = k.queue ? list.filter((n) => !n.done).length : list.length;
                  return (
                    <Link key={k.id} to={k.id === "day" ? "/days" : k.id === "word" ? "/words" : `/shelves/${k.id}`} className={cn("nt-chip !h-9 !px-3", !list.length && "opacity-50")}>
                      {k.emoji} {k.plural}
                      {open > 0 && <span className="nt-muted ml-0.5">{open}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

type Tab = "open" | "done" | "archive";

/** Список заметок с вкладками «в очереди / готово / архив». */
function NoteList({ items, match, title, sub, back, icon, top }: { items: NoteDoc[]; match: (n: NoteDoc) => boolean; title: string; sub?: string; back: string; icon: string; top?: ReactNode }) {
  const topics = useCollection<Topic>("topics");
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "open";
  const ctx = (params.get("ctx") as ContextId | null) ?? null;
  const today = localKey(new Date());
  const done = useDone();

  const mine = items.filter((n) => n.status !== "inbox" && match(n) && (!ctx || n.context?.includes(ctx)));
  const isQueue = mine.some((n) => kindOf(n).queue);
  const groups: Record<Tab, NoteDoc[]> = {
    open: mine
      .filter((n) => n.status !== "archived" && !n.done)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(isSnoozed(a, today)) - Number(isSnoozed(b, today)) || at(b) - at(a)),
    done: mine.filter((n) => n.status !== "archived" && n.done).sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt)),
    archive: mine.filter((n) => n.status === "archived").sort((a, b) => b.updatedAt - a.updatedAt),
  };
  const list = groups[tab];
  const tabs: { id: Tab; label: string }[] = [
    { id: "open", label: isQueue ? `В очереди ${groups.open.length}` : `Все ${groups.open.length}` },
    ...(isQueue || groups.done.length ? [{ id: "done" as Tab, label: `Готово ${groups.done.length}` }] : []),
    { id: "archive", label: `Архив ${groups.archive.length}` },
  ];

  return (
    <Wrap>
      <Head title={title} sub={sub} back={back} />
      {top}
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
        <Empty icon={icon} title={tab === "done" ? "Пока ничего не закрыто" : tab === "archive" ? "Архив пуст" : "Пусто"} text={tab === "open" ? "Сюда попадёт то, что разберётся из воронки" : undefined} />
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
  return <NoteList items={notes.items} match={(n) => kindOf(n).id === kind.id} icon={kind.emoji} title={`${kind.emoji} ${kind.plural}`} sub={kind.hint} back="/shelves" />;
}

export function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const notes = useCollection<Note>("notes");
  if (id === "later") return <LaterList items={notes.items} />;
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  return (
    <NoteList
      items={notes.items}
      match={(n) => c.kinds.includes(kindOf(n).id)}
      icon={c.emoji}
      title={`${c.emoji} ${c.title}`}
      sub={c.kinds.map((k) => kindById(k).plural).join(", ")}
      back="/shelves"
    />
  );
}

/** Сфера: её проекты и все заметки. */
export function AreaPage() {
  const { id } = useParams<{ id: string }>();
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { areaOf, rename } = useAreas();
  const area = areaOf(id);
  if (!area) {
    return (
      <Wrap>
        <Head title="Сфера не найдена" back="/shelves" />
      </Wrap>
    );
  }
  const projects = topics.items
    .filter((t) => t.area === area.id && t.kind === "project")
    .sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || b.updatedAt - a.updatedAt);

  const edit = async () => {
    const name = (await prompt("Название сферы", area.name))?.trim();
    if (name) rename(area.id as AreaId, { name });
  };

  return (
    <NoteList
      items={notes.items}
      match={(n) => n.area === area.id}
      icon={area.emoji}
      title={`${area.emoji} ${area.name}`}
      sub={area.hint}
      back="/shelves"
      top={
        <div className="mb-4 space-y-2">
          {projects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {projects.map((t) => (
                <Link key={t.id} to={`/t/${t.id}`} className={cn("nt-chip !h-9 !px-3", !!t.closedAt && "opacity-50")}>
                  {t.emoji} {t.name}
                  {t.closedAt ? " ✓" : ""}
                </Link>
              ))}
            </div>
          )}
          <button type="button" className="nt-muted text-xs" onClick={edit}>
            ✏️ Переименовать сферу
          </button>
        </div>
      }
    />
  );
}

/** Отложенное: что и когда всплывёт. */
function LaterList({ items }: { items: NoteDoc[] }) {
  const topics = useCollection<Topic>("topics");
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const today = localKey(new Date());
  const list = items.filter((n) => isOpen(n) && isSnoozed(n, today)).sort((a, b) => a.snoozeUntil!.localeCompare(b.snoozeUntil!));
  return (
    <Wrap>
      <Head title="⏰ Отложено" sub="Не видно на полках до своего дня — потом всплывёт в «Обзоре»" back="/shelves" />
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
