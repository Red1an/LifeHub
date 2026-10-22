import { useEffect, useRef, type TouchEvent } from "react";
import { db, dayKey, Link, useNavigate, useParams } from "@lifehub/sdk";
import { CardView } from "../components/Cards";
import { Shell } from "../components/kit";
import { dayLabel, useDaily } from "../lib/store";
import { KIND_INFO, KINDS, type CardDoc, type Kind } from "../lib/types";
import { readerPath } from "./Today";

/** Одна рубрика на весь экран; снизу «назад / все / дальше», свайп влево-вправо листает рубрики. */
export function Reader() {
  const { day: param, kind: kindParam } = useParams();
  const day = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : dayKey();
  const isToday = day === dayKey();
  const { kinds, byKind, retry, reroll } = useDaily(day);
  const navigate = useNavigate();
  const kind = (KINDS.includes(kindParam as Kind) ? kindParam : kinds[0]) as Kind;
  const i = kinds.indexOf(kind);
  const prev = i > 0 ? kinds[i - 1] : null;
  const next = i >= 0 && i < kinds.length - 1 ? kinds[i + 1] : null;
  const card = byKind(kind);
  const home = isToday ? "/" : `/d/${day}`;
  const go = (k: Kind | null) => navigate(k ? readerPath(day, k) : home);

  // Открыл — значит, прочитал (задачка считается, когда решена или разобрана).
  useEffect(() => {
    if (card?.status === "ready" && !card.done && kind !== "puzzle") void db.collection<CardDoc>("cards").update(card.id, { done: true, doneAt: Date.now() });
  }, [card?.id, card?.status]);

  useEffect(() => {
    document.querySelector(".horizon-root")?.closest("main")?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [kind]);

  // Свайп: заметный горизонтальный жест, не по полям ввода и не по ползунку.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [data-noswipe]")) return (touch.current = null);
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.t > 700) return;
    if (dx < 0) go(next);
    else if (prev) go(prev);
  };

  if (!kinds.length) {
    return (
      <Shell>
        <p className="py-16 text-center text-[#9aa3b8]">В этот день карточек не было.</p>
      </Shell>
    );
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-full">
      <Shell>
        <div className="mb-3 flex items-center justify-between text-xs text-[#9aa3b8]">
          <Link to={home} className="hover:text-white">
            ← {isToday ? "Порция дня" : dayLabel(day)}
          </Link>
          <span>
            {i + 1} из {kinds.length}
          </span>
        </div>
        <div className="mb-4 flex gap-1">
          {kinds.map((k) => (
            <button
              key={k}
              aria-label={KIND_INFO[k].label}
              onClick={() => go(k)}
              className="h-1.5 flex-1 rounded-full transition"
              style={{ background: k === kind ? KIND_INFO[k].color : byKind(k)?.done ? `${KIND_INFO[k].color}66` : "rgba(255,255,255,0.1)" }}
            />
          ))}
        </div>

        <CardView
          key={`${day}-${kind}`}
          kind={kind}
          card={card}
          open
          onRetry={isToday ? () => retry(kind) : undefined}
          onReroll={isToday && kind !== "puzzle" && kind !== "history" ? () => reroll(kind) : undefined}
        />

        {/* Нижняя панель листания — над меню разделов модуля. */}
        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 lg:bottom-0 -mx-4 mt-5 bg-gradient-to-t from-[#0a0e1a] via-[#0a0e1a] to-transparent px-4 pb-3 pt-6 sm:-mx-6 sm:px-6">
          <div className="flex gap-2">
            <button className="horizon-btn !min-h-12 w-14 shrink-0 text-lg" onClick={() => go(prev)} disabled={!prev} aria-label="Предыдущая рубрика">
              ←
            </button>
            <Link to={home} className="horizon-btn !min-h-12 shrink-0 px-4" aria-label="Все рубрики">
              ▦
            </Link>
            <button className="horizon-btn horizon-btn-main !min-h-12 flex-1 text-[15px]" onClick={() => go(next)}>
              {next ? (
                <>
                  Дальше: {KIND_INFO[next].icon} {KIND_INFO[next].label}
                </>
              ) : (
                "Готово ✓"
              )}
            </button>
          </div>
        </div>
      </Shell>
    </div>
  );
}
