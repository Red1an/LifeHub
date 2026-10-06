import { useEffect, useMemo, useRef, useState } from "react";
import { cn, confirm, Link, Loading, toast, useCollection, useDoc, useNavigate, useParams, useSearchParams } from "@lifehub/sdk";
import { ChordCard, ChordModal } from "../components/ChordCard";
import { ChordDiagram } from "../components/ChordDiagram";
import { Sheet } from "../components/Sheet";
import { CHECK_COUNT, SongPracticeTab } from "../components/SongPractice";
import { VideoCard } from "../components/Videos";
import { Btn, Empty, Header, Panel, Pill, Screen, Section, Segments } from "../components/kit";
import { bestShape, transpose } from "../lib/chords";
import { capoOptions, guessKey, mainProgression, parseSheet, sheetChords, transposeSheet } from "../lib/sheet";
import { SEED, STATUS_RU, formatOf, fromUg, metaDb, songsDb, type LibSong, type SavedSong, type SongMeta, type SongStatus } from "../lib/songs";
import { markPractice } from "../lib/train-stats";
import { DIFFICULTY_RU, UG_TYPE_RU, loadUg } from "../lib/ug";
import { findLessons, findOriginal } from "../lib/youtube";

type Tab = "text" | "video" | "practice" | "chords";

const ugCache = new Map<number, Promise<SavedSong>>();
function fetchUg(id: number, url: string | null) {
  let p = ugCache.get(id);
  if (!p) {
    p = loadUg(id, url).then(fromUg);
    p.catch(() => ugCache.delete(id));
    ugCache.set(id, p);
  }
  return p;
}

