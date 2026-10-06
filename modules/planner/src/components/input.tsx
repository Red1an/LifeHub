import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { cn, toast } from "@lifehub/sdk";

/** Поле, которое растёт вместе с текстом (до 60% высоты экрана, дальше — прокрутка). */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }>(function AutoTextarea(
  { minRows = 3, className, value, ...rest },
  outer,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(outer, () => ref.current!);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const max = window.innerHeight * 0.6;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return <textarea ref={ref} rows={minRows} value={value} className={cn("pl-input resize-none", className)} {...rest} />;
});

/* ───────────── голосовой ввод ───────────── */

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionClass(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Нет доступа к микрофону — разрешите его в настройках браузера для этого сайта",
  "service-not-allowed": "Браузер не разрешил распознавание речи. Нужен HTTPS или открытие хаба на этом компьютере",
  "audio-capture": "Микрофон не найден",
  network: "Распознаванию речи нужен интернет",
  "language-not-supported": "Браузер не умеет распознавать русскую речь",
};

/**
 * Диктовка через распознавание речи браузера (Chrome, Edge, Safari).
 * onFinal получает готовые фразы, interim — то, что ещё распознаётся.
 */
export function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;
  const supported = !!recognitionClass();

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Cls = recognitionClass();
    if (!Cls) {
      toast("Голосовой ввод не поддерживается этим браузером — попробуйте Chrome или Safari, либо микрофон на клавиатуре телефона", "error");
      return;
    }
    if (!window.isSecureContext) {
      toast("Голосовой ввод работает только по HTTPS (Tailscale или ngrok) или на компьютере с хабом", "error");
      return;
    }
    const r = new Cls();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) cb.current(t.trim());
        else live += t;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") toast(ERRORS[e.error] ?? `Ошибка распознавания: ${e.error}`, "error");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  return { listening, interim, supported, start, stop, toggle: () => (rec.current ? stop() : start()) };
}

/** Добавить продиктованную фразу к тексту с пробелом. */
export const appendText = (prev: string, add: string) => (!prev.trim() ? add : `${prev.replace(/\s+$/, "")} ${add}`);

export function MicButton({ listening, onClick, className }: { listening: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={cn("pl-chip", listening && "pl-mic-on", className)} aria-pressed={listening} onClick={onClick}>
      {listening ? "⏹ Стоп" : "🎤 Голосом"}
    </button>
  );
}
