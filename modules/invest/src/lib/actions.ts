import { daysUntil, fmtDate, monthOf, ms } from "./dates.ts";
import { pct, plural, shortRub } from "./fmt.ts";
import type { Advice } from "./advice.ts";
import type { Report } from "./analytics.ts";
import type { Health, Issue } from "./health.ts";
import type { Income } from "./income.ts";
import type { Mistakes } from "./mistakes.ts";
import type { TaxYear } from "./tax.ts";
import type { OtherAsset, Portfolio, Settings, WatchItem } from "./types.ts";

/*
 * «Что делать сейчас»: всё, что модуль знает о портфеле, сведено в один список действий по приоритету.
 * 1 — срочно (деньги теряются сейчас или скоро дедлайн), 2 — важно, 3 — полезно.
 * id действия стабилен, пока ситуация та же, — так отметка «сделано» не слетает при каждом пересчёте.
 */

export interface Action {
  id: string;
  priority: 1 | 2 | 3;
  icon: string;
  title: string;
  why: string;
  steps: string[];
  link?: { to: string; label: string };
}

const ISSUE_LINK: Record<string, { to: string; label: string }> = {
  concentration: { to: "/ideas", label: "Куда направить деньги" },
  sector: { to: "/ideas?tab=stocks", label: "Акции других отраслей" },
  "too-risky": { to: "/ideas?tab=bonds", label: "Подобрать облигации" },
  "no-defense": { to: "/ideas?tab=bonds", label: "Подобрать облигации" },
  "idle-cash": { to: "/ideas", label: "Что купить" },
  few: { to: "/ideas?tab=stocks", label: "Подбор акций" },
  payer: { to: "/income", label: "Кто платит" },
  losers: { to: "/portfolio", label: "Мои бумаги" },
  "vs-index": { to: "/portfolio?tab=result", label: "Сравнение с рынком" },
  maturity: { to: "/ideas?tab=bonds", label: "Во что реинвестировать" },
  forecast: { to: "/ideas?tab=bonds", label: "Облигации" },
  fees: { to: "/actions?tab=taxes", label: "Налоги и расходы" },
  iis: { to: "/actions?tab=taxes", label: "Налоги" },
  ldv: { to: "/actions?tab=taxes", label: "Налоги" },
};

const ISSUE_ICON: Record<Issue["area"], string> = { Риск: "⚖️", Доход: "💰", Деньги: "💤", Налоги: "🧾", Расходы: "💸", Результат: "📊" };

