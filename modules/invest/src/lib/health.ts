import { addDays, addYears, daysUntil, fmtDate } from "./dates.ts";
import { pct, rub, shortRub, plural } from "./fmt.ts";
import { profitOf, profitPctOf, risk, sameMoneyInIndex, type Holding, type Report } from "./analytics.ts";
import type { Income } from "./income.ts";
import { FUND_KIND } from "./reference.ts";
import type { Market, Portfolio, RiskProfile, Settings } from "./types.ts";

/*
 * «Что не так с портфелем»: набор понятных проверок. Каждая — что случилось, почему это важно (в ваших цифрах)
 * и что сделать. Оценка 0–100 — сумма штрафов, а не «научная» метрика: она нужна, чтобы видеть движение.
 */

export type Severity = "bad" | "warn" | "info" | "good";

export interface Issue {
  id: string;
  severity: Severity;
  area: "Риск" | "Доход" | "Деньги" | "Налоги" | "Расходы" | "Результат";
  title: string;
  text: string;
  action?: string;
  /** Бумаги, к которым относится. */
  items?: { id?: string; name: string; detail: string }[];
}

export interface Health {
  score: number;
  grade: string;
  issues: Issue[];
  good: Issue[];
  classes: ClassSplit;
  target: ClassSplit;
}

/* ── классы активов в смысле «для чего они в портфеле» ── */

export type AssetClass = "shares" | "bonds" | "money" | "gold" | "other";
export const CLASS_TITLE: Record<AssetClass, string> = {
  shares: "Акции",
  bonds: "Облигации",
  money: "Деньги и фонды денежного рынка",
  gold: "Золото",
  other: "Прочее",
};
export const CLASS_SHORT: Record<AssetClass, string> = { shares: "Акции", bonds: "Облигации", money: "Деньги", gold: "Золото", other: "Прочее" };
export type ClassSplit = Record<AssetClass, number>;

export function classOf(h: Holding): AssetClass {
  const i = h.instrument;
  if (i.type === "share") return "shares";
  if (i.type === "bond") return "bonds";
  if (i.type === "currency") return "money";
  if (i.type === "etf") {
    const k = FUND_KIND[i.ticker.toUpperCase()];
    if (k === "money") return "money";
    if (k === "gold") return "gold";
    if (k === "bonds") return "bonds";
    if (/золот|gold/i.test(i.name)) return "gold";
    if (/денежн|ликвидн|money|сбережен/i.test(i.name)) return "money";
    if (/облиг|bond|офз/i.test(i.name)) return "bonds";
    return "shares";
  }
  return "other";
}

export function classSplit(r: Report): ClassSplit {
  const s: ClassSplit = { shares: 0, bonds: 0, money: Math.max(0, r.cashRUB), gold: 0, other: 0 };
  for (const h of r.holdings) s[classOf(h)] += h.value;
  return s;
}

/** Ориентир распределения под отношение к риску (в долях). */
export const MODEL: Record<RiskProfile, ClassSplit> = {
  careful: { shares: 0.25, bonds: 0.55, money: 0.12, gold: 0.08, other: 0 },
  balanced: { shares: 0.5, bonds: 0.35, money: 0.05, gold: 0.1, other: 0 },
  bold: { shares: 0.75, bonds: 0.15, money: 0.02, gold: 0.08, other: 0 },
};
export const RISK_TITLE: Record<RiskProfile, string> = { careful: "Осторожный", balanced: "Сбалансированный", bold: "Смелый" };
export const RISK_HINT: Record<RiskProfile, string> = {
  careful: "Важно не терять: просадка больше 10–15 % неприятна. Деньги могут понадобиться в ближайшие 1–3 года.",
  balanced: "Готов переждать просадку 20–30 % ради роста. Горизонт 3–7 лет.",
  bold: "Горизонт больше 7 лет, просадки 40 % не пугают — главное рост.",
};

const isDiversifiedFund = (h: Holding) => h.instrument.type === "etf";
const isGovBond = (h: Holding) => h.instrument.type === "bond" && (h.instrument.ticker.startsWith("SU") || h.instrument.sector === "Госбумаги");

