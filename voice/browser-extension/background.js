/*
 * Джарвис — вкладки. Связь браузера с хабом LifeHub на этом компьютере.
 *
 *  - отправляет хабу список вкладок (все окна и пространства Vivaldi) при каждом изменении;
 *  - ждёт команды долгим опросом: переключиться на вкладку, открыть ссылку, закрыть вкладку;
 *  - фокус (focus/): экран «Зачем пришёл?» и таймер для отвлекающих сайтов.
 *
 * Хаб принимает запросы только с этого компьютера и только от расширения (заголовок Origin).
 */

const PORTS = [4200, 4201, 4300];
let base = null;

async function findHub() {
  for (const port of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/jarvis/browser/hello`, { headers: { "x-lifehub": "1" } });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch {}
  }
  return null;
}

/** Пространство Vivaldi: в vivExtData (JSON) у вкладки лежит workspaceId. */
function workspaceOf(tab) {
  try {
    const ext = tab.vivExtData ? JSON.parse(tab.vivExtData) : null;
    return ext && ext.workspaceId ? String(Math.round(ext.workspaceId)) : null;
  } catch {
    return null;
  }
}

let sendTimer = null;
function scheduleSend() {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(sendTabs, 400);
}

async function sendTabs() {
  if (!base) return;
  const tabs = await chrome.tabs.query({});
  const list = tabs
    .filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("vivaldi://") && !t.url.startsWith("devtools://"))
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: t.title || "",
      url: t.url,
      active: !!t.active,
      audible: !!t.audible,
      workspace: workspaceOf(t),
    }));
  try {
    await fetch(`${base}/api/jarvis/browser/tabs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lifehub": "1" },
      body: JSON.stringify({ tabs: list, browser: navigator.userAgent.includes("Vivaldi") ? "Vivaldi" : "Chromium" }),
    });
  } catch {
    base = null;
  }
}

async function run(cmd) {
  if (cmd.kind === "activate") {
    await chrome.tabs.update(cmd.tabId, { active: true });
    if (cmd.windowId) await chrome.windows.update(cmd.windowId, { focused: true });
  } else if (cmd.kind === "open") {
    await chrome.tabs.create({ url: cmd.url, active: true });
  } else if (cmd.kind === "close") {
    await chrome.tabs.remove(cmd.tabId);
  } else if (cmd.kind === "refresh") {
    await sendTabs();
  }
}

let looping = false;
async function loop() {
  if (looping) return;
  looping = true;
  try {
    while (true) {
      if (!base) {
        base = await findHub();
        if (!base) break;
        await sendTabs();
      }
      try {
        const r = await fetch(`${base}/api/jarvis/browser/next`, { headers: { "x-lifehub": "1" } });
        if (!r.ok) throw new Error(String(r.status));
        const cmd = await r.json();
        if (cmd && cmd.kind) await run(cmd).catch(() => {});
      } catch {
        base = null;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  } finally {
    looping = false;
  }
}

// Вызов API расширения каждые 20 с не даёт браузеру усыпить фоновый процесс посреди ожидания команды.
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);
chrome.alarms.create("jarvis", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
chrome.runtime.onInstalled.addListener(() => loop());
for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onMoved]) {
  ev.addListener(() => scheduleSend());
}
loop();

// Фокус: осознанный вход на YouTube, в Инстаграм и т. п. (focus/focus.js, модуль хаба «Фокус»).
importScripts("focus/focus.js");
