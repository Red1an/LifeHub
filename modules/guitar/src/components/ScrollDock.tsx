import { useEffect, useRef, useState, type RefObject } from "react";
import { cn, toast } from "@lifehub/sdk";
import { openMic, type MicHandle } from "@modules/audio";
import { transpose } from "../lib/chords";
import { startFollow } from "../lib/follow";
import { markPractice } from "../lib/train-stats";

/*
 * Прокрутка текста песни, три режима:
 *  - «За игрой»: микрофон узнаёт аккорды и ведёт текст за тобой (lib/follow.ts);
 *  - «Авто»: скорость сразу считается по длине песни и подстраивается, когда ты сам подкручиваешь
 *    вперёд/назад; запоминается для каждой песни;
 *  - «Тап»: касание внизу текста — дальше, вверху — назад. Педаль-перелистыватель (PageDown/стрелки) работает всегда.
 */

type Mode = "off" | "follow" | "auto" | "tap";

/** Ближайший прокручиваемый контейнер (модуль живёт внутри рамки хаба). */
export function scrollParent(el: HTMLElement | null): HTMLElement {
  let n = el?.parentElement ?? null;
  while (n) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

const isDoc = (box: HTMLElement) => box === document.scrollingElement || box === document.documentElement;
const viewH = (box: HTMLElement) => (isDoc(box) ? window.innerHeight : box.clientHeight);
const boxTop = (box: HTMLElement) => (isDoc(box) ? 0 : box.getBoundingClientRect().top);

function scrollBy(box: HTMLElement, dy: number, smooth = true) {
  box.scrollBy({ top: dy, behavior: smooth ? "smooth" : "auto" });
}

/** Поставить элемент примерно на треть высоты экрана. */
function bringTo(box: HTMLElement, el: Element, at = 0.33) {
  const r = el.getBoundingClientRect();
  const dy = r.top - boxTop(box) - viewH(box) * at;
  if (Math.abs(dy) > 24) scrollBy(box, dy);
}

const parseDuration = (d?: string) => (d ? d.split(":").reduce((n, x) => n * 60 + Number(x), 0) : 0);

export function ScrollDock({
  songId,
  target,
  sequence,
  capo,
  speed: savedSpeed,
  onSpeed,
  duration,
}: {
  songId: string;
  /** Блок с текстом песни. */
  target: RefObject<HTMLDivElement | null>;
  /** Аккорды текста по порядку (как показаны). */
  sequence: string[];
  capo: number;
  speed?: number;
  onSpeed: (pxPerSec: number) => void;
  /** Длительность оригинала «м:сс» — для первой оценки скорости. */
  duration?: string;
}) {
  const [mode, setMode] = useState<Mode>("off");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(savedSpeed ?? 0);
  const [heard, setHeard] = useState<{ chord: string | null; level: number }>({ chord: null, level: 0 });
  const [pos, setPos] = useState(-1);
  const posRef = useRef(-1);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (savedSpeed && !speed) setSpeed(savedSpeed);
  }, [savedSpeed]);

  // Подсветка текущего и следующего аккорда.
  useEffect(() => {
    const root = target.current;
    if (!root) return;
    root.querySelectorAll('[data-now="true"],[data-next="true"]').forEach((e) => {
      e.removeAttribute("data-now");
      e.removeAttribute("data-next");
    });
    if (mode !== "follow" || pos < 0) return;
    const cur = root.querySelector(`[data-ci="${pos}"]`);
    cur?.setAttribute("data-now", "true");
    root.querySelector(`[data-ci="${pos + 1}"]`)?.setAttribute("data-next", "true");
    if (cur) bringTo(scrollParent(root), cur);
  }, [pos, mode]);

  const setPosition = (i: number) => {
    posRef.current = i;
    setPos(i);
  };

  /* ── «За игрой» ── */
  useEffect(() => {
    if (mode !== "follow") return;
    let mic: MicHandle | null = null;
    let stop = () => {};
    let alive = true;
    const sounding = sequence.map((c) => (capo ? transpose(c, capo) : c));
    openMic()
      .then((m) => {
        if (!alive) return m.close();
        mic = m;
        stop = startFollow(m.source, {
          sequence: sounding,
          getPos: () => posRef.current,
          onPos: setPosition,
          onHeard: (chord, level) => setHeard({ chord, level }),
        });
      })
      .catch(() => {
        toast("Нет доступа к микрофону — разреши его в браузере (на телефоне нужен HTTPS)", "error");
        setMode("off");
      });
    // Нажатие на аккорд в тексте — «я здесь».
    const root = target.current;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("[data-ci]");
      if (!el) return;
      e.stopPropagation();
      e.preventDefault();
      setPosition(Number(el.getAttribute("data-ci")));
    };
    root?.addEventListener("click", onClick, true);
    markPractice(`song:${songId}`);
    return () => {
      alive = false;
      stop();
      mic?.close();
      root?.removeEventListener("click", onClick, true);
    };
  }, [mode, sequence.join(), capo]);

  /* ── «Авто» с подстройкой ── */
  useEffect(() => {
    if (mode !== "auto" || paused) return;
    const root = target.current;
    const box = scrollParent(root);
    let v = speedRef.current;
    if (!v) {
      // Первая оценка: проехать весь текст за длину оригинала.
      const secs = parseDuration(duration);
      const h = root?.offsetHeight ?? 2000;
      v = secs > 60 ? Math.max(8, Math.min(80, (h - viewH(box) * 0.5) / (secs * 0.92))) : 22;
      setSpeed(v);
    }
    let acc = 0;
    let last = performance.now();
    let expected = box.scrollTop;
    let raf = 0;
    let saveTimer = 0;
    const scrollTarget: HTMLElement | Window = isDoc(box) ? window : box;

    const onScroll = () => {
      const d = box.scrollTop - expected;
      if (Math.abs(d) < 3) return;
      // Ты подкрутил сам: вперёд — значит текст отстаёт, назад — спешит. Подстраиваемся мягко.
      const next = Math.max(5, Math.min(160, speedRef.current + d / 25));
      setSpeed(next);
      expected = box.scrollTop;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => onSpeed(Math.round(next * 10) / 10), 1500);
    };
    const step = (now: number) => {
      acc += (speedRef.current * (now - last)) / 1000;
      last = now;
      if (acc >= 1) {
        const px = Math.floor(acc);
        acc -= px;
        const before = box.scrollTop;
        box.scrollTop = before + px;
        expected = box.scrollTop;
        if (box.scrollTop === before && before > 0) {
          setMode("off");
          return;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    markPractice(`song:${songId}`);
    return () => {
      cancelAnimationFrame(raf);
      scrollTarget.removeEventListener("scroll", onScroll);
      window.clearTimeout(saveTimer);
    };
  }, [mode, paused]);

  /* ── «Тап» и педаль ── */
  useEffect(() => {
    const root = target.current;
    if (!root) return;
    const box = () => scrollParent(root);
    const onClick = (e: MouseEvent) => {
      if (mode !== "tap" || (e.target as HTMLElement).closest(".gt-chord,button,a")) return;
      const y = e.clientY - boxTop(box());
      const h = viewH(box());
      if (y > h * 0.5) scrollBy(box(), h * 0.6);
      else if (y < h * 0.3) scrollBy(box(), -h * 0.6);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable]")) return;
      const h = viewH(box());
      if (["PageDown", "ArrowRight", " "].includes(e.key) || (e.key === "ArrowDown" && mode === "tap")) {
        e.preventDefault();
        scrollBy(box(), h * 0.6);
      } else if (["PageUp", "ArrowLeft"].includes(e.key) || (e.key === "ArrowUp" && mode === "tap")) {
        e.preventDefault();
        scrollBy(box(), -h * 0.6);
      }
    };
    root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode]);

  const choose = (m: Mode) => {
    setPaused(false);
    if (m === "follow" && posRef.current < 0) setPosition(-1);
    setMode(mode === m ? "off" : m);
    if (m === "tap" && mode !== "tap") toast("Тап по нижней части текста — дальше, по верхней — назад");
  };
  const nudge = (k: number) => {
    const next = Math.max(5, Math.min(160, (speed || 22) * k));
    setSpeed(next);
    onSpeed(Math.round(next * 10) / 10);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom)+10px)] z-40 flex justify-center px-3 lg:bottom-5 lg:left-14">
      <div className="gt-panel pointer-events-auto flex max-w-full items-center gap-1 !rounded-full p-1 shadow-2xl shadow-black/60">
        {mode === "off" ? (
          <>
            <button className="gt-btn gt-btn-brass !min-h-10 !rounded-full !px-3 text-sm" onClick={() => choose("follow")}>
              🎤 За игрой
            </button>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3 text-sm" onClick={() => choose("auto")}>
              ▶ Авто
            </button>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3 text-sm" onClick={() => choose("tap")}>
              👆 Тап
            </button>
          </>
        ) : mode === "follow" ? (
          <>
            <span className="relative ml-2 flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--gt-rose)] opacity-60" style={{ animationDuration: `${1.6 - heard.level}s` }} />
              <span className="relative inline-flex size-2.5 rounded-full bg-[var(--gt-rose)]" />
            </span>
            <span className="min-w-0 px-2 text-sm">
              <span className="text-[var(--gt-muted)]">слышу </span>
              <b className="gt-mono text-[var(--gt-brass)]">{heard.chord ?? "…"}</b>
              {pos >= 0 && sequence[pos + 1] && (
                <span className="text-[var(--gt-muted)]">
                  {" "}
                  · дальше <b className="gt-mono text-[var(--gt-fg)]">{sequence[pos + 1]}</b>
                </span>
              )}
            </span>
            <button className="gt-btn gt-btn-ghost !min-h-9 !rounded-full !px-3 text-xs" onClick={() => setPosition(-1)} title="С начала">
              ⏮
            </button>
            <button className="gt-btn gt-btn-ghost !min-h-9 !rounded-full !px-3" onClick={() => setMode("off")} aria-label="Выключить">
              ✕
            </button>
          </>
        ) : mode === "auto" ? (
          <>
            <button className={cn("gt-btn !min-h-10 !rounded-full !px-3", paused ? "gt-btn-brass" : "gt-btn-ghost")} onClick={() => setPaused(!paused)}>
              {paused ? "▶" : "⏸"}
            </button>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3" onClick={() => nudge(0.85)} aria-label="Медленнее">
              −
            </button>
            <span className="gt-num min-w-14 text-center text-sm" title="Скорость; подстраивается, когда ты сам подкручиваешь текст">
              {Math.round(speed)}
              <span className="text-[10px] text-[var(--gt-muted)]"> пикс/с</span>
            </span>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3" onClick={() => nudge(1.15)} aria-label="Быстрее">
              +
            </button>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3" onClick={() => setMode("off")} aria-label="Выключить">
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="px-3 text-sm text-[var(--gt-muted)]">👆 тап внизу — дальше, вверху — назад</span>
            <button className="gt-btn gt-btn-ghost !min-h-10 !rounded-full !px-3" onClick={() => setMode("off")} aria-label="Выключить">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
