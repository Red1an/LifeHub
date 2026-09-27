import type { Plugin } from "esbuild";

/**
 * Платформенные пакеты: существуют в браузере ровно в одном экземпляре
 * (внутри platform.js) и отдаются модулям и библиотекам через globalThis.
 */
export const SHARED_SPECIFIERS = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "@lifehub/sdk",
];

/**
 * Подменяет импорты платформенных пакетов на CommonJS-заглушку, читающую
 * объект из globalThis. Так `import { useState } from "react"` и
 * `require("react")` внутри модуля/библиотеки получают общий React.
 *
 * `@lifehub/sdk` отдаётся «привязанным» к конкретному модулю (sdkFor(id)),
 * поэтому db/files и т.п. знают, чей это модуль, без передачи id вручную.
 */
export function sharedPlugin(moduleId: string | null): Plugin {
  return {
    name: "lifehub-shared",
    setup(build) {
      const filter = new RegExp(
        "^(" + SHARED_SPECIFIERS.map((s) => s.replace(/[/\-]/g, "\\$&")).join("|") + ")$",
      );
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "lh-shared" }));
      build.onLoad({ filter: /.*/, namespace: "lh-shared" }, (args) => {
        const expr =
          args.path === "@lifehub/sdk"
            ? `globalThis.__LIFEHUB__.sdkFor(${JSON.stringify(moduleId ?? "lib")})`
            : `globalThis.__LIFEHUB__.shared[${JSON.stringify(args.path)}]`;
        return { contents: `module.exports = ${expr};`, loader: "js" };
      });
    },
  };
}

export const NODE_BUILTINS = new Set([
  "fs", "path", "os", "child_process", "crypto", "http", "https", "net", "tls", "zlib",
  "stream", "worker_threads", "cluster", "dgram", "dns", "readline", "vm",
]);
