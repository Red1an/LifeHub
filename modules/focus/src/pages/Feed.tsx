import { useEffect, useMemo, useState } from "react";
import { Page, Button, EmptyState, Tabs, Switch, Spinner, Link, formatRelative, toast, cn } from "@lifehub/sdk";
import { loadFeed } from "../lib/youtube";
import { fmtMin, minutesSince, todayStart, useChannels, useFeedCache, useSessions, useTopics, useWatched } from "../lib/store";
import type { Video } from "../lib/types";

const STALE_MS = 60 * 60_000;

/** Своя лента: только ролики с выбранных каналов, по темам. Без рекомендаций и Shorts. */
export function Feed() {
  const channels = useChannels();
  const watched = useWatched();
  const [topics] = useTopics();
  const [cache, setCache, { loading: cacheLoading }] = useFeedCache();
  const [topic, setTopic] = useState("all");
  const [hideWatched, setHideWatched] = useState(true);
  const [busy, setBusy] = useState(false);

  const channelKey = channels.items.map((c) => c.channelId).sort().join(",");
  async function refresh(silent = false) {
    if (!channels.items.length) return;
    setBusy(true);
    try {
      const { videos, failed } = await loadFeed(channels.items);
      setCache({ at: Date.now(), videos: videos.slice(0, 400), failed });
      if (!silent && failed.length) toast(`Не ответили: ${failed.join(", ")}`, "error");
    } catch (e) {
      if (!silent) toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  // Обновляем раз в час и когда поменялись каналы.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (channels.loading || cacheLoading || busy || loadedFor === channelKey) return;
    setLoadedFor(channelKey);
    const known = new Set((cache?.videos ?? []).map((v) => v.channelId));
    const missing = channels.items.some((c) => !known.has(c.channelId) && !cache?.failed.includes(c.title));
    if (!cache || Date.now() - cache.at > STALE_MS || missing) void refresh(true);
  }, [channels.loading, cacheLoading, channelKey]);

  const topicOf = useMemo(() => new Map(channels.items.map((c) => [c.channelId, c.topic])), [channels.items]);
  const seen = useMemo(() => new Set(watched.items.map((w) => w.videoId)), [watched.items]);
  const videos = (cache?.videos ?? []).filter(
    (v) => topicOf.has(v.channelId) && (topic === "all" || topicOf.get(v.channelId) === topic) && (!hideWatched || !seen.has(v.id)),
  );

  return (
    <Page
      title="Лента"
      subtitle="Только твои каналы — без рекомендаций"
      width="wide"
      actions={
        channels.items.length > 0 && (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => refresh()}>
            Обновить
          </Button>
        )
      }
    >
      <TodayLine />
      {channels.loading || cacheLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !channels.items.length ? (
        <EmptyState
          icon="📺"
          title="Каналов пока нет"
          text="Добавь каналы про обучение, научпоп, путешествия — здесь будут только их новые ролики."
          action={
            <Link to="/channels">
              <Button>Добавить каналы</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              tabs={[{ id: "all", label: "Все" }, ...topics.map((t) => ({ id: t, label: t }))]}
              value={topic}
              onChange={setTopic}
              className="max-w-full overflow-x-auto"
            />
            <Switch checked={hideWatched} onChange={setHideWatched} label="Скрыть просмотренные" />
          </div>
          {!videos.length ? (
            <EmptyState icon="✨" title={busy ? "Загружаю ролики…" : "Новых роликов нет"} text={busy ? undefined : "Можно закрыть вкладку и заняться делом."} />
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {videos.slice(0, 90).map((v) => (
                <VideoCard key={v.id} v={v} topic={topicOf.get(v.channelId) ?? ""} seen={seen.has(v.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function VideoCard({ v, topic, seen }: { v: Video; topic: string; seen: boolean }) {
  return (
    <Link to={`/v/${v.id}`} className={cn("group block", seen && "opacity-60")}>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-surface-2">
        <img src={v.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        {topic && <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] text-white">{topic}</span>}
      </div>
      <div className="mt-2 line-clamp-2 font-medium leading-snug">{v.title}</div>
      <div className="mt-0.5 text-sm text-muted">
        {v.channelTitle} · {v.published ? formatRelative(v.published) : ""}
      </div>
    </Link>
  );
}

/** Сколько сегодня ушло на сайты из фокуса — коротко, над лентой. */
function TodayLine() {
  const sessions = useSessions();
  const today = sessions.items.filter((s) => s.startedAt >= todayStart());
  if (!today.length) return null;
  const bySite = new Map<string, number>();
  for (const s of today) bySite.set(s.siteName || s.site, (bySite.get(s.siteName || s.site) ?? 0) + minutesSince([s], 0));
  const live = today.find((s) => !s.endedAt && (s.endsAt ?? 0) > Date.now());
  return (
    <Link to="/stats" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm">
      <span className="text-muted">Сегодня:</span>
      {[...bySite].map(([name, m]) => (
        <span key={name}>
          {name} <b>{fmtMin(m)}</b>
        </span>
      ))}
      {live && <span className="text-warning">· сейчас {live.siteName}: «{live.purpose}»</span>}
    </Link>
  );
}
