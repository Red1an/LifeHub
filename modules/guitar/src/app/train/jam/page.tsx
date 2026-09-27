import { useEffect, useMemo, useRef, useState } from "react";
import { ExerciseShell } from "../../../components/train/ExerciseShell";
import { FretMarker, InteractiveFretboard } from "../../../components/train/InteractiveFretboard";
import { unlockAudio } from "@modules/audio";
import { startBacking } from "../../../lib/audio/backing";
import { playGuitarNote } from "../../../lib/audio/guitar-synth";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES, noteIndex } from "../../../lib/music-theory";
import { markPractice } from "../../../lib/train-stats";

type Quality = "" | "m" | "7";

interface Preset {
  id: string;
  label: string;
  scaleLabel: string;
  roots: string[];
  scale: number[];
  bars: { semis: number; quality: Quality }[];
  tip: string;
}

const PRESETS: Preset[] = [
  {
    id: "blues",
    label: "Блюз 12 тактов",
    scaleLabel: "блюзовая гамма",
    roots: ["A", "E", "G", "C", "D"],
    scale: [0, 3, 5, 6, 7, 10],
    bars: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7].map((semis) => ({ semis, quality: "7" as Quality })),
    tip: "Классика для первых соло. Одна гамма звучит на всей форме — попробуй на смене на IV (такт 5) приземлиться на оранжевую ноту.",
  },
  {
    id: "pop",
    label: "Поп: I–V–vi–IV",
    scaleLabel: "мажорная пентатоника",
    roots: ["C", "G", "D", "A", "E"],
    scale: [0, 2, 4, 7, 9],
    bars: [
      { semis: 0, quality: "" },
      { semis: 7, quality: "" },
      { semis: 9, quality: "m" },
      { semis: 5, quality: "" },
    ],
    tip: "Самая частая последовательность в поп-музыке. Мажорная пентатоника звучит светло — пой фразой, как вокалист.",
  },
  {
    id: "fifties",
    label: "Ретро: I–vi–IV–V",
    scaleLabel: "мажорная пентатоника",
    roots: ["C", "G", "D", "A", "E"],
    scale: [0, 2, 4, 7, 9],
    bars: [
      { semis: 0, quality: "" },
      { semis: 9, quality: "m" },
      { semis: 5, quality: "" },
      { semis: 7, quality: "" },
    ],
    tip: "Ход песен 50-х. На V (последний такт) сыграй ноту, которая тянет обратно к тонике.",
  },
  {
    id: "minor-epic",
    label: "Минор: i–VI–III–VII",
    scaleLabel: "минорная пентатоника",
    roots: ["A", "E", "B"],
    scale: [0, 3, 5, 7, 10],
    bars: [
      { semis: 0, quality: "m" },
      { semis: 8, quality: "" },
      { semis: 3, quality: "" },
      { semis: 10, quality: "" },
    ],
    tip: "Эпичный минорный ход из рока и поп-баллад. Длинные ноты с вибрато звучат здесь лучше, чем быстрые пассажи.",
  },
  {
    id: "minor-cadence",
    label: "Минор: i–iv–V–i",
    scaleLabel: "минорная пентатоника",
    roots: ["A", "E", "B"],
    scale: [0, 3, 5, 7, 10],
    bars: [
      { semis: 0, quality: "m" },
      { semis: 5, quality: "m" },
      { semis: 7, quality: "" },
      { semis: 0, quality: "m" },
    ],
    tip: "На мажорном V попробуй сыграть его терцию (оранжевая, которой нет в пентатонике) — это та самая «испанская» краска.",
  },
  {
    id: "dorian",
    label: "Лад: дорийский (i–IV)",
    scaleLabel: "дорийский лад",
    roots: ["A", "E", "D", "B"],
    scale: [0, 2, 3, 5, 7, 9, 10],
    bars: [
      { semis: 0, quality: "m" },
      { semis: 0, quality: "m" },
      { semis: 5, quality: "" },
      { semis: 5, quality: "" },
    ],
    tip: "Минор, но светлый: его характер — большая секста (6-я ступень). Задерживайся на ней на мажорном IV — так звучат Santana и фанк.",
  },
  {
    id: "mixolydian",
    label: "Лад: миксолидийский (I–♭VII)",
    scaleLabel: "миксолидийский лад",
    roots: ["A", "E", "D", "G"],
    scale: [0, 2, 4, 5, 7, 9, 10],
    bars: [
      { semis: 0, quality: "" },
      { semis: 0, quality: "" },
      { semis: 10, quality: "" },
      { semis: 10, quality: "" },
    ],
    tip: "Мажор с пониженной седьмой — звук классического рока. Опирайся на ♭7: это она делает звучание «роковым», а не поп-мажорным.",
  },
  {
    id: "lydian",
    label: "Лад: лидийский (I–II)",
    scaleLabel: "лидийский лад",
    roots: ["C", "G", "D", "A"],
    scale: [0, 2, 4, 6, 7, 9, 11],
    bars: [
      { semis: 0, quality: "" },
      { semis: 0, quality: "" },
      { semis: 2, quality: "" },
      { semis: 2, quality: "" },
    ],
    tip: "«Мечтательный» мажор из киномузыки: повышенная кварта. Ищи её на втором аккорде — она там его терция.",
  },
  {
    id: "phrygian",
    label: "Лад: фригийский (i–♭II)",
    scaleLabel: "фригийский лад",
    roots: ["E", "B"],
    scale: [0, 1, 3, 5, 7, 8, 10],
    bars: [
      { semis: 0, quality: "m" },
      { semis: 0, quality: "m" },
      { semis: 1, quality: "" },
      { semis: 0, quality: "m" },
    ],
    tip: "Тёмный испанский/метал-звук: пониженная секунда прямо над тоникой. Играй полутон ♭2 → 1 — это его подпись.",
  },
];

