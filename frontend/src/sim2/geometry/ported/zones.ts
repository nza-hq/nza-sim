// PORTED from nza-hq/nza-decoded @ e5174c5, src/twin/app/inside/zones.ts (decodED's zone cut tool, Brief 241), with
// the three helpers it took from inside/sample.ts (area, axisOf, ccw) inlined below, and clipToOutline left out (it
// needs polygon-clipping, which NZA Sim does not ship). Otherwise verbatim below the line.
// Both repos are Net Zero Advisory's own (decodED is UNLICENSED/private, same owner): no licence question.
// ---------------------------------------------------------------------------------------------------------------------
// decodED's own — not copied, not overwritten by scripts/sync-twin.mjs. Brief 241 (zones in the floor plan editor).
//
// ZONES: a floor cut into parts (wings, a hall) before its corridors and rooms are laid out, so each part can be laid
// out square to itself (Linzie, 7 Nov 15:46: "trying to draw a corridor in the shape of a building like this just
// starts creating these mad, mad-shaped classrooms"). A cut is a straight line between two points on the outside wall
// (or on a zone line already drawn); it splits the one zone both points sit on into two. Three ways to place it:
//   - corner to corner: both ends snap to corners;
//   - square off a wall: the first tap on a wall (or a corner), the line runs at 90° from that wall to the far side,
//     so it works on a building that is not square to anything;
//   - free line: both ends anywhere on a wall, snapping to a corner when near one.
// Everything is in metres around the building's middle (scene.ts XY), any winding in, anticlockwise out.
//
// Imports: ./sample.ts (area, axisOf, ccw), ./scene.ts (XY).
export type XY = [number, number];
export function area(r: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as XY;
    const q = r[(i + 1) % r.length] as XY;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
export function axisOf(ring: readonly XY[]): XY {
  let best = 0;
  let ax: XY = [1, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XY;
    const b = ring[(i + 1) % ring.length] as XY;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) {
      best = len;
      ax = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    }
  }
  return ax;
}
export const ccw = (r: readonly XY[]): XY[] => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as XY;
    const q = r[(i + 1) % r.length] as XY;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...r].reverse() : [...r];
};

export type ZoneWay = 'corner' | 'square' | 'free';
export const ZONE_WAYS: ReadonlyArray<{ key: ZoneWay; name: string }> = [
  { key: 'corner', name: 'Corner to corner' },
  { key: 'square', name: 'Square off a wall' },
  { key: 'free', name: 'Free line' },
];
/** The smallest zone a cut may make, m². */
export const ZONE_MIN_M2 = 8;
/** The zones' colours, in order (quiet fills, a darker line): blue, green, lilac, rose, then round again. */
export const ZONE_TINTS: ReadonlyArray<{ fill: string; line: string }> = [
  { fill: '#CFE1EF', line: '#4F86B3' },
  { fill: '#D3EAD6', line: '#4E9A62' },
  { fill: '#E4DAF1', line: '#8466B3' },
  { fill: '#F4D8DE', line: '#B65B73' },
  { fill: '#D6EBEC', line: '#3F8F94' },
  { fill: '#ECE3CC', line: '#8E7A3F' },
];
export const zoneTint = (i: number) => ZONE_TINTS[i % ZONE_TINTS.length] as (typeof ZONE_TINTS)[number];

const EPS = 0.05;
const d2 = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The nearest point to `p` on the segment a→b, and how far along it is (0 … 1). */
function onSeg(p: XY, a: XY, b: XY): { q: XY; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return { q: [a[0] + dx * t, a[1] + dy * t], t };
}

/** Is `p` inside the ring (even-odd)? */
export function inside(ring: readonly XY[], p: XY): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as XY;
    const b = ring[j] as XY;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Which zone `p` is in (-1 for none). */
export function zoneAt(zones: readonly (readonly XY[])[], p: XY): number {
  return zones.findIndex((z) => inside(z, p));
}

/** A point on a zone's edge: where, on which zone and edge, and whether it is a corner. */
export type Hit = { p: XY; zone: number; edge: number; corner: boolean };

/** The nearest point on any zone's edge within `maxM`, or null. A corner within `cornerM` wins. With `cornersOnly`,
 *  only corners count (corner to corner). */
export function nearestEdge(zones: readonly (readonly XY[])[], p: XY, maxM: number, cornerM: number, cornersOnly = false): Hit | null {
  const reach = cornersOnly ? maxM : cornerM;
  let corner: Hit | null = null;
  let cd = Infinity;
  zones.forEach((z, zi) =>
    z.forEach((c, i) => {
      const d = d2(p, c);
      if (d <= reach && d < cd) {
        cd = d;
        corner = { p: c, zone: zi, edge: i, corner: true };
      }
    }),
  );
  if (corner || cornersOnly) return corner;
  let best: Hit | null = null;
  let bd = Infinity;
  zones.forEach((z, zi) =>
    z.forEach((a, i) => {
      const { q } = onSeg(p, a, z[(i + 1) % z.length] as XY);
      const d = d2(p, q);
      if (d <= maxM && d < bd) {
        bd = d;
        best = { p: q, zone: zi, edge: i, corner: false };
      }
    }),
  );
  return best;
}

