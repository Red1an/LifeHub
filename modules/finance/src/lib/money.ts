const fmt0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12 345 ₽ (копейки — только если они есть и сумма небольшая). */
export function rub(n: number, opts: { sign?: boolean; cents?: boolean } = {}): string {
  const abs = Math.abs(n);
  const cents = opts.cents ?? (abs < 1000 && Math.round(abs * 100) % 100 !== 0);
  const s = (cents ? fmt2 : fmt0).format(abs) + " ₽";
  if (opts.sign) return (n > 0 ? "+" : n < 0 ? "−" : "") + s;
  return n < 0 ? "−" + s : s;
}

/** 12,3 тыс ₽ / 1,2 млн ₽ — для графиков и плиток. */
export function short(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",") + " млн ₽";
  if (abs >= 10_000) return sign + Math.round(abs / 1000) + " тыс ₽";
  if (abs >= 1000) return sign + (abs / 1000).toFixed(1).replace(".", ",").replace(",0", "") + " тыс ₽";
  return sign + fmt0.format(abs) + " ₽";
}

export const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ввод суммы: «1 250,50» → 1250.5. */
export function parseAmount(s: string): number {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? round2(n) : 0;
}
