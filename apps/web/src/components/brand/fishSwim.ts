/**
 * The Stratemark mark swims. Its two shapes are two fish chasing each other round a circle, yin and yang.
 *
 * Each shape is a body drawn around a spine: a curve of points from the head to the tail, with a width at every point. The mark's own
 * outline gives the resting spine and widths exactly (see markChains.ts), so at rest the fish IS the logo. To swim, the spine bends
 * into an arc round the middle of the mark and the body takes a fish's shape (a blunt head, the widest part about a third of the way
 * back, a thin tail stalk and a forked fin). Then a wave runs from head to tail along the spine, small at the head and larger at the
 * tail, which is how a fish's backbone moves; the fin turns with the end of the spine, so it follows through on its own. The second
 * fish is the first half a circle round, a little out of step. When the swim ends the spine relaxes and the fish are the logo again.
 *
 * Pure geometry (no DOM): `swimFrame` returns the two outlines as SVG path data for any moment of a swim.
 */
import { MARK_CENTRE, MARK_EDGE, MARK_OUTER } from './markChains';

interface Pt { x: number; y: number }

export interface SwimVariant {
  /** Seconds for the whole swim, from the logo to the logo. */
  seconds: number;
  /** Whole laps of the circle (the logo is the same picture after any whole number). */
  laps: number;
  /** Radius of the circle the fish swim on, in the mark's own units (the mark is about 28 wide). */
  radius: number;
  /** How far the tail swings sideways, in the same units. */
  sway: number;
  /** Tail beats per second. */
  beat: number;
  /** Wavelengths along the body. */
  waves: number;
}

export const SWIMS: Record<'orbit' | 'chase' | 'drift', SwimVariant> = {
  /** One slow lap. */
  orbit: { seconds: 4.4, laps: 1, radius: 11.4, sway: 2.5, beat: 1.25, waves: 1.0 },
  /** Two quicker laps, the tail beating faster. */
  chase: { seconds: 5.6, laps: 2, radius: 11.0, sway: 2.2, beat: 1.8, waves: 1.1 },
  /** One lap, wide and lazy. */
  drift: { seconds: 5.0, laps: 1, radius: 12.2, sway: 3.0, beat: 0.95, waves: 0.9 },
};

const C: Pt = { x: MARK_CENTRE[0], y: MARK_CENTRE[1] };
const M = MARK_OUTER.length;
/** Spine points beyond the end of the body that draw the tail fin. */
const FIN_STEPS = 4;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** The mark as a fish: spine, outward half-vector, half-width, from the blunt end (the head) to the sharp end (the tail). */
const REST = (() => {
  const spine: Pt[] = [];
  const dir: Pt[] = [];
  const half: number[] = [];
  for (let j = 0; j < M; j += 1) {
    const o = { x: MARK_OUTER[j]![0], y: MARK_OUTER[j]![1] };
    const e = { x: MARK_EDGE[j]![0], y: MARK_EDGE[j]![1] };
    spine.push({ x: (o.x + e.x) / 2, y: (o.y + e.y) / 2 });
    const v = sub(o, e);
    half.push(len(v) / 2);
    dir.push(len(v) > 1e-6 ? unit(v) : { x: 0, y: 0 });
  }
  // The tips have no width to point along: borrow the neighbour's direction.
  dir[0] = dir[1]!;
  dir[M - 1] = dir[M - 2]!;
  let length = 0;
  for (let j = 1; j < M; j += 1) length += len(sub(spine[j]!, spine[j - 1]!));
  return { spine, dir, half, length };
})();

/** A fish's body width along its length (0 at the nose, 1 at the tail): a blunt head, the widest part near a third of the way back. */
function bodyWidth(s: number, widest: number): number {
  const s0 = 0.3;
  if (s < s0) return widest * Math.sqrt(Math.max(0, 1 - ((s0 - s) / s0) ** 2));
  const t = (s - s0) / (1 - s0);
  return widest * (0.2 + 0.8 * (1 - t) ** 1.25);
}

/** The angle the head starts at on the circle, so the swimming pose begins where the logo's spine already is. */
const HEAD_START = Math.atan2(REST.spine[0]!.y - C.y, REST.spine[0]!.x - C.x);

