// PORTED from nza-hq/nza-decoded @ e5174c5, src/twin/app/draw/core.ts (decodED's drawing core, Brief 101).
// Both repos are Net Zero Advisory's own (decodED is UNLICENSED/private, same owner): no licence question.
// Copied verbatim below the line so a fix in either home can be diffed and carried across. Do not edit in place:
// change decodED's file first, then re-copy, or note the divergence here.
// ---------------------------------------------------------------------------------------------------------------------
// decodED's own — not copied, not overwritten by scripts/sync-twin.mjs. Brief 101 P1 (D2, D6, D7).
//
// THE ONE DRAWING CORE. Boundary, buildings and nature all draw through this: the rules, the snapping, the crossing
// check and the undo stack live here, once, in plain local metres (x east, y north). The stages are thin adapters that
// turn a pointer into metres and paint what the core holds (./mapStage.ts for MapLibre, the controller's ground taps
// and story/bio/Pencil.tsx for the 3D stage).
//
// The rules (D2), taken from twin/fix/polygon.ts + snap.ts (nza-estate's) and PR #165's boundary fixes:
//   - tap corners; from the third corner on, a side snaps square to the FIRST side (strict for buildings, as
//     nza-estate does it; within SQUARE_DEG for the boundary and nature, so any shape can still be drawn); Shift = any
//     angle, no snapping at all;
//   - a tap within SNAP_PX of a corner (or, failing that, an edge) of something already there lands on it;
//   - finish by tapping the first corner (CLOSE_PX) or Done; Backspace takes back a corner; Undo / Redo take back
//     whole changes;
//   - the closing side is never checked while drawing (#165): only the side just drawn, against the earlier ones.
//
// Linzie's rule (D7, 1 Nov 13:20): click freely, and never refuse in silence. Every tap places a corner. The only taps
// that do not are (a) one whose new side would cross an earlier side and (b) one on the first corner with under three
// corners; both come back as a `refused` outcome carrying the words to show at the pointer. An exact repeat of the
// last tap (the first half of a double-click) is the one tap dropped, and it says so (`repeat`), so a test can count
// it. Nothing else may swallow a tap — and the tests in core.test.ts hold every path to that.
//
// Imports: nothing (plain maths).

export type XY = [number, number];
/** What is being drawn: a closed area, an open line (a hedgerow), or one point (a bird box). */
export type Kind = 'area' | 'line' | 'point';
/** How sides snap square to the first side: always (buildings), only when close to square, or never. */
export type Square = 'strict' | 'soft' | 'off';
export type Refusal = 'cross' | 'few' | 'few-line';

/** About a fingertip's worth of aim, at any zoom (nza-estate's D5, snap.ts). */
export const SNAP_PX = 12;
/** A tap this close (px) to the first corner finishes the shape (#165: terra-draw's 40 px closed it by accident). */
export const CLOSE_PX = 14;
/** A press that moves less than this (px) is a tap, not a drag (#165). */
export const CLICK_SLOP_PX = 6;
/** 'soft' square: a side within this many degrees of the first side's frame lands square on it. */
export const SQUARE_DEG = 8;

/** The words for each refusal (D7): short, plain, said at the pointer and in the right panel. */
export const REFUSAL: Record<Refusal, string> = {
  cross: 'Those lines cross. Move the corner.',
  few: 'Add at least 3 corners first.',
  'few-line': 'Add at least 2 points first.',
};

export type Targets = {
  /** Corners of things already there (other shapes, the OS outline) a tap may land on. */
  corners?: readonly XY[];
  /** Their sides, for a tap that is near a side but no corner. */
  edges?: ReadonlyArray<readonly [XY, XY]>;
};

export type TapOpts = {
  /** Metres per screen pixel where the tap was, so the pixel rules mean the same at every zoom. */
  mPerPx: number;
  /** Shift: any angle, no snapping. */
  shift?: boolean;
  targets?: Targets;
};

export type Snapped = 'corner' | 'edge' | 'square' | 'free';

export type Outcome =
  | { kind: 'placed'; at: XY; snap: Snapped; index: number }
  | { kind: 'repeat'; at: XY }
  | { kind: 'finished'; shape: XY[] }
  | { kind: 'refused'; reason: Refusal; at: XY; message: string; sides: number[] };

/** A whole change, for Undo and Redo: the corners, which were placed free (Shift), and whether the shape is closed. */
type Snap = { corners: XY[]; free: boolean[]; raw: XY[]; closed: boolean };

