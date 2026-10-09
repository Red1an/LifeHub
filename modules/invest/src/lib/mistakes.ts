import { DAY, addDays, addYears, fmtDate, ms } from "./dates.ts";
import { pct, plural, shortRub } from "./fmt.ts";
import { makePriceLookup, priceAt, sameMoneyInIndex, type Report } from "./analytics.ts";
import { normCurrency, type Market, type Portfolio, type Settings } from "./types.ts";

/*
 * «Что я делал не так»: разбор истории операций задним числом.
 * Это не упрёк — рынок непредсказуем. Цель — увидеть повторяющиеся привычки, которые стоят денег.
 */

export interface Lesson {
  id: string;
  tone: "bad" | "warn" | "good" | "info";
  title: string;
  text: string;
  /** Сумма «цены» привычки, ₽ (положительная — потеряно/недополучено). */
  amount?: number;
  lesson: string;
  examples?: { id?: string; name: string; date: number; detail: string }[];
}

export interface Mistakes {
  lessons: Lesson[];
  sells: SellReview[];
  stats: { buys: number; sells: number; turnover: number | null; years: number };
}

export interface SellReview {
  id: string;
  instrumentId: string;
  name: string;
  ticker: string;
  t: number;
  quantity: number;
  sellPrice: number;
  /** Цена сейчас (или на дату погашения). */
  priceNow: number | null;
  /** Сколько бы стоили проданные бумаги сейчас минус выручка, ₽. Плюс — продали рано. */
  missed: number | null;
  realized: number;
  heldDays: number;
  taxPaid: number;
  panic: boolean;
  /** Продажа на ИИС — налог не удерживается сразу. */
  iis: boolean;
}

