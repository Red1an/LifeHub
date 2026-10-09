import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { marked } from "marked";
import { Link, Modal, cn, confirm, db, files, formatDate, toast, useCollection, useNavigate, useParams, useSearchParams } from "@lifehub/sdk";
import { EventBox, Gallery, Head, LinkPreview, NoteCard, Stars, Wrap, propsLine, topicMap, useAreas, useDone, useSendDeadline, useSendToCalendar } from "../components/kit.tsx";
import { canEnrich, enrichNote } from "../lib/enrich.ts";
import { CONTEXTS, KINDS, isSnoozed, kindOf, snoozeOptions } from "../lib/kinds.ts";
import { similar } from "../lib/related.ts";
import { noteText, preview, shortDate, titleOf } from "../lib/text.ts";
import { backlinks, normName, titleIndex, wikiToMarkdown } from "../lib/wikilinks.ts";
import type { ContextId, Note, NoteDoc, Topic } from "../lib/types.ts";

marked.setOptions({ gfm: true, breaks: true });

/** null вместо undefined: undefined в JSON пропадает и поле не сбросится. */
const clear = null as unknown as undefined;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const Label = ({ children }: { children: ReactNode }) => <div className="nt-muted mb-1.5 text-xs font-medium uppercase tracking-wide">{children}</div>;

