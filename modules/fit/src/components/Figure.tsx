import { useEffect, useState } from "react";

/*
 * Анимированный человечек для упражнений стоя: скелет из углов суставов, ключевые позы,
 * плавная интерполяция по кругу. Вид спереди или сбоку (лицом вправо).
 *
 * Углы рук считаются от корпуса: 0 — вдоль тела вниз, 90 — в сторону (спереди) или вперёд (сбоку),
 * 180 — вверх, отрицательные — внутрь/назад. Локоть добавляет свой угол к предплечью.
 * Ноги — через положение стопы (ИК): таз опускается, стопы стоят, колени сгибаются сами.
 */
export interface Pose {
  /** Смещение таза (y > 0 — вниз). */
  x?: number; y?: number;
  /** Наклон корпуса (вправо или вперёд), скрутка (спереди). */
  t?: number; tw?: number;
  /** Наклон головы, поворот головы, сдвиг головы назад (подбородок). */
  h?: number; yaw?: number; hx?: number;
  /** Плечи вверх, плечи вперёд/назад (сбоку). */
  sh?: number; sx?: number;
  la?: number; le?: number; ra?: number; re?: number;
  /** Стопы: [x от центра, подъём от пола]. */
  lf?: [number, number]; rf?: [number, number];
  /** Относительная длительность перехода к следующей позе. */
  d?: number;
}

interface Anim { view: "front" | "side"; ms: number; linear?: boolean; frames: Pose[] }

const GROUND = 110;
const PELVIS_Y = 64.5;
const TORSO = 28, NECK = 9, UPPER = 15, FORE = 14, THIGH = 22, SHIN = 22;

const DEF: Record<Anim["view"], Required<Omit<Pose, "d">>> = {
  front: { x: 0, y: 0, t: 0, tw: 0, h: 0, yaw: 0, hx: 0, sh: 0, sx: 0, la: 10, le: 0, ra: 10, re: 0, lf: [-6, 0], rf: [6, 0] },
  side: { x: 0, y: 0, t: 0, tw: 0, h: 0, yaw: 0, hx: 0, sh: 0, sx: 0, la: 4, le: 8, ra: -4, re: 8, lf: [1, 0], rf: [-1, 0] },
};

/* Повторяющиеся позы рук. */
const HIPS = { la: 35, le: -115, ra: 35, re: -115 };      // руки на поясе (спереди)
const HEAD = { la: 150, le: 130, ra: 150, re: 130 };      // руки за головой (спереди)
const HEAD_S = { la: 160, le: 150, ra: 160, re: 150 };    // руки за головой (сбоку)
const CHEST = { la: 35, le: -125, ra: 35, re: -125 };     // руки перед грудью (спереди)

