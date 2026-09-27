import { useEffect, useState } from "react";
import { Link, plural } from "@lifehub/sdk";
import { loadHubStorage } from "./lib/storage";
import { currentStreak, dayKey, loadDayLog } from "./lib/train-stats";

/** Виджет на главной хаба: серия занятий и сколько упражнений сделано сегодня. */
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
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold">{state.streak}</span>
        <span className="text-sm text-muted">{plural(state.streak, ["день", "дня", "дней"])} подряд</span>
      </div>
      <div className="mt-1 text-sm text-muted">
        Сегодня: {state.today ? `${state.today} ${plural(state.today, ["упражнение", "упражнения", "упражнений"])}` : "ещё не занимались"}
      </div>
      <Link to="/train" className="mt-3 inline-block text-sm font-medium text-accent">
        К тренажёрам →
      </Link>
    </div>
  );
}
