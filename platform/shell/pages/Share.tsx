import { useEffect } from "react";
import { Page, Card, EmptyState } from "../../sdk/ui.tsx";
import { navigate } from "../../sdk/router.tsx";
import { appModules, useHub, type ModuleInfo } from "../state.ts";
import { ModuleIcon } from "../ModuleIcon.tsx";

/**
 * «Поделиться» с телефона: PWA хаба — цель share_target (/share?title=&text=&url=).
 * Передаём присланное модулю с полем share в манифесте; если таких несколько — даём выбрать.
 */
export function SharePage() {
  const { state } = useHub();
  const targets = state ? appModules(state).filter((m) => m.manifest?.share) : [];
  const query = location.search;

  const open = (m: ModuleInfo) => {
    const path = m.manifest!.share!;
    navigate(`/m/${m.id}${path === "/" ? "" : path}${path.includes("?") ? query.replace("?", "&") : query}`, { replace: true });
  };

  useEffect(() => {
    if (targets.length === 1) open(targets[0]);
  }, [targets.length]);

  const shared = new URLSearchParams(query);
  const preview = [shared.get("title"), shared.get("text"), shared.get("url")].filter(Boolean).join(" · ");

  return (
    <Page title="Поделиться" subtitle={preview || undefined} width="narrow">
      {!targets.length ? (
        <EmptyState icon="📤" title="Некуда передать" text="Ни один модуль не принимает «Поделиться». Включите, например, «Заметки»." />
      ) : (
        <div className="space-y-2">
          {targets.map((m) => (
            <button key={m.id} type="button" className="block w-full text-left" onClick={() => open(m)}>
              <Card interactive className="flex items-center gap-3">
                <ModuleIcon m={m} className="size-8 text-2xl" />
                <span className="font-medium">{m.manifest?.name ?? m.id}</span>
              </Card>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}
