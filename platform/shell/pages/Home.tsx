import { useEffect, useState, type ComponentType } from "react";
import { Page, Button, EmptyState } from "../../sdk/ui.tsx";
import { cn, formatDate } from "../../sdk/format.ts";
import type { ModuleDefinition } from "../../sdk/define.ts";
import { navigate } from "../../sdk/router.tsx";
import { useHub, appModules, saveSettings, type ModuleInfo } from "../state.ts";
import { loadModule } from "../loader.ts";
import { Link } from "../nav.ts";
import { ErrorBoundary } from "../ModuleHost.tsx";
import { ModuleIcon } from "../ModuleIcon.tsx";
import { PlusIcon } from "../icons.tsx";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface WidgetEntry {
  key: string;
  module: ModuleInfo;
  def: ModuleDefinition;
  title: string;
  size: "sm" | "md" | "lg";
  component: ComponentType;
}

export function HomePage() {
  const { state } = useHub();
  const [defs, setDefs] = useState<Record<string, ModuleDefinition>>({});
  const [editing, setEditing] = useState(false);
  const apps = state ? appModules(state) : [];
  const ready = apps.filter((m) => m.status === "ok");
  const hashes = ready.map((m) => m.id + m.hash).join();

  useEffect(() => {
    for (const m of ready) {
      loadModule(m)
        .then((def) => setDefs((d) => (d[m.id] === def ? d : { ...d, [m.id]: def })))
        .catch(() => {});
    }
  }, [hashes]);

  if (!state) return null;
  const hidden = new Set(state.settings.hiddenWidgets);
  const widgets: WidgetEntry[] = ready.flatMap((m) => {
    const def = defs[m.id];
    return Object.entries(def?.widgets ?? {}).map(([name, w]) => ({
      key: `${m.id}:${name}`,
      module: m,
      def: def!,
      title: w.title ?? m.manifest?.name ?? m.id,
      size: w.size ?? "sm",
      component: w.component,
    }));
  });
  const visible = editing ? widgets : widgets.filter((w) => !hidden.has(w.key));

  const toggleWidget = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveSettings({ hiddenWidgets: [...next] });
  };

  return (
    <Page
      width="wide"
      title="Главная"
      subtitle={capitalize(formatDate(new Date(), "weekday"))}
      actions={
        widgets.length > 0 && (
          <Button size="sm" variant={editing ? "primary" : "ghost"} onClick={() => setEditing(!editing)}>
            {editing ? "Готово" : "Виджеты"}
          </Button>
        )
      }
    >
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
        <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-x-2 gap-y-4">
          {apps.map((m) => (
            <Link key={m.id} to={`/m/${m.id}`} className="group flex flex-col items-center gap-1.5 rounded-lg py-1 text-center">
              <span
                className={cn(
                  "grid size-12 place-items-center rounded-xl border border-line bg-surface transition-colors group-hover:border-muted/60",
                  m.status === "error" && "border-danger/60",
                )}
              >
                <ModuleIcon m={m} className="size-7 text-2xl" />
              </span>
              <span className="line-clamp-2 text-xs leading-tight text-fg/80">{m.manifest?.name ?? m.id}</span>
            </Link>
          ))}
          <Link to="/modules/add" className="group flex flex-col items-center gap-1.5 rounded-lg py-1 text-center">
            <span className="grid size-12 place-items-center rounded-xl border border-dashed border-line text-muted transition-colors group-hover:border-muted group-hover:text-fg">
              <PlusIcon className="size-5" />
            </span>
            <span className="text-xs text-muted">Добавить</span>
          </Link>
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((w) => (
            <section
              key={w.key}
              className={cn(
                "flex flex-col overflow-hidden rounded-lg border border-line bg-surface",
                w.size === "md" && "md:col-span-2 xl:col-span-2",
                w.size === "lg" && "md:col-span-2 xl:col-span-3",
                editing && hidden.has(w.key) && "opacity-40",
              )}
            >
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <ModuleIcon m={w.module} className="size-4 text-sm" />
                <Link to={`/m/${w.module.id}`} className="min-w-0 flex-1 truncate text-xs font-medium text-muted hover:text-fg">
                  {w.title}
                </Link>
                {editing && (
                  <button className="text-xs text-muted underline underline-offset-2 hover:text-fg" onClick={() => toggleWidget(w.key)}>
                    {hidden.has(w.key) ? "показать" : "скрыть"}
                  </button>
                )}
              </header>
              {/* Виджет рисуется в теме своего модуля. */}
              <div className="lh-module flex-1 p-3" data-theme={w.def.theme}>
                <ErrorBoundary info={w.module}>
                  <w.component />
                </ErrorBoundary>
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