/** Does `p` lie on the ring's edge? The edge index, or -1. */
function edgeOf(ring: readonly XY[], p: XY): number {
  let best = -1;
  let bd = EPS;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] as XY;
    const d = d2(p, onSeg(p, a, b).q);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Where the ray from `from` along `dir` first meets the ring's edge (ignoring the first 0.2 m), or null. */
export function rayHit(ring: readonly XY[], from: XY, dir: XY): XY | null {
  let best: XY | null = null;
  let bt = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XY;
    const b = ring[(i + 1) % ring.length] as XY;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / den;
    const s = ((a[0] - from[0]) * dir[1] - (a[1] - from[1]) * dir[0]) / den;
    if (t > 0.2 && s >= -1e-9 && s <= 1 + 1e-9 && t < bt) {
      bt = t;
      best = [from[0] + dir[0] * t, from[1] + dir[1] * t];
    }
  }
  return best;
}

/** Square off a wall: from a point on a zone's edge, the line at 90° to that wall, across the zone to its far side.
 *  At a corner there are two walls; the one whose square line points nearer `toward` is used. */
export function squareCut(zones: readonly (readonly XY[])[], from: Hit, toward: XY | null): XY | null {
  const z = ccw(zones[from.zone] ?? []);
  if (z.length < 3) return null;
  // The edge(s) the point is on, in the anticlockwise ring.
  const edges: number[] = [];
  z.forEach((a, i) => {
    const b = z[(i + 1) % z.length] as XY;
    if (d2(from.p, onSeg(from.p, a, b).q) <= EPS) edges.push(i);
  });
  const ends: XY[] = [];
  for (const i of edges) {
    const a = z[i] as XY;
    const b = z[(i + 1) % z.length] as XY;
    const L = d2(a, b) || 1;
    // Inward, for an anticlockwise ring: the wall's left.
    const n: XY = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    const hit = rayHit(z, from.p, n);
    if (hit && insideChord(z, from.p, hit)) ends.push(hit);
  }
  if (!ends.length) return null;
  if (!toward || ends.length === 1) return ends[0] as XY;
  const v: XY = [toward[0] - from.p[0], toward[1] - from.p[1]];
  const score = (e: XY) => ((e[0] - from.p[0]) * v[0] + (e[1] - from.p[1]) * v[1]) / (d2(from.p, e) || 1);
  return ends.reduce((p, q) => (score(q) > score(p) ? q : p));
}

