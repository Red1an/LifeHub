import { cn } from "../sdk/format.ts";
import type { ModuleInfo } from "./state.ts";

export const isImageIcon = (icon?: string) => !!icon && /\.(svg|png|jpe?g|webp)$/i.test(icon);

/** Иконка модуля: эмодзи из манифеста или своя картинка ("icon": "icon.svg"). */
export function ModuleIcon({ m, className }: { m: ModuleInfo; className?: string }) {
  const icon = m.manifest?.icon;
  if (isImageIcon(icon)) {
    return <img src={`/modules/${m.id}/icon?v=${m.hash}`} alt="" className={cn("object-contain", className)} draggable={false} />;
  }
  return <span className={cn("grid place-items-center leading-none", className)}>{icon || "▫️"}</span>;
}
