import { Link, Loading, cn } from "@lifehub/sdk";
import { useState } from "react";
import { AiReview } from "../components/AiReview.tsx";
import { Btn, Details, Empty, Header, Panel, Screen, Seg, Stat, useTab } from "../components/ui.tsx";
import { PRIORITY, type Action } from "../lib/actions.ts";
import { fmtDate } from "../lib/dates.ts";
import { shortRub } from "../lib/fmt.ts";
import { useInvest } from "../lib/store.tsx";
import { HealthTab, MistakesTab } from "./Review.tsx";

const TABS = ["plan", "check", "mistakes", "taxes", "ai"] as const;
type Tab = (typeof TABS)[number];

export function ActionsPage() {
  const { loading, hasData } = useInvest();
  const [tab, setTab] = useTab<Tab>("plan", TABS);
  if (loading) return <Loading />;
  return (
    <Screen>
      <Header title="Что делать" question="Конкретные шаги по портфелю — от срочных к полезным">
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            ["plan", "План"],
            ["check", "Проверка"],
            ["mistakes", "Мои ошибки"],
            ["taxes", "Налоги"],
            ["ai", "Спросить ИИ"],
          ]}
        />
      </Header>
      {!hasData ? (
        <Empty icon="✅" title="Пока нечего делать" text="Подключите счета — и здесь появится план действий." action={<Link to="/settings" className="inv-btn inv-btn-main">Подключить</Link>} />
      ) : tab === "plan" ? (
        <PlanTab />
      ) : tab === "check" ? (
        <HealthTab />
      ) : tab === "mistakes" ? (
        <MistakesTab />
      ) : tab === "taxes" ? (
        <TaxesTab />
      ) : (
        <AiReview mode="review" amount={0} />
      )}
    </Screen>
  );
}

function PlanTab() {
  const { actions, done, setDone } = useInvest();
  const open = actions.filter((a) => !done[a.id]);
  const closed = actions.filter((a) => done[a.id]);
  const counts = [1, 2, 3].map((p) => open.filter((a) => a.priority === p).length);
  return (
    <div className="space-y-3">
      <section className="inv-panel p-4 sm:p-5">
        <p className="text-sm leading-relaxed">
          Здесь собрано всё, что модуль нашёл: перекосы портфеля, налоги, подушка, отсечки, ваши привычки. Сделали — отметьте ✓, пункт уйдёт вниз. Если ситуация изменится, совет появится снова.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="Срочно" value={<span className={counts[0] ? "inv-down" : ""}>{counts[0]}</span>} />
          <Stat label="Важно" value={counts[1]} />
          <Stat label="Полезно" value={counts[2]} />
        </div>
      </section>
      {!open.length && (
        <Panel>
          <div className="py-6 text-center text-sm">Всё сделано 🎉 Загляните после следующего пополнения.</div>
        </Panel>
      )}
      {open.map((a) => (
        <ActionCard key={a.id} a={a} onDone={() => setDone({ ...done, [a.id]: Date.now() })} />
      ))}
      {closed.length > 0 && (
        <Panel>
          <Details summary={`Сделано (${closed.length})`}>
            {closed.map((a) => (
              <div key={a.id} className="inv-row">
                <span className="text-lg">✓</span>
                <div className="min-w-0 flex-1 truncate text-sm">{a.title}</div>
                <span className="inv-faint text-xs">{fmtDate(done[a.id])}</span>
                <Btn
                  small
                  ghost
                  onClick={() => {
                    const next = { ...done };
                    delete next[a.id];
                    setDone(next);
                  }}
                >
                  Вернуть
                </Btn>
              </div>
            ))}
          </Details>
        </Panel>
      )}
    </div>
  );
}

