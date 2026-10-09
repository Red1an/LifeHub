import { useEffect, useMemo, useRef, useState } from "react";
import { cn, confirm, Link, Loading, Modal, toast, uid, useCollection, useDoc, useNavigate, useParams, useSearchParams } from "@lifehub/sdk";
import { ChordCard, ChordModal } from "../components/ChordCard";
import { ChordDiagram } from "../components/ChordDiagram";
import { Sheet } from "../components/Sheet";
import { ChordEditor } from "../components/ChordEditor";
import { ScrollDock } from "../components/ScrollDock";
import { SongTabsTab, sectionRange, useSongTabs } from "../components/SongTabs";
import { TabPlayer } from "../components/TabPlayer";
import { autoChords, autoChordsWithText, loadSstMeta, trackLabel, type Part, type SstTrack } from "../lib/songsterr";
import { CHECK_COUNT, SongPracticeTab } from "../components/SongPractice";
import { VideoCard } from "../components/Videos";
import { Btn, Empty, Header, Panel, Pill, Screen, Section, Segments } from "../components/kit";
import { bestShape, transpose } from "../lib/chords";
import { capoOptions, guessKey, mainProgression, parseSheet, sheetChords, transposeSheet, type SheetFormat } from "../lib/sheet";
import { SEED, STATUS_RU, formatOf, fromUg, metaDb, songsDb, type LibSong, type SavedSong, type SongMeta, type SongStatus } from "../lib/songs";
import { markPractice } from "../lib/train-stats";
import { DIFFICULTY_RU, UG_TYPE_RU, loadUg } from "../lib/ug";
import { findLessons, findOriginal } from "../lib/youtube";

type Tab = "text" | "tabs" | "video" | "practice" | "chords";

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