/** Ближайший прокручиваемый контейнер (модуль живёт внутри рамки хаба). */
function scrollParent(el: HTMLElement | null): HTMLElement {
  let n = el?.parentElement ?? null;
  while (n) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** Песня по id: встроенная, сохранённая или открытая из поиска Ultimate Guitar. */
function useSong(id: string, meta: { loading: boolean; src?: string }) {
  const saved = useDoc<SavedSong>("songs", id);
  const [params] = useSearchParams();
  const url = params.get("u") ?? meta.src ?? null;
  const seed = SEED.find((s) => s.id === id);
  const [online, setOnline] = useState<SavedSong | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ugId = id.startsWith("ug-") ? Number(id.slice(3)) : null;
  const needOnline = !seed && !saved.loading && !meta.loading && !saved.doc && ugId !== null;

  useEffect(() => {
    if (!needOnline) return;
    let alive = true;
    setError(null);
    fetchUg(ugId!, url).then(
      (s) => {
        if (!alive) return;
        setOnline(s);
        if (url && url !== meta.src) void metaDb.update(id, { src: url });
      },
      (e) => alive && setError((e as Error).message),
    );
    return () => {
      alive = false;
    };
  }, [needOnline, ugId]);

  const song: LibSong | null = seed ?? (saved.doc ? { ...saved.doc, id } : online ? { ...online, id } : null);
  return { song, isSaved: !!saved.doc, loading: !seed && (saved.loading || (needOnline && !online && !error)), error };
}

export function SongPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const metaDoc = useDoc<SongMeta>("songMeta", id);
  const { song, isSaved, loading, error } = useSong(id, { loading: metaDoc.loading, src: metaDoc.doc?.src });
  const meta: SongMeta = metaDoc.doc ?? {};
  const [tab, setTab] = useState<Tab>("text");
  const [chord, setChord] = useState<string | null>(null);
  const [hide, setHide] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(25);
  const [capoOpen, setCapoOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const setMeta = (patch: Partial<SongMeta>) => metaDb.update(id, { title: song?.title, artist: song?.artist, ...patch });

  useEffect(() => {
    if (song) void metaDb.update(id, { title: song.title, artist: song.artist, openedAt: Date.now() });
  }, [id, !!song]);

  const songCapo = song?.capo ?? 0;
  const t = meta.transpose ?? 0;
  const capo = meta.capo ?? songCapo;
  const shift = t + songCapo - capo;
  const flats = meta.flats ?? false;
  const font = meta.font ?? 15;

  const baseLines = useMemo(() => (song ? parseSheet(song.body, formatOf(song)) : []), [song?.body]);
  const lines = useMemo(() => transposeSheet(baseLines, shift, flats), [baseLines, shift, flats]);
  const chords = useMemo(() => sheetChords(lines), [lines]);
  const progression = useMemo(() => mainProgression(lines), [lines]);
  const soundingChords = useMemo(() => sheetChords(transposeSheet(baseLines, t + songCapo, flats)), [baseLines, t, songCapo, flats]);
  const origKey = song?.key || guessKey(baseLines);
  const keyName = origKey ? transpose(origKey, t, flats) : null;
  const ugShapes = song?.shapes ?? {};

  // Автопрокрутка.
  useEffect(() => {
    if (!scrolling) return;
    const box = scrollParent(sheetRef.current);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    markPractice(`song:${id}`);
    const step = (now: number) => {
      acc += (speed * (now - last)) / 1000;
      last = now;
      if (acc >= 1) {
        const px = Math.floor(acc);
        acc -= px;
        const before = box.scrollTop;
        box.scrollTop += px;
        if (box.scrollTop === before && before > 0) return setScrolling(false);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const stop = () => setScrolling(false);
    box.addEventListener("touchstart", stop, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      box.removeEventListener("touchstart", stop);
    };
  }, [scrolling, speed]);

  if (loading) return <Loading />;
  if (!song)
    return (
      <Screen>
        <Empty icon="🎸" title="Песня не найдена" text={error ?? "Возможно, её удалили на другом устройстве."}>
          <Link to="/songs" className="gt-btn gt-btn-ghost mt-2">
            ← К песням
          </Link>
        </Empty>
      </Screen>
    );

  const save = async () => {
    const { id: _id, builtIn: _b, ...data } = song;
    await songsDb.put(id, { ...data, addedAt: Date.now() });
    if (!meta.status) await setMeta({ status: "learning" });
    toast("Сохранено в мои песни", "success");
  };
  const remove = async () => {
    if (!(await confirm("Удалить песню из библиотеки?", { danger: true }))) return;
    await songsDb.remove(id);
    navigate("/songs");
  };
  const toggleCheck = (c: string) => {
    const cur = meta.checks ?? [];
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    const patch: Partial<SongMeta> = { checks: next };
    if (next.length === CHECK_COUNT) {
      patch.status = "learned";
      toast("Песня выучена! 🎉", "success");
    } else if (next.length && !meta.status) patch.status = "learning";
    void setMeta(patch);
    markPractice(`song:${id}`);
  };
  const capoList = capoOptions(soundingChords).slice(0, 4);

  return (
    <Screen>
      <Header
        back="/songs"
        title={song.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[var(--gt-fg)]">{song.artist}</span>
            {keyName && <Pill color="var(--gt-sky)">тональность {keyName}</Pill>}
            {song.source?.type && <Pill>{UG_TYPE_RU[song.source.type] ?? song.source.type}</Pill>}
            {song.source?.rating ? <Pill color="var(--gt-brass)">★ {song.source.rating.toFixed(1)} · {song.source.votes}</Pill> : null}
            {song.difficulty && <Pill>{DIFFICULTY_RU[song.difficulty] ?? { easy: "лёгкая", medium: "средняя", hard: "сложная" }[song.difficulty] ?? song.difficulty}</Pill>}
          </span>
        }
        right={
          <button onClick={() => setMeta({ fav: !meta.fav })} className={cn("gt-btn gt-btn-ghost !min-h-10 !px-3 text-lg", meta.fav && "!text-[var(--gt-brass)]")} aria-label="Избранное">
            {meta.fav ? "★" : "☆"}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_RU) as SongStatus[]).map((s) => (
          <button key={s} data-on={meta.status === s} onClick={() => setMeta({ status: meta.status === s ? undefined : s })} className="gt-chip !min-h-8 text-xs">
            {STATUS_RU[s].icon} {STATUS_RU[s].label}
          </button>
        ))}
        <span className="flex-1" />
        {!song.builtIn && !isSaved && (
          <Btn className="!min-h-9 text-sm" onClick={save}>
            ＋ В мои песни
          </Btn>
        )}
        {isSaved && (
          <button onClick={remove} className="text-xs text-[var(--gt-muted)] hover:text-[var(--gt-red)]">
            Удалить
          </button>
        )}
      </div>

      <Segments
        value={tab}
        onChange={setTab}
        className="sticky top-0 z-20 mb-4 backdrop-blur"
        items={[
          { id: "text", label: song.kind === "tab" ? "Таб" : "Текст" },
          { id: "video", label: "Видео" },
          { id: "practice", label: "Практика" },
          { id: "chords", label: `Аккорды${chords.length ? ` · ${chords.length}` : ""}` },
        ]}
      />

      {tab === "text" && (
        <>
          <Panel className="mb-3 !p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <div className="flex items-center gap-1 rounded-xl bg-[var(--gt-panel-2)] p-1">
                <button className="size-8 rounded-lg font-bold hover:bg-white/5" onClick={() => setMeta({ transpose: t - 1 })} aria-label="Ниже на полтона">−</button>
                <span className="min-w-16 text-center text-xs">
                  <span className="block text-[var(--gt-muted)]">тон</span>
                  <b>{t === 0 ? keyName ?? "0" : `${t > 0 ? "+" : ""}${t}`}</b>
                </span>
                <button className="size-8 rounded-lg font-bold hover:bg-white/5" onClick={() => setMeta({ transpose: t + 1 })} aria-label="Выше на полтона">+</button>
              </div>
              <button data-on={capo > 0} onClick={() => setCapoOpen(!capoOpen)} className="gt-chip !min-h-10">
                🗜 {capo ? `Каподастр ${capo}` : "Каподастр"}
              </button>
              <button data-on={hide} onClick={() => setHide(!hide)} className="gt-chip !min-h-10" title="Режим подбора: аккорды скрыты">
                🙈 Подбор
              </button>
              <div className="flex items-center gap-1 rounded-xl bg-[var(--gt-panel-2)] p-1">
                <button className="size-8 rounded-lg hover:bg-white/5" onClick={() => setMeta({ font: Math.max(11, font - 1) })} aria-label="Мельче">
                  A−
                </button>
                <button className="size-8 rounded-lg hover:bg-white/5" onClick={() => setMeta({ font: Math.min(24, font + 1) })} aria-label="Крупнее">
                  A+
                </button>
              </div>
              <button onClick={() => setMeta({ flats: !flats })} data-on={flats} className="gt-chip !min-h-10">♭</button>
              {(t !== 0 || capo !== songCapo) && (
                <button className="text-xs text-[var(--gt-muted)] underline" onClick={() => setMeta({ transpose: 0, capo: songCapo })}>
                  как в оригинале
                </button>
              )}
            </div>
            {capoOpen && (
              <div className="gt-slide mt-3 border-t border-[var(--gt-line)] pt-3">
                <div className="mb-2 text-xs text-[var(--gt-muted)]">
                  Звучит так же, но играется знакомыми формами. Выбери вариант — аккорды в тексте поменяются.
                  {songCapo ? ` В оригинале каподастр на ${songCapo} ладу.` : ""}
                </div>
                <div className="grid gap-2">
                  {capoList.map((o) => (
                    <button
                      key={o.capo}
                      onClick={() => {
                        setMeta({ capo: o.capo });
                        setCapoOpen(false);
                      }}
                      className={cn("flex items-center gap-3 rounded-xl border p-2 text-left text-sm", o.capo === capo ? "border-[var(--gt-brass)] bg-[var(--gt-brass)]/10" : "border-[var(--gt-line)]")}
                    >
                      <span className="gt-num w-20 shrink-0 font-bold">{o.capo ? `${o.capo} лад` : "без капо"}</span>
                      <span className="min-w-0 flex-1 truncate">{o.chords.join(" ")}</span>
                      <span className="shrink-0 text-xs text-[var(--gt-muted)]">{o.hard ? `сложных: ${o.hard}` : "все простые"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {chords.length > 0 && (
            <div className="gt-scroll-x mb-3 pb-1">
              {chords.map((c) => (
                <button key={c} onClick={() => setChord(c)} className="gt-panel shrink-0 !rounded-2xl px-1 pt-1 transition hover:-translate-y-0.5">
                  <ChordDiagram chord={c} shape={(shift === 0 && ugShapes[c]?.[0]) || bestShape(c)} size={66} fingers={false} />
                </button>
              ))}
            </div>
          )}

          {hide && (
            <Panel className="mb-3 !p-3 text-sm">
              <b>Режим подбора.</b> <span className="text-[var(--gt-muted)]">Включи оригинал на вкладке «Видео», подбери аккорд на слух и нажми на скрытый — проверить.</span>
            </Panel>
          )}

          <div ref={sheetRef} className="gt-panel px-3 py-4 sm:px-6">
            <Sheet lines={lines} fontSize={font} hideChords={hide} onChord={setChord} />
          </div>

          {song.source?.url && (
            <div className="mt-3 text-center text-xs text-[var(--gt-muted)]">
              Источник:{" "}
              <a href={song.source.url} target="_blank" rel="noreferrer" className="underline">
                Ultimate Guitar
              </a>
            </div>
          )}

          <div className="sticky bottom-3 z-20 mt-4 flex justify-end">
            <div className="gt-panel flex items-center gap-2 !rounded-full p-1.5 pl-3 shadow-xl">
              {scrolling && <input type="range" min={8} max={90} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[var(--gt-brass)]" aria-label="Скорость прокрутки" />}
              <button className={cn("gt-btn !min-h-10 !rounded-full", scrolling ? "gt-btn-ghost" : "gt-btn-brass")} onClick={() => setScrolling(!scrolling)}>
                {scrolling ? "⏸" : "▶ Прокрутка"}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "video" && <SongVideos id={id} song={song} meta={meta} />}

      {tab === "practice" && (
        <SongPracticeTab
          songId={id}
          chords={chords}
          progression={progression}
          keyName={keyName}
          strums={song.strums ?? []}
          checks={meta.checks ?? []}
          onToggleCheck={toggleCheck}
          onEar={() => {
            setHide(true);
            setTab("text");
          }}
        />
      )}

      {tab === "chords" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {chords.map((c) => (
            <Panel key={c} className="!p-3">
              <div className="gt-display mb-1 text-center text-xl font-bold">{c}</div>
              <ChordCard chord={c} extra={shift === 0 ? ugShapes[c] : undefined} size={130} />
            </Panel>
          ))}
          {chords.length === 0 && <Empty icon="🎼" title="Аккордов нет" text="Это табулатура — аккорды в ней не размечены." />}
        </div>
      )}

      <ChordModal chord={chord} extra={shift === 0 && chord ? ugShapes[chord] : undefined} onClose={() => setChord(null)} />
    </Screen>
  );
}

/** Вкладка «Видео»: лучшие разборы и оригинал, ищутся один раз и запоминаются. */
function SongVideos({ id, song, meta }: { id: string; song: LibSong; meta: SongMeta }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watched = useCollection<{ at: number }>("watched");
  const seen = new Set(watched.items.map((w) => w.id));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [lessons, original] = await Promise.all([findLessons(song.title, song.artist), findOriginal(song.title, song.artist)]);
      await metaDb.update(id, { lessons, original, videosAt: Date.now(), title: song.title, artist: song.artist });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!meta.videosAt && !loading) void load();
  }, [id]);

  const lessons = meta.lessons ?? [];
  return (
    <div>
      {meta.original && (
        <Section title="Оригинал" className="!mt-0" right={<span className="text-xs text-[var(--gt-muted)]">слушать и подбирать</span>}>
          <VideoCard video={meta.original} badge="оригинал" />
        </Section>
      )}
      <Section
        title="Разборы"
        className={meta.original ? "" : "!mt-0"}
        right={
          <button className="text-xs text-[var(--gt-muted)] underline" onClick={load} disabled={loading}>
            {loading ? "ищу…" : "обновить"}
          </button>
        }
      >
        {loading && !lessons.length && (
          <Panel className="text-center text-sm text-[var(--gt-muted)]">
            <span className="gt-eq mr-2 text-[var(--gt-brass)]"><span /><span /><span /></span>Ищу лучшие разборы на YouTube…
          </Panel>
        )}
        {error && <Panel className="text-sm text-[var(--gt-red)]">Не получилось найти видео: {error}</Panel>}
        {!loading && !error && !lessons.length && meta.videosAt && <Panel className="text-sm text-[var(--gt-muted)]">Разборов не нашлось — попробуй поиск на YouTube.</Panel>}
        <div className="grid gap-3 sm:grid-cols-2">
          {lessons.map((v, i) => (
            <VideoCard key={v.id} video={v} badge={i === 0 ? "лучший" : undefined} seen={seen.has(v.id)} onWatched={(x) => watched.put(x.id, { at: Date.now() })} />
          ))}
        </div>
        <a className="gt-btn gt-btn-ghost mt-3 !min-h-9 text-sm" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.artist} ${song.title} разбор на гитаре`)}`} target="_blank" rel="noreferrer">
          🔎 Искать на YouTube
        </a>
      </Section>
    </div>
  );
}