/** Is the straight line a→b inside the ring all the way (its middle inside, crossing no edge)? */
function insideChord(ring: readonly XY[], a: XY, b: XY): boolean {
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!inside(ring, m)) return false;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as XY;
    const q = ring[(i + 1) % ring.length] as XY;
    if (crosses(a, b, p, q)) return false;
  }
  return true;
}
/** Do a→b and p→q cross properly (not just touch at an end)? */
function crosses(a: XY, b: XY, p: XY, q: XY): boolean {
  const o = (x: XY, y: XY, z: XY) => (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
  const d1 = o(p, q, a);
  const d2_ = o(p, q, b);
  const d3 = o(a, b, p);
  const d4 = o(a, b, q);
  const tol = 1e-6 * (1 + Math.abs(d1) + Math.abs(d2_) + Math.abs(d3) + Math.abs(d4));
  return ((d1 > tol && d2_ < -tol) || (d1 < -tol && d2_ > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol));
}

/** Split one ring by the straight line a→b (both on its edge): the two parts, anticlockwise, or why not. */
export function splitRing(ring: readonly XY[], a: XY, b: XY): [XY[], XY[]] | { why: string } {
  const r = ccw(ring);
  if (d2(a, b) < 1) return { why: 'Tap further along the wall' };
  const ea = edgeOf(r, a);
  const eb = edgeOf(r, b);
  if (ea < 0 || eb < 0) return { why: 'Both ends go on a wall' };
  if (!insideChord(r, a, b)) return { why: 'The line has to stay inside the building' };
  // The ring with a and b put in on their edges (a corner is used as it is).
  type P = { p: XY; tag?: 'a' | 'b' };
  const seq: P[] = [];
  const put = (p: XY, tag: 'a' | 'b') => {
    const at = seq.find((x) => d2(x.p, p) < EPS);
    if (at) at.tag = tag;
    else seq.push({ p, tag });
  };
  r.forEach((c, i) => {
    seq.push({ p: c });
    const next = r[(i + 1) % r.length] as XY;
    const here = [
      ...(i === ea ? [{ p: a, tag: 'a' as const }] : []),
      ...(i === eb ? [{ p: b, tag: 'b' as const }] : []),
    ].sort((x, y) => d2(c, x.p) - d2(c, y.p));
    for (const h of here) {
      if (d2(h.p, next) < EPS) continue; // on the next corner: tagged when that corner comes
      put(h.p, h.tag);
    }
  });
  // A point that sat on the next corner: tag it.
  for (const [p, tag] of [[a, 'a'], [b, 'b']] as const) if (!seq.some((x) => x.tag === tag)) {
    const at = seq.find((x) => d2(x.p, p) < EPS);
    if (at) at.tag = tag;
  }
  const ia = seq.findIndex((x) => x.tag === 'a');
  const ib = seq.findIndex((x) => x.tag === 'b');
  if (ia < 0 || ib < 0 || ia === ib) return { why: 'Both ends go on a wall' };
  const walk = (from: number, to: number) => {
    const out: XY[] = [];
    for (let i = from; ; i = (i + 1) % seq.length) {
      out.push((seq[i] as P).p);
      if (i === to) break;
    }
    return out;
  };
  const p1 = walk(ia, ib);
  const p2 = walk(ib, ia);
  if (p1.length < 3 || p2.length < 3) return { why: 'That line runs along a wall' };
  if (area(p1) < ZONE_MIN_M2 || area(p2) < ZONE_MIN_M2) return { why: 'That would make a very small zone' };
  return [ccw(p1), ccw(p2)];
}

/** Cut the zone both points sit on: the zones after the cut (the cut zone's two parts in its place), or why not. */
export function cutZones(zones: readonly (readonly XY[])[], a: XY, b: XY): { zones: XY[][]; at: number } | { why: string } {
  let why = 'Both ends go on the same zone';
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i] as XY[];
    if (edgeOf(z, a) < 0 || edgeOf(z, b) < 0) continue;
    const s = splitRing(z, a, b);
    if ('why' in s) {
      why = s.why;
      continue;
    }
    return { zones: [...zones.slice(0, i).map((x) => [...x]), s[0], s[1], ...zones.slice(i + 1).map((x) => [...x])], at: i };
  }
  return { why };
}

/** A zone's own square: its longest wall that is on the building's outside wall (a cut line is not a wall to be
 *  square to), else its longest side. */
export function zoneAxis(zone: readonly XY[], shell: readonly XY[]): XY {
  const z = ccw(zone);
  let best = 0;
  let ax: XY | null = null;
  z.forEach((a, i) => {
    const b = z[(i + 1) % z.length] as XY;
    const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = d2(a, b);
    if (len > best && edgeOf(shell, m) >= 0) {
      best = len;
      ax = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    }
  });
  return ax ?? axisOf(z);
}

/** The lines between zones (each shared stretch of edge once), for drawing. */
export function zoneLines(zones: readonly (readonly XY[])[], shell: readonly XY[]): Array<[XY, XY]> {
  const out: Array<[XY, XY]> = [];
  for (const z of zones) {
    z.forEach((a, i) => {
      const b = z[(i + 1) % z.length] as XY;
      const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (edgeOf(shell, m) >= 0) return;
      if (out.some(([p, q]) => (d2(p, b) < EPS && d2(q, a) < EPS) || (d2(p, a) < EPS && d2(q, b) < EPS))) return;
      out.push([a, b]);
    });
  }
  return out;
}

/** Where a zone's label goes: the middle of its biggest square-ish part (its centroid, pulled inside if need be). */
export function labelAt(zone: readonly XY[]): XY {
  const z = ccw(zone);
  let a = 0;
  let cx = 0;
  let cy = 0;
  z.forEach((p, i) => {
    const q = z[(i + 1) % z.length] as XY;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  });
  const c: XY = a ? [cx / (3 * a), cy / (3 * a)] : (z[0] ?? [0, 0]);
  if (inside(z, c)) return c;
  // Concave: the middle of the longest across-line through the centroid's height.
  const xs: number[] = [];
  z.forEach((p, i) => {
    const q = z[(i + 1) % z.length] as XY;
    if (p[1] > c[1] !== q[1] > c[1]) xs.push(p[0] + ((c[1] - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
  });
  xs.sort((x, y) => x - y);
  let bx = c[0];
  let bw = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) if ((xs[i + 1] as number) - (xs[i] as number) > bw) {
    bw = (xs[i + 1] as number) - (xs[i] as number);
    bx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
  }
  return [bx, c[1]];
}


/** Brief 244: the part of `parts` a tap at `p` is in (a floor's shape: tap the part to keep), or -1. */
export function partAt(parts: readonly XY[][], p: XY): number {
  return parts.findIndex((r) => inside(r, p));
}
