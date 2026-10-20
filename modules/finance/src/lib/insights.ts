import { merchantKey } from "./categorize.ts";
import { addDaysKey, daysBetween, shiftMonth, shortDate, today } from "./dates.ts";
import { categoryAverages, findRecurring, isExpense, monthStats, pace, type Recurring } from "./analytics.ts";
import { monthName, planLeft, type AccountState } from "./accounts.ts";
import { cashbackReport } from "./cashback.ts";
import { rub } from "./money.ts";
import type { DebtDoc, PersonDoc, PlanDoc, TxDoc } from "./types.ts";

/*
 * «Где сэкономить» и предупреждения. Каждая находка — со стабильным id (для «скрыть»),
 * оценкой экономии в месяц и ссылкой, куда пойти разбираться.
 */

export interface Insight {
  id: string;
  tone: "save" | "warn" | "info" | "good";
  icon: string;
  title: string;
  text: string;
  /** Сколько можно сэкономить в месяц. */
  saving?: number;
  to?: string;
  /** Операция, к которой относится (например, общий счёт без раздела). */
  tx?: string;
  priority: number;
  /** Находки про одно и то же (категорию) — в общую экономию идёт только самая большая. */
  group?: string;
}

/** Сколько можно сэкономить в месяц по всем находкам, без двойного счёта одной категории. */
export function totalSaving(list: Insight[]): number {
  const by = new Map<string, number>();
  list.forEach((i, n) => {
    if (!i.saving || i.saving <= 0) return;
    const k = i.group ?? `#${n}`;
    by.set(k, Math.max(by.get(k) ?? 0, i.saving));
  });
  return [...by.values()].reduce((s, v) => s + v, 0);
}

export interface InsightInput {
  txs: TxDoc[];
  month: string;
  budget: number;
  states: AccountState[];
  plans: PlanDoc[];
  debts: DebtDoc[];
  people: PersonDoc[];
  /** Нельзя урезать: жильё, связь. */
  fixedCategories: string[];
}

