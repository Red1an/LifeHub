import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, Switch, Tabs, cn, confirm, prompt, toast } from "@lifehub/sdk";
import { daysBetween, today } from "../lib/dates.ts";
import { parseAmount, round2, rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { TRANSFER_CATEGORY, type Kind, type Tx, type TxDoc } from "../lib/types.ts";
import { PlaceIcon, Sheet } from "./ui.tsx";
import { placeKey } from "../lib/places.ts";
import { TxPhotos } from "./Photos.tsx";
import { removePhotos } from "../lib/photos.ts";

type Editing = (Tx & { id?: string }) | null;
type Mode = "edit" | "split";

const Ctx = createContext<{ open: (tx: Editing, mode?: Mode) => void } | null>(null);

export const useTxSheet = () => useContext(Ctx)!;

export function TxSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ tx: Editing; mode: Mode }>({ tx: null, mode: "edit" });
  const close = () => setState({ tx: null, mode: "edit" });
  return (
    <Ctx.Provider value={{ open: (tx, mode = "edit") => setState({ tx, mode }) }}>
      {children}
      {state.tx && (state.mode === "split" && state.tx.id ? <SplitSheet key={state.tx.id} tx={state.tx as TxDoc} onClose={close} /> : <TxForm key={state.tx.id ?? "new"} tx={state.tx} onClose={close} />)}
    </Ctx.Provider>
  );
}

export const newExpense = (): Tx => ({ kind: "expense", amount: 0, category: "", date: today(), source: "manual" });

