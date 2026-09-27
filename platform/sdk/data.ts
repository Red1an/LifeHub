import { useSyncExternalStore, useCallback, useMemo } from "react";
import { request, onHubEvent, getHost, clientId } from "./core.ts";

/*
 * Данные модуля хранятся на сервере хаба (SQLite) и доступны со всех устройств.
 * Изменения, сделанные на телефоне, приходят на компьютер через SSE — и наоборот.
 */

export interface Doc {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type WithDoc<T> = T & Doc;

interface StoreState<T> {
  items: WithDoc<T>[];
  loading: boolean;
  error: string | null;
}

class Store<T> {
  state: StoreState<T> = { items: [], loading: true, error: null };
  loaded = false;
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;

  private url: string;
  private caller: string;
  constructor(url: string, caller: string) {
    this.url = url;
    this.caller = caller;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    if (!this.loaded) this.refresh();
    return () => this.listeners.delete(l);
  };

  get = () => this.state;

  set(next: Partial<StoreState<T>>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = request<WithDoc<T>[]>("GET", this.url, { module: this.caller })
      .then((items) => {
        this.loaded = true;
        this.set({ items, loading: false, error: null });
      })
      .catch((e) => this.set({ loading: false, error: e.message }))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  upsertLocal(doc: WithDoc<T>) {
    const i = this.state.items.findIndex((x) => x.id === doc.id);
    const items = [...this.state.items];
    if (i >= 0) items[i] = doc;
    else items.push(doc);
    this.set({ items });
  }

  removeLocal(id: string) {
    this.set({ items: this.state.items.filter((x) => x.id !== id) });
  }
}

const stores = new Map<string, Store<any>>();
const kvStores = new Map<string, KvStore>();

onHubEvent((e) => {
  if (e.type === "reconnected") {
    for (const s of stores.values()) if (s.loaded) s.refresh();
    for (const s of kvStores.values()) s.refresh();
    return;
  }
  if (e.type !== "data") return;
  // Свои изменения уже применены локально — перечитываем только то, что поменяли другие
  // устройства, или чужие представления той же коллекции (модуль, читающий через from).
  const own = e.origin === clientId;
  if (e.collection.startsWith("kv:")) {
    if (!own) kvStores.get(`${e.module}/${e.collection.slice(3)}`)?.refresh();
    return;
  }
  for (const [key, s] of stores) {
    if (!key.endsWith(`→${e.module}/${e.collection}`) || !s.loaded) continue;
    if (own && key.startsWith(`${e.module}→`)) continue;
    s.refresh();
  }
});

function storeFor<T>(caller: string, module: string, collection: string): Store<T> {
  const key = `${caller}→${module}/${collection}`;
  let s = stores.get(key);
  if (!s) {
    s = new Store<T>(`/api/data/${module}/${encodeURIComponent(collection)}`, caller);
    stores.set(key, s);
  }
  return s;
}

export interface CollectionOptions {
  /** Читать коллекцию другого модуля (нужно разрешение read:<id> в lifehub.json). */
  from?: string;
}

export interface Collection<T> {
  /** Все записи коллекции (по времени создания). */
  list(): Promise<WithDoc<T>[]>;
  get(id: string): Promise<WithDoc<T> | null>;
  /** Добавить запись. id можно передать свой, иначе будет сгенерирован. */
  add(data: T & { id?: string }): Promise<WithDoc<T>>;
  /** Частичное обновление (слияние полей). */
  update(id: string, patch: Partial<T>): Promise<WithDoc<T>>;
  /** Полная замена записи (создаёт, если нет). */
  put(id: string, data: T): Promise<WithDoc<T>>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function createCollection<T>(caller: string, name: string, opts: CollectionOptions = {}): Collection<T> {
  const module = opts.from ?? caller;
  const base = `/api/data/${module}/${encodeURIComponent(name)}`;
  const store = () => storeFor<T>(caller, module, name);
  const readonly = () => {
    if (opts.from && opts.from !== caller) throw new Error(`Коллекция ${opts.from}/${name} доступна только для чтения`);
  };
  return {
    async list() {
      const items = await request<WithDoc<T>[]>("GET", base, { module: caller });
      return items;
    },
    async get(id) {
      try {
        return await request<WithDoc<T>>("GET", `${base}/${encodeURIComponent(id)}`, { module: caller });
      } catch (e: any) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async add(data) {
      readonly();
      const doc = await request<WithDoc<T>>("POST", base, { module: caller, body: data });
      store().upsertLocal(doc);
      return doc;
    },
    async update(id, patch) {
      readonly();
      const doc = await request<WithDoc<T>>("PATCH", `${base}/${encodeURIComponent(id)}`, { module: caller, body: patch });
      store().upsertLocal(doc);
      return doc;
    },
    async put(id, data) {
      readonly();
      const doc = await request<WithDoc<T>>("PUT", `${base}/${encodeURIComponent(id)}`, { module: caller, body: data });
      store().upsertLocal(doc);
      return doc;
    },
    async remove(id) {
      readonly();
      await request("DELETE", `${base}/${encodeURIComponent(id)}`, { module: caller });
      store().removeLocal(id);
    },
    async clear() {
      readonly();
      await request("DELETE", base, { module: caller });
      store().set({ items: [] });
    },
  };
}

export interface UseCollectionResult<T> extends Omit<Collection<T>, "list" | "get"> {
  items: WithDoc<T>[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

export function makeUseCollection(caller: string) {
  return function useCollection<T = Record<string, unknown>>(name: string, opts: CollectionOptions = {}): UseCollectionResult<T> {
    const store = storeFor<T>(caller, opts.from ?? caller, name);
    const state = useSyncExternalStore(store.subscribe, store.get);
    const api = useMemo(() => createCollection<T>(caller, name, opts), [name, opts.from]);
    const withToast = useCallback(<A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => {
      try {
        return await fn(...a);
      } catch (e) {
        getHost().toast((e as Error).message, "error");
        throw e;
      }
    }, []);
    return {
      ...state,
      add: withToast(api.add),
      update: withToast(api.update),
      put: withToast(api.put),
      remove: withToast(api.remove),
      clear: withToast(api.clear),
      reload: () => store.refresh(),
    };
  };
}

export function makeUseDoc(caller: string) {
  const useCollection = makeUseCollection(caller);
  return function useDoc<T = Record<string, unknown>>(name: string, id: string | undefined, opts: CollectionOptions = {}) {
    const c = useCollection<T>(name, opts);
    const doc = id ? (c.items.find((x) => x.id === id) ?? null) : null;
    return {
      doc,
      loading: c.loading,
      error: c.error,
      update: (patch: Partial<T>) => c.update(id!, patch),
      remove: () => c.remove(id!),
    };
  };
}

/* ───────────── ключ-значение: настройки и простое состояние ───────────── */

class KvStore {
  state: { value: unknown; loaded: boolean } = { value: undefined, loaded: false };
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private module: string;
  private key: string;
  constructor(module: string, key: string) {
    this.module = module;
    this.key = key;
  }
  get loaded() {
    return this.state.loaded;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    if (!this.state.loaded) this.refresh().catch(() => {});
    return () => this.listeners.delete(l);
  };
  get = () => this.state;
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = request<{ value: unknown }>("GET", `/api/kv/${this.module}/${this.key}`, { module: this.module })
      .then((r) => this.setLocal(r.value ?? undefined))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
  setLocal(value: unknown) {
    this.state = { value, loaded: true };
    for (const l of this.listeners) l();
  }
  async set(v: unknown) {
    this.setLocal(v);
    await request("PUT", `/api/kv/${this.module}/${this.key}`, { module: this.module, body: { value: v ?? null } });
  }
}

function kvFor(module: string, key: string) {
  const k = `${module}/${key}`;
  let s = kvStores.get(k);
  if (!s) {
    s = new KvStore(module, key);
    kvStores.set(k, s);
  }
  return s;
}

export function createKv(module: string) {
  return {
    async get<T>(key: string, fallback?: T): Promise<T> {
      const s = kvFor(module, key);
      if (!s.loaded) await s.refresh();
      return (s.state.value as T) ?? (fallback as T);
    },
    set<T>(key: string, value: T): Promise<void> {
      return kvFor(module, key).set(value);
    },
    /** Все ключи модуля одним запросом. */
    async entries(): Promise<Record<string, unknown>> {
      const all = await request<Record<string, unknown>>("GET", `/api/kv/${module}`, { module });
      for (const [k, v] of Object.entries(all)) {
        const s = kvFor(module, k);
        if (!s.loaded) s.setLocal(v);
      }
      return all;
    },
  };
}

export function makeUseStore(module: string) {
  /**
   * Как useState, но значение сохраняется на сервере и синхронизируется
   * между устройствами. Подходит для настроек и небольшого состояния.
   */
  return function useStore<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void, { loading: boolean }] {
    const s = kvFor(module, key);
    const { value, loaded } = useSyncExternalStore(s.subscribe, s.get);
    const current = (value === undefined ? initial : value) as T;
    const set = useCallback(
      (next: T | ((prev: T) => T)) => {
        const prev = (s.state.value === undefined ? initial : s.state.value) as T;
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        s.set(v).catch((e) => getHost().toast(e.message, "error"));
      },
      [s],
    );
    return [current, set, { loading: !loaded }];
  };
}
