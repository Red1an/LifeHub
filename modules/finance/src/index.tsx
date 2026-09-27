import { useMemo, useState } from "react";
import {
  defineModule, Page, Section, Card, Button, Input, Select, Field, Tabs, Modal, List, ListItem, EmptyState, Stat, Progress,
  DonutChart, BarChart, IconButton, Loading,
  useCollection, useStore, useSearchParams, confirm, toast,
  formatMoney, formatDate, dayKey, monthKey, cn,
} from "@lifehub/sdk";

type Kind = "expense" | "income";

interface Tx {
  kind: Kind;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note?: string;
}

interface Category {
  name: string;
  icon: string;
  kind: Kind;
}

const DEFAULT_CATEGORIES: Category[] = [
  { name: "Продукты", icon: "🛒", kind: "expense" },
  { name: "Кафе", icon: "☕", kind: "expense" },
  { name: "Транспорт", icon: "🚇", kind: "expense" },
  { name: "Дом", icon: "🏠", kind: "expense" },
  { name: "Здоровье", icon: "💊", kind: "expense" },
  { name: "Развлечения", icon: "🎮", kind: "expense" },
  { name: "Одежда", icon: "👕", kind: "expense" },
  { name: "Подписки", icon: "📱", kind: "expense" },
  { name: "Другое", icon: "📦", kind: "expense" },
  { name: "Зарплата", icon: "💼", kind: "income" },
  { name: "Подработка", icon: "🧰", kind: "income" },
  { name: "Подарки", icon: "🎁", kind: "income" },
];

const money = (n: number) => formatMoney(n);

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return s[0].toUpperCase() + s.slice(1);
}

function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  return [params.get("month") ?? monthKey(), (m) => setParams({ month: m === monthKey() ? null : m })];
}

function useCategories() {
  const [cats, setCats] = useStore<Category[]>("categories", DEFAULT_CATEGORIES);
  const icon = (name: string) => cats.find((c) => c.name === name)?.icon ?? "📦";
  return { cats, setCats, icon };
}

function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-2">
      <IconButton label="Предыдущий месяц" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </IconButton>
      <div className="font-semibold">{monthTitle(month)}</div>
      <IconButton label="Следующий месяц" onClick={() => onChange(shiftMonth(month, 1))} disabled={month >= monthKey()} className="disabled:opacity-30">
        ›
      </IconButton>
    </div>
  );
}

