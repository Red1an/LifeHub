import { useEffect, useState } from "react";
import { cn } from "@lifehub/sdk";
import { gifUrl, photoUrls, ytEmbed } from "../lib/media.ts";
import type { Exercise } from "../lib/types.ts";
import { ANIMS, Figure } from "./Figure.tsx";

type Kind = "video" | "gif" | "figure" | "photo";
const LABEL: Record<Kind, string> = { video: "▶ Видео", gif: "Анимация", figure: "Схема", photo: "Фото" };

/** Чем можно показать упражнение — в порядке наглядности. */
export function sources(e: Exercise): Kind[] {
  const out: Kind[] = [];
  if (e.yt) out.push("video");
  if (e.gif) out.push("gif");
  if (ANIMS[e.id]) out.push("figure");
  if (e.photo) out.push("photo");
  return out;
}

/* Последний выбранный вид показа запоминаем в браузере: кому YouTube не грузится, переключится один раз. */
const PREF = "ft-visual";
const readPref = (): Kind | null => { try { return localStorage.getItem(PREF) as Kind | null; } catch { return null; } };
const writePref = (k: Kind) => { try { localStorage.setItem(PREF, k); } catch {} };

/**
 * Как выполнять — наглядно: короткий ролик YouTube, GIF-анимация из ExerciseDB, схема-человечек
 * или два кадра из free-exercise-db. Если источников несколько — переключатель сверху.
 */
export function ExVisual({ ex, paused, className }: { ex: Exercise; paused?: boolean; className?: string }) {
  const list = sources(ex);
  const [pref, setPref] = useState<Kind | null>(readPref);
  const kind = pref && list.includes(pref) ? pref : list[0];
  const pick = (k: Kind) => { setPref(k); writePref(k); };

  return (
    <div className={cn("relative overflow-hidden rounded-3xl", kind === "video" ? "bg-black" : kind === "gif" || kind === "photo" ? "bg-white" : "bg-[var(--ft-panel-2)]", className)}>
      {!kind && <div className="grid size-full place-items-center text-6xl">{ex.icon}</div>}
      {kind === "video" && (
        <iframe key={ex.yt} src={ytEmbed(ex.yt!)} title={ex.name} className="absolute inset-0 size-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      )}
      {kind === "gif" && <Gif ex={ex} />}
      {kind === "figure" && <div className="grid size-full place-items-center"><Figure id={ex.id} paused={paused} className="h-full max-h-full w-auto" /></div>}
      {kind === "photo" && <Flipbook ex={ex} paused={paused} />}
      {list.length > 1 && (
        <div className="absolute left-2 top-2 z-10 flex gap-1">
          {list.map((k) => (
            <button key={k} onClick={() => pick(k)}
              className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur", k === kind ? "bg-[var(--ft-lime)] text-[#0a0b0d]" : "bg-black/55 text-white")}>
              {LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Gif({ ex }: { ex: Exercise }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [ex.id]);
  if (failed) return <div className="grid size-full place-items-center bg-[var(--ft-panel-2)] text-6xl">{ex.icon}</div>;
  return <img key={ex.gif} src={gifUrl(ex.gif!)} alt={`Как делать: ${ex.name}`} onError={() => setFailed(true)} className="absolute inset-0 size-full object-contain" />;
}

function Flipbook({ ex, paused }: { ex: Exercise; paused?: boolean }) {
  const urls = photoUrls(ex);
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); setFrame(0); }, [ex.id]);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setFrame((f) => 1 - f), 1100);
    return () => clearInterval(t);
  }, [paused, ex.id]);
  if (failed) return <div className="grid size-full place-items-center bg-[var(--ft-panel-2)] text-6xl">{ex.icon}</div>;
  return (
    <>
      {urls.map((u, i) => (
        <img key={u} src={u} alt={i ? "Конец движения" : "Начало движения"} onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-contain transition-opacity duration-500" style={{ opacity: frame === i ? 1 : 0 }} />
      ))}
    </>
  );
}

/** Маленькая картинка для списков: кадр фото, схема или GIF, иначе эмодзи. */
export function ExThumb({ ex, className }: { ex: Exercise; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = photoUrls(ex)[0] ?? (ex.gif ? gifUrl(ex.gif) : undefined);
  if (ANIMS[ex.id] && !ex.gif) {
    return (
      <div className={cn("grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--ft-panel-2)]", className)}>
        <Figure id={ex.id} at={0.25} className="size-full p-0.5" />
      </div>
    );
  }
  if (url && !failed) {
    return (
      <div className={cn("shrink-0 overflow-hidden rounded-2xl bg-white", className)}>
        <img src={ex.photo ? url : gifUrl(ex.gif!)} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      </div>
    );
  }
  return <div className={cn("grid shrink-0 place-items-center rounded-2xl bg-[var(--ft-panel-2)] text-2xl", className)}>{ex.icon}</div>;
}
