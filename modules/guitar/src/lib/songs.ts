import { useEffect, useMemo } from "react";
import { db, useCollection } from "@lifehub/sdk";
import { SEED_SONGS } from "../data/songs";
import type { Video } from "../data/videos";
import type { ChordShape } from "./chord-shapes";
import { detectFormat, type SheetFormat } from "./sheet";
import { hubStorage } from "./storage";
import type { UgSong, UgStrum } from "./ug";

/*
 * Песни: встроенные (data/songs.ts, id «s-<slug>»), свои и сохранённые из поиска (коллекция songs,
 * у сохранённых с UG id «ug-<номер>»). Всё личное о песне — статус, избранное, тональность, найденные
 * видео — в коллекции songMeta с тем же id; так работает и для песен, открытых из поиска без сохранения.
 */

export interface SavedSong {
  title: string;
  artist: string;
  key?: string;
  capo?: number;
  difficulty?: string;
  kind: "chords" | "tab";
  body: string;
  format?: SheetFormat;
  source?: { site: "ug"; id: number; url: string; rating?: number; votes?: number; type?: string };
  shapes?: Record<string, ChordShape[]>;
  strums?: UgStrum[];
  tags?: string[];
  addedAt?: number;
  /** Аккорды проставлены автоматически (по табам Songsterr, lib/autochords.ts). */
  auto?: "songsterr";
  /** Откуда слова у автоматической версии: «таб», «LRCLIB»… */
  lyricsFrom?: string;
}

export type SongStatus = "want" | "learning" | "learned";

export interface SongMeta {
  title?: string;
  artist?: string;
  status?: SongStatus;
  fav?: boolean;
  transpose?: number;
  capo?: number;
  flats?: boolean;
  font?: number;
  openedAt?: number;
  lessons?: Video[];
  original?: Video | null;
  videosAt?: number;
  /** Скорость автопрокрутки этой песни, пикс/с (подстраивается под игру). */
  scrollSpeed?: number;
  /** Песня на Songsterr (табы партий); null — искали и не нашли. */
  sst?: { songId: number; title: string; artist: string } | null;
  sstAt?: number;
  /** Выбранная партия Songsterr. */
  sstTrack?: number | null;
  /** Полный адрес версии на Ultimate Guitar (для песен, открытых из поиска). */
  src?: string;
  /** Пункты чек-листа разучивания (components/SongPractice). */
  checks?: string[];
}

export interface LibSong extends SavedSong {
  id: string;
  builtIn?: boolean;
}

export const songsDb = db.collection<SavedSong>("songs");
export const metaDb = db.collection<SongMeta>("songMeta");

export const SEED: LibSong[] = SEED_SONGS.map((s) => ({
  id: `s-${s.slug}`,
  builtIn: true,
  title: s.title,
  artist: s.artist,
  key: s.key,
  capo: s.capo,
  difficulty: s.difficulty,
  kind: s.contentType === "tab" ? "tab" : "chords",
  body: s.body,
  format: s.contentType === "tab" ? "plain" : "chordpro",
  tags: s.tags,
}));

export function fromUg(s: UgSong): SavedSong {
  return {
    title: s.song,
    artist: s.artist,
    key: s.key || undefined,
    capo: s.capo || undefined,
    difficulty: s.difficulty || undefined,
    kind: s.type === "Tabs" || s.type === "Bass Tabs" ? "tab" : "chords",
    body: s.content,
    format: "plain",
    source: { site: "ug", id: s.id, url: s.url, rating: s.rating, votes: s.votes, type: s.type },
    shapes: s.shapes,
    strums: s.strums,
    addedAt: Date.now(),
  };
}

export const formatOf = (s: SavedSong): SheetFormat => s.format ?? detectFormat(s.body);

/* ───────────── перенос старых данных (kv → коллекции) ───────────── */

let migrating: Promise<void> | null = null;
export function migrateOldSongs(): Promise<void> {
  migrating ??= (async () => {
    if (hubStorage.getItem("guitarhub:songs-migrated")) return;
    try {
      const raw = hubStorage.getItem("guitarhub:user-songs");
      const old = raw ? (JSON.parse(raw) as { slug: string; title: string; artist: string; key: string; capo?: number; difficulty: string; tags: string[]; contentType: string; body: string }[]) : [];
      for (const s of old) {
        await songsDb.put(`u-${s.slug}`, {
          title: s.title,
          artist: s.artist,
          key: s.key,
          capo: s.capo,
          difficulty: s.difficulty,
          kind: s.contentType === "tab" ? "tab" : "chords",
          body: s.body,
          format: s.contentType === "tab" ? "plain" : "chordpro",
          tags: s.tags,
          addedAt: Date.now(),
        });
      }
      const favRaw = hubStorage.getItem("guitarhub:favorites");
      const favs = favRaw ? (JSON.parse(favRaw) as string[]) : [];
      const userSlugs = new Set(old.map((s) => s.slug));
      for (const slug of favs) await metaDb.update(userSlugs.has(slug) ? `u-${slug}` : `s-${slug}`, { fav: true });
      hubStorage.setItem("guitarhub:songs-migrated", "1");
    } catch (e) {
      console.warn("[guitar] перенос песен не удался", e);
    }
  })();
  return migrating;
}

/** Все песни библиотеки + личные отметки. */
export function useLibrary() {
  const saved = useCollection<SavedSong>("songs");
  const meta = useCollection<SongMeta>("songMeta");
  useEffect(() => {
    void migrateOldSongs();
  }, []);
  const metaMap = useMemo(() => new Map(meta.items.map((m) => [m.id, m])), [meta.items]);
  const songs = useMemo<LibSong[]>(() => [...saved.items.map((s) => ({ ...s, id: s.id })), ...SEED], [saved.items]);
  return { songs, meta: metaMap, loading: saved.loading || meta.loading, saved, metaCol: meta };
}

export async function updateMeta(id: string, patch: Partial<SongMeta>) {
  await metaDb.update(id, patch);
}

export const STATUS_RU: Record<SongStatus, { label: string; icon: string; color: string }> = {
  want: { label: "Хочу выучить", icon: "📌", color: "var(--gt-sky)" },
  learning: { label: "Учу", icon: "🎸", color: "var(--gt-brass)" },
  learned: { label: "Выучил", icon: "✅", color: "var(--gt-green)" },
};
