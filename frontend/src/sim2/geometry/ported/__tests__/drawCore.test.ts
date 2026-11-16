// PORTED from nza-hq/nza-decoded, src/twin/app/draw/core.test.ts (imports re-pointed only).
// Brief 101 P1: the one drawing core's rules (D2) and Linzie's rule (D7): every tap places a corner or says why not.
import { describe, expect, it } from 'vitest';
import {
  CLOSE_PX,
  REFUSAL,
  SNAP_PX,
  type XY,
  areaOf,
  closeSquare,
  createDrawCore,
  crossingSides,
  edgeOf,
  rectFrom,
  ringCrossings,
  sidesCross,
  squareTo,
} from '../drawCore';

const px = 0.1; // 10 cm a pixel
const free = { mPerPx: px };

describe('the crossing check', () => {
  it('counts a proper crossing, and touching only when asked', () => {
    expect(sidesCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(sidesCross([0, 0], [10, 0], [5, 0], [5, 5])).toBe(false);
    expect(sidesCross([0, 0], [10, 0], [5, 0], [5, 5], true)).toBe(true);
    expect(sidesCross([0, 0], [10, 0], [0, 1], [10, 1], true)).toBe(false);
  });
  it('checks only the side just drawn, never the provisional closing side (#165)', () => {
    // A deep concave notch: the side back to the first corner would cross, but that side is not drawn yet.
    const notch: XY[] = [[0, 0], [100, 0], [100, 100], [50, 100], [50, 20]];
    expect(crossingSides(notch, [40, 20])).toEqual([]);
    expect(crossingSides([[0, 0], [10, 0], [10, 10]], [5, -5])).toEqual([0]);
  });
  it('finds both sides of a crossing in a closed ring', () => {
    expect(ringCrossings([[0, 0], [10, 10], [10, 0], [0, 10]])).toEqual([0, 2]);
    expect(ringCrossings([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([]);
  });
});

describe('square to the first side (nza-estate rules, in metres)', () => {
  it('strict: every side from the third corner lands on the frame', () => {
    expect(squareTo([[0, 0], [10, 0]], [10.4, 7], 'strict')).toEqual([10, 7]);
  });
  it('soft: only near square; any other angle is left alone', () => {
    expect(squareTo([[0, 0], [10, 0]], [10.4, 7], 'soft')).toEqual([10, 7]);
    expect(squareTo([[0, 0], [10, 0]], [15, 7], 'soft')).toBeNull();
    expect(squareTo([[0, 0], [10, 0]], [15, 7], 'off')).toBeNull();
  });
  it('closes square when the last corner is within reach of the first corner’s axis', () => {
    const out = closeSquare([[0, 0], [10, 0], [10, 6], [0.4, 6]], [false, false, false, false], 1);
    expect(out[3]).toEqual([0, 6]);
    expect(closeSquare([[0, 0], [10, 0], [10, 6], [0.4, 6]], [false, false, false, true], 1)[3]).toEqual([0.4, 6]);
  });
  it('a rectangle from a side and a depth', () => {
    expect(rectFrom([0, 0], [10, 0], [3, 4])).toEqual([[0, 0], [10, 0], [10, 4], [0, 4]]);
  });
  it('area and edge', () => {
    expect(areaOf([[0, 0], [10, 0], [10, 4], [0, 4]])).toBe(40);
    expect(edgeOf([[0, 0], [10, 0], [10, 4], [0, 4]], true)).toBe(28);
    expect(edgeOf([[0, 0], [10, 0], [10, 4]], false)).toBe(14);
  });
});

describe('D7: click freely, never refuse in silence', () => {
  it('places every tap: concave, spiky, thin, tiny, corners 3 px apart', () => {
    const c = createDrawCore({ kind: 'area', square: 'soft' });
    const taps: XY[] = [[0, 0], [100, 0], [100, 100], [60, 100], [60, 5], [55, 5], [55, 100], [0, 100], [0, 50], [0.3, 50.3], [0.6, 50]];
    for (const t of taps) expect(c.tap(t, free).kind).toBe('placed');
    expect(c.state().corners).toHaveLength(taps.length);
    expect(c.finish(px).kind).toBe('finished');
  });
  it('a crossing side is refused with the words, and the sides it crosses', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.tap([0, 0], free);
    c.tap([10, 0], free);
    c.tap([10, 10], free);
    const o = c.tap([5, -5], free);
    expect(o).toMatchObject({ kind: 'refused', reason: 'cross', message: REFUSAL.cross, sides: [0] });
    expect(c.state().refused?.message).toBe('Those lines cross. Move the corner.');
    expect(c.state().corners).toHaveLength(3);
  });
  it('the first corner with under three corners says so', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.tap([0, 0], free);
    c.tap([10, 0], free);
    const o = c.tap([0.5, 0.5], free);
    expect(o).toMatchObject({ kind: 'refused', reason: 'few', message: 'Add at least 3 corners first.' });
    expect(c.finish(px)).toMatchObject({ kind: 'refused', reason: 'few' });
  });
  it('the first corner finishes; a tap near any other corner snaps onto it and never finishes', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    for (const t of [[0, 0], [10, 0], [10, 10], [5, 12], [0, 10]] as XY[]) c.tap(t, free);
    const near = c.tap([10.5, 10.3], free); // within 12 px of corner 2
    expect(near).toMatchObject({ kind: 'placed', snap: 'corner', at: [10, 10] });
    c.undo();
    const done = c.tap([(CLOSE_PX - 1) * px, 0], free);
    expect(done.kind).toBe('finished');
    expect(c.state().closed).toBe(true);
  });
  it('an exact repeat of the last tap (a double-click) is the one tap dropped, and it says so', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.tap([0, 0], free);
    c.tap([20, 0], free);
    expect(c.tap([20, 0], free).kind).toBe('repeat');
    expect(c.tap([20.3, 0], free).kind).toBe('placed'); // 3 px apart is a corner
  });
  it('a square snap that would land on the last corner keeps the tap where it was', () => {
    const c = createDrawCore({ kind: 'area', square: 'strict' });
    c.tap([0, 0], free);
    c.tap([10, 0], free);
    c.tap([10, 10], free);
    // Exactly diagonal from the last corner: along = across; strict picks along, never a zero side.
    const o = c.tap([10, 10 + 2 * px], free);
    expect(o.kind).toBe('placed');
  });
  it('finishing a crossing shape refuses, with the crossing sides', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    for (const t of [[0, 0], [10, 0], [10, 10], [2, 10], [2, 3], [8, 3], [8, 8]] as XY[]) expect(c.tap(t, free).kind).toBe("placed");
    const o = c.finish(px);
    expect(o).toMatchObject({ kind: 'refused', reason: 'cross' });
    expect((o as { sides: number[] }).sides.length).toBeGreaterThan(0);
    expect(c.state().closed).toBe(false);
  });
  it('Shift places a corner at any angle with no snapping', () => {
    const c = createDrawCore({ kind: 'area', square: 'strict' });
    c.tap([0, 0], free);
    c.tap([10, 0], free);
    expect(c.tap([13, 7], { mPerPx: px, shift: true })).toMatchObject({ kind: 'placed', at: [13, 7], snap: 'free' });
  });
  it('snaps to a corner, then a side, of something already there (12 px)', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    const targets = { corners: [[50, 50]] as XY[], edges: [[[0, 20], [100, 20]]] as [XY, XY][] };
    expect(c.tap([50.5, 50.5], { mPerPx: px, targets })).toMatchObject({ snap: 'corner', at: [50, 50] });
    expect(c.tap([30, 20 + (SNAP_PX - 1) * px], { mPerPx: px, targets })).toMatchObject({ snap: 'edge', at: [30, 20] });
  });
});

