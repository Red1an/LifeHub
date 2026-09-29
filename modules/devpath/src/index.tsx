import type { ReactNode } from "react";
import { defineModule, Link, cn } from "@lifehub/sdk";
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

export default defineModule({
  routes: {
    "/": Today,
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
    "*": Today,
  },
  nav: [
    { to: "/", label: "Сегодня", icon: "🎯" },
    { to: "/map", label: "Карта", icon: "🗺️" },
    { to: "/arena", label: "Арена", icon: "⚔️" },
    { to: "/mentor", label: "Наставник", icon: "💬" },
    { to: "/profile", label: "Профиль", icon: "👤" },
  ],
  widgets: {
    today: { title: "DevPath", size: "sm", component: Widget },
  },
  layout: Layout,
  theme: "dark",
});
