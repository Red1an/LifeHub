import { useState, type ReactNode } from "react";
import { useHubLocation, matchPath } from "../sdk/router.tsx";
import { Loading, Button } from "../sdk/ui.tsx";
import { cn } from "../sdk/format.ts";
import type { NavItem } from "../sdk/define.ts";
import { useHub, appModules } from "./state.ts";
import { HostLayer } from "./host.tsx";
import { Link, ModuleNavContext } from "./nav.ts";
import { HomeIcon, GridIcon, SettingsIcon, PlusIcon, Logo } from "./icons.tsx";
import { ModuleIcon } from "./ModuleIcon.tsx";
import { ModuleHost } from "./ModuleHost.tsx";
import { HomePage } from "./pages/Home.tsx";
import { ModulesPage } from "./pages/Modules.tsx";
import { ModuleDetailsPage } from "./pages/ModuleDetails.tsx";
import { AddModulePage } from "./pages/AddModule.tsx";
import { SettingsPage } from "./pages/Settings.tsx";

/*
 * Оболочка хаба — нейтральная рамка вокруг модулей. У каждого модуля свой дизайн,
 * поэтому хаб занимает минимум места и не навязывает стиль:
 *  - компьютер: узкая полоса слева с иконками модулей;
 *  - телефон, страницы хаба: нижнее меню хаба;
 *  - телефон, внутри модуля: тонкая полоса сверху (назад в хаб + название модуля),
 *    а нижнее меню — только если модуль сам объявил разделы (nav).
 */
export function App() {
  const { state, error } = useHub();
  const loc = useHubLocation();
  const [moduleNav, setModuleNav] = useState<{ id: string; items: NavItem[] } | null>(null);

  if (!state) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        {error ? (
          <div>
            <p className="font-medium">Не удалось связаться с хабом</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <Button className="mt-4" onClick={() => location.reload()}>
              Повторить
            </Button>
          </div>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const path = loc.pathname;
  const moduleMatch = matchPath("/m/:id/*", path) ?? matchPath("/m/:id", path);
  let page: ReactNode;
  if (moduleMatch) page = <ModuleHost key={moduleMatch.id} id={moduleMatch.id} subpath={"/" + (moduleMatch["*"] ?? "")} />;
  else if (path === "/") page = <HomePage />;
  else if (path === "/modules") page = <ModulesPage />;
  else if (path === "/modules/add") page = <AddModulePage />;
  else if (matchPath("/modules/:id", path)) page = <ModuleDetailsPage id={matchPath("/modules/:id", path)!.id} />;
  else if (path === "/settings") page = <SettingsPage />;
  else page = <NotFound />;

  const inModule = moduleMatch?.id;
  const activeModuleNav = inModule && moduleNav?.id === inModule && moduleNav.items.length ? moduleNav.items : null;
  const hasBottomBar = !inModule || !!activeModuleNav;

  return (
    <ModuleNavContext.Provider value={{ set: setModuleNav }}>
      <div className="flex min-h-dvh">
        <Rail current={inModule} path={path} />
        <main className={cn("flex min-w-0 flex-1 flex-col", hasBottomBar && "pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0")}>{page}</main>
      </div>
      {inModule ? activeModuleNav && <ModuleTabBar path={path} moduleId={inModule} items={activeModuleNav} /> : <HubTabBar path={path} />}
      <HostLayer />
    </ModuleNavContext.Provider>
  );
}

/** Полоса слева на компьютере: хаб, модули, управление. */
function Rail({ current, path }: { current?: string; path: string }) {
  const { state } = useHub();
  const apps = state ? appModules(state) : [];
  const updatesCount = state?.modules.filter((m) => m.update || m.source?.pending).length ?? 0;
  const item = (active: boolean) =>
    cn(
      "relative grid size-10 place-items-center rounded-md transition-colors",
      active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
    );
  const marker = (active: boolean) =>
    active && <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r bg-fg" aria-hidden />;

  return (
    <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center border-r border-line bg-surface py-2 lg:flex">
      <Link to="/" title="Главная" className={item(path === "/")}>
        {marker(path === "/")}
        <Logo className="size-5" />
      </Link>
      <div className="my-2 h-px w-6 bg-line" />
      <nav className="no-scrollbar flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {apps.map((m) => (
          <Link key={m.id} to={`/m/${m.id}`} title={m.manifest?.name ?? m.id} className={item(current === m.id)}>
            {marker(current === m.id)}
            <ModuleIcon m={m} className="size-6 text-xl" />
            {m.status === "error" && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-danger" />}
          </Link>
        ))}
        <Link to="/modules/add" title="Добавить модуль" className={item(false)}>
          <PlusIcon className="size-[18px]" />
        </Link>
      </nav>
      <div className="flex flex-col items-center gap-1 pt-2">
        <Link to="/modules" title={updatesCount ? `Модули · обновлений: ${updatesCount}` : "Модули"} className={item(path.startsWith("/modules") && path !== "/modules/add")}>
          {marker(path.startsWith("/modules") && path !== "/modules/add")}
          <GridIcon className="size-[18px]" />
          {updatesCount > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />}
        </Link>
        <Link to="/settings" title="Настройки" className={item(path === "/settings")}>
          {marker(path === "/settings")}
          <SettingsIcon className="size-[18px]" />
        </Link>
      </div>
    </aside>
  );
}

const tab = (active: boolean) =>
  cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors", active ? "text-fg" : "text-muted");

function HubTabBar({ path }: { path: string }) {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-50 flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-line bg-surface lg:hidden">
      <Link to="/" className={tab(path === "/")}>
        <HomeIcon className="size-5" />
        Главная
      </Link>
      <Link to="/modules" className={tab(path.startsWith("/modules"))}>
        <GridIcon className="size-5" />
        Модули
      </Link>
      <Link to="/settings" className={tab(path === "/settings")}>
        <SettingsIcon className="size-5" />
        Настройки
      </Link>
    </nav>
  );
}

/** Разделы модуля на телефоне (если модуль объявил nav). */
function ModuleTabBar({ path, moduleId, items }: { path: string; moduleId: string; items: NavItem[] }) {
  const base = `/m/${moduleId}`;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-50 flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-line bg-surface lg:hidden">
      {items.slice(0, 5).map((n) => {
        const href = n.to === "/" ? base : base + n.to;
        const active = n.to === "/" ? path === base || path === base + "/" : path === href || path.startsWith(href + "/");
        return (
          <Link key={n.to} to={href} className={tab(active)}>
            {n.icon && <span className="text-lg leading-5">{n.icon}</span>}
            <span className="max-w-full truncate px-1">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="font-medium">Такой страницы нет</p>
        <Link to="/" className="mt-2 inline-block text-sm text-muted underline underline-offset-4">
          На главную
        </Link>
      </div>
    </div>
  );
}
