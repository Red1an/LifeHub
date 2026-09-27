import {
  forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes, type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./format.ts";
import { navigate } from "./router.tsx";

/*
 * Базовые компоненты хаба. Все цвета — через токены темы (bg-surface, text-muted,
 * border-line, bg-accent…), поэтому модули автоматически поддерживают
 * светлую/тёмную тему и акцентный цвет, выбранный пользователем.
 */

/* ───────────── страница ───────────── */

export interface PageProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Кнопки справа от заголовка. */
  actions?: ReactNode;
  /** Кнопка «назад»: true — history.back(), строка — абсолютный путь. */
  back?: boolean | string;
  /** Ширина контента. */
  width?: "narrow" | "normal" | "wide" | "full";
  children?: ReactNode;
  className?: string;
}

export function Page({ title, subtitle, actions, back, width = "normal", children, className }: PageProps) {
  const max = { narrow: "max-w-2xl", normal: "max-w-4xl", wide: "max-w-6xl", full: "max-w-none" }[width];
  return (
    <div className={cn("mx-auto w-full px-4 py-5 sm:px-8 sm:py-8", max, className)}>
      {(title || actions || back) && (
        <header className="mb-6 flex items-start gap-3">
          {back && (
            <button
              type="button"
              aria-label="Назад"
              onClick={() => (typeof back === "string" ? navigate(back) : history.back())}
              className="-ml-2 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            {title && <h1 className="text-xl font-semibold leading-8 sm:text-2xl">{title}</h1>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-8", className)}>
      {(title || actions) && (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Отступы внутри карточки. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Подсветка при наведении (для кликабельных карточек). */
  interactive?: boolean;
}

export function Card({ padding = "md", interactive, className, ...rest }: CardProps) {
  const pad = { none: "", sm: "p-3", md: "p-4", lg: "p-6" }[padding];
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface",
        pad,
        interactive && "cursor-pointer transition-colors hover:border-muted/50",
        className,
      )}
      {...rest}
    />
  );
}

/* ───────────── кнопки ───────────── */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const v = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    secondary: "border border-line bg-surface hover:bg-surface-2",
    ghost: "hover:bg-surface-2",
    danger: "bg-danger text-white hover:opacity-90",
    soft: "bg-surface-2 text-fg hover:bg-line",
  }[variant];
  const s = { sm: "h-8 px-2.5 text-sm gap-1.5 rounded-md", md: "h-9 px-3.5 text-sm gap-2 rounded-md", lg: "h-11 px-5 text-base gap-2 rounded-lg" }[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        v, s, block && "w-full", className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ───────────── формы ───────────── */

const control =
  "w-full rounded-md border border-line bg-surface px-3 text-[15px] outline-none transition-colors placeholder:text-muted/70 focus:border-fg/40 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} {...rest} />;
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: (string | { value: string; label: string })[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <select className={cn(control, "h-9 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`;

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded border transition-colors",
          checked ? "border-accent bg-accent text-accent-fg" : "border-muted/50 bg-surface",
        )}
      >
        {checked && <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-muted/35")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label && <label htmlFor={id} className="cursor-pointer">{label}</label>}
    </span>
  );
}

/* ───────────── переключатели ───────────── */

export interface TabsProps<T extends string> {
  tabs: (T | { id: T; label: ReactNode })[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: TabsProps<T>) {
  return (
    <div className={cn("no-scrollbar flex gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-0.5", className)}>
      {tabs.map((t) => {
        const tab = typeof t === "string" ? { id: t, label: t } : t;
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-[5px] px-3 py-1 text-sm transition-colors",
              active ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--lh-line)]" : "text-muted hover:text-fg",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── отображение ───────────── */

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger"; children: ReactNode; className?: string }) {
  const t = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent-soft text-fg",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/15 text-danger",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-px text-xs", t, className)}>{children}</span>;
}

export function Stat({ label, value, hint, tone, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "success" | "danger" | "accent"; className?: string }) {
  const color = tone ? { success: "text-success", danger: "text-danger", accent: "text-accent" }[tone] : "";
  return (
    <Card className={className}>
      <div className="text-sm text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", color)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ icon, title, text, action, className }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-10 text-center", className)}>
      {icon && <div className="mb-2 text-3xl opacity-80">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Progress({ value, max = 100, className, tone = "accent" }: { value: number; max?: number; className?: string; tone?: "accent" | "success" | "danger" | "warning" }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const bg = { accent: "bg-accent", success: "bg-success", danger: "bg-danger", warning: "bg-warning" }[tone];
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-2", className)}>
      <div className={cn("h-full rounded-full transition-all", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5 animate-spin", className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ text = "Загрузка…" }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Spinner /> {text}
    </div>
  );
}

export interface ListItemProps {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Строка списка. Оборачивайте несколько в <List>. */
export function ListItem({ title, subtitle, left, right, onClick, className }: ListItemProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left", onClick && "transition-colors hover:bg-surface-2", className)}
    >
      {left && <div className="shrink-0">{left}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </Comp>
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

/* ───────────── модальное окно ───────────── */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

/** На телефоне — выезжающая снизу панель, на компьютере — окно по центру. */
export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  const w = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-3xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="lh-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn(
          "lh-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-xl sm:rounded-lg",
          w,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" />
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <IconButton label="Закрыть" onClick={onClose} className="-mr-2">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </IconButton>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