/** Песня по id: встроенная, сохранённая или открытая из поиска Ultimate Guitar. */
function useSong(id: string, meta: { loading: boolean; src?: string }) {
  const saved = useDoc<SavedSong>("songs", id);
  const [params] = useSearchParams();
  const url = params.get("u") ?? meta.src ?? null;
  const seed = SEED.find((s) => s.id === id);
  const [online, setOnline] = useState<SavedSong | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ugId = id.startsWith("ug-") ? Number(id.slice(3)) : null;
  const sstId = id.startsWith("sst-") ? Number(id.slice(4)) : null;
  const needOnline = !seed && !saved.loading && !meta.loading && !saved.doc && (ugId !== null || sstId !== null);

  useEffect(() => {
    if (!needOnline) return;
    let alive = true;
    setError(null);
    // Песня только с Songsterr: текста с аккордами нет, есть табы партий.
    if (sstId !== null) {
      loadSstMeta(sstId).then(
        async (m) => {
          if (!alive) return;
          void metaDb.update(id, { sst: { songId: m.songId, title: m.title, artist: m.artist }, sstAt: Date.now() });
          // Текста с аккордами нет — вычисляем аккорды по партиям и раскладываем по словам вокала.
          const auto = await autoChords(m).catch(() => null);
          if (!alive) return;
          setOnline(
            auto
              ? { title: m.title, artist: m.artist, kind: "chords", body: auto.body, format: "plain", key: auto.key, auto: "songsterr", lyricsFrom: auto.lyricsSource }
              : { title: m.title, artist: m.artist, kind: "tab", body: "" },
          );
        },
        (e) => alive && setError((e as Error).message),
      );
      return () => {
        alive = false;
      };
    }
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
  }, [needOnline, ugId, sstId]);

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
  const [capoOpen, setCapoOpen] = useState(false);
  // Редактор аккордов: текст, который правим (null — не правим), и окно «добавить слова».
  const [editBody, setEditBody] = useState<{ body: string; format?: SheetFormat } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
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
  // Есть ли в тексте слова (не только аккорды и заголовки).
  const hasLyrics = useMemo(() => baseLines.some((l) => (l.t === "pair" && l.lyric.trim()) || l.t === "text"), [baseLines]);
  const sequence = useMemo(() => lines.flatMap((l) => (l.t === "pair" ? l.chords.map((c) => c.chord) : [])), [lines]);
  const soundingChords = useMemo(() => sheetChords(transposeSheet(baseLines, t + songCapo, flats)), [baseLines, t, songCapo, flats]);
  const origKey = song?.key || guessKey(baseLines);
  const keyName = origKey ? transpose(origKey, t, flats) : null;
  const ugShapes = song?.shapes ?? {};
  // Табы вступления и проигрышей прямо в тексте — партия с Songsterr (соло-гитара, если есть).
  const hasInstrumental = useMemo(() => baseLines.some((l) => l.t === "section" && /вступ|intro|проигр|instrument|interlude|соло|solo|рифф|riff/i.test(l.label)), [baseLines]);
  const inline = useSongTabs(id, song?.title ?? "", song?.artist ?? "", meta, tab === "text" && hasInstrumental, "lead");
  // Бой и аппликатуры из оригинала — ритм-партия Songsterr.
  const rhythm = useSongTabs(id, song?.title ?? "", song?.artist ?? "", meta, tab === "practice", "rhythm");
  const sectionExtra = (label: string, occ: number) => {
    if (!inline.part) return null;
    const r = sectionRange(inline.part, label, occ);
    return r ? <InlineTab part={inline.part} from={r.from} to={r.to} label={r.label} track={inline.meta?.tracks.find((t) => t.partId === inline.partId)} /> : null;
  };

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
        className="sticky top-[calc(2.75rem+env(safe-area-inset-top))] z-20 mb-4 backdrop-blur lg:top-2"
        items={[
          { id: "text", label: song.kind === "tab" ? "Таб" : "Текст" },
          { id: "tabs", label: "🎸 Табы" },
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
              {song.body.trim() && (
                <button onClick={() => setEditBody({ body: song.body, format: formatOf(song) })} data-on={!!editBody} className="gt-chip !min-h-10" title="Расставить или поправить аккорды над словами">
                  ✏️ Аккорды
                </button>
              )}
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
            {editBody ? (
              <ChordEditor
                body={editBody.body}
                format={editBody.format}
                palette={[...new Set([...sheetChords(baseLines), ...sheetChords(parseSheet(editBody.body, editBody.format))])]}
                saving={savingEdit}
                onCancel={() => setEditBody(null)}
                onSave={async (body) => {
                  setSavingEdit(true);
                  try {
                    if (id.startsWith("u-")) {
                      await songsDb.update(id, { body, format: "plain" });
                      toast("Аккорды сохранены", "success");
                      setEditBody(null);
                    } else {
                      // Встроенную или найденную песню не трогаем — сохраняем свою версию.
                      const { id: _i, builtIn: _b, ...data } = song;
                      const newId = `u-${uid()}`;
                      await songsDb.put(newId, { ...data, body, format: "plain", kind: "chords", auto: undefined, source: undefined, addedAt: Date.now() });
                      toast("Сохранено как твоя версия песни", "success");
                      setEditBody(null);
                      navigate(`/song/${newId}`);
                    }
                  } finally {
                    setSavingEdit(false);
                  }
                }}
              />
            ) : (
              <>
            {song.auto && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--gt-violet)]/10 px-3 py-2 font-sans text-xs text-[var(--gt-muted)]">
                <span className="min-w-0 flex-1">
                  🪄 Аккорды проставлены автоматически по табам партий (Songsterr){song.lyricsFrom && song.lyricsFrom !== "таб" ? `, слова — ${song.lyricsFrom}` : ""}. Могут быть неточности — сверяй с оригиналом и правь «✏️ Аккорды».
                </span>
                {!hasLyrics && (
                  <button className="gt-btn gt-btn-brass !min-h-8 !px-3 text-xs" onClick={() => setWordsOpen(true)}>
                    📝 Добавить слова
                  </button>
                )}
              </div>
            )}
            {song.body.trim() && chords.length === 0 && <AutoChordsOffer id={id} song={song} meta={meta} />}
            {song.body.trim() ? (
              <Sheet lines={lines} fontSize={font} hideChords={hide} onChord={setChord} sectionExtra={sectionExtra} />
            ) : (
              <div className="py-6 text-center text-sm text-[var(--gt-muted)]">
                Текста с аккордами для этой песни нет — смотри табы партий на вкладке{" "}
                <button className="text-[var(--gt-brass)] underline" onClick={() => setTab("tabs")}>
                  «Табы»
                </button>
                .
              </div>
            )}
              </>
            )}
          </div>
          <AddWords
            open={wordsOpen}
            onClose={() => setWordsOpen(false)}
            sstId={meta.sst?.songId ?? null}
            onResult={(body, aligned) => {
              setWordsOpen(false);
              setEditBody({ body, format: "plain" });
              toast(aligned ? "Слова разложены по мелодии — проверь и поправь аккорды, потом «Сохранить»" : "В табе нет мелодии вокала — расставь аккорды нажатием на слова", "success");
            }}
          />

          {song.source?.url && (
            <div className="mt-3 text-center text-xs text-[var(--gt-muted)]">
              Источник:{" "}
              <a href={song.source.url} target="_blank" rel="noreferrer" className="underline">
                Ultimate Guitar
              </a>
            </div>
          )}

          <div className="h-24" />
          <ScrollDock
            songId={id}
            target={sheetRef}
            sequence={sequence}
            capo={capo}
            speed={meta.scrollSpeed}
            onSpeed={(v) => setMeta({ scrollSpeed: v })}
            duration={meta.original?.d}
          />
        </>
      )}

      {tab === "tabs" && <SongTabsTab id={id} title={song.title} artist={song.artist} meta={meta} />}

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
          rhythmPart={rhythm.part}
          rhythmLoading={rhythm.loading}
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

