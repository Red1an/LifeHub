import { useMemo, useState, type ReactNode } from "react";
import { Link, defineModule, toast, useCollection, useStore } from "@lifehub/sdk";
import "./prose.css";
import "./styles.css";
import { InboxPage } from "./pages/Inbox.tsx";
import { AreaPage, CollectionPage, ShelfPage, ShelvesPage } from "./pages/Shelves.tsx";
import { WordsPage } from "./pages/Words.tsx";
import { TopicPage, TopicsPage } from "./pages/Topics.tsx";
import { GraphPage } from "./pages/Graph.tsx";
import { ReviewPage } from "./pages/Review.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { NotePage } from "./pages/Note.tsx";
import { AllPage } from "./pages/All.tsx";
import { DaysPage } from "./pages/Days.tsx";
import { MicButton, useDictation } from "./components/input.tsx";
import { localReview, type ReviewCache } from "./lib/review.ts";
import { useSyncPlanDone } from "./lib/planner.ts";
import type { Note, Topic } from "./lib/types.ts";

function Layout({ children }: { children: ReactNode }) {
  const notes = useCollection<Note>("notes");
  // «Сделал» в Расписании закрывает дело и здесь.
  useSyncPlanDone(notes.items);
  return <div className="nt-root flex min-h-full flex-1 flex-col">{children}</div>;
}

/** Виджет: быстрый ввод в воронку прямо с главной хаба + что всплыло. */
function FunnelWidget() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const [cache] = useStore<ReviewCache | null>("review", null);
  const [text, setText] = useState("");
  const [voiceUsed, setVoiceUsed] = useState(false);
  const voice = useDictation(text, (t) => (setText(t), setVoiceUsed(true)));
  const inbox = notes.items.filter((n) => n.status === "inbox").length;
  const groups = useMemo(() => localReview(notes.items, topics.items).filter((g) => g.key !== "inbox"), [notes.items, topics.items]);
  const finding = cache?.findings[0];
  const hint = finding ? `🔭 ${finding.title}` : groups[0] ? `${groups[0].icon} ${groups[0].title}${groups[0].notes ? `: ${groups[0].notes.length}` : ""}` : null;

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    if (voice.listening) voice.stop();
    setText("");
    await notes.add({ title: "", body, tags: [], pinned: false, status: "inbox", source: voiceUsed ? "voice" : "text", capturedAt: Date.now() });
    setVoiceUsed(false);
    toast("В воронке", "success");
  };

  return (
    <div className="nt-root -m-4 flex h-[calc(100%+2rem)] flex-col gap-2 rounded-[inherit] p-4">
      <Link to="/" className="flex items-center justify-between">
        <span className="nt-serif font-semibold">📝 Заметки</span>
        {inbox > 0 && <span className="rounded-full bg-[var(--nt-accent)] px-2 py-0.5 text-xs font-semibold text-white">🌀 {inbox}</span>}
      </Link>
      <div className="nt-capture flex items-center gap-1 !rounded-full p-1">
        <input
          className="nt-input min-w-0 flex-1 px-2.5 !text-sm"
          placeholder={voice.listening ? "Слушаю…" : "Мысль, ссылка, что угодно…"}
          value={voice.interim ? `${text} ${voice.interim}` : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
        />
        {voice.supported && !text.trim() && <MicButton listening={voice.listening} onClick={voice.toggle} className="!h-8 !w-8 !text-sm" />}
        {!!text.trim() && (
          <button type="button" className="nt-btn nt-btn-sm !h-8 !w-8 !px-0" aria-label="В воронку" onClick={add}>
            ↑
          </button>
        )}
      </div>
      {hint && (
        <Link to="/review" className="nt-muted line-clamp-2 text-xs">
          {hint}
        </Link>
      )}
    </div>
  );
}

export default defineModule({
  routes: {
    "/": InboxPage,
    "/shelves": ShelvesPage,
    "/shelves/:id": ShelfPage,
    "/c/:id": CollectionPage,
    "/topics": TopicsPage,
    "/t/:id": TopicPage,
    "/graph": GraphPage,
    "/ask": AskPage,
    "/review": ReviewPage,
    "/n/:id": NotePage,
    "/all": AllPage,
    "/days": DaysPage,
    "/words": WordsPage,
    "/area/:id": AreaPage,
    "*": InboxPage,
  },
  nav: [
    { to: "/", label: "Воронка", icon: "🌀" },
    { to: "/shelves", label: "Полки", icon: "🗄️" },
    { to: "/topics", label: "Проекты", icon: "🚀" },
    { to: "/ask", label: "Спросить", icon: "💬" },
    { to: "/review", label: "Обзор", icon: "🔭" },
  ],
  widgets: {
    recent: { title: "Заметки", component: FunnelWidget },
  },
  layout: Layout,
});
