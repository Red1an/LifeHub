import { useState } from "react";
import { Page, Section, Button, Input, Select, IconButton, EmptyState, Spinner, toast, confirm, prompt, cn } from "@lifehub/sdk";
import { resolveChannel, searchChannels, type FoundChannel } from "../lib/youtube";
import { useChannels, useTopics } from "../lib/store";

/** Каналы ленты по темам: поиск по названию или теме, добавление по ссылке. */
export function Channels() {
  const channels = useChannels();
  const [topics, setTopics] = useTopics();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [found, setFound] = useState<FoundChannel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const has = new Set(channels.items.map((c) => c.channelId));

  async function search(q = query) {
    if (!q.trim()) return;
    setBusy(true);
    setFound(null);
    try {
      const one = await resolveChannel(q);
      setFound(one ? [one] : await searchChannels(q));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function add(c: FoundChannel) {
    if (has.has(c.channelId)) return;
    await channels.add({ channelId: c.channelId, title: c.title, thumb: c.thumb, topic: topic || topics[0] || "Разное" });
    toast(`«${c.title}» → ${topic}`, "success");
  }

  async function addTopic() {
    const name = (await prompt("Новая тема", ""))?.trim();
    if (name && !topics.includes(name)) setTopics([...topics, name]);
  }
  async function removeTopic(t: string) {
    const inside = channels.items.filter((c) => c.topic === t);
    if (inside.length && !(await confirm(`В теме «${t}» ${inside.length} кан. — убрать тему вместе с ними?`, { danger: true }))) return;
    if (inside.length) await channels.batch({ remove: inside.map((c) => c.id) });
    setTopics(topics.filter((x) => x !== t));
  }

  return (
    <Page title="Каналы" subtitle="Лента берёт ролики только отсюда" width="wide">
      <Section title="Найти канал">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Input className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, тема, @имя или ссылка на канал" />
          <div className="flex gap-2">
            <Select className="flex-1 sm:w-40" value={topic} onChange={(e) => setTopic(e.target.value)} options={topics.map((t) => ({ value: t, label: `в «${t}»` }))} />
            <Button type="submit" loading={busy}>
              Найти
            </Button>
          </div>
        </form>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="py-1 text-muted">Идеи для поиска:</span>
          {["научпоп", "лекции физика", "программирование", "путешествия влог", "история", "английский язык", "психология", "космос"].map((s) => (
            <button
              key={s}
              className="rounded-full bg-surface-2 px-3 py-1 hover:bg-accent-soft"
              onClick={() => {
                setQuery(s);
                void search(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {busy && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {found && !found.length && <p className="py-4 text-sm text-muted">Ничего не нашёл.</p>}
        {found && found.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {found.map((c) => (
              <div key={c.channelId} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <Avatar src={c.thumb} title={c.title} />
                <div className="min-w-0 flex-1">
                  <a className="block truncate font-medium hover:underline" href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                  <div className="truncate text-xs text-muted">{[c.subs, c.about].filter(Boolean).join(" · ")}</div>
                </div>
                <Button size="sm" variant={has.has(c.channelId) ? "ghost" : "soft"} disabled={has.has(c.channelId)} onClick={() => add(c)}>
                  {has.has(c.channelId) ? "Есть" : "Добавить"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {channels.loading ? null : !channels.items.length ? (
        <EmptyState icon="🔎" title="Пока пусто" text="Найди каналы выше — по названию или по теме." />
      ) : null}

      {topics.map((t) => {
        const list = channels.items.filter((c) => c.topic === t);
        return (
          <Section
            key={t}
            title={`${t} · ${list.length}`}
            actions={
              <Button variant="ghost" size="sm" onClick={() => removeTopic(t)}>
                Убрать тему
              </Button>
            }
          >
            {!list.length ? (
              <p className="text-sm text-muted">Нет каналов.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5">
                    <Avatar src={c.thumb} title={c.title} />
                    <div className="min-w-0 flex-1 truncate font-medium">{c.title}</div>
                    <Select
                      className="w-32 !py-1 text-sm"
                      value={c.topic}
                      onChange={(e) => channels.update(c.id, { topic: e.target.value })}
                      options={topics.map((x) => ({ value: x, label: x }))}
                    />
                    <IconButton label="Убрать канал" onClick={() => channels.remove(c.id)}>
                      ✕
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </Section>
        );
      })}
      {/* Каналы из удалённых тем не теряются — показываем отдельно. */}
      <Orphans topics={topics} />
      <Button variant="secondary" onClick={addTopic}>
        + Тема
      </Button>
    </Page>
  );
}

function Orphans({ topics }: { topics: string[] }) {
  const channels = useChannels();
  const list = channels.items.filter((c) => !topics.includes(c.topic));
  if (!list.length) return null;
  return (
    <Section title="Без темы">
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5">
            <Avatar src={c.thumb} title={c.title} />
            <div className="min-w-0 flex-1 truncate">{c.title}</div>
            <Select
              className="w-32 !py-1 text-sm"
              value=""
              onChange={(e) => channels.update(c.id, { topic: e.target.value })}
              options={[{ value: "", label: "Тема…" }, ...topics.map((x) => ({ value: x, label: x }))]}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Avatar({ src, title }: { src?: string; title: string }) {
  return src ? (
    <img src={src} alt="" className="h-10 w-10 flex-none rounded-full object-cover" referrerPolicy="no-referrer" />
  ) : (
    <div className={cn("flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft font-semibold text-accent")}>{title.slice(0, 1)}</div>
  );
}
