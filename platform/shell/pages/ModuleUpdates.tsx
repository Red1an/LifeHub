import { useEffect, useState } from "react";
import { Button, Card, Section, Switch, Badge, Spinner } from "../../sdk/ui.tsx";
import { request, getHost, onHubEvent } from "../../sdk/core.ts";
import { formatDate, cn } from "../../sdk/format.ts";
import type { ModuleInfo } from "../state.ts";
import { getCheckCommand } from "../state.ts";
import { CopyIcon, RefreshIcon } from "../icons.tsx";
import { copyText } from "../util.ts";

/* ───────────── обновления от автора ───────────── */

interface ApplyResult {
  mode: "replaced" | "merged" | "conflict";
  version: string;
  ok?: boolean;
  errors?: string[];
  conflicts?: string[];
}

export function UpdatesSection({ m }: { m: ModuleInfo & { modified: boolean } }) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const src = m.source;
  if (!src || (src.type !== "git" && src.type !== "builtin")) return null;
  const u = m.update;
  const pending = src.pending;

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

  const claude = `Модуль LifeHub "${m.id}" лежит в папке ${m.dir}. В папке .upstream — новая версия модуля от автора (v${pending?.version ?? ""}). Перенеси изменения автора в мой модуль, сохранив мои доработки. .upstream не редактируй. Потом проверь сборку: ${getCheckCommand()} ${m.id}`;

  return (
    <Section
      title="Обновления от автора"
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshIcon className="size-4" />}
          loading={busy === "check"}
          onClick={() =>
            run("check", async () => {
              const r = await request<{ update: unknown }>("POST", `/api/modules/${m.id}/check-update`);
              if (!r.update) getHost().toast("У вас последняя версия", "success");
            })
          }
        >
          Проверить
        </Button>
      }
    >
      <Card className="space-y-4">
        <div className="text-sm">
          <div>
            <span className="text-muted">Следит за: </span>
            <span className="break-all">{src.type === "git" ? src.url : "встроенный модуль LifeHub"}</span>
            {src.forkOf && <span className="text-muted"> (через вашу копию модуля «{src.forkOf}»)</span>}
          </div>
          <div>
            <span className="text-muted">Версия автора: </span>v{src.version}
            {m.modified && <span className="text-muted"> + ваши правки</span>}
          </div>
        </div>

        {pending ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="text-sm font-medium">Обновление до v{pending.version} ждёт объединения</div>
            <p className="mt-1 text-sm text-muted">
              Автор изменил те же места, что и вы, поэтому хаб не стал сливать сам. Версия автора лежит в папке <code>.upstream</code>.
              Попросите Claude Code объединить, затем нажмите «Готово».
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={<CopyIcon className="size-4" />} onClick={() => copyText(claude, "Запрос скопирован")}>
                Запрос для Claude Code
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy === "merged"}
                onClick={() =>
                  run("merged", async () => {
                    await request("POST", `/api/modules/${m.id}/mark-merged`);
                    getHost().toast(`Обновлено до v${pending.version}`, "success");
                  })
                }
              >
                Готово, объединено
              </Button>
            </div>
          </div>
        ) : u ? (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Доступна v{u.newVersion}</span>
              <Badge>сейчас v{u.currentVersion}</Badge>
            </div>
            {u.changes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-muted">
                {u.changes.slice(0, 10).map((c, i) => (
                  <li key={i}>• {c}</li>
                ))}
                {u.changes.length > 10 && <li>…и ещё {u.changes.length - 10}</li>}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              {u.localModified
                ? "Вы меняли модуль — хаб сольёт изменения автора с вашими. Если что-то пойдёт не так, версию до обновления можно вернуть в истории."
                : "Модуль будет заменён новой версией. Данные сохранятся."}
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="primary"
              loading={busy === "apply"}
              onClick={() =>
                run("apply", async () => {
                  const r = await request<ApplyResult>("POST", `/api/modules/${m.id}/apply-update`);
                  setResult(r);
                  if (r.mode !== "conflict") getHost().toast(`Обновлено до v${r.version}`, r.ok ? "success" : "error");
                })
              }
            >
              Обновить
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">У вас последняя версия. Хаб проверяет обновления при запуске и каждые 6 часов.</p>
        )}

        {result?.mode === "merged" && result.ok === false && (
          <p className="text-sm text-danger">После слияния модуль не собирается — посмотрите ошибку выше или верните прошлую версию в истории.</p>
        )}

        <Switch
          checked={m.autoUpdate}
          onChange={(v) => request("POST", `/api/modules/${m.id}/auto-update`, { body: { enabled: v } })}
          label={<span className="text-sm">Обновлять автоматически (если нет конфликтов)</span>}
        />
      </Card>
    </Section>
  );
}

