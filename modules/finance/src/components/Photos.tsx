import { useRef, useState } from "react";
import { Button, confirm, toast } from "@lifehub/sdk";
import { photoUrl, readReceipt, removePhotos, uploadPhotos } from "../lib/photos.ts";
import { rub } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import type { TxDoc } from "../lib/types.ts";
import { Sheet } from "./ui.tsx";

/** Фото и чек в карточке операции: миниатюры, «+ Фото», просмотр, «Прочитать чек» нейронкой. */
export function TxPhotos({ tx }: { tx: TxDoc }) {
  const f = useFinance();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "read" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const photos = tx.photos ?? [];

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy("upload");
    try {
      const ids = await uploadPhotos(list);
      await f.txCol.update(tx.id, { photos: [...photos, ...ids] });
    } catch (e) {
      toast(`Не загрузилось: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const read = async () => {
    setBusy("read");
    try {
      const r = await readReceipt(photos, f.categories);
      const patch: Partial<TxDoc> = { receipt: r };
      // Категорию из чека ставим сами, только если своей толком нет.
      if (r.category && (tx.review || tx.category === "Другое" || !tx.category) && tx.kind === "expense") patch.category = r.category;
      if (r.merchant && (!tx.merchant || /qr|сбп|перевод/i.test(tx.merchant))) patch.merchant = r.merchant;
      await f.txCol.update(tx.id, { ...patch, review: patch.category ? false : tx.review });
      toast(r.items.length ? `В чеке ${r.items.length} позиций` : "Позиций не нашлось — но категорию попробовал определить", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!(await confirm("Удалить фото?", { danger: true, confirmText: "Удалить" }))) return;
    await f.txCol.update(tx.id, { photos: photos.filter((x) => x !== id) });
    await removePhotos([id]);
    setOpen(null);
  };

  const r = tx.receipt;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((id) => (
          <button key={id} type="button" onClick={() => setOpen(id)} className="size-16 overflow-hidden rounded-xl border border-line bg-surface-2">
            <img src={photoUrl(id)} alt="Фото к операции" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={!!busy}
          className="grid size-16 place-items-center rounded-xl border border-dashed border-line text-[12px] leading-tight text-muted hover:border-accent"
        >
          {busy === "upload" ? "⏳" : (
            <span>
              📷
              <br />
              {photos.length ? "Ещё" : "Фото"}
            </span>
          )}
        </button>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        {photos.length > 0 && tx.kind === "expense" && (
          <Button size="sm" variant="soft" loading={busy === "read"} onClick={read}>
            🧾 {r ? "Прочитать заново" : "Прочитать чек"}
          </Button>
        )}
      </div>

      {r && r.items.length > 0 && (
        <details className="rounded-xl bg-[var(--lh-surface)] px-2.5 py-2 text-[13px]" open={r.items.length <= 6}>
          <summary className="cursor-pointer font-medium">
            В чеке: {r.items.length} поз.{r.total ? ` на ${rub(r.total)}` : ""}
            {r.total && Math.abs(r.total - Math.abs(tx.amount)) > 1 ? <span className="text-[var(--fin-amber)]"> · не совпадает с суммой операции</span> : null}
          </summary>
          <div className="mt-1 space-y-0.5">
            {r.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {it.name}
                  {it.qty ? <span className="text-muted"> ×{it.qty}</span> : null}
                </span>
                <span className="fin-num">{rub(it.price)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {open && (
        <Sheet
          open
          onClose={() => setOpen(null)}
          title="Фото"
          footer={
            <>
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => remove(open)}>
                Удалить
              </Button>
              <a href={photoUrl(open)} target="_blank" rel="noreferrer" className="text-sm text-accent">
                Открыть оригинал
              </a>
            </>
          }
        >
          <img src={photoUrl(open)} alt="Фото к операции" className="mx-auto max-h-[70dvh] w-auto rounded-xl" />
        </Sheet>
      )}
    </div>
  );
}
