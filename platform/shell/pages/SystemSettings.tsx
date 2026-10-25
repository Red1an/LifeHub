import { useEffect, useState } from "react";
import { Section, Card, Button, Switch, Input, Field, Badge, Loading } from "../../sdk/ui.tsx";
import { request, getHost } from "../../sdk/core.ts";
import { useHub } from "../state.ts";
import { copyText } from "../util.ts";
import { CopyIcon } from "../icons.tsx";

const run = async (fn: () => Promise<unknown>, ok?: string) => {
  try {
    await fn();
    if (ok) getHost().toast(ok, "success");
  } catch (e) {
    getHost().toast((e as Error).message, "error");
  }
};

/* ───────────── работа в фоне и автозапуск ───────────── */

interface SystemInfo {
  supervised: boolean;
  autostart: boolean;
  platform: string;
  port: number;
  logFile: string;
  startedAt: number;
}

export function BackgroundSection() {
  const { state } = useHub();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const load = () => request<SystemInfo>("GET", "/api/system").then(setInfo);
  useEffect(() => {
    load();
  }, []);
  if (!info || !state) return null;
  const local = state.isLocal;

  return (
    <Section title="Работа в фоне">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Хаб может запускаться сам при включении компьютера — без окна терминала. Тогда телефон и другие устройства
          находят его всегда, пока компьютер включён.
        </p>
        <Switch
          checked={info.autostart}
          disabled={!local}
          onChange={(v) =>
            run(async () => {
              await request("POST", "/api/system/autostart", { body: { enabled: v } });
              await load();
            }, v ? "Хаб будет запускаться при входе в систему" : "Автозапуск выключен")
          }
          label={<span className="text-sm">Запускать при входе в {info.platform === "win32" ? "Windows" : "систему"}</span>}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Сейчас:</span>
          {info.supervised ? <Badge tone="success">работает в фоне</Badge> : <Badge>запущен из терминала</Badge>}
        </div>
        {local && (
          <div className="flex flex-wrap gap-2">
            {!info.supervised && (
              <Button
                size="sm"
                onClick={() =>
                  run(async () => {
                    await request("POST", "/api/system/background");
                    getHost().toast("Хаб переходит в фон — терминал можно закрыть", "success");
                    setTimeout(() => location.reload(), 4000);
                  })
                }
              >
                Перевести в фон
              </Button>
            )}
            {info.supervised && (
              <Button
                size="sm"
                onClick={() =>
                  run(async () => {
                    await request("POST", "/api/system/restart");
                    getHost().toast("Перезапуск…");
                    setTimeout(() => location.reload(), 5000);
                  })
                }
              >
                Перезапустить хаб
              </Button>
            )}
            {info.supervised && (
              <Button size="sm" variant="ghost" onClick={() => request("GET", "/api/system/log").then((t) => setLog(String(t)))}>
                Показать лог
              </Button>
            )}
            {info.supervised && (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (await getHost().confirm("Остановить хаб? Он запустится снова при следующем входе в систему (если включён автозапуск).", { danger: true, confirmText: "Остановить" })) {
                    run(() => request("POST", "/api/system/stop"), "Хаб остановлен");
                  }
                }}
              >
                Остановить
              </Button>
            )}
          </div>
        )}
        {log !== null && <pre className="max-h-72 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px]">{log || "Лог пуст"}</pre>}
        {!local && <p className="text-xs text-muted">Эти настройки меняются только на компьютере, где работает хаб.</p>}
      </Card>
    </Section>
  );
}

/* ───────────── доступ вне дома ───────────── */

interface RemoteInfo {
  installed: boolean;
  state?: string;
  dnsName?: string;
  ips?: string[];
  serve: { enabled: boolean; url?: string };
  qr: string | null;
  hasPassword: boolean;
  error?: string;
}

