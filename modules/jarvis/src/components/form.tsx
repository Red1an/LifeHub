import { useMemo, useState, type ReactNode } from "react";
import { Modal, cn } from "@lifehub/sdk";
import { useLibrary } from "../lib/store.ts";
import { SOURCE_LABEL, type LibSource, type OpenTarget } from "../lib/types.ts";

/* Поля в стиле HUD: тёмные, с голубой рамкой в фокусе. */

export const inputCls =
  "h-10 w-full rounded-lg border border-[var(--jv-line)] bg-black/30 px-3 text-[15px] text-white outline-none placeholder:text-[#5f7f92] focus:border-[var(--jv-cyan)]";

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1">
      <span className="block text-sm text-[#c3dcea]">{children}</span>
      {hint && <span className="block text-xs text-[#7f9fb2]">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-lg border border-[var(--jv-line)] bg-black/30 p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => id !== value && onChange(id)}
          className={cn(
            "h-8 min-w-0 flex-1 truncate rounded-md px-2 text-sm transition-colors",
            id === value ? "bg-[var(--jv-cyan)]/20 text-white shadow-[inset_0_0_0_1px_var(--jv-cyan)]" : "text-[#9dbccc] hover:bg-white/5",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Фразы-триггеры: чипы с крестиком и поле для новой. */
export function Phrases({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const p = draft.trim().toLowerCase();
    if (p && !value.includes(p)) onChange([...value, p]);
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-[var(--jv-line)] bg-black/30 p-2">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--jv-cyan)]/15 py-1 pl-3 pr-1.5 text-sm text-white">
              «{p}»
              <button className="grid size-5 place-items-center rounded-full text-[#9dbccc] hover:bg-white/10 hover:text-white" onClick={() => onChange(value.filter((x) => x !== p))} aria-label="Убрать">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="h-9 min-w-0 flex-1 bg-transparent px-1 text-[15px] text-white outline-none placeholder:text-[#5f7f92]" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} placeholder={placeholder ?? "Новая фраза и Enter"} />
      </form>
    </div>
  );
}

/* ───────────── что открыть ───────────── */

const SOURCES: (LibSource | "all")[] = ["all", "start", "steam", "epic", "desktop"];

/** Список программ с поиском. Выбор — onPick. */
export function LibraryList({ onPick, selected, compact }: { onPick: (id: string, name: string) => void; selected?: string; compact?: boolean }) {
  const { lib, loading } = useLibrary();
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<LibSource | "all">("all");
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (lib?.items ?? [])
      .filter((i) => (src === "all" || i.source === src) && (!needle || i.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [lib, q, src]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: lib?.items.length ?? 0 };
    for (const i of lib?.items ?? []) c[i.source] = (c[i.source] ?? 0) + 1;
    return c;
  }, [lib]);

  return (
    <div className="space-y-2">
      <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: telegram, steam, pycharm…" />
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {SOURCES.filter((s) => s === "all" || counts[s]).map((s) => (
          <button
            key={s}
            onClick={() => setSrc(s)}
            className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", src === s ? "border-[var(--jv-cyan)] bg-[var(--jv-cyan)]/15 text-white" : "border-[var(--jv-line)] text-[#9dbccc]")}
          >
            {s === "all" ? "Все" : SOURCE_LABEL[s]} <span className="opacity-60">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      {loading || !lib ? (
        <p className="py-4 text-center text-sm text-[#7f9fb2]">{loading ? "Загружаю…" : "Хаб ещё не прислал список программ — подождите минуту или нажмите «Обновить список»"}</p>
      ) : (
        <div className={cn("overflow-y-auto rounded-lg border border-[var(--jv-line)] bg-black/20", compact ? "max-h-72" : "max-h-[60vh]")}>
          {items.slice(0, 300).map((i) => (
            <button
              key={i.id}
              onClick={() => onPick(i.id, i.name)}
              className={cn("flex w-full items-center justify-between gap-2 border-b border-[var(--jv-line)] px-3 py-2.5 text-left last:border-0 hover:bg-white/5", selected === i.id && "bg-[var(--jv-cyan)]/15")}
            >
              <span className="min-w-0 truncate text-[15px] text-white">{i.name}</span>
              <span className="shrink-0 text-[11px] text-[#7f9fb2]">{SOURCE_LABEL[i.source]}</span>
            </button>
          ))}
          {items.length === 0 && <p className="p-4 text-center text-sm text-[#7f9fb2]">Ничего не нашлось. Можно указать путь или ссылку на соседних вкладках.</p>}
        </div>
      )}
    </div>
  );
}

/** Окно выбора: программа из библиотеки, сайт или файл/папка. */
export function TargetPicker({ value, onPick, onClose }: { value?: OpenTarget; onPick: (t: OpenTarget) => void; onClose: () => void }) {
  const [tab, setTab] = useState<OpenTarget["kind"]>(value?.kind && value.value ? value.kind : "lib");
  const [url, setUrl] = useState(value?.kind === "url" ? value.value : "https://");
  const [urlLabel, setUrlLabel] = useState(value?.kind === "url" ? (value.label ?? "") : "");
  const [p, setP] = useState(value?.kind === "path" ? value.value : "");
  const fixUrl = (u: string) => (/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`);

  return (
    <Modal open onClose={onClose} title="Что открыть">
      <div className="jarvis-vars space-y-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ["lib", "Программа"],
            ["url", "Сайт"],
            ["path", "Папка, файл"],
          ]}
        />
        {tab === "lib" && <LibraryList compact selected={value?.kind === "lib" ? value.value : undefined} onPick={(id, name) => onPick({ kind: "lib", value: id, label: name })} />}
        {tab === "url" && (
          <div className="space-y-2">
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/…" />
            <input className={inputCls} value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} placeholder="Как назвать (необязательно)" />
            <p className="text-xs text-[#7f9fb2]">Подойдут и ссылки приложений: steam://, tg://, spotify:…</p>
            <button className="jarvis-chip" disabled={url.trim().length < 4} onClick={() => onPick({ kind: "url", value: fixUrl(url.trim()), label: urlLabel.trim() || undefined })}>
              Выбрать
            </button>
          </div>
        )}
        {tab === "path" && (
          <div className="space-y-2">
            <input className={inputCls} value={p} onChange={(e) => setP(e.target.value)} placeholder="C:\\Games\\Game\\game.exe или D:\\Проекты" />
            <p className="text-xs text-[#7f9fb2]">В проводнике: Shift + правый клик по файлу → «Копировать как путь», вставьте сюда (кавычки уберём сами).</p>
            <button
              className="jarvis-chip"
              disabled={p.trim().length < 3}
              onClick={() => {
                const v = p.trim().replace(/^"|"$/g, "");
                onPick({ kind: "path", value: v, label: v.split(/[\\/]/).filter(Boolean).pop() });
              }}
            >
              Выбрать
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
