/*
 * «Потяни вниз — обновить» в приложении LifeHub на телефоне (phone/android): в WebView его нет, а в браузере
 * есть свой. Срабатывает только с самого верха страницы и только если потянуть далеко — чтобы не ловить
 * случайные свайпы при прокрутке.
 */
const PULL = 140; // насколько потянуть пальцем (px) до обновления
const MAX = 96; // где останавливается кружок

/** Палец начал внутри чего-то прокрученного вниз — это прокрутка, а не обновление. */
function scrolledInside(el: Element | null): boolean {
  for (; el && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return (document.scrollingElement?.scrollTop ?? 0) > 0;
}

export function pullToRefresh() {
  if (!(window as { LifeHubApp?: unknown }).LifeHubApp) return;

  // В приложении интерфейс не масштабируется и не «тянется» за краем — как у обычного приложения.
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.overscrollBehavior = "none";

  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  ring.style.cssText =
    "position:fixed;left:50%;top:env(safe-area-inset-top);z-index:2147483647;width:36px;height:36px;margin-left:-18px;border-radius:50%;" +
    "display:grid;place-items:center;pointer-events:none;opacity:0;transform:translateY(-48px);" +
    "background:var(--lh-surface-2);color:var(--lh-fg);border:1px solid var(--lh-line);box-shadow:0 2px 10px rgb(0 0 0/.25)";
  ring.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';
  document.body.appendChild(ring);
  const icon = ring.firstElementChild as SVGElement;

  let startY = 0;
  let startX = 0;
  let pulling = false;
  let dy = 0;

  const place = (d: number, animate: boolean) => {
    const y = Math.min(MAX, d * 0.55);
    ring.style.transition = animate ? "transform .2s, opacity .2s" : "none";
    ring.style.transform = `translateY(${y - 48}px)`;
    ring.style.opacity = String(Math.min(1, d / 60));
    icon.style.transform = `rotate(${(d / PULL) * 270}deg)`;
    icon.style.opacity = d >= PULL ? "1" : "0.5";
  };

  addEventListener(
    "touchstart",
    (e) => {
      pulling = e.touches.length === 1 && !scrolledInside(e.target as Element);
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
      dy = 0;
    },
    { passive: true },
  );

  addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      const t = e.touches[0]!;
      const d = t.clientY - startY;
      // Вверх или вбок (листание вкладок, слайдеры) — не наше.
      if (d <= 0 || (dy === 0 && Math.abs(t.clientX - startX) > d)) {
        if (dy > 0) place(0, true);
        pulling = false;
        return;
      }
      dy = d;
      place(d, false);
    },
    { passive: true },
  );

  const end = () => {
    if (!pulling) return;
    pulling = false;
    if (dy >= PULL) {
      ring.style.transition = "transform .2s";
      ring.style.transform = `translateY(${MAX * 0.6 - 48}px)`;
      // keyframes spin — из Tailwind (animate-spin в sdk/ui.tsx).
      icon.style.animation = "spin .7s linear infinite";
      setTimeout(() => location.reload(), 150);
    } else place(0, true);
    dy = 0;
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", end, { passive: true });
}
