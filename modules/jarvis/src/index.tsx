import { Link, defineModule } from "@lifehub/sdk";
import "./styles.css";
import { Orb, statusLine } from "./components/hud.tsx";
import { useChat, useStatus } from "./lib/store.ts";
import { Brief } from "./pages/Brief.tsx";
import { Chat } from "./pages/Chat.tsx";
import { Commands } from "./pages/Commands.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Setup } from "./pages/Setup.tsx";

/** Виджет на главной: состояние и последняя фраза колонке. */
function StatusWidget() {
  const { status } = useStatus();
  const chat = useChat();
  const last = [...chat.items].reverse().find((m) => m.source === "alice");
  const l = statusLine(status);
  return (
    <Link to="/" className="jarvis-root flex h-full items-center gap-3 rounded-[inherit] p-3">
      <Orb size={40} state={l.tone === "off" ? "off" : "on"} />
      <div className="min-w-0">
        <div className="jarvis-title font-semibold text-white">Джарвис</div>
        <div className="truncate text-xs text-[#8fb3c7]">{l.text}</div>
        {last && <div className="mt-1 truncate text-xs text-[#bfe2f3]">«{last.q}»</div>}
      </div>
    </Link>
  );
}

export default defineModule({
  routes: {
    "/": Chat,
    "/setup": Setup,
    "/brief": Brief,
    "/commands": Commands,
    "/settings": Settings,
    "*": Chat,
  },
  nav: [
    { to: "/", label: "Разговор", icon: "💬" },
    { to: "/setup", label: "Подключение", icon: "🔌" },
    { to: "/brief", label: "Сводки", icon: "☀️" },
    { to: "/commands", label: "Команды", icon: "⚡" },
    { to: "/settings", label: "Настройки", icon: "⚙️" },
  ],
  widgets: {
    status: { title: "Джарвис", size: "sm", component: StatusWidget },
  },
  theme: "dark",
});
