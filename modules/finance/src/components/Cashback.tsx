import { useMemo, useState } from "react";
import { Button, Field, Input, Select, monthKey, toast } from "@lifehub/sdk";
import { bestFor, cashbackReport, percentFor, type Cashback } from "../lib/cashback.ts";
import { monthTitle, shiftMonth } from "../lib/dates.ts";
import { parseAmount, rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import type { AccountDoc } from "../lib/types.ts";
import { BankMark, Card, Sheet } from "./ui.tsx";

/** Кэшбэк карты на странице счёта: базовый процент и повышенные категории этого месяца. */
export function CashbackCard({ account }: { account: AccountDoc }) {
  const [edit, setEdit] = useState(false);
  const cb = account.cashback;
  const stale = cb?.cats.length && cb.month && cb.month < monthKey();
  return (
    <Card
      className="mb-4"
      title="Кэшбэк"
      action={
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
          {cb ? "Изменить" : "Указать"}
        </Button>
      }
    >
      {!cb ? (
        <p className="text-[14px] text-muted">Укажите процент и категории кэшбэка по этой карте — модуль подскажет, какой картой где платить.</p>
      ) : (
        <div className="space-y-1.5 text-[14px]">
          {stale ? (
            <p className="rounded-xl bg-[var(--fin-amber-soft)] p-2 text-[13px]">Категории выбраны на {monthTitle(cb.month!).toLowerCase()} — выберите на {monthTitle(monthKey()).toLowerCase()}.</p>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted">На всё</span>
            <span className="fin-num font-semibold">{cb.base ?? 0}%</span>
          </div>
          {cb.cats.map((c) => (
            <div key={c.category} className="flex justify-between">
              <span>{c.category}</span>
              <span className="fin-num font-semibold fin-up">{c.percent}%</span>
            </div>
          ))}
          {cb.limit ? <div className="text-[12.5px] text-muted">Потолок — {rub(cb.limit)} в месяц</div> : null}
        </div>
      )}
      {edit && <CashbackForm account={account} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function CashbackForm({ account, onClose }: { account: AccountDoc; onClose: () => void }) {
  const f = useFinance();
  const cb: Cashback = account.cashback ?? { base: 1, cats: [] };
  const [base, setBase] = useState(String(cb.base ?? ""));
  const [limit, setLimit] = useState(cb.limit ? String(cb.limit) : "");
  const [cats, setCats] = useState(cb.cats.map((c) => ({ ...c, percent: String(c.percent) })));
  const expenseCats = f.categories.filter((c) => c.kind === "expense" && !cats.some((x) => x.category === c.name));
  const save = async () => {
    const list = cats.map((c) => ({ category: c.category, percent: parseAmount(c.percent) })).filter((c) => c.percent > 0);
    await f.accountCol.update(account.id, {
      cashback: { base: parseAmount(base) || 0, cats: list, month: monthKey(), limit: parseAmount(limit) || undefined },
    });
    toast("Кэшбэк сохранён", "success");
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Кэшбэк · ${account.name}`}
      footer={
        <>
          {account.cashback && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                await f.accountCol.update(account.id, { cashback: null as unknown as undefined });
                onClose();
              }}
            >
              Нет кэшбэка
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="На всё, %">
            <Input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="1" />
          </Field>
          <Field label="Потолок в месяц, ₽">
            <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="нет" />
          </Field>
        </div>
        <div>
          <div className="fin-label mb-2">Повышенные категории на {monthTitle(monthKey()).toLowerCase()}</div>
          <div className="space-y-2">
            {cats.map((c, i) => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {f.categoryIcon(c.category)} {c.category}
                </span>
                <Input className="w-20 text-right" inputMode="decimal" value={c.percent} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
                <span className="text-muted">%</span>
                <button type="button" className="fin-chip px-2.5" aria-label="Убрать" onClick={() => setCats(cats.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          {expenseCats.length > 0 && (
            <Select
              className="mt-2"
              value=""
              onChange={(e) => e.target.value && setCats([...cats, { category: e.target.value, percent: "5" }])}
              options={[{ value: "", label: "+ Добавить категорию" }, ...expenseCats.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` }))]}
            />
          )}
        </div>
        <p className="text-[12.5px] text-muted">
          Категории банка называются по-своему («Рестораны», «Супермаркеты») — выберите ближайшие наши. Каждый месяц модуль напомнит обновить их.
        </p>
      </div>
    </Sheet>
  );
}

/** «Какой картой платить» + недополученный кэшбэк за месяц. Ничего не показывает, пока кэшбэк не указан ни у одной карты. */
export function PayWithCard() {
  const f = useFinance();
  const month = monthKey();
  const report = useMemo(() => cashbackReport(f.txs, f.accounts, month), [f.txs, f.accounts, month]);
  // Частые категории за 3 месяца — по ним подсказка, какой картой платить.
  const top = useMemo(() => {
    const from = shiftMonth(month, -2);
    const sum = new Map<string, number>();
    for (const t of f.txs) if (t.kind === "expense" && !t.excluded && t.date.slice(0, 7) >= from) sum.set(t.category, (sum.get(t.category) ?? 0) + t.amount);
    return [...sum.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => !/Перевод|Проценты|Дом/.test(c)).slice(0, 6);
  }, [f.txs, month]);
  if (!f.accounts.some((a) => a.cashback && !a.archived)) return null;
  const rows = top.map((c) => ({ c, best: bestFor(f.accounts, c) })).filter((x) => x.best);
  const lost = report.possible - report.got;
  return (
    <Card title="Какой картой платить">
      <div className="space-y-2">
        {rows.map(({ c, best }) => (
          <div key={c} className="flex items-center gap-3 text-[14.5px]">
            <span>{f.categoryIcon(c)}</span>
            <span className="min-w-0 flex-1 truncate">{c}</span>
            <BankMark account={best!.account} size={22} />
            <span className="max-w-28 truncate text-[13px] text-muted">{best!.account.name}</span>
            <span className="fin-num w-10 text-right font-semibold fin-up">{best!.percent}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-2 text-[13.5px]">
        <span className="text-muted">Кэшбэк в этом месяце</span>
        <span className="fin-num font-semibold">{rub(report.got)}</span>
      </div>
      {lost >= 30 && (
        <div className="mt-1 text-[13px] text-[var(--fin-amber)]">
          Недополучено ≈ {rub(lost)}: {report.byCategory.filter((x) => x.possible - x.got >= 10).slice(0, 2).map((x) => `${x.category} — лучше ${x.best.name} (${x.percent}%)`).join(", ")}
        </div>
      )}
    </Card>
  );
}

export { percentFor };
