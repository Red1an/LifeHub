import { useEffect, useState } from "react";
import type { ModuleInfo } from "./state.ts";
import { isImageIcon } from "./ModuleIcon.tsx";

/*
 * Цвет модуля для главной — оттенок (0…360), снятый с его иконки: эмодзи или картинка
 * рисуются на маленьком холсте, берётся средний оттенок насыщенных пикселей.
 * Модулю не нужно ничего объявлять; серая иконка получает оттенок по id.
 */

const cache = new Map<string, number>();

function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function hueOf(ctx: CanvasRenderingContext2D, size: number): number | null {
  const { data } = ctx.getImageData(0, 0, size, size);
  let x = 0;
  let y = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 160) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    if (d < 0.15 || l < 0.15 || l > 0.9) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    // Средний угол по кругу, вес — насыщенность.
    const w = d / (1 - Math.abs(2 * l - 1) || 1);
    x += Math.cos((h * Math.PI) / 180) * w;
    y += Math.sin((h * Math.PI) / 180) * w;
  }
  if (Math.hypot(x, y) < 5) return null;
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

function canvas2d(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas.getContext("2d", { willReadFrequently: true });
}

const SIZE = 32;
const keyOf = (m: ModuleInfo) => `${m.id}:${m.manifest?.icon ?? ""}`;

/** Эмодзи рисуется сразу — оттенок известен уже при первом рендере. */
function emojiHue(m: ModuleInfo): number {
  const ctx = canvas2d(SIZE);
  if (!ctx) return hashHue(m.id);
  ctx.font = `${SIZE - 4}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(m.manifest?.icon || "▫️", SIZE / 2, SIZE / 2 + 2);
  return hueOf(ctx, SIZE) ?? hashHue(m.id);
}

function imageHue(m: ModuleInfo): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas2d(SIZE);
      try {
        ctx!.drawImage(img, 0, 0, SIZE, SIZE);
        resolve(hueOf(ctx!, SIZE) ?? hashHue(m.id));
      } catch {
        resolve(hashHue(m.id));
      }
    };
    img.onerror = () => resolve(hashHue(m.id));
    img.src = `/modules/${m.id}/icon?v=${m.hash}`;
  });
}

/** Оттенки модулей: id → 0…360 (у картинки-иконки — после загрузки, до того undefined). */
export function useModuleHues(modules: ModuleInfo[]): Record<string, number | undefined> {
  const key = modules.map(keyOf).join();
  const [, rerender] = useState(0);
  useEffect(() => {
    let alive = true;
    for (const m of modules) {
      const k = keyOf(m);
      if (cache.has(k) || !isImageIcon(m.manifest?.icon)) continue;
      imageHue(m).then((h) => {
        cache.set(k, h);
        if (alive) rerender((n) => n + 1);
      });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  const out: Record<string, number | undefined> = {};
  for (const m of modules) {
    const k = keyOf(m);
    if (!cache.has(k) && !isImageIcon(m.manifest?.icon)) cache.set(k, emojiHue(m));
    out[m.id] = cache.get(k);
  }
  return out;
}
