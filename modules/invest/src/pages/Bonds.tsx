import { Link, cn } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { Avatar, Btn, Details, Field, NumInput, Panel, Seg, Stat } from "../components/ui.tsx";
import { KIND_HINT, KIND_TITLE, RISK_LABEL, effectiveEnd, heldBondNote, pickBonds, rateCorp, years, type BondGoal } from "../lib/bonds.ts";
import { fmtDate, ms } from "../lib/dates.ts";
import { num, pct, qty, rub, shortRub } from "../lib/fmt.ts";
import { classSplit, MODEL } from "../lib/health.ts";
import { bondKind, type OfzRow } from "../lib/moex.ts";
import { useInvest } from "../lib/store.tsx";
import { useMarketLoaders } from "./Ideas.tsx";
import { VerdictTag } from "../components/Verdict.tsx";

const HORIZONS: [string, string][] = [
  ["1", "до 1 года"],
  ["3", "1–3 года"],
  ["5", "3–5 лет"],
  ["10", "5+ лет"],
];

/** «В какие облигации вложить»: сумма + когда понадобятся деньги → конкретные выпуски. */
export function BondsAdvisor() {
  const { bonds, keyRate, report: r, settings, income, advice } = useInvest();
  const loaders = useMarketLoaders();
  const split = classSplit(r);
  const total = Object.values(split).reduce((a, b) => a + b, 0) || 1;
  const gap = Math.max(0, MODEL[settings.risk].bonds * total - split.bonds);
  const def = Math.round(Math.max(10_000, Math.min(gap || income.averageMonthlyDeposit || 50_000, 1_000_000)) / 5000) * 5000;
  const [amount, setAmount] = useState(def);
  const [horizon, setHorizon] = useState("3");
  const [goal, setGoal] = useState<BondGoal>("safe");
  const ofz = bonds?.rows ?? [];
  const corp = bonds?.corp ?? [];
  const plan = useMemo(() => pickBonds({ ofz, corp, amount, horizon: +horizon, goal, keyRate }), [ofz, corp, amount, horizon, goal, keyRate]);
  const stale = !bonds || Date.now() - ms(bonds.updatedAt) > 3 * 86_400_000 || !bonds.corp;
  const held = r.holdings.filter((h) => h.instrument.type === "bond");
  const couponsTotal = plan.picks.reduce((a, p) => a + p.couponsYear, 0);
  const invested = plan.picks.reduce((a, p) => a + p.amount, 0) + (plan.fund?.amount ?? 0);

  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <p className="text-sm leading-relaxed">
          Облигация — это заём государству или компании: вы получаете купоны по графику, а в конце вам возвращают номинал (обычно 1000 ₽). Если держать до погашения, доход известен заранее. Здесь можно подобрать конкретные выпуски под вашу цель.
        </p>
        {gap > 1000 && (
          <div className="inv-soft mt-3 px-3 py-2 text-[13px]">
            Для профиля риска у вас не хватает облигаций примерно на <b className="inv-num">{shortRub(gap)}</b> — сумма подставлена.
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Сколько вложить">
            <NumInput value={amount} onChange={setAmount} suffix="₽" min={0} />
          </Field>
          <Field label="Когда понадобятся деньги" hint="облигации подбираются с погашением к этому сроку">
            <Seg value={horizon} onChange={setHorizon} options={HORIZONS} />
          </Field>
          <Field label="Что важнее" hint={goal === "safe" ? "только ОФЗ — гарантия государства" : "+ облигации крупных компаний, около 40 % суммы"}>
            <Seg value={goal} onChange={setGoal} options={[["safe", "Надёжность"], ["income", "Больше дохода"]]} />
          </Field>
        </div>
        {stale && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="inv-muted">{bonds ? "Данные с биржи устарели." : "Нужны данные с биржи."}</span>
            <Btn small main loading={loaders.busy === "bonds"} onClick={loaders.bonds}>
              Загрузить облигации
            </Btn>
          </div>
        )}
      </section>

      {plan.view && (
        <div className="inv-soft p-3 text-[13px] leading-relaxed">
          <b>Что сейчас на рынке. </b>
          {plan.view}
        </div>
      )}

      {(plan.picks.length > 0 || plan.fund) && (
        <Panel title="Наш выбор" info="Лесенка: сумма делится на несколько выпусков с разными сроками погашения. Деньги возвращаются частями — их можно забрать или переложить по новой ставке. Доходность к погашению — сколько вы получите в год, если держать до конца (до налога 13 % с купонов).">
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Вложите" value={shortRub(invested)} hint={plan.leftover > 100 ? `останется ${shortRub(plan.leftover)}` : undefined} />
            <Stat label="Средняя доходность" value={<span className="inv-gold">{pct(plan.yieldAvg)}</span>} hint="в год, если держать" />
            <Stat label="Купоны" value={shortRub(couponsTotal)} hint={`в год · ≈ ${shortRub(couponsTotal / 12)} в месяц`} />
            <Stat label="На руки с купонов" value={shortRub(couponsTotal * (1 - settings.taxRate / 100))} hint="после НДФЛ, в год" />
          </div>
          <div className="space-y-2">
            {plan.fund && (
              <div className="inv-soft p-3">
                <div className="flex items-center gap-3">
                  <Avatar ticker={plan.fund.ticker} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold">{plan.fund.name}</div>
                    <span className="inv-tag inv-tag-green">почти без риска</span>
                  </div>
                  <div className="inv-num text-sm font-extrabold">{shortRub(plan.fund.amount)}</div>
                </div>
                <ul className="mt-2 space-y-0.5 text-[13px]">
                  {plan.fund.why.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.picks.map((p) => {
              const [rl, rt] = RISK_LABEL[p.risk];
              return (
                <div key={p.bond.secid} className="inv-soft p-3">
                  <div className="flex items-center gap-3">
                    <Avatar ticker={p.bond.secid} type="bond" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-extrabold">{p.bond.name}</div>
                      <div className="flex flex-wrap gap-1">
                        <span className={cn("inv-tag", rt)}>{rl}</span>
                        <span className="inv-tag inv-tag-gold">{pct(p.bond.yield)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="inv-num text-sm font-extrabold">{shortRub(p.amount)}</div>
                      <div className="inv-muted text-xs">
                        {qty(p.units)} шт × {rub((p.bond.price * p.bond.face) / 100)}
                      </div>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[13px]">
                    {p.why.map((w) => (
                      <li key={w}>• {w}</li>
                    ))}
                    <li>
                      • купоны ≈ <b>{shortRub(p.couponsYear)}</b> в год; к {fmtDate(p.end, { year: "always" })} будет ≈ <b>{shortRub(p.atEnd)}</b> (до налога)
                    </li>
                  </ul>
                  {p.risks.map((x) => (
                    <div key={x} className="mt-1 text-xs text-[var(--inv-orange)]">
                      Риск: {x}
                    </div>
                  ))}
                  <div className="inv-faint mt-1 text-xs">Код для поиска у брокера: {p.bond.secid}</div>
                </div>
              );
            })}
          </div>
          <Details summary="Как купить" className="mt-3">
            <ol className="inv-muted list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
              <li>В приложении брокера найдите облигацию по коду (например, SU26238RMFS4) или названию.</li>
              <li>Цена указана в процентах от номинала: 95 % при номинале 1000 ₽ — это 950 ₽ за штуку.</li>
              <li>Сверху вы заплатите накопленный купонный доход (НКД) — он вернётся с ближайшим купоном.</li>
              <li>Держите до погашения: тогда колебания цены не важны, вам вернут номинал.</li>
            </ol>
          </Details>
        </Panel>
      )}
      {!plan.picks.length && !plan.fund && bonds && <Panel><div className="inv-muted py-3 text-sm">Под такие условия ничего не нашлось — попробуйте другой срок.</div></Panel>}

      {held.length > 0 && (
        <Panel title="Ваши облигации">
          {held.map((h) => {
            const b = ofz.find((x) => x.secid === h.instrument.ticker) ?? corp.find((x) => x.secid === h.instrument.ticker);
            const adv = advice.get(h.id);
            return (
              <Link key={h.id} to={`/asset/${encodeURIComponent(h.id)}`} className="inv-row inv-link-row">
                <Avatar ticker={h.instrument.ticker} type="bond" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold">{h.instrument.name}</span>
                    {adv && <VerdictTag v={adv.verdict} className="flex-none" />}
                  </div>
                  <div className="inv-muted text-xs leading-snug">{adv?.summary ?? heldBondNote(b, keyRate, h.instrument.maturityDate)}</div>
                </div>
                <div className="inv-num text-sm font-bold">{shortRub(h.value)}</div>
              </Link>
            );
          })}
        </Panel>
      )}

      {bonds && <AllBonds ofz={ofz} corp={corp} />}
    </div>
  );
}

function AllBonds({ ofz, corp }: { ofz: OfzRow[]; corp: OfzRow[] }) {
  const [kind, setKind] = useState<"fixed" | "floater" | "linker" | "corp">("fixed");
  const rated = useMemo(() => rateCorp(corp, ofz), [corp, ofz]);
  const ok = rated.filter((c) => c.risk !== "junk");
  const junk = rated.filter((c) => c.risk === "junk");
  const list = kind === "corp" ? [] : ofz.filter((b) => bondKind(b) === kind).sort((a, b) => ms(a.matDate) - ms(b.matDate));
  return (
    <Panel title="Все облигации" info="Корпоративные: только первый уровень листинга, фиксированный купон и реальные сделки за день. Риск оценивается по премии к ОФЗ того же срока: чем больше рынок требует сверху, тем сильнее он сомневается в компании.">
      <Seg
        value={kind}
        onChange={setKind}
        className="mb-3"
        options={[
          ["fixed", "ОФЗ"],
          ["floater", "ОФЗ-ПК"],
          ["linker", "ОФЗ-ИН"],
          ["corp", "Компании"],
        ]}
      />
      {kind !== "corp" ? (
        <>
          <p className="inv-muted mb-2 text-[13px] leading-relaxed">
            <b className="text-[var(--inv-fg)]">{KIND_TITLE[kind]}.</b> {KIND_HINT[kind]}
          </p>
          <div className="inv-scroll-x">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Выпуск</th>
                  <th className="r">{kind === "fixed" ? "Доходность" : "Купон"}</th>
                  <th className="r">Цена</th>
                  <th className="r">Погашение</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.secid}>
                    <td className="min-w-[7.5rem]">
                      <div className="whitespace-nowrap font-bold">{b.name}</div>
                      <div className="inv-faint text-xs">{b.secid}</div>
                    </td>
                    <td className="r inv-num inv-gold font-extrabold">{kind === "fixed" ? pct(b.yield) : b.couponPct ? pct(b.couponPct) : "—"}</td>
                    <td className="r inv-num">{num(b.price, 2)} %</td>
                    <td className="r inv-num whitespace-nowrap">
                      {fmtDate(b.matDate, { year: "always" })}
                      <div className="inv-muted text-xs">{num(years(b.matDate), 1)} г.</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <div className="inv-muted py-3 text-sm">Нет данных — загрузите облигации.</div>}
          </div>
        </>
      ) : (
        <>
          <p className="inv-muted mb-2 text-[13px] leading-relaxed">Купон выше, чем у ОФЗ, — это плата за риск, что компания не сможет заплатить. Держите на одного эмитента не больше 5–10 % портфеля.</p>
          <CorpTable rows={ok} />
          {junk.length > 0 && (
            <Details summary={`Слишком доходные — осторожно (${junk.length})`} className="mt-3">
              <p className="inv-muted mb-2 text-[13px]">Доходность выше ОФЗ больше чем на 6 п.п. Обычно так бывает, когда рынок всерьёз опасается дефолта: цена упала, и формальная доходность выросла. Это ставка на выживание компании, а не надёжный доход.</p>
              <CorpTable rows={junk} />
            </Details>
          )}
        </>
      )}
    </Panel>
  );
}

function CorpTable({ rows }: { rows: ReturnType<typeof rateCorp> }) {
  return (
    <div className="inv-scroll-x">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Выпуск</th>
            <th className="r">Доходность</th>
            <th className="r">Над ОФЗ</th>
            <th className="r">Срок</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((c) => {
            const [rl, rt] = RISK_LABEL[c.risk];
            return (
              <tr key={c.bond.secid}>
                <td className="min-w-[8rem]">
                  <div className="whitespace-nowrap font-bold">{c.bond.name}</div>
                  <span className={cn("inv-tag", rt)}>{rl}</span>
                </td>
                <td className="r inv-num inv-gold font-extrabold">{pct(c.bond.yield)}</td>
                <td className="r inv-num">{c.spread != null ? `+${num(c.spread * 100, 1)}` : "—"}</td>
                <td className="r inv-num whitespace-nowrap">
                  {fmtDate(effectiveEnd(c.bond), { year: "always" })}
                  <div className="inv-muted text-xs">{c.end !== c.bond.matDate ? "оферта" : `${num(years(c.end), 1)} г.`}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 60 && <div className="inv-faint mt-1 text-xs">Показаны 60 самых доходных.</div>}
    </div>
  );
}
