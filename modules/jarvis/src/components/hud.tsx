import type { ReactNode } from "react";
import { cn, formatRelative } from "@lifehub/sdk";
import type { Status, VoiceStatus } from "../lib/types.ts";
import { copy } from "../lib/store.ts";

/** Страница модуля: свой фон на всю высоту и узкая колонка (сначала телефон). */
export function Screen({ title, subtitle, children, right }: { title: string; subtitle?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="jarvis-root min-h-full">
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-5 sm:pt-8">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="jarvis-title text-2xl font-semibold text-white">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-[#8fb3c7]">{subtitle}</p>}
          </div>
          {right}
        </header>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function Panel({ title, children, className, right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cn("jarvis-panel p-4", className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="jarvis-title text-xs font-semibold uppercase tracking-[0.18em] text-[#7cc8ec]">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Orb({ size = 56, state = "on" }: { size?: number; state?: "on" | "off" | "busy" }) {
  return <div className="jarvis-orb shrink-0" data-state={state} style={{ width: size, height: size }} aria-hidden />;
}

/** Состояние одной строкой: в сети / ждёт подключения / выключен. */
export function statusLine(s: Status | null): { tone: "ok" | "wait" | "off"; text: string } {
  // Состояние пишет хаб; нет его — хаб старой версии или ещё запускается.
  if (!s) return { tone: "wait", text: "Хаб не прислал состояние — перезапустите хаб" };
  if (!s.enabled) return { tone: "off", text: "Выключен" };
  if (!s.ngrok.enabled || !s.url) return { tone: "wait", text: "Нужен доступ из интернета (ngrok)" };
  if (!s.ngrok.running) return { tone: "wait", text: "Туннель ngrok не запущен" };
  if (!s.linked) return { tone: "wait", text: "Ждёт первого запроса от Яндекса" };
  return { tone: "ok", text: s.lastAt ? `В сети · ${formatRelative(s.lastAt)}` : "В сети" };
}

/** Голос на компьютере одной строкой. */
export function voiceLine(v: VoiceStatus | null): { tone: "ok" | "wait" | "off"; text: string; busy: boolean } {
  if (!v) return { tone: "wait", text: "Хаб не прислал состояние — перезапустите хаб", busy: false };
  if (v.process === "missing") return { tone: "off", text: "Голос не установлен", busy: false };
  if (v.process === "installing") return { tone: "wait", text: "Устанавливаю голос…", busy: true };
  if (v.process === "off") return { tone: "off", text: "Голос выключен", busy: false };
  if (v.process === "crashed" || v.state === "error") return { tone: "wait", text: v.error ? `Ошибка: ${v.error}` : "Голос упал, перезапускаю", busy: false };
  if (v.process === "starting" || v.state === "loading" || !v.state) return { tone: "wait", text: v.detail || "Запускаюсь…", busy: true };
  const text: Record<string, string> = {
    listening: v.detail || "Слушаю",
    hearing: "Слышу вас…",
    thinking: "Думаю…",
    speaking: "Говорю",
    sleeping: "Режим ожидания",
    muted: "Микрофон выключен",
  };
  return { tone: v.state === "sleeping" || v.state === "muted" ? "off" : "ok", text: text[v.state] ?? v.state, busy: ["hearing", "thinking", "speaking"].includes(v.state) };
}

export function VoicePill({ voice }: { voice: VoiceStatus | null }) {
  const l = voiceLine(voice);
  return <Pill tone={l.tone} text={l.text} />;
}

export function StatusPill({ status }: { status: Status | null }) {
  const l = statusLine(status);
  return <Pill tone={l.tone} text={l.text} />;
}

function Pill({ tone, text }: { tone: "ok" | "wait" | "off"; text: string }) {
  const l = { tone, text };
  const color = l.tone === "ok" ? "bg-[#3ee08f]" : l.tone === "wait" ? "bg-[var(--jv-amber)]" : "bg-[#5b6b77]";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--jv-line)] bg-black/30 px-3 py-1 text-xs text-[#bfe2f3]">
      <span className={cn("size-2 rounded-full", color, l.tone === "ok" && "shadow-[0_0_8px_#3ee08f]")} />
      {l.text}
    </span>
  );
}

/** Значение, которое надо перенести в Яндекс: подпись, текст и кнопка «Копировать». */
export function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs text-[#8fb3c7]">{label}</div>
      <div className="flex items-stretch gap-2">
        <div className={cn("jarvis-code min-w-0 flex-1", !mono && "font-sans text-sm")}>{value}</div>
        <button className="jarvis-chip shrink-0" onClick={() => copy(value, `${label}: скопировано`)}>
          Копировать
        </button>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
    >
      <span className="min-w-0">
        <span className="block text-[15px] text-[#e3f4fc]">{label}</span>
        {hint && <span className="block text-xs text-[#7f9fb2]">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked ? "border-[var(--jv-cyan)] bg-[var(--jv-cyan)]/30 shadow-[0_0_10px_rgba(90,209,255,0.4)]" : "border-[#2b3c48] bg-[#0d1820]",
        )}
      >
        <span className={cn("absolute top-0.5 size-[18px] rounded-full transition-all", checked ? "left-[22px] bg-[var(--jv-cyan)]" : "left-0.5 bg-[#4a5c68]")} />
      </span>
    </button>
  );
}
