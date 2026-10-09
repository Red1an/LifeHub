import { cn, Link } from "@lifehub/sdk";
import type { UgStrum } from "../lib/ug";
import { StrumSection, TricksSection } from "./SongFlavor";
import type { Part } from "../lib/songsterr";
import { Panel, Section } from "./kit";

const CHECKS = [
  { id: "chords", label: "Выучил все аккорды песни" },
  { id: "changes", label: "Меняю их в темпе без остановок" },
  { id: "strum", label: "Играю бой или перебор" },
  { id: "verse", label: "Куплет и припев с текстом" },
  { id: "full", label: "Песня целиком от начала до конца" },
];

/** Чек-лист разучивания песни. */
export function SongChecklist({ done, onToggle }: { done: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-1">
      {CHECKS.map((c, i) => {
        const on = done.includes(c.id);
        return (
          <button key={c.id} onClick={() => onToggle(c.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--gt-panel-2)]">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", on ? "bg-[var(--gt-green)] text-black" : "border border-[var(--gt-line)] text-[var(--gt-muted)]")}>{on ? "✓" : i + 1}</span>
            <span className={cn("text-sm", on && "text-[var(--gt-muted)] line-through")}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
export const CHECK_COUNT = CHECKS.length;

/** Вкладка «Практика» песни. */
export function SongPracticeTab({
  songId,
  chords,
  progression,
  keyName,
  strums,
  checks,
  onToggleCheck,
  onEar,
  rhythmPart,
  rhythmLoading,
}: {
  rhythmPart: Part | null;
  rhythmLoading: boolean;
  songId: string;
  chords: string[];
  progression: string[];
  keyName: string | null;
  strums: UgStrum[];
  checks: string[];
  onToggleCheck: (id: string) => void;
  onEar: () => void;
}) {
  const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
  return (
    <div>
      <Section title="Разучить песню" className="!mt-0">
        <Panel>
          <SongChecklist done={checks} onToggle={onToggleCheck} />
        </Panel>
      </Section>

      <Section title="Бой">
        <StrumSection part={rhythmPart} loading={rhythmLoading} ugStrums={strums} progression={progression} />
      </Section>

      <TricksSection chords={chords} progression={progression} keyName={keyName} part={rhythmPart} />

      <Section title="Упражнения под песню">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to={`/train/chord-changes${q({ chords: chords.slice(0, 8).join(",") })}`} className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">🤘</div>
            <div className="mt-1 font-bold">Смена аккордов песни</div>
            <div className="text-sm text-[var(--gt-muted)]">Тренажёр смены на аккордах {chords.slice(0, 5).join(" ")}{chords.length > 5 ? "…" : ""}</div>
          </Link>
          <Link to={`/train/jam${q({ chords: progression.join(","), key: keyName ?? "" })}`} className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">🔥</div>
            <div className="mt-1 font-bold">Импровизация под песню</div>
            <div className="text-sm text-[var(--gt-muted)]">Джем на ходе песни{keyName ? ` в ${keyName}` : ""}: гриф подсвечивает ноты гаммы и аккорда</div>
          </Link>
          <button onClick={onEar} className="gt-panel block p-4 text-left transition hover:-translate-y-0.5">
            <div className="text-2xl">🙈</div>
            <div className="mt-1 font-bold">Подобрать на слух</div>
            <div className="text-sm text-[var(--gt-muted)]">Аккорды скроются — подбирай по оригиналу и открывай по одному для проверки</div>
          </button>
          <Link to="/train/chord-check" className="gt-panel block p-4 transition hover:-translate-y-0.5">
            <div className="text-2xl">✅</div>
            <div className="mt-1 font-bold">Чистота аккордов</div>
            <div className="text-sm text-[var(--gt-muted)]">Микрофон проверит, звучат ли все струны</div>
          </Link>
        </div>
      </Section>
    </div>
  );
}
