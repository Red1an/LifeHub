import { useEffect, useState } from "react";
import { ai, db, useDoc } from "@lifehub/sdk";
import type { Exercise } from "./types.ts";

/*
 * Картинки и техника из открытой базы free-exercise-db (Unlicense): у каждого упражнения два кадра —
 * начало и конец движения, — их чередование работает как анимация. Техника там на английском:
 * подгружаем её с CDN и один раз переводим нейронкой, перевод храним в коллекции `howto` (id = photo).
 */
const CDN = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/";

export const photoUrls = (e: Exercise) => (e.photo ? [`${CDN}${e.photo}/0.jpg`, `${CDN}${e.photo}/1.jpg`] : []);

/** GIF-демонстрация из открытой базы ExerciseDB. */
export const gifUrl = (id: string) => `https://static.exercisedb.dev/media/${id}.gif`;

/** Ролик YouTube без звука по кругу — голос тренера не перебивается. */
export const ytEmbed = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1`;

interface HowTo { steps: string[] }
const howtoDb = db.collection<HowTo>("howto");

const english = new Map<string, Promise<string[]>>();
function fetchEnglish(photo: string) {
  let p = english.get(photo);
  if (!p) {
    p = fetch(`${CDN}${photo}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { instructions?: string[] }) => j.instructions ?? []);
    p.catch(() => english.delete(photo));
    english.set(photo, p);
  }
  return p;
}

const translating = new Map<string, Promise<string[]>>();
/** Перевести технику упражнения и сохранить (повторные вызовы ждут тот же запрос). */
export function translateHowTo(e: Exercise): Promise<string[]> {
  const photo = e.photo!;
  let p = translating.get(photo);
  if (!p) {
    p = (async () => {
      const cached = await howtoDb.get(photo).catch(() => null);
      if (cached?.steps?.length) return cached.steps;
      const en = await fetchEnglish(photo);
      if (!en.length) return [];
      const steps = await ai.json<string[]>(
        `Переведи технику упражнения «${e.name}» на русский. Пиши коротко и понятно, как тренер, на «ты», ` +
          `в повелительном наклонении. Убери общие фразы вроде «повтори нужное число раз» и «это исходное положение». ` +
          `Верни JSON-массив строк — шаги по порядку.\n\n${en.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        { model: "fast" },
      );
      const clean = steps.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
      if (clean.length) await howtoDb.put(photo, { steps: clean });
      return clean;
    })();
    p.catch(() => translating.delete(photo));
    translating.set(photo, p);
  }
  return p;
}

/**
 * Шаги техники для любого упражнения: свои — сразу, из каталога — перевод из коллекции,
 * пока его нет — английский оригинал и перевод в фоне.
 */
export function useHowTo(e: Exercise | undefined) {
  const ext = !!e?.ext && !!e.photo;
  const { doc, loading } = useDoc<HowTo>("howto", ext ? e!.photo : undefined);
  const [en, setEn] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ru = ext ? doc?.steps : undefined;

  useEffect(() => {
    setEn(null);
    setError(null);
    if (!ext || loading || ru?.length) return;
    let alive = true;
    fetchEnglish(e!.photo!).then((s) => alive && setEn(s)).catch(() => alive && setError("Нет связи с базой упражнений"));
    setBusy(true);
    translateHowTo(e!)
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [e?.id, ext && !loading && !ru?.length]);

  if (!e) return { steps: [] as string[], english: false, busy: false, error: null };
  if (!ext) return { steps: e.steps, english: false, busy: false, error: null };
  if (ru?.length) return { steps: ru, english: false, busy: false, error: null };
  return { steps: en ?? [], english: !!en?.length, busy, error };
}

/** Текст для голоса: своя фраза, иначе первые шаги техники. */
export function sayText(e: Exercise, steps: string[]) {
  if (e.say) return e.say;
  const s = steps.slice(0, 2).join(" ");
  return s.length > 220 ? steps[0] ?? "" : s;
}
