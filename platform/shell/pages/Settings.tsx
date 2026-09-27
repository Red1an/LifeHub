import { useEffect, useState } from "react";
import { Page, Section, Card, Button, Field, Input, Tabs, Badge, Loading } from "../../sdk/ui.tsx";
import { request, getHost } from "../../sdk/core.ts";
import { cn } from "../../sdk/format.ts";
import { useHub, saveSettings, type HubSettings } from "../state.ts";
import { copyText } from "../util.ts";
import { BackgroundSection, RemoteSection, AiSection } from "./SystemSettings.tsx";
import { CopyIcon, DownloadIcon } from "../icons.tsx";

const ACCENTS = [
  { id: "ink", color: "var(--lh-fg)", label: "как текст" },
  { id: "blue", color: "#2f6fd6", label: "синий" },
  { id: "green", color: "#2f7d4f", label: "зелёный" },
  { id: "orange", color: "#d0661c", label: "оранжевый" },
  { id: "red", color: "#c2352b", label: "красный" },
  { id: "violet", color: "#6b4fd8", label: "фиолетовый" },
];

export function SettingsPage() {
  const { state } = useHub();
  if (!state) return null;
  const s = state.settings;
  return (
    <Page title="Настройки" width="narrow">
      <Section title="Оформление">
        <Card className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium">Тема</div>
            <Tabs<HubSettings["theme"]>
              value={s.theme}
              onChange={(theme) => saveSettings({ theme })}
              tabs={[
                { id: "auto", label: "Как в системе" },
                { id: "light", label: "Светлая" },
                { id: "dark", label: "Тёмная" },
              ]}
            />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Акцент хаба</div>
            <p className="mb-2.5 text-xs text-muted">Цвет кнопок и выделения в хабе и в модулях, которые используют тему хаба.</p>
            <div className="flex gap-2.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => saveSettings({ accent: a.id })}
                  className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface transition", s.accent === a.id && "ring-2 ring-muted")}
                  style={{ background: a.color }}
                />
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Доступ с телефона (дома, по Wi‑Fi)">
        <RemoteAccess />
      </Section>

      <RemoteSection />
      <BackgroundSection />
      <AiSection />

      <Section title="Каталоги модулей">
        <Catalogs catalogs={s.catalogs} />
      </Section>

      <Section title="Хранилище">
        <Storage />
      </Section>

      <p className="pb-4 text-center text-xs text-muted">LifeHub · SDK {state.sdkVersion}</p>
    </Page>
  );
}

function RemoteAccess() {
  const { state } = useHub();
  const [net, setNet] = useState<{ urls: string[]; qr: string[]; https: boolean; hasPassword: boolean } | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<typeof net>("GET", "/api/network").then(setNet);
  }, [state?.settings.hasPassword]);
  if (!net || !state) return <Loading />;

  const savePassword = async (password: string | null) => {
    setBusy(true);
    try {
      await request("POST", "/api/settings/password", { body: { password } });
      setPw("");
      getHost().toast(password ? "Пароль сохранён" : "Доступ с других устройств закрыт", "success");
    } catch (e) {
      getHost().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-5">
      <p className="text-sm text-muted">
        Хаб работает на этом компьютере. Телефон в той же Wi‑Fi сети может открыть его по адресу ниже — после входа по паролю.
        Данные везде одни и те же и обновляются сразу.
      </p>

      {state.isLocal ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword(pw);
          }}
        >
          <Field label={net.hasPassword ? "Сменить пароль" : "Задайте пароль, чтобы открыть доступ"} className="min-w-48 flex-1">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} autoComplete="new-password" placeholder="не короче 6 символов" />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={pw.length < 6}>
            Сохранить
          </Button>
          {net.hasPassword && (
            <Button variant="ghost" className="text-danger" onClick={() => savePassword(null)}>
              Закрыть доступ
            </Button>
          )}
        </form>
      ) : (
        <p className="text-sm">
          <Badge tone="success">вы подключены удалённо</Badge> Пароль меняется только на компьютере, где запущен хаб.
        </p>
      )}

      {net.hasPassword && (
        <div className="grid gap-4 sm:grid-cols-2">
          {net.urls.map((u, i) => (
            <div key={u} className="rounded-lg border border-line p-3 text-center">
              <div className="mx-auto w-40 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: net.qr[i] }} />
              <button className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium" onClick={() => copyText(u)}>
                {u} <CopyIcon className="size-3.5 text-muted" />
              </button>
            </div>
          ))}
          {!net.urls.length && <p className="text-sm text-muted">Компьютер не подключён к локальной сети.</p>}
        </div>
      )}

      <div className="rounded-md bg-surface-2 p-3 text-xs leading-relaxed text-muted">
        {net.https ? (
          <>HTTPS включён: при первом входе с телефона браузер предупредит о самоподписанном сертификате — это нормально, подтвердите вход.</>
        ) : (
          <>
            Микрофон и камера на телефоне работают только по HTTPS. Запустите хаб так: <code className="text-fg">node bin/lifehub.mjs --https</code>.
            Для доступа вне дома — раздел «Доступ вне дома» ниже.
          </>
        )}
      </div>
    </Card>
  );
}