export type CoreState = Readonly<{
  kind: Kind;
  corners: readonly XY[];
  free: readonly boolean[];
  /** The shape is finished (closed, for an area) and can be edited with Select. */
  closed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The last refusal, until the next change (the right panel's red warning and the red sides). */
  refused: { reason: Refusal; at: XY; message: string; sides: number[] } | null;
}>;

// --- plain geometry ---------------------------------------------------------------------------------------------------
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross3 = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const sgn = (n: number, eps: number) => (n > eps ? 1 : n < -eps ? -1 : 0);

/**
 * Do sides a→b and c→d cross? `touch` false: only a proper crossing counts (each straddles the other), so a corner
 * placed exactly on an earlier side or corner is allowed while drawing. `touch` true: touching counts too — the
 * finished-shape check for buildings, as fix/polygon.ts `isSelfIntersecting` does it (the roof engine needs a simple
 * ring).
 */
export function sidesCross(a: XY, b: XY, c: XY, d: XY, touch = false): boolean {
  const scale = Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - c[0], d[1] - c[1]));
  const eps = scale * 1e-12;
  const d1 = sgn(cross3(c, d, a), eps);
  const d2 = sgn(cross3(c, d, b), eps);
  const d3 = sgn(cross3(a, b, c), eps);
  const d4 = sgn(cross3(a, b, d), eps);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (!touch) return false;
  const on = (p: XY, q: XY, r: XY) =>
    Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

/** The earlier sides (by index i: corners[i]→corners[i+1]) that the side from the last corner to `next` crosses. */
export function crossingSides(corners: readonly XY[], next: XY): number[] {
  const n = corners.length;
  if (n < 2) return [];
  const a = corners[n - 1] as XY;
  const out: number[] = [];
  // The side just before (n-2 → n-1) shares the last corner: it can only fold back on itself, which is not a crossing.
  for (let i = 0; i < n - 2; i++) if (sidesCross(a, next, corners[i] as XY, corners[i + 1] as XY)) out.push(i);
  return out;
}

/** The sides of a closed ring that cross another, non-neighbouring side (both of each pair), or [] for a simple ring. */
export function ringCrossings(corners: readonly XY[], touch = false): number[] {
  const n = corners.length;
  if (n < 4) return [];
  const bad = new Set<number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the closing corner
      const a = corners[i] as XY;
      const b = corners[(i + 1) % n] as XY;
      const c = corners[j] as XY;
      const d = corners[(j + 1) % n] as XY;
      if (sidesCross(a, b, c, d, touch)) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  return [...bad].sort((x, y) => x - y);
}

/** Area (m²) of a ring, any winding. */
export function areaOf(corners: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i] as XY;
    const q = corners[(i + 1) % corners.length] as XY;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

/** Length (m) round a ring (closed) or along a path (open). */
export function edgeOf(corners: readonly XY[], closed: boolean): number {
  let s = 0;
  const n = corners.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) s += dist(corners[i] as XY, corners[(i + 1) % n] as XY);
  return s;
}

/** The nearest target corner within `reach`, else the nearest point on a target side within it. */
export function snapToTargets(at: XY, targets: Targets | undefined, reach: number): { at: XY; snap: 'corner' | 'edge' } | null {
  if (!targets) return null;
  let best: { d: number; at: XY } | null = null;
  for (const c of targets.corners ?? []) {
    const d = dist(at, c);
    if (d <= reach && (!best || d < best.d)) best = { d, at: [c[0], c[1]] };
  }
  if (best) return { at: best.at, snap: 'corner' };
  let edge: { d: number; at: XY } | null = null;
  for (const [a, b] of targets.edges ?? []) {
    const ab = sub(b, a);
    const len2 = ab[0] * ab[0] + ab[1] * ab[1];
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * ab[0] + (at[1] - a[1]) * ab[1]) / len2));
    const foot: XY = [a[0] + t * ab[0], a[1] + t * ab[1]];
    const d = dist(at, foot);
    if (d <= reach && (!edge || d < edge.d)) edge = { d, at: foot };
  }
  return edge ? { at: edge.at, snap: 'edge' } : null;
}

/**
 * Square to the first side (nza-estate's `snapRightAngle`, fix/polygon.ts, in metres): the frame is the first side;
 * the new corner goes along whichever frame axis, measured from the last corner, it is nearer. 'soft' only when it
 * is within SQUARE_DEG of that axis. Null when there is no frame yet, or 'soft' and the side is not near square.
 */
