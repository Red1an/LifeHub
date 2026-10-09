import { fmtDate, ms } from "./dates.ts";
import { num, pct, shortRub } from "./fmt.ts";
import type { Report } from "./analytics.ts";
import { CLASS_TITLE, MODEL, classOf, classSplit, type AssetClass, type ClassSplit } from "./health.ts";
import { bondKind, type OfzRow } from "./moex.ts";
import type { ScreenerRow } from "./screener.ts";
import type { RiskProfile } from "./types.ts";

/*
 * «Во что вложить сейчас»: прозрачные правила, без «чёрного ящика».
 *  1) Сумма делится по классам так, чтобы портфель приблизился к ориентиру под ваш риск (только покупки).
 *  2) В каждом классе — конкретные кандидаты: акции из подбора (с учётом того, что у вас уже есть),
 *     ОФЗ по сроку под ваш профиль, фонды денежного рынка и золота.
 * Это не индивидуальная инвестиционная рекомендация — это расчёт по вашим целям и открытым данным.
 */

export interface Candidate {
  ticker: string;
  name: string;
  /** Сколько ₽ направить. */
  amount: number;
  /** Сколько штук (с учётом лота), если известна цена. */
  units?: number;
  price?: number;
  why: string[];
  risk?: string;
  inPortfolio?: boolean;
}

export interface ClassPlan {
  cls: AssetClass;
  now: number;
  target: number;
  amount: number;
  candidates: Candidate[];
  note: string;
}

export interface IdeasPlan {
  amount: number;
  plans: ClassPlan[];
  after: ClassSplit;
}

const FUNDS = {
  money: [
    { ticker: "LQDT", name: "ВИМ Ликвидность" },
    { ticker: "AKMM", name: "Альфа Денежный рынок" },
    { ticker: "SBMM", name: "Сбер Сберегательный" },
  ],
  gold: [
    { ticker: "GOLD", name: "Атон Золото" },
    { ticker: "TGLD", name: "Т-Капитал Золото" },
  ],
  index: [
    { ticker: "TMOS", name: "Т-Капитал Индекс Мосбиржи" },
    { ticker: "SBMX", name: "Сбер Индекс Мосбиржи" },
  ],
};

export function buildIdeas(r: Report, risk: RiskProfile, amount: number, screener: ScreenerRow[], ofz: OfzRow[], keyRate: number): IdeasPlan {
  const split = classSplit(r);
  const model = MODEL[risk];
  const classes: AssetClass[] = ["shares", "bonds", "money", "gold"];
  const total = classes.reduce((a, c) => a + split[c], 0);
  const after = total + Math.max(0, amount);

  // Только покупки: деньги идут туда, где больше всего недобор до ориентира
  const gaps = classes.map((c) => ({ c, gap: Math.max(0, model[c] * after - split[c]) }));
  const gapSum = gaps.reduce((a, g) => a + g.gap, 0);
  const alloc: Record<AssetClass, number> = { shares: 0, bonds: 0, money: 0, gold: 0, other: 0 };
  for (const g of gaps) alloc[g.c] = gapSum > 0 ? (amount * g.gap) / Math.max(gapSum, amount) : amount * model[g.c];
  // Если недобор меньше суммы — остаток по ориентиру
  const used = classes.reduce((a, c) => a + alloc[c], 0);
  if (amount - used > 1) for (const c of classes) alloc[c] += (amount - used) * model[c];

  const plans: ClassPlan[] = [];
  for (const c of classes) {
    const a = Math.round(alloc[c] / 100) * 100;
    if (a < 500) continue;
    const plan: ClassPlan = { cls: c, now: total > 0 ? split[c] / total : 0, target: model[c], amount: a, candidates: [], note: "" };
    if (c === "shares") sharesCandidates(plan, r, screener);
    if (c === "bonds") bondsCandidates(plan, risk, ofz, keyRate);
    if (c === "money") {
      plan.note = `Фонды денежного рынка растут каждый день примерно на ключевую ставку (сейчас ${pct(keyRate / 100, { digits: 0 })}) и продаются в любой момент — место для денег, которые ждут покупки, и «подушка» на просадку.`;
      plan.candidates = FUNDS.money.slice(0, 1).map((f) => ({ ...f, amount: a, why: ["доход ≈ ключевая ставка", "почти не колеблется", "можно продать в любой день"] }));
    }
    if (c === "gold") {
      plan.note = "Золото обычно растёт, когда дешевеет рубль и падают акции, — страховка портфеля. Держать 5–10 %, не больше: само по себе оно дохода не приносит.";
      plan.candidates = FUNDS.gold.slice(0, 1).map((f) => ({ ...f, amount: a, why: ["защита от падения рубля", "двигается не так, как акции"] }));
    }
    plans.push(plan);
  }
  const afterSplit: ClassSplit = { ...split };
  for (const c of classes) afterSplit[c] += alloc[c];
  return { amount, plans, after: afterSplit };
}

