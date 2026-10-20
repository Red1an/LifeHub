import { useEffect, useMemo, useState } from "react";
import {
  Button, Checkbox, Field, Loading, Select, Tabs, Textarea, ai, cn, confirm, formatRelative, plural, toast, useNavigate, useSearchParams, webhook, type WebhookInfo,
} from "@lifehub/sdk";
import { findAccount, type Draft } from "../lib/ingest.ts";
import { nameMatches } from "../lib/categorize.ts";
import { rub } from "../lib/money.ts";
import type { ParsedOp } from "../lib/parse/common.ts";
import { readStatement } from "../lib/parse/files.ts";
import { parseNotification } from "../lib/parse/notify.ts";
import { makeDrafts, useFinance } from "../lib/store.tsx";
import { BANKS, type Source } from "../lib/types.ts";
import { BankMark, Card } from "../components/ui.tsx";

type Tab = "push" | "file" | "text";

export function Import() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "file";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Импорт</h1>
      <p className="mb-4 text-[14px] text-muted">У Сбера, Яндекса и Озона нет открытого API для личных карт — поэтому три пути: уведомления, выписки и текст.</p>
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={(t) => setParams({ tab: t === "file" ? null : t })}
        tabs={[
          { id: "file", label: "Выписки" },
          { id: "push", label: "Уведомления" },
          { id: "text", label: "SMS" },
        ]}
      />
      {tab === "file" && <FileImport />}
      {tab === "push" && <PushSetup />}
      {tab === "text" && <TextImport />}
    </div>
  );
}

/* ───────────── выписки ───────────── */

const HOWTO: [string, string][] = [
  ["Сбер", "СберБанк Онлайн → карта → «Выписки и справки» → «Выписка по счёту карты» → PDF за нужный период."],
  ["Яндекс Банк", "Приложение Яндекс Банка → счёт → «Выписка» → период → PDF придёт на почту."],
  ["Озон Банк", "Ozon Банк → карта → «Документы» → «Выписка по счёту» → PDF. Для рассрочки — скриншоты графика."],
  ["Т-Банк", "tbank.ru → «Операции» → период → «Выгрузить» → CSV или Excel (точнее всего)."],
  ["Сплиты", "Яндекс Сплит и Озон Рассрочка выписок не дают — пришлите скриншоты экрана с покупками и платежами."],
];

