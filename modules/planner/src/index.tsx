import { useMemo, type ReactNode } from "react";
import { defineModule, Link, dayKey } from "@lifehub/sdk";
import "./styles.css";
import { WeekPage } from "./pages/Week.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { useEvents } from "./lib/gcal.ts";
import { hhmm, shiftKey, fromKey } from "./lib/time.ts";

function Layout({ children }: { children: ReactNode }) {
  return <div className="pl-root flex min-h-full flex-1 flex-col">{children}</div>;
}

/** Виджет: что дальше сегодня. */
function TodayWidget() {
  const today = dayKey();
  const from = useMemo(() => fromKey(today), [today]);
  const to = useMemo(() => fromKey(shiftKey(today, 1)), [today]);
  const { events, google } = useEvents(from, to);
  const now = Date.now();
  const next = events?.filter((e) => e.end.getTime() > now) ?? [];
  return (
    <Link to="/" className="pl-root -m-4 flex h-[calc(100%+2rem)] flex-col rounded-[inherit] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="pl-title">🗓️ Сегодня</span>
        {events && <span className="pl-muted text-xs">{next.length ? `ещё ${next.length}` : "всё"}</span>}
      </div>
      {!google?.connected ? (
        <div className="pl-muted text-sm">Подключите Google в настройках хаба</div>
      ) : !events ? (
        <div className="pl-muted text-sm">Загрузка…</div>
      ) : !next.length ? (
        <div className="pl-muted text-sm">На сегодня событий больше нет 🌙</div>
      ) : (
        <div className="space-y-1.5 overflow-hidden">
          {next.slice(0, 3).map((e) => (
            <div key={e.calendarId + e.id} className="flex items-center gap-2 text-sm">
              <span className="h-4 w-1 flex-none rounded" style={{ background: e.color }} />
              <span className="pl-muted w-11 flex-none tabular-nums">{e.allDay ? "день" : hhmm(e.start)}</span>
              <span className="truncate">{e.title}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

export default defineModule({
  routes: {
    "/": WeekPage,
    "/ask": AskPage,
    "/settings": SettingsPage,
    "*": WeekPage,
  },
  nav: [
    { to: "/", label: "Неделя", icon: "🗓️" },
    { to: "/ask", label: "Запланировать", icon: "✨" },
    { to: "/settings", label: "Настройки", icon: "⚙️" },
  ],
  widgets: {
    today: { title: "Расписание", size: "sm", component: TodayWidget },
  },
  layout: Layout,
  theme: "dark",
});
