import { useEffect, useState } from "react";
import { Link, Progress, cn, confirm, toast } from "@lifehub/sdk";
import { Panel, Screen, StatusPill, Toggle } from "../components/hud.tsx";
import { action, useChat, usePrefs, useStatus } from "../lib/store.ts";

export function Settings() {
  const { prefs, update } = usePrefs();
  const { status } = useStatus();
  const chat = useChat();
  const [address, setAddress] = useState(prefs.address);
  const [limit, setLimit] = useState(String(prefs.aiLimit));
  useEffect(() => setAddress(prefs.address), [prefs.address]);
  useEffect(() => setLimit(String(prefs.aiLimit)), [prefs.aiLimit]);
  const used = status?.aiUsedToday ?? 0;

  const input = "h-10 w-full rounded-lg border border-[var(--jv-line)] bg-black/30 px-3 text-[15px] text-white outline-none focus:border-[var(--jv-cyan)]";

  return (
    <Screen title="Настройки" subtitle={<StatusPill status={status} />}>
      <Panel title="Характер">
        <label className="block">
          <span className="mb-1 block text-sm text-[#c3dcea]">Как обращаться</span>
          <input
            className={input}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => address.trim() !== prefs.address && update({ address: address.trim() })}
            placeholder="сэр, имя или пусто"
          />
          <span className="mt-1 block text-xs text-[#7f9fb2]">«Доброе утро, {address.trim() || "…"}». Пусто — без обращения.</span>
        </label>
      </Panel>

      <Panel title="Нейронка">
        <Toggle
          checked={prefs.ai}
          onChange={(ai) => update({ ai })}
          label="Отвечать на свободные вопросы"
          hint="И просьбы в несколько шагов: «сделай потише и включи что-нибудь для работы». Claude через Claude Code хаба"
        />
        {prefs.ai && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              {(
                [
                  ["fast", "Быстрее", "Haiku, 2–4 с"],
                  ["smart", "Умнее", "основная модель, 5–10 с"],
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
                    prefs.brain === id ? "border-[var(--jv-cyan)] bg-[var(--jv-cyan)]/10 text-white" : "border-[var(--jv-line)] text-[#bfe2f3]",
                  )}
                  onClick={() => update({ brain: id })}
                >
                  <span className="block text-sm">{label}</span>
                  <span className="block text-[11px] opacity-70">{hint}</span>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-[#c3dcea]">Вопросов в день, не больше</span>
              <input
                className={input}
                type="number"
                min={0}
                max={500}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                onBlur={() => Number(limit) !== prefs.aiLimit && update({ aiLimit: Math.max(0, Math.min(500, Math.round(Number(limit) || 0))) })}
              />
            </label>
            <div className="flex items-center gap-3 text-xs text-[#8fb3c7]">
              <Progress value={used} max={prefs.aiLimit || 1} className="flex-1" tone={used >= prefs.aiLimit ? "warning" : "accent"} />
              сегодня {used} из {prefs.aiLimit}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="История">
        <Toggle checked={prefs.history} onChange={(history) => update({ history })} label="Сохранять разговоры" hint="Последние 300 фраз — во вкладке «Разговор»" />
        <button
          className="jarvis-chip mt-2"
          disabled={!chat.items.length}
          onClick={async () => {
            if (!(await confirm("Очистить всю историю разговоров?", { danger: true }))) return;
            await chat.clear();
            toast("История очищена", "success");
          }}
        >
          Очистить историю ({chat.items.length})
        </button>
      </Panel>

      <Panel title="Колонка с Алисой">
        <p className="mb-3 text-sm text-[#c3dcea]">
          С Джарвисом можно говорить и через Яндекс Станцию — приватным навыком Алисы. Команды для компьютера через колонку не работают.
        </p>
        <Link to="/setup" className="jarvis-chip inline-flex">
          Подключение колонки →
        </Link>
      </Panel>

      <Panel title="Колонка: безопасность">
        <div className="space-y-3 text-sm text-[#c3dcea]">
          <p>
            Адрес навыка секретный: кто его знает, может говорить с Джарвисом от вашего имени. Хаб отвечает только навыку, который подключился
            первым.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="jarvis-chip"
              disabled={!prefs.enabled}
              onClick={async () => {
                if (!(await confirm("Создать новый адрес? Старый перестанет работать — его нужно будет заменить в настройках навыка.", { danger: true }))) return;
                await action("rotate");
                toast("Новый адрес — во вкладке «Подключение»", "success");
              }}
            >
              Новый адрес
            </button>
            <button
              className="jarvis-chip"
              disabled={!status?.linked}
              onClick={async () => {
                if (!(await confirm("Отвязать навык? Хаб примет первый навык, который обратится по адресу.", { danger: true }))) return;
                await action("unlink");
                toast("Привязка сброшена", "success");
              }}
            >
              Отвязать навык
            </button>
          </div>
          <Toggle checked={prefs.enabled} onChange={(enabled) => update({ enabled })} label="Принимать запросы от Алисы" hint="Выключите — колонка получит отказ, а данные останутся" />
        </div>
      </Panel>
    </Screen>
  );
}
