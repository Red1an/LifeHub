import { useState } from "react";
import { useCollection, formatNumber, cn } from "@lifehub/sdk";
import { VIDEOS, type Video } from "../data/videos.ts";
import { topicById } from "../data/curriculum.ts";
import { award, startTopic, topicsDb } from "../lib/store.ts";
import type { Watched } from "../lib/types.ts";
import { Pill, celebrate } from "./kit.tsx";

const XP_VIDEO = 10;

const ytSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const videosOf = (topicId: string) => VIDEOS[topicId] ?? { ru: [], en: [] };

/** Видео темы: русские и английские, плеер открывается прямо здесь. */
export function Videos({ topicId, compact }: { topicId: string; compact?: boolean }) {
  const t = topicById(topicId);
  const v = videosOf(topicId);
  const [lang, setLang] = useState<"ru" | "en">(v.ru.length ? "ru" : "en");
  const [playing, setPlaying] = useState<string | null>(null);
  const watched = useCollection<Watched>("watched");
  const seen = new Set(watched.items.map((w) => w.id));
  const list = v[lang];

  const markWatched = async (video: Video) => {
    if (seen.has(video.id)) return;
    await watched.put(video.id, { topicId, at: Date.now() });
    if (!(await topicsDb.get(topicId))) await startTopic(topicId);
    await award("video", XP_VIDEO, { topicId });
    celebrate(XP_VIDEO);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {(["ru", "en"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cn("rounded-full border px-3 py-1 text-sm font-semibold transition", lang === l ? "border-[var(--dp-violet)] bg-[var(--dp-violet)]/20" : "border-[var(--dp-line)] text-[var(--dp-muted)]")}
          >
            {l === "ru" ? "🇷🇺 Русские" : "🇬🇧 English"} · {v[l].length}
          </button>
        ))}
      </div>
      {list.length === 0 && <div className="mb-3 text-sm text-[var(--dp-muted)]">Подборки пока нет — поищи на YouTube по ссылке ниже.</div>}
      <div className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
        {list.map((video) => (
          <div key={video.id} className="dp-panel overflow-hidden">
            {playing === video.id ? (
              <div className="aspect-video bg-black">
                <iframe
                  className="size-full"
                  src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
                  title={video.t}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            ) : (
              <button className="group relative block aspect-video w-full overflow-hidden bg-black" onClick={() => setPlaying(video.id)}>
                <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100" />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid size-14 place-items-center rounded-full bg-black/60 text-2xl text-white backdrop-blur transition group-hover:scale-110">▶</span>
                </span>
                <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">{video.d}</span>
                {seen.has(video.id) && <span className="absolute left-2 top-2 rounded-md bg-[var(--dp-green)] px-1.5 py-0.5 text-xs font-bold text-black">✓ смотрел</span>}
              </button>
            )}
            <div className="p-3">
              <div className="line-clamp-2 text-sm font-semibold leading-snug">{video.t}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--dp-muted)]">
                <span className="truncate">{video.c}</span>
                <span>·</span>
                <span className="whitespace-nowrap">{formatNumber(video.v)} просм.</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                {seen.has(video.id) ? (
                  <Pill color="#34d399">✓ просмотрено</Pill>
                ) : (
                  <button className="rounded-full bg-[var(--dp-panel-2)] px-3 py-1 text-xs font-semibold hover:brightness-125" onClick={() => markWatched(video)}>
                    Посмотрел · +{XP_VIDEO} XP
                  </button>
                )}
                <a className="ml-auto text-xs text-[var(--dp-muted)] hover:text-white" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
                  на YouTube ↗
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
      {t && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <a className="dp-btn dp-btn-ghost !min-h-9 !px-3 text-sm" href={ytSearch(`${t.title} ${lang === "ru" ? "" : "explained"}`)} target="_blank" rel="noreferrer">
            🔎 Ещё видео на YouTube
          </a>
        </div>
      )}
    </div>
  );
}

/** Сколько видео у темы. */
export const videoCount = (topicId: string) => videosOf(topicId).ru.length + videosOf(topicId).en.length;

