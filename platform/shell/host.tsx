import { useEffect, useState } from "react";
import { setHost } from "../sdk/core.ts";
import { Button, Input, Modal } from "../sdk/ui.tsx";
import { cn } from "../sdk/format.ts";
import { manifestOf } from "./state.ts";

/* Тосты и диалоги, которые SDK показывает по просьбе модулей. */

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

type Dialog =
  | { kind: "confirm"; message: string; title?: string; danger?: boolean; confirmText?: string; resolve: (v: boolean) => void }
  | { kind: "prompt"; message: string; initial: string; resolve: (v: string | null) => void };

let pushToast: (t: Toast) => void = () => {};
let openDialog: (d: Dialog) => void = () => {};
let seq = 0;

setHost({
  toast(message, tone = "info") {
    pushToast({ id: ++seq, message, tone });
  },
  confirm(message, opts = {}) {
    return new Promise((resolve) => openDialog({ kind: "confirm", message, ...opts, resolve }));
  },
  prompt(message, initial = "") {
    return new Promise((resolve) => openDialog({ kind: "prompt", message, initial, resolve }));
  },
  manifest: manifestOf,
});

export function HostLayer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    pushToast = (t) => {
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.tone === "error" ? 6000 : 3000);
    };
    openDialog = (d) => {
      if (d.kind === "prompt") setValue(d.initial);
      setDialog(d);
    };
  }, []);

  const close = (result: boolean) => {
    if (!dialog) return;
    if (dialog.kind === "confirm") dialog.resolve(result);
    else dialog.resolve(result ? value : null);
    setDialog(null);
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[200] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "lh-toast pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg",
              t.tone === "error" ? "bg-danger text-white" : t.tone === "success" ? "bg-success text-white" : "bg-fg text-bg",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        size="sm"
        title={dialog?.kind === "confirm" ? (dialog.title ?? "Подтвердите") : "Введите значение"}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Отмена
            </Button>
            <Button variant={dialog?.kind === "confirm" && dialog.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {dialog?.kind === "confirm" ? (dialog.confirmText ?? "OK") : "OK"}
            </Button>
          </>
        }
      >
        <p className="whitespace-pre-line text-muted">{dialog?.message}</p>
        {dialog?.kind === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <Input className="mt-3" value={value} onChange={(e) => setValue(e.target.value)} />
          </form>
        )}
      </Modal>
    </>
  );
}
