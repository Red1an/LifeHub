import { ai, net } from "@lifehub/sdk";
import { isGenericKey, merchantKey } from "./categorize.ts";
import type { Category, TxDoc } from "./types.ts";

/*
 * «Что это за место» по названию из банка: B095, IP POZNYSHEV, DIXY-78074D → «Магазин „Дикси“».
 * Для каждого незнакомого продавца: поиск в интернете (DuckDuckGo через хаб, разрешение network) + подсказки
 * из операций (категория банка, обычная сумма, время) → нейронка коротко называет место, тип, эмодзи, категорию
 * и сайт (для значка). Ответы хранятся в ключе "places" — по одному продавцу спрашиваем один раз.
 */

export interface Place {
  /** Понятное название: «Дикси», «ГУАП». */
  title: string;
  /** Что это: «магазин у дома», «университет», «кофейня». */
  what: string;
  emoji: string;
  category?: string;
  /** Сайт — для значка (favicon). */
  domain?: string;
  /** Уверенность: false — догадка по косвенным признакам. */
  sure: boolean;
  at: number;
}

export type Places = Record<string, Place>;

/**
 * Ключ места: как у правил (merchantKey), но короткие коды вроде «B095» не схлопываются в «b» —
 * для места важно название целиком. Способы оплаты («QR-оплата», «Перевод») — не места.
 */
export function placeKey(merchant: string): string | null {
  const k = merchantKey(merchant);
  if (k.length >= 3) return isGenericKey(k) ? null : k;
  const raw = merchant.toLowerCase().replace(/[^a-zа-яё0-9]+/g, " ").trim();
  return raw.length >= 2 && !isGenericKey(raw.replace(/\d/g, "x")) ? raw : null;
}

/** Значок сайта (Яндекс отдаёт и в России, и без VPN). */
export const faviconUrl = (domain: string) => `https://favicon.yandex.net/favicon/v2/${encodeURIComponent(domain)}?size=32`;

interface Candidate {
  key: string;
  name: string;
  raw: string;
  bankCategory?: string;
  count: number;
  avg: number;
  times: string[];
}

/** Незнакомые продавцы, которых стоит узнать: чаще встречающиеся — первыми. */
export function unknownMerchants(txs: TxDoc[], places: Places, limit = 15, only?: string[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const t of txs) {
    if (t.kind !== "expense" || !t.merchant || t.amount <= 0) continue;
    const key = placeKey(t.merchant);
    if (!key || places[key] || (only && !only.includes(key))) continue;
    const c = by.get(key) ?? { key, name: t.merchant, raw: t.raw ?? "", bankCategory: t.bankCategory, count: 0, avg: 0, times: [] };
    c.avg = (c.avg * c.count + t.amount) / (c.count + 1);
    c.count++;
    if (t.time && c.times.length < 3) c.times.push(t.time);
    by.set(key, c);
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

async function search(q: string): Promise<string> {
  try {
    const html = await net.text(`https://html.duckduckgo.com/html/?kl=ru-ru&q=${encodeURIComponent(q)}`, {
      headers: { "user-agent": "Mozilla/5.0", "accept-language": "ru" },
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll(".result")]
      .slice(0, 3)
      .map((r) => `${r.querySelector(".result__a")?.textContent ?? ""} — ${r.querySelector(".result__snippet")?.textContent ?? ""} (${r.querySelector(".result__url")?.textContent?.trim() ?? ""})`)
      .map((s) => s.replace(/\s+/g, " ").slice(0, 220))
      .join("\n");
  } catch {
    return "";
  }
}

/** Город из строки банка: SANKT-PETERBU → Санкт-Петербург (для поиска). */
function cityOf(raw: string): string {
  if (/sankt|peterbu|спб|санкт/i.test(raw)) return "Санкт-Петербург";
  if (/moskva|moscow|москва/i.test(raw)) return "Москва";
  if (/essentuki|ессентуки/i.test(raw)) return "Ессентуки";
  return "";
}

export async function identifyPlaces(list: Candidate[], categories: Category[]): Promise<Places> {
  if (!list.length) return {};
  const found = await Promise.all(list.map((c) => search(`${c.name.replace(/[-_*]\w*\d\w*/g, " ")} ${cityOf(c.raw)}`.trim())));
  const cats = categories.filter((c) => c.kind === "expense").map((c) => c.name).join(", ");
  const text = list
    .map((c, i) =>
      [
        `${i + 1}. «${c.name}»${c.bankCategory ? `, категория банка: ${c.bankCategory}` : ""}, ${c.count} раз, обычно ${Math.round(c.avg)} ₽${c.times.length ? `, время ${c.times.join(", ")}` : ""}`,
        `   строка банка: ${c.raw.slice(0, 160)}`,
        found[i] ? `   поиск:\n${found[i].split("\n").map((s) => "     " + s).join("\n")}` : "   поиск: ничего",
      ].join("\n"),
    )
    .join("\n");
  const res = await ai.json<{ n: number; title: string; what: string; emoji: string; category?: string; domain?: string; sure: boolean }[]>(
    `Это продавцы из банковских операций (Россия). Для каждого определи, что это за место.
Верни JSON-массив [{"n": номер, "title": "понятное название по-русски", "what": "что это, 1–3 слова (магазин у дома, кофейня, аптека, университет…)", "emoji": "один эмодзи", "category": "одна из: ${cats}", "domain": "сайт без https, если точно знаешь, иначе null", "sure": true/false}].
Не выдумывай: если по поиску и названию непонятно — sure: false, а title/what — осторожная догадка по категории банка, сумме и времени («Похоже на кафе»). Коды вроде B095 или N 3015 — номера точек, не названия.

${text}`,
    { model: "fast" },
  );
  const out: Places = {};
  const ok = new Set(categories.filter((c) => c.kind === "expense").map((c) => c.name));
  for (const r of Array.isArray(res) ? res : []) {
    const c = list[r.n - 1];
    if (!c || !r.title) continue;
    out[c.key] = {
      title: String(r.title).slice(0, 60),
      what: String(r.what ?? "").slice(0, 40),
      emoji: String(r.emoji ?? "").slice(0, 4) || "🏷️",
      category: r.category && ok.has(r.category) ? r.category : undefined,
      domain: r.sure && r.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(r.domain)) ? String(r.domain).toLowerCase() : undefined,
      sure: !!r.sure,
      at: Date.now(),
    };
  }
  // Кого не удалось разобрать — помечаем, чтобы не спрашивать каждый раз.
  for (const c of list) out[c.key] ??= { title: c.name, what: "", emoji: "", sure: false, at: Date.now() };
  return out;
}
