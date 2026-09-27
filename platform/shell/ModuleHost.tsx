import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { pickRoute, RouteContext } from "../sdk/router.tsx";
import { Button, Loading, Card } from "../sdk/ui.tsx";
import { cn } from "../sdk/format.ts";
import { request } from "../sdk/core.ts";
import type { ModuleDefinition } from "../sdk/define.ts";
import { useHub, getCheckCommand, type ModuleInfo } from "./state.ts";
import { loadModule } from "./loader.ts";
import { Link, useModuleNavSetter } from "./nav.ts";
import { AlertIcon, CopyIcon, FolderIcon, RefreshIcon, GridIcon } from "./icons.tsx";
import { ModuleIcon } from "./ModuleIcon.tsx";
import { copyText } from "./util.ts";

export function ModuleHost({ id, subpath }: { id: string; subpath: string }) {
  const { state } = useHub();
  const info = state?.modules.find((m) => m.id === id);
  const setNav = useModuleNavSetter();
  const [loaded, setLoaded] = useState<{ hash: string; def: ModuleDefinition } | null>(null);
  const [loadError, setLoadError] = useState<{ hash: string; error: Error } | null>(null);

  const hash = info?.status === "ok" ? info.hash : "";
  useEffect(() => {
    if (!info || !hash) return;
    let alive = true;
    loadModule(info)
      .then((def) => alive && (setLoaded({ hash, def }), setLoadError(null)))
      .catch((error) => alive && setLoadError({ hash, error }));
    return () => {
      alive = false;
    };
  }, [id, hash]);

  const def = loaded?.def;
  useEffect(() => {
    setNav(def?.nav?.length ? { id, items: def.nav } : null);
    return () => setNav(null);
  }, [def, id]);

  if (!info) {
    return (
      <Centered>
        <p className="font-medium">Модуль «{id}» не установлен</p>
        <Link to="/modules/add" className="mt-2 inline-block text-sm text-muted underline underline-offset-4">
          Добавить модули
        </Link>
      </Centered>
    );
  }
  if (!info.enabled) {
    return (
      <Centered>
        <ModuleIcon m={info} className="mx-auto size-10 text-4xl" />
        <p className="mt-2 font-medium">Модуль «{info.manifest?.name ?? id}» выключен</p>
        <Button
          variant="primary"
          className="mt-4"
          onClick={() => request("POST", `/api/modules/${id}/enabled`, { body: { enabled: true } })}
        >
          Включить
        </Button>
      </Centered>
    );
  }
  if (info.manifest?.type === "library") {
    return (
      <Centered>
        <p className="font-medium">«{info.manifest.name}» — библиотека для других модулей, у неё нет страниц.</p>
        <Link to={`/modules/${id}`} className="mt-2 inline-block text-sm text-muted underline underline-offset-4">
          Подробнее
        </Link>
      </Centered>
    );
  }
  if (info.status === "error") return <BuildErrors info={info} />;
  if (loadError && loadError.hash === hash) return <RuntimeError info={info} error={loadError.error} />;
  if (!def || loaded?.hash !== hash) {
    // Во время пересборки показываем прошлую версию, чтобы экран не мигал.
    if (!def) return <Loading text="Загружаю модуль…" />;
  }

  const route = pickRoute(def.routes, subpath);
  const Layout = def.layout;
  const content = route ? (
    <RouteContext.Provider value={{ params: route.params, pattern: route.pattern }}>
      <route.value />
    </RouteContext.Provider>
  ) : (
    <Centered>
      <p className="font-medium">В модуле нет страницы {subpath}</p>
      <Link to={`/m/${id}`} className="mt-2 inline-block text-sm text-muted underline underline-offset-4">
        На главную модуля
      </Link>
    </Centered>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ModuleHeader info={info} def={def} />
      {/* Область модуля: модуль сам решает, как она выглядит; theme переопределяет токены темы внутри. */}
      <div className="lh-module flex flex-1 flex-col" data-theme={def.theme}>
        <ErrorBoundary key={`${hash}:${route?.pattern}`} info={info}>
          {Layout ? <Layout>{content}</Layout> : content}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Минимальная шапка хаба над модулем.
 * Телефон: всегда — «к хабу» + название модуля (ведёт на главную модуля).
 * Компьютер: только если у модуля есть разделы (nav) — название + вкладки.
 * Иначе на компьютере весь экран отдан модулю, а в модуль ведёт его иконка в полосе слева.
 */
function ModuleHeader({ info, def }: { info: ModuleInfo; def: ModuleDefinition }) {
  const base = `/m/${info.id}`;
  const nav = def.nav ?? [];
  const name = (
    <Link to={base} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2" title="На главную модуля">
      <ModuleIcon m={info} className="size-5 text-base" />
      <span className="truncate text-sm font-medium">{info.manifest?.name}</span>
    </Link>
  );
  return (
    <>
      <div className="pt-safe sticky top-0 z-40 border-b border-line bg-surface lg:hidden">
        <div className="flex h-11 items-center gap-1 px-2">
          <Link to="/" aria-label="В хаб" title="В хаб" className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <GridIcon className="size-[18px]" />
          </Link>
          <span className="h-4 w-px bg-line" />
          {name}
        </div>
      </div>
      {nav.length > 0 && (
        <div className="hidden h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-3 lg:flex">
          {name}
          <span className="mx-2 h-4 w-px bg-line" />
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to === "/" ? base : base + n.to}
              end={n.to === "/"}
              className="rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              activeClassName="!bg-surface-2 !text-fg font-medium"
            >
              {n.icon && <span className="mr-1.5">{n.icon}</span>}
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center p-6 text-center"><div>{children}</div></div>;
}

/** Текст ошибки, который удобно вставить в Claude Code. */
function reportFor(info: ModuleInfo, kind: string, details: string) {
  return `Модуль LifeHub "${info.id}" (папка ${info.dir}) — ${kind}:\n\n${details}\n\nИсправь, пожалуйста. Проверить сборку: ${getCheckCommand()} ${info.id}`;
}

export function BuildErrors({ info, compact }: { info: ModuleInfo; compact?: boolean }) {
  const { state } = useHub();
  const [busy, setBusy] = useState(false);
  const text = info.errors.join("\n\n");
  return (
    <div className={cn(!compact && "mx-auto max-w-4xl px-4 py-8 sm:px-6")}>
      <Card className="border-danger/40">
        <div className="flex items-start gap-3">
          <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">«{info.manifest?.name ?? info.id}» не собирается</h2>
            <p className="mt-1 text-sm text-muted">
              Скопируйте ошибку и отдайте её Claude Code в папке модуля — хаб пересоберёт модуль сам, как только файлы изменятся.
            </p>
          </div>
        </div>
        <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<CopyIcon className="size-4" />} onClick={() => copyText(reportFor(info, "ошибка сборки", text))}>
            Скопировать для Claude Code
          </Button>
          {state?.isLocal && (
            <Button icon={<FolderIcon className="size-4" />} onClick={() => request("POST", `/api/modules/${info.id}/open-folder`)}>
              Открыть папку
            </Button>
          )}
          <Button
            icon={<RefreshIcon className="size-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("POST", `/api/modules/${info.id}/rebuild`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Пересобрать
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RuntimeError({ info, error, onRetry }: { info: ModuleInfo; error: Error; onRetry?: () => void }) {
  const details = `${error.message}\n\n${error.stack ?? ""}`.trim();
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Card className="border-danger/40">
        <div className="flex items-start gap-3">
          <AlertIcon className="mt-0.5 size-6 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">В модуле «{info.manifest?.name ?? info.id}» произошла ошибка</h2>
            <p className="mt-1 text-sm text-muted">{error.message}</p>
          </div>
        </div>
        <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{error.stack}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<CopyIcon className="size-4" />} onClick={() => copyText(reportFor(info, "ошибка во время работы", details))}>
            Скопировать для Claude Code
          </Button>
          {onRetry && <Button onClick={onRetry}>Попробовать снова</Button>}
        </div>
      </Card>
    </div>
  );
}

class ErrorBoundary extends Component<{ info: ModuleInfo; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.info.id}]`, error, info.componentStack);
  }
  render() {
    if (this.state.error) return <RuntimeError info={this.props.info} error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

export { ErrorBoundary };
