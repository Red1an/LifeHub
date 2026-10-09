import { DAY, fmtDate, ms } from "./dates.ts";
import { num, pct, shortRub } from "./fmt.ts";
import { bondKind, type OfzRow } from "./moex.ts";

/*
 * «В какие облигации вложить»: прозрачный подбор по сроку, когда понадобятся деньги.
 *  — ОФЗ с фиксированным купоном выстраиваются «лесенкой»: части гасятся в разное время, деньги не заперты целиком;
 *  — в режиме «чуть больше дохода» добавляются корпоративные облигации крупных компаний с небольшой премией к ОФЗ;
 *  — премия к ОФЗ (спред) — главный признак риска: если рынок требует сильно больше, он сомневается в компании.
 * Это расчёт по открытым данным биржи, не индивидуальная рекомендация.
 */

export type BondGoal = "safe" | "income";
export type Risk = "gov" | "reliable" | "medium" | "high" | "junk";

export const RISK_LABEL: Record<Risk, [string, string]> = {
  gov: ["Государство", "inv-tag-green"],
  reliable: ["Крупная компания", "inv-tag-green"],
  medium: ["Средний риск", "inv-tag-gold"],
  high: ["Повышенный риск", "inv-tag-orange"],
  junk: ["Рынок сомневается", "inv-tag-red"],
};

/** Крупнейшие и квазигосударственные эмитенты — по началу краткого названия на бирже. */
const RELIABLE = [
  "Сбер", "ВТБ", "ГПБ", "ВЭБ", "РЖД", "Ростел", "МТС", "ФосАгро", "Полюс", "НорНик", "ГМКНорНик", "Газпнф", "Газпрнеф", "ГазпромК",
  "ГазКап", "Атомэн", "Росатом", "ТрнфБО", "Транснф", "ФСК", "Россети", "РусГидро", "Роснфт", "ЛУКОЙЛ", "Лукойл", "Магнит", "ИКС5",
  "АЛРОСА", "Яндекс", "ЯНДЕКС", "СовкомБ", "АльфаБ", "РСХБ", "sМГор", "МГор", "Сибур", "СИБУР", "Татнфт", "Новатэк", "НЛМК", "Северст",
];

export const years = (iso: string) => (ms(iso) - Date.now()) / (365.25 * DAY);
/** Когда реально вернутся деньги: оферта раньше погашения — тоже дата возврата. */
export const effectiveEnd = (b: OfzRow) => (b.offerDate && ms(b.offerDate) > Date.now() && ms(b.offerDate) < ms(b.matDate) ? b.offerDate : b.matDate);
export const issuerOf = (b: OfzRow) => b.name.split(/[\s-]/)[0];
export const unitPrice = (b: OfzRow) => (b.price * b.face) / 100;
export const couponPerYear = (b: OfzRow) => (b.couponPeriod > 0 ? b.coupon * (365 / b.couponPeriod) : 0);

/** Доходность ОФЗ с фиксированным купоном на заданный срок — для премии корпоративных облигаций. */
export function ofzYieldAt(ofz: OfzRow[], y: number): number | null {
  const fixed = ofz.filter((b) => bondKind(b) === "fixed" && b.yield > 0).map((b) => ({ y: years(b.matDate), r: b.yield })).sort((a, b) => a.y - b.y);
  if (!fixed.length) return null;
  const near = fixed.filter((b) => Math.abs(b.y - y) <= Math.max(1, y * 0.35));
  const list = near.length ? near : [fixed.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a))];
  return list.reduce((a, b) => a + b.r, 0) / list.length;
}

export interface CorpRow {
  bond: OfzRow;
  spread: number | null;
  risk: Risk;
  end: string;
}

export function rateCorp(corp: OfzRow[], ofz: OfzRow[]): CorpRow[] {
  return corp
    .map((b) => {
      const end = effectiveEnd(b);
      const base = ofzYieldAt(ofz, years(end));
      const spread = base != null ? b.yield - base : null;
      const big = RELIABLE.some((p) => b.name.startsWith(p));
      let risk: Risk;
      if (spread == null) risk = big ? "reliable" : "medium";
      else if (spread > 0.06) risk = "junk";
      else if (spread > 0.035) risk = "high";
      else if (big && spread <= 0.025) risk = "reliable";
      else risk = "medium";
      return { bond: b, spread, risk, end };
    })
    .sort((a, b) => b.bond.yield - a.bond.yield);
}

