import { Link, Spinner, cn, useSearchParams } from "@lifehub/sdk";

/** Вкладка страницы в адресе (?tab=…): переживает перезагрузку и работает кнопка «назад». */
export function useTab<T extends string>(def: T, allowed: readonly T[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as T | null;
  const tab = raw && allowed.includes(raw) ? raw : def;
  return [tab, (t: T) => setParams({ tab: t === def ? null : t })];
}
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { pct, signedRub, signedShortRub, tone } from "../lib/fmt.ts";
import { refreshMarket, syncAll, useRun } from "../lib/sync.ts";
import { useInvest } from "../lib/store.tsx";
import { BROKER_TITLE, type Broker } from "../lib/types.ts";

export function Btn({ main, ghost, small, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { main?: boolean; ghost?: boolean; small?: boolean; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cn("inv-btn", main && "inv-btn-main", ghost && "inv-btn-ghost", small && "inv-btn-sm", className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** Карточка: заголовок, «?» с пояснением простыми словами, действия справа. */
export function Panel({ title, info, right, className, children, pad = true }: { title?: ReactNode; info?: ReactNode; right?: ReactNode; className?: string; children?: ReactNode; pad?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cn("inv-panel", pad && "p-4 sm:p-5", className)}>
      {(title || right) && (
        <div className={cn("mb-3 flex min-h-8 flex-wrap items-center gap-2", !pad && "px-4 pt-4 sm:px-5 sm:pt-5")}>
          {title && <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>}
          {info && (
            <button onClick={() => setOpen(!open)} aria-label="Что это значит" className={cn("grid size-6 place-items-center rounded-full text-xs font-bold", open ? "bg-[var(--inv-green)] text-[#04241a]" : "bg-[var(--inv-panel-3)] text-[var(--inv-muted)]")}>
              ?
            </button>
          )}
          <div className="ml-auto flex max-w-full items-center gap-2">{right}</div>
        </div>
      )}
      {open && info && <div className={cn("inv-soft inv-fade-in mb-3 p-3 text-[13.5px] leading-relaxed text-[var(--inv-muted)]", !pad && "mx-4 sm:mx-5")}>{info}</div>}
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: [T, ReactNode][]; className?: string }) {
  return (
    <div className={cn("inv-seg", className)}>
      {options.map(([v, label]) => (
        <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ value, pctValue, short, className }: { value: number; pctValue?: number | null; short?: boolean; className?: string }) {
  const t = tone(value);
  return (
    <span className={cn("inv-num font-bold", t === "up" ? "inv-up" : t === "down" ? "inv-down" : "inv-muted", className)}>
      {short ? signedShortRub(value) : signedRub(value)}
      {pctValue != null && <span className="ml-1 font-semibold opacity-80">({pct(pctValue, { signed: true })})</span>}
    </span>
  );
}

export function PctTone({ value, digits = 1, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  const t = value == null ? "flat" : tone(value, 0.0005);
  return <span className={cn("inv-num font-bold", t === "up" ? "inv-up" : t === "down" ? "inv-down" : "inv-muted", className)}>{pct(value, { signed: true, digits })}</span>;
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="inv-muted text-[12.5px] font-semibold">{label}</div>
      <div className="inv-num mt-0.5 truncate text-lg font-extrabold tracking-tight">{value}</div>
      {hint && <div className="inv-muted mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

export function Bar({ value, max = 1, color = "var(--inv-green)", className }: { value: number; max?: number; color?: string; className?: string }) {
  return (
    <div className={cn("inv-bar", className)}>
      <div style={{ width: `${Math.max(0, Math.min(100, (value / (max || 1)) * 100))}%`, background: color }} />
    </div>
  );
}

const AVATAR_COLORS = ["#1f6f5c", "#2b4c7e", "#6b4c9a", "#7a5a1e", "#7d3434", "#245b7a", "#4f6b2a", "#6b2f5a"];
export function Avatar({ ticker, type }: { ticker: string; type?: string }) {
  const h = [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0);
  const ofz = /^SU\d{5}/.test(ticker);
  const label = ofz ? ticker.slice(2, 7) : type === "bond" ? "ОБЛ" : ticker.slice(0, 5);
  return (
    <span className="inv-avatar" style={{ background: type === "bond" || ofz ? "#26354a" : AVATAR_COLORS[h % AVATAR_COLORS.length] }}>
      {label}
    </span>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <div className="text-base font-extrabold">{title}</div>
      {text && <div className="inv-muted mt-1 max-w-sm text-sm leading-relaxed">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Details({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn("inv-details", className)}>
      <summary className="flex min-h-10 items-center gap-2 text-sm font-bold">
        <span className="inv-chev inv-muted">›</span>
        {summary}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

/** Шапка страницы: заголовок, вопрос, на который отвечает раздел, обновление и настройки. */
export function Header({ title, question, children }: { title: string; question?: string; children?: ReactNode }) {
  const run = useRun();
  const { portfolio, settings, setSettings } = useInvest();
  const scopes: [string, string][] = [["all", "Все счета"]];
  if (portfolio.accounts.some((a) => a.kind === "iis")) scopes.push(["iis", "Только ИИС"]);
  const brokers = [...new Set(portfolio.accounts.map((a) => a.broker))];
  if (brokers.length > 1) for (const b of brokers) scopes.push([`broker:${b}`, BROKER_TITLE[b as Broker]]);
  if (portfolio.accounts.length > 1) for (const a of portfolio.accounts) scopes.push([`account:${a.id}`, a.name]);
  const hasTokens = !!(settings.tbankToken || settings.bcsRefreshToken);
  return (
    <header className="mb-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="inv-title text-[26px] leading-tight sm:text-3xl">{title}</h1>
          {question && <p className="inv-muted mt-0.5 text-sm">{question}</p>}
        </div>
        <div className="flex flex-none items-center gap-1">
          {portfolio.accounts.length > 0 && (
            <Btn ghost className="inv-icon-btn" title="Обновить" aria-label="Обновить данные" loading={run.busy} onClick={() => (hasTokens ? syncAll() : refreshMarket())}>
              {!run.busy && "↻"}
            </Btn>
          )}
          <Link to="/settings" className="inv-btn inv-btn-ghost inv-icon-btn" aria-label="Счета и настройки">
            ⚙︎
          </Link>
        </div>
      </div>
      {run.busy && (
        <div className="inv-soft inv-fade-in mt-3 flex items-center gap-2 px-3 py-2 text-sm">
          <Spinner className="size-4" />
          <span className="truncate">{run.status}</span>
        </div>
      )}
      {(scopes.length > 1 || children) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {scopes.length > 1 && (
            <select className="inv-input !min-h-9 !w-auto !text-sm font-semibold" value={settings.scope} onChange={(e) => setSettings({ scope: e.target.value })} aria-label="Какие счета считать">
              {scopes.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
          {children}
        </div>
      )}
    </header>
  );
}

/** Обёртка страницы с отступами под телефон. */
export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">{children}</div>;
}

export function NumInput({ value, onChange, suffix, step = 1, min, className }: { value: number; onChange: (v: number) => void; suffix?: string; step?: number; min?: number; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className={cn("relative", className)}>
      <input
        className="inv-input inv-num pr-10"
        inputMode="decimal"
        value={text ?? (Number.isFinite(value) ? String(value).replace(".", ",") : "")}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/\s/g, "").replace(",", "."));
          if (Number.isFinite(n) && (min == null || n >= min)) onChange(n);
        }}
        onBlur={() => setText(null)}
      />
      {suffix && <span className="inv-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm">{suffix}</span>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] font-bold">{label}</div>
      {children}
      {hint && <div className="inv-muted mt-1 text-xs leading-relaxed">{hint}</div>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex min-h-10 items-center gap-3 text-left text-sm font-semibold">
      <span className={cn("relative h-6 w-10 flex-none rounded-full transition-colors", checked ? "bg-[var(--inv-green)]" : "bg-[var(--inv-panel-3)]")}>
        <span className={cn("absolute top-1 size-4 rounded-full bg-white transition-all", checked ? "left-5" : "left-1")} />
      </span>
      {label}
    </button>
  );
}
