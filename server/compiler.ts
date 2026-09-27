import path from "node:path";
import crypto from "node:crypto";
import * as esbuild from "esbuild";
import { PLATFORM_DIR } from "./paths.ts";
import type { Manifest } from "./manifest.ts";
import { sharedPlugin, NODE_BUILTINS } from "./shared.ts";
import { splitSpecifier, resolveLib, ensureLibBundle, formatMessage, LibError } from "./libs.ts";
import semver from "semver";

export interface BuildOutput {
  ok: boolean;
  hash: string;
  js: string;
  map: string;
  css: string;
  errors: string[];
  warnings: string[];
  /** "name@version" всех использованных npm-библиотек. */
  libs: string[];
  /** id модулей-библиотек, от которых зависит модуль. */
  uses: string[];
  /** Все файлы-источники (для отслеживания изменений). */
  inputs: string[];
  builtAt: number;
}

export interface CompileContext {
  /** Возвращает URL собранного модуля-библиотеки (собирает при необходимости). */
  libraryModule(id: string): Promise<{ url: string; version: string } | { error: string }>;
}

const ASSET_LOADERS: Record<string, esbuild.Loader> = {
  ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl",
  ".svg": "dataurl", ".mp3": "dataurl", ".wav": "dataurl", ".ogg": "dataurl",
  ".woff": "dataurl", ".woff2": "dataurl",
  ".txt": "text", ".md": "text", ".csv": "text",
};

export const SDK_VERSION = "1.0.0";

const hashOf = (...parts: string[]) => {
  const h = crypto.createHash("sha1");
  for (const p of parts) h.update(p);
  return h.digest("hex").slice(0, 12);
};

export async function compileModule(dir: string, manifest: Manifest, ctx: CompileContext): Promise<BuildOutput> {
  const libs = new Set<string>();
  const uses = new Set<string>();
  const warnings: string[] = [];

  if (!semver.satisfies(SDK_VERSION, manifest.sdk)) {
    warnings.push(`Модуль рассчитан на SDK ${manifest.sdk}, а в хабе ${SDK_VERSION}`);
  }

  const depsPlugin: esbuild.Plugin = {
    name: "lifehub-deps",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.kind === "entry-point" || path.isAbsolute(args.path)) return;
        const spec = args.path;

        if (spec.startsWith("@modules/")) {
          const id = spec.slice("@modules/".length);
          const range = manifest.uses[id];
          if (!range) {
            return err(`Модуль-библиотека "${id}" не объявлен. Добавьте в lifehub.json: "uses": { "${id}": "^1" }`);
          }
          const lib = await ctx.libraryModule(id);
          if ("error" in lib) return err(lib.error);
          if (!semver.satisfies(lib.version, range)) {
            return err(`Нужен модуль ${id}@${range}, установлен ${lib.version}`);
          }
          uses.add(id);
          return { path: lib.url, external: true };
        }

        if (spec.startsWith("node:") || NODE_BUILTINS.has(spec.split("/")[0])) {
          return err(`"${spec}" — это модуль Node.js, он недоступен в браузере`);
        }

        const { name, sub } = splitSpecifier(spec);
        const range = manifest.deps[name];
        if (!range) {
          return err(
            `Пакет "${name}" не объявлен. Добавьте его в lifehub.json: "deps": { "${name}": "^<версия>" } — хаб скачает его в общий кэш.`,
          );
        }
        try {
          const { version } = await resolveLib(name, range);
          const url = await ensureLibBundle(name, version, sub);
          libs.add(`${name}@${version}`);
          return { path: url, external: true };
        } catch (e) {
          return err(e instanceof LibError ? e.message : String(e));
        }
      });
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: { module: path.join(dir, manifest.entry) },
      absWorkingDir: dir,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      write: false,
      outdir: path.join(dir, ".out"),
      sourcemap: "linked",
      sourcesContent: true,
      metafile: true,
      logLevel: "silent",
      loader: ASSET_LOADERS,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [sharedPlugin(manifest.id), depsPlugin],
    });
    let js = "", map = "", css = "";
    for (const f of result.outputFiles) {
      if (f.path.endsWith(".js")) js = f.text;
      else if (f.path.endsWith(".js.map")) map = f.text;
      else if (f.path.endsWith(".css")) css = f.text;
    }
    return {
      ok: true,
      hash: hashOf(js, css),
      js,
      map,
      css,
      errors: [],
      warnings: warnings.concat(result.warnings.map(formatMessage)),
      libs: [...libs],
      uses: [...uses],
      inputs: Object.keys(result.metafile!.inputs)
        .filter((p) => !p.includes(":"))
        .map((p) => path.resolve(dir, p)),
      builtAt: Date.now(),
    };
  } catch (e) {
    const f = e as esbuild.BuildFailure;
    return {
      ok: false,
      hash: "",
      js: "",
      map: "",
      css: "",
      errors: f.errors?.length ? f.errors.map(formatMessage) : [String((e as Error).message ?? e)],
      warnings,
      libs: [...libs],
      uses: [...uses],
      inputs: [],
      builtAt: Date.now(),
    };
  }
}

function err(text: string) {
  return { errors: [{ text }] };
}

export interface PlatformBuild {
  hash: string;
  js: string;
  map: string;
}

export async function compilePlatform(dev: boolean): Promise<PlatformBuild> {
  const result = await esbuild.build({
    entryPoints: { platform: path.join(PLATFORM_DIR, "main.tsx") },
    absWorkingDir: PLATFORM_DIR,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    outdir: path.join(PLATFORM_DIR, ".out"),
    sourcemap: "linked",
    minify: !dev,
    logLevel: "silent",
    alias: { "@lifehub/sdk": path.join(PLATFORM_DIR, "sdk", "index.ts") },
    define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
  });
  let js = "", map = "";
  for (const f of result.outputFiles) {
    if (f.path.endsWith(".js")) js = f.text;
    else if (f.path.endsWith(".map")) map = f.text;
  }
  return { hash: hashOf(js), js, map };
}
