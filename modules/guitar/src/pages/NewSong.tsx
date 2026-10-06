import { useMemo, useState } from "react";
import { uid, useNavigate } from "@lifehub/sdk";
import { Btn, Header, Panel, Screen, Section, Segments } from "../components/kit";
import { Sheet } from "../components/Sheet";
import { guessKey, parseSheet, sheetChords } from "../lib/sheet";
import { songsDb } from "../lib/songs";

const EXAMPLE = `[Куплет]
Am              C
Первая строчка куплета
G               E
И вторая строчка

e|-----0-----|
B|---1---1---|
G|-2-------2-|`;

export default function NewSongPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [kind, setKind] = useState<"chords" | "tab">("chords");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const lines = useMemo(() => parseSheet(body), [body]);
  const chords = useMemo(() => sheetChords(lines), [lines]);

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    const id = `u-${uid()}`;
    await songsDb.put(id, {
      title: title.trim(),
      artist: artist.trim() || "Неизвестен",
      key: guessKey(lines) ?? undefined,
      kind,
      body,
      addedAt: Date.now(),
    });
    navigate(`/song/${id}`, { replace: true });
  };

  return (
    <Screen>
      <Header back="/songs" title="Своя песня" subtitle="Вставь текст с аккордами с любого сайта — аккорды над словами, внутри строки в [скобках] или табы. Разметка распознаётся сама." />
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" className="gt-input" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Исполнитель" className="gt-input" />
        </div>
        <Segments
          value={kind}
          onChange={setKind}
          items={[
            { id: "chords", label: "Аккорды с текстом" },
            { id: "tab", label: "Табулатура" },
          ]}
        />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={EXAMPLE} rows={14} className="gt-input gt-mono text-sm leading-relaxed" spellCheck={false} />
        <Btn onClick={save} loading={saving} disabled={!title.trim() || !body.trim()}>
          Сохранить
        </Btn>
      </div>
      {body.trim() && (
        <Section title="Как будет выглядеть" right={<span className="text-xs text-[var(--gt-muted)]">{chords.length ? `аккорды: ${chords.join(" ")}` : "аккордов не найдено"}</span>}>
          <Panel>
            <Sheet lines={lines} fontSize={14} onChord={() => {}} />
          </Panel>
        </Section>
      )}
    </Screen>
  );
}
