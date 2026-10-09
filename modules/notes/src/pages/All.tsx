import { useMemo } from "react";
import { cn, useCollection, useNavigate, useSearchParams } from "@lifehub/sdk";
import { Empty, Head, NoteCard, Wrap, topicMap } from "../components/kit.tsx";
import { noteText } from "../lib/text.ts";
import type { Note, Topic } from "../lib/types.ts";

/** Все заметки с поиском и тегами — включая старые, сделанные до воронки. */
export function AllPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";

  const allTags = useMemo(() => [...new Set(notes.items.flatMap((n) => n.tags ?? []))].sort(), [notes.items]);
  const filtered = useMemo(() => {
    const query = q.toLowerCase();
    return notes.items
      .filter((n) => n.status !== "inbox")
      .filter((n) => (!tag || n.tags?.includes(tag)) && (!query || noteText(n).toLowerCase().includes(query) || (n.links ?? []).some((l) => `${l.title} ${l.url}`.toLowerCase().includes(query))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes.items, q, tag]);

  const create = async () => {
    const n = await notes.add({ title: "", body: "", tags: tag ? [tag] : [], pinned: false, status: "filed", kind: "thought", capturedAt: Date.now() });
    navigate(`/n/${n.id}?edit=1`);
  };

  return (
    <Wrap>
      <Head
        title="Все заметки"
        back="/shelves"
        right={
          <button type="button" className="nt-btn nt-btn-sm" onClick={create}>
            ＋ Заметка
          </button>
        }
      />
      <input className="nt-field mb-3" value={q} onChange={(e) => setParams({ q: e.target.value })} placeholder="Поиск по тексту и ссылкам…" />
      {allTags.length > 0 && (
        <div className="nt-scroll-x -mx-4 mb-4 flex gap-1.5 px-4">
          <button type="button" className={cn("nt-chip", !tag && "nt-chip-on")} onClick={() => setParams({ tag: null })}>
            все
          </button>
          {allTags.map((t) => (
            <button key={t} type="button" className={cn("nt-chip", t === tag && "nt-chip-on")} onClick={() => setParams({ tag: t === tag ? null : t })}>
              #{t}
            </button>
          ))}
        </div>
      )}
      {!notes.loading && !filtered.length ? (
        <Empty icon="📝" title={notes.items.length ? "Ничего не нашлось" : "Заметок пока нет"} text={notes.items.length ? "Попробуй другой запрос" : "Начни с воронки — кидай туда всё подряд"} />
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <NoteCard key={n.id} note={n} topic={n.topicId ? tmap.get(n.topicId) : undefined} />
          ))}
        </div>
      )}
    </Wrap>
  );
}
