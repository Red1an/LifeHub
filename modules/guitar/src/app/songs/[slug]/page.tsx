import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@lifehub/sdk";
import { Link } from "@lifehub/sdk";
import { Song } from "../../../data/songs";
import { getSongBySlug, deleteUserSong } from "../../../lib/song-store";
import { SongView } from "../../../components/SongView";
import { TabView } from "../../../components/TabView";
import { FavoriteButton } from "../../../components/FavoriteButton";

export default function SongPage() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [song, setSong] = useState<Song | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setSong(getSongBySlug(params.slug));
    setLoaded(true);
  }, [params.slug]);

  if (!loaded) return null;

  if (!song) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 pb-24 sm:pb-10">
        <p>Песня не найдена.</p>
        <Link to="/songs" className="text-emerald-600 underline">
          ← Вернуться к списку
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-20 sm:py-10 sm:pb-10">
      <Link to="/songs" className="text-sm text-emerald-600 underline">
        ← Все песни
      </Link>
      <div className="mt-2 mb-4 flex items-start justify-between gap-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{song.title}</h1>
          <p className="text-zinc-500">{song.artist}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FavoriteButton slug={song.slug} />
          {song.isUserSong && (
            <button
              onClick={() => {
                if (confirm("Удалить эту песню?")) {
                  deleteUserSong(song.slug);
                  navigate("/songs");
                }
              }}
              className="text-sm text-red-600 hover:underline"
            >
              Удалить
            </button>
          )}
        </div>
      </div>
      {song.contentType === "tab" ? (
        <TabView song={song} />
      ) : (
        <SongView song={song} />
      )}
    </div>
  );
}