export const ANIMS: Record<string, Anim> = {
  "neck-tilts": { view: "front", ms: 4000, frames: [{ h: 0 }, { h: 28 }, { h: 0 }, { h: -28 }] },
  "neck-turns": { view: "front", ms: 4000, frames: [{ yaw: 0 }, { yaw: 70 }, { yaw: 0 }, { yaw: -70 }] },
  "neck-nods": { view: "side", ms: 3600, frames: [{ h: 0 }, { h: 38 }, { h: 0 }, { h: -18 }] },
  "chin-tuck": { view: "side", ms: 3000, frames: [{ hx: 0 }, { hx: -3.5, d: 2 }, { hx: -3.5 }, { hx: 0 }] },
  "shoulder-rolls": { view: "side", ms: 2400, linear: true, frames: [{ sh: 0, sx: 0 }, { sh: 3, sx: 2 }, { sh: 5, sx: 0 }, { sh: 3, sx: -2.5 }, { sh: 0, sx: 0 }] },
  "desk-shrugs": { view: "front", ms: 2200, frames: [{ sh: 0 }, { sh: 6, d: 1.5 }, { sh: 6 }, { sh: 0, d: 0.4 }] },
  "arm-circles": { view: "side", ms: 2000, linear: true, frames: [{ la: 0, ra: 0, le: 0, re: 0 }, { la: 90, ra: 90, le: 0, re: 0 }, { la: 180, ra: 180, le: 0, re: 0 }, { la: 270, ra: 270, le: 0, re: 0 }, { la: 360, ra: 360, le: 0, re: 0 }] },
  "elbow-circles": { view: "front", ms: 1600, linear: true, frames: [{ la: 90, ra: 90, le: 0, re: 0 }, { la: 90, ra: 90, le: 50, re: 50 }, { la: 90, ra: 90, le: 0, re: 0 }, { la: 90, ra: 90, le: -50, re: -50 }, { la: 90, ra: 90, le: 0, re: 0 }] },
  "wrist-shake": { view: "front", ms: 400, frames: [{ la: 8, ra: 8, le: 6, re: -6 }, { la: 10, ra: 10, le: -8, re: 8 }] },
  "arm-scissors": { view: "front", ms: 1600, frames: [{ la: 95, ra: 95 }, { la: -45, ra: -55 }, { la: 95, ra: 95 }, { la: -55, ra: -45 }] },
  "arm-swings": { view: "side", ms: 2000, frames: [{ la: 185, ra: -25 }, { la: 200, ra: -40 }, { la: -25, ra: 185 }, { la: -40, ra: 200 }] },
  "wall-angel": { view: "front", ms: 3000, frames: [{ la: 90, le: 90, ra: 90, re: 90 }, { la: 155, le: 15, ra: 155, re: 15 }] },
  "scap-squeeze": { view: "side", ms: 2400, frames: [{ la: 20, le: 90, ra: 20, re: 90, sx: 0 }, { la: -25, le: 90, ra: -25, re: 90, sx: -2, d: 1.5 }] },
  "torso-twist": { view: "front", ms: 2400, frames: [{ tw: 0, yaw: 0, ...CHEST }, { tw: 60, yaw: 45, ...CHEST }, { tw: 0, yaw: 0, ...CHEST }, { tw: -60, yaw: -45, ...CHEST }] },
  "standing-side-bend": { view: "front", ms: 4000, frames: [{ t: 0, la: 10, ra: 10 }, { t: 24, la: 165, ra: 15 }, { t: 0, la: 10, ra: 10 }, { t: -24, la: 15, ra: 165 }] },
  "hip-circles": { view: "front", ms: 2800, linear: true, frames: [{ x: 4, t: -5, ...HIPS }, { x: 0, y: 2, t: 0, ...HIPS }, { x: -4, t: 5, ...HIPS }, { x: 0, y: -1, t: 0, ...HIPS }, { x: 4, t: -5, ...HIPS }] },
  "standing-cat": { view: "side", ms: 4000, frames: [{ y: 5, x: -3, t: 38, h: 35, sh: 2, la: 55, le: 0, ra: 55, re: 0 }, { y: 5, x: -3, t: 32, h: -25, sh: 0, la: 50, le: 0, ra: 50, re: 0 }] },
  "forward-fold": { view: "side", ms: 5000, frames: [{ t: 0, la: 4, ra: -4 }, { t: 95, x: -5, y: 3, h: 20, la: 95, ra: 95, d: 1.4 }, { t: 95, x: -5, y: 3, h: 20, la: 95, ra: 95, d: 0.6 }] },
  "good-morning-bw": { view: "side", ms: 3000, frames: [{ t: 0, ...HEAD_S }, { t: 78, x: -6, y: 2, ...HEAD_S }] },
  "standing-backbend": { view: "side", ms: 3600, frames: [{ t: 0, ...HIPS_S() }, { t: -22, x: 2, h: -15, ...HIPS_S(), d: 1.5 }] },
  "knee-circles": { view: "front", ms: 2600, linear: true, frames: [{ y: 7, x: 3, la: 8, ra: 8, lf: [-3, 0], rf: [3, 0] }, { y: 8, x: 0, la: 8, ra: 8, lf: [-3, 0], rf: [3, 0] }, { y: 7, x: -3, la: 8, ra: 8, lf: [-3, 0], rf: [3, 0] }, { y: 5, x: 0, la: 8, ra: 8, lf: [-3, 0], rf: [3, 0] }, { y: 7, x: 3, la: 8, ra: 8, lf: [-3, 0], rf: [3, 0] }] },
  "side-lunge-shift": { view: "front", ms: 3200, frames: [{ x: 9, y: 9, ...HIPS, lf: [-17, 0], rf: [17, 0] }, { x: 0, y: 4, ...HIPS, lf: [-17, 0], rf: [17, 0] }, { x: -9, y: 9, ...HIPS, lf: [-17, 0], rf: [17, 0] }, { x: 0, y: 4, ...HIPS, lf: [-17, 0], rf: [17, 0] }] },
  "squat-reach": { view: "side", ms: 3000, frames: [{ y: 20, x: -7, t: 30, la: 45, ra: 45, le: 0, re: 0 }, { y: -3, la: 180, ra: 180, le: 0, re: 0 }] },
  "air-squat": { view: "side", ms: 2400, frames: [{ la: 4, ra: -4 }, { y: 21, x: -8, t: 34, la: 122, ra: 122, le: 0, re: 0, d: 0.8 }] },
  "box-squat": { view: "side", ms: 2800, frames: [{ la: 4, ra: -4 }, { y: 18, x: -8, t: 30, la: 118, ra: 118, le: 0, re: 0, d: 0.8 }] },
  "calf-raise": { view: "side", ms: 1800, frames: [{ y: 0 }, { y: -5, d: 0.8 }] },
  "reach-up": { view: "front", ms: 3600, frames: [{ y: 0, la: 175, ra: 175, le: 5, re: 5 }, { y: -4, la: 178, ra: 178, le: 0, re: 0 }, { y: -4, t: 10, la: 178, ra: 178 }, { y: -4, t: -10, la: 178, ra: 178 }] },
  "breath-arms": { view: "front", ms: 10000, frames: [{ la: 8, ra: 8, d: 4 }, { la: 172, ra: 172, sh: 1, d: 6 }] },
  "jumping-jacks": { view: "front", ms: 900, frames: [{ la: 8, ra: 8, lf: [-5, 0], rf: [5, 0] }, { y: -4, la: 90, ra: 90, lf: [-11, 4], rf: [11, 4], d: 0.4 }, { la: 172, ra: 172, lf: [-16, 0], rf: [16, 0] }, { y: -4, la: 90, ra: 90, lf: [-11, 4], rf: [11, 4], d: 0.4 }] },
  "march": { view: "side", ms: 1400, frames: [{ lf: [12, 20], rf: [-1, 0], la: -35, ra: 40, le: 30, re: 30 }, { lf: [1, 0], rf: [-1, 0], la: 0, ra: 0, le: 20, re: 20 }, { lf: [1, 0], rf: [12, 20], la: 40, ra: -35, le: 30, re: 30 }, { lf: [1, 0], rf: [-1, 0], la: 0, ra: 0, le: 20, re: 20 }] },
  "high-knees": { view: "side", ms: 900, frames: [{ y: -2, lf: [14, 26], rf: [-1, 0], la: -40, ra: 50, le: 80, re: 80 }, { y: -1, lf: [1, 2], rf: [-1, 2], la: 0, ra: 0, le: 80, re: 80, d: 0.5 }, { y: -2, lf: [1, 0], rf: [14, 26], la: 50, ra: -40, le: 80, re: 80 }, { y: -1, lf: [1, 2], rf: [-1, 2], la: 0, ra: 0, le: 80, re: 80, d: 0.5 }] },
  "butt-kicks": { view: "side", ms: 1000, frames: [{ lf: [-7, 26], rf: [-1, 0], la: 30, ra: -30, le: 80, re: 80 }, { lf: [1, 1], rf: [-1, 1], la: 0, ra: 0, le: 80, re: 80, d: 0.5 }, { lf: [1, 0], rf: [-7, 26], la: -30, ra: 30, le: 80, re: 80 }, { lf: [1, 1], rf: [-1, 1], la: 0, ra: 0, le: 80, re: 80, d: 0.5 }] },
  "knee-raise-hug": { view: "side", ms: 4400, frames: [{}, { y: -3, lf: [7, 30], la: 55, le: 70, ra: 55, re: 70, d: 1.5 }, { y: -3, lf: [7, 30], la: 55, le: 70, ra: 55, re: 70 }, {}, { y: -3, rf: [7, 30], la: 55, le: 70, ra: 55, re: 70, d: 1.5 }, { y: -3, rf: [7, 30], la: 55, le: 70, ra: 55, re: 70 }] },
  "oblique-crunch-standing": { view: "front", ms: 1800, frames: [{ ...HEAD }, { t: 16, ...HEAD, rf: [15, 20] }, { ...HEAD }, { t: -16, ...HEAD, lf: [-15, 20] }] },
  "standing-knee-elbow": { view: "front", ms: 1600, frames: [{ ...HEAD }, { t: -10, tw: 30, ...HEAD, ra: 115, re: 95, lf: [2, 26] }, { ...HEAD }, { t: 10, tw: -30, ...HEAD, la: 115, le: 95, rf: [-2, 26] }] },
  "shadow-boxing": { view: "side", ms: 900, frames: [{ y: 3, la: 90, le: 0, ra: 40, re: 110, lf: [6, 0], rf: [-8, 0] }, { y: 3, la: 40, le: 110, ra: 90, re: 0, lf: [6, 0], rf: [-8, 0] }] },
  "reverse-lunge": { view: "side", ms: 4000, frames: [{ ...HIPS_S() }, { y: 14, x: -2, lf: [8, 0], rf: [-22, 0], ...HIPS_S(), d: 1.2 }, { ...HIPS_S() }, { y: 14, x: -2, rf: [8, 0], lf: [-22, 0], ...HIPS_S(), d: 1.2 }] },
  "leg-swings": { view: "side", ms: 1800, frames: [{ rf: [29, 14], la: 70, le: 0, ra: 70, re: 0 }, { rf: [-20, 7], la: 70, le: 0, ra: 70, re: 0 }] },
  "standing-hip-flexor": { view: "side", ms: 4000, frames: [{ y: 7, lf: [15, 0], rf: [-17, 0], ...HIPS_S() }, { y: 9, x: 2, t: -6, lf: [15, 0], rf: [-17, 0], ...HIPS_S() }] },
  "quad-stretch": { view: "side", ms: 4000, frames: [{ rf: [-9, 34], ra: -25, re: -20, la: 4 }, { rf: [-10, 35], ra: -25, re: -20, la: 10, t: -2 }] },
  "windmill": { view: "front", ms: 3600, frames: [{ la: 90, ra: 90, lf: [-14, 0], rf: [14, 0] }, { t: 55, y: 6, la: 125, ra: 20, lf: [-14, 0], rf: [14, 0] }, { la: 90, ra: 90, lf: [-14, 0], rf: [14, 0] }, { t: -55, y: 6, la: 20, ra: 125, lf: [-14, 0], rf: [14, 0] }] },
  "jump-squat": { view: "side", ms: 1600, frames: [{ y: 20, x: -8, t: 34, la: 10, ra: 10, le: 0, re: 0 }, { y: -12, la: 175, ra: 175, le: 0, re: 0, lf: [1, 10], rf: [-1, 10], d: 0.5 }, { y: 0, la: 60, ra: 60 }] },
};