export function RemoteSection() {
  const { state } = useHub();
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () => request<RemoteInfo>("GET", "/api/remote").then(setInfo);
  useEffect(() => {
    load();
  }, []);
  if (!state) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await request<RemoteInfo>("POST", "/api/remote/serve", { body: { enabled } });
      await load();
      if (enabled && r.serve.enabled) getHost().toast("Адрес для доступа вне дома включён", "success");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Доступ вне дома">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Через <b>Tailscale</b> — бесплатную личную сеть между вашими устройствами. Хаб открывается с телефона откуда угодно по
          адресу с настоящим HTTPS (работает и микрофон), но виден только вашим устройствам. Порты на роутере открывать не нужно.
        </p>
        {!info ? (
          <Loading />
        ) : !info.installed ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Установите Tailscale на этот компьютер:{" "}
              <a className="underline underline-offset-4" href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                tailscale.com/download
              </a>{" "}
              и войдите (Google, Microsoft или GitHub).
            </li>
            <li>Установите приложение Tailscale на телефон и войдите в тот же аккаунт.</li>
            <li>Вернитесь сюда и нажмите «Проверить» — хаб настроит адрес сам.</li>
            <li>
              Задайте пароль в разделе «Доступ с телефона» — без него вход с других устройств закрыт.
            </li>
          </ol>
        ) : info.state !== "Running" ? (
          <p className="text-sm">
            Tailscale установлен, но {info.state === "NeedsLogin" ? "вы не вошли в аккаунт" : "не запущен"}. Откройте приложение Tailscale и
            войдите, затем нажмите «Проверить».
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted">Компьютер в сети Tailscale: </span>
              {info.dnsName ?? info.ips?.[0]}
            </div>
            {info.serve.enabled && info.serve.url ? (
              <div className="flex flex-wrap items-start gap-4">
                {info.qr && <div className="w-36 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: info.qr }} />}
                <div className="space-y-2">
                  <div className="font-medium">Адрес хаба вне дома:</div>
                  <button className="inline-flex items-center gap-1.5 break-all text-left underline underline-offset-4" onClick={() => copyText(info.serve.url!)}>
                    {info.serve.url} <CopyIcon className="size-3.5 text-muted" />
                  </button>
                  <p className="text-xs text-muted">На телефоне должен быть включён Tailscale. Сохраните адрес на главный экран — будет как приложение.</p>
                  {!info.hasPassword && <p className="text-xs text-danger">Задайте пароль в разделе «Доступ с телефона», иначе войти не получится.</p>}
                  {state.isLocal && (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => toggle(false)}>
                      Выключить адрес
                    </Button>
                  )}
                </div>
              </div>
            ) : state.isLocal ? (
              <Button variant="primary" loading={busy} onClick={() => toggle(true)}>
                Включить адрес для доступа вне дома
              </Button>
            ) : (
              <p className="text-muted">Адрес не включён — включите его на компьютере с хабом.</p>
            )}
          </div>
        )}
        {message && <pre className="whitespace-pre-wrap rounded-md bg-warning/10 p-3 text-xs text-warning">{message}</pre>}
        <Button size="sm" variant="ghost" onClick={() => load()}>
          Проверить
        </Button>
      </Card>
    </Section>
  );
}

/* ───────────── доступ вне дома через ngrok ───────────── */

interface NgrokInfo {
  installed: boolean;
  version?: string;
  enabled: boolean;
  domain: string;
  email: string;
  running: boolean;
  url?: string;
  error?: string;
  log: string[];
  qr: string | null;
  hasPassword: boolean;
}