function TxForm({ tx, onClose }: { tx: Tx & { id?: string }; onClose: () => void }) {
  const f = useFinance();
  const sheet = useTxSheet();
  const [d, setD] = useState<Tx>({ ...tx });
  const [amount, setAmount] = useState(tx.amount ? String(Math.abs(tx.amount)) : "");
  const [refund, setRefund] = useState(tx.kind === "expense" && tx.amount < 0);
  const [remember, setRemember] = useState(true);
  const live = f.accounts.filter((a) => !a.archived);
  const cats = f.categories.filter((c) => c.kind === (d.kind === "income" ? "income" : "expense"));
  const saved = tx.id ? f.txs.find((x) => x.id === tx.id) : undefined;
  const debts = tx.id ? f.debts.filter((x) => x.tx === tx.id) : [];

  const save = async () => {
    const value = parseAmount(amount);
    if (!value) return toast("Введите сумму", "error");
    if (d.kind !== "transfer" && !d.category) return toast("Выберите категорию", "error");
    const data: Tx = {
      ...d,
      amount: d.kind === "expense" && refund ? -value : value,
      category: d.kind === "transfer" ? TRANSFER_CATEGORY : d.category,
      review: false,
    };
    if (d.kind !== "transfer") data.toAccount = undefined;
    if (saved) {
      // Стало переводом себе — вторая половина (зачисление/списание на другом счёте) больше не нужна.
      if (data.kind === "transfer" && saved.kind !== "transfer") {
        const other = f.txs.find(
          (x) =>
            x.id !== saved.id &&
            x.kind === (saved.kind === "expense" ? "income" : "expense") &&
            Math.abs(x.amount - value) < 0.01 &&
            Math.abs(daysBetween(x.date, data.date)) <= 1 &&
            x.account && x.account !== saved.account,
        );
        if (other && (await confirm(`Это перевод себе — убрать вторую половину: ${other.kind === "income" ? "зачисление" : "списание"} ${rub(other.amount)} на «${f.accountName(other.account)}»?`, { confirmText: "Убрать" }))) {
          if (saved.kind === "expense") data.toAccount = other.account;
          else {
            data.account = other.account;
            data.toAccount = saved.account;
          }
          await f.txCol.remove(other.id);
        }
      }
      const changedCat = saved.category !== data.category || saved.kind !== data.kind;
      const n = await f.recategorize(saved, data, remember && changedCat && !!saved.merchant);
      if (n) toast(`Категория «${data.category}» — ещё для ${n} операций ${saved.merchant}`, "success");
      if (data.share !== undefined && value !== saved.amount) toast("Сумма изменилась — проверьте, как поделили", "info");
    } else await f.txCol.add({ ...data, source: data.source ?? "manual" });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={tx.id ? "Операция" : "Новая операция"}
      footer={
        <>
          {tx.id && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (!(await confirm("Удалить операцию?", { danger: true, confirmText: "Удалить" }))) return;
                for (const x of debts) if (!x.paid) await f.debtCol.remove(x.id);
                if (saved?.photos?.length) await removePhotos(saved.photos);
                await f.txCol.remove(tx.id!);
                onClose();
              }}
            >
              Удалить
            </Button>
          )}
          {saved && saved.kind === "expense" && saved.amount > 0 && (
            <Button variant="soft" onClick={() => sheet.open(saved, "split")}>
              🤝 Разделить
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {saved && <TxSummary tx={saved} />}
        <Tabs<Kind>
          value={d.kind}
          onChange={(kind) => setD({ ...d, kind, category: kind === "transfer" ? TRANSFER_CATEGORY : f.categories.find((c) => c.kind === kind && c.name === d.category) ? d.category : "" })}
          tabs={[
            { id: "expense", label: "Трата" },
            { id: "income", label: "Доход" },
            { id: "transfer", label: "Перевод" },
          ]}
        />
        <div className="fin-soft px-3 py-3">
          <input
            className="fin-amount-input fin-num"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0 ₽"
            autoFocus={!tx.id}
          />
          {saved?.share !== undefined && <div className="text-center text-sm text-muted">ваша доля {rub(saved.share)}</div>}
        </div>

        {d.kind !== "transfer" && (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {cats.map((c) => (
              <button
                type="button"
                key={c.name}
                onClick={() => setD({ ...d, category: c.name })}
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border p-1.5 text-[11.5px] leading-tight transition",
                  d.category === c.name ? "border-accent bg-accent-soft" : "border-transparent bg-surface-2 hover:border-line",
                )}
              >
                <span className="text-xl">{c.icon}</span>
                <span className="line-clamp-2 w-full text-center">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={d.kind === "transfer" ? "Откуда" : "Счёт"}>
            <Select
              value={d.account ?? ""}
              onChange={(e) => setD({ ...d, account: e.target.value || undefined })}
              options={[{ value: "", label: d.kind === "transfer" ? "Внешний / не знаю" : "Не указан" }, ...live.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </Field>
          {d.kind === "transfer" ? (
            <Field label="Куда">
              <Select
                value={d.toAccount ?? ""}
                onChange={(e) => setD({ ...d, toAccount: e.target.value || undefined })}
                options={[{ value: "", label: "Внешний / не знаю" }, ...live.map((a) => ({ value: a.id, label: a.name }))]}
              />
            </Field>
          ) : (
            <Field label="Дата">
              <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
            </Field>
          )}
        </div>
        {d.kind === "transfer" && (
          <Field label="Дата">
            <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.kind === "income" ? "От кого" : "Где / кому"}>
            <Input value={d.merchant ?? ""} onChange={(e) => setD({ ...d, merchant: e.target.value || undefined })} placeholder="Кофемания" />
          </Field>
          <Field label="Комментарий">
            <Input value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value || undefined })} />
          </Field>
        </div>
        {d.kind === "expense" && <Switch checked={refund} onChange={setRefund} label="Это возврат покупки (уменьшает траты)" />}
        {d.kind === "income" && <Switch checked={!!d.excluded} onChange={(v) => setD({ ...d, excluded: v || undefined })} label="Не считать доходом (вернули долг, кэшбэк за покупку…)" />}
        {saved?.merchant && (saved.category !== d.category || saved.kind !== d.kind) && (
          <Switch checked={remember} onChange={setRemember} label={`Запомнить для «${saved.merchant}»`} />
        )}
      </form>
    </Sheet>
  );
}

/** Разделить трату: кто участвовал и сколько должен. Моя доля остаётся в тратах, остальное — долги. */
function SplitSheet({ tx, onClose }: { tx: TxDoc; onClose: () => void }) {
  const f = useFinance();
  const existing = f.debts.filter((d) => d.tx === tx.id && d.dir === "owed");
  type Row = { key: string; person: string; amount: string };
  const [rows, setRows] = useState<Row[]>(existing.map((d, i) => ({ key: `e${i}`, person: d.person, amount: String(d.amount) })));
  const [withMe, setWithMe] = useState(tx.share === undefined || tx.share > 0);
  const [mode, setMode] = useState<"equal" | "custom">(
    existing.length > 1 && !existing.every((d) => Math.abs(d.amount - existing[0].amount) < 1) ? "custom" : "equal",
  );
  const newKey = () => Math.random().toString(36).slice(2);
  // Позиции чека: тап добавляет цену к выбранной строке («Друг 1: 350+600»), позиция помечается, чья она.
  const items = tx.receipt?.items ?? [];
  const [active, setActive] = useState<string | null>(null);
  const [taken, setTaken] = useState<Record<number, string>>({});
  const takeItem = (i: number) => {
    const key = active ?? rows[0]?.key;
    if (!key) return toast("Сначала добавьте человека", "error");
    const price = items[i].price;
    if (taken[i]) {
      // Повторный тап — убрать позицию у того, кому её отдали.
      setRows(rows.map((r) => (r.key === taken[i] ? { ...r, amount: r.amount.split("+").filter((x, j, a) => !(parseAmount(x) === price && a.indexOf(x) === j)).join("+") } : r)));
      const next = { ...taken };
      delete next[i];
      setTaken(next);
      return;
    }
    setMode("custom");
    setRows(rows.map((r) => (r.key === key ? { ...r, amount: r.amount ? `${r.amount}+${price}` : String(price) } : r)));
    setTaken({ ...taken, [i]: key });
  };

  const n = rows.length + (withMe ? 1 : 0);
  const each = n ? round2(tx.amount / n) : 0;
  const amountOf = (r: Row) => (mode === "equal" ? each : sumExpr(r.amount));
  const others = round2(rows.reduce((s, r) => s + amountOf(r), 0));
  const mine = round2(tx.amount - others);

  const setCount = (k: number) => {
    const named = rows.filter((r) => r.person);
    const anon = Math.max(0, k - 1 - named.length);
    setRows([...named, ...Array.from({ length: anon }, () => ({ key: newKey(), person: "", amount: "" }))]);
    setWithMe(true);
  };

  const addPerson = async () => {
    const name = (await prompt("Имя (как в переводах: «Иван И.» — тогда возврат отметится и по имени)", ""))?.trim();
    if (!name) return;
    const p = await f.peopleCol.add({ name });
    setRows([...rows, { key: newKey(), person: p.id, amount: "" }]);
  };

  const save = async () => {
    if (mine < -0.5) return toast("Доли друзей больше суммы чека", "error");
    if (mode === "custom" && rows.some((r) => amountOf(r) <= 0)) return toast("Впишите сумму каждому или уберите лишних", "error");
    await f.splitTx(
      tx,
      rows.map((r) => ({ person: r.person, amount: amountOf(r) })),
      Math.max(0, mine),
    );
    toast(rows.length ? `Ждём ${rub(others)} — отметим, когда переведут` : "Раздел убран", "success");
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Разделить счёт"
      footer={
        <Button variant="primary" onClick={save}>
          Готово
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="fin-soft flex items-center justify-between p-3">
          <div>
            <div className="font-semibold">{tx.merchant ?? tx.category}</div>
            <div className="text-sm text-muted">{tx.date.split("-").reverse().join(".")}</div>
          </div>
          <div className="fin-num text-xl font-bold">{rub(tx.amount)}</div>
        </div>

        <Tabs<"equal" | "custom">
          value={mode}
          onChange={setMode}
          tabs={[
            { id: "equal", label: "Поровну" },
            { id: "custom", label: "Кто сколько" },
          ]}
        />

        <div>
          <div className="fin-label mb-2">Сколько вас было (с вами)</div>
          <div className="flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6, 8].map((k) => (
              <button key={k} type="button" className={cn("fin-chip min-w-11 justify-center", withMe && rows.length === k - 1 && "on")} onClick={() => setCount(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r, i) => {
              const p = r.person ? f.people.find((x) => x.id === r.person) : undefined;
              const label = p ? `${p.emoji ?? "🙂"} ${p.name}` : `👤 Друг ${rows.slice(0, i + 1).filter((x) => !x.person).length}`;
              return (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {mode === "equal" ? (
                    <span className="fin-num font-semibold">{rub(each)}</span>
                  ) : (
                    <Input
                      className={cn("w-32 text-right", items.length > 0 && active === r.key && "ring-2 ring-[var(--lh-accent)]")}
                      inputMode="decimal"
                      onFocus={() => setActive(r.key)}
                      value={r.amount}
                      onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))}
                      placeholder="350+600"
                    />
                  )}
                  <button type="button" aria-label="Убрать" className="fin-chip px-2.5" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && rows.length > 0 && (
          <div>
            <div className="fin-label mb-2">Позиции из чека — нажмите поле человека, затем его позиции</div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((it, i) => {
                const who = taken[i] ? rows.findIndex((r) => r.key === taken[i]) : -1;
                return (
                  <button key={i} type="button" className={cn("fin-chip text-[12.5px]", who >= 0 && "on")} onClick={() => takeItem(i)}>
                    {it.name} · {rub(it.price)}
                    {who >= 0 && <span className="text-muted"> → {who + 1}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="fin-chip" onClick={() => setRows([...rows, { key: newKey(), person: "", amount: "" }])}>
            + Друг без имени
          </button>
          {f.people
            .filter((p) => !rows.some((r) => r.person === p.id))
            .map((p) => (
              <button key={p.id} type="button" className="fin-chip" onClick={() => setRows([...rows, { key: newKey(), person: p.id, amount: "" }])}>
                + {p.emoji ?? "🙂"} {p.name}
              </button>
            ))}
          <button type="button" className="fin-chip" onClick={addPerson}>
            + Новый по имени
          </button>
        </div>

        <Switch checked={withMe} onChange={setWithMe} label="Я тоже ел(а) / участвовал(а)" />

        {rows.length > 0 && (
          <div className="fin-soft space-y-1 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Вам должны</span>
              <span className="fin-num font-semibold">{rub(others)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Ваша доля (в тратах)</span>
              <span className={cn("fin-num font-semibold", mine < -0.5 && "text-danger")}>{rub(Math.max(0, mine))}</span>
            </div>
            {mode === "custom" && !withMe && Math.abs(mine) > 0.5 && <div className="text-[12.5px] text-[var(--fin-amber)]">Суммы не сходятся с чеком на {rub(Math.abs(mine))}</div>}
          </div>
        )}

        <p className="text-[13px] text-muted">
          Когда переведут, долг закроется сам: по имени из уведомления банка, а если имени нет (выписка) — по сумме доли в течение двух недель. Ошибётся — в карточке перевода есть «Это не возврат».
        </p>
      </div>
    </Sheet>
  );
}

/** «350+600+120» → 1070: так удобно сложить, что человек заказал. */
function sumExpr(s: string): number {
  return round2(
    s
      .split("+")
      .map((x) => parseAmount(x))
      .reduce((a, b) => a + b, 0),
  );
}

const SOURCE: Record<string, string> = { push: "из уведомления", statement: "из выписки", share: "из SMS", manual: "вручную", jarvis: "через Джарвиса" };

/** Что это за операция — сразу, без раскрытия: где, когда, с какого счёта, и текст банка целиком. */
function TxSummary({ tx }: { tx: TxDoc }) {
  const f = useFinance();
  const from = f.accounts.find((a) => a.id === tx.account);
  const to = f.accounts.find((a) => a.id === tx.toAccount);
  const debts = f.debts.filter((d) => d.tx === tx.id);
  const title =
    tx.kind === "transfer"
      ? `Перевод ${from ? `с «${from.name}»` : ""}${to ? ` на «${to.name}»` : ""}`.trim()
      : tx.merchant || tx.note || tx.category || "Операция";
  const when = new Date(tx.date + "T00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const kind = tx.kind === "transfer" ? "перевод между своими счетами" : tx.kind === "income" ? (tx.excluded ? "поступление, не доход" : "доход") : tx.amount < 0 ? "возврат покупки" : "трата";
  const bankText = (tx.raw ?? "").replace(/\s+/g, " ").trim();
  return (
    <div className="fin-soft space-y-2 p-3">
      <div className="flex items-start gap-3">
        <span className="fin-icon shrink-0">{f.categoryIcon(tx.category, tx.kind)}</span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[16px] font-semibold leading-snug">{title}</div>
          <div className="text-[13px] text-muted">
            {when}
            {tx.time && `, ${tx.time}`} · {kind}
          </div>
          <div className="text-[13px] text-muted">
            {tx.kind !== "transfer" && (from ? `Счёт: ${from.name}` : tx.card ? `Карта •${tx.card}` : "Счёт не указан")}
            {tx.source && ` · ${SOURCE[tx.source] ?? tx.source}`}
          </div>
        </div>
        <span className={cn("fin-num shrink-0 text-[17px] font-bold", tx.kind === "income" && !tx.excluded && "fin-up")}>
          {tx.kind === "income" ? "+" : tx.kind === "transfer" ? "" : "−"}
          {rub(Math.abs(tx.amount))}
        </span>
      </div>
      {tx.share !== undefined && <div className="text-[13px]">Ваша доля — {rub(tx.share)}, остальное должны: {debts.map((d) => f.personName(d.person)).join(", ")}</div>}
      <RepaidFor tx={tx} />
      <PlaceInfo tx={tx} />
      <TxPhotos tx={tx} />
      {bankText && (
        <div className="rounded-xl bg-[var(--lh-surface)] px-2.5 py-2 text-[12.5px] leading-snug text-muted">
          <span className="fin-label mr-1 text-[10.5px]">Текст банка</span>
          <span className="break-words">{bankText}</span>
        </div>
      )}
    </div>
  );
}

/** Этот перевод закрыл долг: за что и кто; если отмечено по сумме — можно отменить. */
function RepaidFor({ tx }: { tx: TxDoc }) {
  const f = useFinance();
  const debts = f.debts.filter((d) => d.repaidBy?.includes(tx.id));
  if (!debts.length) return null;
  return (
    <div className="rounded-xl bg-[var(--fin-green-soft)] px-2.5 py-2 text-[13px]">
      🤝 Возврат долга: {debts.map((d) => `${d.note ?? "общий счёт"} ${d.date.slice(8)}.${d.date.slice(5, 7)}${d.person ? ` (${f.personName(d.person)})` : ""}`).join(", ")}
      {tx.repayGuess && <span className="text-muted"> — угадано по сумме.</span>}
      <button type="button" className="ml-1 font-semibold text-danger underline" onClick={() => f.undoRepayment(tx)}>
        Это не возврат
      </button>
    </div>
  );
}

/** «Что это за место» по названию из банка — с возможностью узнать заново. */
function PlaceInfo({ tx }: { tx: TxDoc }) {
  const f = useFinance();
  const [busy, setBusy] = useState(false);
  if (tx.kind === "transfer" || !tx.merchant) return null;
  const key = placeKey(tx.merchant);
  if (!key) return null;
  const p = f.places[key];
  const ask = async () => {
    setBusy(true);
    try {
      const n = await f.identify([key]);
      if (!n) toast("Не получилось понять, что это за место", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-xl bg-[var(--lh-surface)] px-2.5 py-2 text-[13px]">
      <span className="text-lg">
        <PlaceIcon place={p} fallback="🔎" />
      </span>
      <span className="min-w-0 flex-1">
        {p?.what ? (
          <>
            <b>{p.title}</b> — {p.what}
            {!p.sure && <span className="text-muted"> (догадка)</span>}
          </>
        ) : (
          <span className="text-muted">Что это за место — пока непонятно</span>
        )}
      </span>
      <button type="button" className="shrink-0 font-semibold text-accent" disabled={busy} onClick={ask}>
        {busy ? "Ищу…" : p?.what ? "Не то?" : "Узнать"}
      </button>
    </div>
  );
}
