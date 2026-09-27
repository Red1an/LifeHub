import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { HOME } from "./paths.ts";
import { getSettings, updateSettings } from "./settings.ts";

/*
 * Нейронка для модулей через Claude Code пользователя (`claude -p`).
 *
 * Не нужен API-ключ: запросы идут под аккаунтом, в который пользователь вошёл
 * в Claude Code. Claude запускается без инструментов (--tools "") в пустой папке,
 * без MCP и без пользовательских настроек — он только отвечает текстом и не может
 * читать или менять файлы. Идея подсмотрена в «Звукоряде» (github.com/NIKFIRE4).
 */

const WORKDIR = path.join(HOME, "ai-workdir");
const MAX_PARALLEL = 3;
const TIMEOUT_MS = 180_000;

export class AiError extends Error {
  code: string;
  constructor(message: string, code = "error") {
    super(message);
    this.code = code;
  }
}

interface ClaudeBin {
  /** Команда запуска: exe напрямую или node + cli.js (для npm-установки). */
  cmd: string;
  prefix: string[];
  path: string;
  version: string;
}

let cached: ClaudeBin | null | undefined;

function candidates(): string[] {
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const list: string[] = [];
  const custom = getSettings().ai?.claudePath;
  if (custom) list.push(custom);
  if (process.env.CLAUDE_BIN) list.push(process.env.CLAUDE_BIN);
  if (process.platform === "win32") {
    list.push(
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
      path.join(home, ".claude", "local", "claude.exe"),
      path.join(localAppData, "Programs", "claude", "claude.exe"),
    );
  } else {
    list.push(
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(home, ".npm-global", "bin", "claude"),
    );
  }
  // Claude Code из расширения VS Code / Cursor.
  for (const editor of [".vscode", ".cursor", ".windsurf"]) {
    const ext = path.join(home, editor, "extensions");
    try {
      for (const d of fs.readdirSync(ext).filter((x) => /^anthropic\.claude-code-/i.test(x)).sort().reverse()) {
        const nb = path.join(ext, d, "resources", "native-binary");
        for (const f of ["claude.exe", "claude"]) list.push(path.join(nb, f));
      }
    } catch {}
  }
  list.push("claude");
  return list;
}

function tryVersion(cmd: string, prefix: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, [...prefix, "--version"], { timeout: 15000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const v = String(out).trim();
      resolve(/claude/i.test(v) || /^\d+\.\d+/.test(v) ? v.split("\n")[0] : null);
    });
  });
}

export async function findClaude(force = false): Promise<ClaudeBin | null> {
  if (cached !== undefined && !force) return cached;
  for (const c of candidates()) {
    const isPath = c.includes("/") || c.includes("\\");
    if (isPath && !fs.existsSync(c)) continue;
    // npm-установка: запускаем cli.js через node, без оболочки (безопасная передача аргументов).
    const [cmd, prefix] = c.endsWith(".js") ? [process.execPath, [c]] : [c, [] as string[]];
    const version = await tryVersion(cmd, prefix);
    if (version) return (cached = { cmd, prefix, path: c, version });
  }
  return (cached = null);
}

/* ───────────── запросы ───────────── */

let active = 0;
const queue: (() => void)[] = [];
async function slot() {
  if (active < MAX_PARALLEL) {
    active++;
    return;
  }
  await new Promise<void>((r) => queue.push(r));
  active++;
}
function release() {
  active--;
  queue.shift()?.();
}

