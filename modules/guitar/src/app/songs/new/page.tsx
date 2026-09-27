import { useState } from "react";
import { useNavigate } from "@lifehub/sdk";
import { Link } from "@lifehub/sdk";
import { addUserSong } from "../../../lib/song-store";
import { Song, SongContentType } from "../../../data/songs";

const CHORDS_EXAMPLE = `[[Куплет 1]]
[G]Пример строки с [C]аккордами прямо [D]перед словами
[[Припев]]
[Em]Так и оформляй [C]свою песню [G]дальше`;

const TAB_EXAMPLE = `[Название части, например Вступление]
e|-----------------0-----------------|
B|---------------1---1---------------|
G|-------------0-------0-------------|
D|-----------2-----------2-----------|
A|---------3---------------3---------|
E|-------------------------------3---|`;

export default function NewSongPage() {
  const navigate = useNavigate();
  const [contentType, setContentType] = useState<SongContentType>("chords");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [key, setKey] = useState("C");
  const [difficulty, setDifficulty] = useState<Song["difficulty"]>("easy");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const song = addUserSong({
      title: title.trim(),
      artist: artist.trim() || "Неизвестен",
      key,
      difficulty,
      contentType,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      body,
    });
    navigate(`/songs/${song.slug}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-20 sm:py-10 sm:pb-10">
      <Link to="/songs" className="text-sm text-emerald-600 underline">
        ← Все песни
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-bold sm:text-2xl">Добавить песню</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Песня сохранится только в твоём браузере — никуда не отправляется.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 text-sm">
          <button
            type="button"
            onClick={() => setContentType("chords")}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
              contentType === "chords"
                ? "bg-white dark:bg-zinc-800 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            Аккорды
          </button>
          <button
            type="button"
            onClick={() => setContentType("tab")}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
              contentType === "tab"
                ? "bg-white dark:bg-zinc-800 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            Таб
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Название
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Исполнитель
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Тональность
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Сложность
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Song["difficulty"])}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            >
              <option value="easy">Лёгкая</option>
              <option value="medium">Средняя</option>
              <option value="hard">Сложная</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Теги (через запятую)
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="рок, для начинающих, бой"
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
          />
        </label>

        {contentType === "chords" ? (
          <label className="flex flex-col gap-1 text-sm">
            Текст с аккордами
            <span className="text-xs text-zinc-500">
              Аккорды в квадратных скобках прямо перед словом: <code>[G]слово</code>.
              Заголовки разделов — двойными скобками: <code>[[Припев]]</code>.
            </span>
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={CHORDS_EXAMPLE}
              rows={12}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Таб (ASCII, 6 строк на струну)
            <span className="text-xs text-zinc-500">
              Вставь таб как есть, обычным текстом — моноширинный шрифт сохранит
              выравнивание.
            </span>
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={TAB_EXAMPLE}
              rows={12}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
            />
          </label>
        )}

        <button
          type="submit"
          className="self-start rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Сохранить песню
        </button>
      </form>
    </div>
  );
}
