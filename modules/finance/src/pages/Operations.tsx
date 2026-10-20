import { useMemo, useState } from "react";
import { Button, EmptyState, Input, Loading, ai, cn, toast, useSearchParams } from "@lifehub/sdk";
import { isGenericKey, merchantKey } from "../lib/categorize.ts";
import { dayTitle } from "../lib/dates.ts";
import { rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { earned, spent, type Rule } from "../lib/types.ts";
import { BankMark, Chip, MonthSwitcher, TxRow, useMonth } from "../components/ui.tsx";
import { newExpense, useTxSheet } from "../components/TxSheet.tsx";

export function Operations() {
  const f = useFinance();
  const sheet = useTxSheet();
  const [month, setMonth] = useMonth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const cat = params.get("cat");
  const acc = params.get("acc");
  const review = params.get("review") === "1";
  const kind = params.get("kind");
  const all = params.get("all") === "1" || !!q.trim();

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return f.txs
      .filter((t) => (all || review ? true : t.date.startsWith(month)))
      .filter((t) => !cat || t.category === cat)
      .filter((t) => !acc || t.account === acc || t.toAccount === acc)
      .filter((t) => !review || t.review)
      .filter((t) => !kind || t.kind === kind)
      .filter((t) => !s || [t.merchant, t.note, t.category, t.raw, String(t.amount)].some((x) => x?.toLowerCase().includes(s)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "") || b.createdAt - a.createdAt);
  }, [f.txs, month, q, cat, acc, review, kind, all]);

  const groups = useMemo(() => {
    const g = new Map<string, typeof list>();
    for (const t of list.slice(0, 600)) g.set(t.date, [...(g.get(t.date) ?? []), t]);
    return [...g.entries()];
  }, [list]);

  const totalOut = list.reduce((s, t) => s + spent(t), 0);
  const totalIn = list.reduce((s, t) => s + earned(t), 0);
  const set = (k: string, v: string | null) => setParams({ [k]: v });

  if (f.loading) return <Loading />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Операции</h1>
        <Button variant="primary" onClick={() => sheet.open(newExpense())}>
          + Трата
        </Button>
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: кафе, Пятёрочка, 350…" className="mb-3 h-11 rounded-2xl" />
      <div className="fin-scroll-x -mx-4 mb-3 px-4">
        <Chip on={review} onClick={() => set("review", review ? null : "1")}>
          🏷️ Без категории
        </Chip>
        {(["expense", "income", "transfer"] as const).map((k) => (
          <Chip key={k} on={kind === k} onClick={() => set("kind", kind === k ? null : k)}>
            {k === "expense" ? "Траты" : k === "income" ? "Доходы" : "Переводы"}
          </Chip>
        ))}
        {f.accounts
          .filter((a) => !a.archived)
          .map((a) => (
            <Chip key={a.id} on={acc === a.id} onClick={() => set("acc", acc === a.id ? null : a.id)}>
              <BankMark account={a} size={18} /> {a.name}
            </Chip>
          ))}
        {cat && (
          <Chip on onClick={() => set("cat", null)}>
            {f.categoryIcon(cat)} {cat} ✕
          </Chip>
        )}
      </div>
      {!review && !q.trim() && (
        <div className="mb-3 flex items-center justify-between">
          <MonthSwitcher month={month} onChange={setMonth} className="-ml-2" />
          <div className="text-right text-[13px] leading-tight">
            <div className="fin-num">−{rub(totalOut)}</div>
            {totalIn > 0 && <div className="fin-num fin-up">+{rub(totalIn)}</div>}
          </div>
        </div>
      )}
      {review && list.length > 0 && <AiCategorize ids={list.map((t) => t.id)} />}

      {groups.length === 0 ? (
        <EmptyState icon={review ? "✨" : "🔎"} title={review ? "Всё разобрано" : "Операций нет"} text={review ? "Все операции с категориями" : undefined} />
      ) : (
        <div className="fin-card px-1 py-1">
          {groups.map(([date, items]) => {
            const day = items.reduce((s, t) => s + spent(t), 0);
            return (
              <div key={date}>
                <div className="flex items-center justify-between px-3 pb-1 pt-3">
                  <span className="fin-label">{dayTitle(date)}</span>
                  {day > 0 && <span className="fin-num text-[12.5px] text-muted">−{rub(day)}</span>}
                </div>
                {items.map((t) => (
                  <TxRow key={t.id} tx={t} onClick={() => sheet.open(t)} showDate={all} />
                ))}
              </div>
            );
          })}
          {list.length > 600 && <div className="p-3 text-center text-sm text-muted">Показаны первые 600 — уточните поиск</div>}
        </div>
      )}
    </div>
  );
}