function sharesCandidates(plan: ClassPlan, r: Report, screener: ScreenerRow[]) {
  const held = new Map(r.holdings.map((h) => [h.instrument.ticker.toUpperCase(), h]));
  const shareHoldings = r.holdings.filter((h) => classOf(h) === "shares" && h.instrument.type === "share");
  const sharesValue = shareHoldings.reduce((a, h) => a + h.value, 0);
  const bySector: Record<string, number> = {};
  for (const h of shareHoldings) bySector[h.instrument.sector ?? "—"] = (bySector[h.instrument.sector ?? "—"] ?? 0) + h.value;
  const sectorShare = (s: string) => (sharesValue > 0 ? (bySector[s] ?? 0) / sharesValue : 0);

  const fewShares = shareHoldings.length < 5;
  if (!screener.length || fewShares) {
    const f = FUNDS.index[0];
    plan.candidates.push({
      ...f,
      amount: fewShares ? plan.amount : Math.round(plan.amount / 2 / 100) * 100,
      why: ["сразу ~40 крупнейших компаний", "не надо выбирать бумаги", "дивиденды реинвестируются внутри фонда"],
      risk: "падает вместе с рынком",
      inPortfolio: held.has(f.ticker),
    });
    if (fewShares || !screener.length) {
      plan.note = fewShares
        ? "Акций в портфеле мало — проще всего начать с фонда на индекс Мосбиржи: одна покупка даёт разнообразие из десятков компаний."
        : "Откройте «Подбор акций» и нажмите «Загрузить», чтобы получить конкретные компании.";
      return;
    }
  }
  // Обычные и привилегированные акции — одна компания (SBER/SBERP, TATN/TATNP)
  const issuer = (t: string) => (t.length === 5 && t.endsWith("P") ? t.slice(0, 4) : t.toUpperCase());
  const issuerWeight: Record<string, number> = {};
  for (const h of r.holdings) issuerWeight[issuer(h.instrument.ticker)] = (issuerWeight[issuer(h.instrument.ticker)] ?? 0) + h.weight;
  // Рейтинг кандидатов: качество дивидендов + недовес отрасли − уже большая доля
  const scored = screener
    .filter((s) => s.score >= 4 && s.yield > 0.03)
    .map((s) => {
      const h = held.get(s.ticker);
      const weight = issuerWeight[issuer(s.ticker)] ?? 0;
      let score = s.score;
      score -= sectorShare(s.sector) * 6; // перевес отрасли
      if (weight > 0.1) score -= 100; // и так слишком много — не предлагаем
      else if (weight > 0.06) score -= 3;
      else if (weight > 0.03) score -= 1;
      if (!bySector[s.sector] && s.sector !== "—") score += 1; // новая отрасль
      return { s, score, h, weight };
    })
    .filter((x) => x.score > -50)
    .sort((a, b) => b.score - a.score);
  const budget = plan.amount - plan.candidates.reduce((a, c) => a + c.amount, 0);
  const picked: typeof scored = [];
  const sectors = new Set<string>();
  const issuers = new Set<string>();
  // Сколько бумаг брать: на каждую — хотя бы один лот, не больше четырёх
  for (const x of scored) {
    if (sectors.has(x.s.sector) || issuers.has(issuer(x.s.ticker))) continue;
    const lotCost = x.s.price * x.s.lot;
    if (lotCost > budget / Math.max(1, picked.length + 1) && picked.length > 0) continue;
    picked.push(x);
    sectors.add(x.s.sector);
    issuers.add(issuer(x.s.ticker));
    if (picked.length >= 4) break;
  }
  let left = budget;
  picked.forEach(({ s, h, weight }, i) => {
    const lotCost = s.price * s.lot;
    const share = left / (picked.length - i);
    const lots = lotCost > 0 ? Math.max(i === 0 && lotCost > share ? 1 : 0, Math.floor(share / lotCost)) : 0;
    if (!lots) return;
    left -= lots * lotCost;
    const why: string[] = [`дивиденды ≈ ${pct(s.yield)} в год`, `платила ${s.yearsPaid} из 5 последних лет`];
    if (s.growth != null && s.growth > 0.03) why.push(`выплаты росли на ${pct(s.growth, { digits: 0 })} в год`);
    if (!bySector[s.sector]) why.push(`новая для вас отрасль: ${s.sector}`);
    else if (sectorShare(s.sector) < 0.15) why.push(`отрасли «${s.sector}» у вас мало`);
    if (weight > 0) why.push(`сейчас у вас ${pct(weight)} портфеля`);
    if (s.nextDate && ms(s.nextDate) > Date.now()) why.push(`ближайшая отсечка ${fmtDate(s.nextDate)}`);
    plan.candidates.push({
      ticker: s.ticker, name: s.name, amount: lots * lotCost, units: lots * s.lot, price: s.price, why,
      risk: s.yield > 0.15 ? "очень высокая доходность часто значит, что рынок ждёт снижения выплат" : s.yearsPaid < 4 ? "выплаты нерегулярные" : undefined,
      inPortfolio: !!h || weight > 0,
    });
  });
  plan.note = "Кандидаты — дивидендные компании с высоким рейтингом в «Подборе акций», из разных отраслей, с поправкой на то, что у вас уже много. Перед покупкой прочитайте свежие новости компании.";
}

