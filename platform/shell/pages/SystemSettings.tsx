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
