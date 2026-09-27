import { createContext, useContext } from "react";
import { createRouting } from "../sdk/router.tsx";
import type { NavItem } from "../sdk/define.ts";

/** Ссылки оболочки — пути хаба без префикса модуля. */
export const { Link } = createRouting("");

/** Разделы открытого модуля — чтобы показать их в нижнем меню на телефоне. */
export const ModuleNavContext = createContext<{ set: (nav: { id: string; items: NavItem[] } | null) => void }>({ set: () => {} });
export const useModuleNavSetter = () => useContext(ModuleNavContext).set;
