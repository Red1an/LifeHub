import { Link } from "@lifehub/sdk";

const FEATURES = [
  {
    href: "/songs",
    title: "Песни",
    desc: "Аккорды и табы с транспонированием, диаграммами и автопрокруткой.",
    icon: "🎵",
  },
  {
    href: "/train",
    title: "Тренажёры",
    desc: "Гриф, аккорды, гаммы, слух и ритм — интерактивно и со звуком струны.",
    icon: "🎯",
  },
  {
    href: "/train/pitch-match",
    title: "Вокал",
    desc: "Микрофон слышит голос: попадание в ноту, диапазон, распевки.",
    icon: "🎤",
  },
  {
    href: "/practice",
    title: "Инструменты",
    desc: "Метроном и тюнер, который слышит гитару.",
    icon: "🎛️",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-3 text-4xl font-bold tracking-tight">
        Учись играть на гитаре по-настоящему
      </h1>
      <p className="mb-10 max-w-xl text-lg text-zinc-500">
        Аккорды и табы, пошаговые уроки, тренировка слуха и импровизация —
        всё, чтобы уверенно играть свои песни и подключаться к чужой игре.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
            to={f.href}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 transition-colors hover:border-emerald-500"
          >
            <div className="mb-2 text-2xl">{f.icon}</div>
            <div className="mb-1 font-semibold">{f.title}</div>
            <div className="text-sm text-zinc-500">{f.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
