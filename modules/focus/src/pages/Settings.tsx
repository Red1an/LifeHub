import { useEffect, useState } from "react";
import { Page, Section, Card, Button, Input, Switch, Field, Badge, toast, cn } from "@lifehub/sdk";
import { pauseState, useConfig, useExtension, useInstall } from "../lib/store";
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

      <Section title="Сайты">
        <div className="space-y-3">
          {draft.sites.map((s) => (
            <Card key={s.id} padding="sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted">{s.hosts.join(", ")}</div>
                </div>
                <Switch checked={s.on} onChange={(v) => setSite(s.id, { on: v })} />
              </div>
              {s.on && (
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-3">
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
              )}
            </Card>
          ))}
        </div>
      </Section>

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