export function ActionCard({ a, onDone, compact }: { a: Action; onDone?: () => void; compact?: boolean }) {
  const [label, tag] = PRIORITY[a.priority];
  const [open, setOpen] = useState(!compact && a.priority === 1);
  return (
    <section className={cn("inv-panel inv-sev p-4", a.priority === 1 ? "inv-sev-bad" : a.priority === 2 ? "inv-sev-warn" : "inv-sev-info")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl leading-none">{a.icon}</span>
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
          <span className={cn("inv-tag mb-1", tag)}>{label}</span>
          <div className="text-[15px] font-extrabold leading-snug">{a.title}</div>
        </button>
        {onDone && (
          <button onClick={onDone} aria-label="Отметить сделанным" title="Сделано" className="grid size-9 flex-none place-items-center rounded-full border border-[var(--inv-line)] text-[var(--inv-muted)] hover:border-[var(--inv-green)] hover:text-[var(--inv-green)]">
            ✓
          </button>
        )}
      </div>
      {open ? (
        <div className="inv-fade-in mt-2 pl-8">
          <p className="inv-muted text-sm leading-relaxed">{a.why}</p>
          {a.steps.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {a.steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--inv-green)]">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
          {a.link && (
            <Link to={a.link.to} className="mt-3 inline-block text-sm font-bold text-[var(--inv-green)]">
              {a.link.label} →
            </Link>
          )}
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="inv-muted mt-1 pl-8 text-xs font-semibold">
          Подробнее и что сделать ›
        </button>
      )}
    </section>
  );
}

function TaxesTab() {
  const { tax, settings } = useInvest();
  return (
    <div className="space-y-4">
      <Panel
        title={`Налоги за ${tax.year}`}
        info="Брокер сам считает и удерживает НДФЛ — при выводе денег или в конце года. Здесь — оценка, чтобы понимать, сколько уйдёт, и законно платить меньше. Продажи на ИИС не учитываются: налог там считается при закрытии счёта (или не платится вовсе)."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Прибыль от продаж" value={shortRub(tax.gains)} hint="облагаемая, владение < 3 лет" />
          <Stat label="Убытки от продаж" value={shortRub(tax.losses)} hint="уменьшают налог" />
          <Stat label="Налог с продаж" value={<span className={tax.taxSales > 0 ? "inv-down" : ""}>≈ {shortRub(tax.taxSales)}</span>} hint={`${settings.taxRate} %`} />
          <Stat label="Налог с выплат" value={shortRub(tax.taxIncome)} hint="уже удержан" />
        </div>
      </Panel>
      <Panel title="Как заплатить меньше — законно">
        <div className="space-y-4 text-sm leading-relaxed">
          <div>
            <div className="font-extrabold">1. Сальдирование убытков</div>
            <p className="inv-muted">Продажа бумаг в минус уменьшает налог с прибыльных продаж того же года у того же брокера. Бумагу можно тут же купить обратно — доля не изменится.</p>
            {tax.harvest.length ? (
              <ul className="mt-1 space-y-0.5">
                {tax.harvest.map((h) => (
                  <li key={h.id}>
                    <Link to={`/asset/${encodeURIComponent(h.id)}`} className="font-bold hover:underline">{h.name}</Link> — убыток {shortRub(h.loss)}, экономия ≈ <b className="inv-up">{shortRub(h.saved)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">{tax.taxSales > 0 ? "Бумаг с заметным убытком вне ИИС нет." : "В этом году налога с продаж нет — делать ничего не нужно."}</p>
            )}
          </div>
          <div>
            <div className="font-extrabold">2. Льгота 3 лет (ЛДВ)</div>
            <p className="inv-muted">Прибыль от бумаг, которыми вы владеете больше 3 лет, не облагается налогом (до 3 млн ₽ за каждый год владения). Не продавайте раньше без нужды.</p>
            {tax.ldvSoon.length ? (
              <ul className="mt-1 space-y-0.5">
                {tax.ldvSoon.map((x) => (
                  <li key={x.id}>
                    <b>{x.name}</b> — без налога с {fmtDate(x.date, { year: "always" })} (сейчас было бы ≈ {shortRub(x.tax)})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">В ближайший год таких дат нет.</p>
            )}
          </div>
          <div>
            <div className="font-extrabold">3. ИИС</div>
            {tax.hasIis ? (
              <p className="inv-muted">
                В {tax.year} вы внесли на ИИС {shortRub(tax.iisDeposits)} → вычет до <b className="text-[var(--inv-fg)]">{shortRub(tax.iisDeduction)}</b> (13 % от взносов до 400 000 ₽). Оформляется в следующем году, если вы платите НДФЛ с зарплаты.
              </p>
            ) : (
              <p className="inv-muted">ИИС нет. ИИС-3 даёт вычет до 52 000 ₽ в год и освобождает доход от налога при сроке от 5 лет — если деньги не понадобятся долго, это самый выгодный счёт.</p>
            )}
          </div>
          <div>
            <div className="font-extrabold">4. Ставка 15 %</div>
            <p className="inv-muted">С доходов выше 2,4 млн ₽ в год (зарплата и инвестиции считаются отдельно) ставка — 15 %. Если ваш доход от инвестиций рядом с этой границей, крупные продажи лучше разнести по разным годам.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
