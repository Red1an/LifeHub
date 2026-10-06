import { useEffect, useMemo, useState } from "react";
import { cn, Link, useNavigate, useSearchParams } from "@lifehub/sdk";
import { Btn, Empty, Header, LinkBtn, Panel, Pill, Screen, Section } from "../components/kit";
import { STATUS_RU, useLibrary, type LibSong, type SongMeta } from "../lib/songs";
import { groupResults, searchUg, ugScore, UG_TYPE_RU, type UgGroup, type UgResult } from "../lib/ug";

type Filter = "all" | "learning" | "want" | "learned" | "fav" | "tab";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "learning", label: "🎸 Учу" },
  { id: "want", label: "📌 Хочу" },
  { id: "learned", label: "✅ Выучил" },
  { id: "fav", label: "★" },
  { id: "tab", label: "Табы" },
];

const IDEAS = ["Кино", "Сплин", "Король и Шут", "ДДТ", "Би-2", "Звери", "Nirvana", "Metallica", "Oasis", "Radiohead"];

const searchCache = new Map<string, UgGroup[]>();

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function SongsPage() {
  const lib = useLibrary();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [online, setOnline] = useState<UgGroup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setQuery(text);
    setParams({ q: text });
    setError(null);
    const cached = searchCache.get(norm(text));
    if (cached) return setOnline(cached);
    setSearching(true);
    try {
      const groups = groupResults(await searchUg(text), text);
      searchCache.set(norm(text), groups);
      setOnline(groups);
    } catch (e) {
      setError((e as Error).message);
      setOnline(null);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const q = params.get("q");
    if (q && !online && !searching) void run(q);
  }, []);

  const local = useMemo(() => {
    const q = norm(query.trim());
    return lib.songs
      .filter((s) => {
        const m = lib.meta.get(s.id);
        if (filter === "fav") return m?.fav;
        if (filter === "tab") return s.kind === "tab";
        if (filter !== "all") return m?.status === filter;
        return true;
      })
      .filter((s) => !q || norm(`${s.title} ${s.artist} ${(s.tags ?? []).join(" ")}`).includes(q))
      .sort((a, b) => (lib.meta.get(b.id)?.openedAt ?? 0) - (lib.meta.get(a.id)?.openedAt ?? 0));
  }, [lib.songs, lib.meta, query, filter]);

  // Песни, открытые из поиска, но не сохранённые, — тоже показываем в «Недавних».
  const recentOnline = useMemo(
    () =>
      [...lib.meta.values()]
        .filter((m) => m.id.startsWith("ug-") && m.title && m.openedAt && !lib.songs.some((s) => s.id === m.id))
        .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
        .slice(0, 5),
    [lib.meta, lib.songs],
  );

  return (
    <Screen>
      <Header title="Песни" subtitle="Аккорды и табы любой песни: найди, разбери видео, учи по шагам." right={<LinkBtn to="/songs/new" tone="ghost" className="!min-h-10 text-sm">＋ Своя</LinkBtn>} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex gap-2"
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Исполнитель или песня…" className="gt-input" enterKeyHint="search" />
        <Btn type="submit" loading={searching} className="shrink-0">
          Найти
        </Btn>
      </form>
      {!online && !searching && (
        <div className="gt-scroll-x mt-3">
          {IDEAS.map((q) => (
            <button key={q} className="gt-chip !min-h-8 text-xs" onClick={() => run(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {error && <Panel className="mt-4 text-sm text-[var(--gt-red)]">Поиск не удался: {error}</Panel>}

      {online && (
        <Section
          title={`В интернете · ${online.length}`}
          right={
            <button className="text-xs text-[var(--gt-muted)] underline" onClick={() => setOnline(null)}>
              скрыть
            </button>
          }
        >
          {online.length === 0 && <Panel className="text-sm text-[var(--gt-muted)]">Ничего не нашлось. Попробуй только название песни или только исполнителя.</Panel>}
          <div className="space-y-2">
            {online.slice(0, 40).map((g) => (
              <OnlineGroup key={g.key} group={g} onOpen={(v) => navigate(`/song/ug-${v.id}?u=${encodeURIComponent(v.url)}`)} />
            ))}
          </div>
          <div className="mt-2 text-center text-xs text-[var(--gt-muted)]">Аккорды и табы — с Ultimate Guitar. Платные версии скрыты.</div>
        </Section>
      )}

      <Section title="Моя библиотека">
        <div className="gt-scroll-x mb-3">
          {FILTERS.map((f) => (
            <button key={f.id} data-on={filter === f.id} onClick={() => setFilter(f.id)} className="gt-chip !min-h-8 text-xs">
              {f.label}
            </button>
          ))}
        </div>
        {local.length === 0 ? (
          <Empty icon="🎵" title={query ? "В библиотеке такого нет" : "Пусто"} text={query ? "Нажми «Найти» — поищем в интернете." : "Найди песню через поиск и сохрани её."} />
        ) : (
          <div className="space-y-2">
            {local.map((s) => (
              <SongRow key={s.id} song={s} meta={lib.meta.get(s.id)} />
            ))}
          </div>
        )}
        {recentOnline.length > 0 && filter === "all" && !query && (
          <>
            <div className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-[var(--gt-muted)]">Недавно смотрел</div>
            <div className="space-y-2">
              {recentOnline.map((m) => (
                <Link key={m.id} to={`/song/${m.id}`} className="gt-panel flex items-center gap-3 !rounded-2xl px-4 py-3 transition hover:border-[var(--gt-brass)]">
                  <span className="text-lg">🕘</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.title}</span>
                    <span className="block truncate text-sm text-[var(--gt-muted)]">{m.artist}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </Section>
    </Screen>
  );
}

function SongRow({ song, meta }: { song: LibSong; meta?: SongMeta & { id: string } }) {
  const st = meta?.status ? STATUS_RU[meta.status] : null;
  return (
    <Link to={`/song/${song.id}`} className="gt-panel flex items-center gap-3 !rounded-2xl px-4 py-3 transition hover:border-[var(--gt-brass)]">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--gt-panel-2)] text-lg">{st?.icon ?? (song.kind === "tab" ? "🎼" : "🎵")}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {meta?.fav && <span className="text-[var(--gt-brass)]">★ </span>}
          {song.title}
        </span>
        <span className="block truncate text-sm text-[var(--gt-muted)]">{song.artist}</span>
      </span>
      {song.kind === "tab" && <Pill color="var(--gt-violet)">таб</Pill>}
      {song.key && <Pill>{song.key}</Pill>}
    </Link>
  );
}

function OnlineGroup({ group, onOpen }: { group: UgGroup; onOpen: (v: UgResult) => void }) {
  const top = (type: string) => group.versions.filter((v) => v.type === type).sort((a, b) => ugScore(b) - ugScore(a))[0];
  const best = top("Chords") ?? group.versions[0];
  const bestTab = top("Tabs");
  // Сначала лучшие аккорды и лучший таб, затем остальные версии по оценке.
  const ordered = [best, ...(bestTab && bestTab !== best ? [bestTab] : []), ...group.versions.filter((v) => v !== best && v !== bestTab).sort((a, b) => ugScore(b) - ugScore(a))];
  const [more, setMore] = useState(false);
  const shown = more ? ordered : ordered.slice(0, 4);
  return (
    <div className="gt-panel !rounded-2xl p-3">
      <button onClick={() => onOpen(best)} className="flex w-full items-center gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--gt-brass)]/15 text-lg">🎸</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{group.song}</span>
          <span className="block truncate text-sm text-[var(--gt-muted)]">{group.artist}</span>
        </span>
        <span className="shrink-0 text-[var(--gt-brass)]">→</span>
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {shown.map((v) => (
          <button
            key={v.id}
            onClick={() => onOpen(v)}
            className={cn("rounded-lg border px-2 py-1 text-xs", v.id === best.id ? "border-[var(--gt-brass)] text-[var(--gt-brass)]" : v === bestTab ? "border-[var(--gt-violet)] text-[var(--gt-violet)]" : "border-[var(--gt-line)] text-[var(--gt-muted)] hover:text-[var(--gt-fg)]")}
          >
            {UG_TYPE_RU[v.type] ?? v.type}
            {v.version > 1 ? ` v${v.version}` : ""}
            {v.votes ? ` ★${v.rating.toFixed(1)} (${v.votes})` : ""}
            {v.key ? ` · ${v.key}` : ""}
            {v.id === best.id ? " · лучшая" : v === bestTab ? " · лучший таб" : ""}
          </button>
        ))}
        {group.versions.length > 4 && !more && (
          <button className="rounded-lg px-2 py-1 text-xs text-[var(--gt-muted)] underline" onClick={() => setMore(true)}>
            ещё {group.versions.length - 4}
          </button>
        )}
      </div>
    </div>
  );
}