function bondsCandidates(plan: ClassPlan, risk: RiskProfile, ofz: OfzRow[], keyRate: number) {
  const pick = (minY: number, maxY: number) =>
    ofz
      .filter((b) => {
        const years = (ms(b.matDate) - Date.now()) / (365.25 * 86_400_000);
        return years >= minY && years <= maxY && b.price > 0 && bondKind(b) === "fixed";
      })
      .sort((a, b) => b.yield - a.yield)[0];
  const buckets: [number, number, string][] =
    risk === "careful" ? [[1, 3, "короткая"], [3, 5, "средняя"]]
    : risk === "balanced" ? [[1, 3, "короткая"], [4, 8, "средняя"]]
    : [[3, 6, "средняя"], [8, 20, "длинная"]];
  const chosen = buckets.map(([a, b, label]) => ({ bond: pick(a, b), label })).filter((x) => x.bond);
  const each = plan.amount / Math.max(chosen.length, 1);
  for (const { bond, label } of chosen) {
    const b = bond!;
    const price = (b.price * b.face) / 100;
    const units = price > 0 ? Math.max(1, Math.floor(each / price)) : 0;
    if (units * price > plan.amount * 1.05) continue;
    const years = (ms(b.matDate) - Date.now()) / (365.25 * 86_400_000);
    const why = [`доходность к погашению ${pct(b.yield)} в год`, `погашение ${fmtDate(b.matDate, { year: "always" })} (через ${num(years, 1)} г., ${label})`, "гарантия государства"];
    if (b.coupon > 0) why.push(`купон ${num(b.coupon, 2)} ₽ раз в ${Math.round(b.couponPeriod / 30)} мес.`);
    plan.candidates.push({
      ticker: b.secid, name: b.name, amount: units * price || each, units, price, why,
      risk: label === "длинная" ? "цена сильно зависит от ставки ЦБ: вырастет при снижении ставки, упадёт при повышении" : undefined,
    });
  }
  const best = chosen[0]?.bond;
  plan.note = best
    ? `ОФЗ сейчас дают ${pct(best.yield)} — ${best.yield > keyRate / 100 ? "выше" : "около"} ключевой ставки ${pct(keyRate / 100, { digits: 0 })}. ${risk === "bold" ? "Длинные ОФЗ — ставка на снижение ставки ЦБ: если её снизят, их цена вырастет." : "Короткие и средние ОФЗ мало колеблются и дают известный заранее доход."}`
    : "Нажмите «Загрузить облигации» выше, чтобы получить доходности с биржи. Или купите фонд облигаций (например, OBLG, SBGB).";
  if (!chosen.length) plan.candidates.push({ ticker: "SBGB", name: "Сбер Госзаём (фонд ОФЗ)", amount: plan.amount, why: ["сразу набор ОФЗ", "купоны реинвестируются"] });
}

