import { useState, type ReactNode } from "react";
import { cn, Link, useLocation, useStore } from "@lifehub/sdk";
import { CATEGORIES, exerciseByPath } from "../../data/exercises";
import { TopicVideos, videosOf } from "../Videos";

/** Оформление любого тренажёра: шапка, блок «Как заниматься» с видео, затем само упражнение. */
export function ExerciseShell({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description: string;
  accent?: "emerald" | "violet" | "amber" | "rose" | "sky";
  children: ReactNode;
  aside?: ReactNode;
}) {
  const { pathname } = useLocation();
  const ex = exerciseByPath(pathname);
  const cat = CATEGORIES.find((c) => c.id === ex?.category);
  const [seen, setSeen] = useStore<string[]>("guidesSeen", []);
  const firstTime = !!ex && !seen.includes(ex.id);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? firstTime;
  const [tab, setTab] = useState<"how" | "video">("how");
  const hasVideo = !!ex?.video && videosOf(ex.video).ru.length + videosOf(ex.video).en.length > 0;

  const toggle = () => {
    setOpen(!expanded);
    if (ex && firstTime) setSeen([...seen, ex.id]);
  };

  return (
    <div className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4 sm:px-6 sm:pb-12 sm:pt-8">
        <div className="mb-4 flex items-start gap-3">
          <Link to="/train" className="gt-btn gt-btn-ghost !min-h-10 !px-3" aria-label="Все тренажёры">
            ←
          </Link>
          <div className="min-w-0 flex-1">
            {cat && (
              <div className="text-xs font-bold uppercase tracking-wider" style={{ color: cat.color }}>
                {cat.icon} {cat.title}
                {ex && <span className="text-[var(--gt-muted)]"> · {ex.level} · ~{ex.minutes} мин</span>}
              </div>
            )}
            <h1 className="gt-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{title}</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--gt-muted)]">{description}</p>
          </div>
          {aside}
        </div>

        {ex && (
          <div className="gt-panel mb-6 overflow-hidden">
            <button onClick={toggle} className="flex w-full items-center gap-3 p-4 text-left">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--gt-brass)]/15 text-lg">💡</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">Как заниматься</span>
                <span className="block truncate text-sm text-[var(--gt-muted)]">{ex.goal}</span>
              </span>
              <span className={cn("text-[var(--gt-muted)] transition", expanded && "rotate-180")}>⌄</span>
            </button>
            {expanded && (
              <div className="gt-slide border-t border-[var(--gt-line)] p-4">
                {hasVideo && (
                  <div className="mb-4 flex gap-2">
                    <button data-on={tab === "how"} onClick={() => setTab("how")} className="gt-chip !min-h-8">📋 Шаги</button>
                    <button data-on={tab === "video"} onClick={() => setTab("video")} className="gt-chip !min-h-8">▶ Видеоурок</button>
                  </div>
                )}
                {tab === "how" || !hasVideo ? (
                  <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
                    <div>
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--gt-brass)]">Шаги</div>
                      <ol className="space-y-2">
                        {ex.steps.map((s, i) => (
                          <li key={i} className="flex gap-3 text-sm leading-snug">
                            <span className="gt-num grid size-6 shrink-0 place-items-center rounded-full bg-[var(--gt-panel-2)] text-xs font-bold text-[var(--gt-brass)]">{i + 1}</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--gt-copper)]">Важно</div>
                      <ul className="space-y-2">
                        {ex.tips.map((s, i) => (
                          <li key={i} className="flex gap-2 text-sm leading-snug text-[var(--gt-muted)]">
                            <span className="text-[var(--gt-copper)]">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <TopicVideos topic={ex.video!} limit={4} />
                )}
              </div>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export function ScoreBadge({ correct, total, label = "Счёт" }: { correct: number; total: number; label?: string }) {
  return (
    <div className="gt-panel !rounded-2xl px-4 py-2 text-right">
      <div className="text-[11px] uppercase tracking-wide text-[var(--gt-muted)]">{label}</div>
      <div className="gt-num text-xl font-semibold">
        {correct}
        <span className="text-[var(--gt-muted)]">/{total}</span>
      </div>
    </div>
  );
}
