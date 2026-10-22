import { Component, useEffect, useState, type ReactNode } from "react";
import { Page, Button, EmptyState } from "../../sdk/ui.tsx";
import { cn, formatDate, plural } from "../../sdk/format.ts";
import type { ModuleDefinition, ModuleSummary } from "../../sdk/define.ts";
import { navigate } from "../../sdk/router.tsx";
import { useHub, appModules, type ModuleInfo } from "../state.ts";
import { loadModule } from "../loader.ts";
import { Link } from "../nav.ts";
import { ModuleIcon } from "../ModuleIcon.tsx";
import { PlusIcon, ChevronRight, AlertIcon, RefreshIcon } from "../icons.tsx";

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

      <header className="mb-5">
        <h1 className="text-xl font-semibold leading-8 sm:text-2xl">{capitalize(formatDate(now, "weekday"))}</h1>
        <p className="text-sm text-muted tabular-nums">{formatDate(now, "time")}</p>
      </header>

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
            {apps.map((m) => (
              <ModuleTile key={m.id} m={m} summary={summaries[m.id]} />
            ))}
            <Link
              to="/modules/add"
              className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-muted transition-colors hover:border-muted hover:text-fg"
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
function ModuleTile({ m, summary }: { m: ModuleInfo; summary?: ModuleSummary | null }) {
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
      className={cn(
        "flex min-h-[104px] flex-col rounded-xl border border-line bg-surface p-3 transition-colors hover:border-muted/60 hover:bg-surface-2/40 active:scale-[0.98]",
        m.status === "error" && "border-danger/50",
      )}
    >
      <div className="flex items-center gap-2">
        <ModuleIcon m={m} className="size-7 shrink-0 text-2xl" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      </div>
      <div className="mt-auto pt-2">
        {value && <div className="truncate text-lg font-semibold leading-6 tabular-nums">{value}</div>}
        {text && (
          <div className={cn("text-xs leading-snug", m.status === "error" ? "text-danger" : "text-muted", value ? "truncate" : "line-clamp-2")}>{text}</div>
        )}
      </div>
    </Link>
  );
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
