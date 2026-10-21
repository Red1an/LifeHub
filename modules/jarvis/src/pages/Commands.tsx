import { useState } from "react";
import { Button, Field, Input, Modal, Textarea, confirm, uid, useNavigate } from "@lifehub/sdk";
import { Panel, Screen } from "../components/hud.tsx";
import { say, usePrefs } from "../lib/store.ts";
import { BUILTIN, RUNNABLE, type CustomCommand } from "../lib/types.ts";

const EXAMPLES: Omit<CustomCommand, "id">[] = [
  { phrases: ["я ушел", "я ухожу"], say: "Хорошего пути.", run: ["что дальше"] },
  { phrases: ["я дома"], say: "С возвращением.", run: ["итоги дня"] },
  { phrases: ["как дела"], say: "Все системы в норме. Готов к работе.", run: [] },
];

export function Commands() {
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();
  const [edit, setEdit] = useState<CustomCommand | null>(null);

  const save = (c: CustomCommand) => {
    const list = prefs.commands.some((x) => x.id === c.id) ? prefs.commands.map((x) => (x.id === c.id ? c : x)) : [...prefs.commands, c];
    update({ commands: list });
    setEdit(null);
  };
  const remove = async (c: CustomCommand) => {
    if (!(await confirm(`Удалить команду «${c.phrases[0]}»?`, { danger: true }))) return;
    update({ commands: prefs.commands.filter((x) => x.id !== c.id) });
    setEdit(null);
  };
  const tryIt = async (q: string) => {
    await say(q);
    navigate("/");
  };

  return (
    <Screen
      title="Команды"
      subtitle="Свои фразы и всё, что Джарвис умеет"
      right={
        <button className="jarvis-chip" onClick={() => setEdit({ id: uid(), phrases: [""], say: "", run: [] })}>
          + Своя
        </button>
      }
    >
      <Panel title="Свои команды">
        {prefs.commands.length === 0 ? (
          <div className="space-y-3 text-sm text-[#8fb3c7]">
            <p>Фраза → ответ и цепочка встроенных команд. Например:</p>
            <div className="space-y-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e.phrases[0]}
                  onClick={() => save({ ...e, id: uid() })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/25 p-3 text-left hover:bg-black/40"
                >
                  <span>
                    <span className="block text-white">«{e.phrases[0]}»</span>
                    <span className="block text-xs">
                      {e.say}
                      {e.run.length ? ` + ${e.run.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="jarvis-glow text-sm">добавить</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--jv-line)]">
            {prefs.commands.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(c)}>
                  <div className="truncate text-[15px] text-white">«{c.phrases.filter(Boolean).join("», «")}»</div>
                  <div className="truncate text-xs text-[#7f9fb2]">
                    {[c.say, ...c.run.map((r) => `→ ${r}`)].filter(Boolean).join(" ") || "ничего не делает"}
                  </div>
                </button>
                <button className="jarvis-chip shrink-0" onClick={() => tryIt(c.phrases[0])}>
                  ▶
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-[#7f9fb2]">
          Скажите «Джарвис, я ушёл». Шаги — любые команды, в том числе для компьютера: «открой телеграм», «громкость 20», «сверни все».
          Получается сценарий: «рабочий режим» → открыть редактор, браузер и музыку.
        </p>
      </Panel>

      {BUILTIN.map((g) => (
        <Panel key={g.group} title={g.group}>
          <div className="flex flex-wrap gap-2">
            {g.items.map((i) => (
              <button key={i} className="jarvis-chip" onClick={() => tryIt(i)}>
                {i}
              </button>
            ))}
          </div>
        </Panel>
      ))}
      <p className="px-1 text-xs text-[#7f9fb2]">Нажмите на пример — Джарвис ответит во вкладке «Разговор». Всё остальное он передаст нейронке (если включена).</p>

      {edit && <Editor cmd={edit} onSave={save} onRemove={prefs.commands.some((c) => c.id === edit.id) ? () => remove(edit) : undefined} onClose={() => setEdit(null)} />}
    </Screen>
  );
}

function Editor({ cmd, onSave, onRemove, onClose }: { cmd: CustomCommand; onSave: (c: CustomCommand) => void; onRemove?: () => void; onClose: () => void }) {
  const [phrases, setPhrases] = useState(cmd.phrases.join("\n"));
  const [text, setText] = useState(cmd.say);
  const [run, setRun] = useState<string[]>(cmd.run);
  const [custom, setCustom] = useState("");
  const list = phrases.split("\n").map((p) => p.trim()).filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      title="Своя команда"
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          {onRemove ? (
            <Button variant="ghost" onClick={onRemove}>
              Удалить
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" disabled={!list.length} onClick={() => onSave({ id: cmd.id, phrases: list, say: text.trim(), run })}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Фразы" hint="Каждая с новой строки: «я ушёл», «я ухожу»">
          <Textarea value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="я ушёл" className="min-h-20" />
        </Field>
        <Field label="Что сказать" hint="Можно оставить пустым">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Хорошего пути, сэр." />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium">Затем выполнить</div>
          {run.length > 0 && (
            <ol className="mb-2 space-y-1">
              {run.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm">
                  <span>
                    {i + 1}. {r}
                  </span>
                  <button className="text-muted hover:text-fg" aria-label="Убрать" onClick={() => setRun(run.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-1.5">
            {RUNNABLE.filter((r) => !run.includes(r)).map((r) => (
              <button key={r} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2" onClick={() => setRun([...run, r].slice(0, 5))}>
                + {r}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) setRun([...run, custom.trim()].slice(0, 5));
              setCustom("");
            }}
          >
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="или своя фраза: «что у меня в пятницу»" className="min-w-0 flex-1" />
            <Button type="submit" disabled={!custom.trim()}>
              Добавить
            </Button>
          </form>
        </div>
      </div>
    </Modal>
  );
}