describe('Backspace, Undo and Redo', () => {
  it('Backspace takes back a corner; Undo gives it back; Redo takes it again', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.tap([0, 0], free);
    c.tap([10, 0], free);
    expect(c.back()).toBe(true);
    expect(c.state().corners).toHaveLength(1);
    c.undo();
    expect(c.state().corners).toHaveLength(2);
    c.redo();
    expect(c.state().corners).toHaveLength(1);
  });
  it('a finished shape can be undone back to drawing', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    for (const t of [[0, 0], [10, 0], [10, 10]] as XY[]) c.tap(t, free);
    c.finish(px);
    c.undo();
    expect(c.state().closed).toBe(false);
    expect(c.state().corners).toHaveLength(3);
  });
});

describe('Select: drag a corner, a side, the whole shape', () => {
  const square: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it('a corner drag is one change', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.load(square);
    c.dragCorner(2, [12, 12]);
    c.dragCorner(2, [14, 14]);
    expect(c.dragEnd()?.kind).toBe('finished');
    expect(c.state().corners[2]).toEqual([14, 14]);
    c.undo();
    expect(c.state().corners[2]).toEqual([10, 10]);
  });
  it('a side pulled out adds a corner; the whole shape moves', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.load(square);
    const i = c.insertCorner(0, [5, -3]);
    expect(i).toBe(1);
    c.dragEnd();
    expect(c.state().corners).toHaveLength(5);
    c.moveBy([1, 1]);
    c.dragEnd();
    expect(c.state().corners[0]).toEqual([1, 1]);
  });
  it('a drag that leaves the sides crossing goes back, and says so', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.load(square);
    c.dragCorner(0, [20, 5]);
    expect(c.state().refused?.reason).toBe('cross');
    expect(c.dragEnd()).toMatchObject({ kind: 'refused', reason: 'cross' });
    expect(c.state().corners[0]).toEqual([0, 0]);
  });
  it('a corner cannot come off a triangle, and says so', () => {
    const c = createDrawCore({ kind: 'area', square: 'off' });
    c.load([[0, 0], [10, 0], [10, 10]]);
    expect(c.removeCorner(0)).toMatchObject({ kind: 'refused', reason: 'few' });
  });
});

describe('lines and points', () => {
  it('a line needs two points and Done; a point is one tap', () => {
    const l = createDrawCore({ kind: 'line', square: 'off' });
    l.tap([0, 0], free);
    expect(l.finish(px)).toMatchObject({ kind: 'refused', message: 'Add at least 2 points first.' });
    l.tap([10, 0], free);
    expect(l.finish(px).kind).toBe('finished');
    const p = createDrawCore({ kind: 'point', square: 'off' });
    expect(p.tap([3, 4], free)).toEqual({ kind: 'finished', shape: [[3, 4]] });
  });
});