/** Руки на поясе (сбоку). */
function HIPS_S(): Pose { return { la: -35, le: 95, ra: -35, re: 95 }; }

const rad = (d: number) => (d * Math.PI) / 180;
type P = [number, number];
/** Вектор длины len под углом deg (0 — вниз, по часовой к +x). */
const dir = (deg: number, len: number): P => [Math.sin(rad(deg)) * len, Math.cos(rad(deg)) * len];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const ease = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function sample(anim: Anim, ms: number): Required<Omit<Pose, "d">> {
  const def = DEF[anim.view];
  const frames = anim.frames.map((f) => ({ ...def, ...f }));
  if (frames.length === 1) return frames[0];
  const weights = anim.frames.map((f) => f.d ?? 1);
  // Для linear последний кадр — копия первого (круговые движения), не замыкаем ещё раз.
  const n = anim.linear ? frames.length - 1 : frames.length;
  const total = weights.slice(0, n).reduce((a, b) => a + b, 0);
  let pos = ((ms % anim.ms) / anim.ms) * total;
  let i = 0;
  while (i < n - 1 && pos > weights[i]) { pos -= weights[i]; i++; }
  const a = frames[i];
  const b = frames[(i + 1) % frames.length];
  const k = anim.linear ? pos / weights[i] : ease(Math.min(1, pos / weights[i]));
  const out = { ...a };
  for (const key of Object.keys(def) as (keyof typeof def)[]) {
    const va = a[key], vb = b[key];
    (out as Record<string, unknown>)[key] = Array.isArray(va) && Array.isArray(vb) ? [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k)] : lerp(va as number, vb as number, k);
  }
  return out;
}

