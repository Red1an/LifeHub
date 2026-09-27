import { useSyncExternalStore, useEffect } from "react";
import { request, onHubEvent, getHost } from "./core.ts";

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

const caches = new Map<string, { list: FileMeta[] | null; listeners: Set<() => void> }>();

function cache(module: string) {
  let c = caches.get(module);
  if (!c) {
    c = { list: null, listeners: new Set() };
    caches.set(module, c);
  }
  return c;
}

async function refresh(module: string) {
  const c = cache(module);
  c.list = await request<FileMeta[]>("GET", `/api/files/${module}`, { module });
  for (const l of c.listeners) l();
}

onHubEvent((e) => {
  if ((e.type === "data" && e.collection === "files") || e.type === "reconnected") {
    const module = e.type === "data" ? e.module : null;
    for (const [m, c] of caches) if ((module === null || m === module) && c.list) refresh(m);
  }
});

/** Файлы модуля (нужно разрешение "files"): фото, аудиозаписи, документы. */
export function createFiles(module: string) {
  return {
    async upload(file: Blob, name?: string): Promise<FileMeta> {
      const fileName = name ?? (file instanceof File ? file.name : "file");
      const meta = await request<FileMeta>("POST", `/api/files/${module}`, {
        module,
        raw: file,
        headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(fileName) },
      });
      refresh(module).catch(() => {});
      return meta;
    },
    list: () => request<FileMeta[]>("GET", `/api/files/${module}`, { module }),
    /** URL для <img src>, <audio src>, скачивания. */
    url: (id: string) => `/api/files/${module}/${id}`,
    async remove(id: string) {
      await request("DELETE", `/api/files/${module}/${id}`, { module });
      refresh(module).catch(() => {});
    },
  };
}

export function makeUseFiles(module: string) {
  return function useFiles() {
    const c = cache(module);
    const list = useSyncExternalStore(
      (l) => {
        c.listeners.add(l);
        return () => c.listeners.delete(l);
      },
      () => c.list,
    );
    useEffect(() => {
      if (!c.list) refresh(module).catch((e) => getHost().toast(e.message, "error"));
    }, []);
    return { files: list ?? [], loading: list === null };
  };
}
