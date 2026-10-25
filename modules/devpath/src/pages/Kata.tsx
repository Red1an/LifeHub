import { useEffect, useRef, useState } from "react";
import { Link, Loading, cn, confirm, useCollection, useParams } from "@lifehub/sdk";
import { KATAS, LEVEL_TITLE, kataById } from "../data/workshop.ts";
import { topicById } from "../data/curriculum.ts";
import { formatSeconds, kataOfDay, kataSolved, katasDb, useRunner } from "../lib/workshop.ts";
import type { Kata } from "../lib/workshop-parse.ts";
import type { KataState } from "../lib/types.ts";
import type { WithDoc } from "@lifehub/sdk";
import { sfx } from "../lib/sfx.ts";
import { Screen, Header, Panel, Btn, Pill, celebrate } from "../components/kit.tsx";
import { Md, Code } from "../components/Md.tsx";
import { RunView } from "../components/RunView.tsx";
import { editorKeys } from "./Practice.tsx";

export function KatasPage() {
  const katas = useCollection<KataState>("katas");
  if (katas.loading) return <Screen><Loading /></Screen>;
  const st = new Map(katas.items.map((k) => [k.id, k]));
  const today = kataOfDay(st);
  return (
    <Screen>
      <Header title="⌨️ Каты" subtitle="Короткие задачи из работы. Руками: без автодополнения, без нейронки, без гугла." back="/train" />
      <div className="space-y-2">
        {KATAS.map((k) => {
          const s = st.get(k.id);
          return (
            <Link key={k.id} to={`/kata/${k.id}`} className={cn("dp-panel flex items-center gap-3 p-3 transition hover:-translate-y-0.5", k.id === today?.id && "dp-glow")}>
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--dp-panel-2)] text-xl">{s?.solvedAt ? "✅" : "⌨️"}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{k.title}</div>
                <div className="truncate text-xs text-[var(--dp-muted)]">
                  {LEVEL_TITLE[k.level]} · ~{k.minutes} мин{s?.best ? ` · лучшее время ${formatSeconds(s.best)}` : ""}
                </div>
              </div>
              {k.id === today?.id && <Pill color="#fbbf24">сегодня</Pill>}
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

export function KataPage() {
  const { id = "" } = useParams();
  const k = kataById(id);
  const katas = useCollection<KataState>("katas");
  if (!k) return <Screen><Header title="Ката не найдена" back="/katas" /></Screen>;
  if (katas.loading) return <Screen><Loading /></Screen>;
  return <KataEditor key={k.id} k={k} s={katas.items.find((x) => x.id === k.id) ?? null} />;
}

function KataEditor({ k, s }: { k: Kata; s: WithDoc<KataState> | null }) {
  const [code, setCode] = useState(s?.code || k.starter);
  const [error, setError] = useState<string | null>(null);
  const [justSolved, setJustSolved] = useState(false);
  const { run, busy, running } = useRunner();
  const saved = useRef(code);
  const startedAt = s?.startedAt || 0;

  // Черновик сохраняется сам, чтобы не потерять код при уходе со страницы.
  useEffect(() => {
    const t = setTimeout(() => {
      if (code === saved.current) return;
      saved.current = code;
      void (s ? katasDb.update(k.id, { code }) : katasDb.put(k.id, { code, attempts: 0 })).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [code]);

  const edit = (v: string) => {
    setCode(v);
    // Время идёт с первого изменения кода.
    if (!startedAt) void (s ? katasDb.update(k.id, { startedAt: Date.now() }) : katasDb.put(k.id, { code: v, attempts: 0, startedAt: Date.now() }));
  };

  const check = async () => {
    setError(null);
    saved.current = code;
    const r = await run({ kind: "kata", kata: k.id, code });
    if (r.status === "error" || !r.result) return setError(r.error ?? "Хаб не вернул результат");
    const last = { ...r.result, at: Date.now() };
    const patch = { code, attempts: (s?.attempts ?? 0) + 1, last, startedAt: startedAt || Date.now() };
    await (s ? katasDb.update(k.id, patch) : katasDb.put(k.id, patch));
    if (r.result.ok) {
      const seconds = Math.max(1, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
      const fresh = await katasDb.get(k.id);
      const xp = await kataSolved(k, fresh, seconds);
      setJustSolved(true);
      sfx.win();
      celebrate(xp, !s?.solvedAt);
    } else sfx.wrong();
  };

  const restart = async () => {
    if (!(await confirm("Стереть код и решить заново? Лучшее время сохранится.", { confirmText: "Заново" }))) return;
    setCode(k.starter);
    saved.current = k.starter;
    setJustSolved(false);
    await katasDb.put(k.id, { code: k.starter, attempts: s?.attempts ?? 0, solvedAt: s?.solvedAt, best: s?.best, peeked: s?.peeked, startedAt: 0 });
  };

  const peek = async () => {
    if (!s?.solvedAt && !(await confirm("Подсмотреть эталон до решения? Опыт за кату станет минимальным. Попробуй сначала ещё раз.", { confirmText: "Подсмотреть" }))) return;
    if (!s?.solvedAt) await (s ? katasDb.update(k.id, { peeked: true }) : katasDb.put(k.id, { code, attempts: 0, peeked: true }));
  };

  const solved = !!s?.solvedAt;
  const showSolution = solved || s?.peeked;

  return (
    <Screen>
      <Header
        title={<>⌨️ {k.title}</>}
        subtitle={`${LEVEL_TITLE[k.level]} · ~${k.minutes} мин${s?.best ? ` · лучшее время ${formatSeconds(s.best)}` : ""}`}
        back="/katas"
      />
      <Panel className="mb-4">
        <Md text={k.task} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {k.topics.map((t) => topicById(t) && (
            <Link key={t} to={`/topic/${t}`}><Pill color="#8b5cf6">📚 {topicById(t)!.title}</Pill></Link>
          ))}
        </div>
      </Panel>

      <Timer startedAt={startedAt} stopped={justSolved} />

      <textarea
        className="dp-editor min-h-[340px] whitespace-pre"
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={code}
        onKeyDown={editorKeys}
        onChange={(e) => edit(e.target.value)}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Btn tone="ghost" onClick={restart}>↺ Заново</Btn>
        <Btn loading={busy} onClick={check}>{running ? "Гоняю тесты…" : "▶ Проверить"}</Btn>
      </div>
      {busy && <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Первый прогон дольше: dotnet восстанавливает пакеты.</div>}
      {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}

      <div className="mt-4">{s?.last && <RunView result={s.last} />}</div>

      {showSolution ? (
        <>
          <Panel className="mb-4">
            <div className="mb-2 font-bold">🧠 Почему так</div>
            <Md text={k.why} terms />
          </Panel>
          <details className="dp-panel mb-4 p-4" open={!solved}>
            <summary className="cursor-pointer font-bold">Эталонное решение</summary>
            <div className="mt-1 text-xs text-[var(--dp-muted)]">Не единственно верное. Сравни: что у тебя проще, что надёжнее?</div>
            <Code code={k.solution} lang="csharp" className="mt-3" />
          </details>
        </>
      ) : (
        (s?.attempts ?? 0) >= 2 && (
          <div className="text-center">
            <button className="text-sm text-[var(--dp-muted)] hover:text-white" onClick={peek}>Совсем не идёт — подсмотреть эталон</button>
          </div>
        )
      )}
    </Screen>
  );
}

function Timer({ startedAt, stopped }: { startedAt: number; stopped: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt || stopped) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, stopped]);
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--dp-muted)]">
      <span>Tab — отступ, автодополнения нет</span>
      <span className="dp-mono whitespace-nowrap">⏱ {startedAt ? formatSeconds(Math.max(0, Math.round((now - startedAt) / 1000))) : "с первой правки"}</span>
    </div>
  );
}
