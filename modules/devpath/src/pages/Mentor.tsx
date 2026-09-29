import { useEffect, useRef, useState } from "react";
import { ai, Link, Loading, useCollection, useNavigate, useParams, useSearchParams, formatRelative, confirm, cn } from "@lifehub/sdk";
import { TRACKS, topicById, trackById } from "../data/curriculum.ts";
import { useSettings, award } from "../lib/store.ts";
import { mentorSystem, parseScore } from "../lib/ai.ts";
import { XP } from "../lib/game.ts";
import { sfx } from "../lib/sfx.ts";
import type { Chat, ChatMsg } from "../lib/types.ts";
import { Screen, Header, Panel, Btn, Pill, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";
import { editorKeys } from "./Practice.tsx";

const MODES: { id: Chat["mode"]; icon: string; title: string; text: string }[] = [
  { id: "mentor", icon: "🧑‍🏫", title: "Наставник", text: "Спроси что угодно: объяснить, разобрать код, составить план" },
  { id: "interview", icon: "🧑‍💼", title: "Собеседование", text: "Интервьюер задаёт вопросы по одному и в конце ставит оценку" },
  { id: "socrat", icon: "🏺", title: "Сократ", text: "Ведёт к пониманию наводящими вопросами" },
];

export function MentorPage() {
  const chats = useCollection<Chat>("chats");
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Chat["mode"] | null>((params.get("new") as Chat["mode"]) ?? null);
  const [track, setTrack] = useState("csharp");

  if (chats.loading) return <Screen><Loading /></Screen>;
  const list = [...chats.items].sort((a, b) => b.updatedAt - a.updatedAt);

  const create = async (m: Chat["mode"]) => {
    const tr = m === "interview" ? track : undefined;
    const title = m === "interview" ? `Собеседование: ${trackById(track)?.title}` : m === "socrat" ? "Сократ" : "Наставник";
    const c = await chats.add({ mode: m, title, trackId: tr, messages: [], updatedAt: Date.now() });
    nav(`/chat/${c.id}`);
  };

  return (
    <Screen>
      <Header title="💬 Наставник" subtitle="Нейронка-ментор, интервьюер и Сократ в одном" />
      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={cn("dp-panel p-4 text-left transition hover:-translate-y-0.5", mode === m.id && "dp-glow")}
            onClick={() => (m.id === "interview" ? setMode(m.id) : create(m.id))}
          >
            <div className="text-3xl">{m.icon}</div>
            <div className="mt-2 font-bold">{m.title}</div>
            <div className="mt-0.5 text-sm text-[var(--dp-muted)]">{m.text}</div>
          </button>
        ))}
      </div>
      {mode === "interview" && (
        <Panel className="dp-slide mt-3">
          <div className="mb-2 font-semibold">По какому треку собеседование?</div>
          <div className="flex flex-wrap gap-2">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                className={cn("rounded-full border px-3 py-1.5 text-sm transition", track === t.id ? "border-[var(--dp-violet)] bg-[var(--dp-violet)]/20" : "border-[var(--dp-line)]")}
                onClick={() => setTrack(t.id)}
              >
                {t.icon} {t.title}
              </button>
            ))}
          </div>
          <Btn className="mt-4" onClick={() => create("interview")}>🎤 Начать собеседование</Btn>
        </Panel>
      )}

      {list.length > 0 && (
        <>
          <h2 className="mb-2 mt-7 font-bold">Диалоги</h2>
          <div className="space-y-2">
            {list.map((c) => (
              <div key={c.id} className="dp-panel flex items-center gap-3 p-3">
                <Link to={`/chat/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="text-2xl">{MODES.find((m) => m.id === c.mode)?.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.title}</div>
                    <div className="truncate text-xs text-[var(--dp-muted)]">
                      {c.messages.length} сообщ. · {formatRelative(c.updatedAt)}
                    </div>
                  </div>
                </Link>
                <button className="text-[var(--dp-muted)]" aria-label="Удалить" onClick={async () => (await confirm("Удалить диалог?", { danger: true })) && chats.remove(c.id)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

export function ChatPage() {
  const { id = "" } = useParams();
  const chats = useCollection<Chat>("chats");
  const [settings] = useSettings();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const kicked = useRef(false);
  const chat = chats.items.find((c) => c.id === id);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat?.messages.length, streaming]);

  const send = async (text: string, base: ChatMsg[]) => {
    if (!chat) return;
    const messages: ChatMsg[] = text ? [...base, { role: "user", content: text }] : base;
    setError(null);
    setInput("");
    if (text) await chats.update(id, { messages, updatedAt: Date.now() });
    setStreaming("");
    try {
      const start: ChatMsg[] = messages.length ? messages : [{ role: "user", content: chat.mode === "interview" ? "Здравствуйте! Я готов к собеседованию." : chat.mode === "socrat" ? "Давай начнём." : "Привет!" }];
      const reply = await ai.chat(start, {
        system: mentorSystem(settings, chat.mode, chat.topicId, chat.trackId),
        onDelta: (_d, full) => setStreaming(full),
      });
      const next: ChatMsg[] = [...messages, { role: "assistant", content: reply }];
      await chats.update(id, { messages: next, updatedAt: Date.now() });
      const score = chat.mode === "interview" ? parseScore(reply) : undefined;
      if (score !== undefined) {
        await award("interview", XP.interview, { score, trackId: chat.trackId });
        sfx.win();
        celebrate(XP.interview, score >= 70);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreaming(null);
    }
  };

  // Интервьюер и Сократ начинают сами.
  useEffect(() => {
    if (!chat || kicked.current || chat.messages.length || chat.mode === "mentor") return;
    kicked.current = true;
    void send("", []);
  }, [chat?.id]);

  if (chats.loading) return <Screen><Loading /></Screen>;
  if (!chat) return <Screen><Header title="Диалог не найден" back="/mentor" /></Screen>;
  const topic = chat.topicId ? topicById(chat.topicId) : undefined;
  const busy = streaming !== null;

  return (
    <Screen>
      <Header title={chat.title} subtitle={topic ? `Тема: ${topic.title}` : chat.trackId ? trackById(chat.trackId)?.title : undefined} back="/mentor" />
      <div className="space-y-3 pb-40">
        {chat.messages.length === 0 && !busy && chat.mode === "mentor" && (
          <Panel className="text-sm text-[var(--dp-muted)]">
            Примеры: «Объясни разницу между Task и ValueTask на примере», «Составь мне план подготовки к senior за 3 месяца»,
            «Разбери мой код: …», «Как устроен Kafka consumer group?»
          </Panel>
        )}
        {chat.messages.map((m, k) => <Bubble key={k} m={m} />)}
        {busy && <Bubble m={{ role: "assistant", content: streaming || "…" }} typing />}
        {error && <div className="text-sm text-[var(--dp-red)]">{error}</div>}
        {chat.mode === "interview" && chat.messages.length > 2 && !busy && !chat.messages.some((m) => m.role === "assistant" && parseScore(m.content) !== undefined) && (
          <button className="text-sm text-[var(--dp-muted)] underline" onClick={() => send("Давайте закончим. Подведите итог и поставьте оценку.", chat.messages)}>
            Завершить и получить оценку
          </button>
        )}
        <div ref={bottom} />
      </div>
      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 bg-gradient-to-t from-[var(--dp-bg)] via-[var(--dp-bg)] to-transparent px-4 pb-3 pt-6 sm:bottom-0">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="dp-input max-h-48 min-h-12 flex-1 resize-none"
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            placeholder={chat.mode === "interview" ? "Твой ответ…" : "Сообщение… (Ctrl+Enter — отправить)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && input.trim() && !busy) void send(input.trim(), chat.messages);
              else editorKeys(e);
            }}
          />
          <Btn className="!min-h-12" disabled={!input.trim() || busy} onClick={() => send(input.trim(), chat.messages)}>
            ➤
          </Btn>
        </div>
      </div>
    </Screen>
  );
}

function Bubble({ m, typing }: { m: ChatMsg; typing?: boolean }) {
  const score = m.role === "assistant" ? parseScore(m.content) : undefined;
  return (
    <div className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "dp-slide max-w-[92%] rounded-3xl px-4 py-3 text-[15px]",
          m.role === "user" ? "rounded-br-md bg-gradient-to-br from-[#7c3aed] to-[#6d28d9] text-white" : "dp-panel rounded-bl-md",
        )}
      >
        {m.role === "user" ? <div className="whitespace-pre-wrap">{m.content}</div> : <Md text={m.content.replace(/^\s*ОЦЕНКА:.*$/im, "")} />}
        {score !== undefined && <div className="mt-2"><Pill color="#fbbf24">Итог: {score / 10}/10</Pill></div>}
        {typing && <span className="ml-1 inline-block animate-pulse">▍</span>}
      </div>
    </div>
  );
}
