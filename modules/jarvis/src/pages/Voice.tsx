import { useEffect, useState } from "react";
import { cn, confirm, formatRelative, toast } from "@lifehub/sdk";
import { Orb, Panel, Screen, Toggle, VoicePill, voiceLine } from "../components/hud.tsx";
import { action, usePrefs, useVoice } from "../lib/store.ts";
import { SPEAKERS } from "../lib/types.ts";

const input = "h-10 w-full rounded-lg border border-[var(--jv-line)] bg-black/30 px-3 text-[15px] text-white outline-none focus:border-[var(--jv-cyan)]";
const select = input + " appearance-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 block text-sm text-[#c3dcea]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#7f9fb2]">{hint}</span>}
    </label>
  );
}

function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onChange(v)}
        onKeyUp={() => v !== value && onChange(v)}
        className="h-2 flex-1 accent-[var(--jv-cyan)]"
      />
      <span className="w-14 text-right text-sm tabular-nums text-[#bfe2f3]">{format(v)}</span>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-lg border border-[var(--jv-line)] bg-black/30 p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => id !== value && onChange(id)}
          className={cn(
            "h-8 flex-1 rounded-md px-2 text-sm transition-colors",
            id === value ? "bg-[var(--jv-cyan)]/20 text-white shadow-[inset_0_0_0_1px_var(--jv-cyan)]" : "text-[#9dbccc] hover:bg-white/5",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Voice() {
  const { prefs, updateVoice } = usePrefs();
  const { voice } = useVoice();
  const v = prefs.voice;
  const line = voiceLine(voice);
  const [wake, setWake] = useState(v.wakeWords.join(", "));
  useEffect(() => setWake(v.wakeWords.join(", ")), [v.wakeWords.join(",")]);
  const missing = voice?.process === "missing";
  const installing = voice?.process === "installing";
  const live = voice?.process === "running";

  return (
    <Screen title="Голос" subtitle={<VoicePill voice={voice} />} right={<Orb size={52} state={line.busy ? "busy" : line.tone === "off" ? "off" : "on"} />}>
      {(missing || installing || (voice?.installLog.length ?? 0) > 0 && !live) && (
        <Panel title="Установка">
          <p className="text-sm text-[#c3dcea]">
            Голосу нужен Python 3.10–3.12 и около 1 ГБ библиотек: слово активации (Vosk), распознавание речи (GigaAM), голос (Piper) и окно
            на рабочем столе. Всё работает на этом компьютере, без облака. Модели (~400 МБ) скачаются при первом запуске.
          </p>
          <button className="jarvis-chip mt-3" disabled={installing} onClick={() => void action("voice.install")}>
            {installing ? "Устанавливаю…" : missing ? "Установить" : "Переустановить"}
          </button>
          {(voice?.installLog.length ?? 0) > 0 && <pre className="jarvis-code mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px]">{voice!.installLog.join("\n")}</pre>}
        </Panel>
      )}

      <Panel title="Состояние">
        <div className="space-y-2 text-sm text-[#c3dcea]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{line.text}</span>
            {voice?.model && (
              <span className="text-xs text-[#7f9fb2]">
                {voice.model} · {voice.gpu ? "видеокарта" : "процессор"}
              </span>
            )}
          </div>
          {voice?.heard && (
            <div className="text-xs text-[#8fb3c7]">
              Последнее: «{voice.heard}» {voice.heardAt ? `· ${formatRelative(voice.heardAt)}` : ""}
            </div>
          )}
          {voice?.error && <div className="text-xs text-[#ffb36b]">{voice.error}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="jarvis-chip" disabled={!live} onClick={() => void action("voice.test")}>
              Проверить голос
            </button>
            {voice?.state === "muted" || voice?.state === "sleeping" ? (
              <button className="jarvis-chip" disabled={!live} onClick={() => void action("voice.unmute")}>
                Включить микрофон
              </button>
            ) : (
              <button className="jarvis-chip" disabled={!live} onClick={() => void action("voice.mute")}>
                Выключить микрофон
              </button>
            )}
            <button
              className="jarvis-chip"
              disabled={missing || installing}
              onClick={() => {
                void action("voice.restart");
                toast("Перезапускаю голос", "info");
              }}
            >
              Перезапустить
            </button>
          </div>
        </div>
        <Toggle checked={v.enabled} onChange={(enabled) => updateVoice({ enabled })} label="Слушать микрофон" hint="Выключите — голос остановится, текстом Джарвис отвечает всегда" />
      </Panel>

      <Panel title="Слух">
        <Field label="Имя" hint="Через запятую, если несколько. Слово должно быть в словаре Vosk — «джарвис», «пятница», «компьютер» есть.">
          <input
            className={input}
            value={wake}
            onChange={(e) => setWake(e.target.value)}
            onBlur={() => {
              const words = wake
                .split(",")
                .map((w) => w.trim().toLowerCase())
                .filter(Boolean);
              if (words.length && words.join(",") !== v.wakeWords.join(",")) updateVoice({ wakeWords: words });
            }}
          />
        </Field>
        <Field label="Микрофон">
          <select className={select} value={v.mic} onChange={(e) => updateVoice({ mic: e.target.value })}>
            <option value="">По умолчанию{voice?.mic && !v.mic ? ` (${voice.mic})` : ""}</option>
            {(voice?.mics ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Toggle checked={v.chime} onChange={(chime) => updateVoice({ chime })} label="Сигнал, когда услышал имя" hint="Звучит, если после имени пауза: «Джарвис… открой почту»" />
        <Toggle
          checked={v.echoGuard}
          onChange={(echoGuard) => updateVoice({ echoGuard })}
          label="Не слушать свои колонки"
          hint="«Джарвис» в видео или песне не будит его: он сравнивает микрофон с тем, что играет компьютер. Вы поверх видео и в наушниках — работает как обычно"
        />
        <Toggle
          checked={v.strictWake}
          onChange={(strictWake) => updateVoice({ strictWake })}
          label="Строгая проверка имени"
          hint="Выполнять, только если имя есть и в распознанном тексте. Меньше ложных срабатываний, но часть команд будет теряться — распознавание иногда коверкает «Джарвис». Длинную чужую речь без имени Джарвис отбрасывает и так"
        />
        <Field label="Ждать ответа после вопроса" hint="Джарвис спросил «Выключить?» — можно ответить без имени">
          <Slider value={v.followUp} min={0} max={15} step={1} onChange={(followUp) => updateVoice({ followUp })} format={(x) => (x ? `${x} с` : "нет")} />
        </Field>
      </Panel>

      <OwnerPanel />

      <Panel title="На экране">
        <Field label="Орб" hint="Окно со сферой: что Джарвис услышал и что ответил. Нажмите на сферу — откроется панель">
          <Segmented
            value={v.overlay}
            onChange={(overlay) => updateVoice({ overlay })}
            options={[
              ["talk", "Во время разговора"],
              ["always", "Всегда"],
              ["never", "Не показывать"],
            ]}
          />
        </Field>
        {v.overlay !== "never" && (
          <Field label="Где">
            <Segmented
              value={v.overlayPos}
              onChange={(overlayPos) => updateVoice({ overlayPos })}
              options={[
                ["br", "Снизу справа"],
                ["bl", "Снизу слева"],
                ["tc", "Сверху"],
              ]}
            />
          </Field>
        )}
      </Panel>

      <Panel title="Распознавание">
        <Field
          label="Движок"
          hint={
            v.asr === "gigaam"
              ? "GigaAM v3 от Сбера: лучший для русского, на процессоре, ~0.2 с на фразу, ~300 МБ памяти. Видеокарта свободна"
              : "Whisper на видеокарте: ~1 ГБ видеопамяти, лучше понимает английские слова вперемешку с русскими"
          }
        >
          <Segmented
            value={v.asr}
            onChange={(asr) => updateVoice({ asr })}
            options={[
              ["gigaam", "GigaAM"],
              ["whisper", "Whisper"],
            ]}
          />
        </Field>
        {v.asr === "whisper" && (
          <>
            <Toggle
              checked={v.game}
              onChange={(game) => updateVoice({ game })}
              label="Игровой режим"
              hint="Видеокарта свободна для игры, Whisper — на процессоре. Голосом: «игровой режим» / «обычный режим»"
            />
            <Field label="Где распознавать">
              <select className={select} value={v.device} onChange={(e) => updateVoice({ device: e.target.value as typeof v.device })}>
                <option value="auto">Видеокарта, если есть</option>
                <option value="cuda">Только видеокарта</option>
                <option value="cpu">Процессор</option>
              </select>
            </Field>
            <Field label="Модель Whisper" hint="large-v3-turbo — лучшая, ~1 ГБ видеопамяти. medium и small — легче и хуже">
              <select className={select} value={v.model} onChange={(e) => updateVoice({ model: e.target.value })}>
                {["large-v3-turbo", "medium", "small"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-[#7f9fb2]">Для Whisper нужны дополнительные библиотеки (~2 ГБ) — «Переустановить» в блоке установки поставит их.</p>
          </>
        )}
      </Panel>

      <Panel title="Голос Джарвиса">
        <Toggle checked={v.tts} onChange={(tts) => updateVoice({ tts })} label="Отвечать голосом" hint="Выключите — будет только короткий сигнал, ответ — в «Разговоре»" />
        <Field
          label="Движок"
          hint={v.ttsEngine === "piper" ? "Piper: лёгкий, ~120 МБ памяти" : "Silero: звучит естественнее, но с torch это ещё ~600 МБ памяти и ~1 ГБ библиотек"}
        >
          <Segmented
            value={v.ttsEngine}
            onChange={(ttsEngine) => updateVoice({ ttsEngine, speaker: SPEAKERS[ttsEngine][0].id })}
            options={[
              ["piper", "Piper"],
              ["silero", "Silero"],
            ]}
          />
        </Field>
        <Field label="Голос">
          <select className={select} value={v.speaker} onChange={(e) => updateVoice({ speaker: e.target.value })}>
            {SPEAKERS[v.ttsEngine].map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Эффект Джарвиса" hint="Голос чуть ниже, с лёгким металлом и отзвуком — как у ИИ из фильма. 0 — обычный голос">
          <Slider value={v.voiceFx} min={0} max={1} step={0.1} onChange={(voiceFx) => updateVoice({ voiceFx })} format={(x) => (x ? `${Math.round(x * 100)}%` : "нет")} />
        </Field>
        <Field label="Скорость речи">
          <Slider value={v.rate} min={0.7} max={1.5} step={0.05} onChange={(rate) => updateVoice({ rate })} format={(x) => `${x.toFixed(2)}×`} />
        </Field>
        <Field label="Громкость голоса" hint="Относительно системной громкости">
          <Slider value={v.loudness} min={0.2} max={1} step={0.05} onChange={(loudness) => updateVoice({ loudness })} format={(x) => `${Math.round(x * 100)}%`} />
        </Field>
        <Toggle checked={v.greet} onChange={(greet) => updateVoice({ greet })} label="Здороваться при запуске" hint="«Добрый вечер, сэр. Все системы в норме.»" />
      </Panel>

      <Panel title="Сам напомнит">
        <Field label="О событиях календаря" hint="«Сэр, через 10 минут: пара по матанализу»">
          <Slider value={v.announce} min={0} max={60} step={5} onChange={(announce) => updateVoice({ announce })} format={(x) => (x ? `за ${x} мин` : "нет")} />
        </Field>
        <Toggle checked={v.reminders} onChange={(reminders) => updateVoice({ reminders })} label="Напоминания вслух" hint="Напоминания «Расписания» («напомни через 20 минут…») прозвучат в своё время" />
      </Panel>

      {(voice?.log.length ?? 0) > 0 && (
        <details className="jarvis-panel p-4">
          <summary className={cn("cursor-pointer text-xs uppercase tracking-[0.18em] text-[#7cc8ec]")}>Журнал</summary>
          <pre className="jarvis-code mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-[11px]">{voice!.log.join("\n")}</pre>
        </details>
      )}
    </Screen>
  );
}

/** Только мой голос: запись отпечатка, режим, порог. */
function OwnerPanel() {
  const { prefs, updateVoice } = usePrefs();
  const { voice } = useVoice();
  const v = prefs.voice;
  const sp = voice?.speaker;
  const en = voice?.enroll;
  const live = voice?.process === "running";
  const recording = en?.state === "record";
  const enrolled = !!sp?.enrolled;

  return (
    <Panel title="Только мой голос">
      <p className="text-sm text-[#c3dcea]">
        Джарвис запоминает ваш голос и узнаёт его по каждой фразе. Чужим можно запретить важное — или не отвечать вовсе. Защищает от гостей и голоса из
        видео, но не от записи вашего голоса.
      </p>

      {recording ? (
        <div className="mt-3 rounded-xl border border-[var(--jv-cyan)] bg-[var(--jv-cyan)]/10 p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-[#7cc8ec]">
            Фраза {en?.step} из {en?.total} — повторите после сигнала
          </div>
          <div className="jarvis-title mt-2 text-xl text-white">«{en?.phrase}»</div>
          <div className="mt-3 flex justify-center gap-1">
            {Array.from({ length: en?.total ?? 0 }, (_, i) => (
              <span key={i} className={cn("h-1.5 w-6 rounded-full", i < (en?.step ?? 0) - 1 ? "bg-[var(--jv-cyan)]" : i === (en?.step ?? 0) - 1 ? "bg-white" : "bg-white/15")} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="jarvis-chip" disabled={!live} onClick={() => void action("voice.enroll")}>
            {enrolled ? "Перезаписать голос" : "Записать мой голос"}
          </button>
          {enrolled && (
            <button
              className="text-sm text-[#ff9b8a]"
              onClick={async () => {
                if (!(await confirm("Удалить запись голоса? Джарвис снова будет отвечать всем.", { danger: true }))) return;
                updateVoice({ speakerLock: "off" });
                void action("voice.enroll.reset");
              }}
            >
              Удалить запись
            </button>
          )}
          <span className="text-xs text-[#7f9fb2]">
            {enrolled ? `Голос записан${sp?.self ? ` · свои фразы похожи на ${Math.round(sp.self[0] * 100)}–${Math.round(sp.self[1] * 100)}%` : ""}` : "7 коротких фраз, около минуты. Лучше в тишине"}
          </span>
        </div>
      )}
      {en?.state === "error" && <p className="mt-2 text-xs text-[#ffb36b]">{en.error}</p>}
      {en?.state === "done" && !recording && <p className="mt-2 text-xs text-[#3ee08f]">Готово: записано {en.count} фраз. Теперь включите режим ниже.</p>}

      {enrolled && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 text-sm text-[#c3dcea]">Кому отвечать</div>
            <Segmented
              value={v.speakerLock}
              onChange={(speakerLock) => updateVoice({ speakerLock })}
              options={[
                ["off", "Всем"],
                ["important", "Важное — мне"],
                ["all", "Только мне"],
              ]}
            />
            <p className="mt-1 text-xs text-[#7f9fb2]">
              {v.speakerLock === "important"
                ? "Чужие могут спросить время или погоду, но не выключить компьютер, не напечатать текст, не записать трату или заметку."
                : v.speakerLock === "all"
                  ? "На чужой голос Джарвис не реагирует совсем."
                  : "Голос записан, но проверка выключена."}
            </p>
          </div>
          {v.speakerLock !== "off" && (
            <div>
              <div className="mb-1 flex items-center justify-between text-sm text-[#c3dcea]">
                <span>Строгость</span>
                {sp?.score !== undefined && (
                  <span className={cn("text-xs", sp.owner ? "text-[#3ee08f]" : "text-[#ffb36b]")}>
                    последняя фраза: {Math.round(sp.score * 100)}% · {sp.owner ? "вы" : "не вы"}
                    {!sp.owner && (
                      <button className="ml-2 underline" onClick={() => void action("voice.owner.add")}>
                        Это был я
                      </button>
                    )}
                  </span>
                )}
              </div>
              <Slider value={v.speakerThreshold} min={0.3} max={0.8} step={0.05} onChange={(speakerThreshold) => updateVoice({ speakerThreshold })} format={(x) => `${Math.round(x * 100)}%`} />
              <p className="mt-1 text-xs text-[#7f9fb2]">
                Ваш голос обычно 55–90%, чужие — 10–35%. Не узнал вас — нажмите «Это был я»: Джарвис добавит эту фразу к вашему голосу и
                будет узнавать лучше. Пропускает чужих — увеличьте строгость.
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
