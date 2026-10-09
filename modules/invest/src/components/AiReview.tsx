import { ai, confirm, toast, useCollection } from "@lifehub/sdk";
import { useState } from "react";
import { fmtDate } from "../lib/dates.ts";
import { shortRub } from "../lib/fmt.ts";
import { aiContext } from "../lib/ideas.ts";
import { useInvest } from "../lib/store.tsx";
import { Btn, Panel } from "./ui.tsx";

/*
 * Второе мнение от нейронки: тот же портфель, найденные проблемы и рыночные данные — в компактном тексте.
 * Ответ — структурированный JSON, сохраняется в коллекцию reviews (не запрашиваем повторно).
 */

export interface AiAnswer {
  verdict: string;
  strengths?: string[];
  problems?: { title: string; why: string; fix: string }[];
  plan?: { step: string; amount?: number }[];
  ideas?: { ticker: string; name?: string; why: string; risk?: string }[];
  warnings?: string[];
}

interface Review {
  mode: "review" | "ideas";
  amount: number;
  question?: string;
  answer: AiAnswer;
}

const SYSTEM = `Ты — опытный и честный аналитик частных инвестиций на российском рынке (Мосбиржа, ОФЗ, БПИФ).
Пиши по-русски, простыми словами, без жаргона (если термин нужен — поясни в скобках). Коротко и по делу.
Учитывай: налоги РФ (НДФЛ 13–15 %, льгота долгосрочного владения 3 года, ИИС-3), ключевую ставку ЦБ, риски отдельных эмитентов,
дивидендную историю. Никаких гарантий доходности. Не советуй маржинальную торговлю, фьючерсы и спекуляции.
Опирайся только на переданные данные; если данных не хватает — так и скажи. Не придумывай целевые цены и факты о компаниях.
Правила:
- Отвечай только на русском языке, без иероглифов и английских вставок.
- Класс каждой позиции указан в данных (акции, облигации, деньги, золото). LQDT, AKMM, SBMM — фонды денежного рынка, а не индекс; TMOS, SBMX — индекс Мосбиржи; GOLD, TGLD — золото.
- Убыток сам по себе не причина продавать. Продажу предлагай, только если изменилась причина держать бумагу или нужно снизить слишком большую долю — и тогда учитывай налог с прибыли и льготу 3 лет (дата указана).
- Предпочитай направлять новые деньги туда, где недобор, а не продавать.
- Не предлагай продать больше 15–20 % портфеля за раз: перекосы лучше исправлять пополнениями постепенно.
- У облигации, купленной раньше, доходность к погашению уже рыночная: менять её на новую ОФЗ с похожей доходностью смысла нет (только комиссии и налог).
- Суммы в плане — положительные числа: сколько купить или продать.`;

const SHAPE = `Верни JSON:
{
  "verdict": "2–3 предложения: общая оценка портфеля и главное, что стоит сделать",
  "strengths": ["что сделано хорошо", "..."],
  "problems": [{"title": "проблема", "why": "почему это важно в цифрах этого портфеля", "fix": "что конкретно сделать"}],
  "plan": [{"step": "конкретный шаг по порядку", "amount": 30000}],
  "ideas": [{"ticker": "SBER", "name": "Сбербанк", "why": "почему подходит именно этому портфелю", "risk": "главный риск"}],
  "warnings": ["о чём помнить"]
}
problems — до 5, plan — до 5 шагов (amount в рублях, если шаг про покупку), ideas — до 6 бумаг/фондов из переданных данных.`;

