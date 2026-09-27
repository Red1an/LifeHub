import { hubStorage } from "./storage";
const STORAGE_KEY = "guitarhub:favorites";

export function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = hubStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function save(set: Set<string>) {
  hubStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
}

export function isFavorite(slug: string): boolean {
  return loadFavorites().has(slug);
}

export function toggleFavorite(slug: string): boolean {
  const set = loadFavorites();
  const next = !set.has(slug);
  if (next) set.add(slug);
  else set.delete(slug);
  save(set);
  return next;
}
