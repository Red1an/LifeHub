import { useSearchParams } from "@lifehub/sdk";
import { Metronome } from "../components/Metronome";
import { Tuner } from "../components/train/Tuner";
import { Recorder } from "../components/train/Recorder";
import { Header, Screen, Segments } from "../components/kit";

type Tool = "tuner" | "metronome" | "recorder";

export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("t");
  const tool: Tool = raw === "metronome" || raw === "recorder" ? raw : "tuner";

  return (
    <Screen>
      <Header back="/" title="Инструменты" subtitle="Тюнер слышит гитару через микрофон, метроном держит темп, запись — чтобы слышать прогресс." />
      <Segments
        value={tool}
        onChange={(t) => setParams({ t })}
        className="mb-5"
        items={[
          { id: "tuner", label: "🎚️ Тюнер" },
          { id: "metronome", label: "⏱️ Метроном" },
          { id: "recorder", label: "⏺️ Запись" },
        ]}
      />
      {tool === "metronome" ? <Metronome /> : tool === "tuner" ? <Tuner /> : <Recorder />}
    </Screen>
  );
}
