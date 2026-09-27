import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import "./prose.css";
import {
  defineModule, Page, Button, Input, Textarea, Badge, EmptyState, Tabs, Card, Loading, IconButton,
  useCollection, useDoc, useParams, useNavigate, useSearchParams, Link, confirm, formatRelative, cn,
} from "@lifehub/sdk";

interface Note {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
}

marked.setOptions({ gfm: true, breaks: true });

function preview(body: string) {
  return body.replace(/[#>*_`~\-\[\]()!]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function NotesList() {
  const notes = useCollection<Note>("notes");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";

  const allTags = useMemo(() => [...new Set(notes.items.flatMap((n) => n.tags ?? []))].sort(), [notes.items]);
  const filtered = useMemo(() => {
    const query = q.toLowerCase();
    return notes.items
      .filter((n) => (!tag || n.tags?.includes(tag)) && (!query || (n.title + " " + n.body).toLowerCase().includes(query)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes.items, q, tag]);

  const create = async () => {
    const note = await notes.add({ title: "", body: "", tags: tag ? [tag] : [], pinned: false });
    navigate(`/n/${note.id}?edit=1`);
  };

  return (
    <Page
      title="Заметки"
      actions={
        <Button variant="primary" onClick={create}>
          Новая
        </Button>
      }
    >
      <Input value={q} onChange={(e) => setParams({ q: e.target.value })} placeholder="Поиск…" className="mb-3" />
      {allTags.length > 0 && (
        <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
          <button onClick={() => setParams({ tag: null })}>
            <Badge tone={!tag ? "accent" : "neutral"}>все</Badge>
          </button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setParams({ tag: t === tag ? null : t })}>
              <Badge tone={t === tag ? "accent" : "neutral"}>#{t}</Badge>
            </button>
          ))}
        </div>
      )}
      {notes.loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📝"
          title={notes.items.length ? "Ничего не нашлось" : "Заметок пока нет"}
          text={notes.items.length ? "Попробуйте другой запрос" : "Поддерживается markdown: заголовки, списки, чек-листы, ссылки"}
          action={!notes.items.length && <Button variant="primary" onClick={create}>Создать заметку</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((n) => (
            <Link key={n.id} to={`/n/${n.id}`}>
              <Card interactive className="h-full">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 font-semibold">{n.title || <span className="text-muted">Без названия</span>}</div>
                  {n.pinned && <span title="Закреплена">📌</span>}
                </div>
                {n.body && <p className="mt-1 line-clamp-3 text-sm text-muted">{preview(n.body)}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {n.tags?.map((t) => (
                    <Badge key={t}>#{t}</Badge>
                  ))}
                  <span className="ml-auto text-xs text-muted">{formatRelative(n.updatedAt)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

function NoteView() {
  const { id } = useParams<{ id: string }>();
  const { doc, loading, update, remove } = useDoc<Note>("notes", id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = params.get("edit") ? "edit" : "view";

  if (loading) return <Loading />;
  if (!doc) {
    return (
      <Page back="/">
        <EmptyState icon="🤷" title="Заметка не найдена" />
      </Page>
    );
  }

  return (
    <Page
      back="/"
      width="narrow"
      actions={
        <>
          <IconButton label={doc.pinned ? "Открепить" : "Закрепить"} onClick={() => update({ pinned: !doc.pinned })} className={doc.pinned ? "opacity-100" : "opacity-50"}>
            📌
          </IconButton>
          <IconButton
            label="Удалить"
            onClick={async () => {
              if (await confirm("Удалить заметку?", { danger: true, confirmText: "Удалить" })) {
                await remove();
                navigate("/", { replace: true });
              }
            }}
          >
            🗑️
          </IconButton>
        </>
      }
    >
      <Tabs
        className="mb-4"
        value={mode}
        onChange={(m) => setParams({ edit: m === "edit" ? "1" : null })}
        tabs={[
          { id: "view", label: "Просмотр" },
          { id: "edit", label: "Редактор" },
        ]}
      />
      {mode === "edit" ? <Editor key={doc.id} note={doc} onSave={update} /> : <Rendered note={doc} />}
    </Page>
  );
}

function Rendered({ note }: { note: Note }) {
  const html = useMemo(() => marked.parse(note.body || "*Пусто — откройте редактор*") as string, [note.body]);
  return (
    <article>
      <h1 className="mb-2 text-2xl font-semibold">{note.title || "Без названия"}</h1>
      {note.tags?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {note.tags.map((t) => (
            <Link key={t} to={`/?tag=${encodeURIComponent(t)}`}>
              <Badge>#{t}</Badge>
            </Link>
          ))}
        </div>
      )}
      <div className="lh-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

/** Автосохранение: изменения уходят на сервер через полсекунды после паузы. */
function Editor({ note, onSave }: { note: Note; onSave: (patch: Partial<Note>) => Promise<unknown> }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState((note.tags ?? []).join(", "));
  const [saved, setSaved] = useState(true);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const t = setTimeout(async () => {
      await onSave({
        title,
        body,
        tags: tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
      });
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [title, body, tags]);

  return (
    <div className="space-y-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" className="h-12 text-lg font-semibold" autoFocus={!note.title} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст заметки (markdown)" className="min-h-[50dvh] font-mono text-sm" />
      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Теги через запятую" />
      <p className={cn("text-right text-xs", saved ? "text-muted" : "text-warning")}>{saved ? "Сохранено" : "Сохраняю…"}</p>
    </div>
  );
}

function RecentWidget() {
  const { items, loading } = useCollection<Note>("notes");
  if (loading) return null;
  const recent = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt).slice(0, 4);
  if (!recent.length) return <p className="text-sm text-muted">Заметок пока нет</p>;
  return (
    <ul className="space-y-2">
      {recent.map((n) => (
        <li key={n.id}>
          <Link to={`/n/${n.id}`} className="block rounded-lg hover:text-accent">
            <div className="truncate text-sm font-medium">
              {n.pinned && "📌 "}
              {n.title || "Без названия"}
            </div>
            <div className="truncate text-xs text-muted">{preview(n.body) || formatRelative(n.updatedAt)}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default defineModule({
  routes: {
    "/": NotesList,
    "/n/:id": NoteView,
  },
  widgets: {
    recent: { title: "Последние заметки", component: RecentWidget },
  },
});