export function NgrokSection() {
  const { state } = useHub();
  const [info, setInfo] = useState<NgrokInfo | null>(null);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState(false);
  const load = () =>
    request<NgrokInfo>("GET", "/api/remote/ngrok").then((s) => {
      setInfo(s);
      setDomain((d) => d || s.domain);
      setEmail((e) => e || s.email);
    });
  useEffect(() => {
    load();
  }, []);
  if (!state || !info) return null;
  const local = state.isLocal;

  const save = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      const s = await request<NgrokInfo>("POST", "/api/remote/ngrok", { body: { enabled, domain, email } });
      setInfo(s);
      if (enabled && s.running) getHost().toast("Туннель ngrok запущен", "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Доступ вне дома через ngrok">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Хаб открывается с телефона в обычном браузере — ставить ничего не нужно, работает и при включённом на телефоне VPN.
          Адрес публичный, поэтому сначала ngrok просит войти через Google и пускает только ваш email; посторонние до компьютера
          не доходят. Затем — пароль хаба.
        </p>
        {!info.installed ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Установите ngrok: <code>winget install Ngrok.Ngrok -s winget</code> (или с{" "}
              <a className="underline underline-offset-4" href="https://ngrok.com/download" target="_blank" rel="noreferrer">
                ngrok.com/download
              </a>
              ).
            </li>
            <li>
              Зарегистрируйтесь на ngrok.com, скопируйте authtoken и выполните в новом окне терминала:{" "}
              <code>ngrok config add-authtoken ВАШ_ТОКЕН</code>
            </li>
            <li>В панели ngrok → Domains создайте бесплатный постоянный домен.</li>
            <li>Вернитесь сюда и нажмите «Проверить».</li>
          </ol>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {info.running ? (
                <Badge tone="success">туннель работает</Badge>
              ) : info.enabled && info.error ? (
                <Badge tone="danger">ошибка</Badge>
              ) : info.enabled ? (
                <Badge tone="warning">подключается…</Badge>
              ) : (
                <Badge>выключен</Badge>
              )}
              <span className="text-muted">ngrok {info.version}</span>
            </div>
            {info.running && info.url && (
              <div className="flex flex-wrap items-start gap-4 text-sm">
                {info.qr && <div className="w-36 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: info.qr }} />}
                <div className="space-y-2">
                  <div className="font-medium">Адрес хаба вне дома:</div>
                  <button className="inline-flex items-center gap-1.5 break-all text-left underline underline-offset-4" onClick={() => copyText(info.url!)}>
                    {info.url} <CopyIcon className="size-3.5 text-muted" />
                  </button>
                  <p className="text-xs text-muted">
                    Вход через Google ({info.email}), затем пароль хаба. Сохраните адрес на главный экран — будет как приложение.
                  </p>
                </div>
              </div>
            )}
            {!info.hasPassword && <p className="text-xs text-danger">Задайте пароль в разделе «Доступ с телефона» — без него хаб не пустит даже после входа через Google.</p>}
            {local ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Домен ngrok" hint="Из панели ngrok → Domains">
                  <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="my-name.ngrok-free.app" />
                </Field>
                <Field label="Ваш email Google" hint="Только он сможет войти">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" />
                </Field>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button variant="primary" loading={busy} onClick={() => save(true)}>
                    {info.enabled ? "Сохранить и перезапустить" : "Включить"}
                  </Button>
                  {info.enabled && (
                    <Button variant="ghost" loading={busy} onClick={() => save(false)}>
                      Выключить
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">Настройки ngrok меняются только на компьютере, где работает хаб.</p>
            )}
          </>
        )}
        {(error || (info.enabled && info.error)) && (
          <pre className="whitespace-pre-wrap rounded-md bg-warning/10 p-3 text-xs text-warning">{error || info.error}</pre>
        )}
        {log && <pre className="max-h-72 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px]">{info.log.join("\n") || "Лог пуст"}</pre>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => load()}>
            Проверить
          </Button>
          {info.installed && local && (
            <Button size="sm" variant="ghost" onClick={() => setLog((v) => !v)}>
              {log ? "Скрыть лог" : "Показать лог"}
            </Button>
          )}
        </div>
      </Card>
    </Section>
  );
}

/* ───────────── нейронка ───────────── */

interface AiStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  fastModel: string;
  smartModel: string;
  customPath: string;
}

