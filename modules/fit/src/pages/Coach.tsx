import { useRef, useState } from "react";
import { ai, cn, Loading, useNavigate, useStore, type ChatMessage } from "@lifehub/sdk";
import { EQUIP, EX, EXERCISES, LIMITS, MUSCLES, hasEquip } from "../data/library.ts";
import { minutesOf, weekVolume } from "../lib/analysis.ts";
import { makeItem } from "../lib/generator.ts";
import { unlockAudio } from "../lib/sfx.ts";
import { useFit, type Fit } from "../lib/store.ts";
import type { Workout, WorkoutItem } from "../lib/types.ts";
import { Editor } from "../components/Editor.tsx";
import { AiError, Btn, Header, Panel, Screen } from "../components/kit.tsx";
import { GOALS, EXPERIENCE } from "./Profile.tsx";

const IDEAS = [
  "Болит поясница после работы, 15 минут, дома",
  "В отеле: только кровать и стул, 25 минут, всё тело",
  "На площадке турник и брусья, хочу руки и пресс",
  "Устал и не выспался — лёгкая восстановительная на 20 минут",
  "Хочу научиться подтягиваться, что делать сегодня?",
  "Только гантели 10 кг, 40 минут, ноги",
];

/** Кто я и как тренируюсь — контекст для нейронки. */
function aboutMe(fit: Fit) {
  const p = fit.profile;
  const vol = weekVolume(fit.hist);
  const recent = [...fit.hist].reverse().slice(0, 5).map((w) => `${new Date(w.finishedAt!).toLocaleDateString("ru")}: ${w.title} (${minutesOf(w)} мин)`).join("; ");
  return [
    `Уровень: ${EXPERIENCE[p.experience].title}. Цель: ${GOALS[p.goal].title}. Тренировок в неделю: ${p.perWeek}.`,
    p.limits.length ? `Беречь: ${p.limits.map((l) => LIMITS[l]).join(", ")}.` : "",
    p.bodyweight ? `Вес тела ${p.bodyweight} кг.` : "",
    `Работает за компьютером, много сидит.`,
    `Сейчас место: ${fit.place.name} (${fit.place.equip.map((q) => EQUIP[q].name).join(", ") || "без инвентаря"}).`,
    recent ? `Последние занятия: ${recent}.` : "Истории тренировок пока нет.",
    `Подходов на мышцы за эту неделю: ${Object.entries(vol).map(([m, v]) => `${MUSCLES[m as keyof typeof MUSCLES]} ${Math.round(v!)}`).join(", ") || "нет"}.`,
  ].filter(Boolean).join("\n");
}

interface AiPlan {
  title: string;
  comment: string;
  circuit?: { rounds: number; work: number; rest: number } | null;
  items: { id: string; block: "warmup" | "main" | "cooldown"; sets?: number; reps?: [number, number] | null; sec?: number | null; kg?: number | null; rest?: number }[];
}

export function CoachPage() {
  const fit = useFit();
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  if (fit.loading) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Header back="/build" title="🤖 Тренер" subtitle="Нейронка: соберёт тренировку под ситуацию и ответит на вопросы" />
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--ft-panel)] p-1">
        {([["plan", "🏋️ Собрать тренировку"], ["chat", "💬 Спросить"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-xl py-2.5 text-sm font-bold transition", tab === k ? "bg-[var(--ft-lime)] text-[#0a0b0d]" : "text-[var(--ft-muted)]")}>{l}</button>
        ))}
      </div>
      {tab === "plan" ? <PlanTab fit={fit} /> : <ChatTab fit={fit} />}
    </Screen>
  );
}