/** Колено по двум точкам: таз и стопа (ИК двух звеньев). */
function knee(hip: P, foot: P, out: number): { k: P; f: P } {
  let dx = foot[0] - hip[0], dy = foot[1] - hip[1];
  let d = Math.hypot(dx, dy);
  const max = THIGH + SHIN - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const f: P = [hip[0] + dx, hip[1] + dy];
  const h = Math.sqrt(Math.max(0, THIGH * THIGH - (d / 2) ** 2));
  const mid: P = [hip[0] + dx / 2, hip[1] + dy / 2];
  const px = -dy / d, py = dx / d;
  const k1: P = [mid[0] + px * h, mid[1] + py * h];
  const k2: P = [mid[0] - px * h, mid[1] - py * h];
  return { k: (k1[0] - k2[0]) * out >= 0 ? k1 : k2, f };
}

function Skeleton({ pose, view }: { pose: Required<Omit<Pose, "d">>; view: Anim["view"] }) {
  const side = view === "side";
  const pelvis: P = [50 + pose.x, PELVIS_Y + pose.y];
  const neck = add(pelvis, dir(180 - pose.t, TORSO));
  const head = add(add(neck, dir(180 - pose.t - pose.h, NECK)), [pose.hx, 0]);
  const shW = side ? 0 : 9 * Math.cos(rad(pose.tw));
  const hipW = side ? 0 : 5;
  // Перпендикуляр к корпусу (вправо).
  const across = dir(90 - pose.t, 1);
  const shoulder = (s: number): P => [neck[0] + across[0] * shW * s + (side ? pose.sx : 0), neck[1] + across[1] * shW * s + 2 - pose.sh];
  const hipP = (s: number): P => [pelvis[0] + hipW * s, pelvis[1]];

  const arm = (s: number, a: number, e: number) => {
    const sh = shoulder(s);
    // Спереди левая рука уходит влево (угол зеркалим), сбоку обе — в одной плоскости.
    const m = side ? 1 : s;
    const twist = side ? 0 : Math.sin(rad(pose.tw));
    const el = add(add(sh, dir(m * a - pose.t, UPPER)), [twist * 4, 0]);
    const hand = add(add(el, dir(m * (a + e) - pose.t, FORE)), [twist * 5, 0]);
    return { sh, el, hand };
  };
  const leg = (s: number, f: [number, number]) => {
    const hp = hipP(s);
    const footTarget: P = [50 + f[0], GROUND - 2 - f[1]];
    const { k, f: ankle } = knee(hp, footTarget, side ? 1 : s);
    const lift = GROUND - ankle[1];
    let toe: P;
    if (side) {
      const sx = ankle[0] - k[0], sy = ankle[1] - k[1], sl = Math.hypot(sx, sy) || 1;
      toe = lift > 2 && lift < 9 ? [ankle[0] + Math.sqrt(Math.max(0, 49 - lift * lift)), GROUND] : [ankle[0] + (sy / sl) * 7, ankle[1] - (sx / sl) * 7 + 1];
    } else toe = [ankle[0] + 4 * s, ankle[1] + 1];
    return { hp, k, ankle, toe };
  };

  const L = arm(-1, pose.la, pose.le), R = arm(1, pose.ra, pose.re);
  const LL = leg(-1, pose.lf), RL = leg(1, pose.rf);
  const near = "var(--ft-lime)";
  const far = side ? "#6f8a1f" : near;
  // Тёмный контур отделяет руку от корпуса, когда они перекрываются.
  const line = (a: P, b: P, c: string, w: number, key: string) => (
    <g key={key}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--ft-panel-2)" strokeWidth={w + 2.4} strokeLinecap="round" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />
    </g>
  );
  const limbs = (p: { sh?: P; el?: P; hand?: P; hp?: P; k?: P; ankle?: P; toe?: P }, c: string, key: string) => p.sh
    ? [line(p.sh, p.el!, c, 4.4, key + "u"), line(p.el!, p.hand!, c, 3.8, key + "f")]
    : [line(p.hp!, p.k!, c, 5.2, key + "t"), line(p.k!, p.ankle!, c, 4.6, key + "s"), line(p.ankle!, p.toe!, c, 3.6, key + "p")];

  const yaw = rad(pose.yaw);
  const eyes = side
    ? [[head[0] + 3.6, head[1] - 1]]
    : [-1, 1].map((s) => [head[0] + Math.sin(yaw) * 4 + Math.cos(yaw) * 2.3 * s, head[1] - 0.8]).filter((_, i) => Math.abs(pose.yaw) < 55 || (pose.yaw > 0 ? i === 1 : i === 0));
  const mouthX = head[0] + (side ? 3.6 : Math.sin(yaw) * 4);

  return (
    <g>
      {/* дальние конечности сбоку — темнее */}
      {limbs(LL, far, "ll")}
      {side && limbs(L, far, "la")}
      {line(pelvis, neck, near, 7, "torso")}
      {!side && line(shoulder(-1), shoulder(1), near, 5, "sh")}
      {!side && line(hipP(-1), hipP(1), near, 5, "hip")}
      {limbs(RL, near, "rl")}
      {!side && limbs(L, near, "la")}
      {limbs(R, near, "ra")}
      <g transform={`rotate(${pose.t + pose.h} ${head[0]} ${head[1]})`}>
        <circle cx={head[0]} cy={head[1]} r={6.6} fill={near} stroke="var(--ft-panel-2)" strokeWidth={1.2} />
        {eyes.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={0.95} fill="#0a0b0d" />)}
        <line x1={mouthX - (side ? 0 : 1.6)} y1={head[1] + 2.6} x2={mouthX + 1.6} y2={head[1] + 2.6} stroke="#0a0b0d" strokeWidth={0.8} strokeLinecap="round" />
      </g>
    </g>
  );
}

/** at — показать неподвижный кадр в этой доле цикла (для миниатюр). */
export function Figure({ id, paused, at, className }: { id: string; paused?: boolean; at?: number; className?: string }) {
  const anim = ANIMS[id];
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!anim || paused || at != null) return;
    let raf = 0;
    const start = performance.now() - t;
    const loop = (now: number) => { setT(now - start); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anim, paused, at]);
  if (!anim) return null;
  return (
    <svg viewBox="6 2 88 116" className={className} role="img" aria-label="Анимация движения">
      <ellipse cx="50" cy={GROUND + 1} rx="30" ry="2.4" fill="#1d2026" />
      <Skeleton pose={sample(anim, at != null ? at * anim.ms : t)} view={anim.view} />
    </svg>
  );
}
