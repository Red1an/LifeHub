import { useEffect, useMemo, useState } from "react";
import { cn } from "@lifehub/sdk";
import { metaDb, type SongMeta } from "../lib/songs";
import { bestMatch, defaultTrack, loadPart, loadSstMeta, searchSst, sections, trackLabel, type Part, type SstMeta, type SstSong } from "../lib/songsterr";
import { groupResults, loadUg, searchUg, ugScore } from "../lib/ug";
import { parseSheet, sectionLabel } from "../lib/sheet";
import { Sheet } from "./Sheet";
import { TabPlayer } from "./TabPlayer";
import { Panel, Section } from "./kit";

const metaCache = new Map<number, Promise<SstMeta>>();
function sstMeta(songId: number) {
  let p = metaCache.get(songId);
  if (!p) {
    p = loadSstMeta(songId);
    p.catch(() => metaCache.delete(songId));
    metaCache.set(songId, p);
  }
  return p;
}

const searchCache = new Map<string, Promise<SstSong[]>>();
function sstSearch(q: string) {
  let p = searchCache.get(q);
  if (!p) {
    p = searchSst(q, 15);
    p.catch(() => searchCache.delete(q));
    searchCache.set(q, p);
  }
  return p;
}

/**
 * Табы песни с Songsterr: находит песню один раз (запоминает в songMeta.sst), грузит выбранную партию.
 * prefer "lead" — для вставок вступления/проигрыша в текст: там важнее соло-партия.
 */
