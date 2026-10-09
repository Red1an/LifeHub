import { useMemo, useState } from "react";
import { Link, cn, plural, toast, useCollection } from "@lifehub/sdk";
import { Empty, Head, Wrap } from "../components/kit.tsx";
import { SRS_STEPS, isDueWord, srsNext } from "../lib/kinds.ts";
import { localKey, shortDate, titleOf } from "../lib/text.ts";
import type { Note, NoteDoc } from "../lib/types.ts";

/**
 * Слова и термины: словарь + повторение карточками (как Anki, но проще):
 * помню — следующий интервал (1, 3, 7, 14, 30, 90 дней), забыл — снова завтра; прошёл все — «выучил».
 */
export function WordsPage() {
  const notes = useCollection<Note>("notes");
  const today = localKey(new Date());
  const words = useMemo(() => notes.items.filter((n) => n.kind === "word" && n.status !== "inbox" && n.status !== "archived"), [notes.items]);
  const due = words.filter((n) => isDueWord(n, today));
  const [session, setSession] = useState<string[] | null>(null);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return words
      .filter((n) => !s || `${n.title} ${n.props?.meaning ?? ""}`.toLowerCase().includes(s))
      .sort((a, b) => Number(!!a.done) - Number(!!b.done) || titleOf(a).localeCompare(titleOf(b), "ru"));
  }, [words, q]);

  if (session) return <Review ids={session} words={words} onDone={() => setSession(null)} />;

  return (
    <Wrap>
      <Head title="🔤 Слова" sub="Незнакомые слова и термины: кидай в воронку «что такое X» — значение и пример подставятся сами" back="/shelves" />
      {!words.length ? (
        <Empty icon="🔤" title="Слов пока нет" text="Услышал незнакомое слово — запиши в воронку. Нейронка добавит значение и пример, а здесь можно будет повторять." />
      ) : (
        <>
          <button
            type="button"
            className="nt-btn mb-4 w-full"
            disabled={!due.length}
            onClick={() => setSession(due.map((n) => n.id))}
          >
            {due.length ? `Повторить ${due.length} ${plural(due.length, ["слово", "слова", "слов"])}` : "На сегодня всё повторено ✨"}
          </button>
          <input className="nt-field mb-3" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="space-y-2">
            {list.map((n) => (
              <Link key={n.id} to={`/n/${n.id}`} className={cn("nt-paper block p-3", n.done && "opacity-60")}>
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{titleOf(n)}</span>
                  {n.props?.lang && n.props.lang !== "русский" && <span className="nt-muted text-xs">{n.props.lang}</span>}
                  <span className="nt-muted ml-auto text-xs">
                    {n.done ? "выучил ✓" : n.srs ? (n.srs.due <= today ? "пора повторить" : `повтор ${shortDate(n.srs.due)}`) : ""}
                  </span>
                </div>
                {n.props?.meaning && <p className="mt-0.5 text-sm">{n.props.meaning}</p>}
                {n.props?.example && <p className="nt-muted mt-0.5 text-xs italic">{n.props.example}</p>}
              </Link>
            ))}
          </div>
        </>
      )}
    </Wrap>
  );
}

function Review({ ids, words, onDone }: { ids: string[]; words: NoteDoc[]; onDone: () => void }) {
  const notes = useCollection<Note>("notes");
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [stats, setStats] = useState({ ok: 0, again: 0 });
  const byId = new Map(words.map((w) => [w.id, w]));
  const word = byId.get(ids[i]);

  const answer = async (remembered: boolean) => {
    if (!word) return;
    const next = srsNext(word.srs?.step ?? 0, remembered);
    await notes.update(word.id, { srs: { step: next.step, due: next.due }, ...(next.learned ? { done: true, doneAt: Date.now() } : {}) });
    if (next.learned) toast(`«${titleOf(word)}» — выучено 🎉`, "success");
    setStats((s) => (remembered ? { ...s, ok: s.ok + 1 } : { ...s, again: s.again + 1 }));
    setShown(false);
    setI(i + 1);
  };

  if (!word) {
    return (
      <Wrap>
        <Empty
          icon="🎉"
          title="Повторение закончено"
          text={`Помню: ${stats.ok} · снова завтра: ${stats.again}`}
          action={
            <button type="button" className="nt-btn" onClick={onDone}>
              К словам
            </button>
          }
        />
      </Wrap>
    );
  }

  const step = word.srs?.step ?? 0;
  return (
    <Wrap>
      <Head title="Повторение" sub={`${i + 1} из ${ids.length}`} right={<button type="button" className="nt-muted text-sm" onClick={onDone}>Закончить</button>} />
      <div className="nt-paper flex min-h-[45dvh] flex-col items-center justify-center p-6 text-center">
        <div className="nt-serif text-3xl font-semibold">{titleOf(word)}</div>
        {word.props?.lang && word.props.lang !== "русский" && <div className="nt-muted mt-1 text-sm">{word.props.lang}</div>}
        {shown ? (
          <div className="mt-5 space-y-2">
            <p className="text-lg leading-relaxed">{word.props?.meaning || word.body}</p>
            {word.props?.example && <p className="nt-muted italic">{word.props.example}</p>}
          </div>
        ) : (
          <p className="nt-muted mt-5 text-sm">Вспомни значение — потом открой</p>
        )}
      </div>
      {shown ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="nt-btn nt-btn-ghost" onClick={() => answer(false)}>
            Не помню
          </button>
          <button type="button" className="nt-btn" onClick={() => answer(true)}>
            Помню · через {SRS_STEPS[Math.min(step + 1, SRS_STEPS.length - 1)]} дн
          </button>
        </div>
      ) : (
        <button type="button" className="nt-btn mt-4 w-full" onClick={() => setShown(true)}>
          Показать значение
        </button>
      )}
    </Wrap>
  );
}
