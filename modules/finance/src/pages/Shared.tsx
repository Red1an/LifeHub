import { useMemo, useState } from "react";
import { Button, EmptyState, Field, Input, Loading, Select, cn, confirm, prompt, toast } from "@lifehub/sdk";
import { nameMatches, personFromText } from "../lib/categorize.ts";
import { addDaysKey, daysBetween, shortDate, today } from "../lib/dates.ts";
import { matchRepayment } from "../lib/ingest.ts";
import { parseAmount, rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { type DebtDoc, type PersonDoc, type TxDoc } from "../lib/types.ts";
import { Card, Sheet } from "../components/ui.tsx";
import { useTxSheet } from "../components/TxSheet.tsx";

const left = (d: DebtDoc) => Math.max(0, d.amount - d.paid);

export function Shared() {
  const f = useFinance();
  const sheet = useTxSheet();
  const [person, setPerson] = useState<PersonDoc | null>(null);
  const [adding, setAdding] = useState(false);

  const open = f.debts.filter((d) => left(d) > 0.5);
  const owedTotal = open.filter((d) => d.dir === "owed").reduce((s, d) => s + left(d), 0);
  const oweTotal = open.filter((d) => d.dir === "owe").reduce((s, d) => s + left(d), 0);

  const byPerson = useMemo(() => {
    return f.people
      .map((p) => {
        const ds = open.filter((d) => d.person === p.id);
        const owed = ds.filter((d) => d.dir === "owed").reduce((s, d) => s + left(d), 0);
        const owe = ds.filter((d) => d.dir === "owe").reduce((s, d) => s + left(d), 0);
        return { p, ds, net: owed - owe, oldest: ds.map((d) => d.date).sort()[0] };
      })
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [f.people, f.debts]);

  // Входящие переводы от людей за 45 дней, которые не отмечены возвратом: может, это долг?
  const incoming = useMemo(
    () =>
      f.txs
        .filter((t) => t.kind === "income" && !t.excluded && !f.prefs.hidden.includes(`repay:${t.id}`) && t.date >= addDaysKey(today(), -45) && (t.category === "Переводы от людей" || personFromText(t.raw ?? t.merchant ?? "")))
        .map((t) => ({ t, match: matchRepayment({ amount: t.amount, raw: t.raw ?? t.merchant ?? "", date: t.date }, t.merchant, f) }))
        .filter((x) => x.match || open.some((d) => d.dir === "owed" && Math.abs(left(d) - x.t.amount) < 1))
        .slice(0, 8),
    [f.txs, f.debts, f.people, f.prefs.hidden],
  );

  if (f.loading) return <Loading />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Общак</h1>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Долг
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <section className="fin-hero p-4">
          <div className="fin-label">Вам должны</div>
          <div className="fin-num mt-1 text-2xl font-extrabold">{rub(owedTotal)}</div>
        </section>
        <section className="fin-card p-4">
          <div className="fin-label">Вы должны</div>
          <div className={cn("fin-num mt-1 text-2xl font-extrabold", oweTotal > 0 && "fin-down")}>{rub(oweTotal)}</div>
        </section>
      </div>

      {incoming.length > 0 && (
        <Card title="Похоже, вам вернули" className="mb-4">
          <div className="space-y-2">
            {incoming.map(({ t, match }) => (
              <RepayRow key={t.id} t={t} match={match} />
            ))}
          </div>
        </Card>
      )}

      {byPerson.length === 0 && !open.some((d) => !d.person) ? (
        <EmptyState
          icon="🤝"
          title="Делите общие счета"
          text="Откройте трату (кафе, такси, продукты на всех) и нажмите «Разделить». Модуль запомнит, кто сколько должен, и сам отметит, когда вам переведут."
        />
      ) : byPerson.length === 0 ? null : (
        <Card title="Люди" padded={false}>
          <div className="px-1 pb-1">
            {byPerson.map(({ p, ds, net, oldest }) => (
              <button key={p.id} type="button" className="fin-row" onClick={() => setPerson(p)}>
                <span className="fin-icon">{p.emoji ?? "🙂"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-[13px] text-muted">
                    {ds.length ? `${ds.length} ${ds.length === 1 ? "долг" : "долга"} · с ${shortDate(oldest!)}` : "всё закрыто"}
                    {oldest && daysBetween(oldest, today()) >= 7 && <span className="text-[var(--fin-amber)]"> · {daysBetween(oldest, today())} дн.</span>}
                  </span>
                </span>
                <span className={cn("fin-num font-semibold", net > 0 && "fin-up", net < 0 && "fin-down", !net && "text-muted")}>
                  {net > 0 ? `+${rub(net)}` : net < 0 ? `−${rub(-net)}` : "0 ₽"}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Unnamed />

      <SplitSuggestions onSplit={(t) => sheet.open(t, "split")} />

      {person && <PersonSheet person={person} onClose={() => setPerson(null)} />}
      {adding && <AddDebt onClose={() => setAdding(false)} />}
    </div>
  );
}

function RepayRow({ t, match }: { t: TxDoc; match: { debt: string; amount: number }[] | null }) {
  const f = useFinance();
  const debts = match?.map((m) => f.debts.find((d) => d.id === m.debt)).filter(Boolean) as DebtDoc[] | undefined;
  const who = f.people.find((p) => p.id === debts?.[0]?.person);
  const candidates = f.debts.filter((d) => d.dir === "owed" && left(d) > 0.5 && Math.abs(left(d) - t.amount) < 1);
  const [pick, setPick] = useState(match ? "auto" : candidates[0]?.id ?? "");
  const apply = async () => {
    if (pick === "auto" && match) await f.applyRepayment(t, match);
    else {
      const d = f.debts.find((x) => x.id === pick);
      if (!d) return;
      await f.applyRepayment(t, [{ debt: d.id, amount: Math.min(t.amount, left(d)) }]);
      // Запоминаем, как человек подписан в банке, — дальше отметится само.
      const bankName = personFromText(t.raw ?? "") ?? t.merchant;
      const p = f.people.find((x) => x.id === d.person);
      if (p && bankName && !nameMatches(bankName, [p.name, ...(p.aliases ?? [])])) await f.peopleCol.update(p.id, { aliases: [...(p.aliases ?? []), bankName] });
    }
    toast("Отмечено: долг возвращён", "success");
  };
  return (
    <div className="fin-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{t.merchant ?? "Перевод"}</div>
          <div className="text-[13px] text-muted">{shortDate(t.date)}</div>
        </div>
        <div className="fin-num font-semibold fin-up">+{rub(t.amount)}</div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {match && who ? (
          <span className="flex-1 text-[13.5px]">
            Это {who.name} вернул за {debts!.map((d) => `${d.note ?? "трату"} ${shortDate(d.date)}`).join(", ")}?
          </span>
        ) : (
          <Select
            className="flex-1"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            options={candidates.map((d) => ({ value: d.id, label: `${f.personName(d.person)}: ${d.note ?? ""} ${rub(left(d))}` }))}
          />
        )}
        <Button size="sm" variant="primary" onClick={apply}>
          Да
        </Button>
        <Button size="sm" variant="ghost" onClick={() => f.setPrefs({ ...f.prefs, hidden: [...f.prefs.hidden, `repay:${t.id}`] })}>
          Нет
        </Button>
      </div>
    </div>
  );
}

function PersonSheet({ person, onClose }: { person: PersonDoc; onClose: () => void }) {
  const f = useFinance();
  const p = f.people.find((x) => x.id === person.id) ?? person;
  const ds = f.debts.filter((d) => d.person === p.id).sort((a, b) => b.date.localeCompare(a.date));
  const open = ds.filter((d) => left(d) > 0.5);
  const owed = open.filter((d) => d.dir === "owed").reduce((s, d) => s + left(d), 0);
  const owe = open.filter((d) => d.dir === "owe").reduce((s, d) => s + left(d), 0);

  const remind = async () => {
    const lines = open.filter((d) => d.dir === "owed").map((d) => `• ${d.note ?? "общий счёт"} ${shortDate(d.date)} — ${rub(left(d))}`);
    const text = `Привет! Напоминаю про общак:\n${lines.join("\n")}\nИтого ${rub(owed)}. Можно по СБП 🙏`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Текст скопирован — вставьте в мессенджер", "success");
      }
    } catch {}
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${p.emoji ?? "🙂"} ${p.name}`}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            onClick={async () => {
              if (!(await confirm(`Удалить ${p.name} и все долги?`, { danger: true }))) return;
              for (const d of ds) await f.debtCol.remove(d.id);
              await f.peopleCol.remove(p.id);
              onClose();
            }}
          >
            Удалить
          </Button>
          {owed > 0 && (
            <Button variant="primary" onClick={remind}>
              📨 Напомнить
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="fin-soft p-3">
            <div className="fin-label">Должен вам</div>
            <div className="fin-num text-xl font-bold fin-up">{rub(owed)}</div>
          </div>
          <div className="fin-soft p-3">
            <div className="fin-label">Вы должны</div>
            <div className="fin-num text-xl font-bold">{rub(owe)}</div>
          </div>
        </div>
        <Field label="Как подписан в переводах" hint="Через запятую: «Иван Иванович И.», «Иван И.» — по этому модуль узнаёт возвраты">
          <Input
            defaultValue={(p.aliases ?? []).join(", ")}
            onBlur={(e) => f.peopleCol.update(p.id, { aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
        <div className="space-y-1">
          {ds.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
              <span className="text-lg">{d.dir === "owed" ? "⬅️" : "➡️"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px]">{d.note ?? (d.dir === "owed" ? "Должен мне" : "Я должен")}</span>
                <span className="text-[12.5px] text-muted">
                  {shortDate(d.date)}
                  {d.paid > 0 && left(d) > 0.5 && ` · вернул ${rub(d.paid)}`}
                  {left(d) <= 0.5 && " · закрыт ✓"}
                </span>
              </span>
              <span className={cn("fin-num font-semibold", left(d) <= 0.5 && "text-muted line-through")}>{rub(d.amount)}</span>
              {left(d) > 0.5 && (
                <Button
                  size="sm"
                  variant="soft"
                  onClick={async () => {
                    const v = await prompt(`Сколько ${d.dir === "owed" ? "вернул" : "вы отдали"}? (наличными или иначе)`, String(left(d)));
                    if (v === null) return;
                    await f.closeDebt(d, parseAmount(v) || left(d));
                  }}
                >
                  ✓
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function AddDebt({ onClose }: { onClose: () => void }) {
  const f = useFinance();
  const [person, setPerson] = useState(f.people[0]?.id ?? "");
  const [name, setName] = useState("");
  const [dir, setDir] = useState<"owed" | "owe">("owed");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const save = async () => {
    let pid = person;
    if (!pid) {
      if (!name.trim()) return toast("Укажите человека", "error");
      pid = (await f.peopleCol.add({ name: name.trim() })).id;
    }
    const v = parseAmount(amount);
    if (!v) return toast("Введите сумму", "error");
    await f.debtCol.add({ person: pid, dir, amount: v, paid: 0, date: today(), note: note || undefined });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Долг" footer={<Button variant="primary" onClick={save}>Сохранить</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={cn("fin-chip justify-center", dir === "owed" && "on")} onClick={() => setDir("owed")}>
            Мне должны
          </button>
          <button type="button" className={cn("fin-chip justify-center", dir === "owe" && "on")} onClick={() => setDir("owe")}>
            Я должен
          </button>
        </div>
        <Field label="Кто">
          <Select value={person} onChange={(e) => setPerson(e.target.value)} options={[...f.people.map((p) => ({ value: p.id, label: p.name })), { value: "", label: "+ Новый человек" }]} />
        </Field>
        {!person && (
          <Field label="Имя (как в переводах)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван И." />
          </Field>
        )}
        <Field label="Сумма, ₽">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="За что">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Билеты в кино" />
        </Field>
      </div>
    </Sheet>
  );
}

/** Крупные траты в кафе и барах за 3 недели без раздела — частые кандидаты в «общак». */
function SplitSuggestions({ onSplit }: { onSplit: (t: TxDoc) => void }) {
  const f = useFinance();
  const splitted = new Set(f.debts.map((d) => d.tx));
  const cafes = f.txs.filter((t) => t.kind === "expense" && !t.excluded && t.amount > 0 && ["Кафе", "Развлечения", "Такси", "Доставка еды"].includes(t.category));
  const median = (() => {
    const xs = cafes.map((t) => t.amount).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length * 0.75)] : 1000;
  })();
  const list = cafes
    .filter((t) => t.date >= addDaysKey(today(), -21) && !splitted.has(t.id) && t.share === undefined && t.amount >= Math.max(1500, median * 2))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  if (!list.length) return null;
  return (
    <Card title="Может, это был общий счёт?" className="mt-4">
      <div className="space-y-1">
        {list.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-1.5">
            <span className="fin-icon size-10 text-base">{f.categoryIcon(t.category)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t.merchant ?? t.category}</span>
              <span className="text-[13px] text-muted">
                {shortDate(t.date)} · обычно до {rub(median)}
              </span>
            </span>
            <span className="fin-num font-semibold">{rub(t.amount)}</span>
            <Button size="sm" variant="soft" onClick={() => onSplit(t)}>
              Разделить
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Доли без имени («нас было трое»): по тратам — сколько ещё ждём. */
function Unnamed() {
  const f = useFinance();
  const sheet = useTxSheet();
  const open = f.debts.filter((d) => !d.person && d.dir === "owed" && left(d) > 0.5);
  if (!open.length) return null;
  const byTx = new Map<string, DebtDoc[]>();
  for (const d of open) byTx.set(d.tx ?? d.id, [...(byTx.get(d.tx ?? d.id) ?? []), d]);
  return (
    <Card title="Ждём переводы (без имён)" className="mt-4">
      <div className="space-y-2">
        {[...byTx.entries()].map(([key, ds]) => {
          const tx = f.txs.find((t) => t.id === key);
          const sum = ds.reduce((s, d) => s + left(d), 0);
          return (
            <div key={key} className="flex items-center gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => tx && sheet.open(tx, "split")}>
                <span className="block truncate font-medium">{ds[0].note ?? "Общий счёт"}</span>
                <span className="text-[13px] text-muted">
                  {shortDate(ds[0].date)} · ещё {ds.length} × {rub(left(ds[0]))}
                </span>
              </button>
              <span className="fin-num font-semibold">{rub(sum)}</span>
              <Button size="sm" variant="soft" onClick={() => f.closeDebt(ds[0])}>
                ✓ Отдали
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[12.5px] text-muted">Переводы на сумму доли отмечаются сами. «✓ Отдали» — если вернули наличными.</p>
    </Card>
  );
}
