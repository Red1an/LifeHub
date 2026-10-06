import zlib from "node:zlib";

/*
 * PNG-иконки хаба для установки как приложения (PWA). Android требует PNG 192 и 512,
 * iOS понимает только PNG apple-touch-icon. Рисуются из тех же фигур, что и /icon.svg
 * (сетка 64×64), без зависимостей: растеризация со сглаживанием + кодирование PNG.
 */

type Kind = "any" | "maskable" | "apple";

const BG = [0x1a, 0x1a, 0x18];
const FG = [0xf7, 0xf7, 0xf5];
const TILES: [x: number, y: number, opacity: number][] = [
  [15, 15, 1],
  [34, 15, 0.55],
  [15, 34, 0.55],
  [34, 34, 0.3],
];

function inRoundRect(px: number, py: number, x: number, y: number, w: number, h: number, r: number) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size: number, kind: Kind): Buffer {
  // "any" — скруглённая плашка на прозрачном фоне, как SVG. "maskable" и "apple" — фон
  // на весь квадрат: обрезку по форме делает система. Для maskable рисунок уменьшен,
  // чтобы целиком попасть в безопасную зону (круг 80%).
  const scale = kind === "maskable" ? 0.8 : 1;
  const SS = 4; // сглаживание: 4×4 выборки на пиксель
  const unit = 64 / size;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCover = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) * unit;
          const uy = (y + (sy + 0.5) / SS) * unit;
          if (kind !== "any" || inRoundRect(ux, uy, 0, 0, 64, 64, 14)) bgCover++;
          else continue;
          // Координаты в исходной сетке с учётом уменьшения вокруг центра.
          const gx = 32 + (ux - 32) / scale;
          const gy = 32 + (uy - 32) / scale;
          for (const [tx, ty, op] of TILES) {
            if (inRoundRect(gx, gy, tx, ty, 15, 15, 3)) {
              fg += op;
              break;
            }
          }
        }
      }
      const n = SS * SS;
      const a = bgCover / n;
      const i = (y * size + x) * 4;
      if (a === 0) continue;
      const f = fg / bgCover; // доля светлого внутри покрытой части
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Имя файла → параметры. Пути публичные (см. PUBLIC_PATHS в auth.ts и политику ngrok). */
export const PNG_ICONS: Record<string, { size: number; kind: Kind }> = {
  "/icon-192.png": { size: 192, kind: "any" },
  "/icon-512.png": { size: 512, kind: "any" },
  "/icon-maskable-512.png": { size: 512, kind: "maskable" },
  "/apple-touch-icon.png": { size: 180, kind: "apple" },
};

const cache = new Map<string, Buffer>();

export function pngIcon(path: string): Buffer | null {
  const spec = PNG_ICONS[path];
  if (!spec) return null;
  let png = cache.get(path);
  if (!png) cache.set(path, (png = render(spec.size, spec.kind)));
  return png;
}
