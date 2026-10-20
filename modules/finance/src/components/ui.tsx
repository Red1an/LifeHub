import type { ReactNode } from "react";
import { IconButton, Link, Modal, cn, monthKey, useSearchParams, type ModalProps } from "@lifehub/sdk";
import { monthTitle, shiftMonth } from "../lib/dates.ts";
import { rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { BANKS, type Account, type BankId, type TxDoc } from "../lib/types.ts";
import type { Insight } from "../lib/insights.ts";
import { faviconUrl, type Place } from "../lib/places.ts";
import { useState } from "react";

export function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  return [params.get("month") ?? monthKey(), (m) => setParams({ month: m === monthKey() ? null : m })];
}

export function MonthSwitcher({ month, onChange, className }: { month: string; onChange: (m: string) => void; className?: string }) {
  const [y] = month.split("-");
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <IconButton label="Предыдущий месяц" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </IconButton>
      <div className="min-w-28 text-center font-semibold">
        {monthTitle(month, false)}
        {Number(y) !== new Date().getFullYear() && <span className="text-muted"> {y}</span>}
      </div>
      <IconButton label="Следующий месяц" onClick={() => onChange(shiftMonth(month, 1))} disabled={month >= monthKey()} className="disabled:opacity-30">
        ›
      </IconButton>
    </div>
  );
}

export function BankMark({ bank, account, size = 42 }: { bank?: BankId; account?: Account; size?: number }) {
  const b = BANKS[account?.bank ?? bank ?? "other"];
  const dark = ["tbank", "raif"].includes(account?.bank ?? bank ?? "");
  return (
    <span className="fin-bank" style={{ background: account?.color ?? b.color, color: dark ? "#1b1b1b" : "#fff", width: size, height: size, fontSize: size * 0.4 }}>
      {account?.type === "cash" ? "₽" : b.short}
    </span>
  );
}

export function Amount({ tx, className }: { tx: TxDoc; className?: string }) {
  if (tx.kind === "transfer") return <span className={cn("fin-num font-semibold text-muted", className)}>{rub(tx.amount)}</span>;
  const refund = tx.kind === "expense" && tx.amount < 0;
  const income = tx.kind === "income" || refund;
  return (
    <span className={cn("fin-num font-semibold", income && !tx.excluded && "fin-up", tx.excluded && "text-muted", className)}>
      {income ? "+" : "−"}
      {rub(Math.abs(tx.amount))}
    </span>
  );
}

export function TxRow({ tx, onClick, showDate }: { tx: TxDoc; onClick?: () => void; showDate?: boolean }) {
  const { categoryIcon, accounts, people, debts, placeOf } = useFinance();
  const place = tx.kind === "transfer" ? undefined : placeOf(tx.merchant);
  const acc = accounts.find((a) => a.id === (tx.account ?? tx.toAccount));
  const to = tx.kind === "transfer" ? accounts.find((a) => a.id === tx.toAccount) : undefined;
  const from = tx.kind === "transfer" ? accounts.find((a) => a.id === tx.account) : undefined;
  const owed = debts.filter((d) => d.tx === tx.id && d.dir === "owed");
  const owedLeft = owed.reduce((s, d) => s + d.amount - d.paid, 0);
  const title = tx.kind === "transfer" ? `${from?.name ?? "Откуда-то"} → ${to?.name ?? "куда-то"}` : (place?.what && place.title) || tx.merchant || tx.note || tx.category || "Без категории";
  const sub = [
    tx.kind === "transfer" ? "Перевод между счетами" : place?.what ? `${place.what}${place.sure ? "" : "?"}` : tx.merchant || tx.note ? tx.category || "Без категории" : null,
    showDate ? tx.date.slice(8, 10) + "." + tx.date.slice(5, 7) : tx.time,
    tx.kind !== "transfer" && acc?.name,
  ].filter(Boolean);
  return (
    <button type="button" onClick={onClick} className="fin-row">
      <span className="fin-icon relative">
        <PlaceIcon place={place} fallback={categoryIcon(tx.category, tx.kind)} />
        {acc && <span className="absolute -bottom-1 -right-1 rounded-md border-2 border-[var(--lh-surface)]"><BankMark account={acc} size={18} /></span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{title}</span>
          {tx.review && <span className="fin-dot bg-[var(--fin-amber)]" title="Проверьте категорию" />}
          {tx.photos?.length ? <span className="text-[12px]" title="Есть фото">📎</span> : null}
        </span>
        <span className="block truncate text-[13px] text-muted">
          {sub.join(" · ")}
          {owed.length > 0 && (
            <span className={owedLeft > 0.5 ? "text-[var(--fin-amber)]" : "fin-up"}>
              {" · "}
              {owedLeft > 0.5 ? `ждёт ${rub(owedLeft)} от ${owed.filter((d) => d.amount - d.paid > 0.5).map((d) => (d.person ? (people.find((p) => p.id === d.person)?.name ?? "?") : "кто-то")).join(", ")}` : "все скинули ✓"}
            </span>
          )}
          {tx.excluded && tx.kind === "income" && <span> · не доход</span>}
        </span>
      </span>
      <span className="text-right">
        <Amount tx={tx} />
        {tx.share !== undefined && tx.kind === "expense" && <span className="block text-[12px] text-muted">моя доля {rub(tx.share)}</span>}
      </span>
    </button>
  );
}

export function Card({ children, className, title, action, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("fin-card min-w-0", padded && "p-4", className)}>
      {(title || action) && (
        <div className={cn("mb-3 flex items-center justify-between gap-2", !padded && "px-4 pt-4")}>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function MoreLink({ to, children = "Все" }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="text-sm font-medium text-accent">
      {children} ›
    </Link>
  );
}

/** Модальное окно в стиле модуля (окна хаба рисуются вне корня модуля). */
export function Sheet(props: ModalProps) {
  return (
    <Modal {...props} title={props.title} footer={props.footer && <div className="fin-root flex w-full flex-wrap justify-end gap-2">{props.footer}</div>}>
      <div className="fin-root">{props.children}</div>
    </Modal>
  );
}

export function InsightCard({ i, onHide, action }: { i: Insight; onHide?: () => void; action?: ReactNode }) {
  const body = (
    <div className={cn("flex gap-3 rounded-[18px] p-3.5", `fin-tone-${i.tone}`)}>
      <span className="text-2xl leading-7">{i.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-snug">{i.title}</div>
        <div className="mt-0.5 text-[13.5px] leading-snug text-muted">{i.text}</div>
        {(i.saving ?? 0) >= 100 && <div className="mt-1.5 text-[13px] font-semibold fin-up">≈ {rub(Math.round(i.saving! / 100) * 100)} в месяц</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onHide && (
        <button
          type="button"
          aria-label="Скрыть"
          className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-black/5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onHide();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
  return i.to && !action ? (
    <Link to={i.to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Bar({ value, max, color = "var(--lh-accent)", className }: { value: number; max: number; color?: string; className?: string }) {
  return (
    <div className={cn("fin-bar", className)}>
      <div style={{ width: `${max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0}%`, background: color }} />
    </div>
  );
}

export function Chip({ on, onClick, children }: { on?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn("fin-chip", on && "on")} onClick={onClick}>
      {children}
    </button>
  );
}

export const CAT_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b"];

/** Значок места: логотип сайта, если известен, иначе эмодзи места или категории. */
export function PlaceIcon({ place, fallback }: { place?: Place; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (place?.domain && !broken) return <img src={faviconUrl(place.domain)} alt="" className="size-6 rounded-md" onError={() => setBroken(true)} />;
  return <>{place?.emoji || fallback}</>;
}
