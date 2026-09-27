export type SongContentType = "chords" | "tab";

export interface Song {
  slug: string;
  title: string;
  artist: string;
  key: string;
  capo?: number;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  contentType: SongContentType;
  // For contentType "chords": ChordPro-lite text — [Am]lyrics, [[Section]] headers.
  // For contentType "tab": plain monospace ASCII tab text (6 lines per section).
  body: string;
  isUserSong?: boolean;
}

// Seed library: traditional / public-domain songs only, so the app ships with
// real, legally reproducible chords+lyrics out of the box. Use "Добавить песню"
// to paste chords/lyrics for any copyrighted song you personally want to learn —
// the app doesn't redistribute those, they just live in your browser.
export const SEED_SONGS: Song[] = [
  {
    slug: "amazing-grace",
    title: "Amazing Grace",
    artist: "Traditional",
    key: "G",
    difficulty: "easy",
    contentType: "chords",
    tags: ["folk", "3/4", "beginner"],
    body: `[[Куплет 1]]
[G]Amazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me
I [G]once was [G7]lost, but [C]now am [G]found
Was [Em]blind but [D]now I [G]see

[[Куплет 2]]
[G]'Twas grace that [G7]taught my [C]heart to [G]fear
And [G]grace my [Em]fears re[D]lieved
How [G]precious [G7]did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved`,
  },
  {
    slug: "house-of-the-rising-sun",
    title: "House of the Rising Sun",
    artist: "Traditional",
    key: "Am",
    difficulty: "medium",
    contentType: "chords",
    tags: ["folk", "fingerstyle", "minor"],
    body: `[[Куплет 1]]
[Am]There [C]is a [D]house in [F]New Or[Am]leans [C]they [E7]call the Rising [Am]Sun
[Am]And it's [C]been the [D]ruin of [F]many a poor [Am]boy [C]and [E7]God, I know I'm [Am]one

[[Куплет 2]]
[Am]My [C]mother [D]was a [F]tailor [Am]she [C]sewed my [E7]new blue [Am]jeans
[Am]My [C]father [D]was a [F]gamblin' man [Am]down [C]in [E7]New Or[Am]leans`,
  },
  {
    slug: "scarborough-fair",
    title: "Scarborough Fair",
    artist: "Traditional",
    key: "Dm",
    difficulty: "medium",
    contentType: "chords",
    tags: ["folk", "fingerstyle", "minor"],
    body: `[[Куплет 1]]
Are you [Dm]going to [C]Scarborough [Dm]Fair
[Dm]Parsley, [C]sage, rose[Dm]mary and [A]thyme
Re[Dm]member [C]me to [Dm]one who lives [Am]there
[Dm]She once [C]was a [Dm]true love of [Dm]mine`,
  },
  {
    slug: "swing-low-sweet-chariot",
    title: "Swing Low, Sweet Chariot",
    artist: "Traditional (Spiritual)",
    key: "D",
    difficulty: "easy",
    contentType: "chords",
    tags: ["spiritual", "beginner"],
    body: `[[Хор]]
[D]Swing low, sweet [G]chari[D]ot
Comin' for to [A7]carry me [D]home
[D]Swing low, sweet [G]chari[D]ot
Comin' for to [A7]carry me [D]home

[[Куплет]]
I [D]looked over Jordan and [G]what did I [D]see
Comin' for to [A7]carry me [D]home
A [D]band of angels [G]comin' after [D]me
Comin' for to [A7]carry me [D]home`,
  },
  {
    slug: "auld-lang-syne",
    title: "Auld Lang Syne",
    artist: "Traditional (Robert Burns)",
    key: "G",
    difficulty: "easy",
    contentType: "chords",
    tags: ["folk", "3/4", "beginner"],
    body: `[[Куплет]]
Should [G]auld ac[C]quaintance [G]be for[Em]got
And [Am]never brought to [D]mind
Should [G]auld ac[C]quaintance [G]be for[Em]got
And [D]days of auld lang [G]syne`,
  },
  {
    slug: "twelve-bar-blues-in-a",
    title: "12-Bar Blues в ля (шаблон для импровизации)",
    artist: "Практика",
    key: "A",
    difficulty: "easy",
    contentType: "chords",
    tags: ["blues", "improvisation", "backing"],
    body: `[[Форма (12 тактов)]]
[A7] / / / | [A7] / / / | [A7] / / / | [A7] / / /
[D7] / / / | [D7] / / / | [A7] / / / | [A7] / / /
[E7] / / / | [D7] / / / | [A7] / / / | [E7] / / /

Используй ля-минорную пентатонику (A C D E G) поверх всей формы —
она хорошо звучит на всех трёх аккордах блюза в A.`,
  },
  {
    slug: "am-pentatonic-box-1-riff",
    title: "Риф на боксе 1 (Am пентатоника)",
    artist: "Практика",
    key: "Am",
    difficulty: "easy",
    contentType: "tab",
    tags: ["riff", "improvisation", "beginner"],
    body: `[Боксовая позиция 1, лады 5-8]
e|-----------------5-8-----------------|
B|---------------5-----8---------------|
G|-------------5---------7-------------|
D|-----------5---------------7---------|
A|---------5-------------------7-------|
E|-------5-----------------------8-----|

Играй медленно под метроном 60 BPM, чередуя удары вниз-вверх (alternate picking).`,
  },
  {
    slug: "chromatic-warmup-riff",
    title: "Хроматическая разминка (1-2-3-4)",
    artist: "Практика",
    key: "—",
    difficulty: "easy",
    contentType: "tab",
    tags: ["warmup", "technique", "beginner"],
    body: `[Разминка по одной струне, все 4 пальца]
e|-1-2-3-4--------------------------------|
B|--------1-2-3-4-------------------------|
G|-----------------1-2-3-4----------------|
D|--------------------------1-2-3-4-------|
A|-------------------------------1-2-3-4--|
E|------------------------------------1-2-3-4|

Каждый палец — свой лад (1-й палец = 1-й лад и т.д.). Сначала медленно,
следи, чтобы каждый палец возвращался близко к грифу.`,
  },
];