export function buildInsights(i: InsightInput): { insights: Insight[]; recurring: Recurring[] } {
  const out: Insight[] = [];
  const t = today();
  const ms = monthStats(i.txs, i.month);
  const p = pace(i.txs, i.month, i.budget);
  const avg = categoryAverages(i.txs, i.month);
  const recurring = findRecurring(i.txs);
  const current = t.startsWith(i.month);
  const scale = current && p.day > 0 ? p.days / p.day : 1;

  // Бюджет и темп
  if (current && p.budget && p.day >= 5) {
    if (p.forecast > p.budget * 1.05) {
      out.push({
        id: `pace:${i.month}`, tone: "warn", icon: "📈", priority: 1,
        title: `К концу месяца выйдет ~${rub(round100(p.forecast))}`,
        text: `Это на ${rub(round100(p.forecast - p.budget))} больше ${p.budgetIsAuto ? "обычного (среднее за 3 месяца)" : "бюджета"}. Чтобы уложиться — не больше ${rub(round100(p.perDay ?? 0))} в день.`,
        to: "/analytics",
      });
    } else if (p.forecast < p.budget * 0.9 && p.day >= 10) {
      out.push({
        id: `pace-good:${i.month}`, tone: "good", icon: "🌱", priority: 4,
        title: "Тратите меньше обычного",
        text: `Прогноз — ${rub(round100(p.forecast))} из ${rub(p.budget)}. Разницу можно сразу отложить на накопительный счёт.`,
      });
    }
  }

  // Категории, которые выросли
  // Подписки и маркетплейсы списываются разом — их не растягиваем; в начале месяца прогноз по категориям слишком шумный.
  for (const c of current && p.day < 10 ? [] : ms.byCategory) {
    if (i.fixedCategories.includes(c.name) || c.name === "Подписки") continue;
    const base = avg.get(c.name) ?? 0;
    const proj = c.value * (current ? scale : 1);
    if (base > 1500 && proj > base * 1.3 && proj - base > 1500) {
      out.push({
        id: `grow:${i.month}:${c.name}`, tone: "save", icon: "🔺", priority: 2,
        title: `${c.name}: +${Math.round((proj / base - 1) * 100)}% к обычному`,
        text: `${current ? "Идёте к" : "Вышло"} ${rub(round100(proj))} при среднем ${rub(round100(base))}. Вернуться к обычному уровню — минус ${rub(round100(proj - base))} в месяц.`,
        saving: proj - base, to: `/ops?cat=${encodeURIComponent(c.name)}&month=${i.month}`, group: c.name,
      });
    }
  }

  // Доставка и такси — частые «удобные» траты
  const freq = (cat: string) => i.txs.filter((x) => isExpense(x) && x.category === cat && x.date.startsWith(i.month));
  const delivery = freq("Доставка еды");
  if (delivery.length >= 5) {
    const sum = delivery.reduce((s, x) => s + (x.share ?? x.amount), 0);
    out.push({
      id: `delivery:${i.month}`, tone: "save", icon: "🛵", priority: 2,
      title: `Доставка еды ${delivery.length} раз — ${rub(sum)}`,
      text: `Средний заказ ${rub(sum / delivery.length)}. Готовить хотя бы половину из этих раз — около ${rub(round100(sum * 0.5 * 0.6 * scale))} экономии в месяц (продукты дешевле доставки примерно на 60 %).`,
      saving: sum * 0.5 * 0.6 * scale, to: `/ops?cat=${encodeURIComponent("Доставка еды")}&month=${i.month}`, group: "Доставка еды",
    });
  }
  const taxi = freq("Такси");
  const shortTaxi = taxi.filter((x) => x.amount < 500);
  if (taxi.length >= 6) {
    const sum = taxi.reduce((s, x) => s + (x.share ?? x.amount), 0);
    out.push({
      id: `taxi:${i.month}`, tone: "save", icon: "🚕", priority: 3,
      title: `Такси ${taxi.length} раз — ${rub(sum)}`,
      text: shortTaxi.length >= 3
        ? `${shortTaxi.length} поездок дешевле 500 ₽ — короткие, их часто можно заменить метро или самокатом: ~${rub(round100(shortTaxi.reduce((s, x) => s + x.amount, 0) * 0.7 * scale))} в месяц.`
        : `Половина поездок на метро — около ${rub(round100(sum * 0.35 * scale))} в месяц.`,
      saving: shortTaxi.length >= 3 ? shortTaxi.reduce((s, x) => s + x.amount, 0) * 0.7 * scale : sum * 0.35 * scale,
      to: `/ops?cat=${encodeURIComponent("Такси")}&month=${i.month}`, group: "Такси",
    });
  }

  // Мелкие частые траты («латте-фактор»)
  const small = i.txs.filter((x) => isExpense(x) && x.date.startsWith(i.month) && x.amount > 0 && x.amount <= 400 && ["Кафе", "Продукты", "Развлечения", "Другое"].includes(x.category));
  const byPlace = new Map<string, TxDoc[]>();
  for (const x of small) {
    const k = merchantKey(x.merchant ?? "");
    if (k) byPlace.set(k, [...(byPlace.get(k) ?? []), x]);
  }
  const habit = [...byPlace.values()].filter((l) => l.length >= 6).sort((a, b) => b.length - a.length)[0];
  if (habit) {
    const sum = habit.reduce((s, x) => s + x.amount, 0);
    out.push({
      id: `habit:${i.month}:${merchantKey(habit[0].merchant ?? "")}`, tone: "save", icon: "☕", priority: 3,
      title: `${habit[0].merchant}: ${habit.length} раз по мелочи`,
      text: `${rub(sum)} за месяц, за год выйдет ~${rub(round100(sum * scale * 12))}. Вдвое реже — ${rub(round100((sum * scale) / 2))} в месяц в копилку.`,
      saving: (sum * scale) / 2, group: habit[0].category,
    });
  }

  // Подписки
  const subs = recurring.filter((r) => r.period !== "week");
  const subsMonthly = subs.reduce((s, r) => s + r.monthly, 0);
  if (subs.length >= 2) {
    out.push({
      id: `subs:${subs.length}:${Math.round(subsMonthly / 100)}`, tone: "info", icon: "🔁", priority: 3,
      title: `Подписки и регулярные платежи: ${rub(round100(subsMonthly))} в месяц`,
      text: `${subs.length} шт., ${rub(round100(subsMonthly * 12))} в год. Пройдитесь по списку: каждая забытая подписка — деньги каждый месяц.`,
      to: "/analytics?tab=subs",
    });
  }
  for (const r of recurring.filter((x) => x.raised)) {
    out.push({
      id: `raised:${r.key}:${r.last}`, tone: "warn", icon: "⬆️", priority: 2,
      title: `${r.name} подорожал на ${rub(r.raised!)}`,
      text: `Последнее списание ${rub(r.amount)} (${shortDate(r.last)}). Проверьте тариф — часто можно вернуться на старый или найти дешевле.`,
      saving: r.raised! * (r.period === "year" ? 1 / 12 : 1),
    });
  }

  // Проценты и комиссии банкам
  const yearStart = t.slice(0, 4) + "-01-01";
  const fees = i.txs.filter((x) => isExpense(x) && x.category === "Проценты и комиссии" && x.date >= yearStart);
  if (fees.length) {
    const sum = fees.reduce((s, x) => s + x.amount, 0);
    out.push({
      id: `fees:${t.slice(0, 7)}:${Math.round(sum)}`, tone: "save", icon: "🧾", priority: 2,
      title: `Банкам за год: ${rub(sum)} процентов и комиссий`,
      text: "Гасите кредитки целиком до конца льготного периода, отключите платные SMS — их заменяют пуш-уведомления.",
      saving: sum / Math.max(1, Number(t.slice(5, 7))), to: `/ops?cat=${encodeURIComponent("Проценты и комиссии")}`,
    });
  }

  // Кредитки: льготный период
  for (const s of i.states) {
    if (s.graceMissing?.length && s.debt > 0) {
      out.push({
        id: `grace-missing:${s.account.id}:${s.graceMissing.join(",")}`, tone: "info", icon: "📅", priority: 1,
        title: `${s.account.name}: до какого числа льготный период для новых покупок?`,
        text: `Есть непогашенные покупки (${s.graceMissing.map(monthName).join(", ")}), для которых срок не указан. Посмотрите его в приложении банка и добавьте на странице счёта.`,
        to: `/account/${s.account.id}`,
      });
    }
    // Несколько периодов (Озон) — предупреждаем про каждый ближайший.
    for (const g of s.graces ?? []) {
      const d = daysBetween(t, g.until);
      if (d > 10 || d < -30) continue;
      out.push({
        id: `grace:${s.account.id}:${g.until}`, tone: "warn", icon: "⏳", priority: 0,
        title: d < 0 ? `${s.account.name}: льготный период закончился ${shortDate(g.until)}` : `${s.account.name}: ${d === 0 ? "сегодня" : `через ${d} дн.`} конец льготного периода`,
        text: `Внесите ${rub(g.amount)}${g.months.length ? ` (${g.months.map(monthName).join(", ")})` : ""}${s.interestRisk ? `, иначе набегут проценты` : ", чтобы не платить проценты"}.`,
        to: `/account/${s.account.id}`,
      });
    }
    if (s.graces?.length || !s.graceEnd || !s.graceAmount) continue;
    const d = daysBetween(t, s.graceEnd);
    if (d <= 10) {
      out.push({
        id: `grace:${s.account.id}:${s.graceEnd}`, tone: "warn", icon: "⏳", priority: 0,
        title: d < 0 ? `${s.account.name}: льготный период закончился` : `${s.account.name}: ${d === 0 ? "сегодня" : `через ${d} дн.`} конец льготного периода`,
        text: `Внесите ${rub(s.graceAmount)}${s.interestRisk ? `, иначе набегут проценты — около ${rub(s.interestRisk)} в месяц` : ", чтобы не платить проценты"}.`,
        to: `/account/${s.account.id}`,
      });
    }
  }

  // Сплиты: нагрузка
  const splitLeft = i.plans.reduce((s, p) => s + planLeft(p), 0);
  const income3 = [1, 2, 3].map((k) => monthStats(i.txs, shiftMonth(i.month, -k)).income).filter((v) => v > 0);
  const avgIncome = income3.length ? income3.reduce((s, v) => s + v, 0) / income3.length : ms.income;
  if (splitLeft > 0 && avgIncome > 0 && splitLeft > avgIncome * 0.3) {
    out.push({
      id: `splits:${Math.round(splitLeft / 1000)}`, tone: "warn", icon: "🧩", priority: 1,
      title: `Сплиты и рассрочки: осталось ${rub(splitLeft)}`,
      text: `Это ${Math.round((splitLeft / avgIncome) * 100)}% месячного дохода. Пока не закроете текущие — новые покупки частями лучше не брать.`,
      to: "/accounts",
    });
  }

  // Двойные списания
  const recent = i.txs.filter((x) => isExpense(x) && x.amount > 0 && x.date >= addDaysKey(t, -45));
  const seen = new Map<string, TxDoc>();
  for (const x of recent.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""))) {
    const k = `${x.date}|${merchantKey(x.merchant ?? "")}|${x.amount}|${x.account ?? ""}`;
    const prev = seen.get(k);
    if (prev && x.merchant && x.time && prev.time && Math.abs(min(x.time) - min(prev.time)) <= 10 && !/такси|taxi|метро|транспорт/i.test(x.category)) {
      out.push({
        id: `double:${x.id}`, tone: "warn", icon: "⚠️", priority: 0,
        title: `Возможно, двойное списание: ${x.merchant}`,
        text: `${shortDate(x.date)} дважды по ${rub(x.amount)} с разницей в несколько минут. Если покупка была одна — напишите в банк, деньги вернут.`,
        tx: x.id, to: `/ops?q=${encodeURIComponent(x.merchant)}`,
      });
    }
    seen.set(k, x);
  }

  // Общак: долги и похожие на общий счёт траты
  const owedOpen = i.debts.filter((d) => d.dir === "owed" && d.amount - d.paid > 0.5);
  const stale = owedOpen.filter((d) => daysBetween(d.date, t) >= 5);
  if (stale.length) {
    const sum = stale.reduce((s, d) => s + d.amount - d.paid, 0);
    const names = [...new Set(stale.map((d) => (d.person ? (i.people.find((p) => p.id === d.person)?.name ?? "?") : "без имени")))];
    out.push({
      id: `owed:${stale.map((d) => d.id).join(",").slice(0, 60)}`, tone: "warn", icon: "🤝", priority: 0,
      title: `Вам не скинули ${rub(sum)}`,
      text: `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` и ещё ${names.length - 3}` : ""} — больше 5 дней. Отправьте напоминание в один клик.`,
      to: "/shared",
    });
  }
  const cafes = i.txs.filter((x) => isExpense(x) && x.category === "Кафе" && x.amount > 0);
  const checks = cafes.map((x) => x.amount).sort((a, b) => a - b);
  // «Обычный чек» — верхняя четверть: кофе с собой не должен делать любой ужин подозрительным.
  const median = checks.length ? checks[Math.floor(checks.length * 0.75)] : 0;
  const splittedTx = new Set(i.debts.map((d) => d.tx).filter(Boolean));
  for (const x of cafes.filter((x) => x.date >= addDaysKey(t, -21) && x.share === undefined && !splittedTx.has(x.id))) {
    if (x.amount >= 2000 && checks.length >= 4 && x.amount >= median * 2) {
      out.push({
        id: `shared?:${x.id}`, tone: "info", icon: "🍽️", priority: 1,
        title: `${x.merchant ?? "Кафе"} ${rub(x.amount)} — это был общий счёт?`,
        text: `Обычно ваш чек до ${rub(median)}. Если платили за компанию — разделите, и модуль сам отметит, когда вам переведут.`,
        tx: x.id,
      });
    }
  }

  // Кэшбэк: недополучено и напоминание выбрать категории на новый месяц
  const accounts = i.states.map((s) => s.account);
  if (current) {
    const cb = cashbackReport(i.txs, accounts, i.month);
    const lost = cb.possible - cb.got;
    if (lost >= 150) {
      const worst = cb.byCategory[0];
      out.push({
        id: `cashback:${i.month}:${Math.round(lost / 100)}`, tone: "save", icon: "🪙", priority: 2,
        title: `Недополучено кэшбэка ≈ ${rub(Math.round(lost))}`,
        text: worst ? `Например, «${worst.category}» выгоднее оплачивать картой ${worst.best.name} — ${worst.percent}%.` : "Платите картой с повышенным кэшбэком в категории.",
        saving: lost * scale, group: "cashback",
      });
    }
    const stale = accounts.filter((a) => !a.archived && a.cashback?.cats.length && a.cashback.month && a.cashback.month < i.month);
    if (stale.length && p.day <= 10) {
      out.push({
        id: `cashback-month:${i.month}`, tone: "info", icon: "🎯", priority: 1,
        title: "Выберите категории кэшбэка на новый месяц",
        text: `${stale.map((a) => a.name).join(", ")} — категории были на прошлый месяц. Выберите в приложении банка и обновите здесь.`,
        to: `/account/${stale[0].id}`,
      });
    }
  }

  // Норма сбережений
  if (!current && ms.income > 0) {
    const rate = (ms.income - ms.spent) / ms.income;
    out.push({
      id: `rate:${i.month}`, tone: rate >= 0.1 ? "good" : "info", icon: rate >= 0.1 ? "💚" : "🐷", priority: 4,
      title: `Отложено ${Math.round(rate * 100)}% дохода`,
      text: rate >= 0.2 ? "Отличный уровень — больше 20 %." : rate >= 0.1 ? "Хороший уровень. Ориентир — 20 %." : "Ориентир — хотя бы 10 %: отложите сразу в день зарплаты, а тратьте остаток.",
    });
  }

  return { insights: out.sort((a, b) => a.priority - b.priority || (b.saving ?? 0) - (a.saving ?? 0)), recurring };
}

const round100 = (n: number) => Math.round(n / 100) * 100;
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
