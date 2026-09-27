import { Link } from "@lifehub/sdk";
import { ReactNode } from "react";

export function ExerciseShell({
  title,
  description,
  accent = "emerald",
  children,
  aside,
}: {
  title: string;
  description: string;
  accent?: "emerald" | "violet" | "amber" | "rose" | "sky";
  children: ReactNode;
  aside?: ReactNode;
}) {
  const accentText = {
    sky: "text-sky-600 dark:text-sky-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    violet: "text-violet-600 dark:text-violet-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[accent];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:py-10 sm:pb-12">
      <Link to="/train" className={`text-sm underline ${accentText}`}>
        ← Все тренажёры
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function ScoreBadge({
  correct,
  total,
  label = "Счёт",
}: {
  correct: number;
  total: number;
  label?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-right">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {correct}
        <span className="text-zinc-400">/{total}</span>
      </div>
    </div>
  );
}