export function squareTo(corners: readonly XY[], at: XY, mode: Square): XY | null {
  if (mode === 'off' || corners.length < 2) return null;
  const a = corners[0] as XY;
  const b = corners[1] as XY;
  const len = dist(a, b);
  if (len < 1e-9) return null;
  const u: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const p: XY = [-u[1], u[0]];
  const from = corners[corners.length - 1] as XY;
  const d = sub(at, from);
  const along = d[0] * u[0] + d[1] * u[1];
  const across = d[0] * p[0] + d[1] * p[1];
  if (mode === 'soft') {
    const off = (Math.atan2(Math.min(Math.abs(along), Math.abs(across)), Math.max(Math.abs(along), Math.abs(across))) * 180) / Math.PI;
    if (off > SQUARE_DEG) return null;
  }
  return Math.abs(along) >= Math.abs(across)
    ? [from[0] + along * u[0], from[1] + along * u[1]]
    : [from[0] + across * p[0], from[1] + across * p[1]];
}

/**
 * Close square (nza-estate's `closeSquare`): the last corner, when it is within `tol` metres of the axis through the
 * first corner, is put on it, so a four-tap rectangle is square at all four corners. Free (Shift) corners stay put.
 */
export function closeSquare(corners: readonly XY[], free: readonly boolean[], tol: number): XY[] {
  const out = corners.map((c) => [c[0], c[1]] as XY);
  if (corners.length < 4 || free[corners.length - 1]) return out;
  const a = corners[0] as XY;
  const b = corners[1] as XY;
  const len = dist(a, b);
  if (len < 1e-9) return out;
  const u: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const p: XY = [-u[1], u[0]];
  const frame = (q: XY): XY => [(q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1], (q[0] - a[0]) * p[0] + (q[1] - a[1]) * p[1]];
  const last = corners.length - 1;
  const end = frame(corners[last] as XY);
  const prev = frame(corners[last - 1] as XY);
  const alongVaried = Math.abs(end[0] - prev[0]) >= Math.abs(end[1] - prev[1]);
  const off = alongVaried ? end[0] : end[1];
  if (Math.abs(off) > tol) return out;
  const f: XY = alongVaried ? [0, end[1]] : [end[0], 0];
  out[last] = [a[0] + f[0] * u[0] + f[1] * p[0], a[1] + f[0] * u[1] + f[1] * p[1]];
  return out;
}

/** A rectangle from its first side (a→b) and a third tap that says how deep it is. */
export function rectFrom(a: XY, b: XY, c: XY): XY[] | null {
  const len = dist(a, b);
  if (len < 1e-9) return null;
  const u: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const p: XY = [-u[1], u[0]];
  const depth = (c[0] - b[0]) * p[0] + (c[1] - b[1]) * p[1];
  if (Math.abs(depth) < 1e-9) return null;
  return [a, b, [b[0] + p[0] * depth, b[1] + p[1] * depth], [a[0] + p[0] * depth, a[1] + p[1] * depth]];
}

// --- the core ---------------------------------------------------------------------------------------------------------
export type CoreOpts = {
  kind: Kind;
  square: Square;
  /** Buildings: touching sides count as crossing in the finished shape (the roof engine needs a simple ring). */
  strictRing?: boolean;
};

export type DrawCore = ReturnType<typeof createDrawCore>;