function PlanTab({ fit }: { fit: Fit }) {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useStore<{ w: Workout; comment: string } | null>("coachPlan", null);

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const catalog = EXERCISES.map((e) => `${e.id}|${e.name}|${e.pattern}|${e.mode}${e.load ? "|вес" : ""}|${e.equip.join(",") || "-"}${hasEquip(e, fit.place.equip) ? "" : "|нет на текущем месте"}`).join("\n");
      const plan = await ai.json<AiPlan>(
        `Ситуация пользователя: «${text.trim()}»\n\nО пользователе:\n${aboutMe(fit)}\n\n` +
        `Каталог упражнений (id|название|паттерн|reps или time|вес|инвентарь):\n${catalog}\n\n` +
        `Собери тренировку ТОЛЬКО из упражнений каталога (по id). Если в ситуации указан инвентарь — используй его, иначе — инвентарь текущего места. ` +
        `Учитывай ограничения и восстановление. Структура: разминка 3–6 упражнений (block "warmup", sec 30–60), основная часть (block "main"), заминка 2–4 растяжки (block "cooldown", sec 30–45). ` +
        `Для main укажи sets, reps [мин, макс] для упражнений на повторы или sec для упражнений на время, rest в секундах, kg — только если знаешь вес. ` +
        `Для круговой тренировки заполни circuit {rounds, work, rest}, тогда упражнения main выполняются по кругу по work секунд.\n` +
        `Верни JSON: {"title": "короткое название", "comment": "2–3 предложения: почему так и на что обратить внимание", "circuit": null, "items": [{"id": "...", "block": "main", "sets": 3, "reps": [8, 12], "sec": null, "kg": null, "rest": 60}]}`,
        { system: "Ты опытный тренер по силовой подготовке, калистенике и реабилитации офисных работников. Отвечаешь по-русски, безопасно и по делу." },
      );
      const items: WorkoutItem[] = [];
      for (const x of plan.items ?? []) {
        const e = EX.get(x.id);
        if (!e) continue;
        const block = x.block === "warmup" || x.block === "cooldown" ? x.block : "main";
        const base = makeItem(e.id, block, fit.profile, fit.hist);
        if (block !== "main") {
          const sec = Math.max(15, Math.min(180, x.sec ?? base.plan.sec ?? 30));
          items.push({ ...base, plan: { ...base.plan, sec }, sets: [{ done: false, sec }] });
          continue;
        }
        const circuit = plan.circuit;
        const sets = Math.max(1, Math.min(8, circuit ? circuit.rounds : x.sets ?? base.plan.sets));
        const sec = circuit ? circuit.work : e.mode === "time" ? x.sec ?? base.plan.sec : undefined;
        const reps = !circuit && e.mode === "reps" && x.reps?.length === 2 ? x.reps : base.plan.reps;
        const kg = e.load ? x.kg ?? base.plan.kg : undefined;
        items.push({
          ...base,
          plan: { sets, reps: sec ? undefined : reps, sec, kg: kg ?? undefined, rest: circuit ? circuit.rest : x.rest ?? base.plan.rest },
          sets: Array.from({ length: sets }, (_, k) => ({ ...(base.sets[k] ?? base.sets[0]), done: false, sec, kg: kg ?? undefined, reps: sec ? undefined : base.sets[k]?.reps ?? reps?.[0] })),
        });
      }
      if (!items.some((i) => i.block === "main")) throw new Error("Нейронка не подобрала упражнений — попробуй описать иначе.");
      const circuit = plan.circuit && plan.circuit.rounds ? plan.circuit : undefined;
      setResult({ w: { kind: "workout", title: plan.title || "Тренировка от тренера", place: fit.place.id, startedAt: 0, items, circuit }, comment: plan.comment ?? "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (!result) return;
    unlockAudio();
    fit.setActive({ w: { ...result.w, startedAt: Date.now() }, step: 0 });
    nav("/play");
  };

  return (
    <div>
      <textarea className="ft-input min-h-28" placeholder="Опиши ситуацию: где ты, что есть под рукой, сколько времени, что болит или чего хочется" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {IDEAS.map((i) => <button key={i} className="rounded-full bg-[var(--ft-panel-2)] px-3 py-1.5 text-xs text-[var(--ft-muted)] hover:text-[var(--ft-fg)]" onClick={() => setText(i)}>{i}</button>)}
      </div>
      <Btn block className="mt-4 !min-h-12" loading={busy} disabled={!text.trim()} onClick={() => void run()}>✨ Собрать</Btn>
      {busy && <div className="mt-3 text-center text-sm text-[var(--ft-muted)]">Тренер думает — обычно 20–60 секунд…</div>}
      {error && <div className="mt-4"><AiError error={error} onRetry={() => void run()} /></div>}

      {result && !busy && (
        <div className="mt-6">
          <div className="ft-display mb-2 text-lg font-bold">{result.w.title}</div>
          {result.comment && <Panel className="mb-4 text-sm">💬 {result.comment}</Panel>}
          <Editor w={result.w} onChange={(w) => setResult({ ...result, w })} fit={fit} />
          <Btn block className="!min-h-14 text-lg" onClick={start}>▶ Начать</Btn>
        </div>
      )}
    </div>
  );
}

function ChatTab({ fit }: { fit: Fit }) {
  const [msgs, setMsgs] = useStore<ChatMessage[]>("coachChat", []);
  const [text, setText] = useState("");
  const [stream, setStream] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const send = async (q = text) => {
    if (!q.trim() || busy) return;
    const history: ChatMessage[] = [...msgs, { role: "user" as const, content: q.trim() }].slice(-20);
    setMsgs(history);
    setText("");
    setBusy(true);
    setError("");
    setStream("");
    abort.current = new AbortController();
    try {
      const names = EXERCISES.map((e) => e.name).join(", ");
      const answer = await ai.chat(history, {
        system: `Ты личный тренер. Отвечай по-русски, коротко и практично, с конкретикой (подходы, повторы, техника). Если есть риск травмы — скажи об этом и посоветуй врача при боли.\n` +
          `О пользователе:\n${aboutMe(fit)}\nВ приложении есть упражнения: ${names}. Можно ссылаться на них по названию.`,
        onDelta: (_, full) => setStream(full),
        signal: abort.current.signal,
      });
      setMsgs([...history, { role: "assistant" as const, content: answer }].slice(-30));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      setStream("");
    }
  };

  return (
    <div>
      {!msgs.length && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {["Почему болит поясница после приседаний?", "Как быстрее научиться подтягиваться?", "Сколько отдыхать между подходами?", "Что делать, если прогресс встал?"].map((q) => (
            <button key={q} className="rounded-full bg-[var(--ft-panel-2)] px-3 py-1.5 text-xs text-[var(--ft-muted)] hover:text-[var(--ft-fg)]" onClick={() => void send(q)}>{q}</button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {msgs.map((m, i) => <Bubble key={i} m={m} />)}
        {busy && <Bubble m={{ role: "assistant", content: stream || "…" }} />}
      </div>
      {error && <div className="mt-3"><AiError error={error} /></div>}
      <div className="sticky bottom-0 mt-4 flex gap-2 bg-[var(--ft-bg)] py-3">
        <input className="ft-input" placeholder="Вопрос тренеру…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
        {busy ? <Btn tone="ghost" onClick={() => abort.current?.abort()}>■</Btn> : <Btn onClick={() => void send()} disabled={!text.trim()}>➤</Btn>}
      </div>
      {msgs.length > 0 && <button className="text-xs text-[var(--ft-muted)]" onClick={() => setMsgs([])}>Очистить диалог</button>}
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const me = m.role === "user";
  return (
    <div className={cn("flex", me && "justify-end")}>
      <div className={cn("max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed", me ? "bg-[var(--ft-lime)] text-[#0a0b0d]" : "bg-[var(--ft-panel)]")}>{m.content}</div>
    </div>
  );
}
