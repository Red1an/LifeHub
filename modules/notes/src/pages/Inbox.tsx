import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Modal, Switch, cn, confirm, db, files, formatRelative, plural, toast, useCollection, useSearchParams, useStore } from "@lifehub/sdk";
import { MicButton, useDictation } from "../components/input.tsx";
import { Head, NoteCard, Wrap, topicMap, usePrefs } from "../components/kit.tsx";
import { PlanView } from "../components/plan.tsx";
import { enrichMany } from "../lib/enrich.ts";
import { drain, enqueue, pendingCount } from "../lib/outbox.ts";
import { DAY } from "../lib/text.ts";
import { applyItems, isCurrentPlan, makeTriage, undoTriage, type TriagePlan, type UndoSnapshot } from "../lib/triage.ts";
import type { Note, NoteDoc, Prefs, Topic } from "../lib/types.ts";

const MODELS: { id: Prefs["model"]; label: string }[] = [
  { id: "fast", label: "Быстрая" },
  { id: "smart", label: "Основная" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
];

/** То, что уже положили из «Поделиться» (эффект может сработать дважды). */
const shared = new Set<string>();

/** Текст из «Поделиться»: заголовок, текст и адрес без повторов. */
function sharedText(p: URLSearchParams) {
  const parts = [p.get("title"), p.get("text"), p.get("url")].map((x) => x?.trim()).filter((x): x is string => !!x);
  return parts.filter((x, i) => !parts.some((y, j) => j !== i && y.length > x.length && y.includes(x))).join("\n");
}

export function InboxPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const { prefs } = usePrefs();
  const [stored, setPlan] = useStore<TriagePlan | null>("triage", null);
  const plan = isCurrentPlan(stored) ? stored : null;
  const [params, setParams] = useSearchParams();
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const voice = useDictation(text, (t) => {
    setText(t);
    setUsedVoice(true);
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const inbox = useMemo(
    () => notes.items.filter((n) => n.status === "inbox").sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt)),
    [notes.items],
  );
  const filed = useMemo(() => notes.items.filter((n) => n.status !== "inbox" && n.status !== "archived"), [notes.items]);
  const inboxMap = useMemo(() => new Map(inbox.map((n) => [n.id, n])), [inbox]);
  // Для связей и дублей нужны и архивные: «уже было в архиве — верну на полку».
  const known = useMemo(() => notes.items.filter((n) => n.status !== "inbox"), [notes.items]);
  const filedMap = useMemo(() => new Map(known.map((n) => [n.id, n])), [known]);
  const tmap = useMemo(() => topicMap(topics.items), [topics.items]);

  // План мог устареть: записи разобрали на другом устройстве или удалили.
  const livePlan = useMemo(() => {
    if (!plan || notes.loading) return plan;
    const items = plan.items.map((it) => ({ ...it, from: it.from.filter((id) => inboxMap.has(id)) })).filter((it) => it.from.length);
    return items.length ? { ...plan, items } : null;
  }, [plan, inboxMap, notes.loading]);

  const capture = async () => {
    const body = text.trim();
    if (!body) return;
    if (voice.listening) voice.stop();
    setText("");
    setUsedVoice(false);
    inputRef.current?.focus();
    const source = usedVoice ? "voice" : "text";
    try {
      // Без хука: его add сам показывает ошибку, а нам при обрыве связи нужна очередь, а не красный тост.
      const n = await db.collection<Note>("notes").add({ title: "", body, tags: [], pinned: false, status: "inbox", source, capturedAt: Date.now() });
      setFresh(n.id);
    } catch {
      enqueue(body, source);
      setPending(pendingCount());
      toast("Нет связи с хабом — запись сохранена на устройстве и уйдёт, когда связь вернётся");
    }
  };

  // Очередь без связи: записи со страницы «Хаб недоступен» и неотправленные отсюда.
  const [pending, setPending] = useState(pendingCount);
  useEffect(() => {
    const flush = () =>
      drain().then((sent) => {
        setPending(pendingCount());
        if (sent) toast(`Отправлено из очереди без связи: ${sent}`, "success");
      });
    flush();
    window.addEventListener("online", flush);
    const timer = setInterval(() => pendingCount() && flush(), 30_000);
    return () => {
      window.removeEventListener("online", flush);
      clearInterval(timer);
    };
  }, []);

  // Отмена последнего разбора — сутки или до следующего разбора.
  const [undo, setUndo] = useStore<UndoSnapshot | null>("undo", null);
  const [undoing, setUndoing] = useState(false);
  const canUndo = !!undo && Date.now() - undo.at < DAY;
  const revert = async () => {
    if (!undo) return;
    if (!(await confirm(`Вернуть всё как было до разбора? ${undo.count} ${plural(undo.count, ["заметка вернётся", "заметки вернутся", "заметок вернутся"])} в воронку. Правки, сделанные после разбора в этих заметках, пропадут.`, { confirmText: "Отменить разбор" }))) return;
    setUndoing(true);
    try {
      await undoTriage(undo);
      setUndo(null);
      await Promise.all([notes.reload(), topics.reload()]);
      toast("Разбор отменён", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUndoing(false);
    }
  };

  const afterApply = (res: Awaited<ReturnType<typeof applyItems>>) => {
    setUndo(res.undo);
    // Обложки и описания — в фоне, разбор уже закончен.
    const docs = res.created.map((id) => db.collection<Note>("notes").get(id));
    Promise.all(docs).then((list) => enrichMany(list.filter((d): d is NoteDoc => !!d)));
  };

  // «Поделиться» с телефона: хаб открывает модуль с ?title&text&url — сразу кладём в воронку.
  const share = sharedText(params);
  useEffect(() => {
    if (!share || notes.loading) return;
    setParams({ title: null, text: null, url: null });
    if (shared.has(share)) return;
    shared.add(share);
    notes.add({ title: "", body: share, tags: [], pinned: false, status: "inbox", source: "share", capturedAt: Date.now() }).then((n) => {
      setFresh(n.id);
      toast("Добавлено в воронку", "success");
    });
  }, [share, notes.loading]);

  const addPhotos = async (list: FileList | null) => {
    const picked = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return;
    const caption = text.trim();
    setText("");
    setUploading(picked.length);
    try {
      for (const f of picked) {
        const meta = await files.upload(f, f.name || "фото.jpg");
        const n = await notes.add({ title: "", body: caption, tags: [], pinned: false, status: "inbox", source: "photo", images: [meta.id], capturedAt: Date.now() });
        setFresh(n.id);
        setUploading((u) => u - 1);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const triage = async () => {
    setBusy("Читаю воронку…");
    try {
      const p = await makeTriage({ inbox, filed: known, topics: topics.items, prefs, onStep: setBusy });
      if (prefs.autoApply) {
        const asked = new Set(p.questions.map((q) => q.from));
        const sure = p.items.filter((it) => it.confidence >= 0.8 && !it.from.some((id) => asked.has(id)));
        if (sure.length) {
          setBusy("Применяю уверенное…");
          afterApply(await applyItems(sure, notes.items, topics.items));
          toast(`Разложено сразу: ${sure.length}`, "success");
        }
        const rest = p.items.filter((it) => !sure.includes(it));
        setPlan(rest.length ? { ...p, items: rest } : null);
      } else setPlan(p);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!livePlan) return;
    setApplying(true);
    try {
      const res = await applyItems(livePlan.items, notes.items, topics.items);
      afterApply(res);
      const skipped = livePlan.items.filter((i) => i.skip);
      const merged = livePlan.items.filter((i) => !i.skip && i.mergeInto).length;
      setPlan(null);
      const n = res.created.length;
      toast(
        `Разложено: ${n} ${plural(n, ["заметка", "заметки", "заметок"])}${merged ? `, ${merged} дописано в уже сохранённое` : ""}${skipped.length ? `, ${skipped.length} оставил в воронке` : ""}`,
        "success",
      );
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 600);
    return () => clearTimeout(t);
  }, [fresh]);

  const oldest = inbox.length ? Math.min(...inbox.map((n) => n.capturedAt ?? n.createdAt)) : 0;
  const ripe = inbox.length >= 5 || (inbox.length > 0 && Date.now() - oldest > 10 * 60_000);
  const recent = useMemo(() => [...filed].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [filed]);

  return (
    <Wrap>
      <Head
        title="Воронка"
        sub="Кидай всё подряд — мысли, ссылки, скриншоты, обрывки разговора. Разложим потом."
        right={
          <button type="button" className="nt-mic !h-9 !w-9 !text-base" aria-label="Настройки разбора" onClick={() => setSettings(true)}>
            ⚙️
          </button>
        }
      />

      <div className="nt-capture p-3">
        <textarea
          ref={inputRef}
          rows={2}
          className="nt-input resize-none px-1"
          placeholder={voice.listening ? "Слушаю…" : "Что пришло в голову?"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              capture();
            }
          }}
        />
        {voice.interim && <div className="nt-muted px-1 pb-1 text-sm italic">{voice.interim}</div>}
        <div className="flex items-center gap-2">
          {voice.supported && <MicButton listening={voice.listening} onClick={voice.toggle} />}
          <button type="button" className="nt-mic" aria-label="Фото или скриншот" disabled={uploading > 0} onClick={() => fileRef.current?.click()}>
            {uploading ? <span className="nt-funnel">⏳</span> : "📷"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <span className="nt-muted flex-1 text-xs">
            {voice.listening ? "Говори — текст появится в поле" : <span className="hidden sm:inline">Enter — в воронку, Shift+Enter — новая строка</span>}
          </span>
          <button type="button" className="nt-btn" disabled={!text.trim()} onClick={capture}>
            В воронку
          </button>
        </div>
      </div>

      {pending > 0 && (
        <div className="nt-soft mt-3 flex items-center gap-2 p-3 text-sm">
          <span className="flex-1">📡 {pending} {plural(pending, ["запись ждёт", "записи ждут", "записей ждут"])} связи с хабом</span>
          <button type="button" className="nt-accent" onClick={() => drain().then(() => setPending(pendingCount()))}>
            Отправить
          </button>
        </div>
      )}

      {canUndo && !busy && !livePlan && (
        <div className="nt-soft mt-3 flex items-center gap-2 p-3 text-sm">
          <span className="flex-1">
            ✓ Разобрано {formatRelative(undo!.at)}: {undo!.count} {plural(undo!.count, ["заметка", "заметки", "заметок"])}
          </span>
          <button type="button" className="nt-accent" disabled={undoing} onClick={revert}>
            {undoing ? "Отменяю…" : "Отменить"}
          </button>
          <button type="button" aria-label="Скрыть" className="nt-muted px-1" onClick={() => setUndo(null)}>
            ✕
          </button>
        </div>
      )}

      {busy ? (
        <div className="nt-paper mt-5 flex items-center gap-3 p-4">
          <span className="nt-funnel text-2xl">🌀</span>
          <div>
            <div className="font-semibold">Разбираю {inbox.length} {plural(inbox.length, ["запись", "записи", "записей"])}</div>
            <div className="nt-muted text-sm">{busy}</div>
          </div>
        </div>
      ) : livePlan ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="nt-h2">План разбора</h2>
              <p className="nt-muted text-sm">Проверь и поправь, если что-то не так. Применится одним нажатием.</p>
            </div>
          </div>
          <PlanView plan={livePlan} inbox={inboxMap} filed={filedMap} topics={topics.items} onChange={setPlan} />
          <div className="sticky bottom-[68px] z-10 mt-4 flex gap-2 sm:bottom-3">
            <button type="button" className="nt-btn nt-btn-ghost flex-none shadow-sm" onClick={() => setPlan(null)} disabled={applying}>
              Отмена
            </button>
            <button type="button" className="nt-btn flex-1 shadow-lg" onClick={apply} disabled={applying}>
              {applying ? "Раскладываю…" : `Применить (${livePlan.items.filter((i) => !i.skip).length})`}
            </button>
          </div>
        </section>
      ) : (
        <>
          {inbox.length > 0 && (
            <div className={cn("mt-5 flex items-center gap-3 p-3.5", ripe ? "nt-paper border-[var(--nt-accent)]" : "nt-soft")}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {inbox.length} {plural(inbox.length, ["запись", "записи", "записей"])} в воронке
                </div>
                <div className="nt-muted text-xs">{ripe ? "Пора разобрать — склею обрывки и разложу по полкам" : "Накидай ещё или разбери сейчас"}</div>
              </div>
              <button type="button" className={cn("nt-btn", !ripe && "nt-btn-ghost")} onClick={triage}>
                🌀 Разобрать
              </button>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {inbox.map((n) => (
              <div key={n.id} className={cn("nt-slip group flex items-start gap-2 px-3 py-2.5", fresh === n.id && "nt-new")}>
                <div className="min-w-0 flex-1">
                  {!!n.images?.length && (
                    <div className="mb-1.5 flex gap-1.5">
                      {n.images.map((id) => (
                        <img key={id} src={files.url(id)} alt="" className="size-16 rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  {n.body && <div className="whitespace-pre-wrap break-words text-[0.95rem]">{n.body}</div>}
                  <div className="nt-muted mt-0.5 text-xs">
                    {n.source === "voice" && "🎤 "}
                    {n.source === "share" && "↗️ "}
                    {formatRelative(n.capturedAt ?? n.createdAt)}
                  </div>
                </div>
                <button type="button" aria-label="Удалить" className="nt-muted -mr-1 size-8 flex-none rounded-full text-lg hover:bg-[var(--nt-paper-2)]" onClick={async () => (await notes.remove(n.id), n.images?.forEach((id) => files.remove(id).catch(() => {})))}>
                  ×
                </button>
              </div>
            ))}
          </div>
          {!inbox.length && !notes.loading && (
            <div className="nt-muted mt-8 text-center text-sm">
              <div className="mb-2 text-3xl">🫙</div>
              Воронка пуста. {filed.length ? "Всё разложено." : "Запиши первую мысль — хоть одно слово."}
            </div>
          )}
        </>
      )}

      {!livePlan && !busy && recent.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="nt-h2">Недавно разложено</h2>
            <Link to="/all" className="nt-accent text-sm">
              Все заметки →
            </Link>
          </div>
          <div className="space-y-2">
            {recent.map((n) => (
              <NoteCard key={n.id} note={n} topic={n.topicId ? tmap.get(n.topicId) : undefined} compact />
            ))}
          </div>
        </section>
      )}

      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </Wrap>
  );
}

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setPrefs } = usePrefs();
  return (
    <Modal open={open} onClose={onClose} title="Разбор воронки">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-sm font-medium">Модель</div>
          <div className="flex flex-wrap gap-1.5">
            {MODELS.map((m) => (
              <button key={m.id} type="button" className={cn("rounded-full border px-3 py-1.5 text-sm", prefs.model === m.id ? "border-accent bg-accent text-accent-fg" : "border-line")} onClick={() => setPrefs({ model: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Основная — из настроек хаба. Opus точнее склеивает обрывки, но медленнее.</p>
        </div>
        <Switch checked={prefs.autoApply} onChange={(v) => setPrefs({ autoApply: v })} label="Уверенное раскладывать сразу" />
        <p className="-mt-2 text-xs text-muted">В плане останется только то, в чём нейронка сомневается или о чём задала вопрос.</p>
      </div>
    </Modal>
  );
}
