import { Link, Loading, confirm, kv, prompt, toast, useStore } from "@lifehub/sdk";
import { useRef, useState } from "react";
import { Btn, Details, Field, Header, NumInput, Panel, Screen, Seg, Toggle } from "../components/ui.tsx";
import { fmtDate, ms } from "../lib/dates.ts";
import { SNOWBALL_TEMPLATE, exportSnowballCsv } from "../lib/importers.ts";
import { useInvest } from "../lib/store.tsx";
import { KEYS, clearAll, loadDemo, refreshMarket, runImport, syncAll, useRun } from "../lib/sync.ts";
import { ACCOUNT_KIND_TITLE, BROKER_TITLE, OTHER_TITLE, defaultSettings, type Account, type AccountKind, type OtherKind, type Portfolio, type Settings } from "../lib/types.ts";
import { shortRub } from "../lib/fmt.ts";

export function SettingsPage() {
  const { loading } = useInvest();
  if (loading) return <Loading />;
  return (
    <Screen>
      <Header title="Счета и настройки" question="Подключение брокеров, выписки и параметры расчётов" />
      <div className="space-y-4">
        <Brokers />
        <Savings />
        <AccountsList />
        <ImportCard />
        <CalcSettings />
        <DataCard />
        <LogCard />
      </div>
    </Screen>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input className="inv-input font-mono !text-[13px]" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <Btn type="button" className="inv-icon-btn flex-none" onClick={() => setShow(!show)} aria-label={show ? "Скрыть" : "Показать"}>
        {show ? "🙈" : "👁"}
      </Btn>
    </div>
  );
}

function Brokers() {
  const { settings, portfolio } = useInvest();
  const run = useRun();
  const [tbank, setTbank] = useState(settings.tbankToken);
  const [bcs, setBcs] = useState(settings.bcsRefreshToken);
  const [bcsName, setBcsName] = useState(settings.bcsAccountName);
  const tAccounts = portfolio.accounts.filter((a) => a.broker === "tbank" && !portfolio.isDemo);
  const bAccounts = portfolio.accounts.filter((a) => a.broker === "bcs" && !portfolio.isDemo);
  const last = (list: Account[]) => list.map((a) => a.lastSync).filter(Boolean).sort().pop();

  async function save() {
    // Пишем напрямую в kv, чтобы синхронизация сразу увидела новые токены
    const cur = { ...defaultSettings(), ...(await kv.get<Partial<Settings>>(KEYS.settings, {})) };
    await kv.set(KEYS.settings, { ...cur, tbankToken: tbank.trim(), bcsRefreshToken: bcs.trim(), bcsAccountName: bcsName.trim() || cur.bcsAccountName });
    const ok = await syncAll();
    toast(ok ? "Готово — данные обновлены" : "Обновление завершилось с ошибкой — смотрите журнал внизу", ok ? "success" : "error");
  }

  return (
    <Panel title="Брокеры" info="Токены «только для чтения»: с ними нельзя ничего купить, продать или вывести. Они хранятся в хабе на вашем компьютере, запросы к брокерам идут через хаб.">
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[15px] font-extrabold">Т-Банк</span>
            {tAccounts.length ? <span className="inv-tag inv-tag-green">{tAccounts.length} счёт(а) · {fmtDate(ms(last(tAccounts) ?? Date.now()))}</span> : settings.tbankToken ? <span className="inv-tag inv-tag-orange">не загружено</span> : <span className="inv-tag">не подключён</span>}
          </div>
          <SecretInput value={tbank} onChange={setTbank} placeholder="t.xxxxxxxx…" />
          <Details summary="Где взять токен" className="mt-1">
            <ol className="inv-muted list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
              <li>Приложение или сайт Т-Инвестиций → Настройки → «Токены T-Invest API».</li>
              <li>«Создать токен» → тип <b>«Только для чтения»</b>, доступ <b>ко всем счетам</b>.</li>
              <li>Скопируйте токен (он показывается один раз) и вставьте сюда.</li>
            </ol>
          </Details>
        </div>
        <div className="inv-hr pt-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[15px] font-extrabold">БКС</span>
            {bAccounts.length ? <span className="inv-tag inv-tag-green">подключён · {fmtDate(ms(last(bAccounts) ?? Date.now()))}</span> : settings.bcsRefreshToken ? <span className="inv-tag inv-tag-orange">не загружено</span> : <span className="inv-tag">не подключён</span>}
          </div>
          <SecretInput value={bcs} onChange={setBcs} placeholder="refresh-токен Trade API" />
          <input className="inv-input mt-2" value={bcsName} onChange={(e) => setBcsName(e.target.value)} placeholder="Название счёта" />
          <Details summary="Где взять токен" className="mt-1">
            <ol className="inv-muted list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
              <li>Веб-версия «БКС Мир инвестиций» → Профиль → Счета и тарифы → выберите счёт → «Токены API».</li>
              <li>Создайте токен с правом <b>чтения</b> и вставьте refresh-токен сюда.</li>
              <li>Он живёт 90 дней, но при каждом обновлении модуль получает новый — если обновлять хотя бы раз в 3 месяца, вводить заново не придётся.</li>
            </ol>
          </Details>
        </div>
        <Btn main className="w-full sm:w-auto" loading={run.busy} onClick={save}>
          Сохранить и загрузить
        </Btn>
      </div>
    </Panel>
  );
}

