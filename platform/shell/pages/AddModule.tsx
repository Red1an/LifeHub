import { useEffect, useRef, useState } from "react";
import { Page, Button, Card, Tabs, Field, Input, Textarea, Modal, Badge, Loading, Section } from "../../sdk/ui.tsx";
import { request, getHost } from "../../sdk/core.ts";
import { navigate } from "../../sdk/router.tsx";
import { useHub } from "../state.ts";
import { permissionLabel } from "../util.ts";
import { isImageIcon } from "../ModuleIcon.tsx";

interface Preview {
  stagingId: string;
  manifest: {
    id: string; name: string; version: string; description?: string; icon?: string; author?: string;
    type: string; permissions: string[]; deps: Record<string, string>; uses: Record<string, string>; forkedFrom?: string;
  };
  exists: boolean;
  installedVersion: string | null;
  files: number;
}

interface CatalogItem {
  id: string; name: string; description: string; icon: string; version: string; type: string; installed: boolean;
  source: { type: "builtin"; id: string } | { type: "git"; url: string };
}

type Tab = "catalog" | "create" | "git" | "file";

export function AddModulePage() {
  const [tab, setTab] = useState<Tab>("catalog");
  const [preview, setPreview] = useState<Preview | null>(null);
  return (
    <Page back="/modules" title="Добавить модуль">
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "catalog", label: "Каталог" },
          { id: "create", label: "Создать" },
          { id: "git", label: "По ссылке" },
          { id: "file", label: "Из файла" },
        ]}
      />
      {tab === "catalog" && <Catalog onPreview={setPreview} />}
      {tab === "create" && <Create />}
      {tab === "git" && <FromGit onPreview={setPreview} />}
      {tab === "file" && <FromFile onPreview={setPreview} />}
      <InstallModal preview={preview} onClose={() => setPreview(null)} />
    </Page>
  );
}

