import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, Link, Spinner } from "@lifehub/sdk";

/** Корень каждой страницы модуля: свой фон и ширина. */
export function Screen({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="flex-1">
      <div className={cn("mx-auto w-full px-4 pb-10 pt-4 sm:px-6 sm:pt-8", wide ? "max-w-5xl" : "max-w-3xl", className)}>{children}</div>
    </div>
  );
}

export function Header({ title, subtitle, back, right }: { title: ReactNode; subtitle?: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      {back && (
        <Link to={back} className="dp-btn dp-btn-ghost !min-h-10 !px-3" aria-label="Назад">
          ←
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-[var(--dp-muted)]">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "green" | "red" | "ghost"; loading?: boolean; block?: boolean };

export function Btn({ tone = "primary", loading, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={cn("dp-btn", `dp-btn-${tone}`, block && "w-full", className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Panel({ children, className, glow }: { children: ReactNode; className?: string; glow?: boolean }) {
  return <div className={cn("dp-panel p-4 sm:p-5", glow && "dp-glow", className)}>{children}</div>;
}

export function Bar({ value, color = "var(--dp-violet)", className, height = 10 }: { value: number; color?: string; className?: string; height?: number }) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-[#1b2440]", className)} style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Ring({ value, size = 56, stroke = 6, color = "var(--dp-violet)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2945" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-bold">{children}</div>
    </div>
  );
}

export function Pill({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}
      style={{ background: color ? `${color}22` : "#1c2542", color: color ?? "var(--dp-muted)" }}
    >
      {children}
    </span>
  );
}

export function AiError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Panel className="border-[var(--dp-red)]/40">
      <div className="font-semibold text-[var(--dp-red)]">Нейронка не ответила</div>
      <div className="mt-1 text-sm text-[var(--dp-muted)]">{error}</div>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">Проверьте в хабе: Настройки → Нейронка для модулей.</div>
      {onRetry && (
        <Btn tone="ghost" className="mt-3" onClick={onRetry}>
          Попробовать ещё раз
        </Btn>
      )}
    </Panel>
  );
}

/** Экран ожидания нейронки с меняющимися фразами. */
export function Thinking({ text = "Нейронка готовит материал…", sub }: { text?: string; sub?: string }) {
  return (
    <Panel className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="dp-pulse grid size-16 place-items-center rounded-full bg-[var(--dp-panel-2)] text-3xl">🧠</div>
      <div className="font-semibold">{text}</div>
      <div className="max-w-sm text-sm text-[var(--dp-muted)]">{sub ?? "Обычно это занимает 20–60 секунд. Результат сохранится — второй раз ждать не придётся."}</div>
    </Panel>
  );
}

/** Всплывающий «+XP» и конфетти. */
export function celebrate(xp?: number, big = false) {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  if (xp) {
    const el = document.createElement("div");
    el.className = "dp-float-xp text-3xl";
    el.textContent = `+${xp} XP`;
    el.style.left = `${x - 50}px`;
    el.style.top = `${y - 40}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  if (big) {
    const colors = ["#8b5cf6", "#22d3ee", "#34d399", "#fbbf24", "#f472b6"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("div");
      c.className = "dp-confetti";
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty("--dx", `${(Math.random() - 0.5) * 700}px`);
      c.style.setProperty("--dy", `${(Math.random() - 0.7) * 600}px`);
      c.style.setProperty("--rot", `${Math.random() * 720}deg`);
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 1400);
    }
  }
}

export function Tile({ to, onClick, icon, title, text, color, badge }: { to?: string; onClick?: () => void; icon: string; title: string; text: string; color: string; badge?: ReactNode }) {
  const cls = "dp-panel group relative block w-full overflow-hidden p-4 text-left transition hover:-translate-y-0.5";
  const body = (
    <>
      <div className="absolute -right-6 -top-6 size-24 rounded-full opacity-25 blur-2xl transition group-hover:opacity-40" style={{ background: color }} />
      <div className="text-3xl">{icon}</div>
      <div className="mt-2 font-bold">{title}</div>
      <div className="mt-0.5 text-sm text-[var(--dp-muted)]">{text}</div>
      {badge && <div className="absolute right-3 top-3">{badge}</div>}
    </>
  );
  return to ? <Link to={to} className={cls}>{body}</Link> : <button className={cls} onClick={onClick}>{body}</button>;
}
