import { Component, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Page, Button, EmptyState } from "../../sdk/ui.tsx";
import { cn, formatDate, plural } from "../../sdk/format.ts";
import type { ModuleDefinition, ModuleSummary } from "../../sdk/define.ts";
import { navigate } from "../../sdk/router.tsx";
import { useHub, appModules, type ModuleInfo } from "../state.ts";
import { loadModule } from "../loader.ts";
import { Link } from "../nav.ts";
import { ModuleIcon } from "../ModuleIcon.tsx";
import { PlusIcon, ChevronRight, AlertIcon, RefreshIcon } from "../icons.tsx";
import { useModuleHues } from "../hue.ts";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/*
 * Главная хаба — быстрый запуск модулей. Каждая плитка показывает главное из модуля
 * (ModuleDefinition.summary: цифра и строка), без сводки — описание из манифеста.
 * Сверху — только то, что касается самого хаба: ошибки сборки и обновления.
 */
export function HomePage() {
  const { state } = useHub();
  const [defs, setDefs] = useState<Record<string, ModuleDefinition>>({});
  const [summaries, setSummaries] = useState<Record<string, ModuleSummary | null>>({});
  const now = useNow();
  const apps = state ? appModules(state) : [];
  const hues = useModuleHues(apps);
  // Сервисы не грузятся бандлом — у них сводки нет.
  const ready = apps.filter((m) => m.status === "ok" && m.manifest?.type !== "service");
  const hashes = ready.map((m) => m.id + m.hash).join();

  useEffect(() => {
    for (const m of ready) {
      loadModule(m)
        .then((def) => setDefs((d) => (d[m.id] === def ? d : { ...d, [m.id]: def })))
        .catch(() => {});
    }
  }, [hashes]);

  if (!state) return null;
  const report = (id: string, s: ModuleSummary | null) =>
    setSummaries((all) => (JSON.stringify(all[id]) === JSON.stringify(s) ? all : { ...all, [id]: s }));
  const broken = state.modules.filter((m) => m.enabled && m.status === "error");
  const updates = state.modules.filter((m) => m.update || m.source?.pending);

  return (
    <Page width="wide">
      {/* Сводки считаются невидимыми компонентами: хук модуля нужно вызвать внутри React. */}
      {ready.map((m) => {
        const use = defs[m.id]?.summary;
        return use ? (
          <Quiet key={m.id + m.hash}>
            <SummaryProbe id={m.id} use={use} onChange={report} />
          </Quiet>
        ) : null;
      })}

      <Hero now={now} name={state.settings.userName} hues={apps.map((m) => hues[m.id]).filter((h) => h !== undefined)} />

      {apps.length === 0 ? (
        <EmptyState
          title="Модулей пока нет"
          text="Модуль — отдельное маленькое приложение со своим интерфейсом: финансы, заметки, тренажёр. Добавьте готовый или сделайте свой с нейронкой."
          action={
            <Button variant="primary" onClick={() => navigate("/modules/add")}>
              Добавить модуль
            </Button>
          }
        />
      ) : (
        <>
          {(broken.length > 0 || updates.length > 0) && (
            <Link
              to="/modules"
              className={cn(
                "mb-4 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-surface-2",
                broken.length ? "border-danger/40" : "border-line",
              )}
            >
              {broken.length ? <AlertIcon className="size-5 shrink-0 text-danger" /> : <RefreshIcon className="size-5 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                {[
                  broken.length && `Не собирается: ${broken.map((m) => m.manifest?.name ?? m.id).join(", ")}`,
                  updates.length && `${updates.length} ${plural(updates.length, ["обновление", "обновления", "обновлений"])} модулей`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {apps.map((m, i) => (
              <ModuleTile key={m.id} m={m} hue={hues[m.id]} index={i} summary={summaries[m.id]} />
            ))}
            <Link
              to="/modules/add"
              className="lh-rise flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-muted transition-colors hover:border-muted hover:text-fg"
            >
              <PlusIcon className="size-5" />
              <span className="text-xs">Добавить модуль</span>
            </Link>
          </div>
        </>
      )}
    </Page>
  );
}

/** Плитка модуля: иконка, название и главное из сводки. */
function ModuleTile({ m, hue, index, summary }: { m: ModuleInfo; hue?: number; index: number; summary?: ModuleSummary | null }) {
  const name = m.manifest?.name ?? m.id;
  let value = summary?.value;
  let text = summary?.text;
  if (m.status === "error") text = "Не собирается";
  else if (m.status === "building") text = "Собирается…";
  else if (m.service && m.service.state !== "running") text = { stopped: "Остановлен", installing: "Устанавливается…", starting: "Запускается…", error: "Не запускается", running: "" }[m.service.state];
  else if (!value && !text) text = m.manifest?.description;

  return (
    <Link
      to={`/m/${m.id}`}
      style={{ ...(hue !== undefined && { "--h": hue }), animationDelay: `${Math.min(index, 12) * 30}ms` } as CSSProperties}
      className={cn("lh-tile lh-rise flex min-h-[112px] flex-col rounded-2xl p-3", m.status === "error" && "!border-danger/60")}
    >
      <div className="flex items-center gap-2.5">
        <span className="lh-tile-icon grid size-9 shrink-0 place-items-center rounded-xl">
          <ModuleIcon m={m} className="size-6 text-[22px]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
      </div>
      <div className="mt-auto pt-2.5">
        {value && <div className="truncate text-xl font-semibold leading-7 tracking-tight tabular-nums">{value}</div>}
        {text && (
          <div className={cn("text-xs leading-snug", m.status === "error" ? "text-danger" : "text-muted", value ? "truncate" : "line-clamp-2")}>{text}</div>
        )}
      </div>
    </Link>
  );
}

/** Шапка: дата, время, приветствие — на фоне «сияния» из цветов модулей. */
function Hero({ now, name, hues }: { now: Date; name: string; hues: number[] }) {
  const [h1 = 210, h3 = 30] = [hues[0], hues[hues.length - 1]];
  return (
    <header className="lh-hero lh-rise mb-4 rounded-2xl px-4 py-5 sm:px-6" style={{ "--h1": h1, "--h3": h3 } as CSSProperties}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg/70">
            {greeting(now)}
            {name ? `, ${name}` : ""}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{capitalize(formatDate(now, "weekday"))}</h1>
        </div>
        <div className="shrink-0 text-3xl font-light leading-none tracking-tight tabular-nums sm:text-4xl">{formatDate(now, "time")}</div>
      </div>
    </header>
  );
}

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

function SummaryProbe({ id, use, onChange }: { id: string; use: () => ModuleSummary | null; onChange: (id: string, s: ModuleSummary | null) => void }) {
  const s = use();
  const json = JSON.stringify(s ?? null);
  useEffect(() => onChange(id, s ?? null), [json]);
  return null;
}

/** Ошибка в сводке не должна ломать главную: плитка просто покажет описание. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Текущее время с точностью до минуты. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}
