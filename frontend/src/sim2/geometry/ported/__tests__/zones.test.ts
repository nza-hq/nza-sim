// PORTED from nza-hq/nza-decoded, src/twin/app/inside/zones.test.ts (imports re-pointed; clipToOutline cases dropped with the function).
// Brief 241: cutting a floor into zones.
import { describe, expect, it } from 'vitest';
import { area } from '../zones';
import type { XY } from '../zones';
import { cutZones, labelAt, nearestEdge, partAt, splitRing, squareCut, zoneAxis, zoneLines } from '../zones';

// An L: a 40 × 10 bar with a 10 × 20 wing up from its right end.
const L: XY[] = [[0, 0], [40, 0], [40, 30], [30, 30], [30, 10], [0, 10]];
const turn = (r: XY[], deg: number): XY[] => {
  const a = (deg * Math.PI) / 180;
  return r.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as XY);
};

describe('zones', () => {
  it('corner to corner splits the L into its bar and its wing, nothing lost', () => {
    const r = cutZones([L], [30, 10], [40, 10]);
    expect('why' in r).toBe(false);
    if ('why' in r) return;
    expect(r.zones).toHaveLength(2);
    const areas = r.zones.map(area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(200, 6);
    expect(areas[1]).toBeCloseTo(400, 6);
  });
  it('a free line from wall to wall, mid-edge both ends', () => {
    const r = cutZones([L], [12, 0], [12, 10]);
    if ('why' in r) throw new Error(r.why);
    expect(r.zones.map(area).reduce((a, b) => a + b, 0)).toBeCloseTo(area(L), 6);
  });
  it('a second cut goes in the zone both ends are on', () => {
    const one = cutZones([L], [30, 10], [40, 10]);
    if ('why' in one) throw new Error(one.why);
    const two = cutZones(one.zones, [15, 0], [15, 10]);
    if ('why' in two) throw new Error(two.why);
    expect(two.zones).toHaveLength(3);
    expect(two.zones.map(area).sort((a, b) => a - b)).toEqual([150, 200, 250].map((x) => expect.closeTo(x, 6)));
  });
  it('says why not: outside the building, along a wall, too small', () => {
    expect(splitRing(L, [0, 10], [30, 30])).toEqual({ why: 'The line has to stay inside the building' });
    expect(splitRing(L, [5, 0], [20, 0])).toHaveProperty('why');
    expect(splitRing(L, [0, 0.4], [0.4, 0])).toHaveProperty('why');
  });
  it('square off a wall works on a skewed building: the line is at 90° to the wall it starts on', () => {
    const S = turn(L, 23);
    const hit = nearestEdge([S], turn([[12, 0.3]], 23)[0] as XY, 2, 0.5);
    expect(hit).not.toBeNull();
    const end = squareCut([S], hit as NonNullable<typeof hit>, null) as XY;
    const want = turn([[12, 10]], 23)[0] as XY;
    expect(end[0]).toBeCloseTo(want[0], 6);
    expect(end[1]).toBeCloseTo(want[1], 6);
  });
  it('at a corner, square off picks the wall whose line points the way you move', () => {
    const hit = nearestEdge([L], [30.2, 10.1], 2, 1)!;
    expect(hit.corner).toBe(true);
    // Toward the far side of the wing (east) or down across the bar (south).
    expect(squareCut([L], hit, [39, 10])).toEqual([40, 10]);
    expect(squareCut([L], hit, [30, 1])).toEqual([30, 0]);
  });
  it('corner to corner only snaps to corners', () => {
    expect(nearestEdge([L], [20, 0.2], 3, 1, true)).toBeNull();
    expect(nearestEdge([L], [39, 1], 3, 1, true)?.p).toEqual([40, 0]);
  });
  it("a zone's square is its longest outside wall, not the cut line", () => {
    const cut = cutZones([L], [30, 10], [40, 10]);
    if ('why' in cut) throw new Error(cut.why);
    const wing = cut.zones.find((z) => Math.abs(area(z) - 200) < 1) as XY[];
    const ax = zoneAxis(wing, L);
    expect(Math.abs(ax[0])).toBeCloseTo(0, 6);
    expect(zoneLines(cut.zones, L)).toHaveLength(1);
  });
  it('a label sits inside even a concave zone', () => {
    const [x, y] = labelAt(L);
    expect(x > 0 && x < 40 && y > 0 && y < 30).toBe(true);
  });
  // Brief 244: a floor half the size of the one below (Linzie: "the ground floor is rectangular, and the second floor
  // is half of that rectangle"): the same cut, then a tap on the part to keep.
  it('a floor cut to half: the same cut, a tap keeps a part, zones cut to it', () => {
    const R: XY[] = [[0, 0], [40, 0], [40, 10], [0, 10]];
    const cut = cutZones([R], [20, 0], [20, 10]);
    if ('why' in cut) throw new Error(cut.why);
    const k = partAt(cut.zones, [30, 5]);
    expect(k).toBeGreaterThanOrEqual(0);
    const half = cut.zones[k] as XY[];
    expect(area(half)).toBeCloseTo(200, 6);
  });
});
