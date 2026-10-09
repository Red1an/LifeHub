import { useEffect, useRef, useState } from "react";
import { Link, Loading, cn, formatDate } from "@lifehub/sdk";
import { Orb, Screen, StatusPill, statusLine } from "../components/hud.tsx";
import { say, useChat, useStatus } from "../lib/store.ts";

const QUICK = ["Доброе утро", "Что дальше?", "Что у меня завтра?", "Итоги дня", "Что ты умеешь?"];

export function Chat() {
  const chat = useChat();
  const { status } = useStatus();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const items = chat.items.slice(-80);
  const waiting = items.some((m) => m.source === "hub" && m.a === undefined);
  const lastHub = [...items].reverse().find((m) => m.source === "hub" && m.a !== undefined);
  const chips = lastHub?.buttons?.length ? lastHub.buttons : items.length ? [] : QUICK;
  const line = statusLine(status);

  // К последнему сообщению: прокручивается ближайший контейнер с прокруткой, обычно — само окно.
  useEffect(() => {
    let el = end.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
    else window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [items.length, waiting]);

  const send = async (q: string) => {
    setText("");
    await say(q);
  };

  return (
    <Screen
      title="Джарвис"
      subtitle={<StatusPill status={status} />}
      right={<Orb size={52} state={waiting ? "busy" : line.tone === "off" ? "off" : "on"} />}
    >
      {line.tone !== "ok" && (
        <Link to="/setup" className="jarvis-panel flex items-center justify-between gap-3 p-4 transition-colors hover:border-[var(--jv-cyan)]">
          <div>
            <div className="jarvis-title font-semibold text-white">{line.tone === "off" ? "Подключить колонку" : "Закончить подключение"}</div>
            <div className="text-sm text-[#8fb3c7]">Пошагово, минут 5. А пока можно говорить с Джарвисом здесь.</div>
          </div>
          <span className="jarvis-glow text-xl">→</span>
        </Link>
      )}

      {chat.loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-[#8fb3c7]">
          Здесь видно, о чём вы говорили с колонкой, и можно спросить текстом — ответ тот же, что услышит колонка.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.id} className="space-y-1.5">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#123247] px-3.5 py-2 text-[15px] text-white">
                  {m.q}
                  <div className="mt-0.5 text-right text-[10px] text-[#7fb0cc]">
                    {m.source === "alice" ? "🔊 колонка" : "здесь"} · {formatDate(m.at ?? m.createdAt, "time")}
                  </div>
                </div>
              </div>
              <div className="flex justify-start">
                <div className={cn("max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-[var(--jv-line)] bg-black/30 px-3.5 py-2 text-[15px] leading-relaxed text-[#d8ecf7]")}>
                  {m.a ?? (
                    <span className="jarvis-dots inline-flex py-1">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div ref={end} />

      <div className="sticky bottom-2 z-10 space-y-2 pt-2">
        {chips.length > 0 && (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {chips.map((c) => (
              <button key={c} className="jarvis-chip shrink-0" disabled={waiting} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <form
          className="jarvis-panel flex items-center gap-2 p-1.5 pl-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Скажите Джарвису…"
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#5f7f92]"
          />
          <button
            type="submit"
            disabled={!text.trim() || waiting}
            className="jarvis-title h-10 shrink-0 rounded-xl bg-[var(--jv-cyan)] px-4 text-sm font-semibold text-[#04121c] transition-opacity disabled:opacity-40"
          >
            Отправить
          </button>
        </form>
      </div>
    </Screen>
  );
}