function FileImport() {
  const f = useFinance();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; ops: ParsedOp[]; text: string; card?: string; closing?: { amount: number; date?: string }; warnings: string[]; bank?: string; credit?: boolean; owner?: string } | null>(null);

  if (f.loading) return <Loading text="Загружаю записанные операции — чтобы не было дублей…" />;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const images = [...files].filter((x) => x.type.startsWith("image/"));
      if (images.length) {
        const ops = await aiFromImages(images.slice(0, 5));
        setResult({ name: images.map((x) => x.name).join(", "), ops, text: "", warnings: ops.length ? [] : ["Нейронка не нашла операций на скриншотах"] });
        return;
      }
      const all: ParsedOp[] = [];
      let last: Awaited<ReturnType<typeof readStatement>> | null = null;
      const warnings: string[] = [];
      for (const file of [...files]) {
        const r = await readStatement(file);
        all.push(...r.ops.map((o) => ({ ...o, card: o.card ?? r.card, bank: o.bank ?? r.bank })));
        warnings.push(...r.warnings.map((w) => `${file.name}: ${w}`));
        last = r;
      }
      setResult({ name: [...files].map((x) => x.name).join(", "), ops: all, text: last?.text ?? "", card: last?.card, closing: files.length === 1 ? last?.closing : undefined, warnings, bank: last?.bank, credit: last?.credit, owner: last?.owner });
    } catch (e) {
      toast(`Не удалось прочитать файл: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) return <Preview source="statement" {...result} onDone={() => setResult(null)} />;

  return (
    <div className="space-y-4">
      <label className={cn("fin-card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center transition hover:border-accent", busy && "pointer-events-none opacity-60")}>
        <span className="text-4xl">{busy ? "⏳" : "📄"}</span>
        <span className="font-semibold">{busy ? "Читаю выписку…" : "Выберите выписку"}</span>
        <span className="text-[13.5px] text-muted">PDF, CSV, Excel — можно несколько. Или скриншоты операций (разберёт нейронка).</span>
        <input type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.txt,image/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>
      <p className="text-[13px] text-muted">Файл читается прямо в браузере, на сервер хаба попадают только найденные операции. Повторы с уже записанными (например, из уведомлений) пропускаются.</p>
      <Card title="Где взять выписку">
        <div className="space-y-2.5">
          {HOWTO.map(([bank, text]) => (
            <div key={bank} className="text-[14px]">
              <b>{bank}.</b> <span className="text-muted">{text}</span>
            </div>
          ))}
        </div>
      </Card>
      {f.txs.some((t) => t.source === "statement") && <p className="text-center text-[13px] text-muted">Из выписок уже загружено: {f.txs.filter((t) => t.source === "statement").length} операций</p>}
    </div>
  );
}

const AI_FORMAT = `Верни JSON-массив операций: [{"date": "YYYY-MM-DD", "time": "HH:MM" или null, "amount": число без знака, "type": "expense" | "income", "merchant": "где/от кого", "refund": true если возврат покупки, "split": true если оплата Сплитом/частями/в рассрочку}]. Только реальные операции (не остатки, не итоги, не отклонённые). Год, если не указан, — ${new Date().getFullYear()}.`;

async function aiFromImages(images: File[]): Promise<ParsedOp[]> {
  const res = await ai.json<AiOp[]>(`На скриншотах — операции из банковского приложения (Россия). ${AI_FORMAT}`, { images, model: "smart" });
  return fromAi(res, "скриншот");
}

async function aiFromText(text: string): Promise<ParsedOp[]> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 8; i += 14000) chunks.push(text.slice(i, i + 14000));
  const out: ParsedOp[] = [];
  for (const c of chunks) {
    const res = await ai.json<AiOp[]>(`Текст банковской выписки (Россия). ${AI_FORMAT}\n\n${c}`, { model: "fast" });
    out.push(...fromAi(res, "выписка"));
  }
  return out;
}

interface AiOp {
  date: string;
  time?: string | null;
  amount: number;
  type: "expense" | "income";
  merchant?: string;
  refund?: boolean;
  split?: boolean;
}

function fromAi(res: AiOp[], label: string): ParsedOp[] {
  return (Array.isArray(res) ? res : [])
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number(o.amount) > 0)
    .map((o) => ({
      kind: o.type === "income" ? "income" : "expense",
      amount: Math.abs(Number(o.amount)),
      date: o.date,
      time: o.time ?? undefined,
      merchant: o.merchant || undefined,
      raw: `${label}: ${o.date} ${o.time ?? ""} ${o.type === "income" ? "+" : "−"}${o.amount} ${o.merchant ?? ""}`.replace(/\s+/g, " "),
      refund: o.refund || undefined,
      split: o.split || undefined,
    }));
}

/** Проверка перед записью: что нашлось, что уже есть, на какой счёт. */
function Preview({
  name, ops: initial, text, card, closing, warnings, bank, source, onDone, credit, owner,
}: {
  name: string; ops: ParsedOp[]; text: string; card?: string; closing?: { amount: number; date?: string }; warnings: string[]; bank?: string; source: Source; onDone: () => void;
  credit?: boolean; owner?: string;
}) {
  const f = useFinance();
  const nav = useNavigate();
  const [ops, setOps] = useState(initial);
  // Счёт выписки: по карте; кредитка — только на кредитный счёт. Нет подходящего — завести новый.
  const guessAcc = useMemo(() => {
    const byCard = card ? f.accounts.find((a) => !a.archived && a.cards?.includes(card)) : undefined;
    if (byCard && (!credit || byCard.type === "credit")) return byCard.id;
    const found = findAccount({ card, bank: bank as never }, f.accounts);
    if (found && (credit ? found.type === "credit" : found.type !== "credit") && (!card || !found.cards?.length || found.cards.includes(card))) return found.id;
    return bank ? "new" : "";
  }, []);
  const newName = `${BANKS[(bank ?? "other") as keyof typeof BANKS]?.name ?? "Банк"}${credit ? " Кредитная" : ""}${card ? ` •${card}` : ""}`;
  const [account, setAccount] = useState(guessAcc);
  const drafts: Draft[] = useMemo(() => makeDrafts(ops, source, f.context(), account && account !== "new" ? account : undefined), [ops, account, f.txs, f.accounts]);
  const [off, setOff] = useState<Set<number>>(new Set());
  // Уже записанная операция без счёта не пропускается, а дополняется («обновится»). Снимаем галочки только с настоящих повторов.
  const upgradable = (d: Draft) => {
    if (!d.duplicateOf || !account) return false;
    const old = f.txs.find((x) => x.id === d.duplicateOf);
    return !!old && !old.account && !old.toAccount && old.source !== "manual";
  };
  useEffect(() => setOff(new Set(drafts.map((d, i) => (d.duplicateOf && !upgradable(d) ? i : -1)).filter((i) => i >= 0))), [drafts.length, account]);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [setBalance, setSetBalance] = useState(!!closing);
  const accType = account === "new" ? (credit ? "credit" : "card") : f.accounts.find((a) => a.id === account)?.type;
  // Остаток выписки: у дебетовой — деньги на счёте, у кредитки — долг (если выписка именно по кредитке).
  const canSetBalance = !!closing && !!account && (accType === "card" || accType === "savings" || (accType === "credit" && !!credit));

  const chosen = drafts.filter((_, i) => !off.has(i));
  const out = chosen.filter((d) => d.tx.kind === "expense").reduce((s, d) => s + d.tx.amount, 0);
  const inc = chosen.filter((d) => d.tx.kind === "income").reduce((s, d) => s + d.tx.amount, 0);
  const dups = drafts.filter((d) => d.duplicateOf && !upgradable(d)).length;
  const upgrades = drafts.filter(upgradable).length;
  const range = ops.length ? [ops.reduce((m, o) => (o.date < m ? o.date : m), ops[0].date), ops.reduce((m, o) => (o.date > m ? o.date : m), ops[0].date)] : null;

  const save = async () => {
    setSaving(true);
    try {
      // Владелец из шапки выписки — это вы: переводы на это имя и от него — переводы себе.
      if (owner) {
        const [last, first, middle] = owner.split(/\s+/);
        const names = [owner, `${first} ${middle} ${last[0]}.`].filter((n) => !nameMatches(n, f.prefs.myNames) || !f.prefs.myNames.length);
        if (names.length) f.setPrefs({ ...f.prefs, myNames: [...new Set([...f.prefs.myNames, ...names])] });
      }
      let accId = account;
      let list = chosen;
      if (account === "new") {
        const acc = await f.accountCol.add({ name: newName, bank: (bank ?? "other") as never, type: credit ? "credit" : "card", cards: card ? [card] : [] });
        accId = acc.id;
        // Пересчитываем черновики уже с этим счётом (погашения кредитки станут переводами на него).
        const ctx = f.context();
        list = makeDrafts(ops, source, { ...ctx, accounts: [...ctx.accounts, acc] }, acc.id).filter((_, i) => !off.has(i));
      }
      const r = await f.ingest(list);
      if (setBalance && closing && canSetBalance && accId) await f.accountCol.update(accId, { balance: closing.amount, balanceAt: closing.date ?? range?.[1], balanceTs: Date.now() });
      toast(
        [
          `Добавлено: ${r.added} ${plural(r.added, ["операция", "операции", "операций"])}`,
          r.merged && `обновлено записанных раньше: ${r.merged}`,
          r.skipped && `уже были: ${r.skipped}`,
        ].filter(Boolean).join(" · "),
        "success",
      );
      onDone();
      nav(chosen.some((d) => d.tx.review) ? "/ops?review=1" : `/ops${range ? `?month=${range[1].slice(0, 7)}` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  const viaAi = async () => {
    if (!text) return;
    if (ops.length && !(await confirm("Разобрать выписку нейронкой заново? Найденное сейчас заменится.", {}))) return;
    setAiBusy(true);
    try {
      const r = await aiFromText(text);
      if (!r.length) toast("Нейронка тоже ничего не нашла", "error");
      else setOps(r.map((o) => ({ ...o, card: o.card ?? card, bank: (o.bank ?? bank) as never })));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span className="text-3xl">📄</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-[13.5px] text-muted">
              {ops.length} операций{range ? ` · ${range[0].split("-").reverse().join(".")} — ${range[1].split("-").reverse().join(".")}` : ""}
              {bank ? ` · ${BANKS[bank as keyof typeof BANKS]?.name ?? bank}` : ""}
              {dups ? ` · ${dups} уже есть` : ""}
              {upgrades ? ` · ${upgrades} записаны раньше без счёта — обновятся` : ""}
            </div>
          </div>
        </div>
        {warnings.map((w) => (
          <p key={w} className="mt-2 text-[13.5px] text-[var(--fin-amber)]">
            {w}
          </p>
        ))}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="На какой счёт">
            <Select value={account} onChange={(e) => setAccount(e.target.value)} options={[
                ...(bank ? [{ value: "new", label: `+ Новый счёт: ${newName}` }] : []),
                { value: "", label: "По картам / не указывать" },
                ...f.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${a.name}${a.type === "credit" ? " (кредитка)" : ""}` })),
              ]} />
          </Field>
          {canSetBalance && (
            <div className="flex items-end pb-2">
              <Checkbox checked={setBalance} onChange={setSetBalance} label={accType === "credit" ? `Долг по кредитке = ${rub(closing!.amount)} (из выписки)` : `Баланс счёта = ${rub(closing!.amount)} (из выписки)`} />
            </div>
          )}
        </div>
        {!f.accounts.length && <p className="mt-2 text-[13px] text-muted">Совет: сначала добавьте счета с последними цифрами карт — операции разложатся сами.</p>}
        {text && (
          <Button size="sm" variant="ghost" className="mt-2" loading={aiBusy} onClick={viaAi}>
            🤖 {ops.length ? "Разобрать нейронкой точнее" : "Разобрать нейронкой"}
          </Button>
        )}
      </Card>

      {drafts.length > 0 && (
        <Card padded={false}>
          <div className="flex items-center justify-between px-4 pb-1 pt-3 text-[13px]">
            <span className="text-muted">
              Выбрано {chosen.length} · <span className="fin-num">−{rub(out)}</span> · <span className="fin-num fin-up">+{rub(inc)}</span>
            </span>
            <button type="button" className="font-medium text-accent" onClick={() => setOff(off.size ? new Set() : new Set(drafts.map((_, i) => i)))}>
              {off.size ? "Выбрать все" : "Снять все"}
            </button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto px-1 pb-2">
            {drafts.map((d, i) => (
              <label key={i} className={cn("fin-row cursor-pointer", off.has(i) && "opacity-45")}>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--lh-accent)]"
                  checked={!off.has(i)}
                  onChange={() => {
                    const n = new Set(off);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    setOff(n);
                  }}
                />
                <span className="fin-icon size-9 text-base">{f.categoryIcon(d.tx.category, d.tx.kind)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium">{d.tx.merchant ?? d.tx.category}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {d.tx.date.slice(8)}.{d.tx.date.slice(5, 7)} · {d.tx.kind === "transfer" ? "перевод" : d.tx.category || "без категории"}
                    {d.duplicateOf && (upgradable(d) ? " · обновится" : " · уже есть")}
                    {d.repays && " · возврат долга"}
                    {d.newPlan && " · сплит"}
                  </span>
                </span>
                <span className={cn("fin-num text-[14.5px] font-semibold", d.tx.kind === "income" && "fin-up", d.tx.kind === "transfer" && "text-muted")}>
                  {d.tx.kind === "income" ? "+" : d.tx.kind === "transfer" ? "" : "−"}
                  {rub(Math.abs(d.tx.amount))}
                </span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onDone}>
          Отмена
        </Button>
        <Button variant="primary" className="flex-1" loading={saving} disabled={!chosen.length || saving} onClick={save}>
          {f.progress ? `Записываю ${f.progress.done} из ${f.progress.total}…` : `Добавить ${chosen.length}`}
        </Button>
      </div>
    </div>
  );
}

/* ───────────── текст SMS/уведомлений ───────────── */

export function TextImport({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState<ParsedOp[] | null>(null);
  const [busy, setBusy] = useState(false);

  const parse = async (useAi: boolean) => {
    const parts = text.split(/\n\s*\n|\n(?=\S.*\d.*(?:₽|р\b|руб|RUB))/).map((s) => s.trim()).filter(Boolean);
    let ops = parts.map((t) => parseNotification({ text: t })).filter(Boolean) as ParsedOp[];
    if (useAi || !ops.length) {
      setBusy(true);
      try {
        ops = await aiFromText(text);
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setBusy(false);
      }
    }
    if (!ops.length) return toast("Не нашлось операций с суммой", "error");
    setPreview(ops);
  };

  if (preview) return <Preview name="Текст" ops={preview} text={text} warnings={[]} source="share" onDone={() => setPreview(null)} />;
  return (
    <div className="space-y-3">
      <Textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Вставьте SMS или уведомления банка, каждое с новой строки:\n\nMIR-1234 12:34 Покупка 1250р PYATEROCHKA Баланс: 10500р\nПокупка 350 ₽ в Кофемания"}
      />
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={!text.trim()} loading={busy} onClick={() => parse(false)}>
          Найти операции
        </Button>
        <Button variant="secondary" disabled={!text.trim()} loading={busy} onClick={() => parse(true)}>
          🤖 Нейронкой
        </Button>
      </div>
      <p className="text-[13px] text-muted">
        С телефона удобнее «Поделиться» → LifeHub из SMS или уведомления: текст сразу откроется здесь.
      </p>
    </div>
  );
}

/* ───────────── уведомления через вебхук ───────────── */

function PushSetup() {
  const f = useFinance();
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [os, setOs] = useState<"android" | "ios">(/iphone|ipad/i.test(navigator.userAgent) ? "ios" : "android");
  useEffect(() => {
    webhook.info().then(setInfo, (e) => setErr((e as Error).message));
  }, []);
  const pub = info?.urls.find((u) => u.public);
  const url = (pub ?? info?.urls[0])?.url ?? "";

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast("Скопировано", "success");
    } catch {
      toast("Не удалось скопировать — выделите вручную", "error");
    }
  };

  const test = async () => {
    if (!info) return;
    const r = await fetch(info.path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "Тест", title: "Сбер", text: "Покупка 1 ₽ ТЕСТ LIFEHUB. Баланс 100 ₽" }) });
    toast(r.ok ? "Отправлено — сейчас появится операция «ТЕСТ LIFEHUB» на 1 ₽" : `Ошибка ${r.status}`, r.ok ? "success" : "error");
  };

  if (err) return <p className="text-danger">{err}</p>;
  if (!info) return <Loading />;
  const body = os === "android" ? `{"app": "[not_app_name]", "title": "[not_title]", "text": "[notification]"}` : `{"text": "Сообщение"}`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span className="text-3xl">🔔</span>
          <div className="text-[14.5px]">
            Телефон пересылает уведомления банков на секретный адрес хаба — операции появляются здесь сами, сразу с категорией и счётом.
            Коды из SMS, реклама и отказы отбрасываются.
          </div>
        </div>
        {f.prefs.lastHook && (
          <div className="mt-3 rounded-2xl bg-surface-2 p-3 text-[13.5px]">
            Последний приём: {formatRelative(f.prefs.lastHook.at)} — добавлено {f.prefs.lastHook.added}, пропущено {f.prefs.lastHook.skipped}
            {f.prefs.lastHook.sample && <div className="mt-1 truncate text-muted">Не понял: «{f.prefs.lastHook.sample}»</div>}
          </div>
        )}
      </Card>

      <Card title="1. Адрес">
        {!pub && (
          <p className="mb-2 rounded-2xl bg-[var(--fin-amber-soft)] p-3 text-[13.5px]">
            Включите ngrok в настройках хаба («Доступ вне дома»), чтобы адрес работал из мобильного интернета. Сейчас — только в домашней сети.
          </p>
        )}
        <div className="space-y-2">
          {info.urls.map((u) => (
            <button key={u.url} type="button" onClick={() => copy(u.url)} className="block w-full rounded-2xl bg-surface-2 p-3 text-left">
              <div className="text-[12px] text-muted">{u.label} · нажмите, чтобы скопировать</div>
              <div className="break-all font-mono text-[12.5px]">{u.url}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={test}>
            Проверить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirm("Сделать новый адрес? Старый перестанет работать — его нужно будет заменить в телефоне.", { danger: true })) setInfo(await webhook.rotate());
            }}
          >
            Новый адрес
          </Button>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">Адрес — как пароль: кто его знает, может добавлять операции. Не публикуйте его.</p>
      </Card>

      <Card title="2. Настройка телефона">
        <Tabs<"android" | "ios">
          className="mb-3"
          value={os}
          onChange={setOs}
          tabs={[
            { id: "android", label: "Android" },
            { id: "ios", label: "iPhone" },
          ]}
        />
        {os === "android" ? (
          <ol className="list-decimal space-y-2 pl-5 text-[14px]">
            <li>
              Установите <b>MacroDroid</b> из Google Play (или RuStore) и дайте доступ к уведомлениям.
            </li>
            <li>
              Новый макрос → Триггер <b>«Уведомление» → «Получено»</b> → выберите приложения: СберБанк Онлайн, Яндекс Банк (Пэй), Ozon Банк, Т-Банк и другие ваши банки.
            </li>
            <li>
              Действие <b>«HTTP-запрос»</b>: метод POST, адрес — из пункта 1, тип содержимого <code>application/json</code>, тело:
              <button type="button" onClick={() => copy(body)} className="mt-1 block w-full rounded-xl bg-surface-2 p-2 text-left font-mono text-[12px]">
                {body}
              </button>
              <span className="text-[12.5px] text-muted">Переменные в квадратных скобках вставьте через «Магический текст» (уведомление: текст, заголовок, приложение).</span>
            </li>
            <li>Сохраните макрос и заплатите картой — операция появится здесь, как только откроете модуль на любом устройстве.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-[14px]">
            <li>iPhone не даёт приложениям читать пуши других банков, но умеет пересылать SMS. Включите SMS-уведомления в банке (у Сбера — «Мобильный банк», номер 900).</li>
            <li>
              «Команды» → «Автоматизация» → <b>«Сообщение»</b> → отправитель 900 (и другие номера банков) → «Запускать сразу».
            </li>
            <li>
              Действие <b>«Получить содержимое URL»</b>: адрес из пункта 1, метод POST, тело запроса JSON, поле <code>text</code> = переменная «Сообщение».
            </li>
            <li>Для пушей Яндекса и Озона — раз в неделю-две загружайте выписку на вкладке «Выписки»: повторы пропустятся.</li>
          </ol>
        )}
      </Card>

      <Card title="3. Счета по картам">
        <p className="text-[14px] text-muted">
          Чтобы операции попадали на нужную карту, укажите у счетов последние 4 цифры. Уведомление с «Баланс: …» само обновит остаток.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {f.accounts.map((a) => (
            <span key={a.id} className="fin-chip">
              <BankMark account={a} size={18} /> {a.name} {a.cards?.length ? a.cards.map((c) => "•" + c).join(" ") : <span className="text-[var(--fin-amber)]">нет цифр</span>}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
