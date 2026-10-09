import { useCallback } from "react";
import { db, kv, toast, useCollection, useStore } from "@lifehub/sdk";
import { DEFAULT_PREFS, type ChatMsg, type Prefs, type Status } from "./types.ts";

export function usePrefs() {
  const [raw, set, meta] = useStore<Prefs>("config", DEFAULT_PREFS);
  const prefs: Prefs = {
    ...DEFAULT_PREFS,
    ...raw,
    morning: { ...DEFAULT_PREFS.morning, ...raw?.morning },
    evening: { ...DEFAULT_PREFS.evening, ...raw?.evening },
    commands: raw?.commands ?? [],
  };
  const update = useCallback(
    (patch: Partial<Prefs>) =>
      set((p) => ({
        ...DEFAULT_PREFS,
        ...p,
        ...patch,
        morning: { ...DEFAULT_PREFS.morning, ...p?.morning, ...patch.morning },
        evening: { ...DEFAULT_PREFS.evening, ...p?.evening, ...patch.evening },
      })),
    [set],
  );
  return { prefs, update, loading: meta.loading };
}

/** Состояние подключения — его пишет хаб. */
export function useStatus() {
  const [status, , meta] = useStore<Status | null>("status", null);
  return { status, loading: meta.loading };
}

/** Разовое действие для хаба. */
export async function action(kind: "rotate" | "unlink") {
  await kv.set("action", { kind, at: Date.now() });
}

export const useChat = () => useCollection<ChatMsg>("chat");

/** Сказать Джарвису текстом — хаб ответит в той же записи. */
export async function say(q: string) {
  if (!q.trim()) return;
  await db.collection<ChatMsg>("chat").add({ q: q.trim(), source: "hub", at: Date.now() });
}

export async function copy(text: string, what = "Скопировано") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what, "success");
  } catch {
    toast("Не получилось скопировать — выделите текст вручную", "error");
  }
}
