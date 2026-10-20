import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { monthKey, plural, toast, useCollection, useStore } from "@lifehub/sdk";
import { accountStates, defaultPlan, type AccountState } from "./accounts.ts";
import { buildSummary, summaryKey, type FinanceSummary } from "./summary.ts";
import { identifyPlaces, placeKey, unknownMerchants, type Place, type Places } from "./places.ts";
import { isGenericKey, merchantKey } from "./categorize.ts";
import { today } from "./dates.ts";
import { draftFromOp, hookText, type Draft, type IngestContext } from "./ingest.ts";
import { accountByCard, autoRepayments, badRule, cleanMerchants, recategorize as recategorizeAll, exactDuplicates, findSelfPairs, mergePair, newCardAccounts, rowKey, transfersByBank, transfersByName, transfersToMyPhones } from "./tidy.ts";
import { round2 } from "./money.ts";
import type { ParsedOp } from "./parse/common.ts";
import { parseNotification } from "./parse/notify.ts";
import {
  DEFAULT_CATEGORIES, REPAY_CATEGORY,
  type Account, type AccountDoc, type Category, type Debt, type DebtDoc, type Person, type PersonDoc, type Plan, type PlanDoc,
  type Rule, type Source, type Tx, type TxDoc,
} from "./types.ts";

export interface Prefs {
  /** Как меня зовут в переводах («Максим П.») — переводы от себя = между своими счетами. */
  myNames: string[];
  /** Мои номера телефонов: переводы на них — в свой же другой банк. */
  myPhones?: string[];
  /** Номера, про которые ответили «не мой». */
  notMyPhones?: string[];
  /** Категории пересчитаны после чистки правил (один раз). */
  rulesV2?: boolean;
  /** Скрытые находки «где сэкономить». */
  hidden: string[];
  /** Последний разбор уведомлений: сколько пришло и с какими ошибками. */
  lastHook?: { at: number; added: number; skipped: number; sample?: string };
}

const DEFAULT_PREFS: Prefs = { myNames: [], hidden: [] };

interface FinanceValue {
  loading: boolean;
  txs: TxDoc[];
  accounts: AccountDoc[];
  states: AccountState[];
  people: PersonDoc[];
  debts: DebtDoc[];
  plans: PlanDoc[];
  categories: Category[];
  setCategories: (c: Category[]) => void;
  rules: Rule[];
  setRules: (r: Rule[]) => void;
  budget: number;
  setBudget: (n: number) => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  txCol: ReturnType<typeof useCollection<Tx>>;
  accountCol: ReturnType<typeof useCollection<Account>>;
  peopleCol: ReturnType<typeof useCollection<Person>>;
  debtCol: ReturnType<typeof useCollection<Debt>>;
  planCol: ReturnType<typeof useCollection<Plan>>;
  context: () => IngestContext;
  /** Записать распознанные операции. Возвращает, сколько добавлено/пропущено как дубли. */
  ingest: (drafts: Draft[]) => Promise<{ added: number; skipped: number; merged: number }>;
  /** Идёт запись импорта: сколько из скольких. */
  progress: { done: number; total: number } | null;
  /** Что за места по названиям продавцов (ключ — merchantKey). */
  places: Places;
  /** Узнать места: без аргумента — следующие незнакомые; с ключами — эти (заново). */
  identify: (keys?: string[]) => Promise<number>;
  placeOf: (merchant?: string) => Place | undefined;
  /** Навести порядок: дубли, счета по картам, переводы себе. */
  tidy: (announce?: boolean) => Promise<{ duplicates: number; accounts: number; transfers: number; repaid: number }>;
  /** «Это не возврат»: снять отметку и больше не предлагать этот перевод. */
  undoRepayment: (tx: TxDoc) => Promise<void>;
  /** Имя человека по id; без имени — «кто-то». */
  personName: (id: string) => string;
  /** Поменять категорию и запомнить правило для продавца (с переносом на похожие записи). */
  recategorize: (tx: TxDoc, patch: Partial<Tx>, remember: boolean) => Promise<number>;
  /** Разделить трату: доли людей → долги, моя доля → share. */
  splitTx: (tx: TxDoc, parts: { person: string; amount: number }[], myShare: number) => Promise<void>;
  /** Входящий перевод = возврат долга(ов). */
  applyRepayment: (tx: TxDoc, repays: { debt: string; amount: number }[]) => Promise<void>;
  /** Отметить долг возвращённым (наличными, без перевода). */
  closeDebt: (d: DebtDoc, amount?: number) => Promise<void>;
  categoryIcon: (name: string, kind?: Tx["kind"]) => string;
  accountName: (id?: string) => string;
}

