import { useState } from "react";
import { Link, Loading, useNavigate, useParams, useCollection, useSearchParams, useAi, confirm, toast, prompt, cn } from "@lifehub/sdk";
import { topicById, trackById, LEVEL_NAMES, ALL_TOPICS } from "../data/curriculum.ts";
import { useDev, startTopic, topicsDb, cardsDb, award } from "../lib/store.ts";
import { generateCards } from "../lib/ai.ts";
import { builtinLesson, contentFor, SIMPLE_TITLE } from "../lib/content.ts";
import { newCard } from "../lib/srs.ts";
import { XP } from "../lib/game.ts";
import type { Chat, Lesson } from "../lib/types.ts";
import { Screen, Header, Panel, Bar, Pill, Btn, Tile } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";
import { Videos, videoCount } from "../components/Videos.tsx";

type Tab = "learn" | "theory" | "video" | "cards";

export function TopicPage() {
  const { id = "" } = useParams();
  const dev = useDev();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "learn";
  const chats = useCollection<Chat>("chats");
  const t = topicById(id);
  if (!t) return <Screen><Header title="Тема не найдена" back="/map" /></Screen>;
  if (dev.loading) return <Screen><Loading /></Screen>;
  const tr = trackById(t.trackId)!;
  const st = dev.state(id);
  const cards = dev.cards.items.filter((c) => c.topicId === id);

  // Соседние темы трека — для навигации «дальше».
  const trackTopics = ALL_TOPICS.filter((x) => x.trackId === t.trackId);
  const idx = trackTopics.findIndex((x) => x.id === id);
  const next = trackTopics[idx + 1];

  const openChat = async (mode: Chat["mode"]) => {
    const c = await chats.add({ mode, title: `${mode === "socrat" ? "Сократ" : "Наставник"}: ${t.title}`, topicId: id, messages: [], updatedAt: Date.now() });
    nav(`/chat/${c.id}`);
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "learn", label: "🎯 Учить" },
    { id: "theory", label: "📖 Теория" },
    { id: "video", label: `🎬 Видео${videoCount(id) ? ` · ${videoCount(id)}` : ""}` },
    { id: "cards", label: `🃏 Карточки · ${cards.length}` },
  ];

  return (
    <Screen>
      <Header title={t.title} subtitle={<span>{tr.icon} {tr.title} · {t.summary}</span>} back={`/track/${tr.id}`} />

      <Panel glow className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Pill color={t.level === 1 ? "#34d399" : t.level === 2 ? "#60a5fa" : "#f472b6"}>{LEVEL_NAMES[t.level]}</Pill>
          {st?.status === "done" ? <Pill color="#34d399">✓ изучено</Pill> : st ? <Pill color="#a78bfa">изучаю</Pill> : <Pill>новая тема</Pill>}
          {st?.testBest !== undefined && <Pill color="#fbbf24">тест {st.testBest}%</Pill>}
          <span className="ml-auto text-sm text-[var(--dp-muted)]">Освоение {st?.mastery ?? 0}%</span>
        </div>
        <Bar value={(st?.mastery ?? 0) / 100} color={tr.color} />
      </Panel>

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex gap-1 overflow-x-auto bg-[var(--dp-bg)]/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-1">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setParams({ tab: x.id === "learn" ? null : x.id })}
            className={cn("shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition", tab === x.id ? "bg-[var(--dp-violet)]/25 text-white" : "text-[var(--dp-muted)] hover:text-white")}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === "learn" && <LearnTab id={id} openChat={openChat} />}
      {tab === "theory" && <TheoryTab id={id} openChat={() => openChat("mentor")} />}
      {tab === "video" && <Videos topicId={id} />}
      {tab === "cards" && <CardsTab id={id} />}

      {next && (
        <Link to={`/topic/${next.id}`} className="dp-panel mt-6 flex items-center gap-3 p-3 transition hover:-translate-y-0.5">
          <div className="text-xs text-[var(--dp-muted)]">Следующая тема</div>
          <div className="flex-1 truncate text-right font-semibold">{next.title} →</div>
        </Link>
      )}
    </Screen>
  );
}

