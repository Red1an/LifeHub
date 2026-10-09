import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Button, Modal, cn, toast, useCollection, useNavigate } from "@lifehub/sdk";
import { Empty, Head, Wrap, usePrefs } from "../components/kit.tsx";
import { findLinks, type LinkProposal } from "../lib/linker.ts";
import { linkPatches } from "../lib/related.ts";
import { bounds, layout, type GEdge, type GNode } from "../lib/graph.ts";
import { KINDS, kindOf } from "../lib/kinds.ts";
import { titleOf } from "../lib/text.ts";
import { wikiEdges } from "../lib/wikilinks.ts";
import type { Note, Topic } from "../lib/types.ts";

interface Node extends GNode {
  kind: "topic" | "note";
  label: string;
  color: string;
  emoji?: string;
}

/** Граф: темы — крупные узлы, заметки — точки цвета полки; рёбра — связи и принадлежность теме. */
export function GraphPage() {
  const notes = useCollection<Note>("notes");
  const topics = useCollection<Topic>("topics");
  const navigate = useNavigate();
  const [onlyLinked, setOnlyLinked] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const { prefs } = usePrefs();
  const [searching, setSearching] = useState(false);
  const [proposals, setProposals] = useState<LinkProposal[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const notesById = useMemo(() => new Map(notes.items.map((n) => [n.id, n])), [notes.items]);
  const filedCount = notes.items.filter((n) => n.status !== "inbox").length;

  const search = async () => {
    setSearching(true);
    try {
      const found = await findLinks(notes.items, topics.items, prefs);
      setProposals(found);
      setPicked(new Set(found.map((_, i) => i)));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSearching(false);
    }
  };

  const applyLinks = async () => {
    if (!proposals) return;
    const pairs = proposals.filter((_, i) => picked.has(i)).map((p) => [p.a, p.b] as [string, string]);
    for (const p of linkPatches(notesById, pairs)) await notes.update(p.id, { related: p.related });
    toast(`Связано: ${pairs.length}`, "success");
    setProposals(null);
    setOnlyLinked(true);
  };

  const { nodes, edges } = useMemo(() => {
    const filed = notes.items.filter((n) => n.status !== "inbox" && n.status !== "archived");
    const ids = new Set(filed.map((n) => n.id));
    const edges: GEdge[] = [];
    const seen = new Set<string>();
    for (const n of filed) {
      for (const r of n.related ?? []) {
        if (!ids.has(r)) continue;
        const k = n.id < r ? `${n.id}|${r}` : `${r}|${n.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ a: n.id, b: r, len: 60 });
      }
      if (n.topicId) edges.push({ a: `t:${n.topicId}`, b: n.id, len: 55 });
    }
    // Ссылки [[…]] из текста — такие же рёбра, как связи.
    for (const [a, b] of wikiEdges(filed)) {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k) || !ids.has(a) || !ids.has(b)) continue;
      seen.add(k);
      edges.push({ a, b, len: 60 });
    }
    const linked = new Set(edges.flatMap((e) => [e.a, e.b]));
    const topicIds = new Set(topics.items.map((t) => t.id));
    const nodes: Node[] = [
      ...topics.items.map<Node>((t) => ({ id: `t:${t.id}`, kind: "topic", label: t.name, emoji: t.emoji, color: "var(--nt-accent)", r: 20, x: 0, y: 0, vx: 0, vy: 0 })),
      ...filed
        .filter((n) => !onlyLinked || linked.has(n.id))
        .map<Node>((n) => ({ id: n.id, kind: "note", label: titleOf(n), color: kindOf(n).color, r: 6 + Math.min(4, (n.related?.length ?? 0) * 1.5), x: 0, y: 0, vx: 0, vy: 0 })),
    ];
    const nodeIds = new Set(nodes.map((n) => n.id));
    const live = edges.filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b) && (!e.a.startsWith("t:") || topicIds.has(e.a.slice(2))));
    layout(nodes, live, nodes.length > 300 ? 150 : 300);
    return { nodes, edges: live };
  }, [notes.items, topics.items, onlyLinked]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const box = useMemo(() => bounds(nodes), [nodes]);
  const [view, setView] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of edges) {
      if (e.a === hover) s.add(e.b);
      if (e.b === hover) s.add(e.a);
    }
    return s;
  }, [hover, edges]);

  const scale = () => (svgRef.current ? box.w / view.k / svgRef.current.clientWidth : 1);

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    } else drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.max(0.5, Math.min(6, (pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d));
      setView((v) => ({ ...v, k }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const s = scale();
    setView((v) => ({ ...v, x: d.vx - dx * s, y: d.vy - dy * s }));
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) setTimeout(() => (drag.current = null), 0);
  };
  const open = (n: Node) => {
    if (drag.current?.moved) return;
    navigate(n.kind === "topic" ? `/t/${n.id.slice(2)}` : `/n/${n.id}`);
  };

  const vw = box.w / view.k;
  const vh = box.h / view.k;
  const vx = box.x + (box.w - vw) / 2 + view.x;
  const vy = box.y + (box.h - vh) / 2 + view.y;

  return (
    <Wrap wide>
      <Head
        title="Связи"
        back="/topics"
        sub="Темы и заметки, которые ссылаются друг на друга. Тяни, щипай, нажимай."
      />
      <div className="-mt-2 mb-3 flex flex-wrap gap-1.5">
        <button type="button" className={cn("nt-chip", !onlyLinked && "nt-chip-on")} onClick={() => setOnlyLinked(!onlyLinked)}>
          {onlyLinked ? "Только связанные" : "Все заметки"}
        </button>
        <button type="button" className="nt-chip" disabled={searching || filedCount < 3} onClick={search}>
          {searching ? "🔗 Ищу связи…" : "🔗 Найти связи"}
        </button>
      </div>
      {nodes.length < 2 ? (
        <Empty
          icon="🕸️"
          title="Пока нечего связывать"
          text={filedCount >= 3 ? "Нажми «Найти связи» — нейронка пройдётся по заметкам и предложит, что с чем связано." : "Связи появятся после разбора воронки: нейронка находит, к чему относится новая мысль."}
        />
      ) : (
        <>
          <div className="nt-paper relative overflow-hidden">
            <svg
              ref={svgRef}
              className="nt-graph block h-[62dvh] w-full touch-none select-none"
              viewBox={`${vx} ${vy} ${vw} ${vh}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onWheel={(e) => setView((v) => ({ ...v, k: Math.max(0.5, Math.min(6, v.k * (e.deltaY < 0 ? 1.12 : 0.9))) }))}
            >
              {edges.map((e, i) => {
                const a = byId.get(e.a)!;
                const b = byId.get(e.b)!;
                const dim = neighbors && !(neighbors.has(e.a) && neighbors.has(e.b));
                return (
                  <line key={i} className="nt-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={a.kind === "topic" || b.kind === "topic" ? 1 : 1.6} strokeDasharray={a.kind === "topic" || b.kind === "topic" ? "3 3" : undefined} opacity={dim ? 0.15 : 1} />
                );
              })}
              {nodes.map((n) => {
                const dim = neighbors && !neighbors.has(n.id);
                return (
                  <g key={n.id} transform={`translate(${n.x} ${n.y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer" onClick={() => open(n)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                    {n.kind === "topic" ? (
                      <>
                        <circle r={n.r} fill="var(--nt-paper)" stroke="var(--nt-accent)" strokeWidth={2} />
                        <text textAnchor="middle" dy="0.35em" fontSize={18}>
                          {n.emoji}
                        </text>
                        <text textAnchor="middle" y={n.r + 13} fontSize={11} fontWeight={600}>
                          {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
                        </text>
                      </>
                    ) : (
                      <>
                        <circle r={n.r} fill={n.color} stroke="var(--nt-paper)" strokeWidth={1.5} />
                        {(hover === n.id || view.k > 1.6) && (
                          <text textAnchor="middle" y={-n.r - 5} fontSize={9.5}>
                            {n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-2 right-2 flex gap-1">
              <button type="button" className="nt-mic !h-9 !w-9" aria-label="Приблизить" onClick={() => setView((v) => ({ ...v, k: Math.min(6, v.k * 1.3) }))}>
                ＋
              </button>
              <button type="button" className="nt-mic !h-9 !w-9" aria-label="Отдалить" onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.3) }))}>
                −
              </button>
              <button type="button" className="nt-mic !h-9 !w-9" aria-label="Сбросить вид" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
                ⟲
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {KINDS.map((s) => (
              <span key={s.id} className="nt-muted inline-flex items-center gap-1">
                <span className="nt-shelf-dot" style={{ background: s.color }} />
                {s.plural}
              </span>
            ))}
          </div>
        </>
      )}
      <Modal open={!!proposals} onClose={() => setProposals(null)} title="Нашёл связи">
        {proposals && (
          <div className="space-y-2">
            {!proposals.length && <p className="text-sm text-muted">Новых связей не нашлось — всё, что связано, уже связано.</p>}
            {proposals.map((p, i) => (
              <label key={i} className="flex items-start gap-2.5 rounded-lg border border-line p-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={picked.has(i)} onChange={() => setPicked((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                <span className="min-w-0 flex-1">
                  <b>{notesById.get(p.a) ? titleOf(notesById.get(p.a)!) : "?"}</b> ↔ <b>{notesById.get(p.b) ? titleOf(notesById.get(p.b)!) : "?"}</b>
                  {p.why && <span className="block text-xs text-muted">{p.why}</span>}
                </span>
              </label>
            ))}
            {proposals.length > 0 && (
              <Button variant="primary" block onClick={applyLinks} disabled={!picked.size}>
                Связать ({picked.size})
              </Button>
            )}
          </div>
        )}
      </Modal>
    </Wrap>
  );
}
