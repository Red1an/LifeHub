import { useState } from "react";
import { Link } from "@lifehub/sdk";
import { PageHead, Shell } from "../components/kit";
import { nextRecall, useDue } from "../lib/store";
import { KIND_INFO } from "../lib/types";

/** Повторение: вопросы по прочитанному через 1, 3, 7, 21 и 60 дней — так факты остаются в голове. */
export function Review() {
  const { recall, due, learned, waiting } = useDue();
  const [shown, setShown] = useState(false);
  const [session, setSession] = useState({ ok: 0, miss: 0 });
  const r = due[0];

  async function grade(ok: boolean) {
    if (!r) return;
    setShown(false);
    setSession((s) => (ok ? { ...s, ok: s.ok + 1 } : { ...s, miss: s.miss + 1 }));
    await recall.update(r.id, nextRecall(r, ok));
  }

  return (
    <Shell>
      <PageHead
        kicker="Чтобы не забылось"
        title="Повторение"
        sub={`В памяти надолго: ${learned} · ждут своего дня: ${waiting}`}
      />

      {recall.loading ? null : r ? (
        <section className="horizon-panel p-5" style={{ boxShadow: `inset 3px 0 0 ${KIND_INFO[r.kind].color}` }}>
          <div className="horizon-kicker flex justify-between" style={{ color: KIND_INFO[r.kind].color }}>
            <span>
              {KIND_INFO[r.kind].icon} {KIND_INFO[r.kind].label}
            </span>
            <span className="font-medium normal-case tracking-normal text-[#9aa3b8]">осталось {due.length}</span>
          </div>
          <p className="horizon-serif mt-4 text-[21px] leading-snug">{r.q}</p>
          {!shown ? (
            <button className="horizon-btn horizon-btn-main mt-6 w-full" onClick={() => setShown(true)}>
              Вспомнил — показать ответ
            </button>
          ) : (
            <div className="horizon-pop">
              <p className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-[16px] leading-relaxed">{r.a}</p>
              <p className="mt-2 text-xs text-[#9aa3b8]">Из карточки: {r.title}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button className="horizon-btn !text-[#fb7185]" onClick={() => grade(false)}>
                  Не вспомнил
                </button>
                <button className="horizon-btn !text-[#34d399]" onClick={() => grade(true)}>
                  Помню
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="horizon-panel p-8 text-center">
          <div className="text-4xl">✨</div>
          <p className="horizon-serif mt-3 text-xl">{session.ok + session.miss ? "На сегодня всё повторено" : "Повторять пока нечего"}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#9aa3b8]">
            {session.ok + session.miss
              ? `Вспомнил ${session.ok} из ${session.ok + session.miss}. Что не вспомнилось — спрошу завтра.`
              : "Каждая прочитанная карточка через день превращается в вопрос. Помнишь — следующий раз через 3 дня, потом через неделю, три и два месяца."}
          </p>
          <Link to="/" className="horizon-btn mt-5">
            К порции дня
          </Link>
        </div>
      )}
    </Shell>
  );
}
