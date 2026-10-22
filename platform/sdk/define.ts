import type { ComponentType, ReactNode } from "react";

export interface NavItem {
  /** Путь внутри модуля, например "/" или "/stats". */
  to: string;
  label: string;
  /** Эмодзи или короткий символ. */
  icon?: string;
}

export interface WidgetDefinition {
  title?: string;
  /** Ширина на главной: sm — 1 колонка, md — 2, lg — вся строка. */
  size?: "sm" | "md" | "lg";
  component: ComponentType;
}

/** Короткая сводка модуля на его плитке на главной хаба. Только факты, не задания. */
export interface ModuleSummary {
  /** Главная цифра или слово: «19 360 ₽», «3/5», «15:10». */
  value?: string;
  /** Пояснение одной строкой: «потрачено в октябре», «Прикладные методы». */
  text?: string;
}

export interface ModuleDefinition {
  /**
   * Страницы модуля: путь → компонент. Поддерживаются параметры (":id")
   * и "*" для всего остального. "/" обязателен.
   */
  routes: Record<string, ComponentType>;
  /** Разделы модуля: вкладки сверху на компьютере и нижнее меню на телефоне. */
  nav?: NavItem[];
  /** Виджеты для главной страницы хаба. */
  widgets?: Record<string, WidgetDefinition>;
  /**
   * Хук сводки для главной хаба. Вызывается в компоненте хаба (можно useCollection, useStore и т.п.,
   * но не контекст из layout модуля). null — показывать описание из манифеста.
   */
  summary?: () => ModuleSummary | null;
  /** Обёртка вокруг всех страниц модуля. */
  layout?: ComponentType<{ children: ReactNode }>;
  /**
   * Своя тема модуля независимо от темы хаба: "dark" или "light".
   * Токены (bg-bg, text-fg, …) и dark:-классы внутри модуля будут следовать ей.
   */
  theme?: "light" | "dark";
}

/** Описывает модуль. Результат нужно экспортировать по умолчанию из entry-файла. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  if (!def || typeof def !== "object" || !def.routes || !def.routes["/"]) {
    throw new Error('defineModule: нужен объект с routes, включая маршрут "/"');
  }
  return def;
}