const Ctx = createContext<FinanceValue | null>(null);

export function useFinance(): FinanceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance вне FinanceProvider");
  return v;
}

export function FinanceProvider({ children, processHooks = true }: { children: ReactNode; processHooks?: boolean }) {
  const txCol = useCollection<Tx>("transactions");
  const accountCol = useCollection<Account>("accounts");
  const peopleCol = useCollection<Person>("people");
  const debtCol = useCollection<Debt>("debts");
  const planCol = useCollection<Plan>("plans");
  const hook = useCollection<Record<string, unknown>>("webhook");
  const [storedCats, setCategories, catsState] = useStore<Category[]>("categories", DEFAULT_CATEGORIES);
  const [catsVersion, setCatsVersion, versionState] = useStore<number>("categoriesVersion", 0);
  const [rules, setRules, rulesState] = useStore<Rule[]>("rules", []);
  const [budget, setBudget] = useStore<number>("budget", 0);
  const [prefs, setPrefsRaw, prefsState] = useStore<Prefs>("prefs", DEFAULT_PREFS);
  // Пока настройки не загружены, модуль сам ничего не пишет: иначе запишет значения по умолчанию поверх ваших.
  const settingsReady = !catsState.loading && !versionState.loading && !rulesState.loading && !prefsState.loading;
  const fullPrefs = { ...DEFAULT_PREFS, ...prefs };

  // Старые категории (до 2.0) дополняем новыми один раз — свои пользователь не теряет.
  useEffect(() => {
    if (!settingsReady || catsVersion >= 2 || !storedCats) return;
    const has = (c: Category) => storedCats.some((x) => x.name === c.name && (x.kind ?? "expense") === c.kind);
    const merged = [...storedCats.map((c) => ({ ...c, kind: c.kind ?? "expense" })), ...DEFAULT_CATEGORIES.filter((c) => !has(c))];
    setCategories(merged);
    setCatsVersion(2);
  }, [catsVersion, storedCats, settingsReady]);

  const loading = txCol.loading || accountCol.loading;
  const month = monthKey();
  const states = useMemo(() => accountStates(accountCol.items, txCol.items, month), [accountCol.items, txCol.items, month]);

  const ref = useRef<FinanceValue | null>(null);

  const context = (): IngestContext => {
    const v = ref.current!;
    return { accounts: v.accounts, categories: v.categories, rules: v.rules, txs: v.txs, people: v.people, debts: v.debts, plans: v.plans, myNames: v.prefs.myNames };
  };

  // Записи идут по очереди: второй импорт ждёт первый и сверяется уже с ним (иначе — дубли).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const serial = <R,>(fn: () => Promise<R>): Promise<R> => {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => {});
    return run;
  };

  function ingest(drafts: Draft[]) {
    return serial(async () => {
      let skipped = 0;
      let merged = 0;
      const v = ref.current!;
      // Точно та же строка банка уже есть (или встречается дважды в этом же импорте) — не пишем.
      const byKey = new Map(v.txs.map((t) => [rowKey(t), t] as const).filter(([k]) => k));
      const keys = new Set(byKey.keys());
      const fresh: Draft[] = [];
      const updates: { id: string; patch: Partial<Tx> }[] = [];
      for (const d of drafts) {
        const k = rowKey(d.tx);
        if (k && keys.has(k)) {
          // Та же строка уже записана, но без счёта (загружали «по картам») — дописываем счёт и разбор заново.
          const old = byKey.get(k);
          if (old && !old.account && !old.toAccount && (d.tx.account || d.tx.toAccount)) {
            updates.push({
              id: old.id,
              patch: clean({ account: d.tx.account, toAccount: d.tx.toAccount, kind: d.tx.kind, category: d.tx.category, merchant: d.tx.merchant, card: d.tx.card, bank: d.tx.bank, review: d.tx.review }),
            });
            merged++;
          } else skipped++;
          continue;
        }
        if (k) keys.add(k);
        if (d.duplicateOf) {
          const dup = v.txs.find((x) => x.id === d.duplicateOf);
          // Запись, внесённая вручную, дополняется данными банка вместо дубля.
          if (dup && dup.source === "manual" && !dup.account) {
            updates.push({ id: dup.id, patch: clean({ account: d.tx.account, merchant: dup.merchant ?? d.tx.merchant, time: d.tx.time, raw: d.tx.raw, card: d.tx.card }) });
            merged++;
          } else if (dup && !dup.account && !dup.toAccount && (d.tx.account || d.tx.toAccount) && dup.source === d.tx.source) {
            // Та же операция из прежней загрузки без счёта — переразбираем её новой выпиской.
            updates.push({
              id: dup.id,
              patch: clean({ account: d.tx.account, toAccount: d.tx.toAccount, kind: d.tx.kind, category: d.tx.category, merchant: d.tx.merchant, card: d.tx.card, bank: d.tx.bank, raw: d.tx.raw, review: d.tx.review }),
            });
            merged++;
          } else skipped++;
          continue;
        }
        fresh.push(d);
      }
      const added: TxDoc[] = [];
      setProgress({ done: 0, total: fresh.length });
      for (let i = 0; i < fresh.length || (i === 0 && updates.length); i += 1000) {
        const r = await txCol.batch({ add: fresh.slice(i, i + 1000).map((d) => clean(d.tx)), update: i === 0 ? updates : [] });
        added.push(...(r.added as TxDoc[]));
        setProgress({ done: Math.min(fresh.length, i + 1000), total: fresh.length });
      }
      setProgress(null);
      // Побочные действия — у немногих операций: возвраты долгов, сплиты, балансы.
      for (let i = 0; i < fresh.length; i++) {
        const d = fresh[i];
        const doc = added[i];
        if (!doc) continue;
        if (d.repays?.length) await applyRepaymentIds(doc.id, d.repays);
        if (d.planPayment) {
          const p = ref.current!.plans.find((x) => x.id === d.planPayment);
          if (p) await planCol.update(p.id, { paidParts: Math.min(p.parts, p.paidParts + 1) });
        }
        if (d.newPlan && d.tx.account) {
          const acc = ref.current!.accounts.find((a) => a.id === d.tx.account);
          if (acc?.type === "split") {
            const plan = await planCol.add(defaultPlan(acc.id, d.tx.merchant ?? "Покупка", d.tx.amount, d.tx.date, doc.id));
            await txCol.update(doc.id, { plan: plan.id });
          }
        }
        if (d.balance) await accountCol.update(d.balance.account, { balance: d.balance.value, balanceAt: d.tx.date, balanceTs: Date.now() });
      }
      return { added: added.length, skipped, merged };
    }).then(async (r) => {
      // Даём React перерисоваться, чтобы порядок наводился уже по свежему списку.
      await new Promise((ok) => setTimeout(ok, 60));
      await tidy(false);
      return r;
    });
  }

  /** Порядок в записанном: дубли, счета по картам, переводы себе. Возвращает, что сделано. */
  function tidy(announce = true) {
    return serial(async () => {
      const v = ref.current!;
      // Дубли и внутренние проводки банка («вынос на просрочку» — не операция).
      const dups = [...exactDuplicates(v.txs), ...v.txs.filter((t) => /вынос на просрочку|перенос на просроч/i.test(t.raw ?? "")).map((t) => t.id)];
      let accounts = v.accounts;
      const newAccs = newCardAccounts(v.txs, accounts);
      if (newAccs.length) {
        const r = await accountCol.batch({ add: newAccs });
        accounts = [...accounts, ...(r.added as AccountDoc[])];
      }
      const dupSet = new Set(dups);
      let txs = v.txs.filter((t) => !dupSet.has(t.id));
      // Все правки одной записи складываем по шагам, каждый шаг видит результат предыдущего:
      // счёт по карте → чистка имён → переводы себе по имени/номеру/банку → склейка пар «списание + зачисление».
      const patches = new Map<string, Partial<Tx>>();
      const removed = new Set<string>();
      const put = (list: { id: string; patch: Partial<Tx> }[]) => {
        for (const u of list) if (!removed.has(u.id)) patches.set(u.id, { ...patches.get(u.id), ...u.patch });
        const m = new Map(list.map((u) => [u.id, u.patch]));
        txs = txs.filter((t) => !removed.has(t.id)).map((t) => (m.has(t.id) ? { ...t, ...m.get(t.id) } : t));
      };
      put(accountByCard(txs, accounts));
      put(cleanMerchants(txs));
      // Правила не про продавца (по дате, «qr оплата сбп») — убираем; после этого один раз пересчитываем категории.
      let rules = v.rules;
      if (rules.some(badRule)) {
        rules = rules.filter((r) => !badRule(r));
        setRules(rules);
      }
      if (!v.prefs.rulesV2) {
        put(recategorizeAll(txs, rules, v.categories));
        setPrefsRaw({ ...v.prefs, rulesV2: true });
      }
      const oneSided = [...transfersByName(txs, v.prefs.myNames), ...transfersToMyPhones(txs, v.prefs.myPhones ?? [])];
      put(oneSided);
      const pairs = findSelfPairs(txs, { myNames: v.prefs.myNames, people: v.people, accounts });
      pairs.forEach((p) => removed.add(p.inc.id));
      put(pairs.map(mergePair));
      // В свой банк без его выписки — только то, что не склеилось в пару.
      const byBank = transfersByBank(txs, accounts);
      put(byBank);
      const update = [...patches.entries()].map(([id, patch]) => ({ id, patch }));
      const remove = [...dups, ...removed];
      // Долги, закрытые зачислением, которое стало частью перевода, — не трогаем: такие пары не склеиваются (excluded).
      for (let i = 0; i < Math.max(update.length, remove.length); i += 2000) {
        await txCol.batch({ update: update.slice(i, i + 2000), remove: remove.slice(i, i + 2000) });
      }
      // Возвраты долгов без имени — по сумме и времени.
      const repaid = autoRepayments(txs, v.debts, { people: v.people, myNames: v.prefs.myNames, hidden: v.prefs.hidden });
      if (repaid.length) {
        const debtPatch = new Map<string, Partial<Debt>>();
        for (const r of repaid) {
          for (const x of r.repays) {
            const d = v.debts.find((y) => y.id === x.debt)!;
            const prev = debtPatch.get(d.id) ?? { paid: d.paid, repaidBy: d.repaidBy ?? [] };
            const paid = round2((prev.paid ?? 0) + x.amount);
            debtPatch.set(d.id, { paid, repaidBy: [...(prev.repaidBy ?? []), r.tx.id], closedAt: paid >= d.amount - 0.5 ? today() : undefined });
          }
        }
        await debtCol.batch({ update: [...debtPatch.entries()].map(([id, patch]) => ({ id, patch })) });
        await txCol.batch({ update: repaid.map((r) => ({ id: r.tx.id, patch: { excluded: true, category: REPAY_CATEGORY, review: false, repayGuess: true } })) });
      }
      const res = { duplicates: dups.length, accounts: newAccs.length, transfers: pairs.length + oneSided.length + byBank.length, repaid: repaid.length };
      if (announce || res.duplicates || res.transfers || res.accounts || res.repaid) {
        const parts = [
          res.duplicates && `убрал дубли: ${res.duplicates}`,
          res.accounts && `новые счета по картам: ${res.accounts}`,
          res.transfers && `переводы себе: ${res.transfers}`,
          res.repaid && `вам вернули долг: ${res.repaid}`,
        ].filter(Boolean);
        if (parts.length) toast(parts.join(" · "), "success");
        else if (announce) toast("Всё в порядке: дублей и несклеенных переводов нет", "success");
      }
      return res;
    });
  }

  // Сводка для других модулей («Инвестиции» — подушка безопасности): пишем, только когда она поменялась.
  const [summary, setSummary, summaryState] = useStore<FinanceSummary | null>("summary", null);
  useEffect(() => {
    if (!processHooks || !settingsReady || summaryState.loading || txCol.loading || accountCol.loading || !txCol.items.length) return;
    const t = setTimeout(() => {
      const next = buildSummary(txCol.items, states, storedCats.map((c) => ({ ...c, kind: c.kind ?? "expense" })));
      if (summaryKey(next) !== summaryKey(summary)) setSummary(next);
    }, 1500);
    return () => clearTimeout(t);
  }, [txCol.items, states, storedCats, settingsReady, summaryState.loading, processHooks]);

  // Что за места по названиям: поиск + нейронка, ответы хранятся; категорию ставим, где её толком нет.
  const [places, setPlaces, placesState] = useStore<Places>("places", {});
  const placesRef = useRef(places);
  placesRef.current = places;
  async function identify(keys?: string[]) {
    const v = ref.current!;
    // Свой выбор (кнопка «Узнать» / «Не то?») — именно эти, даже если уже спрашивали.
    const list = unknownMerchants(v.txs, keys ? {} : placesRef.current, 15, keys);
    if (!list.length) return 0;
    const found = await identifyPlaces(list, v.categories);
    const next = { ...placesRef.current, ...found };
    placesRef.current = next;
    setPlaces(next);
    const fix = ref.current!.txs
      .filter((t) => t.kind === "expense" && (t.review || t.category === "Другое") && t.merchant)
      .map((t) => ({ t, p: found[placeKey(t.merchant!) ?? ""] }))
      .filter(({ p }) => p?.category)
      .map(({ t, p }) => ({ id: t.id, patch: { category: p!.category!, review: !p!.sure } }));
    if (fix.length) await txCol.batch({ update: fix });
    return Object.values(found).filter((p) => p.what).length;
  }
  const identified = useRef(false);
  useEffect(() => {
    if (!processHooks || !settingsReady || placesState.loading || identified.current || txCol.loading || !txCol.items.length) return;
    identified.current = true;
    // Раз за сеанс и не сразу — пусть сначала пройдёт чистка; ошибки сети и нейронки молча пропускаем.
    const t = setTimeout(() => identify().catch(() => {}), 8000);
    return () => clearTimeout(t);
  }, [settingsReady, placesState.loading, txCol.loading, processHooks]);

  // Один раз после загрузки — навести порядок в том, что накопилось.
  const tidied = useRef(false);
  useEffect(() => {
    if (!processHooks || !settingsReady || tidied.current || txCol.loading || accountCol.loading || peopleCol.loading || !txCol.items.length) return;
    tidied.current = true;
    tidy(false);
  }, [txCol.loading, accountCol.loading, peopleCol.loading, processHooks, settingsReady]);

  async function applyRepaymentIds(txId: string, repays: { debt: string; amount: number }[]) {
    for (const r of repays) {
      const d = ref.current!.debts.find((x) => x.id === r.debt);
      if (!d) continue;
      const paid = round2(d.paid + r.amount);
      await debtCol.update(d.id, { paid, repaidBy: [...(d.repaidBy ?? []), txId], closedAt: paid >= d.amount - 0.5 ? today() : undefined });
    }
  }

  // Уведомления банков с телефона: разбираем, записываем и удаляем из очереди.
  const busy = useRef(false);
  // Пока разбирали, могли прийти новые — после разбора проверяем очередь ещё раз.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!processHooks || !settingsReady || busy.current || hook.loading || txCol.loading || accountCol.loading || !hook.items.length) return;
    busy.current = true;
    (async () => {
      let added = 0;
      let skipped = 0;
      let sample: string | undefined;
      for (const doc of hook.items) {
        await hook.remove(doc.id).catch(() => {});
        const input = hookText(doc);
        const op: ParsedOp | null = input ? parseNotification({ ...input, receivedAt: Number(doc.receivedAt) || doc.createdAt }) : null;
        if (!op) {
          skipped++;
          sample = input?.text.slice(0, 120) ?? JSON.stringify(doc).slice(0, 120);
          continue;
        }
        const r = await ingest([draftFromOp(op, "push", context())]);
        added += r.added + r.merged;
        skipped += r.skipped;
      }
      // Пачки, пришедшие подряд, складываем в один итог.
      const prev = ref.current!.prefs.lastHook;
      const recent = prev && Date.now() - prev.at < 60_000;
      setPrefsRaw({
        ...ref.current!.prefs,
        lastHook: { at: Date.now(), added: added + (recent ? prev.added : 0), skipped: skipped + (recent ? prev.skipped : 0), sample: sample ?? (recent ? prev.sample : undefined) },
      });
      if (added) toast(`Из уведомлений банков: ${added} ${plural(added, ["операция", "операции", "операций"])}`, "success");
    })().finally(() => {
      busy.current = false;
      setTick((t) => t + 1);
    });
  }, [hook.items, hook.loading, txCol.loading, accountCol.loading, processHooks, tick, settingsReady]);

  async function recategorize(tx: TxDoc, patch: Partial<Tx>, remember: boolean) {
    await txCol.update(tx.id, { ...patch, review: false });
    const key = merchantKey(tx.merchant ?? "");
    // «QR-оплата», «Перевод», посредники — не продавец: категорию ставим только этой операции.
    if (!remember || !key || isGenericKey(key) || !patch.category) return 0;
    const rule: Rule = { match: key, category: patch.category, kind: patch.kind ?? tx.kind, toAccount: patch.toAccount };
    setRules([...ref.current!.rules.filter((r) => r.match !== key), rule]);
    // Переносим на другие записи этого продавца, которые ещё не правили руками.
    const others = ref.current!.txs.filter((x) => x.id !== tx.id && merchantKey(x.merchant ?? "") === key && x.category === tx.category && x.kind === tx.kind && !x.excluded);
    for (const o of others) await txCol.update(o.id, { category: patch.category, kind: rule.kind, review: false, ...(patch.toAccount ? { toAccount: patch.toAccount } : {}) });
    return others.length;
  }

  async function splitTx(tx: TxDoc, parts: { person: string; amount: number }[], myShare: number) {
    // Старые доли этой траты, по которым ещё ничего не вернули, пересоздаём.
    const old = ref.current!.debts.filter((d) => d.tx === tx.id);
    for (const d of old) if (!d.paid) await debtCol.remove(d.id);
    const keep = old.filter((d) => d.paid);
    for (const p of parts) {
      // Доли без имени («нас было трое») не сверяем с оставшимися: каждая — отдельный долг.
      if (p.amount <= 0 || (p.person && keep.some((d) => d.person === p.person))) continue;
      await debtCol.add({ person: p.person, dir: "owed", amount: round2(p.amount), paid: 0, date: tx.date, tx: tx.id, note: tx.merchant ?? tx.category });
    }
    await txCol.update(tx.id, { share: parts.length ? round2(myShare) : undefined });
  }

  async function undoRepayment(tx: TxDoc) {
    let rest = tx.amount;
    for (const d of ref.current!.debts.filter((x) => x.repaidBy?.includes(tx.id))) {
      const back = Math.min(rest, d.paid);
      rest -= back;
      await debtCol.update(d.id, { paid: round2(d.paid - back), repaidBy: (d.repaidBy ?? []).filter((x) => x !== tx.id), closedAt: undefined });
    }
    await txCol.update(tx.id, { excluded: false, category: "Переводы от людей", repayGuess: false });
    const p = ref.current!.prefs;
    setPrefsRaw({ ...p, hidden: [...p.hidden, `repay:${tx.id}`] });
  }

  async function applyRepayment(tx: TxDoc, repays: { debt: string; amount: number }[]) {
    await applyRepaymentIds(tx.id, repays);
    await txCol.update(tx.id, { excluded: true, category: REPAY_CATEGORY, review: false });
  }

  async function closeDebt(d: DebtDoc, amount?: number) {
    const paid = round2(Math.min(d.amount, d.paid + (amount ?? d.amount - d.paid)));
    await debtCol.update(d.id, { paid, closedAt: paid >= d.amount - 0.5 ? today() : undefined });
  }

  const categories = storedCats.map((c) => ({ ...c, kind: c.kind ?? "expense" }));
  const value: FinanceValue = {
    loading,
    txs: txCol.items,
    accounts: accountCol.items,
    states,
    people: peopleCol.items,
    debts: debtCol.items,
    plans: planCol.items,
    categories,
    setCategories,
    rules,
    setRules,
    budget,
    setBudget,
    prefs: fullPrefs,
    setPrefs: setPrefsRaw,
    txCol, accountCol, peopleCol, debtCol, planCol,
    context,
    ingest,
    progress,
    tidy,
    places,
    identify,
    placeOf: (m) => (m ? places[placeKey(m) ?? ""] : undefined),
    recategorize,
    splitTx,
    applyRepayment,
    undoRepayment,
    personName: (id) => (id ? (peopleCol.items.find((p) => p.id === id)?.name ?? "?") : "кто-то"),
    closeDebt,
    categoryIcon: (name, kind = "expense") => {
      if (kind === "transfer") return "🔄";
      if (name === REPAY_CATEGORY) return "🤝";
      return categories.find((c) => c.name === name && c.kind === kind)?.icon ?? categories.find((c) => c.name === name)?.icon ?? "💸";
    },
    accountName: (id) => accountCol.items.find((a) => a.id === id)?.name ?? "",
  };
  ref.current = value;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Убирает undefined-поля: в JSON их всё равно не будет, а сравнения проще. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Записать операции из распознанного источника (выписка, «Поделиться», текст) — с черновиком для проверки. */
export function makeDrafts(ops: ParsedOp[], source: Source, ctx: IngestContext, account?: string): Draft[] {
  const drafts: Draft[] = [];
  for (const op of ops) {
    // Каждая следующая операция видит уже распознанные — дубли внутри одного файла тоже ловятся.
    const d = draftFromOp(op, source, { ...ctx, txs: [...ctx.txs, ...drafts.map((x, i) => ({ ...x.tx, id: `draft${i}`, createdAt: 0, updatedAt: 0 }))] }, account);
    if (d.duplicateOf?.startsWith("draft")) d.duplicateOf = undefined; // одинаковые операции в одной выписке — разные покупки
    drafts.push(d);
  }
  return drafts;
}
