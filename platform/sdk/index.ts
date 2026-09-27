/**
 * @lifehub/sdk — всё, что нужно модулю: страницы, данные, файлы, UI.
 * Документация для людей и нейронок: docs/MODULE_GUIDE.md.
 */
import { bind } from "./bind.ts";
import { getHost } from "./core.ts";

export { defineModule } from "./define.ts";
export type { ModuleDefinition, NavItem, WidgetDefinition } from "./define.ts";

export * from "./ui.tsx";
export * from "./charts.tsx";
export * from "./format.ts";
export { useParams, matchPath } from "./router.tsx";
export { emitEvent, onEvent, useEvent } from "./media.ts";
export type { Doc, WithDoc, Collection, CollectionOptions, UseCollectionResult } from "./data.ts";
export type { FileMeta } from "./files.ts";
export type { ModuleManifest } from "./core.ts";
export type { AiOptions, ChatMessage } from "./ai.ts";
export { AiRequestError, parseJson } from "./ai.ts";

/** Всплывающее уведомление. */
export const toast = (message: string, tone?: "info" | "success" | "error") => getHost().toast(message, tone);
/** Диалог подтверждения. */
export const confirm = (message: string, opts?: { title?: string; danger?: boolean; confirmText?: string }) => getHost().confirm(message, opts);
/** Диалог ввода строки. */
export const prompt = (message: string, initial?: string) => getHost().prompt(message, initial);

/*
 * Функции ниже привязаны к модулю. Здесь они экспортируются для типов и для
 * самой оболочки хаба; модули получают свою привязанную версию.
 */
const hub = bind("hub");

/** Нейронка (разрешение "ai"): ai.ask, ai.chat, ai.json. Работает через Claude Code на компьютере с хабом. */
export const ai = hub.ai;
/** Запрос к нейронке с потоковым выводом в компоненте. */
export const useAi = hub.useAi;
/** Коллекции документов модуля: db.collection<T>("name"). */
export const db = hub.db;
/** Хранилище ключ-значение модуля. */
export const kv = hub.kv;
/** Файлы модуля (нужно разрешение "files"). */
export const files = hub.files;
/** Микрофон, камера, уведомления (нужны разрешения). */
export const media = hub.media;
/** Реактивная коллекция: items, add, update, remove… */
export const useCollection = hub.useCollection;
/** Одна запись коллекции по id. */
export const useDoc = hub.useDoc;
/** Как useState, но сохраняется на сервере и синхронизируется между устройствами. */
export const useStore = hub.useStore;
/** Список файлов модуля. */
export const useFiles = hub.useFiles;
/** Переход на страницу модуля: navigate("/stats"). "~/..." — путь хаба. */
export const useNavigate = hub.useNavigate;
/** Текущий путь внутри модуля. */
export const useLocation = hub.useLocation;
/** Параметры ?query=… */
export const useSearchParams = hub.useSearchParams;
/** Ссылка на страницу модуля: <Link to="/stats">. */
export const Link = hub.Link;
/** id, базовый путь и манифест текущего модуля. */
export const useModule = hub.useModule;
