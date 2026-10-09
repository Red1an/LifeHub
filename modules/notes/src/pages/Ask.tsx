import { useEffect, useMemo, useRef, useState } from "react";
import { Link, cn, toast, useCollection, useStore } from "@lifehub/sdk";
import { MicButton, useDictation } from "../components/input.tsx";
import { Head, Wrap, usePrefs } from "../components/kit.tsx";
import { askNotes, splitRefs, type ChatTurn } from "../lib/ask.ts";
import { kindOf } from "../lib/kinds.ts";
import { titleOf } from "../lib/text.ts";
import type { Note, NoteDoc, Topic } from "../lib/types.ts";

const EXAMPLES = ["Что я хотел посмотреть на выходных?", "Какие приложения для схем я сохранял?", "Что я знаю про стартап Лёши?", "Какие идеи у меня повторяются?"];

/** Ответ с [[id]] → текст со ссылками-чипами на заметки. */
function Answer({ text, byId }: { text: string; byId: Map<string, NoteDoc> }) {
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {splitRefs(text).map((p, i) => {
        if (typeof p === "string") return <span key={i}>{p}</span>;
        const n = byId.get(p.id);
        if (!n) return null;
        return (
          <Link key={i} to={`/n/${n.id}`} className="nt-chip mx-0.5 !inline-flex !h-6 max-w-[200px] align-middle !text-xs">
            <span className="truncate">
              {kindOf(n).emoji} {titleOf(n)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function AskPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { prefs } = usePrefs();
  // Разговор переживает переход на заметку и обратно (и виден с телефона).
  const [chat, setChat] = useStore<ChatTurn[]>("chat", []);
  const [q, setQ] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const voice = useDictation(q, setQ);
  const byId = useMemo(() => new Map(notes.items.map((n) => [n.id, n])), [notes.items]);
  const filed = notes.items.filter((n) => n.status !== "inbox").length;

  // Скобки обязательны: в новых браузерах scrollIntoView возвращает Promise, а React считает результат эффекта очисткой.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, streaming]);

  const send = async (text = q) => {
    const question = text.trim();
    if (!question || streaming !== null) return;
    if (voice.listening) voice.stop();
    setQ("");
    const history = chat.slice(-8);
    setChat([...chat, { role: "user", text: question }]);
    setStreaming("");
    abort.current = new AbortController();
    try {
      const answer = await askNotes(question, history, notes.items, topics.items, prefs, setStreaming, abort.current.signal);
      setChat((c) => [...c, { role: "assistant", text: answer }]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "error");
    } finally {
      setStreaming(null);
      abort.current = null;
    }
  };

  return (
    <Wrap>
      <Head
        title="Спросить"
        sub="Задай вопрос — отвечу по твоим заметкам и покажу, откуда это"
        right={
          chat.length > 0 && (
            <button type="button" className="nt-btn nt-btn-ghost nt-btn-sm" onClick={() => setChat([])} disabled={streaming !== null}>
              Новый
            </button>
          )
        }
      />

      {!chat.length && streaming === null && (
        <div className="mb-4 space-y-2">
          {filed < 3 && <p className="nt-muted text-sm">Заметок пока мало — отвечать будет не из чего. Накидай мыслей в воронку и разбери их.</p>}
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="nt-paper block w-full p-3 text-left text-sm" onClick={() => send(e)}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {chat.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--nt-accent)] px-3.5 py-2 text-white">
              {t.text}
            </div>
          ) : (
            <div key={i} className="nt-paper p-3.5">
              <Answer text={t.text} byId={byId} />
            </div>
          ),
        )}
        {streaming !== null && (
          <div className="nt-paper p-3.5">
            {streaming ? <Answer text={streaming} byId={byId} /> : <span className="nt-muted">Ищу в заметках…</span>}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="nt-capture sticky bottom-[68px] mt-4 flex items-end gap-2 p-2 sm:bottom-3">
        {voice.supported && <MicButton listening={voice.listening} onClick={voice.toggle} />}
        <textarea
          rows={1}
          className="nt-input min-h-[44px] flex-1 resize-none px-1 py-2.5"
          placeholder={voice.listening ? "Слушаю…" : "Например: что посоветовал Лёша?"}
          value={voice.interim ? `${q} ${voice.interim}` : q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {streaming !== null ? (
          <button type="button" className="nt-btn nt-btn-ghost" onClick={() => abort.current?.abort()}>
            Стоп
          </button>
        ) : (
          <button type="button" className={cn("nt-btn")} disabled={!q.trim()} onClick={() => send()}>
            ↑
          </button>
        )}
      </div>
    </Wrap>
  );
}
