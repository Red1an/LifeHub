import { useEffect, useState } from "react";
import { Link, Modal, confirm, cn, toast, useNavigate, useParams } from "@lifehub/sdk";
import { Panel, Screen } from "../components/hud.tsx";
import { Phrases, Segmented, TargetPicker, inputCls } from "../components/form.tsx";
import { action, usePrefs } from "../lib/store.ts";
import { KEY_CHIPS, STEPS, STEP_ORDER, stepsOf } from "../lib/steps.ts";
import { RUNNABLE, type CustomCommand, type Step } from "../lib/types.ts";

export function Scenario() {
  const { id } = useParams();
  const { prefs, update, loading } = usePrefs();
  const navigate = useNavigate();
  const saved = prefs.commands.find((c) => c.id === id);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);

  useEffect(() => {
    if (!saved || ready) return;
    setPhrases(saved.phrases);
    setSteps(stepsOf(saved));
    setReady(true);
  }, [saved, ready]);

  if (loading) return <Screen title="Сценарий">{null}</Screen>;
  if (!saved)
    return (
      <Screen title="Сценарий">
        <p className="text-sm text-[#8fb3c7]">
          Такого сценария нет. <Link to="/commands" className="jarvis-glow">К списку</Link>
        </p>
      </Screen>
    );

  const next: CustomCommand = { ...saved, phrases, steps, say: "", run: [] };
  const dirty = JSON.stringify({ p: saved.phrases, s: stepsOf(saved) }) !== JSON.stringify({ p: phrases, s: steps });
  const taken = phrases.filter((p) => prefs.commands.some((c) => c.id !== saved.id && c.phrases.includes(p)));

  const save = (silent = false) => {
    update({ commands: prefs.commands.map((c) => (c.id === saved.id ? next : c)) });
    if (!silent) toast("Сохранено", "success");
  };
  const remove = async () => {
    if (!(await confirm(`Удалить сценарий «${phrases[0] ?? "без фразы"}»?`, { danger: true }))) return;
    update({ commands: prefs.commands.filter((c) => c.id !== saved.id) });
    navigate("/commands");
  };
  const run = async () => {
    if (dirty) save(true);
    // Хаб читает сценарий из настроек — даём им записаться.
    setTimeout(() => void action({ kind: "scenario", id: saved.id }), dirty ? 400 : 0);
    toast("Запускаю", "info");
  };
  const set = (i: number, s: Step) => setSteps(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const list = [...steps];
    [list[i], list[j]] = [list[j], list[i]];
    setSteps(list);
  };
  const insert = (at: number, s: Step) => {
    const list = [...steps];
    list.splice(at, 0, s);
    setSteps(list);
    if (s.type === "open") setPicking(at);
  };

  return (
    <Screen
      title={phrases[0] ? `«${phrases[0]}»` : "Новый сценарий"}
      subtitle={<Link to="/commands" className="text-[#7cc8ec]">← Все сценарии</Link>}
      right={
        <button className="jarvis-chip shrink-0" disabled={!steps.length} onClick={run}>
          ▶ Запустить
        </button>
      }
    >
      <Panel title="Фразы">
        <Phrases value={phrases} onChange={setPhrases} placeholder={phrases.length ? "Ещё вариант и Enter" : "Например: режим работы"} />
        <p className="mt-2 text-xs text-[#7f9fb2]">«Джарвис, {phrases[0] || "режим работы"}». Можно несколько вариантов — сработает любой.</p>
        {taken.length > 0 && <p className="mt-1 text-xs text-[var(--jv-amber)]">Фраза «{taken[0]}» уже есть в другом сценарии — сработает первый по списку.</p>}
      </Panel>

      <Panel title={`Шаги${steps.length ? ` · ${steps.length}` : ""}`}>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i}>
              <StepCard
                step={s}
                index={i}
                count={steps.length}
                onChange={(x) => set(i, x)}
                onMove={(d) => move(i, d)}
                onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
                onPick={() => setPicking(i)}
              />
            </div>
          ))}
          <button
            onClick={() => setAdding(steps.length)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--jv-line)] py-3 text-sm text-[#9dbccc] transition-colors hover:border-[var(--jv-cyan)] hover:text-white"
          >
            + Добавить шаг
          </button>
        </div>
        <p className="mt-3 text-xs text-[#7f9fb2]">Шаги выполняются сверху вниз. Всё, что «сказать», Джарвис произнесёт одной фразой в конце.</p>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-sm text-[#ff9b8a] hover:underline" onClick={remove}>
          Удалить сценарий
        </button>
        <span className="text-xs text-[#7f9fb2]">{dirty ? "Есть несохранённые изменения" : "Всё сохранено"}</span>
      </div>

      {dirty && (
        <div className="sticky bottom-3 z-10">
          <button
            className="jarvis-title h-12 w-full rounded-xl bg-[var(--jv-cyan)] font-semibold text-[#04121c] shadow-[0_0_24px_rgba(90,209,255,0.35)] disabled:opacity-40"
            disabled={!phrases.length}
            onClick={() => save()}
          >
            {phrases.length ? "Сохранить" : "Добавьте фразу, чтобы сохранить"}
          </button>
        </div>
      )}

      {adding !== null && (
        <Modal open onClose={() => setAdding(null)} title="Какой шаг">
          <div className="jarvis-vars grid grid-cols-2 gap-2">
            {STEP_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => {
                  insert(adding, STEPS[t].make());
                  setAdding(null);
                }}
                className="rounded-xl border border-[var(--jv-line)] bg-black/25 p-3 text-left transition-colors hover:border-[var(--jv-cyan)]"
              >
                <div className="text-[15px] text-white">
                  {STEPS[t].icon} {STEPS[t].label}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[#8fb3c7]">{STEPS[t].hint}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {picking !== null && steps[picking]?.type === "open" && (
        <TargetPicker
          value={(steps[picking] as Extract<Step, { type: "open" }>).target}
          onClose={() => setPicking(null)}
          onPick={(target) => {
            set(picking, { type: "open", target });
            setPicking(null);
          }}
        />
      )}
    </Screen>
  );
}

function StepCard({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onPick,
}: {
  step: Step;
  index: number;
  count: number;
  onChange: (s: Step) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  const meta = STEPS[step.type];
  const iconBtn = "grid size-8 place-items-center rounded-lg text-[#9dbccc] hover:bg-white/10 hover:text-white disabled:opacity-25";
  return (
    <div className="rounded-xl border border-[var(--jv-line)] bg-black/25">
      <div className="flex items-center gap-2 border-b border-[var(--jv-line)] px-3 py-1.5">
        <span className="grid size-6 place-items-center rounded-full bg-[var(--jv-cyan)]/15 text-[11px] text-[var(--jv-cyan)]">{index + 1}</span>
        <span className="flex-1 text-sm text-white">
          {meta.icon} {meta.label}
        </span>
        <button className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Выше">
          ↑
        </button>
        <button className={iconBtn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Ниже">
          ↓
        </button>
        <button className={iconBtn} onClick={onRemove} aria-label="Удалить шаг">
          ✕
        </button>
      </div>
      <div className="p-3">
        <StepFields step={step} onChange={onChange} onPick={onPick} />
      </div>
    </div>
  );
}

function StepFields({ step, onChange, onPick }: { step: Step; onChange: (s: Step) => void; onPick: () => void }) {
  switch (step.type) {
    case "say":
      return (
        <textarea
          className={cn(inputCls, "h-auto min-h-16 py-2")}
          value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
          placeholder="Режим работы включён, сэр."
        />
      );
    case "command":
      return (
        <div className="space-y-2">
          <input className={inputCls} value={step.text} list="jv-runnable" onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="что дальше, громче, открой почту…" />
          <datalist id="jv-runnable">
            {RUNNABLE.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <label className="flex items-center gap-2 text-sm text-[#c3dcea]">
            <input type="checkbox" checked={!!step.speak} onChange={(e) => onChange({ ...step, speak: e.target.checked })} className="accent-[var(--jv-cyan)]" />
            Озвучить ответ
          </label>
          <p className="text-[11px] text-[#7f9fb2]">Любая фраза, которую понимает Джарвис. Без галочки ответ прозвучит, только если в сценарии нет шага «Сказать».</p>
        </div>
      );
    case "open":
      return (
        <button onClick={onPick} className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--jv-line)] bg-black/30 px-3 py-2.5 text-left hover:border-[var(--jv-cyan)]">
          <span className="min-w-0">
            <span className={cn("block truncate text-[15px]", step.target.value ? "text-white" : "text-[#5f7f92]")}>
              {step.target.value ? step.target.label || step.target.value : "Выбрать программу, сайт или папку"}
            </span>
            {step.target.value && (
              <span className="block truncate text-[11px] text-[#7f9fb2]">{step.target.kind === "lib" ? "программа" : step.target.kind === "url" ? step.target.value : "путь: " + step.target.value}</span>
            )}
          </span>
          <span className="jarvis-glow shrink-0 text-sm">изменить</span>
        </button>
      );
    case "search":
      return (
        <div className="space-y-2">
          <Segmented
            value={step.where}
            onChange={(where) => onChange({ ...step, where })}
            options={[
              ["youtube", "YouTube"],
              ["google", "Google"],
              ["yandex", "Яндекс"],
            ]}
          />
          <input className={inputCls} value={step.query} onChange={(e) => onChange({ ...step, query: e.target.value })} placeholder="lofi для учёбы" />
        </div>
      );
    case "keys":
      return (
        <div className="space-y-2">
          <input className={inputCls} value={step.combo} onChange={(e) => onChange({ ...step, combo: e.target.value.toLowerCase().replace(/\s+/g, "") })} placeholder="ctrl+shift+t" />
          <div className="flex flex-wrap gap-1.5">
            {KEY_CHIPS.map((k) => (
              <button key={k} className={cn("rounded-full border px-2.5 py-1 text-xs", step.combo === k ? "border-[var(--jv-cyan)] text-white" : "border-[var(--jv-line)] text-[#9dbccc]")} onClick={() => onChange({ ...step, combo: k })}>
                {k}
              </button>
            ))}
          </div>
        </div>
      );
    case "type":
      return (
        <div className="space-y-2">
          <textarea className={cn(inputCls, "h-auto min-h-16 py-2")} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="Текст, который появится в активном окне" />
          <label className="flex items-center gap-2 text-sm text-[#c3dcea]">
            <input type="checkbox" checked={!!step.enter} onChange={(e) => onChange({ ...step, enter: e.target.checked })} className="accent-[var(--jv-cyan)]" />
            Нажать Enter (отправить)
          </label>
        </div>
      );
    case "volume":
      return (
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={100} step={5} value={step.level} onChange={(e) => onChange({ ...step, level: Number(e.target.value) })} className="h-2 flex-1 accent-[var(--jv-cyan)]" />
          <span className="w-12 text-right text-sm tabular-nums text-white">{step.level}%</span>
        </div>
      );
    case "media":
      return (
        <Segmented
          value={step.key}
          onChange={(key) => onChange({ ...step, key })}
          options={[
            ["play", "⏯ Пауза / играть"],
            ["next", "⏭ Следующий"],
            ["prev", "⏮ Предыдущий"],
          ]}
        />
      );
    case "close":
      return (
        <div>
          <input className={inputCls} value={step.name} onChange={(e) => onChange({ ...step, name: e.target.value })} placeholder="телеграм, дискорд, браузер…" />
          <p className="mt-1 text-[11px] text-[#7f9fb2]">Как называете программу вслух. Не открыта — шаг просто пропустится.</p>
        </div>
      );
    case "wait":
      return (
        <div className="flex items-center gap-3">
          <input type="range" min={1} max={30} step={1} value={step.seconds} onChange={(e) => onChange({ ...step, seconds: Number(e.target.value) })} className="h-2 flex-1 accent-[var(--jv-cyan)]" />
          <span className="w-12 text-right text-sm tabular-nums text-white">{step.seconds} с</span>
        </div>
      );
  }
}

