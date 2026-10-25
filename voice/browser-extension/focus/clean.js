/*
 * Фокус на самих сайтах. Скрипт подключается ко всем https-страницам, но на чужих сразу затихает:
 * работает только на сайтах из настроек «Фокуса» (YouTube, Инстаграм, Озон, Wildberries, свои).
 *  - «чистый режим» (галочка у YouTube и Инстаграма): без рекомендаций, Shorts, Reels и «Интересного»;
 *  - плашка с оставшимся временем и целью сеанса; «Я всё» заканчивает сеанс раньше.
 */

(() => {
  const host = location.hostname;
  const isYT = /(^|\.)youtube\.com$/.test(host);
  const isIG = /(^|\.)instagram\.com$/.test(host);
  /** Сайт из настроек, чьи домены совпали с этой страницей (пока настроек нет — только YouTube и Инстаграм). */
  let siteId = isYT ? "youtube" : isIG ? "instagram" : null;
  const siteOf = (config) =>
    config && config.sites ? config.sites.find((s) => s.on && s.hosts.some((h) => host === h || host.endsWith("." + h))) || null : null;

  const YT_CSS = `
    ytd-browse[page-subtype="home"] #primary,
    #related, ytd-watch-next-secondary-results-renderer,
    ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], grid-shelf-view-model,
    ytd-video-renderer:has(a[href^="/shorts/"]), ytd-rich-item-renderer:has(a[href^="/shorts/"]),
    ytd-guide-entry-renderer:has(a[href^="/shorts"]), ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
    .ytp-endscreen-content, .ytp-ce-element, .ytp-autonav-endscreen-countdown-overlay,
    ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer
    { display: none !important; }
    ytd-browse[page-subtype="home"]::after {
      content: "Рекомендаций нет — ищи то, зачем пришёл.";
      display: block; padding: 18vh 16px; text-align: center; font: 18px system-ui; color: #888;
    }`;
  const IG_CSS = `
    a[href="/reels/"], a[href^="/explore"] { display: none !important; }`;

  let style = null;
  function applyClean(on) {
    if (on && !style) {
      style = document.createElement("style");
      style.textContent = isYT ? YT_CSS : IG_CSS;
      (document.head || document.documentElement).append(style);
    } else if (!on && style) {
      style.remove();
      style = null;
    }
  }

  let clean = false;
  /** Shorts → обычный плеер, Reels и «Интересное» → лента подписок, автовоспроизведение — выключить. */
  function redirects() {
    if (!clean) return;
    const p = location.pathname;
    if (isYT) {
      const m = p.match(/^\/shorts\/([\w-]{6,})/);
      if (m) return location.replace(`/watch?v=${m[1]}`);
      const auto = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
      if (auto) auto.click();
    } else if (isIG) {
      if (/^\/(reels|explore)(\/|$)/.test(p)) return location.replace("/?variant=following");
      if (p === "/" && !location.search.includes("variant=")) return location.replace("/?variant=following");
    }
  }

  /* ───────────── плашка сеанса ───────────── */

  let pill = null;
  let session = null;
  function renderPill() {
    if (!session || !document.body) {
      if (pill) pill.remove();
      pill = null;
      return;
    }
    if (!pill) {
      pill = document.createElement("div");
      pill.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:10px;align-items:center;max-width:min(420px,calc(100vw - 24px));" +
        "padding:8px 10px 8px 14px;border-radius:999px;background:rgba(13,17,23,.92);color:#e8eef6;font:13px/1.3 system-ui,sans-serif;" +
        "box-shadow:0 4px 18px rgba(0,0,0,.35);pointer-events:auto";
      pill.innerHTML =
        '<b data-t style="font-variant-numeric:tabular-nums"></b><span data-p style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#9aa8b9"></span>' +
        '<button data-x style="flex:none;border:0;border-radius:999px;padding:4px 10px;background:#263041;color:#e8eef6;font:inherit;cursor:pointer">Я всё</button>';
      pill.querySelector("[data-x]").onclick = () => chrome.runtime.sendMessage({ type: "focus:end", site: siteId });
      document.body.append(pill);
    }
    const left = Math.max(0, session.endsAt - Date.now());
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    pill.querySelector("[data-t]").textContent = `⏳ ${m}:${String(s).padStart(2, "0")}`;
    pill.querySelector("[data-p]").textContent = session.purpose;
    pill.style.background = left < 60_000 ? "rgba(150,40,40,.95)" : "rgba(13,17,23,.92)";
  }

  async function load() {
    const { config, sessions } = await chrome.storage.local.get(["config", "sessions"]);
    const site = siteOf(config);
    if (config && config.sites) siteId = site ? site.id : null;
    if (!siteId) {
      applyClean(false);
      session = null;
      renderPill();
      return false;
    }
    clean = (isYT || isIG) && (site ? !!site.clean : true);
    applyClean(clean);
    session = sessions && sessions[siteId] ? sessions[siteId] : null;
    redirects();
    renderPill();
    return true;
  }

  let ticking = false;
  const start = (ours) => {
    if (!ours || ticking) return;
    ticking = true;
    setInterval(() => {
      redirects();
      renderPill();
    }, 1000);
  };
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.config || ch.sessions) load().then(start);
  });
  load().then(start);
})();