/** One fish's outline at time `t` (seconds into the swim). `turn` is how far round the circle it has gone (radians, anticlockwise). */
function fishOutline(v: SwimVariant, t: number, morph: number, turn: number, speed: number, reflect: boolean, phaseShift: number): { d: string; eye: Pt } {
  const arc = REST.length * 0.72;
  const span = arc / v.radius;
  const pts: Pt[] = [];
  const dirs: Pt[] = [];
  const halves: number[] = [];

  // The swimming spine: an arc round the middle of the mark, plus the wave running from head to tail.
  const target: Pt[] = [];
  const radial: Pt[] = [];
  for (let j = 0; j < M; j += 1) {
    const s = j / (M - 1);
    const phi = HEAD_START - turn + s * span;
    const out = { x: Math.cos(phi), y: Math.sin(phi) };
    radial.push(out);
    const envelope = 0.16 + 0.84 * s ** 1.7;
    const sway = v.sway * envelope * (0.4 + 0.6 * speed) * Math.sin(2 * Math.PI * (v.waves * s - v.beat * t + phaseShift));
    target.push(add(C, mul(out, v.radius + sway)));
  }
  for (let j = 0; j < M; j += 1) {
    const a = target[Math.max(0, j - 1)]!;
    const b = target[Math.min(M - 1, j + 1)]!;
    const tangent = unit(sub(b, a));
    let n = { x: -tangent.y, y: tangent.x };
    if (n.x * radial[j]!.x + n.y * radial[j]!.y < 0) n = mul(n, -1);
    const s = j / (M - 1);
    const restDir = REST.dir[j]!;
    const d = unit(lerpPt(restDir, n, morph));
    pts.push(lerpPt(REST.spine[j]!, target[j]!, morph));
    dirs.push(d);
    halves.push(lerp(REST.half[j]!, bodyWidth(s, 4.0), morph));
  }

  const one: Pt[] = [];
  const two: Pt[] = [];
  for (let j = 0; j < M; j += 1) {
    one.push(add(pts[j]!, mul(dirs[j]!, halves[j]!)));
    two.push(sub(pts[j]!, mul(dirs[j]!, halves[j]!)));
  }
  // The tail fin continues the body: the spine runs on past its end, curling the same way, and the width flares to a fork. It opens as
  // the spine curls, and is nothing at all at rest.
  const turnPerStep = Math.atan2(
    (pts[M - 1]!.x - pts[M - 2]!.x) * (pts[M - 2]!.y - pts[M - 3]!.y) - (pts[M - 1]!.y - pts[M - 2]!.y) * (pts[M - 2]!.x - pts[M - 3]!.x),
    (pts[M - 1]!.x - pts[M - 2]!.x) * (pts[M - 2]!.x - pts[M - 3]!.x) + (pts[M - 1]!.y - pts[M - 2]!.y) * (pts[M - 2]!.y - pts[M - 3]!.y),
  );
  let heading = unit(sub(pts[M - 1]!, pts[M - 2]!));
  const stalk = halves[M - 1]!;
  const sideOne: Pt[] = [];
  const sideTwo: Pt[] = [];
  let at = pts[M - 1]!;
  const stepLen = (6.4 * morph) / FIN_STEPS;
  let across = dirs[M - 1]!;
  for (let k = 1; k <= FIN_STEPS; k += 1) {
    const cos = Math.cos(-turnPerStep * 0.5);
    const sin = Math.sin(-turnPerStep * 0.5);
    heading = { x: heading.x * cos - heading.y * sin, y: heading.x * sin + heading.y * cos };
    across = { x: across.x * cos - across.y * sin, y: across.x * sin + across.y * cos };
    at = add(at, mul(heading, stepLen));
    const u = k / FIN_STEPS;
    const width = lerp(stalk, 4.4 * morph + stalk * (1 - morph), Math.sin((u * Math.PI) / 2) ** 1.05);
    sideOne.push(add(at, mul(across, width)));
    sideTwo.push(sub(at, mul(across, width)));
  }
  const notch = add(at, mul(heading, -stepLen * FIN_STEPS * 0.26));

  const ring: Pt[] = [...one, ...sideOne, notch, ...sideTwo.reverse(), two[M - 1]!, ...two.slice(1, M - 1).reverse()];
  const placed = reflect ? ring.map((p) => ({ x: 2 * C.x - p.x, y: 2 * C.y - p.y })) : ring;
  const eyeAt = add(pts[2]!, mul(dirs[2]!, halves[2]! * 0.42));
  const eye = reflect ? { x: 2 * C.x - eyeAt.x, y: 2 * C.y - eyeAt.y } : eyeAt;
  return { d: closedPath(placed), eye };
}

/** A smooth closed curve through the points (Catmull-Rom as cubic Beziers). */
function closedPath(p: Pt[]): string {
  const n = p.length;
  const f = (x: number) => Math.round(x * 100) / 100;
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = p[(i - 1 + n) % n]!;
    const p1 = p[i]!;
    const p2 = p[(i + 1) % n]!;
    const p3 = p[(i + 2) % n]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return `${d}Z`;
}

export interface SwimFrame { a: string; b: string; morph: number; turn: number; eyes: [{ x: number; y: number; r: number }, { x: number; y: number; r: number }] }

/** How far the logo has become fish at this moment: 0 is the logo, 1 is two swimming fish. */
export function morphAt(v: SwimVariant, t: number): number {
  const ramp = 0.95;
  return Math.min(smooth(t / ramp), smooth((v.seconds - t) / ramp));
}

/** The two outlines at `t` seconds into a swim, as SVG path data. */
export function swimFrame(v: SwimVariant, t: number): SwimFrame {
  const clamped = Math.min(v.seconds, Math.max(0, t));
  const morph = morphAt(v, clamped);
  // The turn eases in and out, over the middle of the swim; whole laps, so it ends where it began.
  const lead = 0.35;
  const tail = 0.5;
  const u = (clamped - lead) / (v.seconds - lead - tail);
  const turn = v.laps * 2 * Math.PI * easeSine(u);
  // How fast the fish is going now (0 to 1), which sets how hard the tail beats.
  const du = 0.01;
  const speed = Math.min(1, Math.abs(easeSine(u + du) - easeSine(u - du)) / (2 * du) / 1.6);
  const a = fishOutline(v, clamped, morph, turn, speed, false, 0);
  const b = fishOutline(v, clamped, morph, turn, speed, true, 0.5);
  const r = 0.95 * smooth((morph - 0.55) / 0.45);
  return { a: a.d, b: b.d, morph, turn, eyes: [{ ...a.eye, r }, { ...b.eye, r }] };
}

