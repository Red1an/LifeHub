import { useMemo, useState } from "react";
import { Button, plural, toast } from "@lifehub/sdk";
import { rub } from "../lib/money.ts";
import { detectBank } from "../lib/parse/common.ts";
import { useFinance } from "../lib/store.tsx";
import { frequentPhones, prettyPhone } from "../lib/tidy.ts";
import { BANKS, type BankId } from "../lib/types.ts";

/**
 * Вопросы, после которых переводы себе перестают считаться тратами:
 * «это ваш номер?» (частые переводы на один телефон) и «у вас есть карта этого банка?»
 * (частые переводы через СБП в банк, счёта которого нет).
 */
export function TidySuggestions() {
  const f = useFinance();
  const [busy, setBusy] = useState(false);
  const decided = [...(f.prefs.myPhones ?? []), ...(f.prefs.notMyPhones ?? [])];
  const phone = useMemo(() => frequentPhones(f.txs, decided)[0], [f.txs, decided.join()]);

  const banks = useMemo(() => {
    const have = new Set(f.accounts.filter((a) => !a.archived).map((a) => a.bank));
    const count = new Map<BankId, { n: number; sum: number }>();
    for (const t of f.txs) {
      // Только переводы: оплата по QR через СБП (Ozon, Яндекс) — это покупка, а не перевод в банк.
      if (t.kind !== "expense" || t.excluded || !/перевод/i.test(t.raw ?? "") || /qr|оплат/i.test(t.raw ?? "")) continue;
      const own = f.accounts.find((a) => a.id === t.account)?.bank;
      const b = detectBank((t.raw ?? "").replace(/операция по (карте|сч[её]ту).*/i, ""));
      if (!b || b === own || have.has(b) || f.prefs.hidden.includes(`bank:${b}`)) continue;
      const x = count.get(b) ?? { n: 0, sum: 0 };
      x.n++;
      x.sum += t.amount;
      count.set(b, x);
    }
    return [...count.entries()].filter(([, x]) => x.n >= 5).sort((a, b) => b[1].n - a[1].n);
  }, [f.txs, f.accounts, f.prefs.hidden]);

  const answer = async (mine: boolean) => {
    if (!phone) return;
    setBusy(true);
    try {
      f.setPrefs({
        ...f.prefs,
        myPhones: mine ? [...(f.prefs.myPhones ?? []), phone.phone] : f.prefs.myPhones,
        notMyPhones: mine ? f.prefs.notMyPhones : [...(f.prefs.notMyPhones ?? []), phone.phone],
      });
      if (mine) {
        await new Promise((ok) => setTimeout(ok, 100));
        await f.tidy(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const addBank = async (bank: BankId) => {
    setBusy(true);
    try {
      await f.accountCol.add({ name: BANKS[bank].name, bank, type: "card" });
      await new Promise((ok) => setTimeout(ok, 100));
      await f.tidy(true);
      toast(`Счёт «${BANKS[bank].name}» заведён. Загрузите его выписку — склеятся и обратные переводы.`, "success");
    } finally {
      setBusy(false);
    }
  };

  if (!phone && !banks.length) return null;
  return (
    <>
      {phone && (
        <div className="flex gap-3 rounded-[18px] bg-[var(--fin-blue-soft)] p-3.5">
          <span className="text-2xl leading-7">📱</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">Это ваш номер? {prettyPhone(phone.phone)}</div>
            <div className="mt-0.5 text-[13.5px] leading-snug text-muted">
              На него {phone.count} {plural(phone.count, ["перевод", "перевода", "переводов"])} на {rub(phone.sum)}. Если это вы (в свой другой банк) — это не траты.
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" loading={busy} onClick={() => answer(true)}>
                Да, мой
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer(false)}>
                Нет, чужой
              </Button>
            </div>
          </div>
        </div>
      )}
      {banks.slice(0, 1).map(([bank, x]) => (
        <div key={bank} className="flex gap-3 rounded-[18px] bg-[var(--fin-blue-soft)] p-3.5">
          <span className="text-2xl leading-7">🏦</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">У вас есть карта «{BANKS[bank].name}»?</div>
            <div className="mt-0.5 text-[13.5px] leading-snug text-muted">
              Туда ушло {x.n} {plural(x.n, ["перевод", "перевода", "переводов"])} на {rub(x.sum)} — сейчас они считаются тратами. Если это ваш счёт — переводы на него станут переводами себе.
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" loading={busy} onClick={() => addBank(bank)}>
                Да, завести счёт
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => f.setPrefs({ ...f.prefs, hidden: [...f.prefs.hidden, `bank:${bank}`] })}>
                Нет
              </Button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
