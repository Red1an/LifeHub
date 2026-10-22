import { DAY, addDays, addYears, daysUntil, fmtDate, ms } from "./dates.ts";
import { num, pct, plural, shortRub } from "./fmt.ts";
import type { Advice } from "./advice.ts";
import { priceAt, type Holding, type Report } from "./analytics.ts";
import { rateCorp } from "./bonds.ts";
import { MODEL, classOf, classSplit, CLASS_SHORT, type AssetClass } from "./health.ts";
import type { Mistakes } from "./mistakes.ts";
import { priceHistory, quotes, resolveSecurity, type OfzRow } from "./moex.ts";
import { assetPerformance } from "./perf.ts";
import { FUND_KIND, SECTORS, referenceDividends } from "./reference.ts";
import type { ScreenerRow } from "./screener.ts";
import { TBankClient } from "./tbank.ts";
import type { TaxYear } from "./tax.ts";
import { type Market, type OtherAsset, type PayEvent, type Portfolio, type PricePoint, type Settings } from "./types.ts";

/*
 * «Проверка перед сделкой»: тормоз для импульсивных решений. Пользователь говорит «хочу купить/продать X на N ₽» —
 * модуль сводит всё, что знает, в короткий ответ «стоит / осторожно / лучше не надо» с причинами:
 * доля после сделки, отрасль и класс против ориентира, цена относительно года, дивиденды и отсечка,
 * налог при продаже и льгота 3 лет, история собственных сделок с этой бумагой и общие привычки.
 * Это правила по данным, а не прогноз цены.
 */

export type Side = "buy" | "sell";
export type Tone = "good" | "info" | "warn" | "bad";

export interface Flag {
  tone: Tone;
  title: string;
  text?: string;
}

export interface CheckResult {
  side: Side;
  id: string;
  ticker: string;
  name: string;
  kind: "share" | "bond" | "etf" | "other";
  /** Цена одной бумаги, ₽. */
  price: number;
  lot: number;
  units: number;
  sum: number;
  fee: number;
  verdict: "go" | "careful" | "stop";
  headline: string;
  flags: Flag[];
  /** Сколько примерно уйдёт налога (продажа). */
  tax?: number;
  next?: string;
}

export interface CheckCtx {
  p: Portfolio;
  market: Market;
  r: Report;
  settings: Settings;
  mistakes: Mistakes;
  advice: Map<string, Advice>;
  screener: ScreenerRow[];
  ofz: OfzRow[];
  corp: OfzRow[];
  keyRate: number;
  tax: TaxYear;
  other: OtherAsset[];
}

const issuerKey = (t: string) => (t.length === 5 && t.toUpperCase().endsWith("P") ? t.slice(0, 4).toUpperCase() : t.toUpperCase());

function findHolding(r: Report, q: string): Holding | undefined {
  const s = q.trim().toUpperCase();
  return (
    r.allRows.find((h) => h.instrument.ticker.toUpperCase() === s || h.instrument.isin?.toUpperCase() === s || h.id.toUpperCase() === s) ??
    r.allRows.find((h) => h.instrument.name.toUpperCase().includes(s))
  );
}

