/*
 * Фокус — осознанный вход на отвлекающие сайты.
 *
 *  - заход на сайт из списка без открытого сеанса → вкладка уходит на focus/gate.html: «Зачем пришёл?»,
 *    таймер и ожидание перед входом (растёт с каждым сеансом за день и в рабочее время);
 *  - сеанс общий для сайта: пока не вышло время, сайт открыт во всех вкладках;
 *  - время вышло → вкладки сайта закрываются, одна показывает итог; закрыл все вкладки сам — сеанс
 *    заканчивается через минуту;
 *  - настройки берутся из хаба (модуль «Фокус», kv "config") и кэшируются: без хаба фокус тоже работает;
 *  - сеансы (цель, время, какие ролики смотрел) уходят в хаб, без связи копятся в очереди.
 *
 * Работает в фоне вместе с background.js (importScripts): base и findHub — оттуда.
 * Формат настроек — modules/focus/src/lib/types.ts, менять только вместе.
 */

const FOCUS_DEFAULTS = {
  enabled: true,
  sites: [
    { id: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"], on: true, clean: true, dailyMin: 60 },
    { id: "instagram", name: "Инстаграм", hosts: ["instagram.com"], on: true, clean: true, dailyMin: 30 },
    { id: "vk", name: "ВКонтакте", hosts: ["vk.com", "vk.ru"], on: false, clean: false, dailyMin: 30 },
    { id: "tiktok", name: "TikTok", hosts: ["tiktok.com"], on: false, clean: false, dailyMin: 15 },
  ],
  waitSec: 15,
  waitStepSec: 15,
  minutes: [5, 10, 20, 30],
  work: { on: true, days: [1, 2, 3, 4, 5], from: "10:00", to: "19:00" },
  pause: null,
  pauseDelayMin: 10,
};

const GRACE_MS = 60_000;
const GATE = chrome.runtime.getURL("focus/gate.html");

/* ───────────── состояние (chrome.storage.local, по очереди) ───────────── */

let chain = Promise.resolve();
/** Читает состояние, даёт его изменить и сохраняет. Вызовы идут строго по очереди. */
function withState(fn) {
  const run = chain.then(async () => {
    const s = await chrome.storage.local.get(["config", "sessions", "log", "outbox"]);
    const st = { config: s.config || FOCUS_DEFAULTS, sessions: s.sessions || {}, log: s.log || [], outbox: s.outbox || [] };
    const result = await fn(st);
    await chrome.storage.local.set({ sessions: st.sessions, log: st.log, outbox: st.outbox.slice(-200) });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

const readConfig = async () => (await chrome.storage.local.get("config")).config || FOCUS_DEFAULTS;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function siteFor(config, url) {
  if (!/^https?:/.test(url || "")) return null;
  const host = hostOf(url);
  return config.sites.find((s) => s.on && s.hosts.some((h) => host === h || host.endsWith("." + h))) || null;
}

function paused(config, now = Date.now()) {
  if (!config.enabled) return true;
  const p = config.pause;
  return !!(p && now >= p.requestedAt + config.pauseDelayMin * 60_000 && now < p.until);
}

function workNow(config, d = new Date()) {
  const w = config.work;
  if (!w || !w.on || !w.days.includes(d.getDay())) return false;
  const hm = d.getHours() * 60 + d.getMinutes();
  const mins = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return hm >= mins(w.from) && hm < mins(w.to);
}

const dayStart = () => new Date().setHours(0, 0, 0, 0);

/** Сколько сеансов и минут сегодня на сайте (вместе с идущим). */
function todayStats(st, siteId) {
  const from = dayStart();
  let ms = 0;
  let count = 0;
  for (const e of st.log) {
    if (e.site !== siteId || e.endedAt < from) continue;
    ms += e.endedAt - Math.max(e.startedAt, from);
    count++;
  }
  const cur = st.sessions[siteId];
  if (cur) {
    ms += Date.now() - Math.max(cur.startedAt, from);
    count++;
  }
  return { minutes: Math.round(ms / 60_000), count };
}

/* ───────────── перехват ───────────── */

async function guard(tabId, url) {
  const config = await readConfig();
  const site = siteFor(config, url);
  if (!site || paused(config)) return;
  const { sessions } = await chrome.storage.local.get("sessions");
  const s = sessions && sessions[site.id];
  if (s && s.endsAt > Date.now()) return;
  const gate = `${GATE}?site=${encodeURIComponent(site.id)}&to=${encodeURIComponent(url)}`;
  chrome.tabs.update(tabId, { url: gate }).catch(() => {});
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) guard(d.tabId, d.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url) guard(tabId, info.url);
  if (info.title || info.url) noteTitle(tab);
  if (info.url) scheduleCheck();
});
chrome.tabs.onRemoved.addListener(() => scheduleCheck());

/** Что смотрел за сеанс: заголовки роликов YouTube и страниц остальных сайтов. */
async function noteTitle(tab) {
  if (!tab || !tab.url || !tab.title) return;
  const config = await readConfig();
  const site = siteFor(config, tab.url);
  if (!site) return;
  if (site.id === "youtube" && !/\/watch|\/shorts\//.test(tab.url)) return;
  const title = tab.title.replace(/^\(\d+\)\s*/, "").replace(/\s*[-–—]\s*YouTube$/, "").trim();
  if (!title || /^(YouTube|Instagram)$/i.test(title) || title.startsWith("http")) return;
  await withState((st) => {
    const s = st.sessions[site.id];
    if (!s || s.titles.includes(title)) return;
    s.titles = [...s.titles, title].slice(-30);
  });
}

/* ───────────── сеансы ───────────── */

function gateInfo(st, siteId) {
  const config = st.config;
  const site = config.sites.find((s) => s.id === siteId) || { id: siteId, name: siteId, dailyMin: 0 };
  const today = todayStats(st, siteId);
  const work = workNow(config);
  const limit = site.dailyMin > 0 && today.minutes >= site.dailyMin;
  let wait = config.waitSec + config.waitStepSec * today.count;
  if (work) wait *= 2;
  if (limit) wait += 60;
  let minutes = config.minutes.slice().sort((a, b) => a - b);
  if (work) minutes = minutes.filter((m) => m <= 10);
  if (limit) minutes = minutes.slice(0, 1);
  if (!minutes.length) minutes = [5];
  return { site, today, work, limit, wait: Math.min(wait, 300), minutes, session: st.sessions[siteId] || null };
}

function newId() {
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function startSession(siteId, purpose, minutes, waited) {
  const s = await withState((st) => {
    const site = st.config.sites.find((x) => x.id === siteId);
    if (!site) return null;
    const now = Date.now();
    const s = {
      id: newId(),
      site: siteId,
      siteName: site.name,
      purpose: String(purpose || "").slice(0, 300),
      minutes,
      startedAt: now,
      endsAt: now + minutes * 60_000,
      endedAt: null,
      endedBy: null,
      waited: waited || 0,
      titles: [],
    };
    st.sessions[siteId] = s;
    st.outbox.push({ ...s });
    return s;
  });
  if (s) chrome.alarms.create(`focus-end:${siteId}`, { when: s.endsAt });
  flush();
  return s;
}

async function siteTabs(siteId) {
  const config = await readConfig();
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => {
    const site = siteFor(config, t.url || t.pendingUrl || "");
    return site && site.id === siteId;
  });
}

async function endSession(siteId, by, at) {
  const s = await withState((st) => {
    const s = st.sessions[siteId];
    if (!s) return null;
    delete st.sessions[siteId];
    s.endedAt = at || Date.now();
    s.endedBy = by;
    delete s.goneAt;
    st.log = st.log.filter((e) => e.endedAt > Date.now() - 8 * 86_400_000);
    st.log.push({ site: siteId, startedAt: s.startedAt, endedAt: s.endedAt });
    st.outbox.push({ ...s });
    return s;
  });
  chrome.alarms.clear(`focus-end:${siteId}`);
  if (s && by !== "closed") {
    const tabs = await siteTabs(siteId);
    const keep = tabs.find((t) => t.active) || tabs[0];
    for (const t of tabs) {
      if (t === keep) chrome.tabs.update(t.id, { url: `${GATE}?site=${encodeURIComponent(siteId)}&done=${encodeURIComponent(s.id)}` }).catch(() => {});
      else chrome.tabs.remove(t.id).catch(() => {});
    }
  }
  if (s) {
    await chrome.storage.local.set({ lastSession: s });
    flush();
  }
  return s;
}

let checkTimer = null;
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(checkSessions, 500);
}

/** Время вышло — закрыть; вкладок сайта нет дольше минуты — сеанс закончен. */
async function checkSessions() {
  const { sessions = {} } = await chrome.storage.local.get("sessions");
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    const s = sessions[id];
    if (s.endsAt <= now) {
      await endSession(id, "timer", s.endsAt);
      continue;
    }
    const open = (await siteTabs(id)).length;
    if (open) {
      if (s.goneAt) await withState((st) => st.sessions[id] && delete st.sessions[id].goneAt);
    } else if (!s.goneAt) {
      await withState((st) => st.sessions[id] && (st.sessions[id].goneAt = now));
    } else if (now - s.goneAt >= GRACE_MS) {
      await endSession(id, "closed", s.goneAt);
    }
  }
}

/** Вкладки, открытые на сайте без сеанса (например, во время паузы), — тоже на экран входа. */
async function sweep() {
  const config = await readConfig();
  if (paused(config)) return;
  for (const t of await chrome.tabs.query({})) if (t.url) guard(t.id, t.url);
}

/* ───────────── связь с хабом ───────────── */

async function hub() {
  if (typeof base !== "undefined" && base) return base;
  const b = await findHub();
  if (b) base = b;
  return b;
}

async function syncConfig() {
  const b = await hub();
  if (!b) return;
  try {
    const r = await fetch(`${b}/api/focus/config?v=${chrome.runtime.getManifest().version}`, { headers: { "x-lifehub": "1" } });
    if (!r.ok) return;
    const { config, puzzles } = await r.json();
    await chrome.storage.local.set({ rawConfig: config || null, hubBase: b, puzzles: Array.isArray(puzzles) ? puzzles : [] });
  } catch {}
}

/**
 * Ослабить фокус (выключить сайт, поднять лимит…) можно только с задержкой: модуль кладёт новые
 * настройки в pending с applyAt, и они действуют с этого момента. Действующие — в "config".
 */
async function applyConfig() {
  const { rawConfig, config } = await chrome.storage.local.get(["rawConfig", "config"]);
  if (rawConfig === undefined) return;
  let c = rawConfig ? { ...FOCUS_DEFAULTS, ...rawConfig } : FOCUS_DEFAULTS;
  if (c.pending && Date.now() >= c.pending.applyAt) c = { ...FOCUS_DEFAULTS, ...c.pending };
  delete c.pending;
  if (JSON.stringify(c) !== JSON.stringify(config)) await chrome.storage.local.set({ config: c });
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const { outbox = [] } = await chrome.storage.local.get("outbox");
    if (!outbox.length) return;
    const b = await hub();
    if (!b) return;
    const r = await fetch(`${b}/api/focus/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lifehub": "1" },
      body: JSON.stringify({ sessions: outbox }),
    });
    if (r.ok) await withState((st) => void (st.outbox = st.outbox.slice(outbox.length)));
  } catch {
  } finally {
    flushing = false;
  }
}

/** Задачка из «Кругозора» на время ожидания: каждый раз новая, пока не кончатся. */
async function nextPuzzle() {
  const { puzzles = [], puzzleSeen = [] } = await chrome.storage.local.get(["puzzles", "puzzleSeen"]);
  if (!puzzles.length) return null;
  const p = puzzles.find((x) => !puzzleSeen.includes(x.id)) || puzzles[Math.floor(Math.random() * puzzles.length)];
  await chrome.storage.local.set({ puzzleSeen: [...puzzleSeen.filter((id) => id !== p.id), p.id].slice(-60) });
  return p;
}

/* ───────────── события ───────────── */

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("focus:")) return;
  (async () => {
    if (msg.type === "focus:info") {
      const st = await withState((st) => st);
      const { hubBase, lastSession } = await chrome.storage.local.get(["hubBase", "lastSession"]);
      const info = gateInfo(st, msg.site);
      const puzzle = msg.puzzle && info.wait > 0 ? await nextPuzzle() : null;
      return { ...info, hubBase: hubBase || null, last: lastSession || null, paused: paused(st.config), puzzle };
    }
    if (msg.type === "focus:start") return { session: await startSession(msg.site, msg.purpose, Number(msg.minutes) || 5, Number(msg.waited) || 0) };
    if (msg.type === "focus:end") return { session: await endSession(msg.site, "self") };
    if (msg.type === "focus:close") {
      if (sender.tab) chrome.tabs.remove(sender.tab.id).catch(() => {});
      return {};
    }
    return {};
  })().then(reply, (e) => reply({ error: String(e) }));
  return true;
});

chrome.alarms.create("focus", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith("focus-end:")) checkSessions();
  if (a.name === "focus") {
    syncConfig().then(applyConfig).then(checkSessions).then(sweep).then(flush);
  }
});
syncConfig().then(applyConfig).then(flush);