export function AiReview({ mode, amount }: { mode: "review" | "ideas"; amount: number }) {
  const { report, settings, health, mistakes, screener, bonds, keyRate, income } = useInvest();
  const reviews = useCollection<Review>("reviews");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const list = reviews.items.filter((r) => r.mode === mode).sort((a, b) => b.createdAt - a.createdAt);
  const [shownId, setShownId] = useState<string | null>(null);
  const shown = list.find((r) => r.id === shownId) ?? list[0];

  async function run() {
    setBusy(true);
    try {
      const ctx = aiContext({
        r: report,
        risk: settings.risk,
        amount,
        issues: health.issues,
        lessons: mistakes.lessons.filter((l) => l.tone !== "good"),
        screener: screener?.rows ?? [],
        ofz: bonds?.rows ?? [],
        keyRate,
        incomeNext: income.years.find((y) => y.kind === "next")?.forecast ?? 0,
        goal: settings.goalMonthlyIncome,
      });
      const task =
        mode === "review"
          ? "Разбери мой портфель: что с ним не так, что я делаю хорошо, что исправить в первую очередь."
          : `Куда разумно вложить ${shortRub(amount)} прямо сейчас, учитывая мой портфель, профиль риска и ставку ЦБ? Дай конкретный план распределения и бумаги.`;
      const prompt = `${task}${question.trim() ? `\nМой вопрос: ${question.trim()}` : ""}\n\nДАННЫЕ:\n${ctx}\n\n${SHAPE}`;
      const answer = await ai.json<AiAnswer>(prompt, { system: SYSTEM });
      if (!answer?.verdict) throw new Error("Нейронка ответила не в том формате — попробуйте ещё раз");
      const doc = await reviews.add({ mode, amount, question: question.trim() || undefined, answer });
      setShownId(doc.id);
      setQuestion("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={mode === "review" ? "Второе мнение от ИИ" : "План от ИИ"}
      info="Нейронка (Claude через ваш Claude Code) получает сводку портфеля: доли, отрасли, прибыль, найденные проблемы, ставку ЦБ, подбор акций и ОФЗ. Токены брокеров и операции не отправляются. Ответ сохраняется. Это не индивидуальная инвестиционная рекомендация — используйте как повод подумать."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="inv-input" placeholder={mode === "review" ? "Свой вопрос (необязательно): например, стоит ли держать Газпром?" : "Уточнение: например, без акций одной компании больше 10 %"} value={question} onChange={(e) => setQuestion(e.target.value)} />
        <Btn main loading={busy} onClick={run}>
          {busy ? "Думаю…" : list.length ? "Спросить заново" : mode === "review" ? "Разобрать портфель" : "Составить план"}
        </Btn>
      </div>
      {busy && <p className="inv-muted mt-2 text-xs">Обычно 20–60 секунд.</p>}
      {mode === "ideas" && !screener && <p className="inv-muted mt-2 text-xs">Совет: сначала загрузите «Подбор акций» и ОФЗ ниже — тогда у нейронки будут свежие данные рынка.</p>}
      {shown && <Answer a={shown.answer} />}
      {list.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="inv-muted">Прошлые ответы:</span>
          {list.slice(0, 8).map((r) => (
            <button key={r.id} onClick={() => setShownId(r.id)} className={`inv-tag ${r.id === shown?.id ? "inv-tag-green" : ""}`}>
              {fmtDate(r.createdAt)}
            </button>
          ))}
          <button
            className="inv-muted ml-auto underline"
            onClick={async () => {
              if (await confirm("Удалить все сохранённые ответы этого раздела?", { danger: true })) for (const r of list) await reviews.remove(r.id);
            }}
          >
            очистить
          </button>
        </div>
      )}
    </Panel>
  );
}

function Answer({ a }: { a: AiAnswer }) {
  return (
    <div className="inv-fade-in mt-4 space-y-4">
      <p className="text-[15px] font-semibold leading-relaxed">{a.verdict}</p>
      {!!a.strengths?.length && (
        <div>
          <div className="inv-label mb-1">Хорошо</div>
          <ul className="space-y-1 text-sm">
            {a.strengths.map((s, i) => (
              <li key={i}>✅ {s}</li>
            ))}
          </ul>
        </div>
      )}
      {!!a.problems?.length && (
        <div className="space-y-2">
          <div className="inv-label">Проблемы</div>
          {a.problems.map((p, i) => (
            <div key={i} className="inv-soft inv-sev inv-sev-warn p-3 text-sm">
              <div className="font-bold">{p.title}</div>
              <div className="inv-muted mt-1">{p.why}</div>
              <div className="mt-1">
                <b>Что сделать:</b> {p.fix}
              </div>
            </div>
          ))}
        </div>
      )}
      {!!a.plan?.length && (
        <div>
          <div className="inv-label mb-1">План</div>
          <ol className="space-y-1.5 text-sm">
            {a.plan.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-[var(--inv-green-soft)] text-xs font-bold text-[var(--inv-green)]">{i + 1}</span>
                <span className="flex-1">{s.step}</span>
                {s.amount ? <b className="inv-num">{shortRub(Math.abs(s.amount))}</b> : null}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!!a.ideas?.length && (
        <div>
          <div className="inv-label mb-1">Бумаги</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {a.ideas.map((x, i) => (
              <div key={i} className="inv-soft p-3 text-sm">
                <div className="font-bold">
                  {x.ticker} {x.name && <span className="inv-muted font-semibold">· {x.name}</span>}
                </div>
                <div className="mt-1">{x.why}</div>
                {x.risk && <div className="mt-1 text-xs text-[var(--inv-orange)]">Риск: {x.risk}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {!!a.warnings?.length && (
        <ul className="inv-muted space-y-1 text-xs">
          {a.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
