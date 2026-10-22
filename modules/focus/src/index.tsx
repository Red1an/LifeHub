import { defineModule, type ModuleSummary } from "@lifehub/sdk";
import { fmtMin, sessionMin, todayStart, useSessions } from "./lib/store";
import { Feed } from "./pages/Feed";
import { Watch } from "./pages/Watch";
import { Channels } from "./pages/Channels";
import { Stats } from "./pages/Stats";
import { Settings } from "./pages/Settings";

/** Плитка на главной: сколько сегодня ушло на отвлекающие сайты. */
function useSummary(): ModuleSummary | null {
  const sessions = useSessions();
  if (sessions.loading) return null;
  const today = sessions.items.filter((s) => s.startedAt >= todayStart());
  const total = today.reduce((a, s) => a + sessionMin(s), 0);
  if (!today.length) return { value: "0 мин", text: "на YouTube и Инсту сегодня" };
  const names = [...new Set(today.map((s) => s.siteName))].join(", ");
  return { value: fmtMin(total), text: `сегодня: ${names}` };
}

export default defineModule({
  routes: {
    "/": Feed,
    "/v/:id": Watch,
    "/channels": Channels,
    "/stats": Stats,
    "/settings": Settings,
    "*": Feed,
  },
  nav: [
    { to: "/", label: "Лента", icon: "📺" },
    { to: "/stats", label: "Время", icon: "⏱️" },
    { to: "/channels", label: "Каналы", icon: "📚" },
    { to: "/settings", label: "Настройки", icon: "⚙️" },
  ],
  summary: useSummary,
});
