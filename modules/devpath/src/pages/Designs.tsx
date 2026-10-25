import { useState } from "react";
import { Link, Loading, cn, useAi, useCollection, useParams } from "@lifehub/sdk";
import { DESIGNS, designById } from "../data/designs.ts";
import { LEVEL_TITLE } from "../data/workshop.ts";
import { ARCHITECT, PASS_SCORE, designTaskPrompt, parseScore } from "../lib/ai.ts";
import { award } from "../lib/store.ts";
import type { DesignState } from "../lib/types.ts";
import type { DesignTask } from "../lib/workshop-parse.ts";
import { db, type WithDoc } from "@lifehub/sdk";
import { sfx } from "../lib/sfx.ts";
import { Screen, Header, Panel, Btn, Pill, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";

const designsDb = db.collection<DesignState>("designs");

const TEMPLATE = `## Требования и оценка нагрузки
- Запросов в секунду (чтение / запись), объём данных:
- Задержки, доступность:

## API

## Данные и где они хранятся

## Основные сценарии по шагам

## Узкие места и масштабирование

## Отказы

## Альтернативы и компромиссы
`;

export function DesignsPage() {
  const states = useCollection<DesignState>("designs");
  if (states.loading) return <Screen><Loading /></Screen>;
  const st = new Map(states.items.map((s) => [s.id, s]));
  return (
    <Screen>
      <Header title="🏛️ Проектирование" subtitle="Типовые задачи System Design: сначала свой дизайн, потом оценка архитектора и разбор." back="/train" />
      <Panel className="mb-4 text-sm text-[var(--dp-muted)]">
        Здесь нет кода и тестов — как на собеседовании: требования, оценка нагрузки, API, данные, узкие места, отказы и компромиссы.
        Пиши так, будто объясняешь коллеге у доски. Проходной балл архитектора — {PASS_SCORE}/10, эталонный разбор открывается после первой попытки.
      </Panel>
      <div className="space-y-2">
        {DESIGNS.map((d) => {
          const s = st.get(d.id);
          return (
            <Link key={d.id} to={`/design/${d.id}`} className="dp-panel flex items-center gap-3 p-3 transition hover:-translate-y-0.5">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--dp-panel-2)] text-xl">{(s?.best ?? 0) >= PASS_SCORE ? "✅" : "🏛️"}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{d.title}</div>
                <div className="truncate text-xs text-[var(--dp-muted)]">{LEVEL_TITLE[d.level]} · ~{d.minutes} мин</div>
              </div>
              {s?.best !== undefined && <Pill color={s.best >= PASS_SCORE ? "#34d399" : "#fbbf24"}>{s.best}/10</Pill>}
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

export function DesignPage() {
  const { id = "" } = useParams();
  const d = designById(id);
  const states = useCollection<DesignState>("designs");
  if (!d) return <Screen><Header title="Задача не найдена" back="/designs" /></Screen>;
  if (states.loading) return <Screen><Loading /></Screen>;
  return <DesignEditor key={d.id} d={d} s={states.items.find((x) => x.id === d.id) ?? null} />;
}

function DesignEditor({ d, s }: { d: DesignTask; s: WithDoc<DesignState> | null }) {
  const [doc, setDoc] = useState(s?.doc || TEMPLATE);
  const review = useAi();
  const shown = review.text || s?.last?.text;

  const send = async () => {
    const text = await review.run(designTaskPrompt({ title: d.title, task: d.task, requirements: d.requirements, reference: d.reference, doc }), { system: ARCHITECT });
    if (!text) return;
    const score = Math.round((parseScore(text) ?? 0) / 10);
    const best = Math.max(s?.best ?? 0, score);
    const next = { doc, best, last: { score, text, at: Date.now() }, attempts: (s?.attempts ?? 0) + 1 };
    await (s ? designsDb.update(d.id, next) : designsDb.put(d.id, next));
    // Опыт — за первое прохождение порога.
    if (score >= PASS_SCORE && (s?.best ?? 0) < PASS_SCORE) {
      const xp = 60 + d.level * 30;
      await award("design", xp, { note: d.id, score: score * 10 });
      sfx.win();
      celebrate(xp, true);
    } else if (score < PASS_SCORE) sfx.wrong();
  };

  return (
    <Screen>
      <Header title={<>🏛️ {d.title}</>} subtitle={`${LEVEL_TITLE[d.level]} · ~${d.minutes} мин${s?.best !== undefined ? ` · лучший результат ${s.best}/10` : ""}`} back="/designs" />
      <Panel className="mb-4">
        <Md text={d.task} />
        <div className="mt-3 text-sm font-bold">Требования</div>
        <div className="mt-1"><Md text={d.requirements} /></div>
      </Panel>
      <details className="dp-panel mb-4 p-4">
        <summary className="cursor-pointer font-bold">🤔 О чём подумать</summary>
        <div className="mt-3"><Md text={d.think} /></div>
      </details>

      <textarea className="dp-input dp-mono min-h-[460px] text-[13px]" value={doc} onChange={(e) => setDoc(e.target.value)} />
      <Btn className="mt-3" block loading={review.loading} disabled={doc.trim().length < 400} onClick={send}>
        {review.loading ? "Архитектор читает…" : s ? "Отправить ещё раз" : "Отправить архитектору"}
      </Btn>
      {review.error && <div className="mt-3"><AiError error={review.error} /></div>}
      {shown && (
        <Panel className={cn("mt-4")}>
          {s?.last && !review.text && <div className="mb-2"><Pill color={s.last.score >= PASS_SCORE ? "#34d399" : "#fbbf24"}>{s.last.score}/10</Pill></div>}
          <Md text={shown} />
        </Panel>
      )}
      {s && (
        <details className="dp-panel mt-4 p-4">
          <summary className="cursor-pointer font-bold">📖 Эталонный разбор</summary>
          <div className="mt-1 text-xs text-[var(--dp-muted)]">Не единственно верный: сравни, где твои компромиссы лучше, а где ты чего-то не учёл.</div>
          <div className="mt-3"><Md text={d.reference} terms /></div>
        </details>
      )}
    </Screen>
  );
}
