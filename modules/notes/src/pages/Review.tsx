import { useMemo, useState } from "react";
import { Link, formatRelative, toast, useCollection, useStore } from "@lifehub/sdk";
import { Head, NoteCard, Wrap, topicMap, usePrefs, useSendDeadline } from "../components/kit.tsx";
import { DAY, titleOf } from "../lib/text.ts";
import { aiReview, localReview, type ReviewCache } from "../lib/review.ts";
import type { Note, Topic } from "../lib/types.ts";

export function ReviewPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { prefs } = usePrefs();
  const [cache, setCache] = useStore<ReviewCache | null>("review", null);
  const [busy, setBusy] = useState(false);
  const sendDeadline = useSendDeadline();
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);
  const byId = useMemo(() => new Map(notes.items.map((n) => [n.id, n])), [notes.items]);
  const groups = useMemo(() => localReview(notes.items, topics.items), [notes.items, topics.items]);
  const filedCount = notes.items.filter((n) => n.status !== "inbox").length;
  const stale = !cache || Date.now() - cache.at > 7 * DAY;

  const refresh = async () => {
    setBusy(true);
    try {
      setCache(await aiReview(notes.items, topics.items, prefs));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Wrap>
      <Head title="Обзор" sub="Что всплыло: давно лежит, не дошли руки, повторяется" />

      <section className="nt-paper mb-6 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="nt-h2">🔭 Взгляд со стороны</h2>
          <button type="button" className={stale ? "nt-btn nt-btn-sm" : "nt-btn nt-btn-ghost nt-btn-sm"} disabled={busy || filedCount < 5} onClick={refresh}>
            {busy ? "Смотрю…" : cache ? "Обновить" : "Посмотреть"}
          </button>
        </div>
        {filedCount < 5 ? (
          <p className="nt-muted text-sm">Нужно хотя бы 5 разобранных заметок — тогда нейронка поищет повторы и противоречия.</p>
        ) : !cache ? (
          <p className="nt-muted text-sm">Нейронка пройдётся по заметкам и найдёт повторяющиеся мысли, противоречия и то, что просится в отдельную тему. Раз в неделю — в самый раз.</p>
        ) : !cache.findings.length ? (
          <p className="nt-muted text-sm">Ничего примечательного не нашлось ({formatRelative(cache.at)}).</p>
        ) : (
          <>
            <ol className="space-y-3">
              {cache.findings.map((f, i) => (
                <li key={i} className="nt-soft p-3">
                  <div className="nt-accent text-xs font-semibold uppercase tracking-wide">{f.kind}</div>
                  <div className="mt-0.5 font-semibold leading-snug">{f.title}</div>
                  <p className="mt-1 text-sm leading-relaxed">{f.text}</p>
                  {f.noteIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.noteIds.map((id) =>
                        byId.get(id) ? (
                          <Link key={id} to={`/n/${id}`} className="nt-chip !h-6 max-w-full truncate !text-xs">
                            {titleOf(byId.get(id)!)}
                          </Link>
                        ) : null,
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <p className="nt-muted mt-2 text-xs">{formatRelative(cache.at)}</p>
          </>
        )}
      </section>

      {groups.length === 0 && <p className="nt-muted text-center text-sm">Всё под контролем — ничего не залежалось ✨</p>}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="nt-h2">
              {g.icon} {g.title}
            </h2>
            <p className="nt-muted mb-2 text-sm">{g.hint}</p>
            {g.key === "inbox" ? (
              <Link to="/" className="nt-btn nt-btn-sm">
                Разобрать воронку ({g.notes!.length})
              </Link>
            ) : (
              <div className="space-y-2">
                {g.notes?.map((n) => (
                  <div key={n.id} className="space-y-1">
                    <NoteCard note={n} topic={n.topicId ? tmap.get(n.topicId) : undefined} compact />
                    {g.key === "dues" && (
                      <button type="button" className="nt-accent ml-1 text-sm" onClick={() => sendDeadline(n)}>
                        🎯 В Дедлайны Расписания
                      </button>
                    )}
                  </div>
                ))}
                {g.key === "snooze" && (
                  <button
                    type="button"
                    className="nt-btn nt-btn-ghost nt-btn-sm"
                    onClick={() => g.notes!.forEach((n) => notes.update(n.id, { snoozeUntil: null as unknown as undefined }))}
                  >
                    Понял, убрать из обзора
                  </button>
                )}
                {g.topics?.map((t) => (
                  <Link key={t.id} to={`/t/${t.id}`} className="nt-paper flex items-center gap-3 p-3">
                    <span className="text-xl">{t.emoji}</span>
                    <span className="flex-1 font-semibold">{t.name}</span>
                    <span className="nt-muted text-xs">{formatRelative(t.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </Wrap>
  );
}
