import { dayKey, defineModule, useCollection, type ModuleSummary } from "@lifehub/sdk";
import "./styles.css";
import type { CardDoc, FactData, HistoryData } from "./lib/types";
import { Today } from "./pages/Today";
import { Reader } from "./pages/Reader";
import { ThisDay } from "./pages/ThisDay";
import { Puzzles } from "./pages/Puzzles";
import { Review } from "./pages/Review";
import { Archive } from "./pages/Archive";

/** Плитка на главной: что было в этот день (или факт дня). */
function useSummary(): ModuleSummary | null {
  const cards = useCollection<CardDoc>("cards");
  if (cards.loading) return null;
  const day = dayKey();
  const h = cards.items.find((c) => c.id === `${day}_history` && c.status === "ready");
  if (h) {
    const d = h.data as HistoryData;
    return { value: String(d.year), text: d.title };
  }
  const f = cards.items.find((c) => c.id === `${day}_fact` && c.status === "ready");
  if (f) return { value: "Факт дня", text: (f.data as FactData).teaser };
  return null;
}

export default defineModule({
  routes: {
    "/": Today,
    "/d/:day": Today,
    "/k/:kind": Reader,
    "/d/:day/:kind": Reader,
    "/day": ThisDay,
    "/puzzles": Puzzles,
    "/review": Review,
    "/archive": Archive,
    "*": Today,
  },
  nav: [
    { to: "/", label: "Сегодня", icon: "🔭" },
    { to: "/day", label: "Этот день", icon: "⏳" },
    { to: "/puzzles", label: "Задачки", icon: "🧩" },
    { to: "/review", label: "Повтор", icon: "🔁" },
    { to: "/archive", label: "Архив", icon: "🗂️" },
  ],
  summary: useSummary,
  theme: "dark",
});