/** Раскрываемый таб части (вступление, проигрыш, соло) под её заголовком в тексте. */
function InlineTab({ part, from, to, label, track }: { part: Part; from: number; to: number; label: string; track?: SstTrack }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2" style={{ fontFamily: "'Golos Text', sans-serif", fontSize: 14 }}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl border border-[var(--gt-line)] bg-[var(--gt-panel-2)] px-3 py-1.5 text-xs font-semibold">
        <span>🎸</span>
        <span>
          Таб: {label}
          {track ? <span className="text-[var(--gt-muted)]"> · {trackLabel(track)}</span> : null}
        </span>
        <span className="text-[var(--gt-muted)]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="gt-slide mt-2 rounded-xl bg-black/20 p-2">
          <TabPlayer part={part} from={from} to={to} compact />
        </div>
      )}
    </div>
  );
}

/** Песня без аккордов (таб, свой текст): вычислить аккорды по табам партий этой песни. */
function AutoChordsOffer({ id, song, meta }: { id: string; song: LibSong; meta: SongMeta }) {
  const [want, setWant] = useState(false);
  const tabs = useSongTabs(id, song.title, song.artist, meta, want);
  const [result, setResult] = useState<{ body: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!want || !tabs.meta || result) return;
    setBusy(true);
    autoChords(tabs.meta)
      .then((r) => (r ? setResult({ body: r.body, key: r.key }) : setError("Не получилось вычислить аккорды по этим табам.")))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, [want, tabs.meta?.songId]);

  const lines = useMemo(() => (result ? parseSheet(result.body, "plain") : []), [result]);
  const save = async () => {
    if (!result) return;
    const newId = `u-${uid()}`;
    await songsDb.put(newId, { title: song.title, artist: song.artist, kind: "chords", body: result.body, format: "plain", key: result.key, auto: "songsterr", addedAt: Date.now() });
    toast("Сохранено отдельной песней с аккордами", "success");
    navigate(`/song/${newId}`);
  };

  if (!want)
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--gt-panel-2)] px-3 py-2 font-sans text-sm">
        <span className="flex-1 text-[var(--gt-muted)]">В этой версии нет аккордов.</span>
        <button className="gt-btn gt-btn-brass !min-h-9 text-sm" onClick={() => setWant(true)}>
          🪄 Проставить аккорды
        </button>
      </div>
    );
  return (
    <div className="mb-4 rounded-xl border border-[var(--gt-violet)]/40 p-3 font-sans text-sm">
      {(busy || tabs.loading) && !result && <div className="text-[var(--gt-muted)]">Ищу табы партий и вычисляю аккорды…</div>}
      {(tabs.notFound || error) && <div className="text-[var(--gt-muted)]">{error ?? "Табов этой песни на Songsterr нет — проставить аккорды не по чему."}</div>}
      {result && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex-1 text-[var(--gt-muted)]">🪄 Аккорды по табам партий · тональность {result.key}</span>
            <button className="gt-btn gt-btn-brass !min-h-9 text-sm" onClick={save}>
              Сохранить как песню с аккордами
            </button>
          </div>
          <div className="gt-mono" style={{ fontSize: 14 }}>
            <Sheet lines={lines} fontSize={14} onChord={() => {}} />
          </div>
        </>
      )}
    </div>
  );
}

/** Окно «Добавить слова»: вставленный текст раскладывается по вокальной мелодии из табов. */
function AddWords({ open, onClose, sstId, onResult }: { open: boolean; onClose: () => void; sstId: number | null; onResult: (body: string, aligned: boolean) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const m = sstId ? await loadSstMeta(sstId) : null;
      const r = m ? await autoChordsWithText(m, text) : null;
      if (r) onResult(r.body, true);
      else onResult(text.trim(), false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Слова песни">
      <div className="space-y-3">
        <div className="text-sm text-[var(--gt-muted)]">Вставь текст песни по строкам. Если в табе есть мелодия вокала, разложу слова по ней и поставлю аккорды над нужными словами; дальше можно поправить вручную.</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="gt-input w-full text-sm" placeholder={"Первая строка песни\nВторая строка…"} />
        <Btn block onClick={run} loading={busy} disabled={!text.trim()}>
          Расставить аккорды
        </Btn>
      </div>
    </Modal>
  );
}
