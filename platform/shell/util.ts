import { getHost } from "../sdk/core.ts";

/** Копирование в буфер — работает и по http в локальной сети (где нет navigator.clipboard). */
export async function copyText(text: string, message = "Скопировано") {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    getHost().toast(message, "success");
  } catch {
    getHost().toast("Не удалось скопировать", "error");
  }
}

export const PERMISSION_LABELS: Record<string, string> = {
  files: "Хранить файлы (фото, записи, документы)",
  mic: "Микрофон",
  camera: "Камера",
  notifications: "Уведомления",
  network: "Запросы в интернет",
  ai: "Нейронка (через ваш Claude Code)",
};

export function permissionLabel(p: string): string {
  if (p.startsWith("read:")) return `Читать данные модуля «${p.slice(5)}»`;
  return PERMISSION_LABELS[p] ?? p;
}

export function sourceLabel(s: { type: string; url?: string; from?: string } | null): string {
  if (!s) return "неизвестно";
  switch (s.type) {
    case "builtin":
      return "встроенный";
    case "git":
      return s.url ?? "git";
    case "zip":
      return "из архива";
    case "path":
      return `из папки ${s.url ?? ""}`;
    case "created":
      return "создан вами";
    case "fork":
      return `ваша версия модуля «${s.from}»`;
    default:
      return s.type;
  }
}