/** Текст для нейронки: портфель, проблемы, данные рынка. Компактно, без лишнего. */
export function aiContext(input: {
  r: Report;
  risk: RiskProfile;
  amount: number;
  issues: { title: string; text: string }[];
  lessons: { title: string }[];
  screener: ScreenerRow[];
  ofz: OfzRow[];
  keyRate: number;
  incomeNext: number;
  goal: number;
}): string {
  const { r } = input;
  const lines: string[] = [];
  lines.push(`Стоимость портфеля: ${shortRub(r.totalValue)}, вложено ${shortRub(r.invested)}, доходность в год (XIRR) ${pct(r.xirr)}.`);
  lines.push(`Свободные деньги: ${shortRub(r.cashRUB)}. Профиль риска: ${input.risk}. Сумма, которую хочу вложить сейчас: ${shortRub(input.amount)}.`);
  lines.push(`Прогноз дивидендов и купонов на следующий год на руки: ${shortRub(input.incomeNext)}. Цель пассивного дохода: ${shortRub(input.goal)} в месяц.`);
  lines.push(`Ключевая ставка ЦБ: ${input.keyRate} %.`);
  const split = classSplit(r);
  const tot = Object.values(split).reduce((a, b) => a + b, 0);
  lines.push("Классы: " + (Object.keys(split) as AssetClass[]).filter((c) => split[c] > 0).map((c) => `${CLASS_TITLE[c]} ${pct(split[c] / tot, { digits: 0 })}`).join(", "));
  lines.push("Позиции (тикер, название, класс, отрасль, доля, прибыль %, дивдоходность до налога, держу с, налог при продаже сейчас):");
  for (const h of r.holdings.slice(0, 40)) {
    const profit = h.value - h.cost;
    const since = h.firstBuy ? new Date(h.firstBuy).toISOString().slice(0, 10) : "?";
    const free = h.firstBuy && Date.now() - h.firstBuy > 3 * 365.25 * 86_400_000;
    const taxNote = profit <= 0 ? "нет (убыток)" : free ? "нет (больше 3 лет)" : shortRub(profit * (r.taxRate / 100));
    lines.push(`- ${h.instrument.ticker} ${h.instrument.name} | ${CLASS_TITLE[classOf(h)]} | ${h.instrument.sector ?? "—"} | ${pct(h.weight)} | ${pct(h.cost > 0 ? h.value / h.cost - 1 : 0, { signed: true })} | ${pct(h.value > 0 ? h.forwardIncome / h.value : 0)} | ${since} | ${taxNote}`);
  }
  if (input.issues.length) lines.push("Найденные проблемы: " + input.issues.map((i) => i.title).join("; "));
  if (input.lessons.length) lines.push("Ошибки в прошлом: " + input.lessons.map((l) => l.title).join("; "));
  lines.push("Топ дивидендных акций MOEX (тикер, отрасль, дивдоходность, лет с выплатами из 5, рейтинг 0–10):");
  for (const s of input.screener.slice(0, 15)) lines.push(`- ${s.ticker} ${s.name} | ${s.sector} | ${pct(s.yield)} | ${s.yearsPaid} | ${s.score.toFixed(1)}`);
  const bonds = input.ofz.filter((b) => bondKind(b) === "fixed").sort((a, b) => b.yield - a.yield).slice(0, 6);
  if (bonds.length) lines.push("ОФЗ с фиксированным купоном: " + bonds.map((b) => `${b.secid} до ${b.matDate} ${pct(b.yield)}`).join("; "));
  return lines.join("\n");
}