export interface BondPick {
  bond: OfzRow;
  risk: Risk;
  end: string;
  amount: number;
  units: number;
  /** Купоны в год на купленное количество, ₽ до налога. */
  couponsYear: number;
  /** Сколько примерно будет к дате возврата, ₽ до налога (с реинвестированием купонов по той же доходности). */
  atEnd: number;
  why: string[];
  risks: string[];
}

export interface BondPlan {
  picks: BondPick[];
  fund?: { ticker: string; name: string; amount: number; why: string[] };
  leftover: number;
  view: string;
  yieldAvg: number;
}

/** Подбор облигаций на сумму: деньги нужны через horizon лет. */
export function pickBonds(input: { ofz: OfzRow[]; corp: OfzRow[]; amount: number; horizon: number; goal: BondGoal; keyRate: number }): BondPlan {
  const { ofz, corp, amount, horizon, goal } = input;
  const fixed = ofz.filter((b) => bondKind(b) === "fixed" && b.yield > 0 && (b.volume ?? 1) > 0);
  const view = marketView(ofz, input.keyRate);
  const plan: BondPlan = { picks: [], leftover: amount, view, yieldAvg: 0 };
  if (amount <= 0 || !fixed.length) return plan;

  let budgetBonds = amount;
  // Деньги нужны меньше чем через год — половину держим в фонде денежного рынка: его можно продать в любой день
  if (horizon <= 1) {
    const f = Math.round(amount * 0.5);
    plan.fund = { ticker: "LQDT", name: "ВИМ Ликвидность (фонд денежного рынка)", amount: f, why: ["доход ≈ ключевая ставка, начисляется каждый день", "можно продать в любой момент без потерь", "подходит для денег, которые скоро понадобятся"] };
    budgetBonds -= f;
  }

  // Лесенка: до трёх «ступенек» сроков до горизонта
  const maxY = Math.max(0.6, horizon);
  const rungs: [number, number][] = maxY <= 1.2 ? [[0.25, maxY]] : maxY <= 3 ? [[0.4, maxY / 2], [maxY / 2, maxY]] : [[0.5, maxY / 3], [maxY / 3, (maxY * 2) / 3], [(maxY * 2) / 3, maxY]];
  const corpRated = rateCorp(corp, ofz).filter((c) => c.risk === "reliable" && years(c.end) <= maxY && years(c.end) > 0.3);
  const corpShare = goal === "income" && corpRated.length ? 0.4 : 0;
  const ofzBudget = budgetBonds * (1 - corpShare);

  const used = new Set<string>();
  const ofzPicks: OfzRow[] = [];
  for (const [a, b] of rungs) {
    const best = fixed.filter((x) => !used.has(x.secid) && years(x.matDate) > a && years(x.matDate) <= b).sort((x, y) => y.yield - x.yield)[0];
    if (best) {
      ofzPicks.push(best);
      used.add(best.secid);
    }
  }
  if (!ofzPicks.length) {
    const nearest = fixed.filter((x) => years(x.matDate) <= maxY + 1).sort((x, y) => years(x.matDate) - years(y.matDate)).pop();
    if (nearest) ofzPicks.push(nearest);
  }
  const corpPicks: { c: CorpRow }[] = [];
  if (corpShare > 0) {
    const issuers = new Set<string>();
    for (const c of corpRated) {
      if (issuers.has(issuerOf(c.bond))) continue;
      corpPicks.push({ c });
      issuers.add(issuerOf(c.bond));
      if (corpPicks.length >= 2) break;
    }
  }

  const add = (bond: OfzRow, budget: number, risk: Risk, end: string, extraWhy: string[], extraRisk: string[]) => {
    const unit = unitPrice(bond);
    const units = unit > 0 ? Math.floor(budget / unit) : 0;
    if (!units) return;
    const sum = units * unit;
    const y = years(end);
    plan.picks.push({
      bond, risk, end, amount: sum, units, couponsYear: units * couponPerYear(bond), atEnd: sum * (1 + bond.yield) ** Math.max(y, 0),
      why: [`доходность ${pct(bond.yield)} в год, если держать до ${fmtDate(end, { year: "always" })}`, ...extraWhy],
      risks: extraRisk,
    });
    plan.leftover -= sum;
  };
  plan.leftover -= plan.fund?.amount ?? 0;
  for (const b of ofzPicks) {
    const y = years(b.matDate);
    add(b, ofzBudget / ofzPicks.length, "gov", b.matDate, [
      "выпускает Минфин — самый надёжный рублёвый долг",
      `купон ${num(b.coupon, 2)} ₽ ${b.couponPeriod > 0 ? `раз в ${Math.round(b.couponPeriod / 30.4)} мес.` : ""}`.trim(),
      y < 1.5 ? "короткая: цена почти не колеблется" : y < 5 ? "средняя: цена умеренно зависит от ставки ЦБ" : "длинная: при снижении ставки ЦБ цена вырастет",
    ], y >= 5 ? ["если ставку ЦБ поднимут, цена временно упадёт — держите до погашения"] : []);
  }
  for (const { c } of corpPicks) {
    add(c.bond, (budgetBonds * corpShare) / corpPicks.length, c.risk, c.end, [
      c.spread != null ? `на ${num(c.spread * 100, 1)} п.п. выше ОФЗ того же срока` : "доходность выше ОФЗ",
      "крупная компания, первый уровень листинга биржи",
      c.bond.offerDate && c.end === c.bond.offerDate ? `оферта ${fmtDate(c.end, { year: "always" })}: компания выкупит облигации или поменяет купон` : `погашение ${fmtDate(c.end, { year: "always" })}`,
    ], ["корпоративный долг: если у компании проблемы, выплаты могут задержаться — поэтому не больше 5–10 % портфеля на одного эмитента"]);
  }
  const inv = plan.picks.reduce((a, p) => a + p.amount, 0);
  plan.yieldAvg = inv > 0 ? plan.picks.reduce((a, p) => a + p.bond.yield * p.amount, 0) / inv : 0;
  return plan;
}