const CHORD_TONES: Record<Quality, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
};

export default function JamTrainer() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [root, setRoot] = useState("A");
  const [bpm, setBpm] = useState(84);
  const [click, setClick] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bar, setBar] = useState(0);
  const [beat, setBeat] = useState(0);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const rootPc = noteIndex(root);
  const chords = useMemo(
    () =>
      preset.bars.map((b) => ({
        name: `${SHARP_NOTES[(rootPc + b.semis) % 12]}${b.quality}`,
        rootPc: (rootPc + b.semis) % 12,
        quality: b.quality,
      })),
    [preset, rootPc]
  );

  useEffect(() => {
    if (!playing) return;
    const player = startBacking({
      chords: chords.map((c) => c.name),
      bpm,
      loop: true,
      countIn: true,
      click,
      volume: 0.85,
      onBar: (next) => setBar(next),
      onBeat: setBeat,
    });
    playerRef.current = player;
    return () => player.stop();
  }, [playing, chords, bpm, click]);

  useEffect(() => () => playerRef.current?.stop(), []);

  async function toggle() {
    if (!playing) {
      await unlockAudio();
      markPractice("jam");
    }
    setBar(0);
    setPlaying((value) => !value);
  }

  function choosePreset(next: Preset) {
    setPreset(next);
    if (!next.roots.includes(root)) setRoot(next.roots[0]);
  }

  const current = chords[Math.max(0, bar)];
  const upcoming = chords[(Math.max(0, bar) + 1) % chords.length];
  const chordTones = new Set(CHORD_TONES[current.quality].map((i) => (current.rootPc + i) % 12));
  const scale = new Set(preset.scale.map((i) => (rootPc + i) % 12));

  const markers: FretMarker[] = [];
  GUITAR_OPEN_STRINGS_MIDI.forEach((open, string) => {
    for (let fret = 0; fret <= 12; fret++) {
      const pc = (open + fret) % 12;
      if (chordTones.has(pc)) {
        markers.push({ string, fret, tone: "target", label: SHARP_NOTES[pc] });
      } else if (scale.has(pc)) {
        markers.push({
          string,
          fret,
          tone: pc === rootPc ? "root" : "scale",
          label: pc === rootPc ? SHARP_NOTES[pc] : undefined,
        });
      }
    }
  });

  return (
    <ExerciseShell
      title="Джем: импровизация под минус"
      description="Запусти аккомпанемент и играй поверх прямо по грифу. Серые точки — гамма, в ней почти всё звучит. Оранжевые — ноты текущего аккорда: на них фраза звучит «попадающе»."
      accent="sky"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            onClick={() => choosePreset(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              preset.id === item.id
                ? "bg-sky-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-zinc-500">Тональность:</span>
        {preset.roots.map((r) => (
          <button
            key={r}
            onClick={() => setRoot(r)}
            className={`h-8 min-w-10 rounded-lg px-2 font-medium ${
              root === r ? "bg-sky-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            {r}
          </button>
        ))}
        <span className="ml-2 text-zinc-500">· {preset.scaleLabel} от {root}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center rounded-2xl border-2 border-sky-500 py-4">
          <span className="text-xs uppercase tracking-wide text-sky-600 dark:text-sky-400">
            {playing && bar < 0 ? "Отсчёт" : "Сейчас"}
          </span>
          <span className="text-4xl font-bold">{current.name}</span>
          <span className="text-xs text-zinc-500">
            такт {Math.max(0, bar) + 1} из {chords.length}
          </span>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 py-4">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Дальше</span>
          <span className="text-4xl font-bold text-zinc-400">{upcoming.name}</span>
        </div>
      </div>

      <div className="mb-4 flex gap-1">
        {chords.map((chord, index) => (
          <div
            key={index}
            className={`flex h-8 flex-1 items-center justify-center rounded text-[10px] font-medium transition-colors ${
              playing && bar === index
                ? "bg-sky-600 text-white"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
            }`}
          >
            {chords.length <= 8 ? chord.name : ""}
          </div>
        ))}
      </div>

      <InteractiveFretboard
        startFret={0}
        fretCount={12}
        markers={markers}
        onSelect={(position) => {
          void unlockAudio();
          playGuitarNote(position.midi, { gain: 0.85 });
        }}
      />

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold tabular-nums">{bpm} BPM</span>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rounded-full ${
                  playing && beat === index ? "bg-sky-500" : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <button
            onClick={toggle}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${
              playing ? "bg-red-600" : "bg-sky-600 hover:bg-sky-700"
            }`}
          >
            {playing ? "Стоп" : "Играть минус"}
          </button>
        </div>
        <input
          type="range"
          min={60}
          max={140}
          value={bpm}
          onChange={(event) => setBpm(Number(event.target.value))}
          className="w-full"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={click} onChange={(e) => setClick(e.target.checked)} />
          метроном поверх
        </label>
      </div>

      <div className="mt-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
        <p className="mb-1 font-medium text-zinc-800 dark:text-zinc-200">Задание</p>
        {preset.tip}
        <ul className="mt-2 list-disc pl-5">
          <li>Сначала играй только оранжевые ноты — по одной на такт, на первую долю.</li>
          <li>Потом соединяй их серыми нотами: от одного аккорда к другому.</li>
          <li>Оставляй паузы. Фраза — вопрос, пауза — ответ.</li>
        </ul>
      </div>
    </ExerciseShell>
  );
}
