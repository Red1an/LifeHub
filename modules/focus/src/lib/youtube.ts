import { net } from "@lifehub/sdk";
import type { Channel, Video } from "./types";

/*
 * YouTube без ключа API: каналы ищем по странице поиска (ytInitialData), ролики берём из RSS канала
 * (15 последних). Без user-agent браузера YouTube отдаёт пустую страницу.
 */

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "accept-language": "ru,en;q=0.8",
};

export interface FoundChannel {
  channelId: string;
  title: string;
  thumb?: string;
  /** «1,2 млн подписчиков» — как пишет YouTube. */
  subs?: string;
  about?: string;
}

const CHANNEL_ID = /^UC[\w-]{22}$/;

function initialData(html: string): any {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Все объекты с ключом key в глубине JSON. */
function collect(node: any, key: string, out: any[] = []): any[] {
  if (Array.isArray(node)) for (const x of node) collect(x, key, out);
  else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (k === key) out.push(node[k]);
      else collect(node[k], key, out);
    }
  }
  return out;
}

const text = (t: any): string => t?.simpleText ?? (Array.isArray(t?.runs) ? t.runs.map((r: any) => r.text).join("") : "") ?? "";
const thumbOf = (t: any): string | undefined => {
  const url: string | undefined = t?.thumbnails?.at?.(-1)?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : undefined;
};

/** Поиск каналов по названию или теме. */
export async function searchChannels(query: string): Promise<FoundChannel[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%253D%253D`;
  const data = initialData(await net.text(url, { headers: HEADERS }));
  if (!data) throw new Error("YouTube ответил непонятной страницей");
  const seen = new Set<string>();
  return collect(data, "channelRenderer")
    .filter((c) => c?.channelId && !seen.has(c.channelId) && seen.add(c.channelId))
    .map((c) => ({
      channelId: c.channelId,
      title: text(c.title),
      thumb: thumbOf(c.thumbnail),
      // В новой выдаче подписчики лежат в videoCountText, а в subscriberCountText — @имя.
      subs: [text(c.subscriberCountText), text(c.videoCountText)].find((s) => /подпис|subscri/i.test(s)),
      about: text(c.descriptionSnippet),
    }))
    .slice(0, 12);
}

/** Ссылка, @имя или id канала → канал. Иначе null (тогда ищем по названию). */
export async function resolveChannel(input: string): Promise<FoundChannel | null> {
  const s = input.trim();
  const id = s.match(/(UC[\w-]{22})/)?.[1];
  let page: string | null = null;
  if (id && (CHANNEL_ID.test(s) || s.includes("/channel/"))) page = `https://www.youtube.com/channel/${id}`;
  else if (/^@[\w.-]+$/.test(s)) page = `https://www.youtube.com/${s}`;
  else if (/youtube\.com\/(@[\w.-]+|c\/[^/?#]+|user\/[^/?#]+)/.test(s)) page = `https://www.youtube.com/${s.match(/youtube\.com\/(@[\w.-]+|c\/[^/?#]+|user\/[^/?#]+)/)![1]}`;
  if (!page) return null;
  const html = await net.text(page, { headers: HEADERS });
  const channelId = html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ?? html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)?.[1];
  if (!channelId) throw new Error("Не нашёл канал по этой ссылке");
  const decode = (v?: string) => (v ? new DOMParser().parseFromString(v, "text/html").documentElement.textContent ?? v : undefined);
  return {
    channelId,
    title: decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]) ?? channelId,
    thumb: html.match(/<meta property="og:image" content="([^"]*)"/)?.[1],
  };
}

/** Последние ролики канала из RSS, без Shorts. */
export async function channelVideos(ch: Channel): Promise<Video[]> {
  const xml = await net.text(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`, { headers: HEADERS });
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: Video[] = [];
  for (const e of Array.from(doc.getElementsByTagName("entry"))) {
    const id = e.getElementsByTagName("yt:videoId")[0]?.textContent ?? "";
    const link = e.getElementsByTagName("link")[0]?.getAttribute("href") ?? "";
    const title = e.getElementsByTagName("title")[0]?.textContent ?? "";
    if (!id || link.includes("/shorts/") || /#shorts/i.test(title)) continue;
    const views = Number(e.getElementsByTagName("media:statistics")[0]?.getAttribute("views"));
    out.push({
      id,
      title,
      channelId: ch.channelId,
      channelTitle: ch.title,
      published: e.getElementsByTagName("published")[0]?.textContent ?? "",
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      views: Number.isFinite(views) ? views : undefined,
    });
  }
  return out;
}

/** Ролики всех каналов, свежие сверху. Каналы, которые не ответили, пропускаем. */
export async function loadFeed(channels: Channel[]): Promise<{ videos: Video[]; failed: string[] }> {
  const videos: Video[] = [];
  const failed: string[] = [];
  const queue = [...channels];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let ch = queue.shift(); ch; ch = queue.shift()) {
        try {
          videos.push(...(await channelVideos(ch)));
        } catch {
          failed.push(ch.title);
        }
      }
    }),
  );
  videos.sort((a, b) => b.published.localeCompare(a.published));
  return { videos, failed };
}

export const watchUrl = (id: string, title?: string) =>
  `https://www.youtube.com/watch?v=${id}${title ? `&lhp=${encodeURIComponent(title.slice(0, 120))}` : ""}`;
