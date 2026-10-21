import { Link, defineModule } from "@lifehub/sdk";
import "./styles.css";
import { Orb, voiceLine } from "./components/hud.tsx";
import { useChat, useVoice } from "./lib/store.ts";
import { Brief } from "./pages/Brief.tsx";
import { Chat } from "./pages/Chat.tsx";
import { Commands } from "./pages/Commands.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Setup } from "./pages/Setup.tsx";
import { Voice } from "./pages/Voice.tsx";

/** Виджет на главной: состояние голоса и последняя фраза. */
function StatusWidget() {
  const { voice } = useVoice();
  const chat = useChat();
  const last = [...chat.items].reverse().find((m) => m.q && m.source !== "hub");
  const l = voiceLine(voice);
  return (
    <Link to="/" className="jarvis-root flex h-full items-center gap-3 rounded-[inherit] p-3">
      <Orb size={40} state={l.busy ? "busy" : l.tone === "off" ? "off" : "on"} />
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
    "/voice": Voice,
    "/setup": Setup,
    "/brief": Brief,
    "/commands": Commands,
    "/settings": Settings,
    "*": Chat,
  },
  nav: [
    { to: "/", label: "Разговор", icon: "💬" },
    { to: "/voice", label: "Голос", icon: "🎙️" },
    { to: "/brief", label: "Сводки", icon: "☀️" },
    { to: "/commands", label: "Команды", icon: "⚡" },
    { to: "/settings", label: "Настройки", icon: "⚙️" },
  ],
  widgets: {
    status: { title: "Джарвис", size: "sm", component: StatusWidget },
  },
  theme: "dark",
});
