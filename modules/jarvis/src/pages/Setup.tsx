import type { ReactNode } from "react";
import { Link, Loading, formatRelative } from "@lifehub/sdk";
import { CopyField, Orb, Panel, Screen, StatusPill, Toggle } from "../components/hud.tsx";
import { copy, usePrefs, useStatus } from "../lib/store.ts";

function Step({ n, done, title, children, active }: { n: number; done: boolean; title: string; children?: ReactNode; active: boolean }) {
  return (
    <div className="jarvis-panel p-4" style={active ? { borderColor: "rgba(90,209,255,0.5)" } : done ? undefined : { opacity: 0.55 }}>
      <div className="flex items-center gap-3">
        <span className="jarvis-step-num" data-done={done}>
          {done ? "✓" : n}
        </span>
        <h2 className="jarvis-title text-[17px] font-semibold text-white">{title}</h2>
      </div>
      {(active || done) && children && <div className="mt-3 space-y-3 text-sm leading-relaxed text-[#c3dcea]">{children}</div>}
    </div>
  );
}

/** Сценарии «Дома с Алисой»: фраза → команда, которую Алиса передаст Джарвису. */
const SCENARIOS = [
  { phrase: "Джарвис, доброе утро", command: "попроси Джарвис хаб доброе утро" },
  { phrase: "Джарвис, что дальше", command: "попроси Джарвис хаб что дальше" },
  { phrase: "Джарвис, итоги дня", command: "попроси Джарвис хаб итоги дня" },
];

export function Setup() {
  const { status, loading } = useStatus();
  const { prefs, update } = usePrefs();
  if (loading) return <Loading />;

  const tunnel = !!status?.ngrok.enabled && !!status.ngrok.running;
  const on = prefs.enabled && !!status?.enabled;
  const url = status?.url ?? null;
  const linked = !!status?.linked;
  const current = !tunnel ? 1 : !on || !url ? 2 : !linked ? 3 : 5;

  return (
    <Screen title="Подключение" subtitle={<StatusPill status={status} />} right={<Orb size={44} state={linked ? "on" : "off"} />}>
      <Step n={1} done={tunnel} active={current === 1} title="Доступ к хабу из интернета">
        <p>
          Яндекс обращается к хабу по публичному адресу. Его даёт ngrok — тот же, что для входа с телефона вне дома.
          {status?.ngrok.enabled && !status.ngrok.running && " Он включён, но сейчас не запущен — проверьте настройки ngrok."}
        </p>
        {!tunnel && (
          <Link to="~/settings" className="jarvis-chip inline-block">
            Открыть настройки хаба → «Доступ вне дома через ngrok»
          </Link>
        )}
        {tunnel && <p className="text-[#8fd8a8]">Работает: {status!.ngrok.domain}</p>}
      </Step>

      <Step n={2} done={on && !!url} active={current <= 2} title="Включить Джарвиса">
        <Toggle checked={prefs.enabled} onChange={(enabled) => update({ enabled })} label="Принимать запросы от Алисы" hint="Хаб создаст секретный адрес для навыка" />
        {prefs.enabled && !url && tunnel && <p className="text-[#8fb3c7]">Готовлю адрес…</p>}
        {prefs.enabled && !status && (
          <p className="text-[var(--jv-amber)]">Хаб пока не прислал состояние. Если это не проходит за минуту — перезапустите хаб: Настройки хаба → Работа в фоне.</p>
        )}
        {prefs.enabled && status && !tunnel && <p className="text-[var(--jv-amber)]">Включён. Адрес для навыка появится, когда заработает ngrok (шаг 1).</p>}
      </Step>

      <Step n={3} done={linked} active={current === 3} title="Создать навык в Яндексе">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Откройте Яндекс Диалоги под тем же аккаунтом, что и колонка, и нажмите <b>Создать диалог → Навык</b>.
            <a href="https://dialogs.yandex.ru/developer" target="_blank" rel="noreferrer" className="jarvis-chip mt-2 inline-block">
              Открыть dialogs.yandex.ru ↗
            </a>
          </li>
          <li>Вкладка «Настройки» — перенесите значения:</li>
        </ol>
        <CopyField label="Название навыка" value="Джарвис хаб" />
        <CopyField label="Активационное имя" value="Джарвис хаб" />
        <p className="text-xs text-[#7f9fb2]">Яндекс требует минимум два слова. Длинное имя каждый раз говорить не придётся — см. сценарии в шаге 5.</p>
        {url && <CopyField label="Backend → Webhook URL" value={url} mono />}
        <ol start={3} className="list-decimal space-y-2 pl-5">
          <li>
            <b>Доступ</b> → <b>Приватный</b>: навык будет только у вас, модерация не нужна. Остальные поля можно не трогать.
          </li>
          <li>
            Сохраните и нажмите <b>Опубликовать</b>. Затем во вкладке «Тестирование» напишите «привет» — этот шаг отметится сам.
          </li>
        </ol>
        {!linked && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--jv-line)] p-3">
            <span className="jarvis-dots inline-flex">
              <span />
              <span />
              <span />
            </span>
            <span className="text-[#8fb3c7]">Жду первый запрос от Яндекса…</span>
          </div>
        )}
        {linked && <p className="text-[#8fd8a8]">Навык подключён{status?.lastAt ? `, последний запрос ${formatRelative(status.lastAt)}` : ""}.</p>}
      </Step>

      <Step n={4} done={linked} active={current === 5} title="Поговорить с колонкой">
        <p>Скажите колонке:</p>
        <div className="space-y-1.5">
          <div className="jarvis-glow">«Алиса, запусти навык Джарвис хаб»</div>
          <div className="jarvis-glow">«Алиса, попроси Джарвис хаб доброе утро»</div>
        </div>
        <p className="text-[#8fb3c7]">Всё, что вы говорите колонке, появится во вкладке «Разговор».</p>
      </Step>

      <Step n={5} done={false} active={current === 5} title="Сценарии в «Доме с Алисой»">
        <p>
          Чтобы говорить «Джарвис, …» без «попроси», создайте сценарии в приложении <b>Дом с Алисой</b>: <b>Сценарии → +</b>, условие —
          фраза, действие — <b>Своя команда</b> (текст, который Алиса выполнит).
        </p>
        <div className="space-y-2">
          {SCENARIOS.map((s) => (
            <div key={s.phrase} className="flex items-center justify-between gap-2 rounded-lg bg-black/25 p-2.5">
              <div className="min-w-0 text-[13px]">
                <div className="text-white">«{s.phrase}»</div>
                <div className="truncate text-[#7f9fb2]">→ {s.command}</div>
              </div>
              <button className="jarvis-chip shrink-0" onClick={() => copy(s.command, "Команда скопирована")}>
                Копировать
              </button>
            </div>
          ))}
        </div>
        <p>
          <b>Утро без слов:</b> сценарий с условием «Время» (например, 8:00 в будни) и командой «попроси Джарвис хаб доброе утро» — колонка сама
          расскажет сводку.
        </p>
        <p className="text-[#8fb3c7]">
          Свои фразы вроде «Джарвис, я ушёл» настраиваются во вкладке «Команды».
        </p>
      </Step>
    </Screen>
  );
}
