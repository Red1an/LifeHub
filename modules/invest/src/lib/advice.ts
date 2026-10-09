import { addDays, addYears, daysUntil, fmtDate, ms } from "./dates.ts";
import { num, pct, shortRub } from "./fmt.ts";
import { profitOf, profitPctOf, yieldOf, type Holding, type Report } from "./analytics.ts";
import { heldBondNote, rateCorp } from "./bonds.ts";
import { MODEL, classOf, classSplit } from "./health.ts";
import type { OfzRow } from "./moex.ts";
import { FUND_KIND } from "./reference.ts";
import type { ScreenerRow } from "./screener.ts";
import type { Market, Portfolio, Settings } from "./types.ts";

/*
 * «Что делать с этой бумагой»: вердикт по понятным правилам + оценка по пяти направлениям
 * (как «снежинка» Simply Wall St, но с учётом вашего портфеля). Не прогноз цены, а проверка:
 * не слишком ли её много, платит ли она, не подешевела ли причина владения, что с налогом.
 */

export type Verdict = "buy" | "hold" | "nobuy" | "trim" | "review";

export const VERDICT: Record<Verdict, { title: string; short: string; tag: string; icon: string }> = {
  buy: { title: "Можно докупать", short: "Докупать", tag: "inv-tag-green", icon: "➕" },
  hold: { title: "Держать", short: "Держать", tag: "inv-tag-blue", icon: "✋" },
  nobuy: { title: "Держать, но не докупать", short: "Не докупать", tag: "inv-tag-gold", icon: "⏸" },
  trim: { title: "Сократить долю", short: "Сократить", tag: "inv-tag-orange", icon: "✂️" },
  review: { title: "Перепроверить причину владения", short: "Проверить", tag: "inv-tag-red", icon: "🔍" },
};

export interface ScorePart {
  name: string;
  /** 0–5 */
  score: number;
  note: string;
}

export interface Advice {
  verdict: Verdict;
  summary: string;
  pros: string[];
  cons: string[];
  steps: string[];
  scores: ScorePart[];
}

export interface AdviceCtx {
  p: Portfolio;
  market: Market;
  r: Report;
  settings: Settings;
  screener: ScreenerRow[];
  bonds: OfzRow[];
  /** Корпоративные облигации с биржи (для оценки риска тех, что уже есть). */
  corp: OfzRow[];
  keyRate: number;
}

const issuerKey = (t: string) => (t.length === 5 && t.toUpperCase().endsWith("P") ? t.slice(0, 4).toUpperCase() : t.toUpperCase());

/** Положение цены в годовом диапазоне: 0 — у минимума, 1 — у максимума. */
export function yearRange(market: Market, id: string): { pos: number; lo: number; hi: number } | null {
  const pts = (market.prices[id] ?? []).filter(([d]) => ms(d) > addYears(Date.now(), -1)).map(([, c]) => c);
  if (pts.length < 20) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  if (hi <= lo) return null;
  return { pos: (pts[pts.length - 1] - lo) / (hi - lo), lo, hi };
}

