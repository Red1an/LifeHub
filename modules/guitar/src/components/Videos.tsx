import { useState } from "react";
import { cn, formatNumber, useCollection } from "@lifehub/sdk";
import { VIDEOS, type Video } from "../data/videos";
import { markPractice } from "../lib/train-stats";

interface Watched {
  at: number;
  topic?: string;
}

/** Ролик YouTube: превью, по нажатию — плеер прямо на странице. */
export function VideoCard({ video, seen, onWatched, badge }: { video: Video; seen?: boolean; onWatched?: (v: Video) => void; badge?: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="gt-panel overflow-hidden">
      {playing ? (
        <div className="aspect-video bg-black">
          <iframe
            className="size-full"
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
            title={video.t}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ) : (
        <button className="group relative block aspect-video w-full overflow-hidden bg-black" onClick={() => setPlaying(true)}>
          <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover opacity-85 transition group-hover:scale-105 group-hover:opacity-100" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-black/60 text-2xl text-white backdrop-blur transition group-hover:scale-110">▶</span>
          </span>
          {video.d && <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">{video.d}</span>}
          {badge && <span className="absolute left-2 top-2 rounded-md bg-[var(--gt-brass)] px-1.5 py-0.5 text-xs font-bold text-black">{badge}</span>}
          {seen && <span className="absolute right-2 top-2 rounded-md bg-[var(--gt-green)] px-1.5 py-0.5 text-xs font-bold text-black">✓ смотрел</span>}
        </button>
      )}
      <div className="p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-snug">{video.t}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--gt-muted)]">
          <span className="truncate">{video.c}</span>
          {video.v > 0 && (
            <>
              <span>·</span>
              <span className="whitespace-nowrap">{formatNumber(video.v)} просм.</span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {onWatched && !seen && (
            <button className="rounded-full bg-[var(--gt-panel-2)] px-3 py-1 text-xs font-semibold hover:brightness-125" onClick={() => onWatched(video)}>
              ✓ Посмотрел
            </button>
          )}
          <a className="ml-auto text-xs text-[var(--gt-muted)] hover:text-[var(--gt-fg)]" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
            на YouTube ↗
          </a>
        </div>
      </div>
    </div>
  );
}

export const videosOf = (topic: string) => VIDEOS[topic] ?? { ru: [], en: [] };

/** Подборка видеоуроков к теме (русские и английские), с отметкой просмотренных. */
export function TopicVideos({ topic, limit, compact, search }: { topic: string; limit?: number; compact?: boolean; search?: string }) {
  const v = videosOf(topic);
  const [lang, setLang] = useState<"ru" | "en">(v.ru.length ? "ru" : "en");
  const watched = useCollection<Watched>("watched");
  const seen = new Set(watched.items.map((w) => w.id));
  const list = v[lang].slice(0, limit);
  const mark = async (video: Video) => {
    await watched.put(video.id, { at: Date.now(), topic });
    markPractice(`video:${topic}`);
  };

  return (
    <div>
      {v.en.length > 0 && v.ru.length > 0 && (
        <div className="mb-3 flex gap-2">
          {(["ru", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition", lang === l ? "border-[var(--gt-brass)] bg-[var(--gt-brass)]/15 text-[var(--gt-brass)]" : "border-[var(--gt-line)] text-[var(--gt-muted)]")}
            >
              {l === "ru" ? "Русские" : "English"} · {v[l].length}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && <div className="mb-3 text-sm text-[var(--gt-muted)]">Подборки пока нет.</div>}
      <div className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
        {list.map((video) => (
          <VideoCard key={video.id} video={video} seen={seen.has(video.id)} onWatched={mark} />
        ))}
      </div>
      {search && (
        <a className="gt-btn gt-btn-ghost mt-3 !min-h-9 text-sm" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`} target="_blank" rel="noreferrer">
          🔎 Ещё на YouTube
        </a>
      )}
    </div>
  );
}
