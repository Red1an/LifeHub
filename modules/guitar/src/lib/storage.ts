import { createElement, useEffect, useState, type ReactNode } from "react";
import { kv, Loading } from "@lifehub/sdk";

/*
 * GuitarHub изначально хранил всё в localStorage синхронными вызовами.
 * Этот фасад сохраняет тот же синхронный API, но данные живут в хранилище хаба
 * (kv модуля) и поэтому одинаковы на телефоне и компьютере.
 * Перед показом страниц все значения загружаются одним запросом (StorageGate).
 */

const cache = new Map<string, string>();
const keyOf = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, "_");
let loaded = false;
let inflight: Promise<void> | null = null;

export function loadHubStorage(): Promise<void> {
  inflight ??= kv
    .entries()
    .then((all) => {
      for (const [k, v] of Object.entries(all)) if (typeof v === "string") cache.set(k, v);
      loaded = true;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export const hubStorage = {
  getItem(key: string): string | null {
    return cache.get(keyOf(key)) ?? null;
  },
  setItem(key: string, value: string) {
    const k = keyOf(key);
    cache.set(k, value);
    kv.set(k, value).catch(() => {});
  },
  removeItem(key: string) {
    const k = keyOf(key);
    cache.delete(k);
    kv.set(k, null).catch(() => {});
  },
};

/** Обёртка модуля: при открытии подтягивает свежие данные (могли измениться на другом устройстве). */
export function StorageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    loadHubStorage().then(() => setReady(true), () => setReady(true));
  }, []);
  return ready ? children : createElement(Loading);
}
