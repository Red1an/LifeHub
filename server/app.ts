import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import { zipSync } from "fflate";
import { authMiddleware, handleLogin, handleLogout, loginPage, setPassword } from "./auth.ts";
import * as reg from "./registry.ts";
import { HubError } from "./registry.ts";
import * as db from "./db.ts";
import { subscribe, emit, type HubEvent } from "./events.ts";
import { getSettings, updateSettings, publicSettings } from "./settings.ts";
import { libFileForUrl, listLibs, pruneLibs, LibError } from "./libs.ts";
import { HistoryError } from "./history.ts";
import { ask, aiStatus, aiTest, updateAiSettings, AiError } from "./ai.ts";
import * as sys from "./system.ts";
import { tailscaleStatus, enableServe, disableServe } from "./tailscale.ts";
import { SDK_VERSION, type PlatformBuild } from "./compiler.ts";
import { FILES_DIR, MODULES_DIR, MODULE_ID_RE, HOME, CHECK_COMMAND } from "./paths.ts";
import type { Manifest } from "./manifest.ts";

export interface AppOptions {
  port: number;
  https: boolean;
  getPlatform: () => PlatformBuild;
}

const COLLECTION_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const STARTED_AT = Date.now();

export function createApp(opts: AppOptions) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HubError) return c.json({ error: err.message }, err.status as any);
    if (err instanceof LibError || err instanceof HistoryError || err instanceof AiError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: err.message || "Внутренняя ошибка" }, 500);
  });

  app.get("/login", (c) => c.html(loginPage()));
  app.post("/login", handleLogin);
  app.post("/logout", handleLogout);
  app.use("*", authMiddleware);

  const local = (c: Context) => c.get("local" as never) as unknown as boolean;
  const requireLocal = (c: Context) => {
    if (!local(c)) throw new HubError("Это действие доступно только на компьютере, где запущен хаб", 403);
  };

  /* ─────────────── статика ─────────────── */

  app.get("/platform.js", (c) => js(c, opts.getPlatform().js, true));
  app.get("/platform.js.map", (c) => c.body(opts.getPlatform().map, 200, { "content-type": "application/json" }));
  app.get("/app.css", (c) => c.body(reg.getCss().css, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" }));

  app.get("/modules/:id/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    if (!MODULE_ID_RE.test(id)) return c.notFound();
    if (file === "icon") return moduleIcon(c, id);
    const b = await reg.getBuild(id);
    if (!b.ok) return js(c, `throw new Error(${JSON.stringify(`Модуль ${id} не собирается:\n` + b.errors.join("\n"))});`, false);
    if (file === "module.js") return js(c, b.js, !!c.req.query("v"));
    if (file === "module.js.map") return c.body(b.map, 200, { "content-type": "application/json" });
    if (file === "module.css") return c.body(b.css, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
    return c.notFound();
  });

  app.get("/libs/*", async (c) => {
    const file = await libFileForUrl(decodeURI(c.req.path));
    if (!file) return c.notFound();
    return js(c, fs.readFileSync(file, "utf8"), true);
  });

  app.get("/manifest.webmanifest", (c) =>
    c.json({
      name: "LifeHub",
      short_name: "LifeHub",
      start_url: "/",
      display: "standalone",
      background_color: "#121211",
      theme_color: "#121211",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    }),
  );
  app.get("/icon.svg", (c) => c.body(ICON, 200, { "content-type": "image/svg+xml", "cache-control": "max-age=86400" }));
  app.get("/sw.js", (c) =>
    c.body(`self.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));\nself.addEventListener("fetch", () => {});\n`, 200, {
      "content-type": "text/javascript",
    }),
  );

  /* ─────────────── состояние и события ─────────────── */

  app.get("/api/state", (c) =>
    c.json({
      sdkVersion: SDK_VERSION,
      settings: publicSettings(),
      modules: reg.listModules(),
      platformHash: opts.getPlatform().hash,
      cssHash: reg.getCss().hash,
      isLocal: local(c),
      modulesDir: MODULES_DIR,
      home: HOME,
      checkCommand: CHECK_COMMAND,
    }),
  );

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      const queue: HubEvent[] = [];
      let wake: (() => void) | null = null;
      const off = subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        open = false;
        off();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: "{}" });
      while (open) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 25_000);
        });
        wake = null;
        if (open && !queue.length) await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  /* ─────────────── модули ─────────────── */

  app.get("/api/modules", (c) => c.json(reg.listModules()));
  app.get("/api/modules/:id", (c) => c.json(reg.moduleDetails(c.req.param("id"))));
  app.get("/api/templates", (c) => c.json(reg.templates()));

  app.post("/api/modules/create", async (c) => {
    const b = await c.req.json();
    const id = await reg.createModule(b);
    return c.json({ id });
  });

  app.post("/api/modules/install", async (c) => {
    const b = await c.req.json();
    let src: reg.InstallSource;
    if (b.type === "git" && typeof b.url === "string") src = { type: "git", url: b.url.trim() };
    else if (b.type === "builtin" && typeof b.id === "string") src = { type: "builtin", id: b.id };
    else if (b.type === "path" && typeof b.path === "string") {
      requireLocal(c);
      src = { type: "path", path: path.resolve(b.path) };
    } else throw new HubError("Неизвестный источник установки");
    return c.json(reg.stagedPreview(await reg.stage(src)));
  });

  app.post("/api/modules/install-zip", async (c) => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.length > 50 * 1024 * 1024) throw new HubError("Архив больше 50 МБ");
    return c.json(reg.stagedPreview(await reg.stage({ type: "zip", data })));
  });

  app.post("/api/modules/install/confirm", async (c) => {
    const b = await c.req.json();
    const id = await reg.confirmInstall(String(b.stagingId), { id: b.id, replace: !!b.replace });
    return c.json({ id });
  });

  app.post("/api/modules/:id/fork", async (c) => {
    const b = await c.req.json();
    const id = await reg.forkModule(c.req.param("id"), { newId: b.newId, name: b.name, copyData: !!b.copyData }, rawDb());
    return c.json({ id });
  });

  app.post("/api/modules/:id/enabled", async (c) => {
    const b = await c.req.json();
    await reg.setEnabled(c.req.param("id"), !!b.enabled);
    return c.json({ ok: true });
  });

  app.post("/api/modules/:id/rebuild", async (c) => {
    reg.scan();
    await reg.rebuild(c.req.param("id"));
    await reg.rebuildCss();
    return c.json(reg.moduleDetails(c.req.param("id")));
  });

  app.delete("/api/modules/:id", async (c) => {
    const trash = await reg.removeModule(c.req.param("id"), c.req.query("purge") === "1");
    return c.json({ trash });
  });

  app.get("/api/modules/:id/export", (c) => {
    const id = c.req.param("id");
    const zip = reg.exportZip(id);
    return c.body(zip as any, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${id}.lifehub.zip"`,
    });
  });

  /* обновления от автора */
  app.post("/api/modules/:id/check-update", async (c) => {
    const info = await reg.checkUpdate(c.req.param("id"));
    emit({ type: "modules" });
    return c.json({ update: info });
  });
  app.post("/api/modules/:id/apply-update", async (c) => c.json(await reg.applyUpdate(c.req.param("id"))));
  app.post("/api/modules/:id/mark-merged", async (c) => {
    await reg.markMerged(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/modules/:id/auto-update", async (c) => {
    const b = await c.req.json();
    await reg.setAutoUpdate(c.req.param("id"), !!b.enabled);
    return c.json({ ok: true });
  });
  app.post("/api/updates/check", async (c) => {
    await reg.checkAllUpdates();
    return c.json({ updates: reg.listModules().filter((m) => m.update).map((m) => m.id) });
  });

  /* история версий */
  app.get("/api/modules/:id/history", async (c) => c.json(await reg.versions(c.req.param("id"))));
  app.get("/api/modules/:id/history/:sha", async (c) => c.json(await reg.version(c.req.param("id"), c.req.param("sha"))));
  app.post("/api/modules/:id/history/:sha/restore", async (c) => {
    await reg.restore(c.req.param("id"), c.req.param("sha"));
    return c.json(reg.moduleDetails(c.req.param("id")));
  });

  app.post("/api/modules/:id/open-folder", (c) => {
    requireLocal(c);
    const dir = reg.getEntry(c.req.param("id")).dir;
    openFolder(dir);
    return c.json({ ok: true });
  });
  app.post("/api/open-modules-folder", (c) => {
    requireLocal(c);
    openFolder(MODULES_DIR);
    return c.json({ ok: true });
  });

  app.get("/api/catalog", async (c) => {
    const installed = new Set(reg.listModules().map((m) => m.id));
    const sections: { title: string; url?: string; error?: string; items: any[] }[] = [
      { title: "Встроенные", items: reg.builtinCatalog() },
    ];
    for (const url of getSettings().catalogs) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await r.json();
        const items = (Array.isArray(data) ? data : data.modules ?? []).filter((m: any) => m && typeof m.git === "string");
        sections.push({
          title: data.title ?? url,
          url,
          items: items.map((m: any) => ({
            id: String(m.id ?? ""), name: String(m.name ?? m.id), description: String(m.description ?? ""),
            icon: String(m.icon ?? "📦"), version: String(m.version ?? ""), type: m.type ?? "app",
            source: { type: "git", url: m.git },
          })),
        });
      } catch (e) {
        sections.push({ title: url, url, error: `Не удалось загрузить: ${(e as Error).message}`, items: [] });
      }
    }
    for (const s of sections) for (const it of s.items) it.installed = installed.has(it.id);
    return c.json(sections);
  });

  /* ─────────────── настройки ─────────────── */

  app.get("/api/settings", (c) => c.json(publicSettings()));
  app.put("/api/settings", async (c) => {
    const b = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (["auto", "light", "dark"].includes(b.theme)) patch.theme = b.theme;
    if (typeof b.accent === "string" && /^[a-z]+$/.test(b.accent)) patch.accent = b.accent;
    if (Array.isArray(b.order)) patch.order = b.order.filter((x: unknown) => typeof x === "string");
    if (Array.isArray(b.hiddenWidgets)) patch.hiddenWidgets = b.hiddenWidgets.filter((x: unknown) => typeof x === "string");
    if (Array.isArray(b.catalogs)) patch.catalogs = b.catalogs.filter((x: unknown) => typeof x === "string" && /^https?:\/\//.test(x));
    if (typeof b.userName === "string") patch.userName = b.userName.slice(0, 60);
    updateSettings(patch);
    emit({ type: "settings" });
    return c.json(publicSettings());
  });

  app.post("/api/settings/password", async (c) => {
    requireLocal(c);
    const b = await c.req.json();
    try {
      setPassword(b.password === null ? null : String(b.password));
    } catch (e) {
      throw new HubError((e as Error).message);
    }
    emit({ type: "settings" });
    return c.json({ ok: true });
  });

  app.get("/api/network", async (c) => {
    const proto = opts.https ? "https" : "http";
    const urls = lanAddresses().map((ip) => `${proto}://${ip}:${opts.port}`);
    const qr = await Promise.all(urls.map((u) => QRCode.toString(u, { type: "svg", margin: 1 })));
    return c.json({ urls, qr, https: opts.https, hasPassword: !!getSettings().password });
  });

  app.get("/api/libs", async (c) => {
    const used = await reg.usedLibs();
    return c.json(listLibs().map((l) => ({ ...l, used: used.has(`${l.name}@${l.version}`) })));
  });
  app.post("/api/libs/prune", async (c) => c.json({ removed: pruneLibs(await reg.usedLibs()) }));

  app.get("/api/backup", (c) => {
    const tmp = path.join(os.tmpdir(), `lifehub-backup-${Date.now()}.db`);
    db.snapshotDb(tmp);
    const files: Record<string, Uint8Array> = { "data/lifehub.db": fs.readFileSync(tmp) };
    fs.rmSync(tmp, { force: true });
    addDir(files, FILES_DIR, "data/files");
    addDir(files, MODULES_DIR, "modules", (p) => !/[\\/](node_modules|\.out|\.upstream)([\\/]|$)/.test(p));
    const zip = zipSync(files, { level: 6 });
    const stamp = new Date().toISOString().slice(0, 10);
    return c.body(zip as any, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="lifehub-backup-${stamp}.zip"`,
    });
  });

  /* ─────────────── данные модулей ─────────────── */

  /**
   * Модуль работает со своими данными свободно; чужие коллекции он может только
   * читать, если владелец их экспортировал, а модуль запросил read:<id>.
   */
  const access = (c: Context, write: boolean) => {
    const module = c.req.param("module")!;
    const collection = c.req.param("collection");
    if (!MODULE_ID_RE.test(module) && module !== "hub") throw new HubError("Неверный модуль");
    if (collection !== undefined && !COLLECTION_RE.test(collection)) throw new HubError("Неверное имя коллекции");
    const caller = c.req.header("x-lifehub-module");
    if (!caller || caller === module) return { module, collection: collection! };
    if (write) throw new HubError(`Модуль "${caller}" не может изменять данные модуля "${module}"`, 403);
    const target = manifestOf(module);
    const me = manifestOf(caller);
    if (!me?.permissions.includes(`read:${module}`))
      throw new HubError(`Модулю "${caller}" нужно разрешение "read:${module}" в lifehub.json`, 403);
    if (collection && !target?.exports.collections.includes(collection))
      throw new HubError(`Модуль "${module}" не открывает коллекцию "${collection}" для других модулей`, 403);
    return { module, collection: collection! };
  };
  const changed = (c: Context, module: string, collection: string) =>
    emit({ type: "data", module, collection, origin: c.req.header("x-lifehub-client") });

  app.get("/api/data/:module/:collection", (c) => {
    const { module, collection } = access(c, false);
    return c.json(db.listDocs(module, collection));
  });
  app.post("/api/data/:module/:collection", async (c) => {
    const { module, collection } = access(c, true);
    const body = await c.req.json();
    const doc = db.putDoc(module, collection, typeof body.id === "string" && ID_RE.test(body.id) ? body.id : undefined, body, false);
    changed(c, module, collection);
    return c.json(doc);
  });
  app.delete("/api/data/:module/:collection", (c) => {
    const { module, collection } = access(c, true);
    db.clearCollection(module, collection);
    changed(c, module, collection);
    return c.json({ ok: true });
  });
  app.get("/api/data/:module/:collection/:id", (c) => {
    const { module, collection } = access(c, false);
    const doc = db.getDoc(module, collection, c.req.param("id"));
    return doc ? c.json(doc) : c.json({ error: "Не найдено" }, 404);
  });
  for (const method of ["put", "patch"] as const) {
    app[method]("/api/data/:module/:collection/:id", async (c) => {
      const { module, collection } = access(c, true);
      const id = c.req.param("id");
      if (!ID_RE.test(id)) throw new HubError("Неверный id");
      const doc = db.putDoc(module, collection, id, await c.req.json(), method === "patch");
      changed(c, module, collection);
      return c.json(doc);
    });
  }
  app.delete("/api/data/:module/:collection/:id", (c) => {
    const { module, collection } = access(c, true);
    db.deleteDoc(module, collection, c.req.param("id"));
    changed(c, module, collection);
    return c.json({ ok: true });
  });

  app.get("/api/kv/:module", (c) => {
    const { module } = access(c, false);
    return c.json(db.allKv(module));
  });
  app.get("/api/kv/:module/:key", (c) => {
    const { module } = access(c, false);
    return c.json({ value: db.getKv(module, c.req.param("key")) ?? null });
  });
  app.put("/api/kv/:module/:key", async (c) => {
    const { module } = access(c, true);
    const key = c.req.param("key");
    if (!COLLECTION_RE.test(key)) throw new HubError("Неверный ключ");
    db.setKv(module, key, (await c.req.json()).value);
    changed(c, module, `kv:${key}`);
    return c.json({ ok: true });
  });

  /* ─────────────── файлы модулей ─────────────── */

  app.get("/api/files/:module", (c) => {
    const { module } = access(c, false);
    return c.json(db.listFiles(module));
  });
  app.post("/api/files/:module", async (c) => {
    const { module } = access(c, true);
    const m = manifestOf(module);
    if (!m?.permissions.includes("files")) throw new HubError(`Модулю "${module}" нужно разрешение "files"`, 403);
    const data = Buffer.from(await c.req.arrayBuffer());
    if (data.length > 200 * 1024 * 1024) throw new HubError("Файл больше 200 МБ");
    const meta: db.FileMeta = {
      id: db.newId(),
      name: decodeURIComponent(c.req.header("x-filename") ?? "file").slice(0, 200),
      mime: (c.req.header("content-type") ?? "application/octet-stream").slice(0, 100),
      size: data.length,
      createdAt: Date.now(),
    };
    fs.mkdirSync(path.join(FILES_DIR, module), { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, module, meta.id), data);
    db.addFileMeta(module, meta);
    changed(c, module, "files");
    return c.json(meta);
  });
  app.get("/api/files/:module/:id", (c) => {
    const module = c.req.param("module");
    const id = c.req.param("id");
    if (!MODULE_ID_RE.test(module) || !ID_RE.test(id)) return c.notFound();
    const meta = db.getFileMeta(module, id);
    if (!meta) return c.notFound();
    const data = fs.readFileSync(path.join(FILES_DIR, module, id));
    return c.body(data as any, 200, {
      "content-type": meta.mime,
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    });
  });
  app.delete("/api/files/:module/:id", (c) => {
    const { module } = access(c, true);
    const id = c.req.param("id");
    if (!ID_RE.test(id)) throw new HubError("Неверный id");
    fs.rmSync(path.join(FILES_DIR, module, id), { force: true });
    db.deleteFileMeta(module, id);
    changed(c, module, "files");
    return c.json({ ok: true });
  });

  /* ─────────────── нейронка ─────────────── */

  app.get("/api/ai/status", async (c) => c.json(await aiStatus(c.req.query("recheck") === "1")));
  app.post("/api/ai/test", async (c) => c.json(await aiTest()));
  app.put("/api/ai/settings", async (c) => {
    requireLocal(c);
    return c.json(await updateAiSettings(await c.req.json()));
  });

  /** Запрос модуля к нейронке. Ответ — поток NDJSON: {"delta": "…"} … {"done": true, "text": "…"}. */
  app.post("/api/ai/:module", async (c) => {
    const module = c.req.param("module");
    const caller = c.req.header("x-lifehub-module") ?? module;
    const m = manifestOf(caller);
    if (!m?.permissions.includes("ai")) throw new HubError(`Модулю "${caller}" нужно разрешение "ai" в lifehub.json`, 403);
    const b = await c.req.json();
    const prompt = String(b.prompt ?? "");
    if (!prompt.trim()) throw new HubError("Пустой запрос");
    if (prompt.length > 400_000) throw new HubError("Запрос слишком большой");
    const system = typeof b.system === "string" ? b.system.slice(0, 50_000) : undefined;
    const model = b.model === "fast" ? "fast" : "smart";
    const abort = new AbortController();
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(ctrl) {
        const send = (o: unknown) => {
          try {
            ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          } catch {}
        };
        try {
          const text = await ask({ prompt, system, model, signal: abort.signal, onDelta: (d) => send({ delta: d }) });
          send({ done: true, text });
        } catch (e) {
          send({ error: (e as Error).message, code: e instanceof AiError ? e.code : "error" });
        }
        try {
          ctrl.close();
        } catch {}
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
  });

  /* ─────────────── работа в фоне и автозапуск ─────────────── */

  app.get("/api/system", (c) =>
    c.json({
      supervised: sys.isSupervised(),
      autostart: sys.autostartEnabled(),
      platform: process.platform,
      port: opts.port,
      https: opts.https,
      logFile: sys.LOG_FILE,
      startedAt: STARTED_AT,
    }),
  );
  app.post("/api/system/autostart", async (c) => {
    requireLocal(c);
    const b = await c.req.json();
    if (b.enabled) sys.enableAutostart({ port: opts.port, https: opts.https });
    else sys.disableAutostart();
    return c.json({ autostart: sys.autostartEnabled() });
  });
  /** Перевести хаб в фон: запускается фоновая копия, а этот процесс (из терминала) завершается. */
  app.post("/api/system/background", (c) => {
    requireLocal(c);
    if (sys.isSupervised()) return c.json({ ok: true });
    sys.launchBackground({ port: opts.port, https: opts.https });
    setTimeout(() => process.exit(0), 400);
    return c.json({ ok: true });
  });
  app.post("/api/system/restart", (c) => {
    requireLocal(c);
    if (!sys.isSupervised()) throw new HubError("Хаб запущен из терминала — перезапустите его там (Ctrl+C и снова запуск) или переведите в фон.");
    setTimeout(() => process.exit(sys.EXIT_RESTART), 300);
    return c.json({ ok: true });
  });
  app.post("/api/system/stop", (c) => {
    requireLocal(c);
    setTimeout(() => process.exit(0), 300);
    return c.json({ ok: true });
  });
  app.get("/api/system/log", (c) => {
    requireLocal(c);
    return c.text(sys.readLogTail(300));
  });

  /* ─────────────── доступ вне дома (Tailscale) ─────────────── */

  app.get("/api/remote", async (c) => {
    const st = await tailscaleStatus(opts.port);
    const qr = st.serve.url ? await QRCode.toString(st.serve.url, { type: "svg", margin: 1 }) : null;
    return c.json({ ...st, qr, hasPassword: !!getSettings().password });
  });
  app.post("/api/remote/serve", async (c) => {
    requireLocal(c);
    const b = await c.req.json();
    const r = b.enabled ? await enableServe(opts.port, opts.https) : await disableServe();
    if (!r.ok) throw new HubError(r.message);
    return c.json({ ...(await tailscaleStatus(opts.port)), message: r.message });
  });

  /* ─────────────── SPA ─────────────── */

  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Не найдено" }, 404);
    return c.html(indexHtml(opts.getPlatform().hash));
  });

  return app;
}

const ICON_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Своя иконка модуля: "icon": "icon.svg" в lifehub.json (файл внутри папки модуля). */
function moduleIcon(c: Context, id: string) {
  const e = reg.getEntry(id);
  const icon = e.manifest?.icon ?? "";
  const type = ICON_TYPES[path.extname(icon).toLowerCase()];
  if (!type) return c.notFound();
  const file = path.resolve(e.dir, icon);
  if (!file.startsWith(e.dir + path.sep) || !fs.existsSync(file)) return c.notFound();
  return c.body(fs.readFileSync(file) as any, 200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
}

function manifestOf(id: string): Manifest | undefined {
  try {
    return reg.getEntry(id).manifest;
  } catch {
    return undefined;
  }
}

const rawDb = () => db.getRaw();

/** Сжатые версии бандлов: модули с большими данными весят мегабайты, а с телефона грузятся по мобильной сети. */
const gzipped = new Map<string, ArrayBuffer>();

function js(c: Context, body: string, immutable: boolean) {
  const headers: Record<string, string> = {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    vary: "accept-encoding",
  };
  if (body.length < 4096 || !/\bgzip\b/.test(c.req.header("accept-encoding") ?? "")) return c.body(body, 200, headers);
  let gz = gzipped.get(body);
  if (!gz) {
    const buf = zlib.gzipSync(body);
    gz = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    gzipped.set(body, gz);
    if (gzipped.size > 64) gzipped.delete(gzipped.keys().next().value!);
  }
  return c.body(gz, 200, { ...headers, "content-encoding": "gzip" });
}

function addDir(files: Record<string, Uint8Array>, dir: string, prefix: string, filter: (p: string) => boolean = () => true) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (!filter(p)) continue;
    if (d.isDirectory()) addDir(files, p, `${prefix}/${d.name}`, filter);
    else files[`${prefix}/${d.name}`] = fs.readFileSync(p);
  }
}

/** Адреса в локальной сети: обычные домашние сети первыми, служебные (VPN-туннели, link-local) — мимо. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Служебные адреса (link-local, тестовые, Tailscale 100.64/10) — не «локальная сеть».
      if (/^(169\.254\.|198\.1[89]\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address)) continue;
      out.push(a.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

function openFolder(dir: string) {
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
}

function indexHtml(platformHash: string) {
  const s = getSettings();
  const css = reg.getCss().hash;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>LifeHub</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<meta name="theme-color" content="#121211">
<meta name="apple-mobile-web-app-capable" content="yes">
<script>
(function(){var t=${JSON.stringify(s.theme)};if(t==="auto")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
var d=document.documentElement;d.dataset.theme=t;d.dataset.accent=${JSON.stringify(s.accent)};})();
</script>
<link rel="stylesheet" id="lh-css" href="/app.css?v=${css}">
</head>
<body>
<div id="root"></div>
<script type="module" src="/platform.js?v=${platformHash}"></script>
</body>
</html>`;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1a1a18"/>
<g fill="#f7f7f5"><rect x="15" y="15" width="15" height="15" rx="3"/><rect x="34" y="15" width="15" height="15" rx="3" opacity=".55"/>
<rect x="15" y="34" width="15" height="15" rx="3" opacity=".55"/><rect x="34" y="34" width="15" height="15" rx="3" opacity=".3"/></g>
</svg>`;
