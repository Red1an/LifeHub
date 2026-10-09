import { useEffect, useState } from "react";
import { cn } from "../sdk/format.ts";
import { Loading } from "../sdk/ui.tsx";

/*
 * Виджет модуля-сервиса на главной. Сервис не загружается в страницу хаба, поэтому отдаёт
 * не компонент, а данные (JSON по адресу service.widget), а хаб рисует их сам:
 *
 * { title, subtitle?, progress?: 0…1, note?, empty?,
 *   rows?: [{ img?, title, sub?, done?, muted?, action?: { label, post, body? } }] }
 *
 * action.post — адрес внутри сервиса (как и img), запрос уходит через прокси /s/<id>/.
 */

interface WidgetData {
  title?: string;
  subtitle?: string;
  progress?: number;
  note?: string;
  empty?: string;
  rows?: Array<{ img?: string; title: string; sub?: string; done?: boolean; muted?: boolean; action?: { label: string; post: string; body?: unknown } }>;
}

export function ServiceWidget({ id, path }: { id: string; path: string }) {
  const base = `/s/${id}/`;
  const url = (p: string) => (/^https?:|^\//.test(p) ? p : base + p.replace(/^\.?\//, ""));
  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    try {
      const r = await fetch(url(path.replace(/^\//, "")), { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`Сервис ответил ${r.status}`);
      setData(await r.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [id, path]);

  if (error && !data) return <p className="text-sm text-muted">Не удалось загрузить: {error}</p>;
  if (!data) return <Loading />;
  if (data.empty) return <p className="text-sm text-muted">{data.empty}</p>;

  const act = async (k: number) => {
    const a = data.rows?.[k]?.action;
    if (!a) return;
    setBusy(k);
    try {
      await fetch(url(a.post), { method: "POST", headers: { "content-type": "application/json", "x-lifehub": "1" }, body: JSON.stringify(a.body ?? {}) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {data.subtitle && <p className="text-sm text-muted">{data.subtitle}</p>}
      {typeof data.progress === "number" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(Math.min(1, Math.max(0, data.progress)) * 100)}%` }} />
        </div>
      )}
      {data.note && <p className="text-sm">{data.note}</p>}
      {data.rows?.map((r, k) => (
        <div key={k} className={cn("flex items-center gap-3", r.muted && "opacity-50")}>
          {r.img && <img src={url(r.img)} alt="" loading="lazy" className="size-10 shrink-0 rounded-md object-cover" />}
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-sm font-medium", r.done && "text-muted line-through")}>{r.title}</div>
            {r.sub && <div className="truncate text-xs text-muted">{r.sub}</div>}
          </div>
          {r.action && (
            <button
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                r.done ? "border-transparent bg-accent/15 text-accent" : "border-line hover:bg-surface-2",
              )}
              disabled={busy !== null}
              onClick={() => act(k)}
            >
              {busy === k ? "…" : r.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
