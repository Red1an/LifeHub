import { dayKey } from "@lifehub/sdk";
import { ALL_TOPICS, TRACKS, topicById, trackById } from "../data/curriculum.ts";
import { VIDEOS } from "../data/videos.ts";
import { nextTopicOf, type Dev } from "./store.ts";
import { contentFor, hasContent } from "./content.ts";
import type { Quest } from "./types.ts";
import { nextGoalTopic } from "./roadmap.ts";

/** Детерминированный «случай» на день, чтобы план не прыгал при перерисовке. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * План дня по принципам науки об обучении:
 * повторение по кривой забывания → новый материал → видео → активное вспоминание (тест/ошибки/смешанная) → практика.
 */
export function buildPlan(dev: Dev, date = dayKey()): Quest[] {
  const r = rng(date);
  const s = dev.settings;
  const focus = s.focus.length ? s.focus : TRACKS.map((t) => t.id);
  const dayNum = Math.floor(new Date(date).getTime() / 86400000);
  const weekend = [0, 6].includes(new Date(date).getDay());
  const quests: Quest[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  // 1. Повторение карточек
  const reviewCount = dev.due.length + dev.fresh.length;
  if (reviewCount > 0) {
    quests.push({ id: "review", kind: "review", icon: "🔁", title: "Повторение", subtitle: `${reviewCount} карточек · держим знания в голове`, xp: Math.min(60, reviewCount * 2), to: "/review" });
  }

  // 2. Новый урок — треки фокуса по кругу
  let lessonTopic: string | undefined = dev.roadmap ? nextGoalTopic(dev.roadmap)?.id : undefined;
  for (let k = 0; k < focus.length && !lessonTopic; k++) {
    const tr = focus[(dayNum + k) % focus.length];
    const t = nextTopicOf(tr, dev.topicMap, s.level);
    if (t && dev.state(t.id)?.status !== "done") lessonTopic = t.id;
  }
  if (lessonTopic) {
    const t = topicById(lessonTopic)!;
    const tr = trackById(t.trackId)!;
    quests.push({
      id: "lesson", kind: "lesson", icon: tr.icon, title: t.title,
      subtitle: `${dev.roadmap ? "по плану цели · " : ""}${tr.title} · ${hasContent(t.id) ? "интерактивный урок" : "урок от нейронки"}`,
      xp: 60, to: `/topic/${t.id}/lesson`, topicId: t.id,
    });
    // 3. Видео к уроку
    const v = VIDEOS[t.id];
    if (v && v.ru.length + v.en.length > 0) {
      quests.push({ id: "video", kind: "video", icon: "🎬", title: "Видео к уроку", subtitle: `${t.title} · выбери ролик на русском или английском`, xp: 10, to: `/topic/${t.id}?tab=video`, topicId: t.id });
    }
  }

  const started = ALL_TOPICS.filter((t) => dev.state(t.id) && t.id !== lessonTopic);
  const withQuiz = started.filter((t) => contentFor(t.id)?.quiz.length);

  // 4. Активное вспоминание: ошибки → смешанная тренировка → тест по теме
  if (dev.openMistakes.length >= 3) {
    quests.push({ id: "mistakes", kind: "mistakes", icon: "🩹", title: "Работа над ошибками", subtitle: `${dev.openMistakes.length} вопросов, где ты ошибся`, xp: 20, to: "/mistakes" });
  } else if (withQuiz.length >= 3 && dayNum % 2 === 0) {
    quests.push({ id: "mixed", kind: "mixed", icon: "🔀", title: "Смешанная тренировка", subtitle: "10 вопросов из разных тем вперемешку", xp: 30, to: "/mixed" });
  } else if (withQuiz.length) {
    const t = pick(withQuiz);
    quests.push({ id: "test", kind: "test", icon: "✅", title: `Тест: ${t.title}`, subtitle: "Проверь, что помнишь", xp: 25, to: `/quiz/${t.id}`, topicId: t.id });
  }

  // 5. Практика или «найди баг» по начатым темам
  const pool = started.length ? started : lessonTopic ? [topicById(lessonTopic)!] : [];
  if (pool.length) {
    const t = pick(pool);
    if (dayNum % 2 === 0 && started.length) {
      quests.push({ id: "practice", kind: "practice", icon: "🛠️", title: `Практика: ${t.title}`, subtitle: "Задача из реальной работы", xp: 50, to: `/practice/${t.id}`, topicId: t.id });
    } else {
      quests.push({ id: "bug", kind: "bug", icon: "🐞", title: "Найди баг", subtitle: `${t.title} · код из «продакшена»`, xp: 20, to: `/bug/${t.id}`, topicId: t.id });
    }
  }

  // 6. Вопрос с собеседования — через день
  if (started.length && dayNum % 3 === 1) {
    const t = pick(started);
    quests.push({ id: "question", kind: "question", icon: "🎤", title: "Вопрос с собеседования", subtitle: `${t.title} · ответь своими словами`, xp: 25, to: `/question/${t.id}`, topicId: t.id });
  }

  // 7. Выходные — босс трека, если есть что сдавать
  if (weekend) {
    const ready = TRACKS.find((tr) => tr.topics.filter((t) => dev.state(t.id)?.status === "done").length >= 3);
    if (ready) quests.push({ id: "boss", kind: "boss", icon: "👹", title: `Босс: ${ready.title}`, subtitle: "Экзамен по пройденным темам", xp: 100, to: `/boss/${ready.id}` });
  }

  return quests.slice(0, 6);
}
