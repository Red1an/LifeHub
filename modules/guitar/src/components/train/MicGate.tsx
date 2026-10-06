import { useRef, type ReactNode } from "react";
import { MicState } from "@modules/audio";

type LevelLabel = "quiet" | "ok" | "loud";

/** Подпись уровня с гистерезисом: не прыгает туда-сюда на границе. */
function useLevelLabel(db: number): LevelLabel {
  const ref = useRef<LevelLabel>("ok");
  const cur = ref.current;
  if (cur === "loud" && db < -15) ref.current = "ok";
  else if (cur === "quiet" && db > -52) ref.current = "ok";
  else if (cur === "ok" && db > -10) ref.current = "loud";
  else if (cur === "ok" && db < -58) ref.current = "quiet";
  return ref.current;
}

/** Включение микрофона, а после — само упражнение с индикатором уровня. */
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
  // Log scale: -60 dBFS (silence) .. -10 dBFS (loud) fills the bar.
  const db = level !== undefined && level > 0 ? 20 * Math.log10(level) : -100;
  const label = useLevelLabel(db);

  if (state === "listening") {
    const fill = Math.max(0, Math.min(1, (db + 60) / 50));
    return (
      <div className="flex flex-col gap-4">
        <div className="gt-panel flex items-center gap-3 !rounded-2xl px-4 py-2.5 text-sm">
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--gt-rose)] opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[var(--gt-rose)]" />
          </span>
          {level !== undefined ? (
            <>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#2a2420]">
                <div
                  className="h-full rounded-full transition-[width] duration-150 ease-out"
                  style={{ width: `${fill * 100}%`, background: label === "loud" ? "var(--gt-red)" : "var(--gt-green)" }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-[var(--gt-muted)] sm:w-36">
                {label === "loud" ? "слишком громко" : label === "quiet" ? "не слышу" : "уровень ок"}
              </span>
            </>
          ) : (
            <span className="flex-1 text-[var(--gt-muted)]">Микрофон слушает</span>
          )}
          <button onClick={onStop} className="shrink-0 text-xs text-[var(--gt-muted)] hover:text-[var(--gt-fg)]">
            Выкл
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="gt-panel flex flex-col items-center gap-4 p-8 text-center">
      <span className="text-4xl">🎤</span>
      {state === "denied" ? (
        <>
          <p className="font-bold">Доступ к микрофону запрещён</p>
          <p className="max-w-sm text-sm text-[var(--gt-muted)]">
            Разреши микрофон в настройках сайта в браузере и обнови страницу. На телефоне микрофон работает только по HTTPS.
          </p>
        </>
      ) : state === "error" ? (
        <>
          <p className="font-bold">Не удалось включить микрофон</p>
          <p className="max-w-sm text-sm text-[var(--gt-muted)]">Проверь, что микрофон подключён и не занят другим приложением.</p>
        </>
      ) : (
        <p className="max-w-sm text-sm text-[var(--gt-muted)]">
          Упражнение слушает гитару или голос через микрофон. Звук никуда не отправляется — анализ идёт прямо в браузере.
        </p>
      )}
      <button onClick={onStart} disabled={state === "starting"} className="gt-btn gt-btn-brass">
        {state === "starting" ? "Подключаю…" : "Включить микрофон"}
      </button>
    </div>
  );
}
