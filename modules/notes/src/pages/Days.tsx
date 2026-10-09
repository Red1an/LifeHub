import { useMemo } from "react";
import { Link, useCollection } from "@lifehub/sdk";
import { Empty, Head, Wrap } from "../components/kit.tsx";
import { kindOf } from "../lib/kinds.ts";
import { eventWhen, localKey, preview, titleOf } from "../lib/text.ts";
import type { Note, NoteDoc } from "../lib/types.ts";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** Дневник: записи дня по месяцам — что было, настроение, что из дня вышло. */
export function DaysPage() {
  const notes = useCollection<Note>("notes");
  const days = useMemo(
    () =>
      notes.items
        .filter((n) => n.status !== "inbox" && kindOf(n).id === "day")
        .map((n) => ({ n, date: n.dayDate ?? localKey(new Date(n.capturedAt ?? n.createdAt)) }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [notes.items],
  );
  const children = useMemo(() => {
    const m = new Map<string, NoteDoc[]>();
    for (const n of notes.items) if (n.fromDay) m.set(n.fromDay, [...(m.get(n.fromDay) ?? []), n]);
    return m;
  }, [notes.items]);

  const byMonth = new Map<string, typeof days>();
  for (const d of days) byMonth.set(d.date.slice(0, 7), [...(byMonth.get(d.date.slice(0, 7)) ?? []), d]);

  return (
    <Wrap>
      <Head title="📓 Дневник" sub="Расскажи в воронке, как прошёл день, — рассказ сохранится целиком, а дела и события из него разложатся сами" back="/shelves" />
      {!days.length ? (
        <Empty icon="📓" title="Записей дня пока нет" text="Надиктуй в воронку, как прошёл день: с кем виделся, что делал, что думаешь. Разбор сохранит рассказ сюда и вынесет из него дела, события и всё остальное." />
      ) : (
        <div className="space-y-6">
          {[...byMonth].map(([month, list]) => (
            <section key={month}>
              <h2 className="nt-h2 mb-2">
                {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4) !== String(new Date().getFullYear()) ? month.slice(0, 4) : ""}
              </h2>
              <div className="space-y-2">
                {list.map(({ n, date }) => {
                  const kids = children.get(n.id) ?? [];
                  return (
                    <Link key={n.id} to={`/n/${n.id}`} className="nt-paper flex gap-3 p-3.5">
                      <div className="w-11 flex-none text-center">
                        <div className="nt-serif text-2xl font-semibold leading-none">{Number(date.slice(8))}</div>
                        <div className="nt-muted mt-0.5 text-xs">{eventWhen({ date }).split(" ")[0]}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-snug">{titleOf(n)}</div>
                        {n.props?.mood && <div className="nt-accent mt-0.5 text-xs">{n.props.mood}</div>}
                        <p className="nt-muted mt-1 line-clamp-2 text-sm">{n.props?.highlight || preview(n.body, 140)}</p>
                        {kids.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {kids.slice(0, 6).map((k) => (
                              <span key={k.id} className="nt-chip !h-6 max-w-[160px] truncate !px-2 !text-xs">
                                {kindOf(k).emoji} {titleOf(k)}
                              </span>
                            ))}
                            {kids.length > 6 && <span className="nt-muted text-xs leading-6">+{kids.length - 6}</span>}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Wrap>
  );
}
