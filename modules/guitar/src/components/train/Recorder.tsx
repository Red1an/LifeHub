import { disconnectSafely } from "@modules/audio";
import { useEffect, useRef, useState } from "react";
import { MicGate } from "./MicGate";
import { useMicSource } from "@modules/audio";
import { Recording, deleteRecording, listRecordings, saveRecording } from "../../lib/recordings-db";
import { markPractice } from "../../lib/train-stats";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RecordingRow({ recording, onDelete }: { recording: Recording; onDelete: () => void }) {
  const url = recording.url ?? null;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{recording.name}</span>
        <span className="text-xs text-zinc-500">
          {new Date(recording.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {formatTime(recording.duration)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {url && <audio controls src={url} className="h-9 flex-1" />}
        <button onClick={onDelete} className="text-xs text-red-600 hover:underline">удалить</button>
      </div>
    </li>
  );
}

export function Recorder() {
  const mic = useMicSource();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [name, setName] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);

  useEffect(() => {
    listRecordings().then(setRecordings).catch(() => setRecordings([]));
  }, []);

  // Input level meter, so you can see the mic actually hears you.
  useEffect(() => {
    const source = mic.source;
    if (!source) return;
    const analyser = source.context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
      setLevel(peak);
      if (recorderRef.current?.state === "recording") setElapsed((performance.now() - startedRef.current) / 1000);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      disconnectSafely(source, analyser);
    };
  }, [mic.source]);

  function start() {
    if (!mic.stream) return;
    const recorder = new MediaRecorder(mic.stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const duration = (performance.now() - startedRef.current) / 1000;
      const entry: Recording = {
        id: "",
        name: name.trim() || `Запись ${new Date().toLocaleDateString("ru-RU")}`,
        createdAt: Date.now(),
        duration,
        blob,
      };
      await saveRecording(entry);
      setRecordings(await listRecordings());
      setName("");
      markPractice("recorder");
    };
    recorder.start();
    startedRef.current = performance.now();
    recorderRef.current = recorder;
    setElapsed(0);
    setRecording(true);
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <MicGate state={mic.state} onStart={mic.start} onStop={mic.stop}>
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название, например «Соло в Am, неделя 1»"
            disabled={recording}
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className={`h-full ${level > 0.95 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
          </div>
          <button
            onClick={recording ? stop : start}
            className={`rounded-2xl py-4 text-lg font-semibold text-white ${recording ? "bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {recording ? `■ Стоп · ${formatTime(elapsed)}` : "● Записать"}
          </button>
          {level > 0.95 && <p className="text-xs text-red-500">Перегруз — отодвинься от микрофона.</p>}
        </div>
      </MicGate>

      {recordings.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {recordings.map((r) => (
            <RecordingRow
              key={r.id}
              recording={r}
              onDelete={async () => {
                if (!confirm(`Удалить «${r.name}»?`)) return;
                await deleteRecording(r.id);
                setRecordings(await listRecordings());
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          Записывай себя раз в неделю одно и то же — через месяц сравнишь и услышишь прогресс.
          Записи хранятся только в этом браузере.
        </p>
      )}
    </div>
  );
}
