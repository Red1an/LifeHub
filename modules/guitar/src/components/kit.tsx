import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, Link, Spinner } from "@lifehub/sdk";

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex-1">
      <div className={cn("mx-auto w-full max-w-3xl px-4 pb-14 pt-4 sm:px-6 sm:pt-8", className)}>{children}</div>
    </div>
  );
}

export function Header({ title, subtitle, back, right }: { title: ReactNode; subtitle?: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      {back && (
        <Link to={back} className="gt-btn gt-btn-ghost !min-h-10 !px-3" aria-label="Назад">
          ←
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="gt-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-[var(--gt-muted)]">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

type Tone = "brass" | "green" | "ghost" | "dark" | "red";
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; loading?: boolean; block?: boolean };

export function Btn({ tone = "brass", loading, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={cn("gt-btn", `gt-btn-${tone}`, block && "w-full", className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function LinkBtn({ to, tone = "brass", className, children }: { to: string; tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn("gt-btn", `gt-btn-${tone}`, className)}>
      {children}
    </Link>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("gt-panel p-4 sm:p-5", className)}>{children}</div>;
}

export function Bar({ value, color = "var(--gt-brass)", className, height = 8 }: { value: number; color?: string; className?: string; height?: number }) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-[#2a2420]", className)} style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, color = "var(--gt-brass)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#2a2420" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: "stroke-dashoffset 0.6s" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Pill({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", className)}
      style={{ background: color ? `color-mix(in srgb, ${color} 16%, transparent)` : "#2a2420", color: color ?? "var(--gt-muted)" }}
    >
      {children}
    </span>
  );
}

export function Chip({ on, onClick, children, className }: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" data-on={!!on} onClick={onClick} className={cn("gt-chip", className)}>
      {children}
    </button>
  );
}

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-7", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="gt-display text-lg font-semibold uppercase tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Tile({ to, onClick, icon, title, text, color, right }: { to?: string; onClick?: () => void; icon: ReactNode; title: ReactNode; text?: ReactNode; color: string; right?: ReactNode }) {
  const cls = "gt-panel group relative block w-full overflow-hidden p-4 text-left transition hover:-translate-y-0.5";
  const body = (
    <>
      <div className="absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xl">{icon}</div>
        {right}
      </div>
      <div className="mt-2 font-bold leading-snug">{title}</div>
      {text && <div className="mt-0.5 text-sm leading-snug text-[var(--gt-muted)]">{text}</div>}
    </>
  );
  return to ? <Link to={to} className={cls}>{body}</Link> : <button className={cls} onClick={onClick}>{body}</button>;
}

/** Полоса сегментов-вкладок внутри страницы. */
export function Segments<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto rounded-2xl border border-[var(--gt-line)] bg-[var(--gt-panel)] p-1", className)}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "min-h-9 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition",
            value === it.id ? "bg-[var(--gt-panel-2)] text-[var(--gt-brass)] shadow" : "text-[var(--gt-muted)] hover:text-[var(--gt-fg)]",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Текст с **жирным** и переносами строк — для коротких уроков. */
export function Rich({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-2 leading-relaxed", className)}>
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split("\n");
        const list = lines.every((l) => /^\s*[-•]\s/.test(l));
        const inline = (s: string) =>
          s.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") ? <b key={j} className="text-[var(--gt-fg)]">{part.slice(2, -2)}</b> : part));
        return list ? (
          <ul key={i} className="ml-1 space-y-1">
            {lines.map((l, j) => (
              <li key={j} className="flex gap-2"><span className="text-[var(--gt-brass)]">•</span><span>{inline(l.replace(/^\s*[-•]\s/, ""))}</span></li>
            ))}
          </ul>
        ) : (
          <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>
        );
      })}
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="gt-panel flex flex-col items-center gap-2 p-8 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="font-bold">{title}</div>
      {text && <div className="max-w-sm text-sm text-[var(--gt-muted)]">{text}</div>}
      {children}
    </div>
  );
}

export function celebrate(big = true) {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2.5;
  const colors = ["#ffb547", "#ff8a4c", "#34d399", "#5ec8ff", "#b69bff"];
  for (let i = 0; i < (big ? 60 : 24); i++) {
    const c = document.createElement("div");
    c.className = "gt-confetti";
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.style.background = colors[i % colors.length];
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 680}px`);
    c.style.setProperty("--dy", `${(Math.random() - 0.6) * 620}px`);
    c.style.setProperty("--rot", `${Math.random() * 720}deg`);
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }
}