export function AiSection() {
  const { state } = useHub();
  const [st, setSt] = useState<AiStatus | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string; ms: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [custom, setCustom] = useState("");
  const [fast, setFast] = useState("");
  const [smart, setSmart] = useState("");
  const load = (recheck = false) =>
    request<AiStatus>("GET", `/api/ai/status${recheck ? "?recheck=1" : ""}`).then((s) => {
      setSt(s);
      setCustom(s.customPath);
      setFast(s.fastModel);
      setSmart(s.smartModel);
    });
  useEffect(() => {
    load();
  }, []);
  if (!st || !state) return null;

  return (
    <Section title="Нейронка для модулей">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Модули с разрешением «ai» могут обращаться к Claude — разбирать записи, раскладывать траты, отвечать на вопросы. Запросы
          выполняет ваш <b>Claude Code</b> на этом компьютере, под вашим аккаунтом Claude — API-ключ не нужен. Claude запускается
          без доступа к файлам: только текст.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {st.found ? <Badge tone="success">Claude Code найден</Badge> : <Badge tone="warning">Claude Code не найден</Badge>}
          {st.version && <span className="text-muted">{st.version}</span>}
        </div>
        {st.path && <code className="block break-all text-xs text-muted">{st.path}</code>}
        {!st.found && (
          <p className="text-sm">
            Установите Claude Code (<code>npm install -g @anthropic-ai/claude-code</code> или установщик с claude.com/claude-code),
            один раз выполните в терминале <code>claude</code> и войдите в аккаунт. Затем нажмите «Проверить».
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={testing}
            disabled={!st.found}
            onClick={async () => {
              setTesting(true);
              setTest(null);
              try {
                setTest(await request("POST", "/api/ai/test"));
              } finally {
                setTesting(false);
              }
            }}
          >
            Проверить запрос
          </Button>
          <Button size="sm" variant="ghost" onClick={() => load(true)}>
            Найти заново
          </Button>
        </div>
        {test && (
          <div className={`rounded-md p-3 text-sm ${test.ok ? "bg-success/10" : "bg-danger/10 text-danger"}`}>
            {test.ok ? `Работает: «${test.message}» за ${(test.ms / 1000).toFixed(1)} с` : test.message}
          </div>
        )}
        {state.isLocal && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Дополнительно</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Путь к claude" hint="Пусто — найти автоматически" className="sm:col-span-3">
                <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="C:\Users\…\.local\bin\claude.exe" />
              </Field>
              <Field label="Быстрая модель" hint="для коротких ответов">
                <Input value={fast} onChange={(e) => setFast(e.target.value)} placeholder="haiku" />
              </Field>
              <Field label="Основная модель" hint="пусто — как в Claude Code">
                <Input value={smart} onChange={(e) => setSmart(e.target.value)} placeholder="sonnet" />
              </Field>
              <div className="flex items-end">
                <Button
                  size="sm"
                  onClick={() =>
                    run(async () => {
                      const s = await request<AiStatus>("PUT", "/api/ai/settings", { body: { claudePath: custom, fastModel: fast, smartModel: smart } });
                      setSt(s);
                    }, "Сохранено")
                  }
                >
                  Сохранить
                </Button>
              </div>
            </div>
          </details>
        )}
      </Card>
    </Section>
  );
}

/* ───────────── Google ───────────── */

interface GoogleInfo {
  configured: boolean;
  connected: boolean;
  email: string | null;
  clientId: string;
  redirectUri: string;
}

export function GoogleSection() {
  const { state } = useHub();
  const [g, setG] = useState<GoogleInfo | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const load = () =>
    request<GoogleInfo>("GET", "/api/google/status").then((s) => {
      setG(s);
      setClientId(s.clientId);
    });
  useEffect(() => {
    load();
    // Вход в Google идёт в отдельной вкладке — после него хаб присылает событие settings.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  if (!g || !state) return null;
  const showForm = state.isLocal && (!g.configured || editing);

  return (
    <Section title="Google">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Модули с разрешением «google:calendar» могут читать и менять ваш Google Календарь. Аккаунт подключается один раз здесь;
          модули обращаются к Google через хаб и не видят ваш токен.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {g.connected ? (
            <Badge tone="success">Подключён{g.email ? `: ${g.email}` : ""}</Badge>
          ) : g.configured ? (
            <Badge tone="warning">Клиент указан, аккаунт не подключён</Badge>
          ) : (
            <Badge>Не настроено</Badge>
          )}
        </div>

        {!state.isLocal && !g.connected && <p className="text-sm">Подключить Google можно только на компьютере, где запущен хаб.</p>}

        {showForm && (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>
                Откройте <a className="underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud</a> и
                создайте проект (любое имя).
              </li>
              <li>
                <a className="underline" href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">
                  Включите Google Calendar API
                </a>
                .
              </li>
              <li>
                <a className="underline" href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a>: тип
                External, свой email. В разделе Audience нажмите <b>Publish app</b> (In production) — иначе Google отключает доступ каждые 7 дней.
              </li>
              <li>
                <a className="underline" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> → Create client →
                тип <b>Desktop app</b>. Скопируйте Client ID и Client secret сюда.
              </li>
            </ol>
            <Field label="Client ID">
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
            </Field>
            <Field label="Client secret">
              <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" type="password" />
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  run(async () => {
                    setG(await request<GoogleInfo>("PUT", "/api/google/config", { body: { clientId, clientSecret: secret } }));
                    setSecret("");
                    setEditing(false);
                  }, "Сохранено")
                }
              >
                Сохранить
              </Button>
              {editing && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Отмена
                </Button>
              )}
            </div>
          </div>
        )}

        {state.isLocal && g.configured && !editing && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {/* Вход только через 127.0.0.1: этот адрес Google принимает для Desktop-клиентов без настройки. */}
              <Button size="sm" variant={g.connected ? "secondary" : "primary"} onClick={() => window.open(new URL("/api/google/connect", g.redirectUri).href, "_blank")}>
                {g.connected ? "Подключить заново" : "Подключить Google"}
              </Button>
              {g.connected && (
                <Button size="sm" variant="ghost" onClick={() => run(async () => setG(await request<GoogleInfo>("POST", "/api/google/disconnect")), "Google отключён")}>
                  Отключить
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Сменить клиент
              </Button>
            </div>
            <p className="text-xs text-muted">
              Google покажет предупреждение «приложение не проверено» — это ваше собственное приложение: «Дополнительно» → «Перейти». Отметьте доступ к
              Календарю. Если создали клиент типа Web application, добавьте в нём адрес перенаправления <code className="break-all">{g.redirectUri}</code>.
            </p>
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ───────────── приложение LifeHub на телефоне ───────────── */

interface AppDevices {
  devices: { id: string; name: string; createdAt: number; seenAt?: number }[];
  apk: { versionName: string; size: number } | null;
}
interface PairLinks {
  expires: number;
  links: { label: string; url: string; qr: string }[];
}

/** Подключение телефона с приложением LifeHub (phone/android): QR → страница со скачиванием и кнопкой «Открыть в приложении». */
export function PhoneAppSection() {
  const { state } = useHub();
  const [info, setInfo] = useState<AppDevices | null>(null);
  const [pair, setPair] = useState<PairLinks | null>(null);
  const [pick, setPick] = useState(0);
  const load = () => request<AppDevices>("GET", "/api/app/devices").then(setInfo, () => {});
  useEffect(() => {
    if (state?.isLocal) load();
  }, [state?.isLocal]);
  // Пока QR на экране, ждём, когда телефон подключится.
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [pair]);
  if (!state?.isLocal) return null;

  const start = () =>
    run(async () => {
      const p = await request<PairLinks>("POST", "/api/app/pair");
      setPair(p);
      setPick(0);
    });
  const link = pair?.links[pick];

  return (
    <Section title="Приложение на телефоне">
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Приложение LifeHub для Android: хаб как обычное приложение, работает без связи с компьютером (аккорды, заметки, траты — всё, что
          уже открывали), напоминания, виджеты на экране, «Поделиться» и Фокус. Входит само — пароль и Google не нужны.
        </p>
        {!info ? (
          <Loading />
        ) : (
          <>
            {!info.apk && (
              <p className="rounded-md bg-warning/10 p-3 text-sm text-warning">
                Приложение ещё не собрано: <code>node phone/android/build.mjs</code>
              </p>
            )}
            {info.devices.length > 0 && (
              <div className="divide-y divide-line rounded-md border border-line">
                {info.devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="text-xs text-muted">
                        {d.seenAt ? `на связи ${new Date(d.seenAt).toLocaleString("ru")}` : "ещё не заходил"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        getHost()
                          .confirm(`Отключить «${d.name}»? Приложение на нём перестанет видеть хаб.`, { danger: true })
                          .then((ok) => void (ok && run(() => request("DELETE", `/api/app/devices/${d.id}`).then(load), "Телефон отключён")))
                      }
                    >
                      Отключить
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {pair && link ? (
              <div className="space-y-3">
                {pair.links.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {pair.links.map((l, i) => (
                      <Button key={l.url} size="sm" variant={i === pick ? "primary" : "ghost"} onClick={() => setPick(i)}>
                        {l.label}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-4">
                  <div className="w-44 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: link.qr }} />
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                    <li>Наведите камеру телефона на QR-код и откройте ссылку.</li>
                    <li>Скачайте и установите LifeHub.</li>
                    <li>Нажмите «Открыть в приложении» — телефон подключится сам и появится в списке выше.</li>
                  </ol>
                </div>
                <p className="text-xs text-muted">
                  Ссылка одноразовая, работает 10 минут.{" "}
                  {link.label.includes("ngrok") ? "Из интернета — откроется где угодно." : "Телефон должен быть в той же сети."}
                </p>
              </div>
            ) : (
              <Button variant="primary" onClick={start}>
                Подключить телефон
              </Button>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

/** Хаб открыт в приложении LifeHub на телефоне — его собственные настройки (связь, офлайн, обновление, Фокус). */
export function InAppSection() {
  const bridge = (window as { LifeHubApp?: { openSettings(): void; version(): string } }).LifeHubApp;
  if (!bridge) return null;
  return (
    <Section title="Это приложение">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">LifeHub {bridge.version()} — связь с компьютером, офлайн, обновление, Фокус</div>
        <Button onClick={() => bridge.openSettings()}>Настройки приложения</Button>
      </Card>
    </Section>
  );
}
