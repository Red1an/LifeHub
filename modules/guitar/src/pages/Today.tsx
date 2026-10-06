import { useState } from "react";
import { cn, Link, plural, useNavigate } from "@lifehub/sdk";
import { Panel, Screen, Section, Tile } from "../components/kit";
import { STATUS_RU, useLibrary } from "../lib/songs";
import { currentStreak, dayKey, loadDayLog } from "../lib/train-stats";
import { stepTitle, useLearn } from "./Learn";
import { PlanList } from "./Train";

const GREET = () => {
  const h = new Date().getHours();
  return h < 6 ? "Ночной джем" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
};

export function TodayPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const log = loadDayLog();
  const streak = currentStreak(log);
  const today = log[dayKey()]?.length ?? 0;
  const lib = useLibrary();
  const learn = useLearn();
  const path = learn.current;
  const next = learn.nextStep(path);
  const learning = lib.songs.filter((s) => lib.meta.get(s.id)?.status === "learning").slice(0, 4);

  return (
    <Screen>
      <div className="gt-hero mb-5 p-5">
        <div className="relative z-10">
          <div className="text-sm font-semibold opacity-75">{GREET()}</div>
          <div className="gt-display mt-0.5 text-3xl font-bold uppercase leading-none">Гитара</div>
          <div className="mt-3 flex items-end gap-5">
            <div>
              <div className="gt-num text-4xl font-bold leading-none">
                <span className={cn(streak > 0 && "gt-flame")}>🔥</span>
                {streak}
              </div>
              <div className="text-xs font-semibold opacity-75">{plural(streak, ["день", "дня", "дней"])} подряд</div>
            </div>
            <div>
              <div className="gt-num text-4xl font-bold leading-none">{today}</div>
              <div className="text-xs font-semibold opacity-75">занятий сегодня</div>
            </div>
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/songs?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти песню…" className="min-w-0 flex-1 rounded-2xl border-0 bg-black/80 px-4 py-3 text-[var(--gt-fg)] outline-none placeholder:text-[#9b8b7d]" enterKeyHint="search" />
            <button className="gt-btn gt-btn-dark shrink-0">🔎</button>
          </form>
        </div>
      </div>

      {next && (
        <Link to={`/learn/${path.id}`} className="gt-panel group mb-3 flex items-center gap-4 p-4 transition hover:-translate-y-0.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in srgb, ${path.color} 18%, transparent)` }}>
            {path.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-wider" style={{ color: path.color }}>
              Продолжить · {path.title}
            </span>
            <span className="block truncate font-bold">{stepTitle(next)}</span>
            <span className="block text-xs text-[var(--gt-muted)]">
              {path.steps.filter((s) => learn.done.has(s.id)).length} из {path.steps.length} шагов
            </span>
          </span>
          <span className="text-xl text-[var(--gt-brass)] transition group-hover:translate-x-1">→</span>
        </Link>
      )}

      <PlanList compact />

      <Section title="Учу сейчас" right={<Link to="/songs" className="text-sm text-[var(--gt-brass)]">все песни →</Link>}>
        {learning.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {learning.map((s) => {
              const m = lib.meta.get(s.id);
              const checks = m?.checks?.length ?? 0;
              return (
                <Link key={s.id} to={`/song/${s.id}`} className="gt-panel flex items-center gap-3 !rounded-2xl p-3 transition hover:border-[var(--gt-brass)]">
                  <span className="text-xl">{STATUS_RU.learning.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{s.title}</span>
                    <span className="block truncate text-xs text-[var(--gt-muted)]">
                      {s.artist} · {checks}/5 шагов
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <Panel className="text-sm text-[var(--gt-muted)]">
            Найди песню, которую давно хотел сыграть, и отметь «🎸 Учу» — она появится здесь с разбором и планом.
          </Panel>
        )}
      </Section>

      <Section title="Быстро">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile to="/chords" icon="🎼" title="Аккорды" text="Любой аккорд и что за аккорд" color="var(--gt-brass)" />
          <Tile to="/tools?t=tuner" icon="🎚️" title="Тюнер" text="Настроить гитару" color="var(--gt-green)" />
          <Tile to="/train/jam" icon="🔥" title="Джем" text="Импровизация под минус" color="var(--gt-copper)" />
          <Tile to="/progress" icon="📈" title="Прогресс" text="Календарь и графики" color="var(--gt-sky)" />
        </div>
      </Section>
    </Screen>
  );
}

