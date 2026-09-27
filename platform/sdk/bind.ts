import { createCollection, createKv, makeUseCollection, makeUseDoc, makeUseStore, type Collection, type CollectionOptions } from "./data.ts";
import { createFiles, makeUseFiles } from "./files.ts";
import { createMedia } from "./media.ts";
import { createRouting } from "./router.tsx";
import { getHost, type ModuleManifest } from "./core.ts";
import { createAi, makeUseAi } from "./ai.ts";

/**
 * Всё, что зависит от того, какой модуль вызывает SDK. Хаб подставляет
 * каждому модулю свою копию этих функций (import "@lifehub/sdk" внутри модуля
 * notes возвращает версию, привязанную к notes), поэтому модулю не нужно
 * передавать свой id — и он не может случайно писать в чужие данные.
 */
export function bind(id: string) {
  const basePath = `/m/${id}`;
  const routing = createRouting(basePath);
  const ai = createAi(id);
  return {
    ai,
    useAi: makeUseAi(ai),
    db: {
      collection: <T = Record<string, unknown>>(name: string, opts?: CollectionOptions): Collection<T> => createCollection<T>(id, name, opts),
    },
    kv: createKv(id),
    files: createFiles(id),
    media: createMedia(id),
    useCollection: makeUseCollection(id),
    useDoc: makeUseDoc(id),
    useStore: makeUseStore(id),
    useFiles: makeUseFiles(id),
    useNavigate: routing.useNavigate,
    useLocation: routing.useLocation,
    useSearchParams: routing.useSearchParams,
    Link: routing.Link,
    useModule: () => ({ id, basePath, manifest: getHost().manifest(id) as ModuleManifest | undefined }),
  };
}

export type BoundSdk = ReturnType<typeof bind>;
