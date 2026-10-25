import type { ReactNode } from "react";
import { defineModule, Link, cn, useCollection, type ModuleSummary } from "@lifehub/sdk";
import "./styles.css";
import { Today } from "./pages/Today.tsx";
import { MapPage, TrackPage } from "./pages/Map.tsx";
import { TopicPage } from "./pages/Topic.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { PracticePage } from "./pages/Practice.tsx";
import { ArenaPage, BugPage, QuestionPage, BossPage, BlitzPage } from "./pages/Arena.tsx";
import { ReviewPage } from "./pages/Review.tsx";
import { MentorPage, ChatPage } from "./pages/Mentor.tsx";
import { ProfilePage, useSound } from "./pages/Profile.tsx";
import { TestPage, MistakesPage, MixedPage, PlacementPage } from "./pages/Training.tsx";
import { ProjectsPage, ProjectPage } from "./pages/Projects.tsx";
import { GoalPage } from "./pages/Goal.tsx";
import { WorkshopPage } from "./pages/Workshop.tsx";
import { MissionPage } from "./pages/Mission.tsx";
import { KatasPage, KataPage } from "./pages/Kata.tsx";
import { ProjectHome, StagePage } from "./pages/Project.tsx";
import { DesignsPage, DesignPage } from "./pages/Designs.tsx";
import { BUILD_PROJECTS } from "./data/projects-build.ts";
import type { BuildState } from "./lib/types.ts";
import { useDev } from "./lib/store.ts";

function Layout({ children }: { children: ReactNode }) {
  useSound();
  return <div className="dp-root flex min-h-full flex-1 flex-col">{children}</div>;
}

function Widget() {
  const dev = useDev();
  if (dev.loading) return null;
  const goal = Math.min(1, dev.todayXp / dev.settings.goal);
  return (
    <Link to="/" className="dp-root -m-4 flex h-[calc(100%+2rem)] flex-col justify-between rounded-[inherit] p-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-extrabold">
          {dev.rank.rank.icon} <span className="dp-grad-text">{dev.rank.rank.title}</span>
        </div>
        <div className="text-sm font-bold">
          <span className={cn(dev.streak > 0 && "dp-flame")}>🔥</span> {dev.streak}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-[var(--dp-muted)]">
          <span>цель дня</span>
          <span>{dev.todayXp}/{dev.settings.goal} XP</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[#1b2440]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#22d3ee]" style={{ width: `${goal * 100}%` }} />
        </div>
        <div className="mt-2 text-xs text-[var(--dp-muted)]">
          🔁 {dev.due.length + dev.fresh.length} карточек · {goal >= 1 ? "цель выполнена ✅" : "пора учиться →"}
        </div>
      </div>
    </Link>
  );
}

/** Сводка для главной хаба: этап проекта. */
function useSummary(): ModuleSummary | null {
  const builds = useCollection<BuildState>("builds");
  if (builds.loading) return null;
  const p = BUILD_PROJECTS[0];
  const state = builds.items.find((b) => b.id === p.id);
  const n = state?.stage ?? 1;
  const title = p.roadmap.find((r) => r.n === n)?.title;
  return { value: `${state?.finished.length ?? 0}/${p.roadmap.length}`, text: state ? `${p.title}: ${title}` : `${p.title}: не начат` };
}

export default defineModule({
  routes: {
    "/": ProjectHome,
    "/build/:project/:n": StagePage,
    "/train": WorkshopPage,
    "/designs": DesignsPage,
    "/design/:id": DesignPage,
    "/learn": Today,
    "/mission/:id": MissionPage,
    "/katas": KatasPage,
    "/kata/:id": KataPage,
    "/map": MapPage,
    "/track/:id": TrackPage,
    "/topic/:id": TopicPage,
    "/topic/:id/lesson": LessonPage,
    "/practice/:id": PracticePage,
    "/bug/:id": BugPage,
    "/question/:id": QuestionPage,
    "/boss/:id": BossPage,
    "/blitz": BlitzPage,
    "/arena": ArenaPage,
    "/review": ReviewPage,
    "/mentor": MentorPage,
    "/chat/:id": ChatPage,
    "/profile": ProfilePage,
    "/quiz/:id": TestPage,
    "/mistakes": MistakesPage,
    "/mixed": MixedPage,
    "/placement/:id": PlacementPage,
    "/projects": ProjectsPage,
    "/project/:id": ProjectPage,
    "/goal": GoalPage,
    "*": ProjectHome,
  },
  nav: [
    { to: "/", label: "Проект", icon: "🏗️" },
    { to: "/train", label: "Тренировка", icon: "🎯" },
    { to: "/map", label: "Справочник", icon: "📚" },
    { to: "/profile", label: "Профиль", icon: "👤" },
  ],
  widgets: {
    today: { title: "DevPath", size: "sm", component: Widget },
  },
  summary: useSummary,
  layout: Layout,
  theme: "dark",
});
