import { request } from "./core.ts";

/*
 * Входящий вебхук модуля (разрешение "webhook"): секретный адрес, на который телефон или
 * внешний сервис шлёт данные без входа в хаб. Каждый запрос попадает в коллекцию "webhook"
 * модуля: { receivedAt, ...JSON-тело или поля формы, text — если тело просто текст, параметры адреса }.
 * Модуль разбирает её (useCollection("webhook")) и удаляет разобранное.
 */

export interface WebhookInfo {
  /** Путь на хабе: /hook/<модуль>/<секрет>. */
  path: string;
  /** Полные адреса: из интернета (ngrok, если включён), Tailscale, домашняя сеть. */
  urls: { label: string; url: string; public: boolean }[];
}

export function createWebhook(module: string) {
  return {
    /** Адреса вебхука; секрет создаётся при первом вызове. */
    info: () => request<WebhookInfo>("GET", `/api/hooks/${module}`, { module }),
    /** Новый секрет — старый адрес перестаёт работать. */
    rotate: () => request<WebhookInfo>("POST", `/api/hooks/${module}/rotate`, { module }),
  };
}
