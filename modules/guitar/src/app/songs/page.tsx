import { useEffect, useMemo, useState } from "react";
import { Link } from "@lifehub/sdk";
import { Song, SongContentType } from "../../data/songs";
import { getAllSongs } from "../../lib/song-store";
import { loadFavorites } from "../../lib/favorites-store";
import { FavoriteButton } from "../../components/FavoriteButton";

const DIFFICULTY_LABEL: Record<Song["difficulty"], string> = {
  easy: "Лёгкая",
  medium: "Средняя",
  hard: "Сложная",
};

type FilterTab = "all" | SongContentType | "favorites";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "chords", label: "Аккорды" },
  { id: "tab", label: "Табы" },
  { id: "favorites", label: "★ Избранное" },
];

export default function SongsPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setSongs(getAllSongs());
    setFavorites(loadFavorites());
  }, []);

  const filtered = useMemo(() => {
    let list = songs;
    if (tab === "chords" || tab === "tab") {
      list = list.filter((s) => s.contentType === tab);
    } else if (tab === "favorites") {
      list = list.filter((s) => favorites.has(s.slug));
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [songs, query, tab, favorites]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold sm:text-2xl">Песни</h1>
        <Link
          to="/songs/new"
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 sm:px-4"
        >
          + Добавить
        </Link>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === t.id
                ? "bg-white dark:bg-zinc-800 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по названию, исполнителю, тегу…"
        className="mb-6 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-4 py-2.5 text-sm"
      />

      <ul className="flex flex-col gap-2 pb-16 sm:pb-0">
        {filtered.map((song) => (
          <li key={song.slug}>
            <Link
              to={`/songs/${song.slug}`}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-3 hover:border-emerald-500 transition-colors sm:px-4"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{song.title}</div>
                <div className="truncate text-sm text-zinc-500">{song.artist}</div>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-1 text-xs ${
                  song.contentType === "tab"
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {song.contentType === "tab" ? "Таб" : "Аккорды"}
              </span>
              <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">
                {DIFFICULTY_LABEL[song.difficulty]}
              </span>
              <FavoriteButton slug={song.slug} size="sm" />
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">
            Ничего не найдено.
          </p>
        )}
      </ul>
    </div>
  );
}
