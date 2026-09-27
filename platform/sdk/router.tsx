import { createContext, useContext, useSyncExternalStore, useCallback, useMemo, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/* Маленький роутер на History API: общий для оболочки и всех модулей. */

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = { pathname: location.pathname, search: location.search };

function update() {
  if (snapshot.pathname !== location.pathname || snapshot.search !== location.search) {
    snapshot = { pathname: location.pathname, search: location.search };
    for (const l of listeners) l();
  }
}
window.addEventListener("popstate", update);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (/^https?:\/\//.test(to)) {
    location.href = to;
    return;
  }
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  update();
  if (!opts.replace) window.scrollTo(0, 0);
}

export function useHubLocation() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** Сопоставляет шаблон вида /songs/:slug или /files/* с путём. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.replace(/\/+$/, "") || "/";
  const s = path.replace(/\/+$/, "") || "/";
  if (p === "*") return { "*": s.slice(1) };
  const pp = p.split("/");
  const sp = s.split("/");
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i];
    if (seg === "*") {
      params["*"] = sp.slice(i).join("/");
      return params;
    }
    if (i >= sp.length) return null;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(sp[i]);
    else if (seg !== sp[i]) return null;
  }
  return pp.length === sp.length ? params : null;
}

/** Выбирает лучший маршрут: точные совпадения важнее параметров, «*» — последним. */
export function pickRoute<T>(routes: Record<string, T>, path: string): { pattern: string; value: T; params: Record<string, string> } | null {
  const score = (p: string) => (p === "*" ? -1000 : p.split("/").reduce((n, s) => n + (s.startsWith(":") ? 1 : s === "*" ? 0 : 3), 0));
  const sorted = Object.keys(routes).sort((a, b) => score(b) - score(a));
  for (const pattern of sorted) {
    const params = matchPath(pattern, path);
    if (params) return { pattern, value: routes[pattern], params };
  }
  return null;
}

export const RouteContext = createContext<{ params: Record<string, string>; pattern: string }>({ params: {}, pattern: "" });

/** Параметры текущего маршрута: для "/songs/:slug" — { slug }. */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(RouteContext).params as T;
}

/** Привязка путей к базе модуля: "/songs" внутри модуля notes → "/m/notes/songs". */
export function resolveTo(base: string, to: string): string {
  if (/^https?:\/\//.test(to)) return to;
  if (to.startsWith("~/")) return to.slice(1);
  if (to.startsWith("?")) return location.pathname + to;
  const clean = to.startsWith("/") ? to : "/" + to;
  // У оболочки хаба base пустой: "/" должен остаться "/", а не превратиться в "".
  if (clean === "/") return base || "/";
  return base + clean;
}

export function createRouting(base: string) {
  function useNavigate() {
    return useCallback((to: string | number, opts?: { replace?: boolean }) => {
      if (typeof to === "number") history.go(to);
      else navigate(resolveTo(base, to), opts);
    }, []);
  }

  /** Путь внутри модуля (без /m/<id>). */
  function useLocation() {
    const loc = useHubLocation();
    return useMemo(() => {
      const pathname = loc.pathname.startsWith(base) ? loc.pathname.slice(base.length) || "/" : loc.pathname;
      return { pathname, search: loc.search };
    }, [loc]);
  }

  function useSearchParams(): [URLSearchParams, (next: Record<string, string | number | null | undefined>, opts?: { replace?: boolean }) => void] {
    const loc = useHubLocation();
    const params = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
    const set = useCallback(
      (next: Record<string, string | number | null | undefined>, opts?: { replace?: boolean }) => {
        const p = new URLSearchParams(location.search);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === undefined || v === "") p.delete(k);
          else p.set(k, String(v));
        }
        const q = p.toString();
        navigate(location.pathname + (q ? "?" + q : ""), { replace: opts?.replace ?? true });
      },
      [],
    );
    return [params, set];
  }

  type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    to: string;
    /** Классы, добавляемые, когда ссылка ведёт на текущую страницу. */
    activeClassName?: string;
    /** Активна только при точном совпадении пути. */
    end?: boolean;
    replace?: boolean;
    children?: ReactNode;
  };

  function Link({ to, activeClassName, end, replace, className, onClick, children, ...rest }: LinkProps) {
    const href = resolveTo(base, to);
    const loc = useHubLocation();
    const active =
      activeClassName &&
      (end || href === base ? loc.pathname === href : loc.pathname === href || loc.pathname.startsWith(href + "/"));
    const handle = (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
      if (/^https?:\/\//.test(href)) return;
      e.preventDefault();
      navigate(href, { replace });
    };
    return (
      <a href={href} onClick={handle} className={[className, active ? activeClassName : ""].filter(Boolean).join(" ") || undefined} {...rest}>
        {children}
      </a>
    );
  }

  return { useNavigate, useLocation, useSearchParams, Link };
}
