import { useEffect, useState } from "react";
import { Page, Button, Badge, Card, Section, Modal, Field, Input, Checkbox, Switch, Loading } from "../../sdk/ui.tsx";
import { request } from "../../sdk/core.ts";
import { navigate } from "../../sdk/router.tsx";
import { formatDate, formatNumber } from "../../sdk/format.ts";
import { getHost } from "../../sdk/core.ts";
import { useHub, type ModuleInfo } from "../state.ts";
import { BuildErrors } from "../ModuleHost.tsx";
import { StatusBadge } from "./Modules.tsx";
import { CopyIcon, FolderIcon, ForkIcon, DownloadIcon, TrashIcon, RefreshIcon, EditIcon } from "../icons.tsx";
import { copyText, permissionLabel, sourceLabel } from "../util.ts";
import { ModuleIcon } from "../ModuleIcon.tsx";
import { UpdatesSection, HistorySection } from "./ModuleUpdates.tsx";

interface Details extends ModuleInfo {
  stats: { collections: { collection: string; n: number }[]; files: number; filesBytes: number };
  modified: boolean;
}

export function ModuleDetailsPage({ id }: { id: string }) {
  const { state } = useHub();
  const [d, setD] = useState<Details | null>(null);
  const [err, setErr] = useState("");
  const [fork, setFork] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState("");
  const info = state?.modules.find((m) => m.id === id);

  useEffect(() => {
    request<Details>("GET", `/api/modules/${id}`).then(setD, (e) => setErr(e.message));
  }, [id, info?.hash, info?.status, info?.enabled, JSON.stringify(info?.manifest), JSON.stringify(info?.update), info?.autoUpdate, JSON.stringify(info?.source)]);

  if (err) return <Page title="Модуль" back="/modules"><p className="text-muted">{err}</p></Page>;
  if (!d || !state) return <Loading />;
  const m = d.manifest;
  const isLib = m?.type === "library";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  const claudePrompt = `Модуль LifeHub "${id}" лежит в папке ${d.dir}. `;

  return (
    <Page
      back="/modules"
      title={
        <span className="flex items-center gap-3">
          <ModuleIcon m={d} className="size-8 text-3xl" />
          <span>{m?.name ?? id}</span>
        </span>
      }
      subtitle={m?.description}
      actions={
        !isLib && d.enabled && d.status === "ok" && (
          <Button variant="primary" onClick={() => navigate(`/m/${id}`)}>
            Открыть
          </Button>
        )
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge>v{m?.version}</Badge>
        <Badge tone={isLib ? "accent" : "neutral"}>{isLib ? "библиотека" : "приложение"}</Badge>
        <StatusBadge m={d} />
        {d.modified && d.source?.type !== "created" && <Badge tone="warning">изменён вами</Badge>}
        <span className="ml-auto">
          <Switch checked={d.enabled} label="Включён" onChange={(v) => request("POST", `/api/modules/${id}/enabled`, { body: { enabled: v } })} />
        </span>
      </div>

      {d.status === "error" && (
        <div className="mb-6">
          <BuildErrors info={d} compact />
        </div>
      )}
      {d.warnings.length > 0 && (
        <Card className="mb-6 border-warning/40">
          <div className="text-sm font-medium text-warning">Предупреждения сборки</div>
          <pre className="mt-2 text-xs whitespace-pre-wrap text-muted">{d.warnings.join("\n")}</pre>
        </Card>
      )}

      <Section title="Переделать под себя">
        <Card>
          <div className="flex items-start gap-3">
            <EditIcon className="mt-0.5 size-5 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                Откройте папку модуля в <b>Claude Code</b> и опишите, что изменить — хаб подхватит правки сам и сохранит
                каждую рабочую версию.
                {(d.source?.type === "git" || d.source?.type === "builtin") && (
                  <> Обновления автора сольются с вашими правками. Своя копия нужна, только если хотите держать рядом и оригинал.</>
                )}
              </p>
              <code className="mt-3 block break-all rounded-md bg-surface-2 px-3 py-2 text-xs">{d.dir}</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={<CopyIcon className="size-4" />} onClick={() => copyText(d.dir, "Путь скопирован")}>
                  Путь
                </Button>
                <Button size="sm" icon={<CopyIcon className="size-4" />} onClick={() => copyText(claudePrompt + "Хочу изменить: ")}>
                  Заготовка запроса
                </Button>
                {state.isLocal && (
                  <Button size="sm" icon={<FolderIcon className="size-4" />} onClick={() => request("POST", `/api/modules/${id}/open-folder`)}>
                    Открыть папку
                  </Button>
                )}
                <Button size="sm" icon={<ForkIcon className="size-4" />} onClick={() => setFork(true)}>
                  Сделать свою версию
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Разрешения">
          <Card>
            {m && m.permissions.length ? (
              <ul className="space-y-1.5 text-sm">
                {m.permissions.map((p) => (
                  <li key={p}>• {permissionLabel(p)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Только свои данные</p>
            )}
            {m && m.exports.collections.length > 0 && (
              <p className="mt-3 text-sm text-muted">Открывает другим модулям: {m.exports.collections.join(", ")}</p>
            )}
          </Card>
        </Section>

        <Section title="Данные">
          <Card>
            {d.stats.collections.length === 0 && !d.stats.files ? (
              <p className="text-sm text-muted">Данных пока нет</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.stats.collections.map((c) => (
                  <li key={c.collection} className="flex justify-between">
                    <span>{c.collection}</span>
                    <span className="text-muted tabular-nums">{formatNumber(c.n)}</span>
                  </li>
                ))}
                {d.stats.files > 0 && (
                  <li className="flex justify-between">
                    <span>файлы</span>
                    <span className="text-muted tabular-nums">
                      {d.stats.files} · {(d.stats.filesBytes / 1048576).toFixed(1)} МБ
                    </span>
                  </li>
                )}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Данные хранятся отдельно от кода: правки и обновления модуля их не затрагивают.</p>
          </Card>
        </Section>

        <Section title="Зависимости">
          <Card>
            <div className="text-sm">
              <div className="text-muted">Библиотеки из общего кэша</div>
              {d.libs.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {d.libs.map((l) => (
                    <Badge key={l}>{l}</Badge>
                  ))}
                </div>
              ) : (
                <div className="mt-1">только платформа (React, SDK)</div>
              )}
              {d.uses.length > 0 && (
                <>
                  <div className="mt-3 text-muted">Модули-библиотеки</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.uses.map((u) => (
                      <Badge key={u} tone="accent">{u}</Badge>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-3 text-muted">Размер кода модуля: {d.sizeKb} КБ</div>
            </div>
          </Card>
        </Section>

        <Section title="Происхождение">
          <Card>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted">Источник: </span>
                <span className="break-all">{sourceLabel(d.source)}</span>
              </div>
              {m?.forkedFrom && (
                <div>
                  <span className="text-muted">Основан на: </span>
                  {m.forkedFrom}
                </div>
              )}
              {m?.author && (
                <div>
                  <span className="text-muted">Автор: </span>
                  {m.author}
                </div>
              )}
              {d.source && (
                <div>
                  <span className="text-muted">Установлен: </span>
                  {formatDate(d.source.installedAt, "long")}
                </div>
              )}
            </div>
          </Card>
        </Section>
      </div>

      <UpdatesSection m={d} />
      <HistorySection id={id} />

      <Section title="Действия">
        <div className="flex flex-wrap gap-2">
          <Button icon={<DownloadIcon className="size-4" />} onClick={() => (location.href = `/api/modules/${id}/export`)}>
            Поделиться (zip)
          </Button>
          <Button
            icon={<RefreshIcon className="size-4" />}
            loading={busy === "rebuild"}
            onClick={() => run("rebuild", async () => void (await request("POST", `/api/modules/${id}/rebuild`)))}
          >
            Пересобрать
          </Button>
          <Button variant="ghost" className="text-danger" icon={<TrashIcon className="size-4" />} onClick={() => setDel(true)}>
            Удалить
          </Button>
        </div>
      </Section>

      <ForkModal open={fork} onClose={() => setFork(false)} info={d} />
      <DeleteModal open={del} onClose={() => setDel(false)} info={d} />
    </Page>
  );
}

function ForkModal({ open, onClose, info }: { open: boolean; onClose: () => void; info: Details }) {
  const [newId, setNewId] = useState(`my-${info.id}`.slice(0, 40));
  const [name, setName] = useState(`${info.manifest?.name ?? info.id} (моя версия)`);
  const [copyData, setCopyData] = useState(true);
  const [disableOriginal, setDisableOriginal] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Своя версия модуля"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await request<{ id: string }>("POST", `/api/modules/${info.id}/fork`, { body: { newId, name, copyData } });
                if (disableOriginal) await request("POST", `/api/modules/${info.id}/enabled`, { body: { enabled: false } });
                onClose();
                navigate(`/modules/${r.id}`);
              } catch (e) {
                getHost().toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Создать
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Копия модуля, которую можно менять как угодно. Оригинал останется нетронутым, а в копии будет отметка, от чего она произошла.
      </p>
      <div className="space-y-4">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="id (имя папки)" hint="латиница в нижнем регистре, цифры и дефис">
          <Input value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase())} />
        </Field>
        <Checkbox checked={copyData} onChange={setCopyData} label="Скопировать мои данные из оригинала" />
        <Checkbox checked={disableOriginal} onChange={setDisableOriginal} label="Выключить оригинал" />
      </div>
    </Modal>
  );
}

function DeleteModal({ open, onClose, info }: { open: boolean; onClose: () => void; info: Details }) {
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Удалить «${info.manifest?.name ?? info.id}»?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("DELETE", `/api/modules/${info.id}${purge ? "?purge=1" : ""}`);
                onClose();
                navigate("/modules");
                getHost().toast("Модуль удалён", "success");
              } catch (e) {
                getHost().toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Папка модуля переместится в корзину хаба (~/.lifehub/trash) — её можно будет вернуть вручную.</p>
      <div className="mt-4">
        <Checkbox checked={purge} onChange={setPurge} label="Удалить и данные модуля (без возможности восстановления)" />
      </div>
    </Modal>
  );
}
