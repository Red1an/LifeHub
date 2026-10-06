import { useEffect, type ReactNode } from "react";
import { defineModule, Link, media, toast, cn } from "@lifehub/sdk";
import "./styles.css";
import { Today } from "./pages/Today.tsx";
import { BuildPage } from "./pages/Build.tsx";
import { PlayerPage } from "./pages/Player.tsx";
import { SummaryPage } from "./pages/Summary.tsx";
import { BreaksPage } from "./pages/Breaks.tsx";
import { SkillsPage } from "./pages/Skills.tsx";
import { ExercisePage } from "./pages/Exercise.tsx";
import { ProgressPage } from "./pages/Progress.tsx";
import { ProfilePage } from "./pages/Profile.tsx";
import { CoachPage } from "./pages/Coach.tsx";
import { useFit, type Fit } from "./lib/store.ts";
import { setAudio } from "./lib/sfx.ts";
import { Ring } from "./components/kit.tsx";

let lastReminder = Date.now();

/** Напоминание размяться: раз в N минут в рабочие часы, если давно не двигался. */
function useBreakReminder(fit: Fit) {
  const { remindEvery, workFrom, workTo, onboarded } = fit.profile;
  useEffect(() => {
    if (!remindEvery || !onboarded || fit.loading) return;
    const check = () => {
      const now = new Date();
      const h = now.getHours();
      const since = Math.min(Date.now() - fit.lastMoveAt, Date.now() - lastReminder);
      if (h < workFrom || h >= workTo || since < remindEvery * 60_000 || fit.active) return;
      lastReminder = Date.now();
      void media.notify("Пора размяться 🧘", "2–3 минуты у стола: шея, спина, ноги. Открой «Форму».").catch(() => {});
      toast("Пора размяться: загляни в «Разминки» 🧘");
    };
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [remindEvery, workFrom, workTo, onboarded, fit.loading, fit.lastMoveAt, !!fit.active]);
}

function Layout({ children }: { children: ReactNode }) {
  const fit = useFit();
  useEffect(() => setAudio({ sound: fit.profile.sound, voice: fit.profile.voice }), [fit.profile.sound, fit.profile.voice]);
  useBreakReminder(fit);
  return <div className="ft-root flex min-h-full flex-1 flex-col">{children}</div>;
}

function Widget() {
  const fit = useFit();
  useBreakReminder(fit);
  if (fit.loading) return null;
  const week = fit.week.thisWeek / fit.profile.perWeek;
  const breaks = fit.breaksToday / fit.profile.breaksPerDay;
  return (
    <Link to="/" className="ft-root -m-4 flex h-[calc(100%+2rem)] items-center gap-4 rounded-[inherit] p-4">
      <div className="relative">
        <Ring value={week} size={78} stroke={8}>
          <div className="text-xs font-bold">{fit.week.thisWeek}/{fit.profile.perWeek}</div>
        </Ring>
        <div className="absolute inset-[11px]">
          <Ring value={breaks} size={56} stroke={6} color="var(--ft-cyan)" />
        </div>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="ft-display font-bold">Форма <span className={cn(fit.days > 0 && "ft-flame")}>🔥</span>{fit.days}</div>
        <div className="mt-1 text-xs text-[var(--ft-muted)]"><span className="text-[var(--ft-lime)]">●</span> тренировок за неделю</div>
        <div className="text-xs text-[var(--ft-muted)]"><span className="text-[var(--ft-cyan)]">●</span> разминок сегодня: {fit.breaksToday}/{fit.profile.breaksPerDay}</div>
        <div className="mt-1 truncate text-xs font-bold text-[var(--ft-lime)]">{fit.active ? "⏯ продолжить тренировку" : "▶ к тренировке"}</div>
      </div>
    </Link>
  );
}

export default defineModule({
  routes: {
    "/": Today,
    "/build": BuildPage,
    "/play": PlayerPage,
    "/done/:id": SummaryPage,
    "/w/:id": SummaryPage,
    "/breaks": BreaksPage,
    "/skills": SkillsPage,
    "/ex/:id": ExercisePage,
    "/progress": ProgressPage,
    "/profile": ProfilePage,
    "/coach": CoachPage,
    "*": Today,
  },
  nav: [
    { to: "/", label: "Сегодня", icon: "🏠" },
    { to: "/build", label: "Тренировка", icon: "🏋️" },
    { to: "/breaks", label: "Разминки", icon: "🧘" },
    { to: "/skills", label: "Навыки", icon: "🪜" },
    { to: "/progress", label: "Прогресс", icon: "📈" },
  ],
  widgets: {
    today: { title: "Форма", size: "sm", component: Widget },
  },
  layout: Layout,
  theme: "dark",
});
