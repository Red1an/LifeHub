import { useEffect, useState } from "react";
import { isFavorite, toggleFavorite } from "../lib/favorites-store";

export function FavoriteButton({
  slug,
  size = "md",
}: {
  slug: string;
  size?: "sm" | "md";
}) {
  const [fav, setFav] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setFav(isFavorite(slug));
  }, [slug]);

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFav(toggleFavorite(slug));
      }}
      aria-label={fav ? "Убрать из избранного" : "Добавить в избранное"}
      className={`flex items-center justify-center rounded-full transition-colors ${
        size === "sm" ? "h-8 w-8 text-lg" : "h-10 w-10 text-xl"
      } ${fav ? "text-amber-400" : "text-zinc-400 hover:text-zinc-300"}`}
    >
      {fav ? "★" : "☆"}
    </button>
  );
}