export async function checkTrade(input: { side: Side; query: string; amount?: number; units?: number }, ctx: CheckCtx): Promise<CheckResult> {
  const { p, r, settings: s, keyRate } = ctx;
  const flags: Flag[] = [];
  const add = (tone: Tone, title: string, text?: string) => flags.push({ tone, title, text });

  // 1. Что за бумага
  const held = findHolding(r, input.query);
  let ticker: string;
  let name: string;
  let id: string;
  let market: "shares" | "bonds";
  let board: string | undefined;
  let kind: CheckResult["kind"];
  if (held) {
    ticker = held.instrument.ticker;
    name = held.instrument.name;
    id = held.id;
    market = held.instrument.type === "bond" ? "bonds" : "shares";
    board = held.instrument.board;
    kind = held.instrument.type === "bond" ? "bond" : held.instrument.type === "etf" ? "etf" : held.instrument.type === "share" ? "share" : "other";
  } else {
    const info = await resolveSecurity(input.query);
    if (!info) throw new Error(`Не нашёл «${input.query}» на Мосбирже. Попробуйте тикер (SBER) или ISIN.`);
    ticker = info.secid;
    name = info.shortName;
    id = info.isin ?? info.secid;
    market = info.market === "bonds" ? "bonds" : "shares";
    board = info.board;
    kind = info.assetType === "bond" ? "bond" : info.assetType === "etf" ? "etf" : info.assetType === "share" ? "share" : "other";
  }

  // 2. Цена и лот
  const q = (await quotes([ticker], market))[ticker];
  const price = q?.price ?? held?.price ?? p.lastPrices[id] ?? 0;
  if (!price) throw new Error("Не удалось получить цену с биржи — попробуйте ещё раз чуть позже.");
  const lot = q?.lot ?? held?.instrument.lot ?? 1;
  const lotCost = price * lot;
  const heldQty = held && held.quantity > 0 ? held.quantity : 0;
  let units: number;
  if (input.units) units = input.units;
  else if (input.amount) units = Math.max(lot, Math.floor(input.amount / lotCost) * lot);
  else units = input.side === "sell" ? heldQty : lot;
  if (input.side === "sell") units = Math.min(units, heldQty || units);
  const sum = units * price;

  // Комиссия — по вашей фактической средней ставке
  const turnover = r.transactions.filter((t) => t.type === "buy" || t.type === "sell").reduce((a, t) => a + Math.abs(t.amount), 0);
  const feeRate = turnover > 0 && r.tradeFees > 0 ? Math.min(0.01, r.tradeFees / turnover) : 0.003;
  const fee = sum * feeRate;

  // 3. Цена за год
  let hist: PricePoint[] = ctx.market.prices[id] ?? [];
  if (hist.filter(([d]) => ms(d) > addYears(Date.now(), -1)).length < 20) hist = await priceHistory(ticker, market, board, addDays(Date.now(), -400)).catch(() => []);
  const pts = hist.map(([d, c]) => ({ t: ms(d), c: market === "bonds" ? (c * (held?.instrument.nominal ?? q?.faceValue ?? 1000)) / 100 : c }));
  const year = pts.filter((x) => x.t > addYears(Date.now(), -1)).map((x) => x.c);
  const lo = year.length ? Math.min(...year) : 0;
  const hi = year.length ? Math.max(...year) : 0;
  const pos = hi > lo ? (price - lo) / (hi - lo) : null;
  const p3 = priceAt(pts, addDays(Date.now(), -91));
  const runup = p3 ? price / p3 - 1 : null;

  // 4. Дивиденды
  let divs: PayEvent[] = held ? [...(p.dividendHistory[id] ?? []), ...p.events.filter((e) => e.instrumentId === id && e.kind === "dividend")] : [];
  if (!divs.length && (kind === "share" || kind === "etf")) {
    if (s.tbankToken.trim()) {
      try {
        const tb = new TBankClient(s.tbankToken.trim());
        const uid = held?.instrument.uid ?? (await tb.findUid(ticker));
        if (uid) divs = await tb.dividends(uid, id, "RUB");
      } catch {
        /* справочник ниже */
      }
    }
    if (!divs.length) divs = referenceDividends(ticker, id);
  }
  const now = Date.now();
  const ttm = divs.filter((d) => ms(d.recordDate) <= now && ms(d.recordDate) > addYears(now, -1)).reduce((a, d) => a + d.perUnit, 0);
  const dy = price > 0 ? ttm / price : 0;
  const yearsPaid = new Set(divs.filter((d) => ms(d.recordDate) > addYears(now, -5) && ms(d.recordDate) <= now).map((d) => new Date(ms(d.recordDate)).getFullYear())).size;
  const cut = divs.some((d) => ms(d.recordDate) > addYears(now, -3) && ms(d.recordDate) <= addYears(now, -1)) && !divs.some((d) => ms(d.recordDate) > addYears(now, -1) && ms(d.recordDate) <= now);
  const nextDiv = divs.filter((d) => ms(d.recordDate) >= now).sort((a, b) => ms(a.recordDate) - ms(b.recordDate))[0];
  const keep = 1 - s.taxRate / 100;

  const adv = held ? ctx.advice.get(held.id) : undefined;
  const past = held ? assetPerformance(p, ctx.market, r, null, now, held.id)[0] : undefined;
  let taxDue: number | undefined;
  const recentTrades = r.transactions.filter((t) => (t.type === "buy" || t.type === "sell") && t.t > addDays(now, -30)).length;

  if (input.side === "buy") {
    // Деньги и подушка
    if (r.cashRUB < sum) add("info", `На счетах свободно ${shortRub(Math.max(0, r.cashRUB))}`, `Для покупки нужно ${shortRub(sum + fee)} — придётся пополнить счёт.`);
    if (s.monthlyExpenses > 0) {
      const liquid = ctx.other.filter((a) => a.kind === "deposit" || a.kind === "cash").reduce((a, x) => a + x.amount, 0);
      if (liquid < s.monthlyExpenses * 3) add("warn", "Подушка безопасности меньше 3 месяцев расходов", "Сначала отложите на вклад 3–6 месяцев расходов — иначе в трудный момент придётся продавать бумаги, возможно, в минус.");
    }
    // Доля после покупки
    const total = r.totalValue + Math.max(0, sum - Math.max(0, r.cashRUB));
    const sameIssuer = r.holdings.filter((h) => kind === "share" && h.instrument.type === "share" && issuerKey(h.instrument.ticker) === issuerKey(ticker)).reduce((a, h) => a + h.value, 0) || (held?.value ?? 0);
    const wAfter = (sameIssuer + sum) / total;
    if (kind !== "etf" && !(kind === "bond" && ticker.startsWith("SU"))) {
      if (wAfter > 0.15) add("bad", `Доля станет ${pct(wAfter, { digits: 0 })} портфеля`, "Слишком много денег в одной компании: если с ней что-то случится, пострадает весь портфель. Разумный предел — 8–10 %.");
      else if (wAfter > 0.1) add("warn", `Доля станет ${pct(wAfter, { digits: 0 })} портфеля`, "Это верхняя граница для одной компании. Дальше её лучше не увеличивать.");
      else add("good", `Доля будет ${pct(wAfter)} — в пределах разумного`);
    }
    // Отрасль и класс
    if (kind === "share") {
      const sector = held?.instrument.sector ?? SECTORS[ticker.toUpperCase()];
      const shares = r.holdings.filter((h) => h.instrument.type === "share");
      const sharesValue = shares.reduce((a, h) => a + h.value, 0);
      if (sector && sharesValue > 0) {
        const after = (shares.filter((h) => h.instrument.sector === sector).reduce((a, h) => a + h.value, 0) + sum) / (sharesValue + sum);
        if (after > 0.45) add("warn", `Отрасль «${sector}» станет ${pct(after, { digits: 0 })} ваших акций`, "Бумаги одной отрасли падают вместе. Лучше добавить другую отрасль.");
        else if (after < 0.2) add("good", `Добавляет разнообразия: «${sector}» — ${pct(after, { digits: 0 })} акций`);
      }
    }
    const cls: AssetClass = held ? classOf(held) : kind === "bond" ? "bonds" : kind === "etf" ? (FUND_KIND[ticker.toUpperCase()] === "money" ? "money" : FUND_KIND[ticker.toUpperCase()] === "gold" ? "gold" : FUND_KIND[ticker.toUpperCase()] === "bonds" ? "bonds" : "shares") : "shares";
    const split = classSplit(r);
    const tot = Object.values(split).reduce((a, b) => a + b, 0) + Math.max(0, sum - Math.max(0, r.cashRUB));
    const clsAfter = (split[cls] + sum) / tot;
    const target = MODEL[s.risk][cls];
    if (clsAfter > target + 0.1) add("warn", `${CLASS_SHORT[cls]} станет ${pct(clsAfter, { digits: 0 })} портфеля — ориентир ${pct(target, { digits: 0 })}`, cls === "shares" ? "Для вашего профиля риска акций уже много. Новые деньги разумнее направить в облигации." : undefined);
    else if (split[cls] / (tot - sum) < target - 0.05) add("good", `${CLASS_SHORT[cls]} сейчас меньше ориентира — покупка выравнивает портфель`);
    // Мнение по бумаге, которая уже есть
    if (adv && (adv.verdict === "trim" || adv.verdict === "review")) add("bad", `По правилам: «${adv.verdict === "trim" ? "сократить долю" : "перепроверить"}»`, adv.summary);
    else if (adv && adv.verdict === "nobuy") add("warn", "По правилам: «держать, но не докупать»", adv.summary);
    // Облигации
    if (kind === "bond") {
      const b = [...ctx.ofz, ...ctx.corp].find((x) => x.secid === ticker);
      if (b?.corp) {
        const rated = rateCorp([b], ctx.ofz)[0];
        if (rated.risk === "junk") add("bad", `Рынок сомневается в компании: доходность ${pct(b.yield)}`, `Это на ${num((rated.spread ?? 0) * 100, 0)} п.п. выше ОФЗ того же срока — так бывает при риске дефолта. Если всё же покупать — не больше 1–3 % портфеля.`);
        else if (rated.risk === "high") add("warn", `Повышенный риск: доходность ${pct(b.yield)}`, "Заметно выше ОФЗ — компания рискованнее крупных эмитентов.");
        else add("good", `Доходность ${pct(b.yield)}, премия к ОФЗ небольшая`);
      } else if (b) add(b.yield >= keyRate / 100 ? "good" : "info", `Доходность к погашению ${pct(b.yield)}`, b.yield >= keyRate / 100 ? "Не ниже ключевой ставки, гарантия государства." : "Ниже ключевой ставки — фонд денежного рынка сейчас даёт сопоставимо без риска цены.");
    }
    // Цена
    if (runup != null && runup > 0.25) add("warn", `Выросла на ${pct(runup, { digits: 0 })} за 3 месяца`, "После сильного рывка бумага часто стоит на месте или откатывается. Если покупать — частями, по месяцам.");
    else if (pos != null && pos > 0.85) add("warn", "Цена у максимума за год", `Диапазон за год: ${num(lo, 2)}–${num(hi, 2)} ₽. Дорого относительно года — покупайте частями.`);
    else if (pos != null && pos < 0.2) add("info", "Цена у минимума за год", "Дёшево относительно года — но проверьте новости: падают обычно не просто так.");
    // Дивиденды
    if (kind === "share" || kind === "etf") {
      if (cut) add("bad", "Перестала платить дивиденды", "Раньше платила, а за последний год — ни разу.");
      else if (dy >= keyRate / 100) add("good", `Дивиденды ${pct(dy)} в год — не ниже ключевой ставки`);
      else if (dy > 0.04) add("info", `Дивиденды ${pct(dy)} в год`);
      else if (kind === "share") add("info", "Дивидендов почти нет", "Заработок только на росте цены — для долгосрочного дохода это минус.");
      if (yearsPaid >= 4) add("good", `Платит стабильно: ${yearsPaid} из 5 последних лет`);
      if (nextDiv && daysUntil(nextDiv.recordDate) <= 30) {
        add("info", `Отсечка ${fmtDate(nextDiv.recordDate)}`, `Купите до ${fmtDate(addDays(nextDiv.recordDate, -1))} — получите ≈ ${shortRub(nextDiv.perUnit * units * keep)} на руки. Но после отсечки цена обычно падает на размер дивиденда, а с выплаты удержат налог — «заработать на дивиденде» за пару дней не выйдет.`);
      }
    }
    if (kind === "etf" && FUND_KIND[ticker.toUpperCase()] === "money") add("good", "Фонд денежного рынка", `Хорошее место для денег, которые ждут: ≈ ${num(keyRate, 0)} % годовых, можно продать в любой день.`);
  } else {
    // Продажа
    if (!held || !heldQty) add("bad", "Этой бумаги нет в портфеле", "Продать можно только то, что есть.");
    else {
      const avg = held.cost / held.quantity;
      const gain = (price - avg) * units;
      const iisOnly = Object.keys(held.byAccount).every((a) => p.accounts.find((x) => x.id === a)?.kind === "iis");
      const ldv = held.firstBuy ? addYears(held.firstBuy, 3) : null;
      const ldvPassed = ldv != null && ldv <= now;
      if (gain > 0) {
        const tax = iisOnly || ldvPassed ? 0 : gain * (s.taxRate / 100);
        taxDue = tax;
        if (tax > 0) {
          add("warn", `Налог ≈ ${shortRub(tax)} с прибыли ${shortRub(gain)}`, "Брокер удержит его при выводе денег или в конце года.");
          if (ldv && ldv < addDays(now, 365)) add("warn", `Подождите до ${fmtDate(ldv, { year: "always" })} — налога не будет`, `После 3 лет владения прибыль не облагается. Ждать ${Math.round((ldv - now) / DAY)} дн., экономия ≈ ${shortRub(tax)}.`);
        } else add("good", `Прибыль ${shortRub(gain)} без налога`, iisOnly ? "Бумага на ИИС." : "Владеете больше 3 лет — льгота долгосрочного владения.");
      } else if (gain < 0) {
        const taxable = Math.max(0, ctx.tax.gains - ctx.tax.losses);
        if (taxable > 0 && !iisOnly) add("good", `Убыток ${shortRub(-gain)} уменьшит налог ≈ на ${shortRub(Math.min(-gain, taxable) * (s.taxRate / 100))}`, "В этом году есть прибыльные продажи — убыток их «погасит» (сальдирование).");
        else add("info", `Фиксируете убыток ${shortRub(-gain)}`);
      }
      if (nextDiv && daysUntil(nextDiv.recordDate) <= 30) add("warn", `Через ${daysUntil(nextDiv.recordDate)} дн. отсечка`, `Если подождать до ${fmtDate(nextDiv.recordDate)}, придут дивиденды ≈ ${shortRub(nextDiv.perUnit * units * keep)} на руки.`);
      // Паника
      const idx = (ctx.market.benchmarks.IMOEX ?? []).map(([d, c]) => ({ t: ms(d), c }));
      const m0 = priceAt(idx, addDays(now, -60));
      const m1 = idx.length ? idx[idx.length - 1].c : null;
      const marketDrop = m0 && m1 ? m1 / m0 - 1 : 0;
      const panicCount = ctx.mistakes.sells.filter((x) => x.panic).length;
      if (marketDrop < -0.1 && gain < 0) add("bad", `Рынок упал на ${pct(-marketDrop, { digits: 0 })} за 2 месяца`, `Продажа в минус на общем падении — классическая ошибка: убыток фиксируется, а отскок проходит без вас.${panicCount ? ` У вас уже ${panicCount} таких продаж.` : ""}`);
      else if (pos != null && pos < 0.2 && gain < 0) add("warn", "Продаёте у минимума за год", "Если причина владения не изменилась, дно — худший момент для продажи.");
      if (adv?.verdict === "trim") add("good", "Доля слишком большая — продажа части уместна", adv.summary);
      else if (adv?.verdict === "review") add("info", "По правилам бумагу стоит перепроверить", adv.summary);
      else if (adv && (adv.verdict === "buy" || adv.verdict === "hold") && (kind === "share" || kind === "bond")) add("warn", `По правилам: «${adv.verdict === "buy" ? "можно докупать" : "держать"}»`, `${adv.summary} Для долгосрочного портфеля продавать хорошую бумагу без причины — значит терять будущие выплаты.`);
      const early = ctx.mistakes.lessons.find((l) => l.id === "sold-early");
      if (early) add("info", "Раньше вы часто продавали рано", early.text);
    }
  }

  // Общие привычки и история с этой бумагой
  if (past && past.trades >= 3) {
    const tone: Tone = past.result < 0 && past.trades >= 6 ? "warn" : "info";
    add(tone, `Вы уже совершили ${past.trades} ${plural(past.trades, ["сделку", "сделки", "сделок"])} с этой бумагой`, `Итог за всё время ${past.result >= 0 ? "+" : "−"}${shortRub(Math.abs(past.result))}${past.ret != null ? ` (${pct(past.ret, { signed: true, digits: 0 })})` : ""}.${tone === "warn" ? " Частые входы и выходы в неё пока не окупались." : ""}`);
  }
  if (recentTrades >= 10) add("warn", `За последний месяц уже ${recentTrades} сделок`, `Для долгосрочного накопления это много: каждая сделка — комиссия (≈ ${pct(feeRate, { digits: 2 })}) и, при продаже в плюс, налог. Ваши комиссии за сделки за всё время — ${shortRub(r.tradeFees)}.`);
  add("info", `Комиссия ≈ ${shortRub(fee)}`, `По вашей средней ставке ${pct(feeRate, { digits: 2 })} от суммы.`);

  const bad = flags.filter((f) => f.tone === "bad").length;
  const warn = flags.filter((f) => f.tone === "warn").length;
  const good = flags.filter((f) => f.tone === "good").length;
  const verdict: CheckResult["verdict"] = bad ? "stop" : warn >= 2 || (warn && good === 0) ? "careful" : warn ? "careful" : "go";
  const headline =
    input.side === "buy"
      ? verdict === "go" ? "Покупка выглядит разумно" : verdict === "careful" ? "Можно, но есть оговорки" : "Лучше не покупать — или сильно меньше"
      : verdict === "go" ? "Продажа выглядит обоснованной" : verdict === "careful" ? "Подумайте ещё раз перед продажей" : "Лучше не продавать сейчас";
  const order: Record<Tone, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  flags.sort((a, b) => order[a.tone] - order[b.tone]);
  const nextStep =
    input.side === "sell" && verdict !== "stop" ? `Вырученные ${shortRub(sum - fee)} не оставляйте лежать: если не знаете, что купить, — в фонд денежного рынка (LQDT).` : undefined;
  return { side: input.side, id, ticker, name, kind, price, lot, units, sum, fee, verdict, headline, flags, tax: taxDue, next: nextStep };
}

export const VERDICT_STYLE: Record<CheckResult["verdict"], { icon: string; color: string; soft: string }> = {
  go: { icon: "✅", color: "var(--inv-green)", soft: "var(--inv-green-soft)" },
  careful: { icon: "⚠️", color: "var(--inv-orange)", soft: "var(--inv-orange-soft)" },
  stop: { icon: "🛑", color: "var(--inv-red)", soft: "var(--inv-red-soft)" },
};