export function useSongTabs(id: string, title: string, artist: string, meta: SongMeta, enabled: boolean, prefer: "lead" | "rhythm" | "any" = "any") {
  const [sm, setSm] = useState<SstMeta | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const found = meta.sst;
  const checked = meta.sstAt !== undefined;

  // 1. Найти песню на Songsterr (один раз).
  useEffect(() => {
    if (!enabled || checked || !title) return;
    let alive = true;
    setLoading(true);
    sstSearch(`${artist} ${title}`)
      .then(async (list) => {
        let best = bestMatch(list, title, artist);
        if (!best) best = bestMatch(await sstSearch(title), title, artist);
        if (alive) await metaDb.update(id, { sst: best ? { songId: best.songId, title: best.title, artist: best.artist } : null, sstAt: Date.now() });
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [enabled, checked, id, title, artist]);

  // 2. Описание песни и партия.
  // Для боя и аппликатур нужна ритм-партия — выбор партии во вкладке «Табы» на это не влияет.
  const trackId = prefer === "rhythm" ? null : meta.sstTrack;
  useEffect(() => {
    if (!enabled || !found) return;
    let alive = true;
    setLoading(true);
    setError(null);
    sstMeta(found.songId)
      .then(async (m) => {
        if (!alive) return;
        setSm(m);
        const pid = typeof trackId === "number" && m.tracks.some((t) => t.partId === trackId) ? trackId : defaultTrack(m, prefer);
        const p = await loadPart(m, pid);
        if (alive) setPart(p);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [enabled, found?.songId, trackId, prefer]);

  const partId = sm ? (typeof trackId === "number" && sm.tracks.some((t) => t.partId === trackId) ? trackId : defaultTrack(sm, prefer)) : null;
  return { meta: sm, part, partId, error, loading: loading || (enabled && !checked && !error), notFound: checked && !found };
}

const KIND_RE = {
  intro: /вступ|intro|интро/i,
  inter: /проигр|instrument|interlude|соло|solo|рифф|riff|break|бридж|bridge|outro|концовк|кода|coda/i,
};

/** Диапазон тактов партии для секции текста («Вступление», 2-й «Проигрыш»…). */
export function sectionRange(part: Part, label: string, occurrence: number): { from: number; to: number; label: string } | null {
  const kind = KIND_RE.intro.test(label) ? "intro" : KIND_RE.inter.test(label) ? "inter" : null;
  if (!kind) return null;
  const re = KIND_RE[kind];
  const norm = (s: string) => sectionLabel(s).toLowerCase().replace(/\d+/g, "").trim();
  const all = sections(part).filter((s) => re.test(sectionLabel(s.label)));
  if (!all.length) return null;
  const same = all.filter((s) => norm(s.label) === norm(label));
  const pool = same.length ? same : all;
  return pool[Math.min(occurrence, pool.length - 1)];
}

/** Вкладка «Табы» на странице песни. */
export function SongTabsTab({ id, title, artist, meta }: { id: string; title: string; artist: string; meta: SongMeta }) {
  const tabs = useSongTabs(id, title, artist, meta, true);
  const [alts, setAlts] = useState<SstSong[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);

  const findAlts = async (fingerstyle: boolean) => {
    setAltLoading(true);
    try {
      const list = await sstSearch(fingerstyle ? `${title} fingerstyle` : `${artist} ${title}`);
      const extra = fingerstyle ? await sstSearch(`${title} acoustic`).catch(() => []) : [];
      setAlts([...list, ...extra].filter((s, i, a) => a.findIndex((x) => x.songId === s.songId) === i));
    } finally {
      setAltLoading(false);
    }
  };

  const guitarTracks = tabs.meta?.tracks.filter((t) => t.kind !== "other") ?? [];

  return (
    <div>
      {tabs.loading && !tabs.part && (
        <Panel className="text-center text-sm text-[var(--gt-muted)]">
          <span className="gt-eq mr-2 text-[var(--gt-brass)]">
            <span />
            <span />
            <span />
          </span>
          Ищу табы партий…
        </Panel>
      )}
      {tabs.error && <Panel className="text-sm text-[var(--gt-red)]">Не удалось загрузить табы: {tabs.error}</Panel>}

      {tabs.notFound && (
        <Panel className="text-sm">
          <b>На Songsterr этой песни нет.</b> <span className="text-[var(--gt-muted)]">Поищи другую версию ниже или возьми текстовый таб с Ultimate Guitar.</span>
        </Panel>
      )}

      {tabs.meta && (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-[var(--gt-muted)]">
              {tabs.meta.artist} — {tabs.meta.title}
              {tabs.meta.fingerstyle && <span className="ml-2 text-[var(--gt-violet)]">фингерстайл</span>}
            </span>
            <a className="text-xs text-[var(--gt-muted)] underline" href={`https://www.songsterr.com/a/wsa/song-tab-s${tabs.meta.songId}t${tabs.partId ?? 0}`} target="_blank" rel="noreferrer">
              Songsterr ↗
            </a>
          </div>
          <div className="gt-scroll-x mb-3">
            {guitarTracks.map((t) => (
              <button key={t.partId} data-on={t.partId === tabs.partId} onClick={() => metaDb.update(id, { sstTrack: t.partId })} className="gt-chip !min-h-9 shrink-0 text-xs">
                {t.kind === "bass" ? "🎸 бас · " : ""}
                {trackLabel(t)}
                {t.difficulty ? <span className="opacity-60"> · {"●".repeat(Math.min(5, t.difficulty))}</span> : null}
              </button>
            ))}
          </div>
        </>
      )}

      {tabs.part && (
        <Panel className="!px-2 !py-3 sm:!px-4">
          <TabPlayer part={tabs.part} />
          <div className="mt-3 px-2 text-xs text-[var(--gt-muted)]">
            Нажми на такт — заиграет с него. «🔁 Петля» — выбери первый и последний такт, кусок будет повторяться. Цифры — лады, ⌒ — легато (hammer-on/pull-off), / \ — слайд, ↑ — подтяжка, ~ — вибрато, x — глушёная.
          </div>
        </Panel>
      )}

      <Section title="Другие аранжировки">
        <div className="flex flex-wrap gap-2">
          <button className="gt-chip" onClick={() => findAlts(true)}>
            🖐 Фингерстайл и акустика
          </button>
          <button className="gt-chip" onClick={() => findAlts(false)}>
            🎸 Другие версии
          </button>
        </div>
        {altLoading && <div className="mt-2 text-sm text-[var(--gt-muted)]">Ищу…</div>}
        {alts && (
          <div className="mt-3 space-y-2">
            {alts.length === 0 && <div className="text-sm text-[var(--gt-muted)]">Ничего не нашлось.</div>}
            {alts.slice(0, 10).map((s) => (
              <button
                key={s.songId}
                onClick={() => metaDb.update(id, { sst: { songId: s.songId, title: s.title, artist: s.artist }, sstAt: Date.now(), sstTrack: null })}
                className={cn("gt-panel flex w-full items-center gap-3 !rounded-2xl p-3 text-left", tabs.meta?.songId === s.songId && "border-[var(--gt-brass)]")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title}</span>
                  <span className="block truncate text-xs text-[var(--gt-muted)]">
                    {s.artist} · {s.tracks.filter((t) => t.kind === "guitar").length} гит. партий
                  </span>
                </span>
                {tabs.meta?.songId === s.songId && <span className="text-xs text-[var(--gt-brass)]">выбрано</span>}
              </button>
            ))}
          </div>
        )}
      </Section>

      <UgTextTab title={title} artist={artist} />
    </div>
  );
}

/** Текстовый таб с Ultimate Guitar — запасной вариант (бывает для песен, которых нет на Songsterr). */
function UgTextTab({ title, artist }: { title: string; artist: string }) {
  const [state, setState] = useState<{ loading: boolean; body?: string; url?: string; error?: string }>({ loading: false });
  const lines = useMemo(() => (state.body ? parseSheet(state.body) : []), [state.body]);
  const load = async () => {
    setState({ loading: true });
    try {
      const groups = groupResults(await searchUg(`${artist} ${title}`), `${artist} ${title}`);
      const tab = groups[0]?.versions.filter((v) => v.type === "Tabs").sort((a, b) => ugScore(b) - ugScore(a))[0];
      if (!tab) return setState({ loading: false, error: "На Ultimate Guitar текстового таба тоже нет." });
      const s = await loadUg(tab.id, tab.url);
      setState({ loading: false, body: s.content, url: s.url });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  };
  return (
    <Section title="Текстовый таб">
      {!state.body && (
        <button className="gt-btn gt-btn-ghost" onClick={load} disabled={state.loading}>
          {state.loading ? "Ищу…" : "Найти на Ultimate Guitar"}
        </button>
      )}
      {state.error && <div className="mt-2 text-sm text-[var(--gt-muted)]">{state.error}</div>}
      {state.body && (
        <Panel className="!px-3">
          <Sheet lines={lines} fontSize={13} onChord={() => {}} />
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs text-[var(--gt-muted)] underline">
              Ultimate Guitar ↗
            </a>
          )}
        </Panel>
      )}
    </Section>
  );
}