/** Разложить «без категории» нейронкой: по продавцам, с запоминанием правил. */
function AiCategorize({ ids }: { ids: string[] }) {
  const f = useFinance();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const txs = f.txs.filter((t) => ids.includes(t.id) && t.kind !== "transfer");
    // Продавец — одна строка на всех его операций; «QR-оплата» и посредники — каждая операция отдельно (там разные магазины).
    const groupKey = (t: (typeof txs)[number]) => {
      const k = merchantKey(t.merchant ?? t.raw ?? "");
      return !k || isGenericKey(k) ? `#${t.id}` : k;
    };
    const merchants = [...new Map(txs.map((t) => [groupKey(t), t])).values()].slice(0, 80);
    if (!merchants.length) return toast("Нет продавцов, по которым можно угадать", "error");
    setBusy(true);
    try {
      const cats = (k: "expense" | "income") => f.categories.filter((c) => c.kind === k).map((c) => c.name).join(", ");
      const list = merchants.map((t, i) => `${i + 1}. [${t.kind === "income" ? "доход" : "трата"}] ${t.merchant ?? ""} — ${(t.raw ?? "").slice(0, 120)}`).join("\n");
      const res = await ai.json<{ n: number; category: string; transfer?: boolean }[]>(
        `Определи категорию для каждой операции из банковской выписки (Россия). Категории трат: ${cats("expense")}. Категории доходов: ${cats("income")}.
Если это перевод между своими счетами, пополнение вклада/копилки, погашение кредитки — transfer: true.
Верни JSON-массив [{"n": номер, "category": "точное название из списка", "transfer": false}]. Если не уверен — "Другое".

${list}`,
        { model: "fast" },
      );
      const rules: Rule[] = [...f.rules];
      let n = 0;
      for (const r of res) {
        const t = merchants[r.n - 1];
        if (!t) continue;
        const kind = r.transfer ? "transfer" : t.kind;
        const ok = r.transfer || f.categories.some((c) => c.kind === t.kind && c.name === r.category);
        if (!ok) continue;
        const key = merchantKey(t.merchant ?? t.raw ?? "");
        const category = r.transfer ? "Перевод между счетами" : r.category;
        if (isGenericKey(key)) {
          await f.txCol.update(t.id, { category, kind, review: false });
          n++;
          continue;
        }
        rules.push({ match: key, category, kind });
        for (const x of txs.filter((x) => merchantKey(x.merchant ?? x.raw ?? "") === key)) {
          await f.txCol.update(x.id, { category, kind, review: false });
          n++;
        }
      }
      f.setRules(rules.filter((r, i) => rules.findIndex((x) => x.match === r.match) === i));
      toast(`Разложено: ${n}`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("fin-card mb-3 flex items-center gap-3 p-3")}>
      <span className="text-2xl">🤖</span>
      <span className="flex-1 text-[13.5px] text-muted">Нейронка разложит их по категориям и запомнит продавцов. Можно и вручную — нажмите на операцию.</span>
      <Button size="sm" loading={busy} onClick={run}>
        Разложить
      </Button>
    </div>
  );
}
