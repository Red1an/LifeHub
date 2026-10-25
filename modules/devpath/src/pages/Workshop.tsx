import { Link, Loading, cn, plural, useCollection, useStore } from "@lifehub/sdk";
import { KATAS, KIND_TITLE, LEVEL_TITLE, MISSIONS } from "../data/workshop.ts";
import { kataOfDay } from "../lib/workshop.ts";
import { useDev } from "../lib/store.ts";
import type { KataState, MissionState, WorkshopEnv } from "../lib/types.ts";
import { Screen, Panel, Pill, Bar, Tile } from "../components/kit.tsx";

const STAGE: Record<MissionState["stage"], { label: string; color: string }> = {
  work: { label: "в работе", color: "#22d3ee" },
  debrief: { label: "разбор", color: "#fbbf24" },
  done: { label: "пройдена", color: "#34d399" },
};

/** Тренировка: короткие миссии (чужой код с проблемой) и каты руками — разминка между этапами проекта. */
export function WorkshopPage() {
  const dev = useDev();
  const missions = useCollection<MissionState>("missions");
  const katas = useCollection<KataState>("katas");
  const [env] = useStore<WorkshopEnv | null>("env", null);
  if (missions.loading || katas.loading || dev.loading) return <Screen><Loading /></Screen>;

  const mState = new Map(missions.items.map((m) => [m.id, m]));
  const kState = new Map(katas.items.map((k) => [k.id, k]));
  const current = missions.items.filter((m) => m.stage !== "done").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const currentMission = current && MISSIONS.find((m) => m.id === current.id);
  const next = MISSIONS.find((m) => !mState.get(m.id));
  const kata = kataOfDay(kState);
  const doneMissions = MISSIONS.filter((m) => mState.get(m.id)?.stage === "done").length;
  const solvedKatas = KATAS.filter((k) => kState.get(k.id)?.solvedAt).length;

  return (
    <Screen>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--dp-muted)]">Короткие задачи между этапами проекта</div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="dp-grad-text">Тренировка</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="#fb923c" className="!px-3 !py-1.5 !text-sm">
            <span className={cn(dev.streak > 0 && "dp-flame")}>🔥</span> {dev.streak}
          </Pill>
          <Pill color="#fbbf24" className="!px-3 !py-1.5 !text-sm">⚡ {dev.xp}</Pill>
        </div>
      </div>

      <EnvWarning env={env} />

      {/* Что делать сейчас */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {currentMission ? (
          <Link to={`/mission/${currentMission.id}`} className="dp-panel dp-glow block p-4 transition hover:-translate-y-0.5">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Продолжить миссию</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-bold">
              <span className="text-2xl">{currentMission.icon}</span> {currentMission.title}
            </div>
            <div className="mt-1 text-sm text-[var(--dp-muted)]">
              {current.last ? `тесты ${current.last.passed}/${current.last.total}` : "ещё не проверял"} · {STAGE[current.stage].label}
            </div>
          </Link>
        ) : next ? (
          <Link to={`/mission/${next.id}`} className="dp-panel dp-glow block p-4 transition hover:-translate-y-0.5">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Следующая миссия</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-bold">
              <span className="text-2xl">{next.icon}</span> {next.title}
            </div>
            <div className="mt-1 text-sm text-[var(--dp-muted)]">{next.skills}</div>
          </Link>
        ) : (
          <Panel>
            <div className="font-bold">Все миссии пройдены 🏆</div>
            <div className="text-sm text-[var(--dp-muted)]">Новые появятся в следующих версиях модуля.</div>
          </Panel>
        )}
        {kata && (
          <Link to={`/kata/${kata.id}`} className="dp-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-gold)]">
              Ката дня · руками, без подсказок
            </div>
            <div className="mt-1 text-lg font-bold">⌨️ {kata.title}</div>
            <div className="mt-1 text-sm text-[var(--dp-muted)]">
              ~{kata.minutes} мин · {kState.get(kata.id)?.solvedAt ? "повтор: решал больше недели назад" : "новая"}
            </div>
          </Link>
        )}
      </div>

      <Panel className="mb-6 !p-3">
        <div className="flex items-center justify-between text-sm">
          <span>Миссии <b>{doneMissions}/{MISSIONS.length}</b></span>
          <span>Каты <b>{solvedKatas}/{KATAS.length}</b></span>
        </div>
        <Bar value={(doneMissions + solvedKatas) / (MISSIONS.length + KATAS.length)} className="mt-2" color="linear-gradient(90deg,#8b5cf6,#22d3ee)" />
      </Panel>

      <HowItWorks shown={missions.items.length > 0} />

      {([1, 2, 3] as const).map((level) => {
        const list = MISSIONS.filter((m) => m.level === level);
        if (!list.length) return null;
        return (
          <section key={level} className="mb-6">
            <h2 className="mb-2 text-lg font-bold">
              {LEVEL_TITLE[level]} <span className="text-sm font-normal text-[var(--dp-muted)]">· {list.length} {plural(list.length, ["миссия", "миссии", "миссий"])}</span>
            </h2>
            <div className="space-y-2">
              {list.map((m) => {
                const s = mState.get(m.id);
                return (
                  <Link key={m.id} to={`/mission/${m.id}`} className={cn("dp-panel flex items-center gap-3 p-3 transition hover:-translate-y-0.5", s?.stage === "done" && "opacity-70")}>
                    <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--dp-panel-2)] text-2xl">{s?.stage === "done" ? "✅" : m.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{m.title}</div>
                      <div className="truncate text-xs text-[var(--dp-muted)]">
                        {KIND_TITLE[m.kind].icon} {KIND_TITLE[m.kind].label} · ~{m.minutes} мин · {m.skills}
                      </div>
                    </div>
                    {s && <Pill color={STAGE[s.stage].color}>{STAGE[s.stage].label}</Pill>}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <h2 className="mb-3 mt-2 text-lg font-bold">Ещё</h2>
      <div className="grid grid-cols-2 gap-3">
        <Tile to="/designs" icon="🏛️" title="Проектирование" text="System Design: лента, чат, такси, билеты" color="#34d399" />
        <Tile to="/katas" icon="⌨️" title="Все каты" text={`${solvedKatas} из ${KATAS.length} решено`} color="#fbbf24" />
        <Tile to="/review" icon="🔁" title="Карточки" text={`${dev.due.length + dev.fresh.length} к повторению`} color="#8b5cf6" />
        <Tile to="/arena" icon="⚔️" title="Арена" text="Блиц, баги, боссы" color="#f43f5e" />
        <Tile to="/mentor" icon="💬" title="Собеседование" text="Пробное интервью с наставником" color="#22d3ee" />
      </div>
    </Screen>
  );
}

function EnvWarning({ env }: { env: WorkshopEnv | null }) {
  if (!env) {
    return (
      <Panel className="mb-5 border-[var(--dp-gold)]/40 text-sm">
        <div className="font-semibold text-[var(--dp-gold)]">Хаб ещё не проверил компьютер</div>
        <div className="mt-1 text-[var(--dp-muted)]">
          Миссии проверяет хаб: он запускает тесты на компьютере, где работает. Если сообщение не пропадает — перезапусти хаб (Настройки хаба → Перезапуск).
        </div>
      </Panel>
    );
  }
  const missing = [!env.dotnet && ".NET SDK (dotnet)", !env.git && "git"].filter(Boolean);
  if (!missing.length) return null;
  return (
    <Panel className="mb-5 border-[var(--dp-red)]/40 text-sm">
      <div className="font-semibold text-[var(--dp-red)]">На компьютере с хабом нет: {missing.join(", ")}</div>
      <div className="mt-1 text-[var(--dp-muted)]">Без этого миссии и каты не проверить. Установи и перезапусти хаб.</div>
    </Panel>
  );
}

function HowItWorks({ shown }: { shown: boolean }) {
  return (
    <details className="dp-panel mb-6 p-4" open={!shown}>
      <summary className="cursor-pointer font-bold">Как это устроено</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--dp-muted)]">
        <li><b className="text-white">Миссия</b> — маленький готовый проект с проблемой: что-то тормозит, падает или считает неверно. Тесты хаба показывают, что именно.</li>
        <li>Сначала <b className="text-white">гипотеза</b>: в чём причина и как бы ты решил. Даже неверная — это и есть тренировка мышления.</li>
        <li>Код пишешь в своём редакторе (VS Code). Тема незнакомая — «Минимум, чтобы начать» с разобранным примером. Застрял — подсказки по ступенькам и наставник, который наводит, но не решает.</li>
        <li>Тесты зелёные — <b className="text-white">разбор «почему»</b>: альтернативы, когда твоё решение плохое, вопросы на понимание. Выводы попадают в карточки повторения.</li>
        <li><b className="text-white">Ката</b> — 15–30 минут кода руками в редакторе модуля: без автодополнения и нейронки. Возвращает навык писать самому.</li>
      </ol>
    </details>
  );
}
