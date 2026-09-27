import { useEffect, useRef } from "react";
import { getHost } from "./core.ts";

function requirePermission(module: string, perm: string) {
  const m = getHost().manifest(module);
  if (m && !m.permissions.includes(perm)) {
    throw new Error(`Модулю "${module}" нужно разрешение "${perm}" в lifehub.json`);
  }
}

function secureContextHint() {
  if (!window.isSecureContext) {
    throw new Error(
      "Микрофон и камера работают только по HTTPS или на localhost. Запустите хаб с флагом --https или используйте Tailscale.",
    );
  }
}

export function createMedia(module: string) {
  return {
    /** Поток с микрофона. Не забудьте остановить: stream.getTracks().forEach(t => t.stop()). */
    async microphone(constraints: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }) {
      requirePermission(module, "mic");
      secureContextHint();
      return navigator.mediaDevices.getUserMedia({ audio: constraints });
    },
    async camera(constraints: MediaTrackConstraints = { facingMode: "environment" }) {
      requirePermission(module, "camera");
      secureContextHint();
      return navigator.mediaDevices.getUserMedia({ video: constraints });
    },
    /** Системное уведомление (нужно разрешение "notifications"). */
    async notify(title: string, body?: string) {
      requirePermission(module, "notifications");
      if (!("Notification" in window)) return false;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") return false;
      new Notification(title, { body, icon: "/icon.svg" });
      return true;
    },
  };
}

/* ───────────── события между модулями (внутри страницы) ───────────── */

const bus = new EventTarget();

export function emitEvent(name: string, detail?: unknown) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function onEvent(name: string, handler: (detail: any) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent).detail);
  bus.addEventListener(name, fn);
  return () => bus.removeEventListener(name, fn);
}

export function useEvent(name: string, handler: (detail: any) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onEvent(name, (d) => ref.current(d)), [name]);
}
