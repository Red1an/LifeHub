import { net } from "@lifehub/sdk";
import { hostOf } from "./text.ts";
import type { LinkCard, LinkKind } from "./types.ts";

const APP_HOSTS = /(apps\.apple\.com|play\.google\.com|rustore\.ru|appgallery|chromewebstore|chrome\.google\.com\/webstore|addons\.mozilla|microsoft\.com\/store|apps\.microsoft|producthunt\.com|f-droid\.org)/i;
const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|rutube\.ru|vk\.com\/video|vkvideo\.ru|twitch\.tv|kinopoisk\.ru|imdb\.com|netflix\.com|tiktok\.com)/i;
const REPO_HOSTS = /(github\.com|gitlab\.com|gitverse\.ru|codeberg\.org|huggingface\.co)/i;
const ARTICLE_HOSTS = /(habr\.com|medium\.com|vc\.ru|substack\.com|dev\.to|teletype\.in|telegra\.ph|dzen\.ru|wikipedia\.org)/i;

export function kindOf(url: string, ogType?: string): LinkKind {
  if (APP_HOSTS.test(url)) return "app";
  if (VIDEO_HOSTS.test(url) || ogType?.startsWith("video")) return "video";
  if (REPO_HOSTS.test(url)) return "repo";
  if (ARTICLE_HOSTS.test(url) || ogType === "article") return "article";
  return "site";
}

export const KIND_LABEL: Record<LinkKind, string> = {
  site: "сайт",
  app: "приложение",
  video: "видео",
  repo: "репозиторий",
  article: "статья",
};

function meta(doc: Document, ...names: string[]) {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return undefined;
}

const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Карточка ссылки: заголовок, описание и картинка со страницы (через хаб, без CORS). */
export async function fetchCard(url: string): Promise<LinkCard> {
  const base: LinkCard = { url, kind: kindOf(url), site: hostOf(url) };
  try {
    const r = await net.fetch(url, { headers: { "accept-language": "ru,en;q=0.8" } });
    if (!r.ok || !/html/i.test(r.contentType ?? "html")) return { ...base, failed: !r.ok };
    const doc = new DOMParser().parseFromString(r.text, "text/html");
    const ogType = meta(doc, "og:type");
    let image = meta(doc, "og:image", "twitter:image");
    if (image) {
      try {
        image = new URL(image, r.url || url).href;
      } catch {
        image = undefined;
      }
    }
    return {
      url,
      kind: kindOf(url, ogType),
      site: meta(doc, "og:site_name") ?? hostOf(r.url || url),
      title: clip(meta(doc, "og:title", "twitter:title") ?? doc.querySelector("title")?.textContent?.trim(), 140),
      description: clip(meta(doc, "og:description", "description", "twitter:description"), 280),
      image: image?.startsWith("https://") ? image : undefined,
    };
  } catch {
    return { ...base, failed: true };
  }
}

/** Карточки для набора адресов (параллельно, по 4). */
export async function fetchCards(urls: string[]): Promise<Map<string, LinkCard>> {
  const out = new Map<string, LinkCard>();
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) out.set(u, await fetchCard(u));
    }),
  );
  return out;
}
