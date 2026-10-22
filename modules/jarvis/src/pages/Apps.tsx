import { useState } from "react";
import { Modal, confirm, formatRelative, toast, uid } from "@lifehub/sdk";
import { Panel, Screen } from "../components/hud.tsx";
import { LibraryList, Phrases, TargetPicker } from "../components/form.tsx";
import { action, copy, useBrowser, useLibrary, usePrefs } from "../lib/store.ts";
import type { AppAlias, OpenTarget } from "../lib/types.ts";

/** Программы: что Джарвис нашёл на компьютере, и свои названия («атака титанов» → ссылка). */
export function Apps() {
  const { prefs, update } = usePrefs();
  const { lib } = useLibrary();
  const [edit, setEdit] = useState<AppAlias | null>(null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  const saveAlias = (a: AppAlias) => {
    const list = prefs.apps.some((x) => x.id === a.id) ? prefs.apps.map((x) => (x.id === a.id ? a : x)) : [...prefs.apps, a];
    update({ apps: list });
    setEdit(null);
    toast("Сохранено", "success");
  };
  const removeAlias = async (a: AppAlias) => {
    if (!(await confirm(`Удалить «${a.phrases[0]}»?`, { danger: true }))) return;
    update({ apps: prefs.apps.filter((x) => x.id !== a.id) });
    setEdit(null);
  };
  const open = async (target: OpenTarget) => {
    await action({ kind: "launch", target });
    toast(`Открываю ${target.label ?? ""}`.trim(), "info");
  };

  return (
    <Screen
      title="Программы"
      subtitle={lib ? `Найдено ${lib.items.length} · обновлено ${formatRelative(lib.updatedAt)}` : "Ищу программы на компьютере…"}
      right={
        <button
          className="jarvis-chip shrink-0"
          onClick={() => {
            void action("library.refresh");
            toast("Обновляю список", "info");
          }}
        >
          Обновить
        </button>
      }
    >
      <Panel
        title="Свои названия"
        right={
          <button className="jarvis-chip !px-3 !py-1.5 !text-[13px]" onClick={() => setEdit({ id: uid(), phrases: [], target: { kind: "url", value: "" } })}>
            + Добавить
          </button>
        }
      >
        {prefs.apps.length === 0 ? (
          <p className="text-sm text-[#8fb3c7]">
            Джарвис не нашёл программу или зовёт её не так? Дайте своё название: «телега» → Telegram, «атака титанов» → ссылка на сериал, «проект» → папка.
          </p>
        ) : (
          <div className="divide-y divide-[var(--jv-line)]">
            {prefs.apps.map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(a)}>
                  <div className="truncate text-[15px] text-white">«{a.phrases.join("», «")}»</div>
                  <div className="truncate text-xs text-[#7f9fb2]">→ {a.target.label || a.target.value}</div>
                </button>
                <button className="jarvis-chip shrink-0 !px-3 !py-1.5" onClick={() => open(a.target)} title="Открыть">
                  ▶
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <BrowserPanel />

      <Panel title="Найдено на компьютере">
        <p className="mb-3 text-sm text-[#8fb3c7]">Меню «Пуск», игры Steam и Epic, ярлыки на рабочем столе. Нажмите на программу — проверить запуск или дать своё название.</p>
        <LibraryList onPick={(id, name) => setPicked({ id, name })} />
      </Panel>

      {picked && (
        <Modal open onClose={() => setPicked(null)} title={picked.name}>
          <div className="jarvis-vars space-y-3">
            <p className="text-sm text-[#8fb3c7]">«Джарвис, открой {picked.name.toLowerCase()}» — Джарвис ищет по похожести названия. Если он зовёт её иначе, добавьте своё название.</p>
            <div className="flex flex-wrap gap-2">
              <button className="jarvis-chip" onClick={() => open({ kind: "lib", value: picked.id, label: picked.name })}>
                ▶ Открыть сейчас
              </button>
              <button
                className="jarvis-chip"
                onClick={() => {
                  setEdit({ id: uid(), phrases: [], target: { kind: "lib", value: picked.id, label: picked.name } });
                  setPicked(null);
                }}
              >
                + Своё название
              </button>
            </div>
          </div>
        </Modal>
      )}

      {edit && <AliasEditor alias={edit} isNew={!prefs.apps.some((a) => a.id === edit.id)} onSave={saveAlias} onRemove={() => removeAlias(edit)} onClose={() => setEdit(null)} />}
    </Screen>
  );
}

function AliasEditor({ alias, isNew, onSave, onRemove, onClose }: { alias: AppAlias; isNew: boolean; onSave: (a: AppAlias) => void; onRemove: () => void; onClose: () => void }) {
  const [phrases, setPhrases] = useState(alias.phrases);
  const [target, setTarget] = useState<OpenTarget>(alias.target);
  const [picking, setPicking] = useState(!alias.target.value);
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Своё название" : "Название"}
      footer={
        <div className="jarvis-vars flex w-full justify-between gap-2">
          {!isNew ? (
            <button className="text-sm text-[#ff9b8a]" onClick={onRemove}>
              Удалить
            </button>
          ) : (
            <span />
          )}
          <button className="jarvis-chip" disabled={!phrases.length || !target.value} onClick={() => onSave({ ...alias, phrases, target })}>
            Сохранить
          </button>
        </div>
      }
    >
      <div className="jarvis-vars space-y-3">
        <div>
          <div className="mb-1 text-sm text-[#c3dcea]">Как вы говорите</div>
          <Phrases value={phrases} onChange={setPhrases} placeholder="атака титанов" />
          <p className="mt-1 text-xs text-[#7f9fb2]">«Джарвис, открой {phrases[0] || "атака титанов"}» — без слова «открой» в самом названии.</p>
        </div>
        <div>
          <div className="mb-1 text-sm text-[#c3dcea]">Что открыть</div>
          <button onClick={() => setPicking(true)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--jv-line)] bg-black/30 px-3 py-2.5 text-left hover:border-[var(--jv-cyan)]">
            <span className="min-w-0 truncate text-[15px] text-white">{target.value ? target.label || target.value : "Выбрать"}</span>
            <span className="jarvis-glow shrink-0 text-sm">изменить</span>
          </button>
        </div>
      </div>
      {picking && (
        <TargetPicker
          value={target}
          onClose={() => setPicking(false)}
          onPick={(t) => {
            setTarget(t);
            setPicking(false);
          }}
        />
      )}
    </Modal>
  );
}

/** Вкладки браузера: расширение «Джарвис — вкладки» и что оно видит. */
function BrowserPanel() {
  const b = useBrowser();
  const [open, setOpen] = useState(false);
  const groups = new Map<string, NonNullable<typeof b>["tabs"]>();
  for (const t of b?.tabs ?? []) {
    const g = t.workspace ?? "Без пространства";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  return (
    <Panel
      title="Вкладки браузера"
      right={
        <span className="inline-flex items-center gap-1.5 text-xs text-[#9dbccc]">
          <span className={`size-2 rounded-full ${b?.connected ? "bg-[#3ee08f] shadow-[0_0_8px_#3ee08f]" : "bg-[#5b6b77]"}`} />
          {b?.connected ? "Браузер подключён" : "не подключён"}
        </span>
      }
    >
      {b?.connected ? (
        <>
          <p className="text-sm text-[#8fb3c7]">
            «Джарвис, включи атаку титанов», «переключись на почту», «что у меня в кинотеатре?», «закрой вкладку ютуб». Ищет во всех пространствах.
          </p>
          <button className="mt-2 text-xs text-[#7cc8ec]" onClick={() => setOpen(!open)}>
            {open ? "Скрыть вкладки" : `Показать вкладки (${b.tabs.length})`}
          </button>
          {open && (
            <div className="mt-2 space-y-3">
              {[...groups.entries()].map(([g, list]) => (
                <div key={g}>
                  <div className="mb-1 text-xs uppercase tracking-wider text-[#7f9fb2]">{g}</div>
                  {list.map((t) => (
                    <div key={t.id} className="truncate py-0.5 text-sm text-[#d8ecf7]">
                      {t.active ? "▸ " : ""}
                      {t.title || t.url}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2 text-sm text-[#c3dcea]">
          <p>Чтобы Джарвис видел вкладки во всех пространствах Vivaldi и переключал на нужную, поставьте маленькое расширение (один раз):</p>
          <ol className="list-decimal space-y-1 pl-5 text-[#9dbccc]">
            <li>
              Откройте в Vivaldi <span className="jarvis-code !inline !p-0.5 !px-1.5">vivaldi://extensions</span>
            </li>
            <li>Включите «Режим разработчика» справа сверху.</li>
            <li>«Загрузить распакованное» → выберите папку ниже.</li>
          </ol>
          {b?.extensionPath && (
            <div className="flex items-stretch gap-2">
              <div className="jarvis-code min-w-0 flex-1">{b.extensionPath}</div>
              <button className="jarvis-chip shrink-0" onClick={() => copy(b.extensionPath, "Путь скопирован")}>
                Копировать
              </button>
            </div>
          )}
          <p className="text-xs text-[#7f9fb2]">Подойдёт и Chrome, Edge, Яндекс Браузер. Расширение общается только с хабом на этом компьютере.</p>
        </div>
      )}
    </Panel>
  );
}
