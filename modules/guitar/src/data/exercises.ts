export type ExerciseCategory = "guitar" | "improv" | "ear" | "rhythm" | "vocal";

export interface ExerciseMeta {
  id: string;
  href: string;
  title: string;
  summary: string;
  category: ExerciseCategory;
  icon: string;
  level: "Новичок" | "Средний" | "Любой";
  minutes: number; // suggested time in a daily plan
  needsMic?: boolean;
  scoreUnit?: string; // defaults to "%"
  unscored?: boolean; // explorers and play-alongs without a result
}

export const CATEGORIES: { id: ExerciseCategory; title: string; description: string }[] = [
  { id: "guitar", title: "Гитара", description: "Гриф, аккорды, техника — со звуком настоящей струны и разбором твоей игры через микрофон." },
  { id: "improv", title: "Подбор и импровизация", description: "Слышать аккорды и тональность любой песни, повторять мелодии и играть свои соло под минус." },
  { id: "ear", title: "Слух", description: "Узнавать интервалы и аккорды, чтобы подбирать на слух." },
  { id: "rhythm", title: "Ритм", description: "Держать долю, читать ритм и видеть, где спешишь." },
  { id: "vocal", title: "Вокал", description: "Микрофон слышит твой голос: точность, вибрато, дыхание, интервалы, второй голос." },
];