export interface AskOptions {
  prompt: string;
  system?: string;
  /** "fast" — быстрая модель, "smart" — основная (по умолчанию). */
  model?: "fast" | "smart";
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function modelFor(kind: "fast" | "smart" | undefined): string {
  const s = getSettings().ai ?? {};
  return kind === "fast" ? (s.fastModel ?? "haiku") : (s.smartModel ?? "");
}

/** Один запрос к Claude. Возвращает полный текст ответа, дельты — через onDelta. */
export async function ask(opts: AskOptions): Promise<string> {
  const bin = await findClaude();
  if (!bin) {
    throw new AiError(
      "Claude Code не найден. Установите его (npm install -g @anthropic-ai/claude-code или установщик с claude.com/claude-code), один раз выполните `claude` и войдите в аккаунт.",
      "not_installed",
    );
  }
  await slot();
  try {
    return await run(bin, opts, true);
  } catch (e) {
    // Старые версии CLI не знают части флагов — пробуем минимальный набор.
    if (e instanceof AiError && e.code === "bad_args") return await run(bin, opts, false);
    throw e;
  } finally {
    release();
  }
}

function run(bin: ClaudeBin, opts: AskOptions, full: boolean): Promise<string> {
  fs.mkdirSync(WORKDIR, { recursive: true });
  const model = modelFor(opts.model);
  const args = [
    ...bin.prefix,
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    ...(full ? ["--include-partial-messages", "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""] : []),
    ...(opts.system ? ["--system-prompt", opts.system] : []),
    ...(model ? ["--model", model] : []),
  ];
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin.cmd, args, {
        cwd: WORKDIR,
        windowsHide: true,
        // Без «размышлений»: ответ приходит за секунды.
        env: { ...process.env, MAX_THINKING_TOKENS: "0" },
      });
    } catch (e) {
      return reject(new AiError(String(e)));
    }
    let buf = "";
    let text = "";
    let streamed = false;
    let stderr = "";
    let done = false;
    const finish = (err: Error | null, value?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? text);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new AiError("Нейронка не ответила за 3 минуты", "timeout"));
    }, TIMEOUT_MS);
    opts.signal?.addEventListener("abort", () => {
      child.kill();
      finish(new AiError("Запрос отменён", "aborted"));
    });

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
          streamed = true;
          text += ev.event.delta.text;
          opts.onDelta?.(ev.event.delta.text);
        } else if (ev.type === "assistant" && !streamed) {
          for (const c of ev.message?.content ?? []) if (c.type === "text") text += c.text;
        } else if (ev.type === "result") {
          const result = String(ev.result ?? "");
          if (ev.is_error) {
            if (/not logged in|\/login|invalid api key|authentication/i.test(result)) {
              finish(new AiError("Claude Code не авторизован: откройте терминал, выполните `claude` и войдите в аккаунт (один раз).", "not_logged_in"));
            } else {
              finish(new AiError(result || "Claude вернул ошибку"));
            }
          } else {
            if (!streamed && result && !text) {
              text = result;
              opts.onDelta?.(result);
            }
            finish(null, text || result);
          }
        }
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => (stderr += d));
    child.on("error", (e) => finish(new AiError(`Не удалось запустить Claude Code: ${e.message}`)));
    child.on("close", (code) => {
      if (done) return;
      if (/unknown option|unexpected argument|error: option/i.test(stderr)) return finish(new AiError(stderr, "bad_args"));
      if (text) return finish(null, text);
      finish(new AiError((stderr.trim() || `Claude Code завершился с кодом ${code}`).split("\n").slice(-3).join("\n")));
    });
    child.stdin!.end(opts.prompt);
  });
}

/* ───────────── статус и настройки ───────────── */

export async function aiStatus(recheck = false) {
  const bin = await findClaude(recheck);
  const s = getSettings().ai ?? {};
  return {
    found: !!bin,
    path: bin?.path ?? null,
    version: bin?.version ?? null,
    fastModel: s.fastModel ?? "haiku",
    smartModel: s.smartModel ?? "",
    customPath: s.claudePath ?? "",
  };
}

/** Короткий пробный запрос: проверяет, что Claude Code найден и авторизован. */
export async function aiTest(): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = Date.now();
  try {
    const out = await ask({ prompt: "Ответь одним словом: работает?", model: "fast" });
    return { ok: true, message: out.trim().slice(0, 200), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: (e as Error).message, ms: Date.now() - t0 };
  }
}

export async function updateAiSettings(patch: { claudePath?: string; fastModel?: string; smartModel?: string }) {
  const cur = getSettings().ai ?? {};
  const next = { ...cur };
  if (typeof patch.claudePath === "string") next.claudePath = patch.claudePath.trim() || undefined;
  if (typeof patch.fastModel === "string" && /^[\w.\-[\]]*$/.test(patch.fastModel)) next.fastModel = patch.fastModel;
  if (typeof patch.smartModel === "string" && /^[\w.\-[\]]*$/.test(patch.smartModel)) next.smartModel = patch.smartModel;
  updateSettings({ ai: next });
  cached = undefined;
  return aiStatus(true);
}
