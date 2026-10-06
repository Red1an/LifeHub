import { useCallback, useRef, useState } from "react";
import { clientId, getHost, request } from "./core.ts";

/*
 * Нейронка для модулей (разрешение "ai" в lifehub.json).
 * Запросы выполняет Claude Code пользователя на компьютере с хабом —
 * поэтому работает и с телефона, а API-ключ не нужен.
 */

export interface AiOptions {
  /** Системная инструкция: роль и правила ответа. */
  system?: string;
  /** "fast" — быстрая модель для коротких ответов, "smart" (по умолчанию) — основная. */
  model?: "fast" | "smart";
  /**
   * Картинки к запросу (до 5): Blob/File или id файла модуля (files.upload).
   * Большие фото уменьшаются в браузере до 1568px по длинной стороне.
   */
  images?: (Blob | string)[];
  /** Кусочки ответа по мере генерации. */
  onDelta?: (delta: string, full: string) => void;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class AiRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export function createAi(module: string) {
  function checkPermission() {
    const m = getHost().manifest(module);
    if (m && !m.permissions.includes("ai")) {
      throw new AiRequestError(`Модулю "${module}" нужно разрешение "ai" в lifehub.json`, "no_permission");
    }
  }

  async function ask(prompt: string, opts: AiOptions = {}): Promise<string> {
    checkPermission();
    const images = opts.images?.length ? await Promise.all(opts.images.map((im) => encodeImage(module, im))) : undefined;
    const res = await fetch(`/api/ai/${module}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lifehub": "1", "x-lifehub-module": module, "x-lifehub-client": clientId },
      body: JSON.stringify({ prompt, system: opts.system, model: opts.model, images }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      let msg = `Ошибка ${res.status}`;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {}
      throw new AiRequestError(msg, res.status === 403 ? "no_permission" : "error");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.delta) {
          full += ev.delta;
          opts.onDelta?.(ev.delta, full);
        } else if (ev.error) {
          throw new AiRequestError(ev.error, ev.code ?? "error");
        } else if (ev.done) {
          return ev.text ?? full;
        }
      }
    }
    return full;
  }

  /** Диалог: история сообщений → ответ ассистента на последнее. */
  function chat(messages: ChatMessage[], opts: AiOptions = {}): Promise<string> {
    const transcript = messages
      .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
      .join("\n\n");
    return ask(`${transcript}\n\nОтветь как Ассистент на последнее сообщение пользователя. Пиши только сам ответ, без префикса «Ассистент:».`, opts);
  }

  /**
   * Ответ в виде JSON. В prompt опишите, какая структура нужна (лучше с примером).
   * Возвращает разобранный объект.
   */
  async function json<T = unknown>(prompt: string, opts: Omit<AiOptions, "onDelta"> = {}): Promise<T> {
    const system = `${opts.system ? opts.system + "\n\n" : ""}Отвечай ТОЛЬКО валидным JSON без пояснений и без markdown-обёрток.`;
    const text = await ask(prompt, { ...opts, system });
    return parseJson<T>(text);
  }

  /** Доступна ли нейронка (найден ли Claude Code на компьютере с хабом). */
  async function status(): Promise<{ available: boolean }> {
    const s = await request<{ found: boolean }>("GET", "/api/ai/status");
    return { available: s.found };
  }

  return { ask, chat, json, status };
}

const MAX_SIDE = 1568;

/** Картинка → { mime, data: base64 }; большие уменьшаются и пережимаются в JPEG. */
async function encodeImage(module: string, im: Blob | string): Promise<{ mime: string; data: string }> {
  let blob: Blob;
  if (typeof im === "string") {
    const res = await fetch(`/api/files/${module}/${im}`);
    if (!res.ok) throw new AiRequestError("Картинка не найдена", "error");
    blob = await res.blob();
  } else blob = im;
  if (!blob.type.startsWith("image/")) throw new AiRequestError("Можно передавать только картинки", "error");
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {}
  const small = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(blob.type) && blob.size < 3_500_000;
  if (bitmap && (Math.max(bitmap.width, bitmap.height) > MAX_SIDE || !small)) {
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new AiRequestError("Не удалось обработать картинку", "error"))), "image/jpeg", 0.85));
  } else if (!small) {
    throw new AiRequestError("Этот формат картинки не поддерживается — сохраните её как JPEG или PNG", "error");
  }
  bitmap?.close();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: blob.type, data: btoa(bin) };
}

export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new AiRequestError("Нейронка вернула не JSON", "bad_json");
  }
}

export type Ai = ReturnType<typeof createAi>;

export function makeUseAi(ai: Ai) {
  /**
   * Хук для запроса с потоковым выводом:
   *   const { run, text, loading, error, cancel } = useAi();
   *   await run("Разбери мой текст…", { system: "Ты коуч по речи" });
   */
  return function useAi() {
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ctrl = useRef<AbortController | null>(null);

    const run = useCallback(async (prompt: string, opts: Omit<AiOptions, "onDelta" | "signal"> = {}) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setText("");
      setError(null);
      setLoading(true);
      try {
        const full = await ai.ask(prompt, { ...opts, signal: c.signal, onDelta: (_d, all) => setText(all) });
        setText(full);
        return full;
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
        return null;
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
    }, []);

    const cancel = useCallback(() => {
      ctrl.current?.abort();
      setLoading(false);
    }, []);

    return { run, text, loading, error, cancel, reset: () => setText("") };
  };
}
