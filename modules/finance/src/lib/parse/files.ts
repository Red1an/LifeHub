import { strFromU8, unzipSync } from "fflate";
import { parseCsv, parseGrid, parseText, type Grid, type StatementResult } from "./statement.ts";

/*
 * Файл выписки → операции. PDF читается pdf.js прямо в браузере (загружается только при импорте),
 * XLSX — распаковкой zip, CSV — как текст (UTF-8 или Windows-1251).
 */

export async function readStatement(file: File): Promise<StatementResult & { text: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    const text = await pdfText(buf);
    if (text.replace(/\s/g, "").length < 50) {
      return { ops: [], text, warnings: ["В PDF нет текста (скан). Сделайте выписку в приложении банка заново или пришлите скриншоты нейронке."] };
    }
    return { ...parseText(text, file.name), text };
  }
  const grids: Grid[] = ext === "xlsx" || ext === "xlsm" ? readXlsx(buf) : [parseCsv(decodeText(buf))];
  for (const g of grids) {
    const r = parseGrid(g, file.name);
    if (r) return { ...r, text: gridText(g) };
  }
  // Таблица без понятных заголовков — пробуем как текст.
  const text = grids.map(gridText).join("\n");
  return { ...parseText(text, file.name), text };
}

const gridText = (g: Grid) => g.map((r) => r.filter(Boolean).join(" ")).join("\n");

function decodeText(buf: Uint8Array): string {
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return (utf.match(/�/g)?.length ?? 0) > 3 ? new TextDecoder("windows-1251").decode(buf) : utf.replace(/^﻿/, "");
}

/* ── PDF ── */

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

async function pdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Обработчик pdf.js работает в основном потоке: адрес отдельного воркера модулю неизвестен,
  // а выписки небольшие.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(linesOf(content.items as TextItem[]));
  }
  await doc.destroy();
  return pages.join("\n");
}

/** Собирает строки из кусочков текста: одна высота (±3pt) — одна строка, слева направо. */
function linesOf(items: TextItem[]): string {
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = "";
      let end = -Infinity;
      for (const p of r.parts) {
        out += out && p.x - end > 1 ? " " : "";
        out += p.s;
        end = p.x + p.w;
      }
      return out;
    })
    .join("\n");
}

/* ── XLSX ── */

function readXlsx(buf: Uint8Array): Grid[] {
  const files = unzipSync(buf);
  const xml = (p: string) => (files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), "application/xml") : null);
  const tags = (d: Document | Element, name: string) => Array.from(d.getElementsByTagName(name));
  const shared = xml("xl/sharedStrings.xml");
  const strings = shared ? tags(shared, "si").map((si) => tags(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  const out: Grid[] = [];
  for (const p of Object.keys(files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()) {
    const doc = xml(p);
    if (!doc) continue;
    const grid: Grid = [];
    for (const row of tags(doc, "row")) {
      const cells: string[] = [];
      for (const c of tags(row, "c")) {
        const col = colIndex((c.getAttribute("r") ?? "").replace(/\d+/g, ""));
        while (cells.length < col) cells.push("");
        const type = c.getAttribute("t");
        const v = tags(c, "v")[0]?.textContent ?? "";
        cells.push((type === "s" ? strings[Number(v)] ?? "" : type === "inlineStr" ? tags(c, "t").map((t) => t.textContent ?? "").join("") : v).trim());
      }
      grid.push(cells);
    }
    out.push(grid);
  }
  return out;
}

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