function Catalogs({ catalogs }: { catalogs: string[] }) {
  const [url, setUrl] = useState("");
  return (
    <Card className="space-y-3">
      <p className="text-sm text-muted">
        Каталог — это JSON-файл по ссылке со списком модулей (id, name, description, icon, git). Им удобно делиться с друзьями.
      </p>
      {catalogs.map((c) => (
        <div key={c} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 text-sm">{c}</code>
          <Button size="sm" variant="ghost" onClick={() => saveSettings({ catalogs: catalogs.filter((x) => x !== c) })}>
            Убрать
          </Button>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^https?:\/\//.test(url)) return getHost().toast("Нужна ссылка http(s)://", "error");
          saveSettings({ catalogs: [...catalogs, url] });
          setUrl("");
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/catalog.json" />
        <Button type="submit">Добавить</Button>
      </form>
    </Card>
  );
}

function Storage() {
  const { state } = useHub();
  const [libs, setLibs] = useState<{ name: string; version: string; sizeKb: number; used: boolean }[] | null>(null);
  const load = () => request<typeof libs>("GET", "/api/libs").then(setLibs);
  useEffect(() => {
    load();
  }, []);
  if (!state) return null;
  const unused = libs?.filter((l) => !l.used) ?? [];
  return (
    <Card className="space-y-5">
      <div className="space-y-1 text-sm">
        <div className="text-muted">Папка хаба</div>
        <code className="block break-all">{state.home}</code>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Общий кэш библиотек</div>
        <p className="mb-3 text-sm text-muted">
          npm-пакеты, которые просят модули. Каждая версия хранится один раз, сколько бы модулей её ни использовали.
        </p>
        {!libs ? (
          <Loading />
        ) : libs.length === 0 ? (
          <p className="text-sm text-muted">Пока пусто — модулям хватает платформы.</p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line text-sm">
            {libs.map((l) => (
              <div key={l.name + l.version} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {l.name}@{l.version}
                </span>
                {!l.used && <Badge tone="warning">не используется</Badge>}
                <span className="text-muted tabular-nums">{l.sizeKb >= 1024 ? `${(l.sizeKb / 1024).toFixed(1)} МБ` : `${l.sizeKb} КБ`}</span>
              </div>
            ))}
          </div>
        )}
        {unused.length > 0 && (
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              const r = await request<{ removed: string[] }>("POST", "/api/libs/prune");
              getHost().toast(`Удалено: ${r.removed.length}`, "success");
              load();
            }}
          >
            Удалить неиспользуемые
          </Button>
        )}
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Резервная копия</div>
        <p className="mb-3 text-sm text-muted">Архив со всеми данными, файлами и модулями.</p>
        <Button icon={<DownloadIcon className="size-4" />} onClick={() => (location.href = "/api/backup")}>
          Скачать бэкап
        </Button>
      </div>
      <Button size="sm" variant="ghost" icon={<CopyIcon className="size-4" />} onClick={() => copyText(state.modulesDir, "Путь скопирован")}>
        Скопировать путь к модулям
      </Button>
    </Card>
  );
}
