import { useState } from "react";
import { Page, Section, Stat, BarChart, Tabs, Badge, EmptyState, addDays, formatDate, plural } from "@lifehub/sdk";
import { dayLabel, fmtMin, sessionMin, useSessions, useWatched, weekStart } from "../lib/store";
import type { Session } from "../lib/types";

const ENDED: Record<string, { text: string; tone: "success" | "warning" | "neutral" | "accent" }> = {
  self: { text: "сам закончил", tone: "success" },
  closed: { text: "закрыл вкладку", tone: "success" },
  timer: { text: "до таймера", tone: "warning" },
};

/** Сколько времени уходит в неделю и на что. */
export function Stats() {
  const sessions = useSessions();
  const watched = useWatched();
  const [week, setWeek] = useState<"0" | "-1">("0");
  const from = weekStart(Number(week));
  const to = addDays(from, 7).getTime();
  const list = sessions.items.filter((s) => s.startedAt >= from && s.startedAt < to).sort((a, b) => b.startedAt - a.startedAt);
  const total = list.reduce((a, s) => a + sessionMin(s), 0);
  const prevFrom = addDays(from, -7).getTime();
  const prevTotal = sessions.items.filter((s) => s.startedAt >= prevFrom && s.startedAt < from).reduce((a, s) => a + sessionMin(s), 0);
  const fromFeed = watched.items.filter((w) => w.at >= from && w.at < to).length;
  const early = list.filter((s) => s.endedBy === "self" || s.endedBy === "closed").length;

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const chart = days.map((d) => {
    const a = d.getTime();
    const b = addDays(d, 1).getTime();
    return { label: dayLabel(d), value: Math.round(list.filter((s) => s.startedAt >= a && s.startedAt < b).reduce((x, s) => x + sessionMin(s), 0)) };
  });

  const bySite = new Map<string, number>();
  for (const s of list) bySite.set(s.siteName || s.site, (bySite.get(s.siteName || s.site) ?? 0) + sessionMin(s));

  return (
    <Page title="Время" subtitle="Сколько ушло на отвлекающие сайты и зачем" width="normal">
      <Tabs
        tabs={[
          { id: "0", label: "Эта неделя" },
          { id: "-1", label: "Прошлая" },
        ]}
        value={week}
        onChange={setWeek}
        className="mb-4"
      />
      {sessions.loading ? null : !list.length && !fromFeed ? (
        <EmptyState icon="🌿" title="Ни одного сеанса" text="Если расширение стоит, здесь появится каждый заход на YouTube и в Инсту — с целью и временем." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Всего" value={fmtMin(total)} hint={prevTotal ? `${total <= prevTotal ? "↓" : "↑"} неделей раньше ${fmtMin(prevTotal)}` : undefined} tone={prevTotal && total > prevTotal ? "danger" : undefined} />
            <Stat label="В среднем" value={`${fmtMin(total / 7)}/день`} />
            <Stat label="Заходов" value={String(list.length)} hint={list.length ? `${early} — закончил сам` : undefined} />
            <Stat label="Из ленты" value={String(fromFeed)} hint={plural(fromFeed, ["ролик", "ролика", "роликов"])} tone="success" />
          </div>
          <Section title="По дням, минут">
            <BarChart data={chart} height={160} />
          </Section>
          {bySite.size > 1 && (
            <Section title="По сайтам">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {[...bySite].sort((a, b) => b[1] - a[1]).map(([n, m]) => (
                  <span key={n}>
                    {n}: <b>{fmtMin(m)}</b>
                  </span>
                ))}
              </div>
            </Section>
          )}
          <Section title="Заходы">
            <div className="divide-y divide-line">
              {list.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </div>
          </Section>
        </>
      )}
    </Page>
  );
}

function SessionRow({ s }: { s: Session & { id: string } }) {
  const live = !s.endedAt && (s.endsAt ?? 0) > Date.now();
  const end = s.endedBy ? ENDED[s.endedBy] : null;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-muted">
            {s.device === "phone" ? "📱 " : ""}
            {s.siteName} ·{" "}
          </span>
          <span className="font-medium">«{s.purpose || "без цели"}»</span>
        </div>
        <div className="flex-none text-sm tabular-nums">{fmtMin(sessionMin(s))}</div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{formatDate(s.startedAt, "weekday")}, {formatDate(s.startedAt, "time")}</span>
        <span>· план {s.minutes} мин</span>
        {live ? <Badge tone="accent">идёт</Badge> : end ? <Badge tone={end.tone}>{end.text}</Badge> : null}
      </div>
      {s.titles?.length > 0 && <div className="mt-1.5 line-clamp-2 text-sm text-muted">{s.titles.join(" · ")}</div>}
    </div>
  );
}