export function createDrawCore(opts: CoreOpts) {
  const min = opts.kind === 'area' ? 3 : opts.kind === 'line' ? 2 : 1;
  const few: Refusal = opts.kind === 'line' ? 'few-line' : 'few';
  let now: Snap = { corners: [], free: [], raw: [], closed: false };
  let past: Snap[] = [];
  let future: Snap[] = [];
  let refused: CoreState['refused'] = null;
  /** A drag in Select: the shape before it, so one drag is one change, and a crossing drag goes back. */
  let dragFrom: Snap | null = null;
  const subs = new Set<() => void>();
  let cached: CoreState | null = null;

  const copy = (s: Snap): Snap => ({ corners: s.corners.map((c) => [c[0], c[1]] as XY), free: [...s.free], raw: s.raw.map((c) => [c[0], c[1]] as XY), closed: s.closed });
  const emit = () => {
    cached = null;
    subs.forEach((f) => f());
  };
  const commit = (next: Snap) => {
    past.push(now);
    if (past.length > 200) past.shift();
    future = [];
    now = next;
    refused = null;
    emit();
  };
  const refuse = (reason: Refusal, at: XY, sides: number[] = []): Outcome => {
    refused = { reason, at, message: REFUSAL[reason], sides };
    emit();
    return { kind: 'refused', reason, at, message: REFUSAL[reason], sides };
  };

  const finishCheck = (corners: readonly XY[]): number[] =>
    opts.kind === 'area' ? ringCrossings(corners, Boolean(opts.strictRing)) : [];

  /** Finish: the area closes (squared, and checked whole), the line ends. */
  function finish(mPerPx = 0): Outcome {
    if (now.closed) return { kind: 'finished', shape: now.corners.map((c) => [c[0], c[1]] as XY) };
    const last = (now.corners[now.corners.length - 1] ?? [0, 0]) as XY;
    if (now.corners.length < min) return refuse(few, last);
    const corners = opts.kind === 'area' && opts.square !== 'off' ? closeSquare(now.corners, now.free, SNAP_PX * mPerPx) : now.corners.map((c) => [c[0], c[1]] as XY);
    const bad = finishCheck(corners);
    if (bad.length) return refuse('cross', last, bad);
    commit({ corners, free: [...now.free], raw: now.raw.map((c) => [c[0], c[1]] as XY), closed: true });
    return { kind: 'finished', shape: corners.map((c) => [c[0], c[1]] as XY) };
  }

  /** A tap on the stage while drawing (D7: it places a corner, or it says why not). */
  function tap(at: XY, o: TapOpts): Outcome {
    if (now.closed) {
      // A new tap after a finished shape starts the next one (the shape itself was handed on by `finished`).
      past.push(now);
      future = [];
      now = { corners: [], free: [], raw: [], closed: false };
    }
    const n = now.corners.length;
    const px = Math.max(o.mPerPx, 1e-9);
    // The first half of a double-click: the same pixel as the last tap. Said, not swallowed.
    const lastRaw = now.raw[n - 1];
    if (lastRaw && dist(lastRaw, at) < px * 0.5) return { kind: 'repeat', at: [...(now.corners[n - 1] as XY)] as XY };
    if (opts.kind === 'point') {
      commit({ corners: [at], free: [Boolean(o.shift)], raw: [at], closed: true });
      return { kind: 'finished', shape: [at] };
    }
    // The first corner finishes an area, and only the first corner (D7).
    const first = now.corners[0];
    if (opts.kind === 'area' && first && n >= 1 && dist(first, at) <= CLOSE_PX * px) {
      if (n < min) return refuse(few, first);
      return finish(px);
    }
    let placed: XY = [at[0], at[1]];
    let snap: Snapped = 'free';
    if (!o.shift) {
      // Snap to something already there — another shape's corner or side — or to one of this shape's own corners
      // (not the last: that would be a corner on top of itself).
      const own = now.corners.slice(1, -1);
      const t = snapToTargets(at, { corners: [...(o.targets?.corners ?? []), ...own], edges: o.targets?.edges }, SNAP_PX * px);
      if (t) {
        placed = t.at;
        snap = t.snap;
      } else if (n >= 2) {
        const sq = squareTo(now.corners, at, opts.square);
        // Squared onto the last corner (a tap straight across the frame from it) is no side at all: the tap stands
        // where it was put instead, so it is never lost.
        if (sq && dist(sq, now.corners[n - 1] as XY) >= px * 0.5) {
          placed = sq;
          snap = 'square';
        }
      }
    }
    // A snap that lands exactly on the last corner would be a side of no length: keep the tap where it was.
    if (n && dist(placed, now.corners[n - 1] as XY) < 1e-9) {
      placed = [at[0], at[1]];
      snap = 'free';
    }
    const bad = crossingSides(now.corners, placed);
    if (bad.length) return refuse('cross', placed, bad);
    commit({
      corners: [...now.corners, placed],
      free: [...now.free, Boolean(o.shift) || snap === 'corner' || snap === 'edge'],
      raw: [...now.raw, [at[0], at[1]]],
      closed: false,
    });
    return { kind: 'placed', at: placed, snap, index: n };
  }

  /** Backspace: the last corner comes off (a shape being drawn), as a change Undo can give back. */
  function back(): boolean {
    if (now.closed || !now.corners.length) return false;
    commit({ corners: now.corners.slice(0, -1), free: now.free.slice(0, -1), raw: now.raw.slice(0, -1), closed: false });
    return true;
  }

  // --- Select: a finished shape's corners, sides and the whole shape --------------------------------------------------
  /** Put a finished shape in hand to edit (the boundary as found, a building being reshaped). Not a change. */
  function load(corners: readonly XY[], closed = true) {
    now = { corners: corners.map((c) => [c[0], c[1]] as XY), free: corners.map(() => true), raw: corners.map((c) => [c[0], c[1]] as XY), closed };
    past = [];
    future = [];
    refused = null;
    dragFrom = null;
    emit();
  }

  const live = (corners: XY[]) => {
    now = { ...now, corners, raw: corners.map((c) => [c[0], c[1]] as XY), free: corners.map(() => true) };
    const bad = finishCheck(corners);
    refused = bad.length ? { reason: 'cross', at: corners[0] as XY, message: REFUSAL.cross, sides: bad } : null;
    emit();
  };

  /** A drag begins: a corner (`corner`), a side's middle (`side`: a corner is added there), or the whole shape. */
  function dragStart(): void {
    dragFrom = copy(now);
  }
  function dragCorner(i: number, at: XY): void {
    if (!dragFrom) dragStart();
    const corners = now.corners.map((c, j) => (j === i ? ([at[0], at[1]] as XY) : ([c[0], c[1]] as XY)));
    live(corners);
  }
  /** A side's middle pulled out: a new corner after corner `i`. Returns the new corner's index, to drag on. */
  function insertCorner(i: number, at: XY): number {
    if (!dragFrom) dragStart();
    const corners = now.corners.map((c) => [c[0], c[1]] as XY);
    corners.splice(i + 1, 0, [at[0], at[1]]);
    live(corners);
    return i + 1;
  }
  function moveBy(d: XY): void {
    if (!dragFrom) dragStart();
    const base = dragFrom as Snap;
    live(base.corners.map((c) => [c[0] + d[0], c[1] + d[1]] as XY));
  }
  /** The drag ends: kept as one change, or — if it left the sides crossing — put back, and said. */
  function dragEnd(): Outcome | null {
    const from = dragFrom;
    dragFrom = null;
    if (!from) return null;
    const bad = finishCheck(now.corners);
    if (bad.length) {
      const at = now.corners[bad[0] as number] as XY;
      now = from;
      return refuse('cross', at, bad);
    }
    const next = now;
    now = from;
    commit(next);
    return { kind: 'finished', shape: next.corners.map((c) => [c[0], c[1]] as XY) };
  }
  /** Delete a corner of a finished shape (Delete or Backspace on a chosen corner). */
  function removeCorner(i: number): Outcome | null {
    if (now.corners.length <= min) return refuse(few, now.corners[i] as XY);
    const corners = now.corners.filter((_, j) => j !== i).map((c) => [c[0], c[1]] as XY);
    const bad = finishCheck(corners);
    if (bad.length) return refuse('cross', now.corners[i] as XY, bad);
    commit({ ...now, corners, raw: corners.map((c) => [c[0], c[1]] as XY), free: corners.map(() => true) });
    return { kind: 'finished', shape: corners };
  }

  // --- undo / redo: whole changes -------------------------------------------------------------------------------------
  function undo(): boolean {
    const prev = past.pop();
    if (!prev) return false;
    future.push(now);
    now = prev;
    refused = null;
    emit();
    return true;
  }
  function redo(): boolean {
    const next = future.pop();
    if (!next) return false;
    past.push(now);
    now = next;
    refused = null;
    emit();
    return true;
  }
  /** Start again with nothing in hand (Esc while drawing, or a new shape). */
  function clear(): void {
    if (!now.corners.length && !now.closed) return;
    commit({ corners: [], free: [], raw: [], closed: false });
  }
  /** Forget everything, history too (the tool is put down). */
  function reset(): void {
    now = { corners: [], free: [], raw: [], closed: false };
    past = [];
    future = [];
    refused = null;
    dragFrom = null;
    emit();
  }
  function rect(a: XY, b: XY, c: XY): Outcome {
    const r = rectFrom(a, b, c);
    if (!r) return refuse(few, c);
    commit({ corners: r, free: r.map(() => true), raw: r, closed: true });
    return { kind: 'finished', shape: r.map((p) => [p[0], p[1]] as XY) };
  }

  const state = (): CoreState =>
    (cached ??= {
      kind: opts.kind,
      corners: now.corners,
      free: now.free,
      closed: now.closed,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      refused,
    });

  return {
    opts,
    state,
    tap,
    finish,
    back,
    load,
    dragStart,
    dragCorner,
    insertCorner,
    moveBy,
    dragEnd,
    removeCorner,
    undo,
    redo,
    clear,
    reset,
    rect,
    /** Clear the red warning (the pointer moved on). */
    calm() {
      if (refused && !dragFrom) {
        refused = null;
        emit();
      }
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}