export function buildActions(input: {
  p: Portfolio;
  r: Report;
  inc: Income;
  health: Health;
  mistakes: Mistakes;
  tax: TaxYear;
  advice: Map<string, Advice>;
  settings: Settings;
  other: OtherAsset[];
  watch: WatchItem[];
  keyRate: number;
  today?: number;
}): Action[] {
  const { p, r, inc, health, mistakes, tax, advice, settings, other, watch } = input;
  const today = input.today ?? Date.now();
  const out: Action[] = [];

  // Устаревшие данные — всё остальное может врать
  if (p.updatedAt && today - ms(p.updatedAt) > 7 * 86_400_000) {
    out.push({ id: `stale-${p.updatedAt.slice(0, 10)}`, priority: 2, icon: "🔄", title: "Обновите данные", why: `Последнее обновление — ${fmtDate(p.updatedAt)}. Цены, выплаты и советы считаются по старым данным.`, steps: ["Нажмите ↻ вверху страницы."] });
  }

  // Подушка безопасности
  const liquid = other.filter((a) => a.kind === "deposit" || a.kind === "cash").reduce((a, x) => a + x.amount, 0) + Math.max(0, r.cashRUB);
  if (settings.monthlyExpenses > 0) {
    const months = liquid / settings.monthlyExpenses;
    if (months < 3) {
      out.push({
        id: "cushion",
        priority: 1,
        icon: "🛟",
        title: `Подушка безопасности — всего ${months.toFixed(1).replace(".", ",")} мес. расходов`,
        why: `Вклады, наличные и свободные деньги на счетах — ${shortRub(liquid)}. Если внезапно понадобятся деньги (болезнь, потеря работы), придётся продавать бумаги — возможно, в минус.`,
        steps: [`Соберите 3–6 месяцев расходов: ${shortRub(settings.monthlyExpenses * 3)}–${shortRub(settings.monthlyExpenses * 6)} на вкладе или накопительном счёте.`, "Пока подушки нет, пополнения лучше направлять туда, а не в акции."],
        link: { to: "/settings", label: "Мои сбережения" },
      });
    }
  } else {
    out.push({ id: "expenses", priority: 3, icon: "🛟", title: "Укажите расходы в месяц", why: "Тогда модуль проверит подушку безопасности и покажет, какую часть расходов уже покрывают дивиденды.", steps: ["⚙︎ → «Мои сбережения» → расходы в месяц."], link: { to: "/settings", label: "Указать" } });
  }

  // Налоги: дедлайн 31 декабря
  const month = monthOf(today);
  if (month >= 10 && tax.harvestSaved > 1000) {
    out.push({
      id: `harvest-${tax.year}`,
      priority: 1,
      icon: "🧾",
      title: `До 31 декабря можно сэкономить ≈ ${shortRub(tax.harvestSaved)} налога`,
      why: `В этом году прибыль от продаж ≈ ${shortRub(tax.gains)}, налог ≈ ${shortRub(tax.taxSales)}. Продажа бумаг в убытке уменьшит его (сальдирование). Бумагу можно сразу купить обратно — доля не изменится, а налог снизится.`,
      steps: tax.harvest.slice(0, 4).map((h) => `${h.name}: убыток ${shortRub(h.loss)} → экономия ≈ ${shortRub(h.saved)}`),
      link: { to: "/actions?tab=taxes", label: "Налоги" },
    });
  }
  if (tax.hasIis && month >= 9 && tax.iisDeposits < 400_000) {
    out.push({
      id: `iis-${tax.year}`,
      priority: 3,
      icon: "🧾",
      title: `Довнесите на ИИС до конца года — вычет до ${shortRub(52_000 - tax.iisDeduction)}`,
      why: `В ${tax.year} вы внесли на ИИС ${shortRub(tax.iisDeposits)}. Вычет — 13 % от взносов до 400 000 ₽ в год (если вы платите НДФЛ с зарплаты).`,
      steps: ["Пополните ИИС до 31 декабря.", "Вычет оформляется в следующем году через Госуслуги или брокера."],
    });
  }

  // Проблемы портфеля
  for (const i of health.issues) {
    if (i.id === "iis" && tax.hasIis) continue;
    out.push({
      id: `issue-${i.id}`,
      priority: i.severity === "bad" ? 1 : i.severity === "warn" ? 2 : 3,
      icon: ISSUE_ICON[i.area] ?? "•",
      title: i.title,
      why: i.text,
      steps: [i.action, ...(i.items ?? []).slice(0, 5).map((x) => `${x.name} — ${x.detail}`)].filter((x): x is string => !!x),
      link: ISSUE_LINK[i.id],
    });
  }

  // Бумаги, которые стоит перепроверить
  for (const h of r.holdings) {
    const a = advice.get(h.id);
    if (!a || a.verdict !== "review") continue;
    out.push({ id: `review-${h.id}`, priority: 2, icon: "🔍", title: h.instrument.type === "bond" ? `${h.instrument.name}: рискованная облигация` : `${h.instrument.name}: перепроверьте, зачем держите`, why: a.summary, steps: a.steps, link: { to: `/asset/${encodeURIComponent(h.id)}`, label: "Открыть бумагу" } });
  }

  // Следующее пополнение
  const avg = Math.round(inc.averageMonthlyDeposit / 1000) * 1000;
  if (avg > 0) {
    out.push({
      id: `next-deposit-${new Date(today).toISOString().slice(0, 7)}`,
      priority: 2,
      icon: "💡",
      title: `Куда вложить следующее пополнение (${shortRub(avg)})`,
      why: "Направляйте новые деньги туда, где недобор, — так портфель выравнивается без продаж и налогов.",
      steps: ["Откройте «Идеи» — там распределение по классам и конкретные бумаги."],
      link: { to: "/ideas", label: "Идеи" },
    });
  }

  // Список наблюдения: цена дошла до цели
  for (const w of watch) {
    if (w.target && w.price && w.price <= w.target) {
      out.push({ id: `watch-${w.ticker}-${w.target}`, priority: 2, icon: "🎯", title: `${w.name} подешевела до вашей цены`, why: `Сейчас ${w.price.toLocaleString("ru-RU")} ₽, ваша цель — ${w.target.toLocaleString("ru-RU")} ₽.${w.note ? ` Заметка: ${w.note}` : ""}`, steps: ["Проверьте свежие новости компании — цена падает не просто так.", "Если причина покупки в силе — можно покупать частями."], link: { to: "/ideas?tab=watch", label: "Список наблюдения" } });
    }
  }

  // Отсечки ближайших двух недель
  const soonRecords = r.upcoming.filter((u) => u.event.kind === "dividend" && daysUntil(u.event.recordDate) >= 0 && daysUntil(u.event.recordDate) <= 14);
  if (soonRecords.length) {
    out.push({
      id: `records-${soonRecords.map((u) => u.id).join(",")}`,
      priority: 3,
      icon: "📅",
      title: `${soonRecords.length} ${plural(soonRecords.length, ["отсечка", "отсечки", "отсечек"])} в ближайшие 2 недели`,
      why: "Чтобы получить дивиденды, бумага должна быть у вас на дату отсечки. Не продавайте их до этого дня.",
      steps: soonRecords.map((u) => `${u.instrument.name}: ${fmtDate(u.event.recordDate)} → ≈ ${shortRub(u.net)} на руки`),
      link: { to: "/income?tab=calendar", label: "Календарь" },
    });
  }

  // Привычки, которые стоят денег
  for (const l of mistakes.lessons.filter((x) => x.tone === "bad" || x.tone === "warn").slice(0, 2)) {
    out.push({ id: `habit-${l.id}`, priority: 3, icon: "🧠", title: `Привычка: ${l.title.charAt(0).toLowerCase()}${l.title.slice(1)}`, why: l.text, steps: [l.lesson], link: { to: "/actions?tab=mistakes", label: "Мои ошибки" } });
  }

  // Доход покрывает расходы — повод для радости, не задача
  const next = inc.years.find((y) => y.kind === "next");
  if (settings.monthlyExpenses > 0 && next && next.forecast > 0) {
    const cover = next.forecast / 12 / settings.monthlyExpenses;
    if (cover >= 0.1) out.push({ id: `cover-${Math.floor(cover * 10)}`, priority: 3, icon: "🎉", title: `Выплаты покрывают ${pct(cover, { digits: 0 })} ваших расходов`, why: `≈ ${shortRub(next.forecast / 12)} в месяц против расходов ${shortRub(settings.monthlyExpenses)}.`, steps: ["Продолжайте пополнять и реинвестировать выплаты."], link: { to: "/income?tab=goal", label: "Цель" } });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export const PRIORITY: Record<1 | 2 | 3, [string, string]> = {
  1: ["Срочно", "inv-tag-red"],
  2: ["Важно", "inv-tag-orange"],
  3: ["Полезно", "inv-tag-blue"],
};
