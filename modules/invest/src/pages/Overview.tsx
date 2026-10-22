import { Link, Loading, cn, useStore } from "@lifehub/sdk";
import { VerdictTag } from "../components/Verdict.tsx";
import { ActionCard } from "./Actions.tsx";
import { Avatar, Btn, Delta, Header, Panel, PctTone, Screen, Seg, Stat } from "../components/ui.tsx";
import { ScoreRing, TimeChart, Legend } from "../components/charts.tsx";
import { useState } from "react";
import { reportProfit, reportProfitPct, sameMoneyInIndex } from "../lib/analytics.ts";
import { addYears, daysUntil, fmtDate, ms } from "../lib/dates.ts";
import { pct, plural, rub, shortRub } from "../lib/fmt.ts";
import { yearTotal } from "../lib/income.ts";
import { useInvest } from "../lib/store.tsx";
import { loadDemo, useRun } from "../lib/sync.ts";
import { STATUS_TITLE } from "../lib/types.ts";

export function Overview() {
  const ctx = useInvest();
  const { loading, hasData } = ctx;
  if (loading) return <Loading />;
  if (!hasData) return <Welcome />;
  return <Dashboard />;
}

function Dashboard() {
  const { report: r, income: inc, health, settings, market, portfolio, previousVisit, actions, done, setDone, otherAll: other, lastMonth, thisMonth, advice } = useInvest();
  const [range, setRange] = useState<"1y" | "3y" | "all">("all");
  const [guide, setGuide] = useStore<boolean>("guideSeen", false);
  const [monthMode, setMonthMode] = useState<"last" | "this">("last");
  const profit = reportProfit(r);
  const cy = inc.currentYear;
  const current = inc.years.find((y) => y.kind === "current");
  const next = inc.years.find((y) => y.kind === "next");
  const idx = sameMoneyInIndex(r, market.benchmarks[settings.benchmark]);
  const since = range === "1y" ? addYears(Date.now(), -1) : range === "3y" ? addYears(Date.now(), -3) : 0;
  const hist = r.history.filter((h) => h.t >= since);
  const recentDays = previousVisit ? Math.max(1, Math.round((Date.now() - previousVisit) / 86_400_000)) : 0;
  const openActions = actions.filter((a) => !done[a.id]);
  const otherTotal = other.reduce((a, x) => a + x.amount, 0);
  const month = monthMode === "last" ? lastMonth : thisMonth;
  const cover = settings.monthlyExpenses > 0 && next ? next.forecast / 12 / settings.monthlyExpenses : null;

  return (
    <Screen>
      <Header title="Инвестиции" question={portfolio.isDemo ? "Демо-портфель — подключите свои счета в ⚙︎" : undefined} />

      <Link to="/check" className="inv-panel mb-4 flex items-center gap-3 border-[var(--inv-green-soft)] p-4 transition-colors hover:border-[var(--inv-green)]">
        <span className="text-2xl">🛑</span>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold">Хочу купить или продать</div>
          <div className="inv-muted text-[13px]">Сначала проверьте: доля, налог, цена за год, ваши прошлые сделки — за 10 секунд</div>
        </div>
        <span className="text-lg font-bold text-[var(--inv-green)]">→</span>
      </Link>

      {!guide && (
        <section className="inv-panel inv-fade-in mb-4 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🧭</span>
            <div className="min-w-0 flex-1">
              <div className="font-extrabold">Как тут всё устроено</div>
              <ol className="inv-muted mt-1 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed">
                <li>
                  <b className="text-[var(--inv-fg)]">Обзор</b> — сколько стоит портфель и что делать в первую очередь.
                </li>
                <li>
                  <b className="text-[var(--inv-fg)]">Что делать</b> — шаги по приоритету, проверка портфеля, ваши ошибки, налоги и мнение ИИ.
                </li>
                <li>
                  <b className="text-[var(--inv-fg)]">Портфель</b> — бумаги со значком «докупать / держать / сократить». Нажмите на бумагу — объясним почему.
                </li>
                <li>
                  <b className="text-[var(--inv-fg)]">Доход</b> — дивиденды и купоны: сколько пришло, сколько придёт, календарь, цель.
                </li>
                <li>
                  <b className="text-[var(--inv-fg)]">Идеи</b> — куда вложить деньги: распределение, облигации, акции, список наблюдения.
                </li>
              </ol>
              <p className="inv-faint mt-2 text-xs">У карточек есть «?» — там объяснение простыми словами. Термины — в ⚙︎ → «Словарь».</p>
            </div>
            <Btn small ghost onClick={() => setGuide(true)} aria-label="Скрыть подсказку">
              ✕
            </Btn>
          </div>
        </section>
      )}

      {inc.sinceVisitCount > 0 && inc.sinceVisitAmount > 0 && (
        <div className="inv-fade-in mb-4 flex items-center gap-3 rounded-2xl border border-[var(--inv-gold-soft)] bg-[var(--inv-gold-soft)] p-3 text-sm">
          <span className="text-2xl">🪙</span>
          <div>
            С прошлого визита {recentDays <= 1 ? "(вчера)" : `(${recentDays} ${plural(recentDays, ["день", "дня", "дней"])} назад)`} пришло{" "}
            <b className="inv-gold inv-num">{rub(inc.sinceVisitAmount)}</b> — {inc.sinceVisitCount} {plural(inc.sinceVisitCount, ["выплата", "выплаты", "выплат"])}
          </div>
        </div>
      )}

      <section className="inv-panel overflow-hidden p-4 sm:p-6">
        <div className="inv-label">Портфель стоит</div>
        <div className="inv-num mt-1 text-[38px] font-extrabold leading-none tracking-tight sm:text-5xl">{rub(r.totalValue)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {Math.abs(r.dayChange) > 1 && (
            <span>
              <Delta value={r.dayChange} short /> <span className="inv-muted">за день</span>
            </span>
          )}
          <span>
            <Delta value={profit} pctValue={reportProfitPct(r)} short /> <span className="inv-muted">заработано за всё время</span>
          </span>
        </div>
        {otherTotal > 0 && (
          <div className="inv-muted mt-1 text-sm">
            Весь капитал с вкладами и недвижимостью: <b className="inv-num text-[var(--inv-fg)]">{shortRub(r.totalValue + otherTotal)}</b>
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Вложено своих" value={shortRub(r.invested)} hint="пополнения минус выводы" />
          <Stat label="Доходность в год" value={<PctTone value={r.xirr} />} hint={idx?.xirr != null ? `индекс на те же деньги — ${pct(idx.xirr)}` : "с учётом пополнений"} />
          <Stat label="Выплаты за всё время" value={<span className="inv-gold">{shortRub(inc.allTime)}</span>} hint="на руки" />
          <Stat label="Свободные деньги" value={shortRub(r.cashRUB)} hint={r.cashRUB > r.totalValue * 0.05 ? "лежат без дохода" : "на счетах"} />
        </div>
        {hist.length > 2 && (
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Legend items={[{ color: "var(--inv-blue)", label: "Стоимость" }, { color: "var(--inv-muted)", label: "Вложено", dashed: true }]} />
              <Seg value={range} onChange={setRange} options={[["1y", "Год"], ["3y", "3 года"], ["all", "Всё"]]} />
            </div>
            <TimeChart
              height={180}
              series={[
                { name: "Стоимость", color: "var(--inv-blue)", area: true, points: hist.map((h) => [h.t, h.value]) },
                { name: "Вложено", color: "var(--inv-muted)", dashed: true, points: hist.map((h) => [h.t, h.invested]) },
              ]}
            />
            <p className="inv-faint mt-1 text-xs">Разрыв между линиями — ваш заработок: синяя выше пунктира — вы в плюсе.</p>
          </div>
        )}
      </section>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="inv-title text-xl">Что делать сейчас</h2>
        <Link to="/actions" className="text-sm font-bold text-[var(--inv-green)]">
          Весь план ({openActions.length}) →
        </Link>
      </div>
      <div className="space-y-2">
        {openActions.slice(0, 3).map((a) => (
          <ActionCard key={a.id} a={a} compact onDone={() => setDone({ ...done, [a.id]: Date.now() })} />
        ))}
        {!openActions.length && (
          <Panel>
            <div className="py-2 text-center text-sm">Всё сделано 🎉</div>
          </Panel>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Link to="/actions?tab=check" className="inv-panel block p-4 transition-colors hover:border-[var(--inv-faint)] sm:p-5">
          <div className="flex items-center gap-4">
            <ScoreRing score={health.score} size={84} />
            <div className="min-w-0">
              <div className="inv-label">Оценка портфеля</div>
              <div className="text-xl font-extrabold">{health.grade}</div>
              <div className="inv-muted text-sm">Перекосы, риск, расходы и налоги</div>
            </div>
          </div>
          <div className="mt-3 text-sm font-bold text-[var(--inv-green)]">Подробная проверка →</div>
        </Link>

        <Link to="/income" className="inv-panel block p-4 transition-colors hover:border-[var(--inv-faint)] sm:p-5">
          <div className="inv-label">Дивиденды и купоны, на руки</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="inv-muted text-[13px] font-semibold">Получено в {cy}</div>
              <div className="inv-num inv-gold text-2xl font-extrabold">{shortRub(inc.ytd)}</div>
              <div className="inv-muted text-xs">
                {inc.ytdPrev > 0 ? (
                  <>
                    к этой дате в {cy - 1}: {shortRub(inc.ytdPrev)} (<PctTone value={inc.ytd / inc.ytdPrev - 1} digits={0} />)
                  </>
                ) : (
                  "в прошлом году к этой дате выплат не было"
                )}
              </div>
            </div>
            <div>
              <div className="inv-muted text-[13px] font-semibold">Ждём в {cy + 1}</div>
              <div className="inv-num text-2xl font-extrabold">{next ? shortRub(next.forecast) : "—"}</div>
              <div className="inv-muted text-xs">{next && next.forecast > 0 ? `≈ ${shortRub(next.forecast / 12)} в месяц` : "нет данных"}</div>
            </div>
          </div>
          {cover != null ? (
            <div className="inv-soft mt-3 px-3 py-2 text-[13px]">
              Выплаты покрывают <b>{pct(cover, { digits: 0 })}</b> ваших расходов в месяц
            </div>
          ) : (
            current &&
            current.expected > 0 && (
              <div className="inv-soft mt-3 px-3 py-2 text-[13px]">
                До конца {cy} ещё придёт <b className="inv-num">{shortRub(current.expected)}</b>
              </div>
            )
          )}
        </Link>
      </div>

      {month && (
        <Panel
          className="mt-4"
          title={`Итоги: ${month.title}`}
          info="Что произошло за месяц: сколько пришло выплат, сколько вы внесли, сколько заработал или потерял сам рынок (без учёта ваших пополнений), кто вырос и упал сильнее всего."
          right={<Seg value={monthMode} onChange={setMonthMode} options={[["last", "Прошлый"], ["this", "Этот"]]} />}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Пришло выплат" value={<span className="inv-gold">{shortRub(month.income)}</span>} hint={`${month.incomeCount} ${plural(month.incomeCount, ["выплата", "выплаты", "выплат"])}`} />
            <Stat label="Вы внесли" value={shortRub(month.deposits)} />
            <Stat label="Рынок дал" value={<Delta value={month.marketChange} short />} hint="без ваших пополнений" />
            <Stat label="Стоимость" value={shortRub(month.valueEnd)} hint={`была ${shortRub(month.valueStart)}`} />
          </div>
          {(month.best || month.worst) && (
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
              {month.best && month.best.change > 0 && (
                <Link to={`/asset/${encodeURIComponent(month.best.id)}`} className="inv-soft px-3 py-1.5">
                  🚀 {month.best.name} <PctTone value={month.best.change} />
                </Link>
              )}
              {month.worst && month.worst.change < 0 && (
                <Link to={`/asset/${encodeURIComponent(month.worst.id)}`} className="inv-soft px-3 py-1.5">
                  📉 {month.worst.name} <PctTone value={month.worst.change} />
                </Link>
              )}
            </div>
          )}
        </Panel>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Ближайшие выплаты" right={<Link to="/income?tab=calendar" className="text-sm font-bold text-[var(--inv-green)]">Календарь</Link>}>
          {inc.soon.length ? (
            inc.soon.slice(0, 5).map((p) => {
              const inst = portfolio.instruments[p.instrumentId ?? ""];
              const dleft = daysUntil(p.t);
              return (
                <div key={p.key} className="inv-row">
                  <Avatar ticker={inst?.ticker ?? p.name} type={inst?.type} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{p.name}</div>
                    <div className="inv-muted text-xs">
                      {fmtDate(p.t)} · {dleft === 0 ? "сегодня" : `через ${dleft} ${plural(dleft, ["день", "дня", "дней"])}`} · {p.kind}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="inv-num inv-gold text-sm font-extrabold">+{rub(p.amount)}</div>
                    <span className={cn("inv-tag", p.status === "declared" ? "inv-tag-green" : "")}>{STATUS_TITLE[p.status ?? "forecast"]}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="inv-muted py-4 text-sm">Объявленных и ожидаемых выплат пока нет.</div>
          )}
        </Panel>

        <Panel title="Крупнейшие позиции" right={<Link to="/portfolio" className="text-sm font-bold text-[var(--inv-green)]">Все бумаги</Link>}>
          {r.holdings.slice(0, 5).map((h) => (
            <Link key={h.id} to={`/asset/${encodeURIComponent(h.id)}`} className="inv-row inv-link-row">
              <Avatar ticker={h.instrument.ticker} type={h.instrument.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{h.instrument.name}</div>
                <div className="inv-muted text-xs">{pct(h.weight, { digits: 0 })} портфеля</div>
              </div>
              {advice.get(h.id) && <VerdictTag v={advice.get(h.id)!.verdict} />}
            </Link>
          ))}
        </Panel>
      </div>
      {portfolio.updatedAt && (
        <p className="inv-faint mt-4 text-center text-xs">
          Обновлено {fmtDate(ms(portfolio.updatedAt), { year: "never" })}, {new Date(ms(portfolio.updatedAt)).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </Screen>
  );
}

function Welcome() {
  const run = useRun();
  return (
    <Screen>
      <Header title="Инвестиции" question="Все ваши брокерские счета в одном месте" />
      <section className="inv-panel p-5 sm:p-7">
        <div className="text-4xl">📈</div>
        <h2 className="inv-title mt-3 text-2xl">Соберите портфель за минуту</h2>
        <p className="inv-muted mt-2 max-w-xl text-[15px] leading-relaxed">
          Подключите Т-Банк и БКС токенами «только для чтения» — модуль сам загрузит счета, сделки, дивиденды и купоны, а потом покажет: сколько вы получаете и получите, что не так с портфелем, какие ошибки стоили денег и куда разумно вложить следующее пополнение.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["💰", "Доход", "получено, ожидается, прогноз на год с честным диапазоном"],
            ["🩺", "Разбор", "перекосы, лишние комиссии, налоги, ошибки прошлых сделок"],
            ["💡", "Идеи", "куда направить деньги под ваш риск: акции, ОФЗ, фонды"],
          ].map(([icon, t, d]) => (
            <div key={t} className="inv-soft p-3">
              <div className="text-xl">{icon}</div>
              <div className="mt-1 font-extrabold">{t}</div>
              <div className="inv-muted text-[13px]">{d}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link to="/settings" className="inv-btn inv-btn-main">
            Подключить счета
          </Link>
          <Btn loading={run.busy} onClick={() => loadDemo()}>
            Посмотреть на демо-портфеле
          </Btn>
        </div>
        <p className="inv-faint mt-4 text-xs leading-relaxed">Демо удалится само при первой загрузке ваших счетов. Токены хранятся в хабе на вашем компьютере.</p>
      </section>
    </Screen>
  );
}