function Overview() {
  const tx = useCollection<Tx>("transactions");
  const [month, setMonth] = useMonth();
  const [budget] = useStore<number>("budget", 0);
  const { icon } = useCategories();
  const [editing, setEditing] = useState<(Tx & { id?: string }) | null>(null);

  const list = useMemo(
    () => tx.items.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [tx.items, month],
  );
  const expense = list.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
  const income = list.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof list>();
    for (const t of list) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
    return [...groups.entries()];
  }, [list]);

  return (
    <Page
      title="Финансы"
      actions={
        <Button variant="primary" onClick={() => setEditing({ kind: "expense", amount: 0, category: "Продукты", date: dayKey() })}>
          + Запись
        </Button>
      }
    >
      <MonthSwitcher month={month} onChange={setMonth} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Расходы" value={money(expense)} tone="danger" />
        <Stat label="Доходы" value={money(income)} tone="success" />
        <Stat className="col-span-2 sm:col-span-1" label="Баланс" value={money(income - expense)} tone={income - expense >= 0 ? "success" : "danger"} />
      </div>
      {budget > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex justify-between text-sm">
            <span>Бюджет на месяц</span>
            <span className="tabular-nums text-muted">
              {money(expense)} из {money(budget)}
            </span>
          </div>
          <Progress value={expense} max={budget} tone={expense > budget ? "danger" : expense > budget * 0.8 ? "warning" : "accent"} />
        </Card>
      )}

      {tx.loading ? (
        <Loading />
      ) : byDay.length === 0 ? (
        <EmptyState icon="💸" title="В этом месяце записей нет" text="Добавьте первый расход или доход" />
      ) : (
        byDay.map(([date, items]) => (
          <Section key={date} title={formatDate(date + "T00:00", "weekday")}>
            <List>
              {items.map((t) => (
                <ListItem
                  key={t.id}
                  onClick={() => setEditing(t)}
                  left={<span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-xl">{icon(t.category)}</span>}
                  title={t.category}
                  subtitle={t.note}
                  right={
                    <span className={cn("font-semibold tabular-nums", t.kind === "income" ? "text-success" : "")}>
                      {t.kind === "income" ? "+" : "−"}
                      {money(t.amount)}
                    </span>
                  }
                />
              ))}
            </List>
          </Section>
        ))
      )}
      <TxModal tx={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function TxModal({ tx, onClose }: { tx: (Tx & { id?: string }) | null; onClose: () => void }) {
  if (!tx) return null;
  return <TxForm key={tx.id ?? "new"} tx={tx} onClose={onClose} />;
}

function TxForm({ tx, onClose: close }: { tx: Tx & { id?: string }; onClose: () => void }) {
  const txs = useCollection<Tx>("transactions");
  const { cats } = useCategories();
  const [current, setDraft] = useState<Tx>({ kind: tx.kind, amount: tx.amount, category: tx.category, date: tx.date, note: tx.note ?? "" });
  const [amount, setAmount] = useState(tx.amount ? String(tx.amount) : "");

  const kindCats = cats.filter((c) => c.kind === current.kind);
  const save = async () => {
    const value = Number(amount.replace(",", ".").replace(/\s/g, ""));
    if (!value || value <= 0) return toast("Введите сумму", "error");
    const data: Tx = { ...current, amount: Math.round(value * 100) / 100 };
    if (tx.id) await txs.update(tx.id, data);
    else await txs.add(data);
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title={tx.id ? "Запись" : "Новая запись"}
      footer={
        <>
          {tx.id && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (await confirm("Удалить запись?", { danger: true, confirmText: "Удалить" })) {
                  await txs.remove(tx.id!);
                  close();
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
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Tabs<Kind>
          value={current.kind}
          onChange={(kind) => setDraft({ ...current, kind, category: cats.find((c) => c.kind === kind)?.name ?? "" })}
          tabs={[
            { id: "expense", label: "Расход" },
            { id: "income", label: "Доход" },
          ]}
        />
        <Field label="Сумма, ₽">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="h-12 text-2xl font-semibold" />
        </Field>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {kindCats.map((c) => (
            <button
              type="button"
              key={c.name}
              onClick={() => setDraft({ ...current, category: c.name })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border p-2 text-xs transition",
                current.category === c.name ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
              )}
            >
              <span className="text-xl">{c.icon}</span>
              <span className="w-full truncate">{c.name}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата">
            <Input type="date" value={current.date} onChange={(e) => setDraft({ ...current, date: e.target.value })} />
          </Field>
          <Field label="Комментарий">
            <Input value={current.note ?? ""} onChange={(e) => setDraft({ ...current, note: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function Stats() {
  const tx = useCollection<Tx>("transactions");
  const [month, setMonth] = useMonth();
  const { icon } = useCategories();

  const monthTx = tx.items.filter((t) => t.date.startsWith(month) && t.kind === "expense");
  const byCat = Object.entries(
    monthTx.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) + t.amount }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const total = byCat.reduce((s, [, v]) => s + v, 0);

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const trend = months.map((m) => ({
    label: new Date(m + "-01T00:00").toLocaleDateString("ru-RU", { month: "short" }),
    value: tx.items.filter((t) => t.kind === "expense" && t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0),
  }));

  return (
    <Page title="Статистика">
      <MonthSwitcher month={month} onChange={setMonth} />
      {tx.loading ? (
        <Loading />
      ) : (
        <>
          <Section title="Расходы по категориям">
            <Card>
              {byCat.length ? (
                <DonutChart
                  data={byCat.map(([label, value]) => ({ label: `${icon(label)} ${label}`, value }))}
                  format={money}
                  center={
                    <div>
                      <div className="text-xs text-muted">всего</div>
                      <div className="font-semibold">{money(total)}</div>
                    </div>
                  }
                />
              ) : (
                <p className="text-sm text-muted">Нет расходов за месяц</p>
              )}
            </Card>
          </Section>
          <Section title="Расходы за полгода">
            <Card>
              <BarChart data={trend} format={money} />
            </Card>
          </Section>
        </>
      )}
    </Page>
  );
}

function SettingsPage() {
  const [budget, setBudget] = useStore<number>("budget", 0);
  const { cats, setCats } = useCategories();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏷️");
  const [kind, setKind] = useState<Kind>("expense");
  return (
    <Page title="Настройки" width="narrow">
      <Section title="Бюджет">
        <Card>
          <Field label="Сколько планирую тратить в месяц, ₽" hint="0 — без бюджета">
            <Input inputMode="numeric" value={budget || ""} onChange={(e) => setBudget(Number(e.target.value.replace(/\D/g, "")) || 0)} />
          </Field>
        </Card>
      </Section>
      <Section title="Категории">
        <List className="mb-3">
          {cats.map((c) => (
            <ListItem
              key={c.kind + c.name}
              left={<span className="text-xl">{c.icon}</span>}
              title={c.name}
              subtitle={c.kind === "income" ? "доход" : "расход"}
              right={
                <IconButton
                  label="Удалить"
                  onClick={async () => {
                    if (await confirm(`Удалить категорию «${c.name}»? Записи останутся.`)) setCats(cats.filter((x) => x !== c));
                  }}
                >
                  ✕
                </IconButton>
              }
            />
          ))}
        </List>
        <Card>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setCats([...cats, { name: name.trim(), icon, kind }]);
              setName("");
            }}
          >
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-14 text-center" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новая категория" className="min-w-40 flex-1" />
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              options={[
                { value: "expense", label: "расход" },
                { value: "income", label: "доход" },
              ]}
              className="w-32"
            />
            <Button type="submit">Добавить</Button>
          </form>
        </Card>
      </Section>
    </Page>
  );
}

function MonthWidget() {
  const { items, loading } = useCollection<Tx>("transactions");
  const [budget] = useStore<number>("budget", 0);
  if (loading) return null;
  const m = monthKey();
  const exp = items.filter((t) => t.kind === "expense" && t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0);
  const today = items.filter((t) => t.kind === "expense" && t.date === dayKey()).reduce((s, t) => s + t.amount, 0);
  return (
    <div>
      <div className="text-sm text-muted">Потрачено в этом месяце</div>
      <div className="text-2xl font-semibold tabular-nums">{money(exp)}</div>
      {budget > 0 && <Progress className="mt-2" value={exp} max={budget} tone={exp > budget ? "danger" : "accent"} />}
      <div className="mt-2 text-sm text-muted">Сегодня: {money(today)}</div>
    </div>
  );
}

export default defineModule({
  routes: {
    "/": Overview,
    "/stats": Stats,
    "/settings": SettingsPage,
  },
  nav: [
    { to: "/", label: "Операции", icon: "💳" },
    { to: "/stats", label: "Статистика", icon: "📊" },
    { to: "/settings", label: "Настройки", icon: "⚙️" },
  ],
  widgets: {
    month: { title: "Финансы", component: MonthWidget },
  },
});