function LearnTab({ id, openChat }: { id: string; openChat: (m: Chat["mode"]) => void }) {
  const dev = useDev();
  const t = topicById(id)!;
  const st = dev.state(id);
  const content = contentFor(id);
  const builtin = builtinLesson(id);
  const bStep = st?.builtinStep ?? 0;
  const ai = st?.lesson;
  const aiStep = st?.lessonStep ?? 0;

  const toggleDone = async () => {
    if (!st) {
      await startTopic(id);
      await topicsDb.update(id, { status: "done", mastery: 80 });
    } else await topicsDb.update(id, { status: st.status === "done" ? "learning" : "done" });
  };

  return (
    <div className="space-y-4">
      {/* Путь по теме */}
      <Panel>
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Путь по теме</div>
        <ol className="space-y-2">
          {[
            builtin && {
              icon: "📘",
              title: "Интерактивный урок",
              text: bStep > 0 && bStep < builtin.length ? `продолжить с шага ${bStep + 1} из ${builtin.length}` : `${builtin.length} шагов: теория + вопросы`,
              to: `/topic/${id}/lesson`,
            },
            videoCount(id) && { icon: "🎬", title: "Посмотреть видео", text: "лучшие ролики на русском и английском", to: `/topic/${id}?tab=video` },
            content?.quiz.length && { icon: "✅", title: "Тест по теме", text: `${content.quiz.length + content.recall.length} вопросов · лучший ${st?.testBest ?? 0}%`, to: `/quiz/${id}` },
            { icon: "🛠️", title: "Практика", text: content?.task ? `«${content.task.title}» и задачи от нейронки` : "задача с ревью от нейронки", to: `/practice/${id}` },
          ]
            .filter(Boolean)
            .map((s, k) => {
              const x = s as { icon: string; title: string; text: string; to: string };
              return (
                <li key={k}>
                  <Link to={x.to} className="flex items-center gap-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 transition hover:brightness-125">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--dp-bg)] text-xl">{x.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{k + 1}. {x.title}</span>
                      <span className="block truncate text-xs text-[var(--dp-muted)]">{x.text}</span>
                    </span>
                    <span className="text-[var(--dp-muted)]">→</span>
                  </Link>
                </li>
              );
            })}
        </ol>
        {!builtin && (
          <div className="mt-3 text-sm text-[var(--dp-muted)]">Встроенного урока для этой темы пока нет — урок соберёт нейронка.</div>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile to={ai ? `/topic/${id}/lesson?src=ai` : `/topic/${id}/lesson?regen=normal`} icon="✨" title="Урок от ИИ" text={ai ? (aiStep > 0 && aiStep < ai.steps.length ? `шаг ${aiStep}/${ai.steps.length}` : "пройти снова") : "другой взгляд"} color="#8b5cf6" />
        <Tile to={`/bug/${id}`} icon="🐞" title="Найди баг" text="Код с подвохом" color="#f43f5e" />
        <Tile to={`/question/${id}`} icon="🎤" title="Вопрос" text="Как на собесе" color="#22d3ee" />
        <Tile onClick={() => openChat("socrat")} icon="🏺" title="Сократ" text="Научит вопросами" color="#f59e0b" />
      </div>
      {ai && <RegenMenu id={id} />}

      <Panel>
        <div className="mb-2 font-bold">🎯 Что нужно знать</div>
        <ul className="space-y-1.5">
          {t.points.map((p) => (
            <li key={p} className="flex gap-2 text-sm">
              <span className="text-[var(--dp-violet)]">▸</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn tone="ghost" className="!min-h-9 text-sm" onClick={() => openChat("mentor")}>💬 Спросить наставника</Btn>
          <a
            className="dp-btn dp-btn-ghost !min-h-9 text-sm"
            target="_blank"
            rel="noreferrer"
            href={
              t.trackId === "onec"
                ? `https://its.1c.ru/db/alldb#search:${encodeURIComponent(t.title)}`
                : `https://learn.microsoft.com/ru-ru/search/?terms=${encodeURIComponent(t.title)}`
            }
          >
            📚 Документация
          </a>
        </div>
      </Panel>

      <Panel>
        <div className="mb-2 font-bold">📝 Мои заметки</div>
        <textarea
          key={st?.updatedAt ?? 0}
          className="dp-input min-h-28"
          placeholder="Конспект своими словами — лучший способ запомнить (метод Фейнмана)…"
          defaultValue={st?.notes ?? ""}
          onBlur={async (e) => {
            const v = e.target.value;
            if (v === (st?.notes ?? "")) return;
            await startTopic(id, st);
            await topicsDb.update(id, { notes: v });
          }}
        />
      </Panel>

      <button className={cn("dp-btn w-full", st?.status === "done" ? "dp-btn-ghost" : "dp-btn-green")} onClick={toggleDone}>
        {st?.status === "done" ? "Вернуть в изучение" : "✓ Я это знаю — отметить изученной"}
      </button>
    </div>
  );
}

function TheoryTab({ id, openChat }: { id: string; openChat: () => void }) {
  const content = contentFor(id);
  const explain = useAi();
  const [asked, setAsked] = useState<number | null>(null);
  if (!content?.sections.length) {
    return (
      <Panel className="text-center">
        <div className="text-4xl">📖</div>
        <div className="mt-2 font-semibold">Конспекта пока нет</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">Пройди урок от нейронки или посмотри видео по теме.</div>
        <Link to={`/topic/${id}/lesson?regen=normal`} className="dp-btn dp-btn-primary mt-4">✨ Урок от нейронки</Link>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--dp-muted)]">💡 Подчёркнутые термины можно нажать — покажется определение.</div>
      {content.sections.map((s, k) => (
        <Panel key={k} className={s.title === SIMPLE_TITLE ? "border-[var(--dp-cyan)]/40 bg-[var(--dp-cyan)]/5" : undefined}>
          <h2 className="mb-2 text-lg font-extrabold">{s.title === SIMPLE_TITLE ? "💡 " : ""}{s.title}</h2>
          <Md text={s.md} className="text-[15px]" terms />
          <button
            className="mt-3 text-sm text-[var(--dp-cyan)] hover:underline"
            onClick={() => {
              setAsked(k);
              void explain.run(`Объясни проще и на другом примере, с бытовой аналогией:\n\n${s.title}\n${s.md}`, {
                system: "Ты лучший преподаватель программирования. По-русски, markdown, до 250 слов.",
                model: "fast",
              });
            }}
          >
            🧠 Объясни иначе
          </button>
          {asked === k && (explain.text || explain.loading || explain.error) && (
            <div className="dp-slide mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-4">
              {explain.error ? <div className="text-sm text-[var(--dp-red)]">{explain.error}</div> : <Md text={explain.text || "…"} />}
            </div>
          )}
        </Panel>
      ))}
      {content.deep.length > 0 && (
        <details className="dp-panel group border-[#f472b6]/40 p-4 sm:p-5">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center gap-2 text-lg font-extrabold">
              🦅 Глубже — уровень senior <span className="ml-auto text-sm font-normal text-[var(--dp-muted)] group-open:hidden">раскрыть</span>
            </div>
            <div className="mt-1 text-sm text-[var(--dp-muted)]">Внутреннее устройство, крайние случаи, производительность — то, что спрашивают на сильных собеседованиях.</div>
          </summary>
          {content.deep.map((s, k) => (
            <div key={k} className="mt-4">
              <h3 className="mb-2 text-base font-extrabold">{capitalize(s.title.replace(/^Глубже:\s*/, ""))}</h3>
              <Md text={s.md} className="text-[15px]" terms />
            </div>
          ))}
        </details>
      )}
      {content.reading.length > 0 && (
        <Panel>
          <div className="mb-2 text-lg font-extrabold">📚 Что почитать</div>
          <Md text={content.reading.map((r) => "- " + r).join("\n")} className="text-[15px]" />
        </Panel>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to={`/quiz/${id}`} className="dp-btn dp-btn-primary">✅ Проверить себя</Link>
        <Btn tone="ghost" onClick={openChat}>💬 Задать вопрос</Btn>
      </div>
    </div>
  );
}

function CardsTab({ id }: { id: string }) {
  const dev = useDev();
  const st = dev.state(id);
  const cards = dev.cards.items.filter((c) => c.topicId === id);
  const [gen, setGen] = useState(false);

  const makeCards = async () => {
    setGen(true);
    try {
      const c = contentFor(id);
      const material = c ? c.sections.map((s) => `${s.title}\n${s.md}`).join("\n\n") : (st?.lesson?.steps ?? []).map((s) => (s.kind === "explain" ? s.md : "")).join("\n");
      const list = await generateCards(id, material || topicById(id)!.points.join("\n"));
      await startTopic(id, st);
      for (const x of list) if (x.front && x.back) await cardsDb.add(newCard(id, x.front, x.back, "ai"));
      await award("cards", XP.cards, { topicId: id });
      toast(`Добавлено карточек: ${list.length}`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setGen(false);
    }
  };

  const addOwn = async () => {
    const front = await prompt("Вопрос карточки", "");
    if (!front) return;
    const back = await prompt("Ответ", "");
    if (!back) return;
    await startTopic(id, st);
    await cardsDb.add(newCard(id, front, back, "user"));
    toast("Карточка добавлена", "success");
  };

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 text-sm text-[var(--dp-muted)]">
          Карточки попадают в ежедневное повторение по кривой забывания.{!st && " Начни тему — стартовые карточки добавятся сами."}
        </div>
        {!st && <Btn className="!min-h-9 !px-3 text-sm" onClick={() => startTopic(id)}>Начать тему</Btn>}
        <Btn tone="ghost" className="!min-h-9 !px-3 text-sm" onClick={addOwn}>+ Своя</Btn>
        <Btn tone="ghost" className="!min-h-9 !px-3 text-sm" loading={gen} onClick={makeCards}>✨ ИИ</Btn>
      </div>
      <div className="space-y-1.5">
        {cards.map((c) => (
          <details key={c.id} className="rounded-xl bg-[var(--dp-panel-2)] px-3 py-2 text-sm">
            <summary className="cursor-pointer">
              {c.front} {c.reps > 0 && <span className="text-xs text-[var(--dp-muted)]">· интервал {c.interval} д</span>}
            </summary>
            <div className="mt-1 text-[var(--dp-muted)]">{c.back}</div>
            <button className="mt-1 text-xs text-[var(--dp-red)]" onClick={async () => (await confirm("Удалить карточку?", { danger: true })) && cardsDb.remove(c.id)}>
              удалить
            </button>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function RegenMenu({ id }: { id: string }) {
  const nav = useNavigate();
  const go = async (depth: Lesson["depth"]) => {
    if (!(await confirm("Нейронка напишет новый урок вместо текущего урока от ИИ.", { confirmText: "Новый урок" }))) return;
    nav(`/topic/${id}/lesson?regen=${depth}`);
  };
  return (
    <div className="flex gap-2">
      <Btn tone="ghost" className="flex-1 !min-h-9 text-sm" onClick={() => go("simple")}>✨ ИИ-урок проще</Btn>
      <Btn tone="ghost" className="flex-1 !min-h-9 text-sm" onClick={() => go("deep")}>✨ ИИ-урок глубже</Btn>
    </div>
  );
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
