import { useEffect, useState } from "react";
import { Page, Section, Card, Button, Input, Switch, Field, Badge, Link, Select, toast, cn } from "@lifehub/sdk";
import { pauseState, useConfig, useExtension, useInstall, usePhone, usePhoneApps } from "../lib/store";
import type { FocusConfig, Site } from "../lib/types";

type Plain = Omit<FocusConfig, "pending">;
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Тикает раз в секунду — для обратных отсчётов. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const left = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Settings() {
  const { config, draft, pending, save, cancelPending, setPause, loading } = useConfig();
  const now = useNow();
  if (loading) return null;
  const set = (patch: Partial<Plain>) => save({ ...draft, ...patch });
  const setSite = (id: string, patch: Partial<Site>) => set({ sites: draft.sites.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  return (
    <Page title="Настройки" subtitle="Ужесточить — сразу. Ослабить — только через задержку." width="normal">
      <ExtensionCard />
      <PhoneCard />

      {pending && (
        <Card className="mb-6 border-warning/40 bg-warning/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">Ослабление вступит в силу через {left(pending.applyAt - now)}</div>
              <div className="text-sm text-muted">Если это был порыв — отмени. До тех пор действуют прежние настройки.</div>
            </div>
            <Button variant="secondary" onClick={cancelPending}>
              Отменить
            </Button>
          </div>
        </Card>
      )}

      <PauseCard config={config} now={now} setPause={setPause} />

      <SitesSection draft={draft} set={set} setSite={setSite} />

      <Section title="Вход">
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ждать перед входом, сек" hint="Пока ждёшь, порыв часто проходит сам">
              <NumberInput value={draft.waitSec} onChange={(v) => set({ waitSec: v })} wide />
            </Field>
            <Field label="+ за каждый заход сегодня, сек" hint="Третий заход за день — уже долго">
              <NumberInput value={draft.waitStepSec} onChange={(v) => set({ waitStepSec: v })} wide />
            </Field>
          </div>
          <Field label="Варианты таймера, мин" hint="Через запятую">
            <ListInput value={draft.minutes} onChange={(v) => v.length && set({ minutes: v })} />
          </Field>
          <Field label="Задержка ослабления и паузы, мин">
            <NumberInput value={draft.pauseDelayMin} onChange={(v) => set({ pauseDelayMin: v })} wide />
          </Field>
        </Card>
      </Section>

      <Section title="Рабочее время">
        <Card className="space-y-4">
          <Switch checked={draft.work.on} onChange={(v) => set({ work: { ...draft.work, on: v } })} label="Строже в рабочее время: ждать вдвое дольше, не больше 10 минут" />
          {draft.work.on && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {WEEK.map((d) => {
                  const on = draft.work.days.includes(d);
                  return (
                    <button
                      key={d}
                      className={cn("h-10 w-11 rounded-lg text-sm", on ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}
                      onClick={() => set({ work: { ...draft.work, days: on ? draft.work.days.filter((x) => x !== d) : [...draft.work.days, d] } })}
                    >
                      {WEEK_NAMES[d]}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Input type="time" className="w-32" value={draft.work.from} onChange={(e) => e.target.value && set({ work: { ...draft.work, from: e.target.value } })} />
                —
                <Input type="time" className="w-32" value={draft.work.to} onChange={(e) => e.target.value && set({ work: { ...draft.work, to: e.target.value } })} />
              </div>
            </>
          )}
        </Card>
      </Section>
    </Page>
  );
}

/** Сайты и приложения под защитой: встроенные (включить/выключить) и свои (добавить/удалить). */
function SitesSection({ draft, set, setSite }: { draft: Plain; set: (p: Partial<Plain>) => void; setSite: (id: string, p: Partial<Site>) => void }) {
  const [phoneApps] = usePhoneApps();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [apps, setApps] = useState<string[]>([]);
  const label = (pkg: string) => phoneApps?.apps.find((a) => a.pkg === pkg)?.label ?? pkg;
  const parseHosts = (t: string) =>
    [...new Set(t.split(/[\s,;]+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((h) => h.includes(".")))];

  function addSite() {
    const n = name.trim();
    const h = parseHosts(hosts);
    if (!n || (!h.length && !apps.length)) return toast("Нужно название и сайт или приложение", "error");
    const id = "c-" + Date.now().toString(36);
    set({ sites: [...draft.sites, { id, name: n, hosts: h, on: true, clean: false, dailyMin: 20, apps, custom: true }] });
    setAdding(false);
    setName("");
    setHosts("");
    setApps([]);
    toast(`«${n}» под защитой`, "success");
  }

  return (
    <Section title="Сайты и приложения">
      <div className="space-y-3">
        {draft.sites.map((s) => (
          <Card key={s.id} padding="sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{s.name}</div>
                <div className="truncate text-xs text-muted">
                  {[s.hosts.join(", "), (s.apps ?? []).length ? `📱 ${(s.apps ?? []).map(label).join(", ")}` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Switch checked={s.on} onChange={(v) => setSite(s.id, { on: v })} />
            </div>
            {s.on && (
              <div className="mt-3 space-y-3 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    Лимит в день
                    <NumberInput value={s.dailyMin} onChange={(v) => setSite(s.id, { dailyMin: v })} />
                    мин
                  </label>
                  {(s.id === "youtube" || s.id === "instagram") && (
                    <Switch
                      checked={s.clean}
                      onChange={(v) => setSite(s.id, { clean: v })}
                      label={s.id === "youtube" ? "Без рекомендаций и Shorts" : "Без Reels и «Интересного»"}
                    />
                  )}
                </div>
                <AppsPicker value={s.apps ?? []} onChange={(v) => setSite(s.id, { apps: v })} />
                {s.custom && (
                  <Button size="sm" variant="ghost" onClick={() => set({ sites: draft.sites.filter((x) => x.id !== s.id) })}>
                    Удалить
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}
        {adding ? (
          <Card className="space-y-3">
            <Field label="Название">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Авито" />
            </Field>
            <Field label="Сайты" hint="Через запятую: avito.ru, m.avito.ru — поддомены считаются сами">
              <Input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="avito.ru" />
            </Field>
            <AppsPicker value={apps} onChange={setApps} />
            <div className="flex gap-2">
              <Button onClick={addSite}>Добавить</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Отмена
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            + Свой сайт или приложение
          </Button>
        )}
      </div>
    </Section>
  );
}

/** Приложения на телефоне для сайта: выбрать из установленных (их список присылает LifeHub). */
function AppsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [phoneApps] = usePhoneApps();
  const label = (pkg: string) => phoneApps?.apps.find((a) => a.pkg === pkg)?.label ?? pkg;
  const installed = new Set(phoneApps?.apps.map((a) => a.pkg) ?? []);
  // Показываем только то, что стоит на телефоне (если список уже пришёл), остальное — в подсказке.
  const shown = phoneApps ? value.filter((p) => installed.has(p)) : value;
  const options = (phoneApps?.apps ?? []).filter((a) => !value.includes(a.pkg));
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">📱 На телефоне:</span>
      {shown.map((p) => (
        <span key={p} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1">
          {label(p)}
          <button className="rounded-full px-1.5 text-muted hover:text-fg" aria-label="Убрать" onClick={() => onChange(value.filter((x) => x !== p))}>
            ✕
          </button>
        </span>
      ))}
      {phoneApps ? (
        <Select
          className="w-48 !py-1"
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          options={[{ value: "", label: "+ приложение…" }, ...options.map((a) => ({ value: a.pkg, label: a.label }))]}
        />
      ) : (
        <span className="text-xs text-muted">{shown.length ? "" : "нет — "}список приложений появится, когда подключишь LifeHub на телефоне</span>
      )}
    </div>
  );
}

function PauseCard({ config, now, setPause }: { config: Plain; now: number; setPause: (p: FocusConfig["pause"]) => void }) {
  const st = pauseState(config, now);
  const p = config.pause;
  const endOfDay = () => new Date().setHours(23, 59, 59, 999);
  return (
    <Section title="Пауза">
      <Card>
        {st === "off" ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Выключить фокус на время. Пауза начнётся через {config.pauseDelayMin} мин — чтобы её не включали ради «одного ролика».
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPause({ requestedAt: Date.now(), until: Date.now() + config.pauseDelayMin * 60_000 + 3_600_000 })}>
                На час
              </Button>
              <Button variant="secondary" onClick={() => setPause({ requestedAt: Date.now(), until: endOfDay() })}>
                До конца дня
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {st === "waiting" ? (
                <div className="font-medium">Пауза начнётся через {left(p!.requestedAt + config.pauseDelayMin * 60_000 - now)}</div>
              ) : (
                <div className="font-medium">
                  Фокус на паузе до {new Date(p!.until).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
            </div>
            <Button
              onClick={() => {
                setPause(null);
                toast("Фокус снова включён", "success");
              }}
            >
              {st === "waiting" ? "Отменить" : "Включить фокус"}
            </Button>
          </div>
        )}
      </Card>
    </Section>
  );
}

function ExtensionCard() {
  const [ext] = useExtension();
  const [install] = useInstall();
  const connected = !!ext && Date.now() - ext.seenAt < 3 * 60_000;
  const outdated = !!ext && ext.version < "1.1.0";
  if (connected && !outdated)
    return (
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Badge tone="success">Расширение работает</Badge>
        <span className="text-muted">версия {ext!.version}</span>
      </div>
    );
  return (
    <Card className="mb-6">
      <div className="mb-2 font-medium">{ext ? "Расширение не на связи" : "Поставь расширение браузера"}</div>
      <div className="space-y-2 text-sm text-muted">
        <p>Фокус работает через расширение «Джарвис — вкладки и фокус». Если оно уже стоит для Джарвиса — просто обнови его.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Открой vivaldi://extensions (или chrome://extensions).</li>
          <li>Включи «Режим разработчика».</li>
          <li>Уже стоит — нажми ⟳ у расширения. Нет — «Загрузить распакованное» и выбери папку:</li>
        </ol>
        {install?.extensionPath && (
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg">{install.extensionPath}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(install.extensionPath).then(() => toast("Путь скопирован", "success"))}
            >
              Копировать
            </Button>
          </div>
        )}
        {ext && <p className="text-xs">Последний раз было на связи {new Date(ext.seenAt).toLocaleString("ru")}. Хаб должен быть запущен — без него расширение работает по последним настройкам.</p>}
      </div>
    </Card>
  );
}

/** Фокус на телефоне — в приложении LifeHub (phone/android): подключается в настройках хаба. */
function PhoneCard() {
  const [phone] = usePhone();
  const connected = !!phone && Date.now() - phone.seenAt < 60 * 60_000;
  return (
    <Section title="Телефон">
      <Card className="text-sm">
        {phone ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={connected ? "success" : "neutral"}>{connected ? "Телефон на связи" : "Телефон подключён"}</Badge>
            <span className="text-muted">последний раз {new Date(phone.seenAt).toLocaleString("ru")}</span>
          </div>
        ) : (
          <p className="text-muted">
            На телефоне Фокус встроен в приложение LifeHub: тот же «Зачем пришёл?» перед YouTube и Инстой — в приложениях и в браузере,
            работает и без связи.{" "}
            <Link to="~/settings" className="text-accent underline">
              Подключить телефон
            </Link>{" "}
            — в настройках хаба, раздел «Приложение на телефоне».
          </p>
        )}
      </Card>
    </Section>
  );
}

function NumberInput({ value, onChange, wide }: { value: number; onChange: (v: number) => void; wide?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      inputMode="numeric"
      className={wide ? "w-full" : "w-20"}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
      onBlur={() => {
        const n = Math.min(999, Number(text) || 0);
        if (n !== value) onChange(n);
        else setText(String(value));
      }}
    />
  );
}

function ListInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value.join()]);
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = [...new Set(text.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n <= 180))].sort((a, b) => a - b);
        if (list.join() !== value.join()) onChange(list);
        else setText(value.join(", "));
      }}
    />
  );
}
