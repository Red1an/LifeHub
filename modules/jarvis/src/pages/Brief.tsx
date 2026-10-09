import { useNavigate } from "@lifehub/sdk";
import { Panel, Screen, Toggle } from "../components/hud.tsx";
import { say, usePrefs } from "../lib/store.ts";
import { EVENING_PARTS, MORNING_PARTS } from "../lib/types.ts";

export function Brief() {
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();
  const tryIt = async (q: string) => {
    await say(q);
    navigate("/");
  };

  return (
    <Screen title="Сводки" subtitle="Что Джарвис рассказывает утром и вечером">
      <Panel
        title="Утро · «доброе утро»"
        right={
          <button className="jarvis-chip" onClick={() => tryIt("доброе утро")}>
            Послушать
          </button>
        }
      >
        {MORNING_PARTS.map((p) => (
          <Toggle key={p.id} checked={prefs.morning[p.id]} onChange={(v) => update({ morning: { ...prefs.morning, [p.id]: v } })} label={p.label} hint={p.hint} />
        ))}
      </Panel>

      <Panel
        title="Вечер · «итоги дня»"
        right={
          <button className="jarvis-chip" onClick={() => tryIt("итоги дня")}>
            Послушать
          </button>
        }
      >
        {EVENING_PARTS.map((p) => (
          <Toggle key={p.id} checked={prefs.evening[p.id]} onChange={(v) => update({ evening: { ...prefs.evening, [p.id]: v } })} label={p.label} hint={p.hint} />
        ))}
      </Panel>

      <p className="px-1 text-xs leading-relaxed text-[#7f9fb2]">
        Сводки собираются из данных хаба без нейронки. Выключенные в хабе модули в сводку не попадают. Чтобы сводка звучала сама — сценарий
        по времени в «Доме с Алисой» (вкладка «Подключение», шаг 5).
      </p>
    </Screen>
  );
}
