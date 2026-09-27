import { useState } from "react";
import { Page, Button, Badge, Switch, EmptyState, Card } from "../../sdk/ui.tsx";
import { request, getHost } from "../../sdk/core.ts";
import { navigate } from "../../sdk/router.tsx";
import { useHub, saveSettings, type ModuleInfo } from "../state.ts";
import { Link } from "../nav.ts";
import { PlusIcon, FolderIcon, CopyIcon } from "../icons.tsx";
import { copyText } from "../util.ts";
import { ModuleIcon } from "../ModuleIcon.tsx";

export function StatusBadge({ m }: { m: ModuleInfo }) {
  if (m.source?.pending) return <Badge tone="warning">ждёт объединения</Badge>;
  if (m.update) return <Badge tone="accent">обновление v{m.update.newVersion}</Badge>;
  if (m.status === "disabled") return <Badge>выключен</Badge>;
  if (m.status === "error") return <Badge tone="danger">ошибка</Badge>;
  if (m.status === "building") return <Badge tone="warning">сборка…</Badge>;
  return null;
}

function CheckUpdatesButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await request<{ updates: string[] }>("POST", "/api/updates/check");
          getHost().toast(r.updates.length ? `Есть обновления: ${r.updates.length}` : "Все модули последних версий", "success");
        } catch (e) {
          getHost().toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      Проверить обновления
    </Button>
  );
}

export function ModulesPage() {
  const { state } = useHub();
  if (!state) return null;
  const mods = state.modules;
  const apps = mods.filter((m) => m.manifest?.type !== "library");
  const libs = mods.filter((m) => m.manifest?.type === "library");

  const move = (id: string, dir: -1 | 1) => {
    const ids = apps.map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveSettings({ order: ids });
  };

  const row = (m: ModuleInfo, i: number, list: ModuleInfo[]) => (
    <div key={m.id} className="flex items-center gap-3 px-4 py-3">
      <Link to={`/modules/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface"><ModuleIcon m={m} className="size-5 text-lg" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{m.manifest?.name ?? m.id}</span>
            <StatusBadge m={m} />
          </span>
          <span className="block truncate text-sm text-muted">
            {m.manifest?.description || m.id} · v{m.manifest?.version ?? "?"}
          </span>
        </span>
      </Link>
      {list === apps && (
        <span className="hidden flex-col sm:flex">
          <button className="px-1 text-xs text-muted hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => move(m.id, -1)} aria-label="Выше">
            ▲
          </button>
          <button className="px-1 text-xs text-muted hover:text-fg disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(m.id, 1)} aria-label="Ниже">
            ▼
          </button>
        </span>
      )}
      <Switch checked={m.enabled} onChange={(v) => request("POST", `/api/modules/${m.id}/enabled`, { body: { enabled: v } })} />
    </div>
  );

  return (
    <Page
      title="Модули"
      subtitle="Каждый модуль — отдельное приложение. Их можно ставить, делиться ими и переделывать под себя."
      actions={
        <>
          <CheckUpdatesButton />
          <Button variant="primary" icon={<PlusIcon className="size-4" />} onClick={() => navigate("/modules/add")}>
            Добавить
          </Button>
        </>
      }
    >
      {mods.length === 0 ? (
        <EmptyState icon="🧩" title="Модулей пока нет" action={<Button variant="primary" onClick={() => navigate("/modules/add")}>Добавить модуль</Button>} />
      ) : (
        <>
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{apps.map((m, i) => row(m, i, apps))}</div>
          {libs.length > 0 && (
            <>
              <h2 className="mt-8 mb-1 text-sm font-medium text-muted">Библиотеки</h2>
              <p className="mb-3 text-sm text-muted">Общий код, которым пользуются другие модули. Загружается один раз на всех.</p>
              <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{libs.map((m, i) => row(m, i, libs))}</div>
            </>
          )}
        </>
      )}

      <Card className="mt-8">
        <h2 className="font-semibold">Правка модулей в Claude Code</h2>
        <p className="mt-1 text-sm text-muted">
          Все модули лежат в одной папке. Откройте её (или папку отдельного модуля) в Claude Code и опишите, что изменить —
          хаб пересоберёт модуль сразу после сохранения файлов. Инструкция для нейронки уже лежит там в CLAUDE.md.
        </p>
        <code className="mt-3 block break-all rounded-md bg-surface-2 px-3 py-2 text-sm">{state.modulesDir}</code>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" icon={<CopyIcon className="size-4" />} onClick={() => copyText(state.modulesDir, "Путь скопирован")}>
            Скопировать путь
          </Button>
          {state.isLocal && (
            <Button size="sm" icon={<FolderIcon className="size-4" />} onClick={() => request("POST", "/api/open-modules-folder")}>
              Открыть папку
            </Button>
          )}
        </div>
      </Card>
    </Page>
  );
}
