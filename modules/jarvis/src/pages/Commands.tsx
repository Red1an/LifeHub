import { useState } from "react";
import { Link, cn, toast, uid, useNavigate } from "@lifehub/sdk";
import { Panel, Screen } from "../components/hud.tsx";
import { action, say, usePrefs } from "../lib/store.ts";
import { PRESETS, STEPS, stepsOf, summary } from "../lib/steps.ts";
import { BUILTIN, type CustomCommand } from "../lib/types.ts";

/** Сценарии: фраза → цепочка шагов. Редактор — /commands/:id. */
export function Commands() {
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();
  const [showBuiltin, setShowBuiltin] = useState(false);

  const create = (base?: Omit<CustomCommand, "id">) => {
    const c: CustomCommand = base ? { ...structuredClone(base), id: uid() } : { id: uid(), phrases: [], say: "", run: [], steps: [] };
    update({ commands: [...prefs.commands, c] });
    navigate(`/commands/${c.id}`);
  };
  const toggle = (c: CustomCommand) => update({ commands: prefs.commands.map((x) => (x.id === c.id ? { ...x, off: !x.off } : x)) });
  const run = async (c: CustomCommand) => {
    await action({ kind: "scenario", id: c.id });
    toast(`Запускаю «${c.phrases[0] ?? "сценарий"}»`, "info");
  };
  const own = prefs.commands.filter((c) => !c.learned);
  const learned = prefs.commands.filter((c) => c.learned);
  const forget = (c: CustomCommand) => update({ commands: prefs.commands.filter((x) => x.id !== c.id) });
  const tryIt = async (q: string) => {
    await say(q);
    navigate("/");
  };

  return (
    <Screen
      title="Сценарии"
      subtitle="Фраза → цепочка шагов. Скажите «Джарвис» и фразу"
      right={
        <button className="jarvis-chip shrink-0" onClick={() => create()}>
          + Новый
        </button>
      }
    >
      {own.length > 0 && (
        <div className="space-y-2">
          {own.map((c) => {
            const steps = stepsOf(c);
            return (
              <div key={c.id} className={cn("jarvis-panel flex items-stretch gap-2 p-1.5 pl-3.5", c.off && "opacity-50")}>
                <Link to={`/commands/${c.id}`} className="min-w-0 flex-1 py-2">
                  <div className="truncate text-[15px] font-medium text-white">{c.phrases.length ? `«${c.phrases.join("», «")}»` : "Без фразы"}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {steps.length === 0 && <span className="text-xs text-[#7f9fb2]">пока ничего не делает</span>}
                    {steps.slice(0, 6).map((s, i) => (
                      <span key={i} className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded-md border border-[var(--jv-line)] bg-black/25 px-1.5 py-0.5 text-[11px] text-[#bfe2f3]">
                        <span>{STEPS[s.type].icon}</span>
                        <span className="truncate">{summary(s)}</span>
                      </span>
                    ))}
                    {steps.length > 6 && <span className="text-[11px] text-[#7f9fb2]">ещё {steps.length - 6}</span>}
                  </div>
                </Link>
                <div className="flex shrink-0 flex-col justify-center gap-1">
                  <button className="jarvis-chip !px-3 !py-1.5" disabled={c.off || !steps.length} onClick={() => run(c)} title="Запустить">
                    ▶
                  </button>
                  <button className="rounded-full px-2 py-1 text-[11px] text-[#7f9fb2] hover:text-white" onClick={() => toggle(c)}>
                    {c.off ? "вкл" : "выкл"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Panel
        title={`Выучено${learned.length ? ` · ${learned.length}` : ""}`}
        right={
          <button className="text-xs text-[#7cc8ec]" onClick={() => update({ learn: !prefs.learn })}>
            {prefs.learn ? "Не учиться" : "Учиться"}
          </button>
        }
      >
        {learned.length === 0 ? (
          <p className="text-sm text-[#8fb3c7]">
            {prefs.learn
              ? "Когда нейронка разберёт новую просьбу («включи атаку титанов»), Джарвис запомнит её здесь — и в следующий раз выполнит мгновенно, без нейронки."
              : "Обучение выключено."}
          </p>
        ) : (
          <div className="divide-y divide-[var(--jv-line)]">
            {learned.map((c) => {
              const steps = stepsOf(c);
              return (
                <div key={c.id} className="flex items-center gap-2 py-2">
                  <Link to={`/commands/${c.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[15px] text-white">«{c.phrases[0]}»</div>
                    <div className="truncate text-xs text-[#7f9fb2]">{steps.map((s) => `${STEPS[s.type].icon} ${summary(s)}`).join("  →  ")}</div>
                  </Link>
                  <button className="shrink-0 rounded-full px-2 py-1 text-[11px] text-[#7f9fb2] hover:text-[#ff9b8a]" onClick={() => forget(c)}>
                    забыть
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {learned.length > 0 && <p className="mt-2 text-xs text-[#7f9fb2]">Ошибся — нажмите «забыть» или откройте и поправьте шаги.</p>}
      </Panel>

      <Panel title={own.length ? "Заготовки" : "Начните с заготовки"}>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button key={p.title} onClick={() => create(p.cmd)} className="rounded-xl border border-[var(--jv-line)] bg-black/25 p-3 text-left transition-colors hover:border-[var(--jv-cyan)]">
              <div className="text-[15px] font-medium text-white">{p.title}</div>
              <div className="text-xs text-[#8fb3c7]">«{p.cmd.phrases[0]}» · {p.hint}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(p.cmd.steps ?? []).map((s, i) => (
                  <span key={i} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-[#9dbccc]">
                    {STEPS[s.type].icon} {STEPS[s.type].label}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-[#7f9fb2]">Заготовка — только старт: откроется редактор, где можно поменять фразу, шаги и порядок.</p>
      </Panel>

      <Panel
        title="Что Джарвис умеет сам"
        right={
          <button className="text-xs text-[#7cc8ec]" onClick={() => setShowBuiltin(!showBuiltin)}>
            {showBuiltin ? "Свернуть" : "Показать"}
          </button>
        }
      >
        {showBuiltin ? (
          <div className="space-y-3">
            {BUILTIN.map((g) => (
              <div key={g.group}>
                <div className="mb-1.5 text-xs uppercase tracking-wider text-[#7f9fb2]">{g.group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((i) => (
                    <button key={i} className="jarvis-chip !px-3 !py-1.5 !text-[13px]" onClick={() => tryIt(i)}>
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-[#7f9fb2]">Нажатие выполняет команду по-настоящему. Остальное Джарвис передаст нейронке.</p>
          </div>
        ) : (
          <p className="text-sm text-[#8fb3c7]">Программы, музыка, громкость, окна, таймеры, календарь, траты, заметки — и любые просьбы своими словами.</p>
        )}
      </Panel>
    </Screen>
  );
}
