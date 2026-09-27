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