export function buildMistakes(p: Portfolio, market: Market, r: Report, s: Settings, today = Date.now()): Mistakes {
  const txs = r.transactions;
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const price = makePriceLookup(p, market);
  const name = (id: string) => p.instruments[id]?.name ?? id;
  const tax = s.taxRate / 100;
  const iis = new Set(p.accounts.filter((a) => a.kind === "iis").map((a) => a.id));
  const bench = (market.benchmarks.IMOEX ?? market.benchmarks[s.benchmark] ?? []).map(([d, c]) => ({ t: ms(d), c })).sort((a, b) => a.t - b.t);
  const lessons: Lesson[] = [];

  // Разбор продаж: средняя цена и дата первой покупки по (счёт, бумага)
  const lots: Record<string, { qty: number; cost: number; first: number }> = {};
  const sells: SellReview[] = [];
  let buys = 0;
  let turnover = 0;
  for (const t of txs) {
    if (!t.instrumentId) continue;
    const key = `${t.accountId}|${t.instrumentId}`;
    const lot = (lots[key] ??= { qty: 0, cost: 0, first: t.t });
    if (t.type === "buy") {
      if (lot.qty <= 1e-9) lot.first = t.t;
      lot.qty += t.quantity;
      lot.cost += Math.abs(t.amount) + t.fee;
      buys++;
      turnover += Math.abs(t.amount) * fx(t.currency);
    } else if (t.type === "sell" && t.quantity > 0) {
      const avg = lot.qty > 0 ? lot.cost / lot.qty : 0;
      const q = Math.min(t.quantity, Math.max(lot.qty, 0));
      const realized = (Math.abs(t.amount) - t.fee - avg * q) * fx(t.currency);
      const heldDays = Math.round((t.t - lot.first) / DAY);
      const inst = p.instruments[t.instrumentId];
      const isBond = inst?.type === "bond";
      const now = r.holdings.find((h) => h.id === t.instrumentId)?.price ?? p.lastPrices[t.instrumentId] ?? price(t.instrumentId, today);
      const sellPrice = t.price || Math.abs(t.amount) / t.quantity;
      const missed = now != null && !isBond ? (now - sellPrice) * t.quantity * fx(t.currency) : null;
      // Продажа на панике: в минус, после падения рынка больше чем на 10 % за 2 месяца
      let panic = false;
      if (realized < 0 && bench.length) {
        const b0 = priceAt(bench, addDays(t.t, -60));
        const b1 = priceAt(bench, t.t);
        panic = !!b0 && !!b1 && b1 / b0 - 1 < -0.1;
      }
      const taxable = !iis.has(t.accountId) && realized > 0 && heldDays < 3 * 365;
      sells.push({
        id: t.id, instrumentId: t.instrumentId, name: name(t.instrumentId), ticker: inst?.ticker ?? t.instrumentId, t: t.t, quantity: t.quantity, sellPrice, priceNow: now ?? null,
        missed, realized, heldDays, taxPaid: taxable ? realized * tax : 0, panic, iis: iis.has(t.accountId),
      });
      turnover += Math.abs(t.amount) * fx(t.currency);
      lot.cost -= avg * q;
      lot.qty -= t.quantity;
      if (lot.qty <= 1e-9) {
        lot.qty = 0;
        lot.cost = 0;
      }
    }
  }
  sells.sort((a, b) => b.t - a.t);

  // 1. Продали рано / вовремя
  const reviewed = sells.filter((x) => x.missed != null && x.t < addDays(today, -30));
  if (reviewed.length) {
    const early = reviewed.filter((x) => x.missed! > Math.max(1000, x.quantity * x.sellPrice * 0.15));
    const wise = reviewed.filter((x) => x.missed! < -Math.max(1000, x.quantity * x.sellPrice * 0.15));
    const missedSum = early.reduce((a, x) => a + x.missed!, 0);
    const savedSum = -wise.reduce((a, x) => a + x.missed!, 0);
    if (early.length > wise.length && missedSum > 5000) {
      lessons.push({
        id: "sold-early",
        tone: "warn",
        title: `Продавали слишком рано: ${early.length} из ${reviewed.length} ${plural(reviewed.length, ["продажи", "продаж", "продаж"])}`,
        text: `После продажи эти бумаги выросли. Если бы вы их держали, сейчас у вас было бы на ${shortRub(missedSum)} больше${savedSum > 0 ? `. Зато ${wise.length} ${plural(wise.length, ["продажа", "продажи", "продаж"])} уберегли ${shortRub(savedSum)}` : ""}.`,
        amount: missedSum,
        lesson: "Продавайте, когда изменилась причина покупки (компания перестала платить, ухудшился бизнес), а не потому что «уже заработал» или «страшно».",
        examples: early.sort((a, b) => b.missed! - a.missed!).slice(0, 5).map((x) => ({
          id: x.instrumentId, name: x.name, date: x.t,
          detail: `продали по ${x.sellPrice.toFixed(2)}, сейчас ${x.priceNow?.toFixed(2)} · упущено ${shortRub(x.missed!)}`,
        })),
      });
    } else if (wise.length >= early.length && savedSum > 5000) {
      lessons.push({
        id: "sold-wisely",
        tone: "good",
        title: `Продажи в целом удачные`,
        text: `${wise.length} из ${reviewed.length} проданных бумаг потом подешевели — вы сберегли ${shortRub(savedSum)}${missedSum > 0 ? `, а упустили на других ${shortRub(missedSum)}` : ""}.`,
        lesson: "Продолжайте продавать по причинам, а не по эмоциям.",
      });
    }
  }

  // 2. Продажи на панике
  const panic = sells.filter((x) => x.panic);
  if (panic.length) {
    const loss = -panic.reduce((a, x) => a + x.realized, 0);
    const after = panic.filter((x) => x.missed != null && x.missed > 0).reduce((a, x) => a + x.missed!, 0);
    lessons.push({
      id: "panic",
      tone: "bad",
      title: `${panic.length} ${plural(panic.length, ["продажа", "продажи", "продаж"])} в убыток на падении рынка`,
      text: `Вы продали с убытком ${shortRub(loss)} в момент, когда весь рынок падал больше чем на 10 %.${after > 0 ? ` После этого бумаги отросли — упущено ещё ${shortRub(after)}.` : ""}`,
      amount: loss + after,
      lesson: "На общем падении рынка продажа фиксирует убыток, а отскок проходит без вас. Заранее держите в портфеле облигации — на просадке их можно продать и докупить акции дёшево.",
      examples: panic.slice(0, 5).map((x) => ({ id: x.instrumentId, name: x.name, date: x.t, detail: `убыток ${shortRub(-x.realized)}` })),
    });
  }

  // 3. Лишний налог: прибыльные продажи раньше 3 лет
  const taxed = sells.filter((x) => x.taxPaid > 0);
  const taxSum = taxed.reduce((a, x) => a + x.taxPaid, 0);
  if (taxSum > 2000) {
    lessons.push({
      id: "tax-ldv",
      tone: "warn",
      title: `≈ ${shortRub(taxSum)} налога с продаж раньше 3 лет`,
      text: `${taxed.length} ${plural(taxed.length, ["продажа", "продажи", "продаж"])} с прибылью — бумаги держали меньше 3 лет, поэтому с прибыли удержан НДФЛ ${s.taxRate} %. При владении от 3 лет налога не было бы (льгота долгосрочного владения, до 3 млн ₽ прибыли за каждый год владения).`,
      amount: taxSum,
      lesson: "Перед продажей с прибылью проверьте дату покупки. Если до 3 лет осталось несколько месяцев — часто выгоднее подождать. И продавайте убыточные бумаги в том же году, что и прибыльные: убыток уменьшит налог.",
      examples: taxed.sort((a, b) => b.taxPaid - a.taxPaid).slice(0, 5).map((x) => ({ id: x.instrumentId, name: x.name, date: x.t, detail: `держали ${Math.round(x.heldDays / 30)} мес. · налог ≈ ${shortRub(x.taxPaid)}` })),
    });
  }

  // 4. Покупки на пике: цена в верхних 10 % диапазона за год до покупки
  const buyReviews: { id: string; name: string; t: number; pos: number; runup: number; overpay: number }[] = [];
  for (const t of txs) {
    if (t.type !== "buy" || !t.instrumentId || t.price <= 0) continue;
    const inst = p.instruments[t.instrumentId];
    if (inst?.type !== "share") continue;
    const year: number[] = [];
    for (let d = addDays(t.t, -364); d <= t.t; d = addDays(d, 7)) {
      const v = price(t.instrumentId, d);
      if (v != null) year.push(v);
    }
    if (year.length < 30) continue;
    const lo = Math.min(...year);
    const hi = Math.max(...year);
    if (hi <= lo) continue;
    const pos = (t.price - lo) / (hi - lo);
    const p90 = price(t.instrumentId, addDays(t.t, -91));
    const runup = p90 ? t.price / p90 - 1 : 0;
    const avg = year.reduce((a, x) => a + x, 0) / year.length;
    buyReviews.push({ id: t.instrumentId, name: name(t.instrumentId), t: t.t, pos, runup, overpay: Math.max(0, (t.price - avg) * t.quantity * fx(t.currency)) });
  }
  if (buyReviews.length >= 5) {
    const atTop = buyReviews.filter((b) => b.pos > 0.9);
    const chased = buyReviews.filter((b) => b.runup > 0.3);
    const share = atTop.length / buyReviews.length;
    if (share > 0.3) {
      lessons.push({
        id: "buy-high",
        tone: "warn",
        title: `${pct(share, { digits: 0 })} покупок акций — у годового максимума`,
        text: `${atTop.length} из ${buyReviews.length} покупок сделаны, когда цена была в верхних 10 % своего диапазона за год. Против средней цены за год это переплата около ${shortRub(atTop.reduce((a, b) => a + b.overpay, 0))}.`,
        amount: atTop.reduce((a, b) => a + b.overpay, 0),
        lesson: "Хорошие новости и рост цены притягивают покупки, но дешевле покупать регулярно одной суммой или докупать на просадках. Список «Идей» подскажет, что сейчас ниже своей обычной цены.",
        examples: atTop.slice(-5).reverse().map((b) => ({ id: b.id, name: b.name, date: b.t, detail: `у максимума за год${b.runup > 0.1 ? ` · +${Math.round(b.runup * 100)} % за 3 мес. до покупки` : ""}` })),
      });
    } else if (share < 0.15) {
      lessons.push({ id: "buy-high", tone: "good", title: "Не гонитесь за ростом", text: `Только ${atTop.length} из ${buyReviews.length} покупок — у годового максимума. Вы покупаете спокойно, не на ажиотаже.`, lesson: "Так и продолжайте." });
    }
    if (chased.length >= 3 && chased.length / buyReviews.length > 0.2) {
      lessons.push({
        id: "chase",
        tone: "info",
        title: `${chased.length} ${plural(chased.length, ["покупка", "покупки", "покупок"])} после роста больше 30 % за 3 месяца`,
        text: "Покупка после сильного рывка — ставка на то, что рост продолжится. Часто после рывка бумага долго стоит или откатывается.",
        lesson: "Перед покупкой посмотрите график за год: если бумага резко выросла, разбейте покупку на 3–4 части по месяцам.",
      });
    }
  }

  // 5. Слишком частые сделки
  const firstT = txs[0]?.t ?? today;
  const years = Math.max((today - firstT) / (365.25 * DAY), 0.25);
  const avgValue = r.history.length ? r.history.reduce((a, h) => a + h.value, 0) / r.history.length : r.totalValue;
  const annualTurnover = avgValue > 0 ? turnover / years / avgValue : null;
  if (annualTurnover != null && annualTurnover > 1.5 && sells.length > 10) {
    lessons.push({
      id: "overtrading",
      tone: "warn",
      title: `Оборот ${pct(annualTurnover, { digits: 0 })} портфеля в год`,
      text: `Вы покупаете и продаёте на сумму в ${annualTurnover.toFixed(1)} раза больше портфеля каждый год. Комиссии за сделки — ${shortRub(r.tradeFees)}, плюс налог с каждой прибыльной продажи.`,
      amount: r.tradeFees,
      lesson: "Исследования (Barber & Odean) раз за разом показывают: чем чаще частный инвестор торгует, тем ниже его доходность. Меньше сделок — больше денег.",
    });
  }

  // 6. Деньги без дела на счетах
  const cashWeeks = cashSeries(r, fx);
  if (cashWeeks.length > 12) {
    const avgShare = cashWeeks.reduce((a, c) => a + c.share, 0) / cashWeeks.length;
    const avgCash = cashWeeks.reduce((a, c) => a + c.cash, 0) / cashWeeks.length;
    if (avgShare > 0.1 && avgCash > 20_000) {
      const lost = avgCash * (s.riskFreeRate / 100) * years;
      lessons.push({
        id: "idle-history",
        tone: "warn",
        title: `В среднем ${pct(avgShare, { digits: 0 })} денег лежали без дела`,
        text: `Обычно на счетах было около ${shortRub(avgCash)} свободных денег. В фонде денежного рынка они принесли бы примерно ${shortRub(lost)} за всё время.`,
        amount: lost,
        lesson: "Деньги, которые ждут покупки, держите в фонде денежного рынка (LQDT, AKMM): он растёт каждый день примерно на ключевую ставку и продаётся в любой момент.",
      });
    }
  }

  // 7. Регулярность пополнений
  const deposits = txs.filter((t) => t.type === "deposit");
  if (deposits.length >= 3 && years >= 1) {
    const months = new Set(deposits.map((t) => t.date.slice(0, 7))).size;
    const first = new Date(deposits[0].t);
    const now = new Date(today);
    const total = Math.max(months, (now.getFullYear() - first.getFullYear()) * 12 + now.getMonth() - first.getMonth() + 1);
    const reg = months / total;
    if (reg < 0.5) {
      lessons.push({
        id: "irregular",
        tone: "info",
        title: `Пополняли только в ${months} из ${total} месяцев`,
        text: "Крупные разовые пополнения легко приходятся на дорогой рынок. Регулярные покупки одной суммой сами усредняют цену.",
        lesson: "Настройте автопополнение в день зарплаты — даже небольшой суммы.",
      });
    } else if (reg > 0.8) {
      lessons.push({ id: "irregular", tone: "good", title: `Регулярно пополняете — ${months} из ${total} месяцев`, text: "Это главная привычка, от которой зависит результат на длинном горизонте.", lesson: "Продолжайте." });
    }
  }

  // 8. А если бы просто покупали индекс
  const idx = sameMoneyInIndex(r, market.benchmarks[s.benchmark]);
  if (idx && years >= 1) {
    const diff = r.totalValue - idx.value;
    lessons.push({
      id: "vs-index",
      tone: diff >= 0 ? "good" : Math.abs(diff) > r.totalValue * 0.05 ? "bad" : "info",
      title: diff >= 0 ? `Вы обыграли индекс на ${shortRub(diff)}` : `Индекс ${s.benchmark} принёс бы на ${shortRub(-diff)} больше`,
      text: `Если бы те же деньги в те же дни вы вкладывали в индекс ${s.benchmark} (с дивидендами), портфель стоил бы ${shortRub(idx.value)} — у вас ${shortRub(r.totalValue)}.${idx.xirr != null && r.xirr != null ? ` Доходность в год: индекс ${pct(idx.xirr)}, вы ${pct(r.xirr)}.` : ""}`,
      amount: diff < 0 ? -diff : undefined,
      lesson: diff >= 0 ? "Выбор бумаг пока себя оправдывает. Проверяйте это раз в год." : "Большинство частных инвесторов проигрывает индексу. Простая стратегия — основа в фонде на индекс, свои идеи — на 20–30 % портфеля.",
    });
  }

  // 9. Отмены дивидендов у купленных бумаг — информативно
  const cut = r.holdings.filter((h) => {
    const hist = p.dividendHistory[h.id] ?? [];
    const lastYear = hist.filter((e) => ms(e.payDate) > addYears(today, -1)).length;
    const before = hist.filter((e) => ms(e.payDate) > addYears(today, -3) && ms(e.payDate) <= addYears(today, -1)).length;
    return h.instrument.type === "share" && before > 0 && lastYear === 0 && h.weight > 0.02;
  });
  if (cut.length) {
    lessons.push({
      id: "div-cut",
      tone: "info",
      title: `${cut.length} ${plural(cut.length, ["компания", "компании", "компаний"])} перестали платить дивиденды`,
      text: "Раньше платили, а за последний год — ни разу. Если вы покупали их ради дивидендов, причина покупки изменилась.",
      lesson: "Проверьте новости по каждой: это пауза или отказ от выплат надолго?",
      examples: cut.map((h) => ({ id: h.id, name: h.instrument.name, date: today, detail: pct(h.weight) + " портфеля" })),
    });
  }

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  lessons.sort((a, b) => order[a.tone] - order[b.tone] || (b.amount ?? 0) - (a.amount ?? 0));
  return { lessons, sells, stats: { buys, sells: sells.length, turnover: annualTurnover, years } };
}

/** Свободные деньги по неделям (счета с историей пополнений). */
function cashSeries(r: Report, fx: (c: string) => number): { t: number; cash: number; share: number }[] {
  const depAcc = new Set(r.transactions.filter((t) => t.type === "deposit" || t.type === "withdrawal").map((t) => t.accountId));
  const out: { t: number; cash: number; share: number }[] = [];
  let cash = 0;
  let i = 0;
  const txs = r.transactions;
  for (const pt of r.history) {
    while (i < txs.length && txs[i].t < addDays(pt.t, 1)) {
      const t = txs[i];
      if (depAcc.has(t.accountId)) cash += (t.amount - t.fee) * fx(t.currency);
      i++;
    }
    if (pt.value > 1000) out.push({ t: pt.t, cash: Math.max(0, cash), share: Math.max(0, cash) / pt.value });
  }
  return out;
}

