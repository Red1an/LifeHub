import { ai, files } from "@lifehub/sdk";
import type { Category, Receipt } from "./types.ts";

/*
 * Фото к операции (чек, что купили). На телефоне снимок 3–8 МБ — перед загрузкой уменьшаем до 1600 px
 * по длинной стороне и пережимаем в JPEG (~200–300 КБ): хабу легко хранить, с мобильного интернета быстро.
 */

const MAX_SIDE = 1600;

export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadPhotos(list: FileList | File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of [...list].slice(0, 6)) {
    const blob = await compressImage(f);
    const meta = await files.upload(blob, (f.name || "фото").replace(/\.\w+$/, "") + ".jpg");
    ids.push(meta.id);
  }
  return ids;
}

export const photoUrl = (id: string) => files.url(id);

export async function removePhotos(ids: string[]) {
  for (const id of ids) await files.remove(id).catch(() => {});
}

/** Нейронка читает чек по фото: продавец, итог, позиции с ценами, категория из наших. */
export async function readReceipt(photoIds: string[], categories: Category[]): Promise<Receipt> {
  const cats = categories.filter((c) => c.kind === "expense").map((c) => c.name).join(", ");
  const r = await ai.json<{ merchant?: string; total?: number; category?: string; items?: { name: string; price: number; qty?: number }[] }>(
    `На фото — кассовый чек или то, что купили (Россия). Верни JSON:
{"merchant": "где куплено или null", "total": итог числом или null, "category": "одна из: ${cats}", "items": [{"name": "позиция коротко", "price": цена за все штуки числом, "qty": количество}]}.
Позиции — как в чеке, без скидок/НДС/итогов отдельными строками. Если это не чек, а фото покупки — items пустой, category по фото.`,
    { images: photoIds.slice(0, 5), model: "smart" },
  );
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((x) => x && typeof x.name === "string" && Number(x.price) > 0)
    .map((x) => ({ name: x.name.slice(0, 60), price: Math.round(Number(x.price) * 100) / 100, qty: x.qty && x.qty > 1 ? x.qty : undefined }));
  return {
    merchant: r.merchant || undefined,
    total: Number(r.total) > 0 ? Number(r.total) : undefined,
    category: categories.some((c) => c.kind === "expense" && c.name === r.category) ? r.category : undefined,
    items,
    at: Date.now(),
  };
}
