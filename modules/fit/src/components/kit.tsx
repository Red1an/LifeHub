import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, Link, Spinner } from "@lifehub/sdk";

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex-1">
      <div className={cn("mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-6 sm:pt-8", className)}>{children}</div>
    </div>
  );
}

export function Header({ title, subtitle, back, right }: { title: ReactNode; subtitle?: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      {back && (
        <Link to={back} back className="ft-btn ft-btn-ghost !min-h-10 !px-3" aria-label="Назад">←</Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="ft-display text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-[var(--ft-muted)]">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "lime" | "ghost" | "dark" | "orange" | "red"; loading?: boolean; block?: boolean };

export function Btn({ tone = "lime", loading, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={cn("ft-btn", `ft-btn-${tone}`, block && "w-full", className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ft-panel p-4 sm:p-5", className)}>{children}</div>;
}

export function Bar({ value, color = "var(--ft-lime)", className, height = 8 }: { value: number; color?: string; className?: string; height?: number }) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-[#23262d]", className)} style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, color = "var(--ft-lime)", track = "#23262d", children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: "stroke-dashoffset 0.6s" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Pill({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", className)}
      style={{ background: color ? `${color}22` : "#1f2228", color: color ?? "var(--ft-muted)" }}>
      {children}
    </span>
  );
}

export function Chip({ on, onClick, children, className }: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" data-on={!!on} onClick={onClick} className={cn("ft-chip", className)}>{children}</button>
  );
}

export function Tile({ to, onClick, icon, title, text, color }: { to?: string; onClick?: () => void; icon: string; title: string; text: string; color: string }) {
  const cls = "ft-panel group relative block w-full overflow-hidden p-4 text-left transition hover:-translate-y-0.5";
  const body = (
    <>
      <div className="absolute -right-6 -top-6 size-24 rounded-full opacity-25 blur-2xl transition group-hover:opacity-45" style={{ background: color }} />
      <div className="text-3xl">{icon}</div>
      <div className="mt-2 font-extrabold">{title}</div>
      <div className="mt-0.5 text-sm leading-snug text-[var(--ft-muted)]">{text}</div>
    </>
  );
  return to ? <Link to={to} className={cls}>{body}</Link> : <button className={cls} onClick={onClick}>{body}</button>;
}

export function Stepper({ value, onChange, step = 1, min = 0, suffix, className }: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string; className?: string }) {
  const fix = (v: number) => Math.max(min, Math.round(v * 100) / 100);
  return (
    <div className={cn("ft-stepper", className)}>
      <button type="button" onClick={() => onChange(fix(value - step))} aria-label="Меньше">−</button>
      <div className="text-center">
        <span className="ft-num text-2xl font-bold">{value}</span>
        {suffix && <span className="ml-1 text-sm text-[var(--ft-muted)]">{suffix}</span>}
      </div>
      <button type="button" onClick={() => onChange(fix(value + step))} aria-label="Больше">+</button>
    </div>
  );
}

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-7", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="ft-display text-base font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function celebrate(big = true) {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2.5;
  const colors = ["#c8f031", "#ff7a2f", "#38d6f5", "#ff4d8d", "#fbbf24"];
  for (let i = 0; i < (big ? 70 : 30); i++) {
    const c = document.createElement("div");
    c.className = "ft-confetti";
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.style.background = colors[i % colors.length];
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 700}px`);
    c.style.setProperty("--dy", `${(Math.random() - 0.6) * 650}px`);
    c.style.setProperty("--rot", `${Math.random() * 720}deg`);
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }
}

export function AiError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Panel className="border-[var(--ft-red)]/40">
      <div className="font-bold text-[var(--ft-red)]">Нейронка не ответила</div>
      <div className="mt-1 text-sm text-[var(--ft-muted)]">{error}</div>
      <div className="mt-1 text-xs text-[var(--ft-muted)]">Проверьте в хабе: Настройки → Нейронка для модулей.</div>
      {onRetry && <Btn tone="ghost" className="mt-3" onClick={onRetry}>Попробовать ещё раз</Btn>}
    </Panel>
  );
}
