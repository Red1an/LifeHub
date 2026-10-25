/*
 * Приложение LifeHub на телефоне (phone/android): системные полосы (часы сверху, полоса жестов снизу)
 * красятся под то, что сейчас у их края страницы, — чтобы не висели отдельной чёрной полосой.
 * Заодно приложение узнаёт высоту нижнего меню, чтобы плашка «Без связи» стояла над ним.
 */
type Bridge = {
  bars?(top: string, bottom: string, light: boolean, bottomBar: number): void;
  insets?(top: number, bottom: number): void;
};

/** Отступы от системных полос, которые знает страница (env(safe-area-inset-*)); 0 — WebView их не сообщает. */
function safeArea(): [number, number] {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const r: [number, number] = [Math.round(parseFloat(s.paddingTop) || 0), Math.round(parseFloat(s.paddingBottom) || 0)];
  probe.remove();
  return r;
}

/** Цвет фона у точки: первый непрозрачный фон вверх по дереву. */
function colorAt(x: number, y: number): string {
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return getComputedStyle(document.body).backgroundColor;
}

function hex(css: string): string {
  const m = css.match(/[\d.]+/g);
  if (!m || m.length < 3) return "#121211";
  return "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
}

function lightness(h: string): number {
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Высота нижнего меню (хаба или модуля), если оно есть на экране. */
function bottomBar(): number {
  for (const nav of document.querySelectorAll<HTMLElement>("nav.fixed")) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && Math.abs(r.bottom - innerHeight) < 2) return Math.round(r.height);
  }
  return 0;
}

export function watchAppBars() {
  const bridge = (window as { LifeHubApp?: Bridge }).LifeHubApp;
  if (!bridge?.bars) return;
  let last = "";
  const tick = () => {
    const x = innerWidth / 2;
    const top = hex(colorAt(x, 1));
    const bottom = hex(colorAt(x, innerHeight - 1));
    const bar = bottomBar();
    const [safeTop, safeBottom] = safeArea();
    const key = `${top}${bottom}${bar}${safeTop}/${safeBottom}`;
    if (key === last) return;
    last = key;
    bridge.bars!(top, bottom, lightness(top) > 0.6, bar);
    // Страница отступает от полос сама — приложению свои отступы не нужны (иначе вдвое больше места сверху).
    bridge.insets?.(safeTop, safeBottom);
  };
  // Страница меняется по-разному (переход, тема, модуль со своим фоном) — дешевле просто поглядывать.
  setInterval(tick, 500);
  tick();
}
