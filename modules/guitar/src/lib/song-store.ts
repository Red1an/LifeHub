import { SEED_SONGS, Song } from "../data/songs";
import { hubStorage } from "./storage";

const STORAGE_KEY = "guitarhub:user-songs";

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^\w\sа-яё-]/gi, "")
      .replace(/\s+/g, "-") || "song"
  );
}

export function loadUserSongs(): Song[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = hubStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Song[];
  } catch {
    return [];
  }
}

function saveUserSongs(songs: Song[]) {
  hubStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function getAllSongs(): Song[] {
  return [...SEED_SONGS, ...loadUserSongs()];
}

export function getSongBySlug(slug: string): Song | undefined {
  return getAllSongs().find((s) => s.slug === slug);
}

export function addUserSong(input: Omit<Song, "slug" | "isUserSong">): Song {
  const existing = loadUserSongs();
  let slug = slugify(input.title);
  let counter = 1;
  const allSlugs = new Set(getAllSongs().map((s) => s.slug));
  while (allSlugs.has(slug)) {
    slug = `${slugify(input.title)}-${++counter}`;
  }
  const song: Song = { ...input, slug, isUserSong: true };
  saveUserSongs([...existing, song]);
  return song;
}

export function deleteUserSong(slug: string) {
  saveUserSongs(loadUserSongs().filter((s) => s.slug !== slug));
}
