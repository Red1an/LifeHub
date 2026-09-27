import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { PLATFORM_DIR } from "./paths.ts";

/**
 * Tailwind на сервере: сканируем исходники платформы и всех включённых модулей
 * и генерируем один общий CSS. Модулям не нужно ничего настраивать —
 * любые классы Tailwind в их коде просто работают.
 */
export async function buildCss(moduleDirs: string[]): Promise<{ css: string; hash: string }> {
  const input = fs.readFileSync(path.join(PLATFORM_DIR, "styles.css"), "utf8");
  const compiler = await compile(input, { base: PLATFORM_DIR, onDependency() {} });
  const sources = [
    { base: path.join(PLATFORM_DIR), pattern: "**/*.{ts,tsx}", negated: false },
    ...moduleDirs.map((base) => ({ base, pattern: "**/*.{ts,tsx,js,jsx,html,md}", negated: false })),
    ...moduleDirs.flatMap((base) => [
      { base, pattern: "node_modules/**", negated: true },
      { base, pattern: ".upstream/**", negated: true },
    ]),
  ];
  const scanner = new Scanner({ sources });
  const css = compiler.build(scanner.scan());
  return { css, hash: crypto.createHash("sha1").update(css).digest("hex").slice(0, 12) };
}