function Catalog({ onPreview }: { onPreview: (p: Preview) => void }) {
  const [sections, setSections] = useState<{ title: string; error?: string; items: CatalogItem[] }[] | null>(null);
  const [busy, setBusy] = useState("");
  const { state } = useHub();
  useEffect(() => {
    request<typeof sections>("GET", "/api/catalog").then(setSections, (e) => getHost().toast(e.message, "error"));
  }, [state?.modules.length]);
  if (!sections) return <Loading />;
  return (
    <>
      {sections.map((s) => (
        <Section key={s.title} title={s.title}>
          {s.error && <p className="text-sm text-danger">{s.error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {s.items.map((it) => (
              <Card key={it.id + it.source.type} className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md border border-line text-xl">{isImageIcon(it.icon) ? "▫️" : it.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{it.name}</span>
                    {it.type === "library" && <Badge tone="accent">библиотека</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{it.description}</p>
                  <div className="mt-3">
                    {it.installed ? (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/modules/${it.id}`)}>
                        Установлен →
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="soft"
                        loading={busy === it.id}
                        onClick={async () => {
                          setBusy(it.id);
                          try {
                            onPreview(await request<Preview>("POST", "/api/modules/install", { body: it.source }));
                          } catch (e) {
                            getHost().toast((e as Error).message, "error");
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        Установить
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ))}
      <p className="text-sm text-muted">Другие каталоги (JSON по ссылке) можно подключить в настройках.</p>
    </>
  );
}

interface Template {
  id: string;
  name: string;
  description: string;
}

function Create() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [template, setTemplate] = useState("collection");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [icon, setIcon] = useState("✨");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Template[]>("GET", "/api/templates").then(setTemplates);
  }, []);
  const autoId = (n: string) =>
    translit(n.toLowerCase())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 40);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await request<{ id: string }>("POST", "/api/modules/create", { body: { id, name, icon, description, template } });
              getHost().toast("Модуль создан", "success");
              navigate(`/modules/${r.id}`);
            } catch (err) {
              getHost().toast((err as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-[72px_1fr] gap-3">
            <Field label="Иконка">
              <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="text-center text-xl" maxLength={4} />
            </Field>
            <Field label="Название">
              <Input
                required
                value={name}
                placeholder="Например, Трекер воды"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(autoId(e.target.value));
                }}
              />
            </Field>
          </div>
          <Field label="id" hint="Имя папки: латиница, цифры, дефис">
            <Input
              required
              value={id}
              pattern="[a-z][a-z0-9-]{1,40}"
              onChange={(e) => {
                setIdTouched(true);
                setId(e.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field label="Что будет делать модуль" hint="Попадёт в описание и в CLAUDE.md модуля — Claude Code будет знать задачу.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Считать выпитую воду за день, напоминать и показывать статистику за неделю" />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-medium">Шаблон</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${template === t.id ? "border-fg/60 bg-surface-2" : "border-line hover:bg-surface-2"}`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" variant="primary" loading={busy} disabled={!name || !id}>
            Создать модуль
          </Button>
        </form>
      </Card>
      <Card className="h-fit">
        <h3 className="font-semibold">Дальше — в Claude Code</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-muted">
          <li>Создайте модуль из шаблона.</li>
          <li>Откройте его папку в Claude Code.</li>
          <li>Опишите, что нужно сделать, — нейронка знает SDK хаба из CLAUDE.md.</li>
          <li>Хаб пересоберёт модуль сразу после сохранения файлов.</li>
        </ol>
      </Card>
    </div>
  );
}

function FromGit({ onPreview }: { onPreview: (p: Preview) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { state } = useHub();
  const [path, setPath] = useState("");
  const stage = async (body: unknown) => {
    setBusy(true);
    try {
      onPreview(await request<Preview>("POST", "/api/modules/install", { body }));
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            stage({ type: "git", url });
          }}
        >
          <Field label="Ссылка на git-репозиторий" hint="Если в репозитории несколько модулей — добавьте #папка в конце">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/user/lifehub-habits" required />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Загрузить
          </Button>
        </form>
      </Card>
      {state?.isLocal && (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              stage({ type: "path", path });
            }}
          >
            <Field label="Или папка на этом компьютере">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\Projects\my-module" required />
            </Field>
            <Button type="submit" loading={busy}>
              Загрузить
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function FromFile({ onPreview }: { onPreview: (p: Preview) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      onPreview(await request<Preview>("POST", "/api/modules/install-zip", { raw: file, headers: { "content-type": "application/zip" } }));
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      }}
      className={`flex flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center transition-colors ${drag ? "border-fg/60 bg-surface-2" : "border-line"}`}
    >
      <p className="font-medium">Перетащите сюда .zip с модулем</p>
      <p className="mt-1 text-sm text-muted">Такой архив получается кнопкой «Поделиться» на странице модуля</p>
      <input ref={input} type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button className="mt-5" loading={busy} onClick={() => input.current?.click()}>
        Выбрать файл
      </Button>
    </div>
  );
}

function InstallModal({ preview, onClose }: { preview: Preview | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [altId, setAltId] = useState("");
  useEffect(() => setAltId(preview ? `${preview.manifest.id}-2` : ""), [preview?.stagingId]);
  if (!preview) return null;
  const m = preview.manifest;
  const install = async (opts: { replace?: boolean; id?: string }) => {
    setBusy(true);
    try {
      const r = await request<{ id: string }>("POST", "/api/modules/install/confirm", { body: { stagingId: preview.stagingId, ...opts } });
      onClose();
      getHost().toast(`«${m.name}» установлен`, "success");
      navigate(m.type === "library" ? `/modules/${r.id}` : `/m/${r.id}`);
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const deps = Object.entries(m.deps);
  return (
    <Modal
      open
      onClose={onClose}
      title="Установка модуля"
      footer={
        preview.exists ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button loading={busy} onClick={() => install({ id: altId })}>
              Поставить рядом
            </Button>
            <Button variant="primary" loading={busy} onClick={() => install({ replace: true })}>
              Заменить
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="primary" loading={busy} onClick={() => install({})}>
              Установить
            </Button>
          </>
        )
      }
    >
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-line text-2xl">{isImageIcon(m.icon) ? "▫️" : (m.icon ?? "▫️")}</span>
        <div>
          <div className="text-lg font-semibold">{m.name}</div>
          <div className="text-sm text-muted">
            v{m.version}
            {m.author && ` · ${m.author}`} · {preview.files} файлов
          </div>
          {m.description && <p className="mt-1 text-sm">{m.description}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-4 text-sm">
        <div>
          <div className="font-medium">Модулю нужно</div>
          {m.permissions.length ? (
            <ul className="mt-1 space-y-0.5 text-muted">
              {m.permissions.map((p) => (
                <li key={p}>• {permissionLabel(p)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">Только собственные данные</p>
          )}
        </div>
        {deps.length > 0 && (
          <div>
            <div className="font-medium">Библиотеки</div>
            <p className="mt-1 text-muted">
              {deps.map(([n, v]) => `${n}@${v}`).join(", ")} — скачаются в общий кэш один раз, если их ещё нет.
            </p>
          </div>
        )}
        <p className="rounded-md bg-warning/10 p-3 text-xs text-warning">
          Модуль — это код, который выполняется в хабе и имеет доступ к вашему браузеру. Ставьте модули от людей, которым доверяете,
          или попросите Claude Code проверить код перед использованием.
        </p>
        {preview.exists && (
          <div className="space-y-2">
            <p>
              Модуль <b>{m.id}</b> уже установлен (v{preview.installedVersion}). «Заменить» — обновит код, данные сохранятся.
              «Поставить рядом» — установит копию под другим id:
            </p>
            <Input value={altId} onChange={(e) => setAltId(e.target.value.toLowerCase())} />
          </div>
        )}
      </div>
    </Modal>
  );
}

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const translit = (s: string) => s.replace(/[а-яё]/g, (c) => TR[c] ?? c);
