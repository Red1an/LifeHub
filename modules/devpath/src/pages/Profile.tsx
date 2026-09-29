import { useEffect } from "react";
import { Heatmap, Loading, useCollection, useStore, cn } from "@lifehub/sdk";
import { PROJECTS } from "../data/projects.ts";
import type { ProjectState } from "../lib/types.ts";
import { TRACKS } from "../data/curriculum.ts";
import { useDev, useSettings } from "../lib/store.ts";
import { achievements, bestStreak, RANKS } from "../lib/game.ts";
import { setSound } from "../lib/sfx.ts";
import { Screen, Header, Panel, Bar, Pill } from "../components/kit.tsx";

export function useSound() {
  const [on, setOn] = useStore("sound", true);
  useEffect(() => setSound(on), [on]);
  return [on, setOn] as const;
}

export function ProfilePage() {
  const dev = useDev();
  const [settings, setSettings] = useSettings();
  const [sound, setSoundOn] = useSound();
  const projects = useCollection<ProjectState>("projects");
  if (dev.loading) return <Screen><Loading /></Screen>;

  const best = bestStreak(dev.byDay, settings.goal);
  const doneTopics = dev.topics.items.filter((t) => t.status === "done").length;
  const tracksStarted = new Set(dev.topics.items.map((t) => TRACKS.find((tr) => tr.topics.some((x) => x.id === t.id))?.id)).size;
  const ach = achievements({ log: dev.log.items, xp: dev.xp, best, doneTopics, learnedCards: dev.learned, tracksStarted,
    projectsDone: PROJECTS.filter((p) => (projects.items.find((x) => x.id === p.id)?.done.length ?? 0) >= p.stages.length).length,
  });
  const { rank, next, progress, index } = dev.rank;
  const week = Object.entries(dev.byDay).filter(([d]) => Date.now() - new Date(d).getTime() < 7 * 86400000).reduce((n, [, v]) => n + v, 0);

  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) => setSettings({ ...settings, [k]: v });

  return (
    <Screen>
      <Header title="👤 Профиль" subtitle="Прогресс, достижения и настройки обучения" />

      <Panel glow className="mb-4 text-center">
        <div className="text-6xl">{rank.icon}</div>
        <div className="mt-1 text-2xl font-extrabold">{rank.title}</div>
        <div className="text-sm text-[var(--dp-muted)]">{dev.xp} XP</div>
        <Bar value={progress} className="mx-auto mt-3 max-w-sm" color="linear-gradient(90deg,#8b5cf6,#22d3ee)" />
        <div className="mt-1 text-xs text-[var(--dp-muted)]">{next ? `следующий: ${next.icon} ${next.title} — ${next.xp} XP` : "вершина"}</div>
        <div className="mt-4 flex justify-center gap-1 text-xl">
          {RANKS.map((r, k) => (
            <span key={r.title} title={`${r.title} · ${r.xp} XP`} className={cn(k > index && "opacity-20 grayscale")}>{r.icon}</span>
          ))}
        </div>
      </Panel>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["🔥", dev.streak, "серия дней"],
          ["🏅", best, "лучшая серия"],
          ["📚", doneTopics, "тем освоено"],
          ["🧠", dev.learned, "карточек надолго"],
          ["⚡", week, "XP за неделю"],
          ["🃏", dev.cards.items.length, "карточек всего"],
          ["🛠️", dev.log.items.filter((e) => e.kind === "practice").length, "задач решено"],
          ["👹", dev.log.items.filter((e) => e.kind === "boss" && (e.score ?? 0) >= 80).length, "боссов побеждено"],
        ].map(([icon, v, label]) => (
          <Panel key={String(label)} className="!p-3 text-center">
            <div className="text-xl">{icon}</div>
            <div className="text-2xl font-extrabold">{v}</div>
            <div className="text-xs text-[var(--dp-muted)]">{label}</div>
          </Panel>
        ))}
      </div>

      <Panel className="mb-4">
        <div className="mb-3 font-bold">Активность</div>
        <Heatmap values={dev.byDay} weeks={20} />
      </Panel>

      <Panel className="mb-4">
        <div className="mb-3 font-bold">Треки</div>
        <div className="space-y-3">
          {TRACKS.map((tr) => {
            const done = tr.topics.filter((t) => dev.state(t.id)?.status === "done").length;
            const mastery = tr.topics.reduce((n, t) => n + (dev.state(t.id)?.mastery ?? 0), 0) / tr.topics.length;
            return (
              <div key={tr.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{tr.icon} {tr.title}</span>
                  <span className="text-[var(--dp-muted)]">{done}/{tr.topics.length} · {Math.round(mastery)}%</span>
                </div>
                <Bar value={mastery / 100} color={tr.color} height={8} />
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="mb-4">
        <div className="mb-3 font-bold">Достижения · {ach.filter((a) => a.done).length}/{ach.length}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ach.map((a) => (
            <div key={a.id} className={cn("flex items-center gap-2 rounded-2xl border p-2.5", a.done ? "border-[var(--dp-gold)]/40 bg-[var(--dp-gold)]/10" : "border-[var(--dp-line)] opacity-50")}>
              <div className={cn("text-2xl", !a.done && "grayscale")}>{a.icon}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{a.title}</div>
                <div className="truncate text-xs text-[var(--dp-muted)]">{a.text}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="mb-4">
        <div className="mb-3 font-bold">⚙️ Настройки обучения</div>

        <div className="mb-1 text-sm font-semibold">Треки в фокусе</div>
        <div className="mb-1 text-xs text-[var(--dp-muted)]">Из них каждый день берётся новый урок — по кругу.</div>
        <div className="mb-4 flex flex-wrap gap-2">
          {TRACKS.map((t) => {
            const on = settings.focus.includes(t.id);
            return (
              <button
                key={t.id}
                className={cn("rounded-full border px-3 py-1.5 text-sm transition", on ? "border-[var(--dp-violet)] bg-[var(--dp-violet)]/20" : "border-[var(--dp-line)] text-[var(--dp-muted)]")}
                onClick={() => set("focus", on ? settings.focus.filter((x) => x !== t.id) : [...settings.focus, t.id])}
              >
                {t.icon} {t.title}
              </button>
            );
          })}
        </div>

        <div className="mb-1 text-sm font-semibold">Мой уровень</div>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((l) => (
            <button key={l} className="dp-option !p-2.5 text-center text-sm" data-state={settings.level === l ? "selected" : undefined} onClick={() => set("level", l)}>
              {l === 1 ? "🐣 Junior" : l === 2 ? "🦊 Middle" : "🦅 Senior"}
            </button>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="mb-1 font-semibold">Цель дня, XP</div>
            <select className="dp-input" value={settings.goal} onChange={(e) => set("goal", Number(e.target.value))}>
              {[30, 60, 100, 150, 250].map((v) => (
                <option key={v} value={v}>{v} {v === 30 ? "— лёгкая" : v === 60 ? "— обычная" : v === 100 ? "— серьёзная" : v === 150 ? "— интенсив" : "— хардкор"}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 font-semibold">Новых карточек в день</div>
            <select className="dp-input" value={settings.newCards} onChange={(e) => set("newCards", Number(e.target.value))}>
              {[5, 10, 15, 20, 30].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>

        <label className="text-sm">
          <div className="mb-1 font-semibold">О себе — для нейронки</div>
          <textarea
            key={settings.about}
            className="dp-input min-h-20"
            placeholder="Например: 3 года на .NET, пишу бэкенд на ASP.NET Core + EF, хочу в highload и архитектуру, слабо знаю Kubernetes"
            defaultValue={settings.about}
            onBlur={(e) => e.target.value !== settings.about && set("about", e.target.value)}
          />
        </label>

        <label className="mt-4 flex items-center justify-between text-sm">
          <span className="font-semibold">🔊 Звуки</span>
          <input type="checkbox" className="size-5 accent-[var(--dp-violet)]" checked={sound} onChange={(e) => setSoundOn(e.target.checked)} />
        </label>
      </Panel>

      <div className="text-center text-xs text-[var(--dp-muted)]">
        <Pill>DevPath</Pill> Ранги: {RANKS.map((r) => r.title).join(" → ")}
      </div>
    </Screen>
  );
}