function AccountsList() {
  const { portfolio } = useInvest();
  const [, setPortfolio] = useStore<Portfolio>(KEYS.portfolio, portfolio);
  if (!portfolio.accounts.length) return null;
  const update = (id: string, patch: Partial<Account>) => setPortfolio((p) => ({ ...p, accounts: p.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  return (
    <Panel title="Счета" info="Выключенный счёт не учитывается в «Все счета», но его можно посмотреть отдельно в переключателе счетов наверху страниц.">
      {portfolio.accounts.map((a) => (
        <div key={a.id} className="inv-row">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{a.name}</div>
            <div className="inv-muted text-xs">
              {BROKER_TITLE[a.broker]} · {ACCOUNT_KIND_TITLE[a.kind]}
            </div>
          </div>
          <Btn
            small
            ghost
            aria-label="Переименовать"
            onClick={async () => {
              const name = await prompt("Название счёта", a.name);
              if (name?.trim()) update(a.id, { name: name.trim() });
            }}
          >
            ✎
          </Btn>
          {a.broker === "manual" && (
            <Btn
              small
              ghost
              aria-label="Удалить счёт"
              onClick={async () => {
                if (!(await confirm(`Удалить счёт «${a.name}» и все его операции?`, { danger: true }))) return;
                setPortfolio((p) => ({
                  ...p,
                  accounts: p.accounts.filter((x) => x.id !== a.id),
                  transactions: p.transactions.filter((t) => t.accountId !== a.id),
                  positions: p.positions.filter((x) => x.accountId !== a.id),
                  cash: p.cash.filter((x) => x.accountId !== a.id),
                }));
              }}
            >
              🗑
            </Btn>
          )}
          <Toggle checked={a.included} onChange={(v) => update(a.id, { included: v })} label="" />
        </div>
      ))}
    </Panel>
  );
}

function ImportCard() {
  const { portfolio } = useInvest();
  const [, setPortfolio] = useStore<Portfolio>(KEYS.portfolio, portfolio);
  const run = useRun();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(portfolio.accounts.find((a) => a.broker === "manual")?.id ?? portfolio.accounts[0]?.id ?? "");

  async function newAccount() {
    const name = await prompt("Название счёта (например, «ВТБ ИИС»)", "");
    if (!name?.trim()) return;
    const kind: AccountKind = /иис/i.test(name) ? "iis" : "broker";
    const acc: Account = { id: `manual:${crypto.randomUUID().slice(0, 8)}`, broker: "manual", externalId: "", name: name.trim(), kind, included: true };
    setPortfolio((p) => (p.isDemo ? { ...p, isDemo: false, accounts: [acc], transactions: [], positions: [], cash: [] } : { ...p, accounts: [...p.accounts, acc] }));
    setAccountId(acc.id);
  }

  function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Panel title="Загрузить выписку" info="Запасной путь, если API недоступно или брокер другой. Подходят CSV в формате импорта Snowball и XLSX-отчёты Т-Банка и БКС: таблицы сделок и движения денег модуль находит сам. Повторная загрузка того же файла не создаёт дублей.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="inv-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">— выберите счёт —</option>
          {portfolio.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Btn onClick={newAccount}>+ Новый счёт</Btn>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xlsm,.txt"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !accountId) return;
          const ok = await runImport(f, accountId);
          toast(ok ? "Выписка загружена — подробности в журнале" : "Не получилось — смотрите журнал", ok ? "success" : "error");
        }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn main disabled={!accountId} loading={run.busy} onClick={() => fileRef.current?.click()}>
          Выбрать файл
        </Btn>
        <Btn ghost onClick={() => download("шаблон-snowball.csv", SNOWBALL_TEMPLATE)}>Шаблон CSV</Btn>
        {portfolio.transactions.length > 0 && (
          <Btn ghost onClick={() => download("операции.csv", exportSnowballCsv(portfolio.transactions, portfolio.instruments))}>Экспорт всех операций</Btn>
        )}
      </div>
    </Panel>
  );
}

function CalcSettings() {
  const { settings: s, setSettings, market } = useInvest();
  return (
    <Panel title="Параметры расчётов">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ставка НДФЛ" hint="для ожидаемых выплат; с дохода выше 2,4 млн ₽ в год — 15 %">
          <NumInput value={s.taxRate} onChange={(v) => setSettings({ taxRate: v })} suffix="%" />
        </Field>
        <Field label="Ставка вклада" hint="ориентир «без риска» для сравнения и коэффициента Шарпа">
          <NumInput value={s.riskFreeRate} onChange={(v) => setSettings({ riskFreeRate: v })} suffix="%" step={0.5} />
        </Field>
        <Field label="Сравнивать с индексом">
          <Seg
            value={s.benchmark}
            onChange={(v) => setSettings({ benchmark: v })}
            options={[
              ["MCFTR", "Акции (MCFTR)"],
              ["IMOEX", "IMOEX"],
              ["RGBITR", "ОФЗ (RGBITR)"],
            ]}
          />
        </Field>
        <Field label="Ключевая ставка ЦБ" hint={market.keyRate ? `с сайта ЦБ: ${market.keyRate} % на ${fmtDate(market.keyRateDate ?? Date.now(), { year: "always" })}` : "если сайт ЦБ недоступен"}>
          <NumInput value={s.keyRateFallback} onChange={(v) => setSettings({ keyRateFallback: v })} suffix="%" step={0.25} />
        </Field>
      </div>
    </Panel>
  );
}

function DataCard() {
  const { portfolio } = useInvest();
  const run = useRun();
  return (
    <Panel title="Данные">
      <div className="flex flex-wrap gap-2">
        <Btn loading={run.busy} onClick={() => refreshMarket()}>Обновить котировки</Btn>
        <Link to="/operations" className="inv-btn">Все операции ({portfolio.transactions.length})</Link>
        <Link to="/glossary" className="inv-btn">Словарь терминов</Link>
        <Btn loading={run.busy} onClick={async () => (portfolio.accounts.length && !portfolio.isDemo && !(await confirm("Заменить ваши данные демо-портфелем?", { danger: true })) ? null : loadDemo())}>
          Демо-портфель
        </Btn>
        <Btn
          ghost
          className="text-[var(--inv-red)]"
          onClick={async () => {
            if (await confirm("Удалить счета, операции и историю цен? Токены и настройки останутся.", { danger: true })) await clearAll();
          }}
        >
          Удалить все данные
        </Btn>
      </div>
    </Panel>
  );
}

function LogCard() {
  const [log] = useStore<string[]>(KEYS.log, []);
  if (!log.length) return null;
  return (
    <Panel title="Журнал обновлений">
      <div className="inv-muted max-h-72 space-y-1 overflow-y-auto font-mono text-xs leading-relaxed">
        {log.map((l, i) => (
          <div key={i} className={/ошибк|не удалось|не загруж|не подошёл/i.test(l) ? "text-[var(--inv-orange)]" : ""}>
            {l}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Сбережения вне брокеров — для «всего капитала» и подушки безопасности. */
function Savings() {
  const { other, otherAll, setOther, settings, setSettings, report, finance, fromFinance, debts, manualExpenses } = useInvest();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OtherKind>("deposit");
  const [amount, setAmount] = useState(0);
  const [rate, setRate] = useState(0);
  const total = otherAll.reduce((a, x) => a + x.amount, 0);
  const liquid = Math.max(0, otherAll.filter((x) => x.kind === "deposit" || x.kind === "cash").reduce((a, x) => a + x.amount, 0) + Math.max(0, report.cashRUB) - debts);
  const months = settings.monthlyExpenses > 0 ? liquid / settings.monthlyExpenses : null;
  const fs = finance?.summary;
  const cushion =
    months != null ? `Подушка: ${months.toFixed(1).replace(".", ",")} мес. расходов (вклады, деньги на картах и свободные деньги на счетах${debts > 0 ? " минус долги по кредиткам" : ""}) — ${months >= 3 ? "достаточно" : "мало, нужно 3–6"}` : "необязательно, но очень полезно";
  return (
    <Panel
      title="Мои сбережения и расходы"
      info="Вклады, наличные и недвижимость не видны брокеру, но это тоже ваш капитал. Расходы в месяц нужны, чтобы проверить подушку безопасности (3–6 месяцев расходов в доступных деньгах) и показать, какую часть расходов уже покрывают выплаты. Если установлены «Финансы», расходы и остатки на картах берутся оттуда — по реальным операциям."
    >
      {finance && (
        <div className="inv-soft mb-3 p-3">
          <Toggle checked={fromFinance} onChange={(v) => setSettings({ savingsSource: v ? "finance" : "manual" })} label="Брать расходы и остатки из «Финансов»" />
          {fromFinance && (
            <div className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="inv-muted">Тратите в месяц{fs?.monthsCounted ? ` (среднее за ${fs.monthsCounted} мес.)` : ""}</span>
                <b className="inv-num">{finance.expenses > 0 ? shortRub(finance.expenses) : "мало данных"}</b>
              </div>
              {fs?.monthlyFixed ? (
                <div className="flex justify-between gap-2">
                  <span className="inv-muted">из них обязательные</span>
                  <span className="inv-num">{shortRub(fs.monthlyFixed)}</span>
                </div>
              ) : null}
              {fs?.monthlyIncome ? (
                <div className="flex justify-between gap-2">
                  <span className="inv-muted">Доход в месяц</span>
                  <span className="inv-num">{shortRub(fs.monthlyIncome)}</span>
                </div>
              ) : null}
              {finance.assets.map((a) => (
                <div key={a.id} className="flex justify-between gap-2">
                  <span className="inv-muted truncate">💳 {a.name}</span>
                  <span className="inv-num">{shortRub(a.amount)}</span>
                </div>
              ))}
              {(fs?.debts ?? []).filter((d) => (d.debt ?? 0) > 0).map((d) => (
                <div key={d.id} className="flex justify-between gap-2">
                  <span className="inv-muted truncate">💳 {d.name} — долг</span>
                  <span className="inv-num inv-down">−{shortRub(d.debt ?? 0)}</span>
                </div>
              ))}
              {fs?.updatedAt && <div className="inv-faint pt-1 text-xs">Обновлено {fmtDate(fs.updatedAt)} · счета без известного остатка не учитываются</div>}
            </div>
          )}
        </div>
      )}
      {fromFinance && finance!.expenses > 0 ? (
        <div className="mb-1 text-[13px]">{cushion}</div>
      ) : (
        <Field label="Расходы семьи в месяц" hint={cushion}>
          <NumInput value={manualExpenses} onChange={(v) => setSettings({ monthlyExpenses: v })} suffix="₽" min={0} />
        </Field>
      )}
      {fromFinance && <div className="mb-1 mt-3 text-[13px] font-bold">Ещё сбережения, которых нет в «Финансах» (вклады, недвижимость)</div>}
      {other.length > 0 && (
        <div className="mt-3">
          {other.map((a) => (
            <div key={a.id} className="inv-row">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{a.name}</div>
                <div className="inv-muted text-xs">
                  {OTHER_TITLE[a.kind]}
                  {a.rate ? ` · ${a.rate} % годовых` : ""}
                </div>
              </div>
              <div className="inv-num text-sm font-bold">{shortRub(a.amount)}</div>
              <Btn
                small
                ghost
                aria-label="Изменить сумму"
                onClick={async () => {
                  const v = await prompt(`Сумма «${a.name}», ₽`, String(a.amount));
                  const n = Number((v ?? "").replace(/\s/g, "").replace(",", "."));
                  if (v != null && Number.isFinite(n)) setOther(other.map((x) => (x.id === a.id ? { ...x, amount: n } : x)));
                }}
              >
                ✎
              </Btn>
              <Btn small ghost aria-label="Удалить" onClick={() => setOther(other.filter((x) => x.id !== a.id))}>
                🗑
              </Btn>
            </div>
          ))}
          <div className="inv-muted mt-1 text-xs">Всего вне брокеров{fromFinance ? " (с «Финансами»)" : ""}: {shortRub(total)} · весь капитал: {shortRub(total + report.totalValue - debts)}</div>
        </div>
      )}
      <div className="inv-hr mt-4 pt-4">
        <div className="mb-2 text-[13px] font-bold">Добавить</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="inv-input" placeholder="Название (например, вклад в Сбере)" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="inv-input" value={kind} onChange={(e) => setKind(e.target.value as OtherKind)}>
            {(Object.keys(OTHER_TITLE) as OtherKind[]).map((k) => (
              <option key={k} value={k}>
                {OTHER_TITLE[k]}
              </option>
            ))}
          </select>
          <NumInput value={amount} onChange={setAmount} suffix="₽" min={0} />
          {kind === "deposit" && <NumInput value={rate} onChange={setRate} suffix="% год." min={0} />}
        </div>
        <Btn
          className="mt-2"
          disabled={!name.trim() || !amount}
          onClick={() => {
            setOther([...other, { id: crypto.randomUUID().slice(0, 8), name: name.trim(), kind, amount, rate: kind === "deposit" && rate ? rate : undefined }]);
            setName("");
            setAmount(0);
            setRate(0);
          }}
        >
          + Добавить
        </Btn>
      </div>
    </Panel>
  );
}
