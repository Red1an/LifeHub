import { useEffect, useState } from "react";
import { cn, Link, plural } from "@lifehub/sdk";
import "./styles.css";
import { loadHubStorage } from "./lib/storage";
import { currentStreak, dayKey, loadDayLog } from "./lib/train-stats";

/** Виджет на главной хаба: серия занятий и сколько сделано сегодня. */
export function PracticeWidget() {
  const [state, setState] = useState<{ streak: number; today: number } | null>(null);
  useEffect(() => {
    loadHubStorage().then(() => {
      const log = loadDayLog();
      setState({ streak: currentStreak(log), today: log[dayKey()]?.length ?? 0 });
    });
  }, []);
  if (!state) return null;
  return (
    <Link to="/" className="gt-root -m-4 flex h-[calc(100%+2rem)] items-center gap-4 rounded-[inherit] p-4">
      <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ffcf6e] to-[#ff8a4c] text-3xl">🎸</div>
      <div className="min-w-0 flex-1">
        <div className="gt-display text-lg font-bold uppercase">
          Гитара <span className={cn(state.streak > 0 && "gt-flame")}>🔥</span>
          {state.streak}
        </div>
        <div className="text-xs text-[var(--gt-muted)]">
          {state.streak} {plural(state.streak, ["день", "дня", "дней"])} подряд · сегодня{" "}
          {state.today ? `${state.today} ${plural(state.today, ["занятие", "занятия", "занятий"])}` : "ещё не играл"}
        </div>
        <div className="mt-1 text-xs font-bold text-[var(--gt-brass)]">▶ к занятиям</div>
      </div>
    </Link>
  );
}