export function buildHealth(p: Portfolio, r: Report, inc: Income, market: Market, s: Settings, today = Date.now()): Health {
  const issues: Issue[] = [];
  const good: Issue[] = [];
  const total = r.totalValue;
  const keyRate = (market.keyRate ?? s.keyRateFallback) / 100;
  const split = classSplit(r);
  const target = MODEL[s.risk];
  const share = (c: AssetClass) => (total > 0 ? split[c] / total : 0);

  if (total < 1000 || !r.holdings.length) {
    return { score: 0, grade: "—", issues: [], good: [], classes: split, target };
  }

  // 1. Одна бумага весит слишком много (кроме фондов и ОФЗ — они сами по себе разнообразны или надёжны)
  const byIssuer = new Map<string, Holding>();
  for (const h of r.holdings) {
    if (isDiversifiedFund(h) || isGovBond(h)) continue;
    const t = h.instrument.ticker.toUpperCase();
    const key = t.length === 5 && t.endsWith("P") ? t.slice(0, 4) : t;
    const ex = byIssuer.get(key);
    byIssuer.set(key, ex ? { ...ex, value: ex.value + h.value, weight: ex.weight + h.weight } : h);
  }
  const heavy = [...byIssuer.values()].filter((h) => h.weight > 0.12).sort((a, b) => b.weight - a.weight);
  if (heavy.length) {
    const worst = heavy[0];
    issues.push({
      id: "concentration",
      severity: worst.weight > 0.25 ? "bad" : "warn",
      area: "Риск",
      title: heavy.length === 1 ? `${worst.instrument.name} — ${pct(worst.weight, { digits: 0 })} портфеля` : `${heavy.length} ${plural(heavy.length, ["бумага весит", "бумаги весят", "бумаг весят"])} больше 12 %`,
      text: `Если с компанией что-то случится (отмена дивидендов, санкции, допэмиссия), пострадает большая часть денег. Если эта бумага подешевеет на 30 %, вы потеряете ${shortRub(worst.value * 0.3)} — ${pct((worst.value * 0.3) / total)} всего портфеля.`,
      action: "Новые деньги направляйте в другие бумаги, пока доля не опустится до 8–10 %. Продавать не обязательно.",
      items: heavy.map((h) => ({ id: h.id, name: h.instrument.name, detail: pct(h.weight) })),
    });
  } else if (r.holdings.length >= 8) {
    good.push({ id: "concentration", severity: "good", area: "Риск", title: "Нет бумаг, от которых зависит всё", text: "Ни одна компания не весит больше 12 % — падение любой из них переживаемо." });
  }

  // 2. Отрасль перевешивает (среди акций)
  const shareHoldings = r.holdings.filter((h) => classOf(h) === "shares" && h.instrument.type === "share");
  const sharesValue = shareHoldings.reduce((a, h) => a + h.value, 0);
  if (sharesValue > 0 && shareHoldings.length >= 3) {
    const bySector: Record<string, number> = {};
    for (const h of shareHoldings) bySector[h.instrument.sector ?? "Не указана"] = (bySector[h.instrument.sector ?? "Не указана"] ?? 0) + h.value;
    const [sector, v] = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0];
    const sh = v / sharesValue;
    if (sh > 0.4 && sector !== "Не указана") {
      issues.push({
        id: "sector",
        severity: sh > 0.55 ? "bad" : "warn",
        area: "Риск",
        title: `${pct(sh, { digits: 0 })} акций — одна отрасль: ${sector}`,
        text: `Бумаги одной отрасли падают вместе: нефтяники — от цен на нефть и курса, банки — от ставки ЦБ. Сейчас «${sector}» — ${shortRub(v)}.`,
        action: "Добавляйте акции других отраслей. Подсказки — в «Идеях».",
      });
    } else if (Object.keys(bySector).length >= 5) {
      good.push({ id: "sector", severity: "good", area: "Риск", title: `Акции из ${Object.keys(bySector).length} отраслей`, text: "Проблемы одной отрасли не обрушат весь портфель." });
    }
  }

  // 3. Акций больше или меньше, чем подходит под ваш риск
  const sh = share("shares");
  if (sh > target.shares + 0.15) {
    issues.push({
      id: "too-risky",
      severity: sh > target.shares + 0.3 ? "bad" : "warn",
      area: "Риск",
      title: `Акций ${pct(sh, { digits: 0 })} — больше, чем для профиля «${RISK_TITLE[s.risk]}»`,
      text: `Ориентир — около ${pct(target.shares, { digits: 0 })}. При падении рынка на 30 % (как в 2022) портфель потеряет примерно ${shortRub(split.shares * 0.3)}.`,
      action: `Новые деньги — в облигации и фонды денежного рынка, пока акции не опустятся к ${pct(target.shares, { digits: 0 })}. Или поменяйте профиль риска, если готовы к просадкам.`,
    });
  } else if (sh < target.shares - 0.2) {
    issues.push({
      id: "too-safe",
      severity: "info",
      area: "Доход",
      title: `Акций всего ${pct(sh, { digits: 0 })} — меньше, чем для профиля «${RISK_TITLE[s.risk]}»`,
      text: "На горизонте 5+ лет акции обычно растут быстрее облигаций и инфляции. Слишком осторожный портфель может не обогнать цены.",
      action: "Если горизонт длинный — добавляйте акции понемногу каждый месяц.",
    });
  }

  // 4. Нет защиты: облигаций, денег и золота почти нет
  const defensive = share("bonds") + share("money") + share("gold");
  if (defensive < 0.1 && s.risk !== "bold") {
    issues.push({
      id: "no-defense",
      severity: "warn",
      area: "Риск",
      title: "Почти нет «подушки» внутри портфеля",
      text: `Облигации, деньги и золото — ${pct(defensive, { digits: 0 })}. Они почти не падают вместе с акциями и дают деньги, чтобы докупить акции дёшево на просадке. ОФЗ сейчас дают около ${pct(keyRate, { digits: 0 })} годовых почти без риска.`,
      action: "Держите 20–40 % в облигациях (ОФЗ, фонды облигаций).",
    });
  }

  // 5. Деньги лежат без дела
  const idleCash = Math.max(0, r.cashRUB);
  if (idleCash > Math.max(10_000, total * 0.05)) {
    const lost = idleCash * keyRate;
    issues.push({
      id: "idle-cash",
      severity: idleCash > total * 0.15 ? "warn" : "info",
      area: "Деньги",
      title: `${shortRub(idleCash)} лежат на счетах без дохода`,
      text: `Это ${pct(idleCash / total, { digits: 0 })} портфеля. В фонде денежного рынка (LQDT, AKMM, SBMM) они приносили бы около ${pct(keyRate, { digits: 0 })} годовых — примерно ${shortRub(lost)} в год, и их можно забрать в любой день.`,
      action: "Если деньги ждут покупки — переложите их в фонд денежного рынка.",
    });
  }
  if (r.cashRUB < -1000) {
    issues.push({
      id: "margin",
      severity: "bad",
      area: "Риск",
      title: `Отрицательный остаток ${rub(r.cashRUB)}`,
      text: "Вы торгуете в долг (маржинальное кредитование): брокер берёт процент, а при падении рынка может принудительно продать бумаги.",
      action: "Погасите долг с ближайшего пополнения.",
    });
  }

  // 6. Число бумаг
  const nStocks = shareHoldings.length;
  if (nStocks > 0 && nStocks < 5 && split.shares > total * 0.3 && !r.holdings.some((h) => isDiversifiedFund(h) && classOf(h) === "shares")) {
    issues.push({
      id: "few",
      severity: "warn",
      area: "Риск",
      title: `Всего ${nStocks} ${plural(nStocks, ["акция", "акции", "акций"])}`,
      text: "Результат зависит от судьбы нескольких компаний. 10–20 акций разных отраслей или один фонд на индекс (TMOS, SBMX, EQMX) снижают риск без потери доходности.",
      action: "Добавьте фонд на индекс Мосбиржи или ещё 5–10 компаний из разных отраслей.",
    });
  } else if (r.holdings.length > 40) {
    issues.push({
      id: "many",
      severity: "info",
      area: "Расходы",
      title: `${r.holdings.length} бумаг — сложно уследить`,
      text: "Мелкие позиции почти не влияют на результат, но отнимают внимание. Часто это следы старых идей.",
      action: `Посмотрите бумаги с долей меньше 0,5 % (${r.holdings.filter((h) => h.weight < 0.005).length} шт.) — может, их проще продать или докупить до заметной доли.`,
    });
  }

  // 7. Доход зависит от одного плательщика
  const topPayer = inc.payers[0];
  if (topPayer && topPayer.share > 0.25 && inc.payers.length > 1) {
    issues.push({
      id: "payer",
      severity: topPayer.share > 0.4 ? "warn" : "info",
      area: "Доход",
      title: `${pct(topPayer.share, { digits: 0 })} дивидендов — от одной компании`,
      text: `${topPayer.name} платит ${shortRub(topPayer.amount)} из ваших выплат в этом году. Если она сократит дивиденды (как Газпром в 2022), доход заметно просядет.`,
      action: "Добавьте плательщиков из других отраслей.",
    });
  }

  // 8. Сильные убытки по отдельным бумагам
  const losers = r.holdings.filter((h) => profitPctOf(h) < -0.3 && h.weight > 0.015 && h.instrument.type !== "bond");
  if (losers.length) {
    const lossSum = losers.reduce((a, h) => a + profitOf(h), 0);
    issues.push({
      id: "losers",
      severity: "info",
      area: "Результат",
      title: `${losers.length} ${plural(losers.length, ["бумага", "бумаги", "бумаг"])} в минусе больше чем на 30 %`,
      text: `Вместе ${shortRub(lossSum)}. Убыток сам по себе не повод продавать — но стоит честно ответить: купили бы вы эту бумагу сегодня?`,
      action: "Если нет — продажа в убыток уменьшит налог с прибыльных продаж в этом же году (сальдирование). Если да — держите или докупайте.",
      items: losers.map((h) => ({ id: h.id, name: h.instrument.name, detail: pct(profitPctOf(h), { signed: true }) })),
    });
  }

  // 9. Результат: портфель против индекса и против вклада
  const bench = market.benchmarks[s.benchmark];
  const idx = sameMoneyInIndex(r, bench);
  const years = r.history.length ? (today - r.history[0].t) / (365.25 * 86_400_000) : 0;
  if (r.xirr != null && years >= 1) {
    if (idx?.xirr != null) {
      const diff = r.xirr - idx.xirr;
      if (diff < -0.03) {
        issues.push({
          id: "vs-index",
          severity: diff < -0.08 ? "bad" : "warn",
          area: "Результат",
          title: `Индекс дал бы на ${pct(-diff, { digits: 1 })} в год больше`,
          text: `Ваша доходность ${pct(r.xirr)} в год. Если бы те же деньги в те же дни шли в индекс ${s.benchmark}, было бы ${pct(idx.xirr)} в год — сейчас это ${shortRub(idx.value)} вместо ${shortRub(r.totalValue)}.`,
          action: "Подумайте о том, чтобы основу портфеля держать в фонде на индекс, а в отдельные бумаги вкладывать меньшую часть.",
        });
      } else if (diff > 0.01) {
        good.push({ id: "vs-index", severity: "good", area: "Результат", title: `Обгоняете индекс на ${pct(diff)} в год`, text: `Ваши ${pct(r.xirr)} против ${pct(idx.xirr)} у ${s.benchmark} при тех же пополнениях.` });
      }
    }
    const dep = s.riskFreeRate / 100;
    if (r.xirr < dep - 0.02) {
      issues.push({
        id: "vs-deposit",
        severity: "info",
        area: "Результат",
        title: `Доходность ${pct(r.xirr)} в год — ниже, чем дают вклады сейчас (${pct(dep, { digits: 0 })})`,
        text: "За этот период вклад принёс бы больше с меньшим риском. Так бывает на коротком отрезке, но если повторяется годами — стоит пересмотреть стратегию.",
      });
    }
  }

  // 10. Комиссии
  const feeYears = Math.max(years, 1);
  const feesPerYear = r.fees / feeYears;
  if (r.invested > 0 && feesPerYear / r.invested > 0.005 && feesPerYear > 2000) {
    issues.push({
      id: "fees",
      severity: feesPerYear / r.invested > 0.01 ? "warn" : "info",
      area: "Расходы",
      title: `Комиссии ${shortRub(feesPerYear)} в год — ${pct(feesPerYear / r.invested, { digits: 2 })} от вложенного`,
      text: `За всё время ушло ${shortRub(r.fees)}${r.fees - r.tradeFees > 1000 ? `, из них ${shortRub(r.fees - r.tradeFees)} — плата за обслуживание` : ""}. Это вычитается из доходности каждый год.`,
      action: "Проверьте тариф брокера: при редких покупках выгоднее тариф без абонплаты. Покупайте реже и крупнее.",
    });
  }

  // 11. ИИС
  if (!p.accounts.some((a) => a.kind === "iis") && total > 100_000) {
    issues.push({
      id: "iis",
      severity: "info",
      area: "Налоги",
      title: "Нет ИИС — упускаете вычет",
      text: "ИИС-3 даёт вычет 13 % от пополнений — до 52 000 ₽ в год с 400 000 ₽ (если вы платите НДФЛ с зарплаты), а доход на нём освобождается от налога при сроке от 5 лет (для новых счетов срок растёт до 10).",
      action: "Если деньги не понадобятся 5+ лет — откройте ИИС и пополняйте его вместо брокерского счёта.",
    });
  }

  // 12. Льгота долгосрочного владения: скоро 3 года
  const ldv = r.holdings.filter((h) => h.firstBuy && profitOf(h) > 10_000 && addYears(h.firstBuy, 3) > today && addYears(h.firstBuy, 3) < addDays(today, 200));
  if (ldv.length) {
    issues.push({
      id: "ldv",
      severity: "info",
      area: "Налоги",
      title: "Скоро можно будет продать без налога",
      text: "Бумаги, которыми вы владеете больше 3 лет, можно продать без НДФЛ с прибыли (льгота долгосрочного владения). У этих бумаг 3 года скоро наступят — не продавайте раньше без нужды.",
      items: ldv.map((h) => ({ id: h.id, name: h.instrument.name, detail: `с ${fmtDate(addYears(h.firstBuy!, 3))} · налог сейчас ≈ ${shortRub(profitOf(h) * (s.taxRate / 100))}` })),
    });
  }

  // 13. Погашения облигаций скоро
  const maturing = r.upcoming.filter((u) => u.event.kind === "maturity" && daysUntil(u.pay) <= 90 && daysUntil(u.pay) >= 0);
  if (maturing.length) {
    issues.push({
      id: "maturity",
      severity: "info",
      area: "Деньги",
      title: `Погашение облигаций на ${shortRub(maturing.reduce((a, u) => a + u.gross, 0))} в ближайшие 3 месяца`,
      text: "Деньги вернутся на счёт. Чтобы они не лежали без дела, заранее решите, во что их вложить.",
      items: maturing.map((u) => ({ id: u.instrument.id, name: u.instrument.name, detail: fmtDate(u.pay) })),
    });
  }

  // 14. Прогноз дохода держится на оценках
  const next = inc.years.find((y) => y.kind === "next");
  if (next && next.forecast > 0 && inc.nextEstimated / next.forecast > 0.85 && next.forecast > 20_000) {
    issues.push({
      id: "forecast",
      severity: "info",
      area: "Доход",
      title: "Доход следующего года пока почти весь — оценка",
      text: `Объявлено и известно точно только ${pct(inc.nextGuaranteed / next.forecast, { digits: 0 })}. Остальное — «как в этом году»: компании могут заплатить и больше, и меньше (ошибка метода на вашей истории ±${pct(inc.averageError ?? 0.25, { digits: 0 })}).`,
      action: "Для предсказуемого дохода добавьте облигации: их купоны известны заранее.",
    });
  }

  // 15. Просадки
  const rk = risk(r, bench, s.riskFreeRate);
  if (rk.maxDrawdown != null && rk.maxDrawdown < -0.3) {
    issues.push({
      id: "drawdown",
      severity: s.risk === "careful" ? "warn" : "info",
      area: "Риск",
      title: `Портфель проседал на ${pct(-rk.maxDrawdown, { digits: 0 })}`,
      text: "Максимальное падение самих бумаг от пика. Спросите себя честно: если это повторится, вы удержитесь от продажи?",
      action: s.risk === "careful" ? "Для осторожного профиля это много — увеличьте долю облигаций." : undefined,
    });
  }

  // Хорошее: регулярные пополнения и рост дохода
  if (inc.averageMonthlyDeposit > 0) {
    const months = new Set(r.transactions.filter((t) => t.type === "deposit" && t.t > addDays(today, -365)).map((t) => t.date.slice(0, 7))).size;
    if (months >= 10) good.push({ id: "regular", severity: "good", area: "Деньги", title: `Пополняете ${months} из 12 месяцев`, text: `В среднем ${shortRub(inc.averageMonthlyDeposit)} в месяц — регулярность важнее удачного момента.` });
  }
  const yrs = inc.years.filter((y) => y.kind === "past");
  if (yrs.length >= 2) {
    const a = yrs[yrs.length - 2];
    const b = yrs[yrs.length - 1];
    if (a.received > 0 && b.received > a.received * 1.1) good.push({ id: "income-up", severity: "good", area: "Доход", title: `Доход растёт: ${b.year} больше ${a.year} на ${pct(b.received / a.received - 1, { digits: 0 })}`, text: "Выплаты на руки год к году." });
  }

  const penalty = { bad: 15, warn: 7, info: 2, good: 0 };
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((a, x) => a + penalty[x.severity], 0)));
  const grade = score >= 85 ? "Отлично" : score >= 70 ? "Хорошо" : score >= 50 ? "Есть что улучшить" : "Нужно внимание";
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, grade, issues, good, classes: split, target };
}
