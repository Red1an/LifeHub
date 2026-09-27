import { useState } from "react";
import {
  defineModule, Page, Card, Button, Input, List, ListItem, EmptyState, IconButton,
  useCollection, formatRelative,
} from "@lifehub/sdk";

interface Item {
  title: string;
  done: boolean;
}

function Home() {
  const items = useCollection<Item>("items");
  const [title, setTitle] = useState("");

  const add = async () => {
    if (!title.trim()) return;
    await items.add({ title: title.trim(), done: false });
    setTitle("");
  };

  return (
    <Page title="__NAME__" subtitle="__DESCRIPTION__">
      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Новая запись" />
          <Button type="submit" variant="primary">
            Добавить
          </Button>
        </form>
      </Card>

      {!items.loading && items.items.length === 0 ? (
        <EmptyState icon="__ICON__" title="Пока пусто" text="Добавьте первую запись" />
      ) : (
        <List>
          {[...items.items].reverse().map((it) => (
            <ListItem
              key={it.id}
              title={<span className={it.done ? "text-muted line-through" : ""}>{it.title}</span>}
              subtitle={formatRelative(it.createdAt)}
              left={
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--lh-accent)]"
                  checked={it.done}
                  onChange={() => items.update(it.id, { done: !it.done })}
                />
              }
              right={
                <IconButton label="Удалить" onClick={() => items.remove(it.id)}>
                  ✕
                </IconButton>
              }
            />
          ))}
        </List>
      )}
    </Page>
  );
}

function Widget() {
  const { items } = useCollection<Item>("items");
  const open = items.filter((i) => !i.done).length;
  return (
    <div>
      <div className="text-3xl font-semibold">{open}</div>
      <div className="text-sm text-muted">незавершённых из {items.length}</div>
    </div>
  );
}

export default defineModule({
  routes: { "/": Home },
  widgets: { summary: { title: "__NAME__", component: Widget } },
});