export function adviceFor(h: Holding, ctx: AdviceCtx): Advice {
  const { p, market, r, settings, keyRate } = ctx;
  const inst = h.instrument;
  const cls = classOf(h);
  const pros: string[] = [];
  const cons: string[] = [];
  const steps: string[] = [];
  const scores: ScorePart[] = [];
  const total = r.totalValue || 1;
  const split = classSplit(r);
  const target = MODEL[settings.risk];
  const clsShare = split[cls] / total;
  const clsOver = clsShare - target[cls];
  const tax = settings.taxRate / 100;
  const profit = profitOf(h);
  const ldv = h.firstBuy ? addYears(h.firstBuy, 3) : null;
  const ldvSoon = ldv && ldv > Date.now() && ldv < addDays(Date.now(), 200) && profit > 0;
  const taxNow = profit > 0 && !(ldv && ldv <= Date.now()) ? profit * tax : 0;
  const nextRecord = r.upcoming.find((u) => u.instrument.id === h.id && u.event.kind === "dividend" && daysUntil(u.event.recordDate) >= 0);

  /* ── облигации ── */
  if (inst.type === "bond") {
    const b = ctx.bonds.find((x) => x.secid === inst.ticker) ?? ctx.corp.find((x) => x.secid === inst.ticker);
    // Корпоративная облигация, в которой рынок сомневается: высокая доходность — это цена риска дефолта
    const rated = b?.corp ? rateCorp([b], ctx.bonds)[0] : null;
    if (rated && (rated.risk === "junk" || rated.risk === "high")) {
      const junk = rated.risk === "junk";
      return {
        verdict: junk ? "review" : "nobuy",
        summary: junk
          ? `Рынок сильно сомневается в компании: доходность ${pct(b!.yield)} — на ${num((rated.spread ?? 0) * 100, 0)} п.п. выше ОФЗ того же срока. Так бывает, когда опасаются, что компания не расплатится.`
          : `Доходность ${pct(b!.yield)} заметно выше ОФЗ — повышенный риск компании.`,
        pros: [`высокий купон: ${pct(b!.couponPct ?? b!.yield)} годовых`],
        cons: [junk ? "риск дефолта: выплаты могут задержаться или не прийти" : "компания рискованнее крупных эмитентов", ...(profitPctOf(h) < -0.05 ? [`цена уже упала на ${pct(-profitPctOf(h), { digits: 0 })} с покупки`] : [])],
        steps: junk
          ? [
              "Не докупайте. Решите, готовы ли вы держать до погашения, понимая риск.",
              "Почитайте новости компании и рейтинговых агентств (АКРА, Эксперт РА).",
              `Держите на одного такого эмитента не больше 1–3 % портфеля (сейчас ${pct(h.weight)}).`,
              ...(profit < 0 ? [`Если продадите, убыток ${shortRub(-profit)} уменьшит налог с прибыльных продаж этого года.`] : []),
            ]
          : ["Держите, но не увеличивайте долю: на одну такую компанию — не больше 3–5 % портфеля."],
        scores,
      };
    }
    const note = heldBondNote(b, keyRate, inst.maturityDate);
    pros.push("купоны и возврат номинала известны заранее");
    if (b && b.yield > keyRate / 100) pros.push(`доходность к погашению ${pct(b.yield)} — выше ключевой ставки`);
    if (profitPctOf(h) < -0.05) cons.push(`цена ниже покупки на ${pct(-profitPctOf(h), { digits: 0 })} — это не потеря, если держать до погашения: вернут номинал`);
    if (clsOver < -0.05) pros.push("облигаций в портфеле меньше ориентира — их можно добавлять");
    steps.push(note);
    if (inst.maturityDate && ms(inst.maturityDate) < addDays(Date.now(), 120)) steps.push("Подходящие замены — в «Идеях» → «Облигации».");
    return { verdict: clsOver < -0.05 ? "buy" : "hold", summary: note, pros, cons, steps, scores };
  }

  /* ── фонды ── */
  if (inst.type === "etf") {
    const kind = FUND_KIND[inst.ticker.toUpperCase()] ?? (cls === "money" ? "money" : cls === "gold" ? "gold" : cls === "bonds" ? "bonds" : "shares");
    if (kind === "money") {
      const s = `Фонд денежного рынка: растёт каждый день примерно на ключевую ставку (${keyRate} %). Это место для свободных денег.`;
      steps.push("Когда решите что-то купить, продавайте сначала его — он почти не колеблется и налог с него небольшой.");
      return { verdict: "hold", summary: s, pros: ["почти без риска", "можно продать в любой день"], cons: ["в долгую обычно уступает акциям"], steps, scores };
    }
    if (kind === "gold") {
      const over = clsShare > target.gold + 0.05;
      return {
        verdict: over ? "nobuy" : clsShare < target.gold - 0.03 ? "buy" : "hold",
        summary: `Золото — страховка от падения рубля и рынка. Сейчас ${pct(clsShare, { digits: 0 })} портфеля при ориентире ${pct(target.gold, { digits: 0 })}.`,
        pros: ["двигается не так, как акции"],
        cons: ["само по себе дохода не приносит"],
        steps: [over ? "Хватит — новые деньги направляйте в другие классы." : "Держите 5–10 % портфеля."],
        scores,
      };
    }
    const sharesOver = split.shares / total - target.shares;
    return {
      verdict: kind === "shares" ? (sharesOver > 0.1 ? "nobuy" : "buy") : "hold",
      summary: kind === "shares" ? "Фонд на много компаний сразу — простая основа портфеля без выбора отдельных бумаг." : "Фонд облигаций: набор облигаций в одной покупке.",
      pros: ["разнообразие в одной покупке"],
      cons: ["комиссия управляющего (обычно до 1 % в год) уже в цене"],
      steps: [kind === "shares" && sharesOver > 0.1 ? "Акций у вас больше ориентира — пока не докупайте." : "Хорошая бумага для регулярных пополнений."],
      scores,
    };
  }

  if (inst.type !== "share") return { verdict: "hold", summary: "Для этого вида бумаг правил пока нет — держите и следите сами.", pros, cons, steps, scores };

  /* ── акции ── */
  // Доля компании (обычка + префы вместе)
  const key = issuerKey(inst.ticker);
  const issuerW = r.holdings.filter((x) => x.instrument.type === "share" && issuerKey(x.instrument.ticker) === key).reduce((a, x) => a + x.weight, 0);
  const shareHoldings = r.holdings.filter((x) => x.instrument.type === "share");
  const sharesValue = shareHoldings.reduce((a, x) => a + x.value, 0) || 1;
  const sector = inst.sector ?? "—";
  const sectorShare = shareHoldings.filter((x) => (x.instrument.sector ?? "—") === sector).reduce((a, x) => a + x.value, 0) / sharesValue;

  // 1. Вес в портфеле
  const wScore = issuerW > 0.15 ? 0 : issuerW > 0.1 ? 1 : issuerW > 0.06 ? 3 : 5;
  scores.push({ name: "Доля в портфеле", score: wScore, note: `${pct(issuerW)} портфеля${issuerW > 0.1 ? " — много" : ""}` });
  if (issuerW > 0.1) cons.push(`компания весит ${pct(issuerW, { digits: 0 })} портфеля — больше разумных 8–10 %`);
  else if (issuerW < 0.04) pros.push(`доля небольшая (${pct(issuerW)}) — есть куда расти`);
  if (sectorShare > 0.4 && sector !== "—") cons.push(`отрасль «${sector}» — уже ${pct(sectorShare, { digits: 0 })} ваших акций`);

  // 2. Дивиденды
  const y = yieldOf(h);
  const hist = p.dividendHistory[h.id] ?? [];
  const paidYears = new Set(hist.filter((e) => ms(e.payDate) > addYears(Date.now(), -5)).map((e) => new Date(ms(e.payDate)).getFullYear())).size;
  const lastYear = hist.filter((e) => ms(e.payDate) > addYears(Date.now(), -1)).length;
  const before = hist.filter((e) => ms(e.payDate) > addYears(Date.now(), -3) && ms(e.payDate) <= addYears(Date.now(), -1)).length;
  const k = keyRate / 100;
  scores.push({ name: "Дивиденды", score: Math.round(Math.min(5, (y / Math.max(k, 0.08)) * 5)), note: y > 0 ? `${pct(y)} в год до налога` : "не платит" });
  scores.push({ name: "Стабильность выплат", score: Math.min(5, paidYears), note: `платила ${paidYears} из 5 лет` });
  if (y >= k) pros.push(`дивиденды ${pct(y)} — не ниже ключевой ставки`);
  else if (y > 0.05) pros.push(`дивиденды ${pct(y)} в год`);
  else if (y === 0) cons.push("сейчас не платит дивидендов — заработок только на росте цены");
  if (paidYears >= 4) pros.push(`платит стабильно: ${paidYears} из 5 последних лет`);
  const cut = before > 0 && lastYear === 0;
  if (cut) cons.push("раньше платила, а за последний год — ни разу");

  // 3. Цена относительно года
  const rng = yearRange(market, h.id);
  if (rng) {
    scores.push({ name: "Цена сейчас", score: Math.round((1 - rng.pos) * 5), note: rng.pos < 0.25 ? "у минимума за год" : rng.pos > 0.8 ? "у максимума за год" : "в середине годового диапазона" });
    if (rng.pos < 0.2) pros.push("цена у минимума за год — если причина покупки в силе, момент для докупки неплохой");
    if (rng.pos > 0.85) cons.push("цена у максимума за год — докупать лучше частями");
  }

  // 4. Ваш результат
  const pp = profitPctOf(h);
  scores.push({ name: "Ваш результат", score: pp > 0.3 ? 5 : pp > 0.1 ? 4 : pp > -0.05 ? 3 : pp > -0.25 ? 2 : pp > -0.4 ? 1 : 0, note: `${pct(pp, { signed: true })} с покупки${h.income > 0 ? `, плюс выплаты ${shortRub(h.income)}` : ""}` });
  if (pp < -0.3) cons.push(`в минусе на ${pct(-pp, { digits: 0 })}`);

  // Рейтинг из подбора акций
  const scr = ctx.screener.find((s) => s.ticker === inst.ticker.toUpperCase());
  if (scr && scr.score >= 7) pros.push(`высокий дивидендный рейтинг: ${scr.score.toFixed(1).replace(".", ",")} из 10`);

  // Вердикт
  let verdict: Verdict;
  if (issuerW > 0.15) verdict = "trim";
  else if (cut || (pp < -0.35 && y < 0.03)) verdict = "review";
  else if (issuerW > 0.1 || sectorShare > 0.45 || clsOver > 0.1) verdict = "nobuy";
  else if (pros.length >= 2 && cons.length <= 1 && issuerW < 0.07) verdict = "buy";
  else verdict = "hold";

  // Шаги
  if (verdict === "trim") {
    const excess = (issuerW - 0.1) * total;
    if (taxNow > 0 && ldv) steps.push(`Проще всего — не докупать и разбавлять долю пополнениями. Если продавать часть (≈ ${shortRub(excess)}), налог ≈ ${shortRub((excess / h.value) * Math.max(profit, 0) * tax)}; без налога — после ${fmtDate(ldv, { year: "always" })}.`);
    else steps.push(`Можно продать часть на ≈ ${shortRub(excess)}, чтобы доля опустилась до 10 %${profit > 0 && ldv && ldv <= Date.now() ? " — налога не будет: владеете больше 3 лет" : ""}, и вложить в то, чего не хватает.`);
  } else if (verdict === "review") {
    steps.push("Ответьте себе: купили бы вы её сегодня? Если причина покупки (дивиденды, рост бизнеса) больше не работает — продажа освободит деньги.");
    if (profit < 0) steps.push(`Продажа с убытком ${shortRub(-profit)} уменьшит налог с прибыльных продаж этого года (сальдирование).`);
  } else if (verdict === "nobuy") steps.push("Держите, но новые деньги направляйте в другие бумаги или классы.");
  else if (verdict === "buy") steps.push("Подходит для следующего пополнения. Покупайте частями, а не всё сразу.");
  else steps.push("Держите. Пересматривайте, если компания сократит дивиденды или доля вырастет больше 10 %.");
  if (ldvSoon) steps.push(`Не продавайте до ${fmtDate(ldv!, { year: "always" })}: после 3 лет владения налога с прибыли не будет (сейчас ≈ ${shortRub(taxNow)}).`);
  if (nextRecord && daysUntil(nextRecord.event.recordDate) <= 45) steps.push(`Отсечка ${fmtDate(nextRecord.event.recordDate)}: чтобы получить ≈ ${shortRub(nextRecord.net)}, держите бумагу до этой даты.`);

  const summary =
    verdict === "trim" ? `Компания весит ${pct(issuerW, { digits: 0 })} портфеля — слишком много для одной бумаги.`
    : verdict === "review" ? (cut ? "Компания перестала платить дивиденды — проверьте, актуальна ли причина владения." : "Большой убыток без дивидендов — стоит перепроверить идею.")
    : verdict === "nobuy" ? (cons.length ? `Держите, но не докупайте: ${cons[0]}.` : "Хорошо, что она есть, но акций в портфеле уже больше ориентира.")
    : verdict === "buy" ? "Платит, весит немного и не перегружает отрасль — можно добавлять."
    : "Ничего срочного: бумага на своём месте.";
  return { verdict, summary, pros, cons, steps, scores };
}

export function adviceMap(ctx: AdviceCtx): Map<string, Advice> {
  return new Map(ctx.r.holdings.map((h) => [h.id, adviceFor(h, ctx)]));
}
