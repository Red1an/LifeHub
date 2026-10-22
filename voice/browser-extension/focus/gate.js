/*
 * Экран «Зачем пришёл?» и итог сеанса. Адрес: gate.html?site=<id>&to=<куда шёл> или &done=<id сеанса>.
 * Обратный отсчёт идёт, только пока вкладка на виду: открыть и уйти ждать в другую вкладку не выйдет.
 * Параметр lhp в адресе «куда» — цель, заданная заранее (ссылка из ленты хаба).
 */

const q = new URLSearchParams(location.search);
const siteId = q.get("site") || "";
const $ = (id) => document.getElementById(id);

const ext = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
/** Без расширения (страницу открыли напрямую) — пример, чтобы было видно вёрстку. */
const DEMO = {
  site: { id: "youtube", name: "YouTube", hosts: ["youtube.com"], dailyMin: 60 },
  today: { minutes: 34, count: 2 },
  work: true,
  limit: false,
  wait: 10,
  minutes: [5, 10],
  hubBase: null,
  puzzle: { id: "demo", text: "Сколько раз в сутки стрелки часов совпадают?", options: ["22", "24", "23"], answer: 0, why: "Минутная обгоняет часовую 11 раз за 12 часов — значит, 22 раза за сутки." },
  last: { siteName: "YouTube", purpose: "ролик про RAG", minutes: 10, startedAt: Date.now() - 600_000, endedAt: Date.now(), titles: ["RAG за 15 минут", "Векторные базы"] },
};
const homeOf = (site) => (site && site.hosts && site.hosts[0] ? `https://www.${site.hosts[0]}/` : "");
const send = (msg) => (ext ? chrome.runtime.sendMessage(msg) : Promise.resolve(DEMO));

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b > 1 && b < 5 ? 1 : b === 1 ? 0 : 2];
}

let target = q.get("to") || "";
let preset = "";
try {
  const u = new URL(target);
  preset = u.searchParams.get("lhp") || "";
  if (preset) {
    u.searchParams.delete("lhp");
    target = u.toString();
  }
} catch {
  target = "";
}

function feedLink(el, hubBase) {
  if (!hubBase) return;
  el.href = `${hubBase}/m/focus`;
  el.hidden = false;
}

/** Задачка на время ожидания: ответ сразу показывает, верно ли, и объяснение. */
function showPuzzle(p) {
  if (!p || !Array.isArray(p.options)) return;
  $("puzzle").hidden = false;
  $("pq").textContent = p.text;
  const box = $("popts");
  p.options.forEach((o, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o;
    b.onclick = () => {
      for (const [j, x] of [...box.children].entries()) {
        x.disabled = true;
        if (j === p.answer) x.className = "right";
        else if (x === b) x.className = "wrong";
      }
      const why = $("pwhy");
      why.textContent = (i === p.answer ? "Верно! " : "Не то. ") + (p.why || "");
      why.hidden = false;
    };
    box.append(b);
  });
}

async function showGate() {
  const info = await send({ type: "focus:info", site: siteId, puzzle: true });
  // Сеанс уже идёт (открыли в соседней вкладке) или фокус на паузе — сразу туда.
  if ((info.session && info.session.endsAt > Date.now()) || info.paused) {
    if (target) location.replace(target);
    return;
  }
  $("gate").hidden = false;
  $("site").textContent = info.site.name;
  document.title = `${info.site.name} — зачем?`;
  const used = `Сегодня здесь: <b>${info.today.minutes} мин</b>, ${info.today.count} ${plural(info.today.count, ["сеанс", "сеанса", "сеансов"])}`;
  const limit = info.site.dailyMin ? ` из ${info.site.dailyMin}` : "";
  const notes = [];
  if (info.limit) notes.push('<span class="warn">Лимит на сегодня исчерпан.</span>');
  if (info.work) notes.push("Сейчас рабочее время — ждать дольше.");
  $("today").innerHTML = `${used}${limit}. ${notes.join(" ")}`;
  feedLink($("feed"), info.hubBase);
  showPuzzle(info.puzzle);

  let minutes = info.minutes.includes(10) ? 10 : info.minutes[0];
  const box = $("minutes");
  for (const m of info.minutes) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${m} мин`;
    b.className = m === minutes ? "on" : "";
    b.onclick = () => {
      minutes = m;
      for (const x of box.children) x.className = x === b ? "on" : "";
    };
    box.append(b);
  }

  const input = $("purpose");
  if (preset) input.value = `Посмотреть: ${preset}`;
  let left = info.wait;
  const waited = info.wait;
  const go = $("go");
  const ready = () => input.value.trim().length >= 8;
  const render = () => {
    go.disabled = left > 0 || !ready();
    go.textContent = left > 0 ? `Войти через ${left} с` : ready() ? `Войти на ${minutes} мин` : "Напиши цель — от 8 букв";
  };
  input.addEventListener("input", render);
  box.addEventListener("click", render);
  render();
  const timer = setInterval(() => {
    if (document.hidden || left <= 0) return;
    left--;
    render();
    if (left <= 0) clearInterval(timer);
  }, 1000);

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    await send({ type: "focus:start", site: siteId, purpose: input.value.trim(), minutes, waited });
    location.replace(target || homeOf(info.site) || "about:blank");
  });
  $("close").onclick = () => (ext ? send({ type: "focus:close" }) : null);
}

async function showDone() {
  const info = await send({ type: "focus:info", site: siteId });
  const s = info.last;
  $("done").hidden = false;
  $("doneSite").textContent = info.site.name;
  document.title = `${info.site.name} — время вышло`;
  if (s) {
    const min = Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000));
    $("doneText").textContent = `${min} мин. Цель была: «${s.purpose}».${s.titles.length ? " Посмотрел:" : ""}`;
    for (const t of s.titles.slice(-8)) {
      const li = document.createElement("li");
      li.textContent = t;
      $("titles").append(li);
    }
  }
  feedLink($("doneFeed"), info.hubBase);
  $("doneClose").onclick = () => (ext ? send({ type: "focus:close" }) : null);
  $("again").onclick = () => {
    location.replace(`gate.html?site=${encodeURIComponent(siteId)}&to=${encodeURIComponent(homeOf(info.site))}`);
  };
}

if (q.get("done")) showDone();
else showGate();
