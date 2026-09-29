/*
 * Проверка ссылок в материалах: node scripts/check-links.mjs [файлы…]
 * По умолчанию — все src/content/*.md. Печатает недоступные ссылки (не 2xx/3xx).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "src", "content");
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => path.join(dir, f));

const links = new Map();
for (const f of files) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) links.set(m[1], path.basename(f));
}

const check = async (url) => {
  // YouTube отвечает 200 даже на несуществующий ролик — проверяем через oEmbed.
  if (/youtube\.com\/watch|youtu\.be\//.test(url)) url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetch(url, { method, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (link check)" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r.status;
      if (method === "GET") return r.status;
    } catch (e) {
      if (method === "GET") return "ERR " + (e.cause?.code ?? e.message);
    }
  }
};

const urls = [...links.keys()];
let bad = 0;
for (let i = 0; i < urls.length; i += 8) {
  const res = await Promise.all(urls.slice(i, i + 8).map(async (u) => [u, await check(u)]));
  for (const [u, s] of res) {
    if (typeof s !== "number" || s >= 400) {
      bad++;
      console.log(`${s}\t${links.get(u)}\t${u}`);
    }
  }
}
console.log(`проверено ${urls.length}, недоступно ${bad}`);