export const EXERCISES: ExerciseMeta[] = [
  // Guitar
  { id: "fretboard", href: "/train/fretboard", title: "Ноты на грифе", summary: "Тебе называют ноту — ты находишь её на грифе. Гриф звучит в ответ.", category: "guitar", icon: "🎸", level: "Новичок", minutes: 5 },
  { id: "chord-changes", href: "/train/chord-changes", title: "Смена аккордов", summary: "Аккорд меняется под метроном — успевай переставлять пальцы.", category: "guitar", icon: "🤘", level: "Новичок", minutes: 5, unscored: true },
  { id: "chord-check", href: "/train/chord-check", title: "Проверка аккорда", summary: "Ставишь аккорд и бьёшь — приложение по звуку слышит, чисто ли он звучит.", category: "guitar", icon: "✅", level: "Новичок", minutes: 5, needsMic: true },
  { id: "speed", href: "/train/speed", title: "Спид-тренер", summary: "Темп растёт, пока играешь чисто, и откатывается, если грязно.", category: "guitar", icon: "⚡", level: "Средний", minutes: 7, needsMic: true, scoreUnit: " BPM" },
  { id: "bend", href: "/train/bend", title: "Бенды", summary: "Подтягиваешь струну — стрелка показывает, дотянул ли до ноты.", category: "guitar", icon: "〰️", level: "Средний", minutes: 5, needsMic: true },
  { id: "caged", href: "/train/caged", title: "Аккорды по всему грифу", summary: "Система CAGED: один аккорд в пяти местах грифа.", category: "guitar", icon: "🧭", level: "Средний", minutes: 5, unscored: true },
  { id: "scales", href: "/train/scales", title: "Гаммы и лады", summary: "Пентатоника, блюз, лады — смотри, слушай и тыкай по грифу.", category: "guitar", icon: "🗺️", level: "Средний", minutes: 5, unscored: true },
  { id: "fingerstyle", href: "/train/fingerstyle", title: "Переборы", summary: "Арпеджио, Трэвис, вальс — сетка по струнам и подсветка в такт.", category: "guitar", icon: "🖐️", level: "Новичок", minutes: 5, unscored: true },
  // Improvisation & picking by ear
  { id: "progressions", href: "/train/progressions", title: "Подбор аккордов", summary: "Звучит последовательность — подбери аккорды, примеряя варианты на слух.", category: "improv", icon: "🧩", level: "Любой", minutes: 6 },
  { id: "key-finder", href: "/train/key-finder", title: "Найди тонику", summary: "Определи тональность отрывка — и поймёшь, какие ноты играть в песне.", category: "improv", icon: "🏠", level: "Любой", minutes: 5 },
  { id: "call-response", href: "/train/call-response", title: "Повтори фразу", summary: "Услышал мелодию — нашёл её на грифе. Словарь фраз для соло.", category: "improv", icon: "🔁", level: "Любой", minutes: 5 },
  { id: "jam", href: "/train/jam", title: "Джем под минус", summary: "Минусы с аккордами и ладами, гриф подсвечивает ноты аккорда вживую.", category: "improv", icon: "🔥", level: "Средний", minutes: 8, unscored: true },
  // Ear
  { id: "intervals", href: "/train/intervals", title: "Интервалы на слух", summary: "Два звука — определи расстояние между ними.", category: "ear", icon: "👂", level: "Любой", minutes: 5 },
  { id: "chords-ear", href: "/train/chords", title: "Аккорды на слух", summary: "Мажор, минор, септаккорды — узнавай по звучанию.", category: "ear", icon: "🎧", level: "Средний", minutes: 5 },
  // Rhythm
  { id: "rhythm-mic", href: "/train/rhythm-mic", title: "Ритм-анализ игры", summary: "Играешь под метроном — видишь, где спешишь и насколько ровно.", category: "rhythm", icon: "📈", level: "Любой", minutes: 5, needsMic: true },
  { id: "rhythm-reading", href: "/train/rhythm-reading", title: "Чтение ритма", summary: "Видишь ритм нотами — простукиваешь его. Восьмые, паузы, синкопы.", category: "rhythm", icon: "🎼", level: "Любой", minutes: 5 },
  { id: "rhythm", href: "/train/rhythm", title: "Чувство ритма", summary: "Попадай в долю метронома кнопкой — точность в миллисекундах.", category: "rhythm", icon: "🥁", level: "Любой", minutes: 3 },
  // Vocal
  { id: "warmup", href: "/train/warmup", title: "Распевки", summary: "Опевание примы, гамма до–до, арпеджио — по полутонам вверх.", category: "vocal", icon: "🌅", level: "Любой", minutes: 5, needsMic: true, unscored: true },
  { id: "pitch-match", href: "/train/pitch-match", title: "Попадание в ноту", summary: "Звучит нота — спой её. Стрелка покажет точность.", category: "vocal", icon: "🎤", level: "Любой", minutes: 4, needsMic: true },
  { id: "pitch-graph", href: "/train/pitch-graph", title: "График голоса", summary: "Спой фразу — увидишь линию голоса поверх нужных нот.", category: "vocal", icon: "📉", level: "Любой", minutes: 5, needsMic: true },
  { id: "sustain", href: "/train/sustain", title: "Удержание и вибрато", summary: "Тянешь ноту — точность, стабильность и разбор вибрато.", category: "vocal", icon: "〽️", level: "Любой", minutes: 4, needsMic: true },
  { id: "sing-interval", href: "/train/sing-interval", title: "Спой интервал", summary: "От звучащей ноты спой терцию, квинту, октаву — сольфеджио голосом.", category: "vocal", icon: "🎯", level: "Средний", minutes: 5, needsMic: true },
  { id: "harmony", href: "/train/harmony", title: "Второй голос", summary: "Гитара ведёт мелодию, ты поёшь терцию выше или ниже.", category: "vocal", icon: "👥", level: "Средний", minutes: 5, needsMic: true },
  { id: "breath", href: "/train/breath", title: "Дыхание", summary: "Длинный ровный выдох на «с-с-с» — опора голоса. Рекорд и динамика.", category: "vocal", icon: "🌬️", level: "Любой", minutes: 3, needsMic: true, scoreUnit: " с" },
  { id: "vocal-range", href: "/train/vocal-range", title: "Диапазон голоса", summary: "Спой от самой низкой до самой высокой ноты и узнай свой тип голоса.", category: "vocal", icon: "📏", level: "Любой", minutes: 3, needsMic: true, unscored: true },
];

export function exercisesByCategory(category: ExerciseCategory): ExerciseMeta[] {
  return EXERCISES.filter((exercise) => exercise.category === category);
}

export function findExercise(id: string): ExerciseMeta | undefined {
  return EXERCISES.find((exercise) => exercise.id === id);
}
