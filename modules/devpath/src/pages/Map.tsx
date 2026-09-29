import { Link, Loading, useParams, cn, toast } from "@lifehub/sdk";
import { TRACKS, trackById, LEVEL_NAMES } from "../data/curriculum.ts";
import { useDev, useSettings } from "../lib/store.ts";
import { Screen, Header, Panel, Ring, Pill, Bar } from "../components/kit.tsx";

export function MapPage() {
  const dev = useDev();
  const [settings, setSettings] = useSettings();
  if (dev.loading) return <Screen><Loading /></Screen>;

  const toggleFocus = (id: string) => {
    const has = settings.focus.includes(id);
    setSettings({ ...settings, focus: has ? settings.focus.filter((x) => x !== id) : [...settings.focus, id] });
    toast(has ? "Убрано из фокуса" : "Добавлено в фокус: уроки будут в заданиях дня", "success");
  };

  return (
    <Screen wide>
      <Header title="Карта знаний" subtitle="⭐ — треки в фокусе: из них собираются уроки дня" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKS.map((tr, k) => {
          const done = tr.topics.filter((t) => dev.state(t.id)?.status === "done").length;
          const started = tr.topics.filter((t) => dev.state(t.id)).length;
          const mastery = tr.topics.reduce((n, t) => n + (dev.state(t.id)?.mastery ?? 0), 0) / tr.topics.length / 100;
          const focus = settings.focus.includes(tr.id);
          return (
            <div key={tr.id} className="dp-panel dp-slide relative overflow-hidden" style={{ animationDelay: `${k * 40}ms` }}>
              <div className="absolute -right-10 -top-10 size-32 rounded-full opacity-20 blur-2xl" style={{ background: tr.color }} />
              <Link to={`/track/${tr.id}`} className="flex gap-3 p-4">
                <Ring value={mastery} size={58} color={tr.color}>
                  <span className="text-2xl">{tr.icon}</span>
                </Ring>
                <div className="min-w-0 flex-1 pr-6">
                  <div className="font-bold">{tr.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-[var(--dp-muted)]">{tr.description}</div>
                  <div className="mt-2 flex gap-1.5">
                    <Pill color={tr.color}>{done}/{tr.topics.length} тем</Pill>
                    {started > done && <Pill>изучается {started - done}</Pill>}
                  </div>
                </div>
              </Link>
              <button
                className={cn("absolute right-3 top-3 text-xl transition", focus ? "" : "opacity-30 grayscale hover:opacity-70")}
                onClick={() => toggleFocus(tr.id)}
                aria-label="В фокус"
              >
                ⭐
              </button>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

export function TrackPage() {
  const { id } = useParams();
  const dev = useDev();
  const tr = trackById(id ?? "");
  if (!tr) return <Screen><Header title="Трек не найден" back="/map" /></Screen>;
  if (dev.loading) return <Screen><Loading /></Screen>;

  const done = tr.topics.filter((t) => dev.state(t.id)?.status === "done").length;
  let currentFound = false;

  return (
    <Screen>
      <Header title={<span>{tr.icon} {tr.title}</span>} subtitle={tr.description} back="/map" />
      <Panel className="mb-6">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-[var(--dp-muted)]">Пройдено тем</span>
          <b>{done} / {tr.topics.length}</b>
        </div>
        <Bar value={done / tr.topics.length} color={tr.color} />
        <Link to={`/placement/${tr.id}`} className="dp-btn dp-btn-ghost mt-3 !min-h-9 w-full text-sm">
          🧭 Входной тест — пропустить то, что уже знаю
        </Link>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--dp-cyan)]">📚 Лучшие внешние материалы</summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {tr.resources.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer" className="underline decoration-[var(--dp-line)] underline-offset-2 hover:text-[var(--dp-cyan)]">
                  {r.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      </Panel>

      {/* Дерево навыков: путь из узлов */}
      <div className="relative pl-2">
        <div className="absolute bottom-6 left-[34px] top-6 w-1 rounded-full bg-[#1b2440]" />
        {tr.topics.map((t, k) => {
          const st = dev.state(t.id);
          const isCurrent = !currentFound && st?.status !== "done";
          if (isCurrent) currentFound = true;
          const offset = [0, 18, 30, 18][k % 4];
          return (
            <Link key={t.id} to={`/topic/${t.id}`} className="dp-slide relative mb-3 flex items-center gap-4" style={{ animationDelay: `${k * 35}ms` }}>
              <div
                className={cn("relative z-[1] grid size-14 shrink-0 place-items-center rounded-full border-4 text-xl font-bold transition", isCurrent && "dp-pulse")}
                style={{
                  borderColor: st?.status === "done" ? tr.color : isCurrent ? "var(--dp-violet)" : "#232d4d",
                  background: st?.status === "done" ? `${tr.color}33` : "var(--dp-panel)",
                }}
              >
                {st?.status === "done" ? "✓" : st ? "◐" : k + 1}
              </div>
              <div className="dp-panel min-w-0 flex-1 p-3 transition hover:-translate-y-0.5" style={{ marginLeft: offset }}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{t.title}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--dp-muted)]">{t.summary}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Pill color={t.level === 1 ? "#34d399" : t.level === 2 ? "#60a5fa" : "#f472b6"}>{LEVEL_NAMES[t.level]}</Pill>
                  {st && <Bar value={(st.mastery ?? 0) / 100} className="w-20" height={6} color={tr.color} />}
                </div>
              </div>
            </Link>
          );
        })}
        <Link to={`/boss/${tr.id}`} className="relative flex items-center gap-4">
          <div className="relative z-[1] grid size-14 shrink-0 place-items-center rounded-full border-4 border-[#f43f5e] bg-[#2a0f16] text-2xl">👹</div>
          <div className="dp-panel flex-1 p-3">
            <div className="font-bold">Босс трека</div>
            <div className="text-xs text-[var(--dp-muted)]">Экзамен по пройденным темам · 3 жизни · +100 XP</div>
          </div>
        </Link>
      </div>
    </Screen>
  );
}
