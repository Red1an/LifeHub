import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Link, Loading, Select, Switch, cn, confirm, toast, useNavigate, useParams, useSearchParams } from "@lifehub/sdk";
import { monthName, planLeft, planSchedule, upcomingPayments, type AccountState } from "../lib/accounts.ts";
import { daysBetween, dayTitle, shortDate, today } from "../lib/dates.ts";
import { parseAmount, rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { ACCOUNT_TYPES, BANKS, isDebtAccount, type Account, type AccountDoc, type AccountType, type BankId, type Grace, type Plan, type PlanDoc } from "../lib/types.ts";
import { BankMark, Bar, Card, Sheet, TxRow } from "../components/ui.tsx";
import { useTxSheet } from "../components/TxSheet.tsx";
import { CashbackCard } from "../components/Cashback.tsx";

const ORDER: AccountType[] = ["card", "credit", "split", "savings", "cash"];

export function Accounts() {
  const f = useFinance();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<Partial<AccountDoc> | null>(null);
  const [plan, setPlan] = useState<Partial<PlanDoc> | null>(null);
  useEffect(() => {
    if (params.get("add")) {
      setEdit({});
      setParams({ add: null });
    }
  }, []);

  const live = f.states.filter((s) => !s.account.archived);
  const money = live.filter((s) => !isDebtAccount(s.account)).reduce((s, x) => s + (x.balance ?? 0), 0);
  const debt = live.reduce((s, x) => s + x.debt, 0);
  const upcoming = useMemo(() => upcomingPayments(f.states, f.plans, 60), [f.states, f.plans]);
  const plans = f.plans.filter((p) => p.paidParts < p.parts);

  if (f.loading) return <Loading />;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Счета</h1>
        <Button variant="primary" onClick={() => setEdit({})}>
          + Счёт
        </Button>
      </div>

      <section className="fin-hero mb-4 p-5">
        <div className="fin-label">Свои деньги минус долги</div>
        <div className="fin-num mt-1 text-[34px] font-extrabold leading-none">{rub(money - debt)}</div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <div className="text-emerald-50/70">На картах и счетах</div>
            <div className="fin-num text-base font-semibold">{rub(money)}</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <div className="text-emerald-50/70">Кредитки и сплиты</div>
            <div className="fin-num text-base font-semibold">{debt ? "−" + rub(debt) : "0 ₽"}</div>
          </div>
        </div>
      </section>

      {ORDER.map((type) => {
        const list = live.filter((s) => s.account.type === type);
        if (!list.length) return null;
        return (
          <Card key={type} title={ACCOUNT_TYPES[type]} className="mb-4" padded={false}>
            <div className="px-1 pb-1">
              {list.map((s) => (
                <AccountRow key={s.account.id} s={s} />
              ))}
            </div>
          </Card>
        );
      })}

      {plans.length > 0 && (
        <Card title="Сплиты и рассрочки" className="mb-4" action={<Button size="sm" variant="ghost" onClick={() => setPlan({})}>+ Добавить</Button>}>
          <div className="space-y-3">
            {plans.map((p) => (
              <PlanRow key={p.id} p={p} onEdit={() => setPlan(p)} />
            ))}
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card title="Платежи на 2 месяца" className="mb-4">
          <div className="space-y-2">
            {upcoming.map((u) => (
              <div key={u.id} className="flex items-center gap-3 text-[14.5px]">
                <span className={cn("w-16 shrink-0 text-[13px]", u.days <= 3 ? "font-semibold text-[var(--fin-amber)]" : "text-muted")}>
                  {u.days < 0 ? "просроч." : u.days === 0 ? "сегодня" : shortDate(u.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">{u.title}</span>
                <span className="fin-num font-semibold">{rub(u.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 text-sm">
              <span className="text-muted">Всего</span>
              <span className="fin-num font-semibold">{rub(upcoming.reduce((s, u) => s + u.amount, 0))}</span>
            </div>
          </div>
        </Card>
      )}

      {!plans.length && f.accounts.some((a) => a.type === "split") && (
        <Button variant="secondary" block className="mb-4" onClick={() => setPlan({})}>
          + Покупка Сплитом / в рассрочку
        </Button>
      )}

      {f.accounts.some((a) => a.archived) && (
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">Архив</summary>
          {f.states
            .filter((s) => s.account.archived)
            .map((s) => (
              <AccountRow key={s.account.id} s={s} />
            ))}
        </details>
      )}

      {edit && <AccountForm acc={edit} onClose={() => setEdit(null)} />}
      {plan && <PlanForm plan={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}

function AccountRow({ s }: { s: AccountState }) {
  const a = s.account;
  const debtAcc = isDebtAccount(a);
  const graceDays = s.graceEnd ? daysBetween(today(), s.graceEnd) : null;
  return (
    <Link to={`/account/${a.id}`} className="fin-row">
      <BankMark account={a} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{a.name}</span>
        <span className="block truncate text-[13px] text-muted">
          {BANKS[a.bank].name}
          {a.cards?.length ? ` · ${a.cards.map((c) => "•" + c).join(" ")}` : ""}
          {graceDays !== null && <span className={graceDays <= 7 ? "text-[var(--fin-amber)]" : ""}> · льгота до {shortDate(s.graceEnd!)}</span>}
        </span>
        {debtAcc && a.limit ? <Bar className="mt-1.5" value={s.debt} max={a.limit} color={s.debt > a.limit * 0.8 ? "var(--fin-red)" : "var(--fin-amber)"} /> : null}
      </span>
      <span className="text-right">
        <span className={cn("fin-num block font-semibold", debtAcc && s.debt > 0 && "fin-down")}>
          {debtAcc ? (s.debt > 0 ? "−" + rub(s.debt) : "0 ₽") : s.balance === null ? "—" : rub(s.balance)}
        </span>
        {debtAcc && a.limit ? <span className="text-[12px] text-muted">из {rub(a.limit)}</span> : null}
        {!debtAcc && a.balance === undefined && <span className="text-[12px] text-muted">задать баланс</span>}
      </span>
    </Link>
  );
}

function PlanRow({ p, onEdit }: { p: PlanDoc; onEdit: () => void }) {
  const f = useFinance();
  const sched = planSchedule(p);
  const next = sched.find((x) => !x.paid);
  return (
    <button type="button" onClick={onEdit} className="block w-full text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{p.title}</span>
        <span className="fin-num font-semibold">{rub(planLeft(p))}</span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {sched.map((x) => (
          <div key={x.n} className={cn("h-1.5 flex-1 rounded-full", x.paid ? "bg-[var(--fin-green)]" : "bg-surface-2")} />
        ))}
      </div>
      <div className="mt-1 text-[12.5px] text-muted">
        {f.accountName(p.account)} · {p.paidParts}/{p.parts} внесено{next ? ` · следующий ${rub(next.amount)} ${shortDate(next.date)}` : ""}
      </div>
    </button>
  );
}

export function AccountPage() {
  const f = useFinance();
  const { id } = useParams();
  const nav = useNavigate();
  const sheet = useTxSheet();
  const [edit, setEdit] = useState(false);
  const s = f.states.find((x) => x.account.id === id);
  if (f.loading) return <Loading />;
  if (!s) return <div className="p-6 text-muted">Счёт не найден</div>;
  const a = s.account;
  const txs = f.txs.filter((t) => t.account === a.id || t.toAccount === a.id).sort((x, y) => y.date.localeCompare(x.date) || (y.time ?? "").localeCompare(x.time ?? ""));
  const debtAcc = isDebtAccount(a);
  const plans = f.plans.filter((p) => p.account === a.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" onClick={() => nav("/accounts")} className="-ml-2 grid size-9 place-items-center rounded-full text-xl text-muted hover:bg-surface-2">
          ‹
        </button>
        <BankMark account={a} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{a.name}</h1>
          <div className="text-[13px] text-muted">
            {BANKS[a.bank].name} · {ACCOUNT_TYPES[a.type]}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setEdit(true)}>
          Изменить
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <div className="fin-label">{debtAcc ? "Долг" : "Баланс"}</div>
          <div className={cn("fin-num mt-1 text-2xl font-bold", debtAcc && s.debt > 0 && "fin-down")}>
            {debtAcc ? rub(s.debt) : s.balance === null ? "—" : rub(s.balance)}
          </div>
          {a.balanceAt && <div className="mt-1 text-[12px] text-muted">сверено {shortDate(a.balanceAt)}</div>}
        </Card>
        <Card>
          <div className="fin-label">Траты в этом месяце</div>
          <div className="fin-num mt-1 text-2xl font-bold">{rub(s.monthSpent)}</div>
          {debtAcc && a.limit ? <div className="mt-1 text-[12px] text-muted">доступно {rub(Math.max(0, a.limit - s.debt))}</div> : null}
        </Card>
      </div>

      {a.type === "credit" && <GraceCard s={s} />}
      {(a.type === "card" || a.type === "credit") && <CashbackCard account={a} />}

      {plans.length > 0 && (
        <Card className="mb-4" title="Сплиты">
          <div className="space-y-3">
            {plans.map((p) => (
              <PlanRow key={p.id} p={p} onEdit={() => {}} />
            ))}
          </div>
        </Card>
      )}

      <Card title={`Операции (${txs.length})`} padded={false}>
        <div className="px-1 pb-2">
          {txs.slice(0, 200).map((t, i) => (
            <div key={t.id}>
              {(i === 0 || txs[i - 1].date !== t.date) && <div className="fin-label px-3 pb-1 pt-2">{dayTitle(t.date)}</div>}
              <TxRow tx={t} onClick={() => sheet.open(t)} />
            </div>
          ))}
          {!txs.length && <p className="p-4 text-center text-sm text-muted">Пока пусто. Загрузите выписку или подключите уведомления.</p>}
        </div>
      </Card>
      {edit && <AccountForm acc={a} onClose={() => setEdit(false)} />}
    </div>
  );
}

function AccountForm({ acc, onClose }: { acc: Partial<AccountDoc>; onClose: () => void }) {
  const f = useFinance();
  const nav = useNavigate();
  const [d, setD] = useState<Partial<Account>>({ type: "card", bank: "sber", ...acc });
  const [cards, setCards] = useState((acc.cards ?? []).join(", "));
  const [balance, setBalance] = useState(acc.balance !== undefined ? String(acc.balance) : "");
  const set = (p: Partial<Account>) => setD({ ...d, ...p });
  const debtAcc = d.type === "credit" || d.type === "split";

  const presets: { label: string; v: Partial<Account> }[] = [
    { label: "Сбер · карта", v: { bank: "sber", type: "card", name: "Сбер" } },
    { label: "Сбер · кредитка", v: { bank: "sber", type: "credit", name: "Сбер Кредитная", graceDays: 120 } },
    { label: "Яндекс · карта", v: { bank: "yandex", type: "card", name: "Яндекс Пэй" } },
    { label: "Яндекс Сплит", v: { bank: "yandex", type: "split", name: "Яндекс Сплит" } },
    { label: "Озон · карта", v: { bank: "ozon", type: "card", name: "Озон Банк" } },
    { label: "Озон · рассрочка", v: { bank: "ozon", type: "split", name: "Озон Рассрочка" } },
    { label: "Т-Банк", v: { bank: "tbank", type: "card", name: "Т-Банк" } },
    { label: "Наличные", v: { bank: "cash", type: "cash", name: "Наличные" } },
  ];

  const save = async () => {
    const name = (d.name ?? "").trim() || `${BANKS[d.bank as BankId].name}`;
    const data: Account = {
      ...(d as Account),
      name,
      cards: cards.split(/[,\s]+/).map((c) => c.replace(/\D/g, "").slice(-4)).filter((c) => c.length === 4),
    };
    const b = balance.trim() === "" ? undefined : parseAmount(balance);
    if (b !== acc.balance || !acc.id) {
      data.balance = b;
      data.balanceAt = b === undefined ? undefined : today();
      data.balanceTs = b === undefined ? undefined : Date.now();
    }
    if (acc.id) await f.accountCol.update(acc.id, data);
    else await f.accountCol.add(data);
    toast("Сохранено", "success");
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={acc.id ? "Счёт" : "Новый счёт"}
      footer={
        <>
          {acc.id && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                if (d.archived) {
                  if (await confirm("Удалить счёт? Операции останутся без счёта.", { danger: true, confirmText: "Удалить" })) {
                    await f.accountCol.remove(acc.id!);
                    onClose();
                    nav("/accounts");
                  }
                } else {
                  await f.accountCol.update(acc.id!, { archived: true });
                  onClose();
                }
              }}
            >
              {d.archived ? "Удалить" : "В архив"}
            </Button>
          )}
          {d.archived && (
            <Button variant="secondary" onClick={() => set({ archived: false })}>
              Вернуть из архива
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!acc.id && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.label} type="button" className="fin-chip" onClick={() => set(p.v)}>
                <BankMark bank={p.v.bank} size={18} /> {p.label}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Банк">
            <Select value={d.bank} onChange={(e) => set({ bank: e.target.value as BankId })} options={Object.entries(BANKS).map(([v, b]) => ({ value: v, label: b.name }))} />
          </Field>
          <Field label="Тип">
            <Select value={d.type} onChange={(e) => set({ type: e.target.value as AccountType })} options={Object.entries(ACCOUNT_TYPES).map(([v, l]) => ({ value: v, label: l }))} />
          </Field>
        </div>
        <Field label="Название">
          <Input value={d.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="Сбер зарплатная" />
        </Field>
        {d.type !== "cash" && (
          <Field label="Последние 4 цифры карт" hint="Через запятую. По ним уведомления и выписки раскладываются по счетам.">
            <Input value={cards} onChange={(e) => setCards(e.target.value)} inputMode="numeric" placeholder="1234, 5678" />
          </Field>
        )}
        <Field label={debtAcc ? "Сколько должен сейчас, ₽" : "Сколько сейчас на счёте, ₽"} hint="Дальше модуль считает сам по операциям. Уведомления с «Баланс: …» обновляют его.">
          <Input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="не знаю" />
        </Field>
        {debtAcc && (
          <Field label="Лимит, ₽">
            <Input inputMode="numeric" value={d.limit ?? ""} onChange={(e) => set({ limit: parseAmount(e.target.value) || undefined })} />
          </Field>
        )}
        {d.type === "credit" && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Льгота, дней">
              <Input inputMode="numeric" value={d.graceDays ?? ""} onChange={(e) => set({ graceDays: Number(e.target.value) || undefined })} placeholder="120" />
            </Field>
            <Field label="Платёж до (число)">
              <Input inputMode="numeric" value={d.dueDay ?? ""} onChange={(e) => set({ dueDay: Math.min(31, Number(e.target.value)) || undefined })} placeholder="25" />
            </Field>
            <Field label="Ставка, %">
              <Input inputMode="decimal" value={d.rate ?? ""} onChange={(e) => set({ rate: parseAmount(e.target.value) || undefined })} placeholder="34,9" />
            </Field>
          </div>
        )}
        {acc.id && <Switch checked={!!d.archived} onChange={(v) => set({ archived: v })} label="В архиве (закрыт)" />}
      </div>
    </Sheet>
  );
}

function PlanForm({ plan, onClose }: { plan: Partial<PlanDoc>; onClose: () => void }) {
  const f = useFinance();
  const splits = f.accounts.filter((a) => a.type === "split" || a.type === "credit");
  const [d, setD] = useState<Partial<Plan>>({ parts: 4, every: "2w", paidParts: 1, start: today(), account: splits[0]?.id, ...plan });
  const [total, setTotal] = useState(plan.total ? String(plan.total) : "");
  const set = (p: Partial<Plan>) => setD({ ...d, ...p });
  const save = async () => {
    const t = parseAmount(total);
    if (!t || !d.account) return toast("Укажите сумму и счёт", "error");
    const data = { ...(d as Plan), total: t, title: d.title?.trim() || "Покупка" };
    if (plan.id) await f.planCol.update(plan.id, data);
    else await f.planCol.add(data);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Сплит / рассрочка"
      footer={
        <>
          {plan.id && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (await confirm("Удалить рассрочку?", { danger: true })) {
                  await f.planCol.remove(plan.id!);
                  onClose();
                }
              }}
            >
              Удалить
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!splits.length && <p className="text-sm text-danger">Сначала добавьте счёт с типом «Сплит / рассрочка».</p>}
        <Field label="Что купили">
          <Input value={d.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Наушники" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма покупки, ₽">
            <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <Field label="Счёт">
            <Select value={d.account ?? ""} onChange={(e) => set({ account: e.target.value })} options={splits.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Платежей">
            <Input inputMode="numeric" value={d.parts ?? ""} onChange={(e) => set({ parts: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="Как часто">
            <Select value={d.every} onChange={(e) => set({ every: e.target.value as Plan["every"] })} options={[{ value: "2w", label: "раз в 2 нед." }, { value: "1m", label: "раз в месяц" }]} />
          </Field>
          <Field label="Уже внесено">
            <Input inputMode="numeric" value={d.paidParts ?? 0} onChange={(e) => set({ paidParts: Math.min(d.parts ?? 4, Number(e.target.value) || 0) })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Первый платёж">
            <Input type="date" value={d.start} onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label="Комиссия, ₽" hint="у долгих сплитов">
            <Input inputMode="decimal" value={d.fee ?? ""} onChange={(e) => set({ fee: parseAmount(e.target.value) || undefined })} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

/** Льготные периоды кредитки: у Озона — свой срок для покупок каждого месяца. */
function GraceCard({ s }: { s: AccountState }) {
  const f = useFinance();
  const a = s.account;
  const [edit, setEdit] = useState<{ i: number; g: Grace } | null>(null);
  const t = today();
  const months = Object.keys(s.openByMonth ?? {}).sort();
  const save = async (list: Grace[]) => {
    await f.accountCol.update(a.id, { graces: list.sort((x, y) => x.until.localeCompare(y.until)) });
    setEdit(null);
  };
  return (
    <Card
      className="mb-4"
      title="Льготные периоды"
      action={
        <Button size="sm" variant="ghost" onClick={() => setEdit({ i: -1, g: { until: "", month: s.graceMissing?.[0] ?? months.at(-1) } })}>
          + Период
        </Button>
      }
    >
      {s.debt <= 0 ? (
        <p className="text-[14px] text-muted">Долга нет — проценты не начисляются.</p>
      ) : s.graces?.length ? (
        <div className="space-y-2">
          {s.graces.map((g) => {
            const d = daysBetween(t, g.until);
            const idx = (a.graces ?? []).findIndex((x) => x.until === g.until);
            return (
              <button
                key={g.until}
                type="button"
                className={cn("flex w-full items-center gap-3 rounded-2xl p-3 text-left", d <= 10 ? "bg-[var(--fin-amber-soft)]" : "bg-surface-2")}
                onClick={() => idx >= 0 && setEdit({ i: idx, g: a.graces![idx] })}
              >
                <span className="text-xl">⏳</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">до {shortDate(g.until)}</span>
                  <span className="block text-[13px] text-muted">
                    {d < 0 ? "срок прошёл" : d === 0 ? "сегодня" : `осталось ${d} дн.`}
                    {g.months.length ? ` · ${g.months.map(monthName).join(", ")}` : ""}
                    {g.manual ? " · сумма из банка" : ""}
                  </span>
                </span>
                <span className="fin-num font-bold">{rub(g.amount)}</span>
              </button>
            );
          })}
          {s.graceMissing?.length ? (
            <p className="text-[13px] text-[var(--fin-amber)]">
              Для «{s.graceMissing.map(monthName).join(", ")}» срок не указан — добавьте период.
            </p>
          ) : null}
          <p className="text-[12.5px] text-muted">
            Сумма периода — непогашенные покупки его месяца (платежи гасят самые старые). Если в приложении банка другая — нажмите на период и впишите её.
          </p>
        </div>
      ) : s.graceEnd ? (
        <p className="text-[14.5px]">
          Внесите <b className="fin-num">{rub(s.graceAmount ?? 0)}</b> до <b>{shortDate(s.graceEnd)}</b> ({daysBetween(t, s.graceEnd)} дн.), чтобы не платить проценты.
        </p>
      ) : (
        <p className="text-[14px] text-muted">Добавьте льготные периоды, как в приложении банка (до какого числа и за покупки какого месяца), — модуль напомнит заранее.</p>
      )}
      {s.interestRisk && s.debt > 0 ? <p className="mt-2 text-[13px] text-muted">Если не успеть — ≈ {rub(s.interestRisk)} процентов в месяц.</p> : null}
      {s.dueDate && <p className="mt-1 text-[13px] text-muted">Минимальный платёж — до {shortDate(s.dueDate)}.</p>}
      {edit && <GraceForm grace={edit.g} months={months} isNew={edit.i < 0} onClose={() => setEdit(null)}
        onSave={(g) => save(edit.i < 0 ? [...(a.graces ?? []), g] : (a.graces ?? []).map((x, i) => (i === edit.i ? g : x)))}
        onDelete={() => save((a.graces ?? []).filter((_, i) => i !== edit.i))} />}
    </Card>
  );
}

function GraceForm({ grace, months, isNew, onClose, onSave, onDelete }: { grace: Grace; months: string[]; isNew: boolean; onClose: () => void; onSave: (g: Grace) => void; onDelete: () => void }) {
  const [until, setUntil] = useState(grace.until);
  const [month, setMonth] = useState(grace.month ?? "");
  const [amount, setAmount] = useState(grace.amount !== undefined ? String(grace.amount) : "");
  const opts = [...new Set([...months, ...(grace.month ? [grace.month] : [])])].sort();
  return (
    <Sheet
      open
      onClose={onClose}
      title="Льготный период"
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={onDelete}>
              Удалить
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              if (!until) return toast("Укажите дату", "error");
              const v = parseAmount(amount);
              onSave({ until, month: month || undefined, amount: v > 0 ? v : undefined });
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Гасить до">
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field label="За покупки" hint="Месяц, покупки которого входят в этот период">
          <Select value={month} onChange={(e) => setMonth(e.target.value)} options={[{ value: "", label: "по порядку (самые старые)" }, ...opts.map((m) => ({ value: m, label: monthName(m) }))]} />
        </Field>
        <Field label="Сумма, ₽" hint="Необязательно: впишите, если в приложении банка сумма другая">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="посчитать по покупкам" />
        </Field>
      </div>
    </Sheet>
  );
}
