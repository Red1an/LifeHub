/*
 * Маленькая силовая раскладка для графа связей: отталкивание узлов, пружины по рёбрам,
 * притяжение к центру. Для сотен узлов хватает O(n²) и пары сотен шагов.
 */

export interface GNode {
  id: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GEdge {
  a: string;
  b: string;
  /** Желаемая длина. */
  len: number;
}

export function layout(nodes: GNode[], edges: GEdge[], steps = 300) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges.map((e) => [idx.get(e.a), idx.get(e.b), e.len] as const).filter((l): l is readonly [number, number, number] => l[0] !== undefined && l[1] !== undefined);
  // Начальная раскладка — спираль, чтобы результат был одинаковым при каждом открытии.
  nodes.forEach((n, i) => {
    const a = i * 2.4;
    const r = 12 * Math.sqrt(i + 1);
    n.x = Math.cos(a) * r;
    n.y = Math.sin(a) * r;
    n.vx = n.vy = 0;
  });
  for (let s = 0; s < steps; s++) {
    const alpha = 1 - s / steps;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.5;
        }
        const min = p.r + q.r + 6;
        const f = (900 * alpha) / d2 + (d2 < min * min ? 0.5 : 0);
        const d = Math.sqrt(d2);
        p.vx -= (dx / d) * f;
        p.vy -= (dy / d) * f;
        q.vx += (dx / d) * f;
        q.vy += (dy / d) * f;
      }
    }
    for (const [ia, ib, len] of links) {
      const p = nodes[ia];
      const q = nodes[ib];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.max(0.1, Math.hypot(dx, dy));
      const f = (d - len) * 0.04 * alpha;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
      q.vx -= (dx / d) * f;
      q.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += Math.max(-20, Math.min(20, n.vx));
      n.y += Math.max(-20, Math.min(20, n.vy));
    }
  }
  return nodes;
}

export function bounds(nodes: GNode[], pad = 30, min = 360) {
  if (!nodes.length) return { x: -100, y: -100, w: 200, h: 200 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.r);
    y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r);
    y1 = Math.max(y1, n.y + n.r);
  }
  // Мало узлов — не приближаем до гигантских кружков: область не меньше min×min.
  const w = Math.max(min, x1 - x0 + pad * 2);
  const h = Math.max(min, y1 - y0 + pad * 2);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}
