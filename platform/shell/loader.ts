import type { ModuleDefinition } from "../sdk/define.ts";
import type { ModuleInfo } from "./state.ts";

/*
 * Загрузка модулей: обычный динамический import() скомпилированного бандла.
 * URL содержит хэш сборки, поэтому браузер кэширует модуль навсегда,
 * а после правки получает новую версию по новому адресу.
 */
const cache = new Map<string, Promise<ModuleDefinition>>();

export function loadModule(m: ModuleInfo): Promise<ModuleDefinition> {
  const key = `${m.id}@${m.hash}`;
  let p = cache.get(key);
  if (!p) {
    p = import(/* @vite-ignore */ `/modules/${m.id}/module.js?v=${m.hash}`).then((mod) => {
      const def = mod.default as ModuleDefinition | undefined;
      if (!def || typeof def !== "object" || !def.routes) {
        throw new Error("Модуль должен экспортировать по умолчанию defineModule({ routes: … })");
      }
      return def;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  if (m.hasCss) ensureCss(m);
  return p;
}

function ensureCss(m: ModuleInfo) {
  const id = `lh-module-css-${m.id}`;
  let link = document.getElementById(id) as HTMLLinkElement | null;
  const href = `/modules/${m.id}/module.css?v=${m.hash}`;
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.href = href;
}
