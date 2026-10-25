import { cn, formatRelative } from "@lifehub/sdk";
import type { RunResult } from "../lib/types.ts";
import { Panel, Bar } from "./kit.tsx";

/** Результат прогона: ошибки сборки или список тестов. onOpen — открыть файл на строке (только миссии). */
export function RunView({ result, onOpen }: { result: RunResult & { at?: number }; onOpen?: (file: string, line: number) => void }) {
  const color = result.ok ? "var(--dp-green)" : result.built ? "var(--dp-gold)" : "var(--dp-red)";
  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">
          {result.ok ? "✅ Все тесты зелёные" : result.built ? `🧪 Тесты: ${result.passed} из ${result.total}` : "🧱 Не собирается"}
        </div>
        <div className="text-xs text-[var(--dp-muted)]">
          {(result.ms / 1000).toFixed(1)} с{result.at ? ` · ${formatRelative(result.at)}` : ""}
        </div>
      </div>
      {result.built && <Bar value={result.total ? result.passed / result.total : 0} className="mt-2" color={color} height={8} />}

      {result.errors.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {result.errors.map((e, k) => (
            <button
              key={k}
              disabled={!onOpen}
              className="dp-mono block w-full rounded-xl bg-[#0b1020] px-3 py-2 text-left text-xs hover:bg-[#121a33] disabled:pointer-events-none"
              onClick={() => onOpen?.(e.file, e.line)}
            >
              <span className="text-[var(--dp-red)]">{e.code}</span> <span className="text-[var(--dp-muted)]">{e.file}:{e.line}</span>
              <div className="mt-0.5 whitespace-pre-wrap text-[#e2e8f0]">{e.message}</div>
            </button>
          ))}
          {onOpen && <div className="text-xs text-[var(--dp-muted)]">Нажми на ошибку — файл откроется в VS Code на этой строке.</div>}
        </div>
      )}

      {result.tests.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {result.tests.map((t) => (
            <details key={t.name} className={cn("rounded-xl px-3 py-2 text-sm", t.ok ? "bg-[var(--dp-green)]/10" : "bg-[var(--dp-red)]/10")} open={!t.ok && result.tests.filter((x) => !x.ok)[0] === t}>
              <summary className={cn("cursor-pointer", !t.message && "list-none")}>
                {t.ok ? "✅" : "❌"} {t.name}
              </summary>
              {t.message && <pre className="dp-mono mt-2 whitespace-pre-wrap text-xs text-[var(--dp-muted)]">{t.message}</pre>}
            </details>
          ))}
        </div>
      )}

      {result.output && (
        <pre className="dp-mono mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[#0b1020] p-3 text-xs text-[var(--dp-muted)]">{result.output}</pre>
      )}
    </Panel>
  );
}
