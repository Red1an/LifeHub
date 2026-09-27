import { ReactNode } from "react";
import { MicState } from "@modules/audio";

/** Renders the mic permission flow, and the exercise itself once listening. */
export function MicGate({
  state,
  onStart,
  onStop,
  level,
  children,
}: {
  state: MicState;
  onStart: () => void;
  onStop: () => void;
  /** Input RMS, if the exercise tracks it — shows a live level bar. */
  level?: number;
  children: ReactNode;
}) {
  if (state === "listening") {
    // Log scale: -60 dBFS (silence) .. -10 dBFS (loud) fills the bar.
    const db = level !== undefined && level > 0 ? 20 * Math.log10(level) : -100;
    const fill = Math.max(0, Math.min(1, (db + 60) / 50));
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-4 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              Микрофон слушает
            </span>
            <button onClick={onStop} className="text-zinc-500 hover:underline">
              Выключить
            </button>
          </div>
          {level !== undefined && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-950">
                <div
                  className={`h-full transition-[width] duration-100 ${db > -12 ? "bg-red-500" : "bg-rose-500"}`}
                  style={{ width: `${fill * 100}%` }}
                />
              </div>
              <span className="w-40 text-right text-xs text-zinc-500">
                {db > -12 ? "слишком громко" : db < -58 ? "не слышу — ближе к микрофону" : "уровень ок"}
              </span>
            </div>
          )}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
      <span className="text-4xl">🎤</span>
      {state === "denied" ? (
        <>
          <p className="font-medium">Доступ к микрофону запрещён</p>
          <p className="max-w-sm text-sm text-zinc-500">
            Разреши доступ к микрофону в настройках сайта в браузере и
            обнови страницу — без него упражнение не сможет услышать голос.
          </p>
        </>
      ) : state === "error" ? (
        <>
          <p className="font-medium">Не удалось включить микрофон</p>
          <p className="max-w-sm text-sm text-zinc-500">
            Проверь, что микрофон подключён и не занят другим приложением.
          </p>
        </>
      ) : (
        <p className="max-w-sm text-sm text-zinc-500">
          Упражнение слушает твой голос через микрофон и показывает, насколько
          точно ты попадаешь в ноту. Звук никуда не отправляется — весь анализ
          идёт прямо в браузере.
        </p>
      )}
      <button
        onClick={onStart}
        disabled={state === "starting"}
        className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
      >
        {state === "starting" ? "Подключаю…" : "Включить микрофон"}
      </button>
    </div>
  );
}
