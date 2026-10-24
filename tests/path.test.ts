import { describe, it, expect } from 'vitest';
import { Path } from '../src/core/path';
import { buildSplineTrack, TRACK_CONTROL_POINTS } from '../src/core/procedures';

describe('参考路径', () => {
  const p = Path.fromFunction(0, 100, () => 0, 1);

  it('投影里程与横向偏差（左正）', () => {
    const r = p.project(30.5, 2);
    expect(r.s).toBeCloseTo(30.5, 6);
    expect(r.e).toBeCloseTo(2, 6);
    expect(p.project(10, -1.5).e).toBeCloseTo(-1.5, 6);
  });

  it('末端沿切线外延', () => {
    const q = p.pointAt(110);
    expect(q.x).toBeCloseTo(110, 6);
    expect(q.y).toBeCloseTo(0, 6);
  });

  it('闭合赛道首尾相接、里程回绕', () => {
    const t = buildSplineTrack(TRACK_CONTROL_POINTS, 1);
    const a = t.pointAt(0), b = t.pointAt(t.length);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
    const c = t.pointAt(t.length + 10), d = t.pointAt(10);
    expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeLessThan(1e-6);
    expect(t.length).toBeGreaterThan(1000);
  });
});