export function NotePage() {
  const { id } = useParams<{ id: string }>();
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const send = useSendToCalendar();
  const sendDeadline = useSendDeadline();
  const done = useDone();
  const [linking, setLinking] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const { areas } = useAreas();
  const note = notes.items.find((n) => n.id === id);
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const byId = useMemo(() => new Map(notes.items.map((n) => [n.id, n])), [notes.items]);
  const edit = !!params.get("edit");

  if (notes.loading) return null;
  if (!note) {
    return (
      <Wrap>
        <Head title="Заметка не найдена" back="/" />
      </Wrap>
    );
  }

  const kind = kindOf(note);
  const back = backlinks(note, notes.items);
  // Запись дня ↔ вынесенное из неё.
  const day = note.fromDay ? byId.get(note.fromDay) : undefined;
  const fromThisDay = kind.id === "day" ? notes.items.filter((n) => n.fromDay === note.id) : [];
  const related =(note.related ?? []).map((r) => byId.get(r)).filter((x): x is NoteDoc => !!x);
  const update = (patch: Partial<Note>) => notes.update(note.id, patch);
  const archived = note.status === "archived";
  const inbox = note.status === "inbox";

  const unlink = async (other: NoteDoc) => {
    await update({ related: (note.related ?? []).filter((x) => x !== other.id) });
    await notes.update(other.id, { related: (other.related ?? []).filter((x) => x !== note.id) });
  };
  const link = async (other: NoteDoc) => {
    await update({ related: [...new Set([...(note.related ?? []), other.id])] });
    await notes.update(other.id, { related: [...new Set([...(other.related ?? []), note.id])] });
  };

  const del = async () => {
    if (!(await confirm("Удалить заметку насовсем? Можно вместо этого убрать в архив.", { danger: true, confirmText: "Удалить" }))) return;
    for (const r of related) await notes.update(r.id, { related: (r.related ?? []).filter((x) => x !== note.id) });
    await notes.remove(note.id);
    for (const img of note.images ?? []) files.remove(img).catch(() => {});
    navigate(-1);
  };

  const toggleArchive = async () => {
    await update({ status: archived ? "filed" : "archived" });
    toast(archived ? "Вернул из архива" : "Убрал в архив — найдёшь на полке во вкладке «Архив»");
  };

  const toggleContext = (c: ContextId) => {
    const cur = note.context ?? [];
    update({ context: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
  };

  return (
    <Wrap>
      <Head
        title=""
        back={inbox ? "/" : `/shelves/${kind.id}`}
        right={
          <>
            <button type="button" className={cn("nt-mic !h-9 !w-9 !text-base", !note.pinned && "opacity-50")} aria-label={note.pinned ? "Открепить" : "Закрепить"} onClick={() => update({ pinned: !note.pinned })}>
              📌
            </button>
            <button type="button" className={cn("nt-mic !h-9 !w-9 !text-base", edit && "nt-mic-on !animate-none")} aria-label="Редактировать" onClick={() => setParams({ edit: edit ? null : "1" })}>
              ✏️
            </button>
            {!inbox && (
              <button type="button" className="nt-mic !h-9 !w-9 !text-base" aria-label={archived ? "Вернуть из архива" : "В архив"} onClick={toggleArchive}>
                {archived ? "📤" : "🗃️"}
              </button>
            )}
            <button type="button" className="nt-mic !h-9 !w-9 !text-base" aria-label="Удалить" onClick={del}>
              🗑️
            </button>
          </>
        }
      />

      {inbox && <div className="nt-soft mb-3 p-3 text-sm">🌀 Эта запись ещё в воронке — разберётся при следующем разборе.</div>}
      {day && (
        <Link to={`/n/${day.id}`} className="nt-soft mb-3 flex items-center gap-2 p-3 text-sm">
          <span>📓</span>
          <span className="min-w-0 flex-1 truncate">
            Из записи дня{day.dayDate ? ` за ${shortDate(day.dayDate)}` : ""}: {titleOf(day)}
          </span>
          <span className="nt-accent">→</span>
        </Link>
      )}
      {archived && <div className="nt-soft mb-3 p-3 text-sm">🗃️ В архиве — не показывается на полках.</div>}
      {isSnoozed(note) && (
        <div className="nt-soft mb-3 flex items-center gap-2 p-3 text-sm">
          <span className="flex-1">⏰ Отложено до {shortDate(note.snoozeUntil!)} — потом всплывёт в обзоре.</span>
          <button type="button" className="nt-accent" onClick={() => update({ snoozeUntil: clear })}>
            Вернуть
          </button>
        </div>
      )}

      {edit ? <Editor key={note.id} note={note} all={notes.items} onSave={update} /> : <Rendered note={note} all={notes.items} />}

      {canEnrich(note) && !inbox && (
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            className="nt-accent"
            disabled={enriching}
            onClick={async () => {
              setEnriching(true);
              const found = await enrichNote(note);
              setEnriching(false);
              if (!found?.cover && !found?.about) toast("Ничего не нашлось — проверь название или поля");
            }}
          >
            {enriching ? "Ищу…" : note.cover ? "🖼️ Найти обложку заново" : "🖼️ Найти обложку и описание"}
          </button>
          {(note.cover || note.about) && (
            <button type="button" className="nt-muted" onClick={() => update({ cover: clear, about: clear, extRating: clear, extUrl: clear })}>
              Убрать — не то
            </button>
          )}
        </div>
      )}

      <div className="mt-5 space-y-5">
        {!!note.images?.length && <Gallery ids={note.images} />}

        {note.event && <EventBox event={note.event} onSend={() => send(note)} />}

        {!!note.links?.length && (
          <div className="space-y-2">
            {note.links.map((l) => (
              <LinkPreview key={l.url} card={l} />
            ))}
          </div>
        )}

        {kind.queue && !inbox && !archived && (
          <div className="space-y-2">
            {note.done ? (
              <div className="nt-paper p-3.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">✓ {cap(kind.queue)}</span>
                  {note.doneAt && <span className="nt-muted text-xs">{formatDate(note.doneAt, "long")}</span>}
                  <button type="button" className="nt-accent ml-auto text-sm" onClick={() => done.toggle(note)}>
                    Вернуть в очередь
                  </button>
                </div>
                {kind.rate && (
                  <div className="mt-2 space-y-2">
                    <Stars value={note.rating} onChange={(v) => update({ rating: v })} size="lg" />
                    <input
                      className="nt-field"
                      defaultValue={note.verdict ?? ""}
                      onBlur={(e) => e.target.value.trim() !== (note.verdict ?? "") && update({ verdict: e.target.value.trim() })}
                      placeholder="Впечатление одной строкой"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="nt-btn flex-1" onClick={() => done.toggle(note)}>
                  ✓ {cap(kind.queue)}
                </button>
                <button type="button" className="nt-btn nt-btn-ghost" onClick={() => setSnoozing(true)}>
                  ⏰ Отложить
                </button>
              </div>
            )}
          </div>
        )}

        {kind.fields.length > 0 && (
          <section>
            <Label>Подробности</Label>
            <div className="grid grid-cols-2 gap-2">
              {kind.fields.map((f) => (
                <label key={f.key + (note.props?.[f.key] ?? "")} className="block">
                  <span className="nt-muted mb-0.5 block text-xs">{f.label}</span>
                  <input
                    className="nt-field text-sm"
                    defaultValue={note.props?.[f.key] ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (note.props?.[f.key] ?? "")) update({ props: { ...note.props, [f.key]: v } });
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        {kind.id === "task" && !inbox && (
          <section>
            <Label>Срок</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className="nt-field !w-auto" value={note.due ?? ""} onChange={(e) => update({ due: e.target.value || clear, dueSentAt: clear })} />
              <input
                type="number"
                min={0}
                step={0.5}
                className="nt-field !w-24"
                placeholder="часов"
                defaultValue={note.effort ?? ""}
                onBlur={(e) => update({ effort: Number(e.target.value) || clear })}
              />
              {note.due && !note.done && (
                <button type="button" className={cn("nt-btn nt-btn-sm", !!note.dueSentAt && "nt-btn-ghost")} onClick={() => sendDeadline(note)}>
                  🎯 {note.dueSentAt ? "Ещё раз в Дедлайны" : "В Дедлайны"}
                </button>
              )}
            </div>
            <p className="nt-muted mt-1 text-xs">«Расписание» разложит дело по свободным окнам до срока.</p>
          </section>
        )}

        <section>
          <Label>Что это</Label>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className={cn("nt-chip", kind.id === k.id && "nt-chip-on")} onClick={() => update({ kind: k.id })}>
                {k.emoji} {k.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <Label>Когда</Label>
          <div className="flex flex-wrap gap-1.5">
            {CONTEXTS.map((c) => (
              <button key={c.id} type="button" className={cn("nt-chip", note.context?.includes(c.id) && "nt-chip-on")} onClick={() => toggleContext(c.id)}>
                {c.emoji} {c.name}
              </button>
            ))}
            {!kind.queue && !inbox && !isSnoozed(note) && (
              <button type="button" className="nt-chip" onClick={() => setSnoozing(true)}>
                ⏰ Отложить…
              </button>
            )}
          </div>
        </section>

        <section>
          <Label>Сфера</Label>
          <div className="flex flex-wrap gap-1.5">
            {areas.map((a) => (
              <button key={a.id} type="button" className={cn("nt-chip", note.area === a.id && "nt-chip-on")} onClick={() => update({ area: a.id })}>
                {a.emoji} {a.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <Label>Проект</Label>
          <div className="flex gap-2">
            <select className="nt-field" value={note.topicId ?? ""} onChange={(e) => update({ topicId: e.target.value || null })}>
              <option value="">Без проекта</option>
              {topics.items
                .filter((t) => !t.closedAt || t.id === note.topicId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.name}
                  </option>
                ))}
            </select>
            {note.topicId && tmap.get(note.topicId) && (
              <Link to={`/t/${note.topicId}`} className="nt-btn nt-btn-ghost flex-none">
                →
              </Link>
            )}
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="nt-muted text-xs font-medium uppercase tracking-wide">Связано</span>
            <button type="button" className="nt-accent text-sm" onClick={() => setLinking(true)}>
              ＋ Связать
            </button>
          </div>
          {related.length ? (
            <div className="space-y-2">
              {related.map((r) => (
                <div key={r.id} className="relative">
                  <NoteCard note={r} topic={r.topicId ? tmap.get(r.topicId) : undefined} compact />
                  <button type="button" aria-label="Убрать связь" className="nt-muted absolute right-2 top-2 size-7 rounded-full bg-[var(--nt-paper)] text-sm" onClick={() => unlink(r)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="nt-muted text-sm">Пока ни с чем не связано.</p>
          )}
        </section>

        {fromThisDay.length > 0 && (
          <section>
            <div className="nt-muted mb-1.5 text-xs font-medium uppercase tracking-wide">Что вышло из этой записи</div>
            <div className="space-y-2">
              {fromThisDay.map((r) => (
                <NoteCard key={r.id} note={r} topic={r.topicId ? tmap.get(r.topicId) : undefined} compact />
              ))}
            </div>
          </section>
        )}

        {back.length > 0 && (
          <section>
            <div className="nt-muted mb-1.5 text-xs font-medium uppercase tracking-wide">Ссылаются сюда</div>
            <div className="space-y-2">
              {back.map((r) => (
                <NoteCard key={r.id} note={r} topic={r.topicId ? tmap.get(r.topicId) : undefined} compact />
              ))}
            </div>
          </section>
        )}

        <p className="nt-muted text-xs">
          Записано {formatDate(note.capturedAt ?? note.createdAt, "datetime")}
          {note.source === "voice" && " голосом"}
          {note.source === "share" && " через «Поделиться»"}
          {note.source === "photo" && " с фото"}
          {!!note.mergedFrom?.length && ` · склеено из ${note.mergedFrom.length + 1} обрывков`}
        </p>
      </div>

      <LinkPicker open={linking} onClose={() => setLinking(false)} note={note} pool={notes.items} onPick={(n) => (link(n), setLinking(false))} />
      <Modal open={snoozing} onClose={() => setSnoozing(false)} title="Напомнить позже">
        <div className="space-y-2">
          {snoozeOptions().map((o) => (
            <button
              key={o.date}
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-3 text-left hover:bg-surface-2"
              onClick={() => (update({ snoozeUntil: o.date }), setSnoozing(false), toast(`Всплывёт ${shortDate(o.date)}`))}
            >
              <span className="font-medium">{o.label}</span>
              <span className="text-sm text-muted">{shortDate(o.date)}</span>
            </button>
          ))}
          <p className="pt-1 text-xs text-muted">До этого дня заметки не будет на полках, потом она появится в «Обзоре».</p>
        </div>
      </Modal>
      {done.modal}
    </Wrap>
  );
}

function Rendered({ note, all }: { note: NoteDoc; all: NoteDoc[] }) {
  const navigate = useNavigate();
  const index = useMemo(() => titleIndex(all), [all]);
  const html = useMemo(() => marked.parse(wikiToMarkdown(note.body || "*Пусто — нажми ✏️*", index)) as string, [note.body, index]);

  // Ссылки [[…]]: на заметку — переход, на несуществующую — создать её и открыть.
  const onClick = async (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (href.startsWith("#nt:")) {
      e.preventDefault();
      navigate(`/n/${href.slice(4)}`);
    } else if (href.startsWith("#nt-new:")) {
      e.preventDefault();
      const title = decodeURIComponent(href.slice(8));
      const created = await db.collection<Note>("notes").add({ title, body: "", tags: [], pinned: false, status: "filed", kind: "thought", capturedAt: Date.now() });
      navigate(`/n/${created.id}?edit=1`);
    }
  };

  return (
    <article>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="nt-h1 mb-2">{titleOf(note)}</h1>
          {propsLine(note) && <div className="nt-muted mb-2 text-sm">{propsLine(note)}</div>}
          {note.extRating && (
            <div className="mb-2 text-sm">
              ⭐ <b>{note.extRating.value}</b>
              <span className="nt-muted">
                {" "}
                / {note.extRating.of} · {note.extRating.source}
                {note.extRating.votes ? `, ${note.extRating.votes} оценок` : ""}
              </span>
            </div>
          )}
          {note.tags?.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {note.tags.map((t) => (
                <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} className="nt-muted text-sm">
                  #{t}
                </Link>
              ))}
            </div>
          )}
        </div>
        {note.cover && <img src={note.cover} alt="" className="h-36 w-24 flex-none rounded-xl object-cover shadow-md sm:h-44 sm:w-30" onError={(e) => (e.currentTarget.style.display = "none")} />}
      </div>
      {note.about && (
        <p className="nt-soft mb-3 p-3 text-sm leading-relaxed">
          {note.about}
          {note.extUrl && (
            <a href={note.extUrl} target="_blank" rel="noreferrer" className="nt-accent ml-1 whitespace-nowrap">
              подробнее ↗
            </a>
          )}
        </p>
      )}
      <div className="lh-prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

/** Автосохранение: изменения уходят на сервер через полсекунды после паузы. После «[[» — подсказка названий. */
function Editor({ note, all, onSave }: { note: NoteDoc; all: NoteDoc[]; onSave: (patch: Partial<Note>) => Promise<unknown> }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState((note.tags ?? []).join(", "));
  const [saved, setSaved] = useState(true);
  const [query, setQuery] = useState<string | null>(null);
  const first = useRef(true);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const t = setTimeout(async () => {
      await onSave({ title, body, tags: tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean) });
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [title, body, tags]);

  /** Незакрытая «[[…» перед курсором → то, что набрано после неё. */
  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/\[\[([^[\]\n]{0,60})$/);
    setQuery(m ? m[1] : null);
  };

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = normName(query);
    return all
      .filter((n) => n.id !== note.id && n.status !== "inbox" && (!q || normName(titleOf(n)).includes(q)))
      .sort((a, b) => Number(normName(titleOf(b)).startsWith(q)) - Number(normName(titleOf(a)).startsWith(q)) || b.updatedAt - a.updatedAt)
      .slice(0, 6);
  }, [query, all, note.id]);

  const insert = (name: string) => {
    const el = area.current;
    if (!el) return;
    const start = el.value.slice(0, el.selectionStart).replace(/\[\[[^[\]\n]*$/, "");
    const rest = el.value.slice(el.selectionStart).replace(/^[^[\]\n]*\]\]/, "");
    const next = `${start}[[${name}]]${rest}`;
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start.length + name.length + 4;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-3">
      <input className="nt-field nt-serif h-12 text-lg font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" autoFocus={!note.title} />
      <div className="relative">
        <textarea
          ref={area}
          className="nt-field min-h-[40dvh] font-mono text-sm leading-relaxed"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            detect(e.target);
          }}
          onClick={(e) => detect(e.currentTarget)}
          onKeyUp={(e) => (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") && detect(e.currentTarget)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          placeholder="Текст (markdown). [[Название]] — ссылка на другую заметку"
        />
        {query !== null && (
          <div className="nt-paper absolute inset-x-2 bottom-2 z-10 max-h-56 overflow-y-auto p-1 shadow-lg">
            {suggestions.map((n) => (
              <button key={n.id} type="button" className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--nt-paper-2)]" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(titleOf(n))}>
                {kindOf(n).emoji} {titleOf(n)}
              </button>
            ))}
            {query.trim() && !suggestions.some((n) => normName(titleOf(n)) === normName(query)) && (
              <button type="button" className="nt-accent block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--nt-paper-2)]" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(query.trim())}>
                ＋ Новая заметка «{query.trim()}»
              </button>
            )}
            {!suggestions.length && !query.trim() && <div className="nt-muted px-2.5 py-2 text-sm">Начни писать название…</div>}
          </div>
        )}
      </div>
      <input className="nt-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Теги через запятую" />
      <p className={cn("text-right text-xs", saved ? "nt-muted" : "text-warning")}>{saved ? "Сохранено" : "Сохраняю…"}</p>
    </div>
  );
}

function LinkPicker({ open, onClose, note, pool, onPick }: { open: boolean; onClose: () => void; note: NoteDoc; pool: NoteDoc[]; onPick: (n: NoteDoc) => void }) {
  const [q, setQ] = useState("");
  const exclude = useMemo(() => new Set([note.id, ...(note.related ?? [])]), [note]);
  const candidates = useMemo(() => {
    const filed = pool.filter((n) => n.status !== "inbox");
    if (q.trim()) {
      const s = q.toLowerCase();
      return filed.filter((n) => !exclude.has(n.id) && noteText(n).toLowerCase().includes(s)).slice(0, 20);
    }
    return similar(noteText(note), note.tags ?? [], filed, 10, exclude).map((x) => x.note);
  }, [q, pool, note, exclude]);

  return (
    <Modal open={open} onClose={onClose} title="Связать с заметкой">
      <input className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2 outline-none" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && candidates.length > 0 && <div className="mb-2 text-xs text-muted">Похожие</div>}
      <div className="space-y-1">
        {candidates.map((n) => (
          <button key={n.id} type="button" className="block w-full rounded-lg px-2 py-2 text-left hover:bg-surface-2" onClick={() => onPick(n)}>
            <div className="text-sm font-medium">
              {kindOf(n).emoji} {titleOf(n)}
            </div>
            <div className="truncate text-xs text-muted">{preview(n.body, 90)}</div>
          </button>
        ))}
        {!candidates.length && <div className="py-4 text-center text-sm text-muted">{q ? "Ничего не нашлось" : "Похожих не нашлось — поищи по словам"}</div>}
      </div>
    </Modal>
  );
}
