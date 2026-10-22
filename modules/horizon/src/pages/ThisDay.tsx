import { useEffect, useState } from "react";
import { dayKey, Spinner } from "@lifehub/sdk";
import { GuessYear } from "../components/GuessYear";
import { cap, PageHead, Shell, yearsAgo } from "../components/kit";
import { ensureDay, useGames } from "../lib/store";
import type { DayDoc, DayEvent } from "../lib/types";

type Tab = "selected" | "events" | "births" | "deaths";
const TABS: { id: Tab; label: string }[] = [
  { id: "selected", label: "Главное" },
  { id: "events", label: "Все события" },
  { id: "births", label: "Родились" },
  { id: "deaths", label: "Ушли" },
];

/** Этот день в истории: игра «Угадай год», праздники и лента событий по векам. */
export function ThisDay() {
  const day = dayKey();
  const [doc, setDoc] = useState<DayDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("selected");
  const games = useGames();

  useEffect(() => {
    ensureDay(day).then(setDoc, (e) => setError((e as Error).message));
  }, [day]);

  const todayGames = games.items.filter((g) => g.day === day);
  const best = games.items.length ? Math.max(...games.items.map((g) => g.score)) : null;
  const bestToday = todayGames.length ? Math.max(...todayGames.map((g) => g.score)) : null;
  const dateText = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  return (
    <Shell>
      <PageHead kicker="Машина времени" title={`${dateText} в истории`} sub="Что происходило в этот день в разные века" />

      {error && <p className="text-[#fb7185]">{error}</p>}
      {!doc && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {doc && (
        <>
          <section className="horizon-panel mb-6 p-5" style={{ boxShadow: "inset 3px 0 0 #f5b453" }}>
            <div className="horizon-kicker mb-3 flex justify-between text-[#f5b453]">
              <span>⏳ Угадай год</span>
              <span className="font-medium normal-case tracking-normal text-[#9aa3b8]">
                {bestToday !== null && `сегодня ${bestToday}`}
                {best !== null && ` · рекорд ${best}`}
              </span>
            </div>
            <GuessYear doc={doc} best={best} />
          </section>

          {doc.holidays.length > 0 && (
            <section className="mb-6">
              <div className="horizon-kicker mb-2 text-[#9aa3b8]">🎉 Сегодня отмечают</div>
              <div className="flex flex-wrap gap-2">
                {doc.holidays.slice(0, 10).map((h) => (
                  <span key={h} className="horizon-chip !text-[13px]">
                    {h.replace(/\.$/, "")}
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {TABS.filter((t) => doc[t.id].length).map((t) => (
              <button key={t.id} className="horizon-chip shrink-0" data-on={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label} <span className="opacity-50">{doc[t.id].length}</span>
              </button>
            ))}
          </div>
          <Timeline events={doc[tab]} />
        </>
      )}
    </Shell>
  );
}

/** Лента по векам: год крупно слева, картинка статьи справа. */
function Timeline({ events }: { events: DayEvent[] }) {
  let lastCentury: number | null = null;
  return (
    <div className="relative">
      <div className="absolute bottom-0 left-[54px] top-0 w-px bg-white/10" />
      {events.map((e, i) => {
        const century = e.year > 0 ? Math.ceil(e.year / 100) : 0;
        const head = century !== lastCentury;
        lastCentury = century;
        return (
          <div key={i}>
            {head && century > 0 && (
              <div className="horizon-kicker relative z-[1] mb-2 mt-5 ml-[40px] w-fit rounded-full bg-[#0a0e1a] px-2 py-0.5 text-[#f5b453]">
                {roman(century)} век
              </div>
            )}
            <div className="relative flex gap-4 py-2.5">
              <div className="horizon-serif w-[44px] shrink-0 text-right text-[15px] font-semibold tabular-nums text-[#f5b453]">{e.year}</div>
              <div className="relative z-[1] mt-[7px] h-2 w-2 shrink-0 -translate-x-[1px] rounded-full bg-[#f5b453]/70 ring-4 ring-[#0a0e1a]" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug">{cap(e.text)}</p>
                <div className="mt-1 flex gap-3 text-xs text-[#9aa3b8]">
                  <span>{yearsAgo(e.year)}</span>
                  {e.link && (
                    <a href={e.link} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                      {e.title ?? "Википедия"} ↗
                    </a>
                  )}
                </div>
              </div>
              {e.thumb && <img src={e.thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover opacity-90" loading="lazy" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function roman(n: number) {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of map) while (n >= v) (s += r), (n -= v);
  return s;
}