/* ───────────── история версий ───────────── */

interface Version {
  sha: string;
  date: number;
  message: string;
  kind: string;
}

interface VersionDetails {
  files: { status: string; path: string }[];
  patch: string;
  truncated: boolean;
}

const KIND_LABEL: Record<string, string> = {
  install: "установка",
  update: "обновление",
  restore: "возврат",
  create: "создание",
  start: "при запуске",
  edit: "правка",
};

export function HistorySection({ id }: { id: string }) {
  const [data, setData] = useState<{ available: boolean; versions: Version[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, VersionDetails>>({});
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState("");

  const load = () => request<{ available: boolean; versions: Version[] }>("GET", `/api/modules/${id}/history`).then(setData, () => {});
  useEffect(() => {
    load();
    return onHubEvent((e) => {
      if ((e.type === "history" && e.id === id) || e.type === "reconnected") load();
    });
  }, [id]);

  const toggle = async (sha: string) => {
    if (open === sha) return setOpen(null);
    setOpen(sha);
    if (!details[sha]) {
      const d = await request<VersionDetails>("GET", `/api/modules/${id}/history/${sha}`);
      setDetails((x) => ({ ...x, [sha]: d }));
    }
  };

  const restore = async (v: Version) => {
    const ok = await getHost().confirm(
      `Вернуть модуль к версии от ${formatDate(v.date, "datetime")}?\n\nТекущее состояние тоже сохранится в истории — к нему можно будет вернуться.`,
      { title: "Вернуть версию", confirmText: "Вернуть" },
    );
    if (!ok) return;
    setBusy(v.sha);
    try {
      await request("POST", `/api/modules/${id}/history/${v.sha}/restore`);
      getHost().toast("Версия возвращена", "success");
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  if (!data) return null;
  if (!data.available) {
    return (
      <Section title="История версий">
        <Card>
          <p className="text-sm text-muted">Для истории версий нужен git — установите его с git-scm.com и перезапустите хаб.</p>
        </Card>
      </Section>
    );
  }
  const list = showAll ? data.versions : data.versions.slice(0, 8);

  return (
    <Section title="История версий">
      <p className="mb-2.5 text-sm text-muted">Хаб сохраняет модуль после каждой удачной сборки. Если правка всё сломала — верните прошлую версию.</p>
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {list.map((v, i) => (
          <div key={v.sha}>
            <div className="flex items-center gap-3 px-3 py-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => toggle(v.sha)}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{v.message}</span>
                  {i === 0 && <Badge>текущая</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {formatDate(v.date, "datetime")} · {KIND_LABEL[v.kind] ?? v.kind}
                </div>
              </button>
              {i > 0 && (
                <Button size="sm" variant="ghost" loading={busy === v.sha} onClick={() => restore(v)}>
                  Вернуть
                </Button>
              )}
            </div>
            {open === v.sha && (
              <div className="border-t border-line bg-surface-2 px-3 py-2">
                {!details[v.sha] ? (
                  <Spinner className="size-4" />
                ) : (
                  <>
                    <ul className="mb-2 space-y-0.5 text-xs">
                      {details[v.sha].files.map((f) => (
                        <li key={f.path} className="font-mono">
                          <span className={cn("inline-block w-4", f.status === "A" ? "text-success" : f.status === "D" ? "text-danger" : "text-muted")}>
                            {f.status === "A" ? "+" : f.status === "D" ? "−" : "~"}
                          </span>
                          {f.path}
                        </li>
                      ))}
                    </ul>
                    {details[v.sha].patch && <Diff patch={details[v.sha].patch} truncated={details[v.sha].truncated} />}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {data.versions.length > 8 && !showAll && (
        <button className="mt-2 text-sm text-muted underline underline-offset-4" onClick={() => setShowAll(true)}>
          Показать все ({data.versions.length})
        </button>
      )}
    </Section>
  );
}

function Diff({ patch, truncated }: { patch: string; truncated: boolean }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] leading-[1.45]">
      {patch.split("\n").map((l, i) => (
        <div
          key={i}
          className={cn(
            l.startsWith("+") && !l.startsWith("+++") && "bg-success/10 text-success",
            l.startsWith("-") && !l.startsWith("---") && "bg-danger/10 text-danger",
            (l.startsWith("@@") || l.startsWith("diff ")) && "text-muted",
          )}
        >
          {l || " "}
        </div>
      ))}
      {truncated && <div className="text-muted">…изменения слишком большие, показано начало</div>}
    </pre>
  );
}
