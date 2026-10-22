import { useEffect } from "react";
import { Page, Button, useParams, formatRelative } from "@lifehub/sdk";
import { useChannels, useFeedCache, useWatched } from "../lib/store";
import { watchUrl } from "../lib/youtube";

/** Ролик из ленты прямо в хабе: встроенный плеер без рекомендаций и без экрана «Зачем пришёл?». */
export function Watch() {
  const { id = "" } = useParams();
  const [cache] = useFeedCache();
  const channels = useChannels();
  const watched = useWatched();
  const v = cache?.videos.find((x) => x.id === id);
  const topic = channels.items.find((c) => c.channelId === v?.channelId)?.topic ?? "";

  // Открыл — значит посмотрел (хотя бы начал): в ленте он станет полупрозрачным, в статистике — «из ленты».
  useEffect(() => {
    if (watched.loading || !id || watched.items.some((w) => w.videoId === id)) return;
    void watched.add({ videoId: id, title: v?.title ?? "", channelTitle: v?.channelTitle ?? "", topic, at: Date.now() });
  }, [watched.loading, id]);

  return (
    <Page title={v?.title ?? "Ролик"} back="/" width="wide">
      <div className="overflow-hidden rounded-xl bg-black">
        <iframe
          className="aspect-video w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`}
          title={v?.title ?? "YouTube"}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          {v ? `${v.channelTitle} · ${formatRelative(v.published)}` : ""}
          {topic ? ` · ${topic}` : ""}
        </div>
        <a href={watchUrl(id, v?.title)} target="_blank" rel="noreferrer">
          <Button variant="ghost" size="sm">
            Не играет? Открыть на YouTube
          </Button>
        </a>
      </div>
    </Page>
  );
}