/** Что рынок ждёт от ставки — по форме кривой ОФЗ. */
export function marketView(ofz: OfzRow[], keyRate: number): string {
  const short = ofzYieldAt(ofz, 1.5);
  const long = ofzYieldAt(ofz, 9);
  if (short == null || long == null) return "";
  const k = keyRate / 100;
  let text = `Короткие ОФЗ (1–2 года) дают ≈ ${pct(short)}, длинные (8–10 лет) — ≈ ${pct(long)}, ключевая ставка ${pct(k, { digits: 0 })}. `;
  if (long < short - 0.005) text += "Длинные доходнее коротких не стали — рынок ждёт снижения ставки. Если вы согласны, длинные фиксированные ОФЗ дадут и купоны, и рост цены; если нет — берите короткие и средние.";
  else if (long > short + 0.01) text += "Длинные заметно доходнее коротких — рынок закладывает риск высокой ставки надолго. Длинные ОФЗ дают больше, но их цена сильнее качается.";
  else text += "Доходности по срокам почти одинаковые — выгоднее брать срок под вашу цель, без лишнего риска.";
  return text;
}

export const KIND_TITLE: Record<string, string> = {
  fixed: "Фиксированный купон",
  floater: "Плавающий купон (ОФЗ-ПК)",
  linker: "Защита от инфляции (ОФЗ-ИН)",
  other: "Прочие",
};

export const KIND_HINT: Record<string, string> = {
  fixed: "Купон известен заранее на весь срок. Купили — знаете свой доход, если держать до погашения.",
  floater: "Купон каждый раз пересчитывается по ставке RUONIA (≈ ключевая ставка). Цена почти не меняется. Хорошо, если думаете, что ставка останется высокой; плохо, если её снизят — доход упадёт.",
  linker: "Номинал растёт вместе с инфляцией, купон небольшой (2,5 %). Защищают от высокой инфляции, но при нынешней ставке обычно дают меньше обычных ОФЗ.",
};

/** Краткая оценка облигации, которая уже есть в портфеле. */
export function heldBondNote(b: OfzRow | undefined, keyRate: number, maturity?: string): string {
  if (maturity && years(maturity) < 0.25) return `Погашается ${fmtDate(maturity, { year: "always" })} — заранее решите, во что вложить вернувшиеся деньги.`;
  if (!b) return "Держите до погашения: деньги вернутся по номиналу, купоны придут по графику.";
  const k = bondKind(b);
  if (k === "floater") return `Флоатер: купон следует за ставкой ЦБ (сейчас ${num(keyRate, 0)} %). Пока ставка высокая — выгодно держать.`;
  if (b.yield > keyRate / 100) return `Если купить сегодня, она даёт ${pct(b.yield)} — выше ключевой ставки. Держите до погашения.`;
  return `Сейчас её доходность ${pct(b.yield)}. Продавать ради другой ОФЗ с похожей доходностью смысла нет — держите до погашения.`;
}

export const fmtCoupons = (v: number) => `${shortRub(v)} в год`;
