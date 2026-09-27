import { useState } from "react";
import { Metronome } from "../../components/Metronome";
import { Tuner } from "../../components/train/Tuner";
import { Recorder } from "../../components/train/Recorder";

type Tool = "metronome" | "tuner" | "recorder";

export default function PracticePage() {
  const [tool, setTool] = useState<Tool>("metronome");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24 sm:py-10 sm:pb-12">
      <h1 className="text-xl font-bold sm:text-2xl">Инструменты</h1>
      <p className="mt-1 mb-5 text-sm text-zinc-500">
        Метроном для ровного ритма, тюнер, который слышит гитару через
        микрофон, и запись себя — чтобы слышать прогресс.
      </p>

      <div className="mb-5 flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 text-sm">
        {[
          { id: "metronome" as const, label: "Метроном" },
          { id: "tuner" as const, label: "Тюнер" },
          { id: "recorder" as const, label: "Запись" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTool(item.id)}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
              tool === item.id
                ? "bg-white dark:bg-zinc-800 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tool === "metronome" ? <Metronome /> : tool === "tuner" ? <Tuner /> : <Recorder />}
    </div>
  );
}
