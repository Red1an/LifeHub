import { useState } from "react";
import { cn } from "@lifehub/sdk";

/** Скрыть ли слово на уровне заучивания: 1 — треть, 2 — две трети, 3 — все (остаётся первая буква). */
function hidden(line: number, word: number, level: number) {
  if (level >= 3) return true;
  const h = (line * 7 + word * 13) % 3;
  return h < level;
}

function mask(w: string) {
  const m = w.match(/^([^\p{L}]*)(\p{L})([\p{L}-]*)(.*)$/u);
  if (!m) return w;
  return m[1] + m[2] + m[3].replace(/./g, "_") + m[4];
}

/** Строки стихотворения; в режиме заучивания часть слов скрыта, нажатие на строку её открывает. */
export function PoemLines({ lines, hide = 0, className, onClick }: { lines: string[]; hide?: number; className?: string; onClick?: () => void }) {
  const [peek, setPeek] = useState<number | null>(null);
  return (
    <div className={cn("horizon-serif text-[17px] leading-[1.75] sm:text-[18px]", className)} onClick={onClick}>
      {lines.map((l, i) =>
        !l.trim() ? (
          <div key={i} className="h-4" />
        ) : (
          <div key={i} className={cn(hide > 0 && "cursor-pointer")} onClick={hide ? () => setPeek(peek === i ? null : i) : undefined}>
            {hide && peek !== i
              ? l.split(/(\s+)/).map((w, j) => (/\s/.test(w) || !hidden(i, j, hide) ? w : <span key={j} className="text-[#93a5ff]/70">{mask(w)}</span>))
              : l}
          </div>
        ),
      )}
    </div>
  );
}
