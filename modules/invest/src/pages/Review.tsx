import { Link, cn } from "@lifehub/sdk";
import { ScoreRing } from "../components/charts.tsx";
import { Avatar, Details, Panel, Seg, Stat } from "../components/ui.tsx";
import { fmtDate } from "../lib/dates.ts";
import { pct, plural, shortRub, signedShortRub } from "../lib/fmt.ts";
import { CLASS_SHORT, RISK_TITLE, type AssetClass, type Issue } from "../lib/health.ts";
import type { Lesson } from "../lib/mistakes.ts";
import { useInvest } from "../lib/store.tsx";

const SEV_TAG: Record<Issue["severity"], [string, string]> = {
  bad: ["Важно", "inv-tag-red"],
  warn: ["Стоит исправить", "inv-tag-orange"],
  info: ["Совет", "inv-tag-blue"],
  good: ["Хорошо", "inv-tag-green"],
};

export function HealthTab() {
  const { health, settings, setSettings } = useInvest();
  const total = Object.values(health.classes).reduce((a, b) => a + b, 0);
  const classes = (["shares", "bonds", "money", "gold"] as AssetClass[]).filter((c) => health.target[c] > 0 || health.classes[c] > 0);
  const counts = { bad: 0, warn: 0, info: 0 };
  for (const i of health.issues) if (i.severity !== "good") counts[i.severity]++;
  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing score={health.score} size={104} />
          <div className="min-w-0 flex-1">
            <div className="inv-label">Оценка портфеля</div>
            <div className="text-2xl font-extrabold">{health.grade}</div>
            <div className="inv-muted mt-1 text-sm leading-relaxed">
              {counts.bad ? `${counts.bad} ${plural(counts.bad, ["важная проблема", "важные проблемы", "важных проблем"])}, ` : ""}
              {counts.warn ? `${counts.warn} — стоит исправить, ` : ""}
              {counts.info} {plural(counts.info, ["совет", "совета", "советов"])}. Оценка — сумма штрафов за найденные проблемы: она нужна, чтобы видеть, становится ли лучше.
            </div>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">Ваш профиль риска:</span>
            <Seg value={settings.risk} onChange={(v) => setSettings({ risk: v })} options={[["careful", RISK_TITLE.careful], ["balanced", RISK_TITLE.balanced], ["bold", RISK_TITLE.bold]]} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {classes.map((c) => {
              const now = total > 0 ? health.classes[c] / total : 0;
              const diff = now - health.target[c];
              return <Stat key={c} label={CLASS_SHORT[c]} value={pct(now, { digits: 0 })} hint={Math.abs(diff) < 0.03 ? "как надо" : `${diff > 0 ? "больше" : "меньше"} ориентира на ${pct(Math.abs(diff), { digits: 0 })}`} />;
            })}
          </div>
        </div>
      </section>

      {health.issues.length === 0 && <Panel><div className="py-4 text-center text-sm">Серьёзных проблем не нашли 👌</div></Panel>}
      {health.issues.map((i) => (
        <IssueCard key={i.id} issue={i} />
      ))}
      {health.good.length > 0 && (
        <Panel title="Что уже хорошо">
          <div className="space-y-2">
            {health.good.map((g) => (
              <div key={g.id} className="inv-soft inv-sev inv-sev-good p-3">
                <div className="text-sm font-bold">{g.title}</div>
                <div className="inv-muted text-[13px]">{g.text}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/ideas" className="inv-btn inv-btn-main flex-1">💡 Куда вложить, чтобы выровнять портфель</Link>
        <Link to="/actions?tab=ai" className="inv-btn flex-1">🤖 Спросить мнение ИИ</Link>
      </div>
    </div>
  );
}

function IssueCard({ issue: i }: { issue: Issue }) {
  const [label, tag] = SEV_TAG[i.severity];
  return (
    <section className={cn("inv-panel inv-sev p-4 sm:p-5", `inv-sev-${i.severity}`)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn("inv-tag", tag)}>{label}</span>
        <span className="inv-tag">{i.area}</span>
      </div>
      <h3 className="text-[16px] font-extrabold leading-snug">{i.title}</h3>
      <p className="inv-muted mt-1.5 text-sm leading-relaxed">{i.text}</p>
      {i.action && (
        <p className="mt-2 text-sm leading-relaxed">
          <b className="text-[var(--inv-green)]">Что сделать:</b> {i.action}
        </p>
      )}
      {i.items && i.items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {i.items.map((x) =>
            x.id ? (
              <Link key={x.name} to={`/asset/${encodeURIComponent(x.id)}`} className="inv-soft px-2.5 py-1.5 text-[13px] hover:bg-[var(--inv-panel-3)]">
                <b>{x.name}</b> <span className="inv-muted">{x.detail}</span>
              </Link>
            ) : (
              <span key={x.name} className="inv-soft px-2.5 py-1.5 text-[13px]">
                <b>{x.name}</b> <span className="inv-muted">{x.detail}</span>
              </span>
            ),
          )}
        </div>
      )}
    </section>
  );
}

const TONE_TAG: Record<Lesson["tone"], [string, string, string]> = {
  bad: ["Дорогая привычка", "inv-tag-red", "bad"],
  warn: ["Можно лучше", "inv-tag-orange", "warn"],
  info: ["На заметку", "inv-tag-blue", "info"],
  good: ["Получается", "inv-tag-green", "good"],
};

export function MistakesTab() {
  const { mistakes: m } = useInvest();
  const cost = m.lessons.filter((l) => l.tone === "bad" || l.tone === "warn").reduce((a, l) => a + (l.amount ?? 0), 0);
  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <p className="text-sm leading-relaxed">
          Разбор всех ваших сделок задним числом. Это не упрёк — будущее никто не знает. Цель — найти <b>повторяющиеся привычки</b>, которые стоят денег, и не повторять их.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Покупок" value={m.stats.buys} />
          <Stat label="Продаж" value={m.stats.sells} />
          <Stat label="Оборот в год" value={m.stats.turnover != null ? pct(m.stats.turnover, { digits: 0 }) : "—"} hint="от среднего портфеля" />
          <Stat label="Цена привычек" value={cost > 0 ? <span className="inv-down">≈ {shortRub(cost)}</span> : "—"} hint="оценка задним числом" />
        </div>
      </section>
      {!m.lessons.length && (
        <Panel>
          <div className="inv-muted py-4 text-center text-sm">Пока мало истории операций для разбора. Нужны сделки хотя бы за год.</div>
        </Panel>
      )}
      {m.lessons.map((l) => {
        const [label, tag, sev] = TONE_TAG[l.tone];
        return (
          <section key={l.id} className={cn("inv-panel inv-sev p-4 sm:p-5", `inv-sev-${sev}`)}>
            <div className="mb-2 flex items-center gap-2">
              <span className={cn("inv-tag", tag)}>{label}</span>
              {l.amount != null && l.amount > 0 && l.tone !== "good" && <span className="inv-tag inv-tag-red">≈ {shortRub(l.amount)}</span>}
            </div>
            <h3 className="text-[16px] font-extrabold leading-snug">{l.title}</h3>
            <p className="inv-muted mt-1.5 text-sm leading-relaxed">{l.text}</p>
            <p className="mt-2 text-sm leading-relaxed">
              <b className="text-[var(--inv-green)]">Урок:</b> {l.lesson}
            </p>
            {l.examples && l.examples.length > 0 && (
              <Details summary="Примеры" className="mt-2">
                {l.examples.map((x, k) => (
                  <div key={k} className="inv-row">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{x.name}</div>
                      <div className="inv-muted text-xs">{x.detail}</div>
                    </div>
                    <div className="inv-muted text-xs">{fmtDate(x.date, { year: "always" })}</div>
                  </div>
                ))}
              </Details>
            )}
          </section>
        );
      })}
      {m.sells.length > 0 && (
        <Panel title="Все продажи: что было бы, если бы держали" info="«Сейчас бы стоили» — проданные бумаги по сегодняшней цене минус то, что вы за них получили (без учёта дивидендов после продажи). Плюс — продали рано, минус — продали вовремя. Облигации не учитываются.">
          {m.sells.slice(0, 40).map((s) => (
            <div key={s.id} className="inv-row">
              <Avatar ticker={s.ticker} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">
                  {s.name} {s.panic && <span className="inv-tag inv-tag-red">на панике</span>}
                </div>
                <div className="inv-muted text-xs">
                  {fmtDate(s.t, { year: "always" })} · держали {s.heldDays < 60 ? `${s.heldDays} дн.` : `${Math.round(s.heldDays / 30)} мес.`} · результат <span className={s.realized >= 0 ? "inv-up" : "inv-down"}>{signedShortRub(s.realized)}</span>
                  {s.taxPaid > 0 && ` · налог ≈ ${shortRub(s.taxPaid)}`}
                </div>
              </div>
              <div className="text-right text-xs">
                {s.missed != null ? (
                  <>
                    <div className={cn("inv-num text-sm font-extrabold", s.missed > 0 ? "inv-down" : "inv-up")}>{s.missed > 0 ? `−${shortRub(s.missed)}` : `+${shortRub(-s.missed)}`}</div>
                    <div className="inv-muted">{s.missed > 0 ? "упущено" : "сберегли"}</div>
                  </>
                ) : (
                  <span className="inv-muted">—</span>
                )}
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
