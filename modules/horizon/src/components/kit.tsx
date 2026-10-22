import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ai, cn, db, Modal, plural, toast } from "@lifehub/sdk";
import { cardContext, DEEPER_STARTERS, DEEPER_SYSTEM } from "../lib/gen";
import type { CardDoc, ChatMsg, Kind } from "../lib/types";
import { KIND_INFO } from "../lib/types";

/** Корень страницы модуля: фон «ночное небо» и колонка для чтения. */
export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="horizon-root">
      <div className={cn("mx-auto px-4 pb-16 pt-5 sm:px-6 sm:pt-8", wide ? "max-w-4xl" : "max-w-2xl")}>{children}</div>
    </div>
  );
}

export function PageHead({ kicker, title, sub, right }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker && <div className="horizon-kicker mb-1.5 text-[#9aa3b8]">{kicker}</div>}
        <h1 className="horizon-serif text-[28px] font-semibold leading-tight first-letter:uppercase sm:text-[34px]">{title}</h1>
        {sub && <div className="mt-1.5 text-sm text-[#9aa3b8]">{sub}</div>}
      </div>
      {right}
    </header>
  );
}

/** **жирный** и *курсив* внутри строки. */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Текст нейронки: абзацы через пустую строку, переносы строк, жирный. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const paras = String(text ?? "").trim().split(/\n\s*\n/);
  return (
    <div className={cn("horizon-prose", className)}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split("\n").map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «131 год назад». */
export function yearsAgo(year: number) {
  const n = new Date().getFullYear() - year;
  return `${n} ${plural(n, ["год", "года", "лет"])} назад`;
}

export function Kicker({ kind, extra }: { kind: Kind; extra?: ReactNode }) {
  const k = KIND_INFO[kind];
  return (
    <div className="horizon-kicker flex items-center gap-2" style={{ color: k.color }}>
      <span className="text-[15px]">{k.icon}</span>
      {k.label}
      {extra && <span className="font-medium normal-case tracking-normal text-[#9aa3b8]">· {extra}</span>}
    </div>
  );
}

export function SubHead({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="horizon-kicker mb-1.5 mt-5" style={{ color: color ?? "#9aa3b8" }}>
      {children}
    </div>
  );
}

export function ExtLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-sm text-[#9aa3b8] underline decoration-white/20 underline-offset-4 hover:text-white">
      {children} ↗
    </a>
  );
}

/* ───────────── чтение вслух ───────────── */

let speakingOwner: string | null = null;

/** Озвучка голосом браузера (русский голос Windows/Android). */
export function useSpeak(owner: string) {
  const [on, setOn] = useState(false);
  useEffect(() => () => {
    if (speakingOwner === owner) speechSynthesis.cancel();
  }, [owner]);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  function toggle(text: string, rate = 0.95) {
    if (!supported) return toast("Браузер не умеет читать вслух", "error");
    if (on) {
      speechSynthesis.cancel();
      setOn(false);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ""));
    u.lang = "ru-RU";
    u.rate = rate;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ru"));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => setOn(false);
    speakingOwner = owner;
    speechSynthesis.speak(u);
    setOn(true);
  }
  return { on, toggle, supported };
}

/* ───────────── копнуть глубже ───────────── */

/** Разговор с нейронкой про карточку: история сохраняется в самой карточке. */
export function Deeper({ card, open, onClose }: { card: CardDoc & { id: string }; open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(card.chat ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMsgs(card.chat ?? []);
  }, [card.id]);
  useEffect(() => {
    box.current?.scrollTo({ top: 1e6, behavior: "smooth" });
  }, [msgs.length, streaming]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming !== null || !card.data) return;
    const next: ChatMsg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setStreaming("");
    try {
      const head: ChatMsg[] = [
        { role: "user", content: `Карточка из альманаха:\n${cardContext(card.kind, card.data)}` },
        { role: "assistant", content: "Понял, спрашивай." },
      ];
      const reply = await ai.chat([...head, ...next], { system: DEEPER_SYSTEM, onDelta: (_d, full) => setStreaming(full) });
      const done: ChatMsg[] = [...next, { role: "assistant", content: reply }];
      setMsgs(done);
      await db.collection<CardDoc>("cards").update(card.id, { chat: done.slice(-30) });
    } catch (e) {
      toast((e as Error).message, "error");
      setMsgs(msgs);
    } finally {
      setStreaming(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${KIND_INFO[card.kind].icon} Копнуть глубже`} size="lg">
      <div ref={box} className="-mx-1 max-h-[55vh] space-y-3 overflow-y-auto px-1">
        {!msgs.length && streaming === null && <p className="text-sm text-muted">Спроси что угодно про эту карточку — или начни с готового вопроса.</p>}
        {msgs.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {streaming !== null && <Bubble role="assistant" text={streaming || "Думаю…"} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {DEEPER_STARTERS.filter((s) => !msgs.some((m) => m.content === s)).slice(0, 4).map((s) => (
          <button key={s} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface-2" onClick={() => send(s)} disabled={streaming !== null}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="min-h-11 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-[16px] outline-none" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Свой вопрос…" />
        <button className="min-h-11 rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50" disabled={!input.trim() || streaming !== null}>
          ➤
        </button>
      </form>
    </Modal>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  return role === "user" ? (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] text-accent-fg">{text}</div>
  ) : (
    <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5">
      <Prose text={text} className="!text-[15px] !text-fg" />
    </div>
  );
}
