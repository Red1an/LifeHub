import { useEffect, useState } from "react";
import { Button, Field, IconButton, Input, Link, Select, Switch, Tabs, confirm, useSearchParams } from "@lifehub/sdk";
import { parseAmount, rub } from "../lib/money.ts";
import { phoneOf, prettyPhone } from "../lib/tidy.ts";
import { useFinance } from "../lib/store.tsx";
import type { Category } from "../lib/types.ts";
import { TextImport } from "./Import.tsx";
import { Card } from "../components/ui.tsx";

export function SettingsPage() {
  const f = useFinance();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏷️");
  const [names, setNames] = useState(f.prefs.myNames.join(", "));
  const [tidying, setTidying] = useState(false);
  const cats = f.categories.filter((c) => c.kind === kind);
  const limits = f.categories.filter((c) => c.kind === "expense").reduce((s, c) => s + (c.limit ?? 0), 0);

  const update = (c: Category, patch: Partial<Category>) => f.setCategories(f.categories.map((x) => (x === c || (x.name === c.name && x.kind === c.kind) ? { ...x, ...patch } : x)));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Настройки</h1>

      <Card title="Бюджет на месяц" className="mb-4">
        <Field label="Сколько планирую тратить, ₽" hint={`0 — считать обычным средний расход за 3 месяца.${limits ? ` Сумма лимитов по категориям: ${rub(limits)}.` : ""}`}>
          <Input inputMode="numeric" value={f.budget || ""} onChange={(e) => f.setBudget(parseAmount(e.target.value))} placeholder="60 000" />
        </Field>
      </Card>

      <Card title="Как вас зовут в переводах" className="mb-4">
        <Field hint="Например «Максим Сергеевич П.» — перевод от себя самого с другой карты будет считаться переводом между счетами, а не доходом.">
          <Input
            value={names}
            onChange={(e) => setNames(e.target.value)}
            onBlur={() => f.setPrefs({ ...f.prefs, myNames: names.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="Имя Отчество Ф."
          />
        </Field>
      </Card>

      <Card title="Мои номера телефонов" className="mb-4">
        <Field hint="Переводы на эти номера — в ваш же другой банк, это не траты. Через запятую.">
          <Input
            defaultValue={(f.prefs.myPhones ?? []).map(prettyPhone).join(", ")}
            onBlur={(e) => {
              const myPhones = e.target.value.split(",").map((x) => phoneOf(x)).filter((x): x is string => !!x);
              f.setPrefs({ ...f.prefs, myPhones });
            }}
            placeholder="+7 900 123-45-67"
          />
        </Field>
      </Card>

      <Card title="Категории и лимиты" className="mb-4">
        <Tabs
          className="mb-3"
          value={kind}
          onChange={setKind}
          tabs={[
            { id: "expense", label: "Траты" },
            { id: "income", label: "Доходы" },
          ]}
        />
        <div className="space-y-1">
          {cats.map((c) => (
            <div key={c.kind + c.name} className="flex items-center gap-2 rounded-2xl px-1 py-1.5">
              <Input value={c.icon} onChange={(e) => update(c, { icon: e.target.value })} className="w-12 px-1 text-center" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {kind === "expense" && (
                <>
                  <button type="button" title="Обязательная трата — не предлагать урезать" className={`fin-chip px-2 ${c.fixed ? "on" : ""}`} onClick={() => update(c, { fixed: !c.fixed || undefined })}>
                    📌
                  </button>
                  <Input
                    className="w-24 text-right"
                    inputMode="numeric"
                    placeholder="лимит"
                    defaultValue={c.limit ?? ""}
                    onBlur={(e) => update(c, { limit: parseAmount(e.target.value) || undefined })}
                  />
                </>
              )}
              <IconButton
                label="Удалить"
                onClick={async () => {
                  if (await confirm(`Удалить категорию «${c.name}»? Операции останутся.`)) f.setCategories(f.categories.filter((x) => !(x.name === c.name && x.kind === c.kind)));
                }}
              >
                ✕
              </IconButton>
            </div>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || f.categories.some((c) => c.kind === kind && c.name === name.trim())) return;
            f.setCategories([...f.categories, { name: name.trim(), icon, kind }]);
            setName("");
          }}
        >
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-12 px-1 text-center" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новая категория" className="flex-1" />
          <Button type="submit">Добавить</Button>
        </form>
        <p className="mt-2 text-[12.5px] text-muted">📌 — обязательная трата (аренда, связь): в «где сэкономить» не попадает.</p>
      </Card>

      <Card title={`Запомненные продавцы (${f.rules.length})`} className="mb-4">
        {f.rules.length === 0 ? (
          <p className="text-[13.5px] text-muted">Поменяйте категорию у операции — модуль запомнит продавца и дальше будет ставить её сам.</p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {f.rules.map((r) => (
              <div key={r.match} className="flex items-center gap-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.match}</span>
                <span className="text-muted">→</span>
                <Select
                  className="w-44"
                  value={r.kind === "transfer" ? "__transfer" : r.category}
                  onChange={(e) =>
                    f.setRules(
                      f.rules.map((x) =>
                        x.match === r.match
                          ? e.target.value === "__transfer"
                            ? { ...x, kind: "transfer", category: "Перевод между счетами" }
                            : { ...x, kind: f.categories.find((c) => c.name === e.target.value)?.kind ?? "expense", category: e.target.value }
                          : x,
                      ),
                    )
                  }
                  options={[...f.categories.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` })), { value: "__transfer", label: "🔄 Перевод" }]}
                />
                <IconButton label="Забыть" onClick={() => f.setRules(f.rules.filter((x) => x.match !== r.match))}>
                  ✕
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Данные" className="mb-4">
        <div className="space-y-2 text-[14px]">
          <Link to="/import" className="block text-accent">
            📥 Импорт выписок и уведомлений ›
          </Link>
          <Button variant="secondary" loading={tidying} onClick={async () => {
            setTidying(true);
            try {
              await f.tidy(true);
            } finally {
              setTidying(false);
            }
          }}>
            🧹 Навести порядок: дубли и переводы себе
          </Button>
          <Switch
            checked={f.prefs.hidden.length === 0}
            onChange={() => f.setPrefs({ ...f.prefs, hidden: [] })}
            label={f.prefs.hidden.length ? `Вернуть скрытые подсказки (${f.prefs.hidden.length})` : "Все подсказки показываются"}
          />
          <Button
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              const imported = f.txs.filter((t) => t.source === "statement" || t.source === "push" || t.source === "share");
              if (!imported.length) return;
              if (!(await confirm(`Удалить все ${imported.length} загруженные операции (из выписок и уведомлений)? Записанные вручную останутся.`, { danger: true, confirmText: "Удалить" }))) return;
              for (const t of imported) await f.txCol.remove(t.id);
            }}
          >
            Удалить загруженные операции
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** «Поделиться» с телефона: текст SMS или уведомления банка. */
export function Inbox() {
  const [params, setParams] = useSearchParams();
  const [text] = useState(() => [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n"));
  // Убираем параметры из адреса, чтобы обновление страницы не добавило то же самое ещё раз.
  useEffect(() => {
    if (params.get("text") || params.get("title") || params.get("url")) setParams({ title: null, text: null, url: null });
  }, []);
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Из «Поделиться»</h1>
      <p className="mb-4 text-[14px] text-muted">Проверьте, что нашлось, и добавьте.</p>
      <TextImport initial={text} />
    </div>
  );
}
