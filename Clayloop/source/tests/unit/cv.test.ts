import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../src/cv/segment';
import { TemporalFilter, detrendedStats } from '../../src/cv/temporal';
import { detectEvents } from '../../src/cv/events';
import { DEFAULT_CALIBRATION, Calibration, Sample } from '../../src/cv/types';

const W = 128, H = 128;
const cal: Calibration = {
  ...DEFAULT_CALIBRATION,
  roi: { x: 0, y: 0, w: 1, h: 1 }, axisX: 0.5, baseY: 0.9,
  clayColor: { r: 170, g: 140, b: 115 }, backdropColor: { r: 40, g: 40, b: 42 },
};

/** Synthetic side view: dome-shaped clay, centre shifted by `dx` px, with rotating texture stripes of phase `phase`. */
function frame(dx: number, phase = 0, opts: { hand?: boolean; noise?: number } = {}): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  const base = Math.round(0.9 * (H - 1));
  const top = 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    let r = 40, g = 40, b = 42;
    if (y >= top && y <= base) {
      const u = (y - top) / (base - top); // 0 top .. 1 bottom
      const radius = 14 + 22 * Math.sqrt(u);
      const cx = 63.5 + dx * (1 - u * 0.6);
      if (Math.abs(x - cx) <= radius) {
        // texture that rotates with the wheel: stripes in angle -> projected x
        const s = Math.asin(Math.max(-1, Math.min(1, (x - cx) / radius)));
        const stripe = Math.sin(s * 6 + phase) * 12;
        r = 170 + stripe; g = 140 + stripe; b = 115 + stripe;
      }
    }
    if (opts.hand && x > 20 && x < 70 && y > 60 && y < 80) { r = 200; g = 150; b = 125; }
    const nz = opts.noise ?? 0;
    d[p] = r + (Math.random() - 0.5) * nz; d[p + 1] = g + (Math.random() - 0.5) * nz; d[p + 2] = b + (Math.random() - 0.5) * nz; d[p + 3] = 255;
  }
  return d;
}

describe('segmentation (measured)', () => {
  it('finds a centred silhouette with ~zero offset', () => {
    const { m } = analyzeFrame(frame(0), W, H, cal);
    expect(m.found).toBe(true);
    expect(Math.abs(m.offset)).toBeLessThan(0.01);
    expect(m.rowCoverage).toBeGreaterThan(0.95);
    expect(m.profile[0]).toBeGreaterThan(m.profile[23]); // wider at the bottom than at the top
  });

  it('measures lateral offset of an off-centre silhouette', () => {
    const { m } = analyzeFrame(frame(8), W, H, cal);
    expect(m.offset * W).toBeGreaterThan(3);
    expect(m.lean).toBeGreaterThan(0);
  });

  it('reports not-found on an empty frame', () => {
    const d = new Uint8ClampedArray(W * H * 4).fill(40);
    expect(analyzeFrame(d, W, H, cal).m.found).toBe(false);
  });

  it('ignores rows whose edges fall in an excluded (hand) region', () => {
    const { m } = analyzeFrame(frame(0, 0, { hand: true }), W, H, cal, { exclude: [{ x0: 18, y0: 58, x1: 72, y1: 82 }] });
    expect(m.rowCoverage).toBeLessThan(0.9);
  });
});

describe('temporal wobble (estimated)', () => {
  const run = (dxAt: (t: number) => number, phaseRate = 2 * Math.PI * 1.5, seconds = 4, noise = 4) => {
    const tf = new TemporalFilter({ windowMs: 2500, noiseFloor: 0.004 });
    let s: Sample | null = null;
    for (let t = 0; t <= seconds * 1000; t += 50) {
      const { m } = analyzeFrame(frame(dxAt(t), (phaseRate * t) / 1000, { noise }), W, H, cal);
      s = tf.push(t, m);
    }
    return s!;
  };

  it('normal rotation of a centred mass is NOT instability (texture rotates, silhouette does not)', () => {
    const s = run(() => 0);
    expect(s.tracking).toBe('ok');
    expect(s.wobble).toBeLessThan(0.01);
  });

  it('off-centre mass oscillating at the wheel frequency registers as wobble with ~that frequency', () => {
    const f = 1.5;
    const s = run((t) => 6 * Math.sin((2 * Math.PI * f * t) / 1000));
    expect(s.wobble).toBeGreaterThan(0.08);
    expect(s.frequency).toBeGreaterThan(1.0);
    expect(s.frequency).toBeLessThan(2.0);
  });

  it('a static off-axis placement or slow drift is not wobble', () => {
    const s = run((t) => 2 + (t / 4000) * 4);
    expect(s.wobble).toBeLessThan(0.015);
  });

  it('wobble grows monotonically with oscillation amplitude', () => {
    const a = run((t) => 2 * Math.sin((2 * Math.PI * 1.5 * t) / 1000)).wobble;
    const b = run((t) => 6 * Math.sin((2 * Math.PI * 1.5 * t) / 1000)).wobble;
    expect(b).toBeGreaterThan(a * 2);
  });

  it('detrendedStats removes a linear ramp', () => {
    const ts = Array.from({ length: 50 }, (_, i) => i * 40);
    expect(detrendedStats(ts, ts.map((t) => t * 0.01)).rms).toBeLessThan(1e-9);
  });
});

describe('event detection', () => {
  const mk = (t: number, wobble: number, extra: Partial<Sample> = {}): Sample => ({
    t, tracking: 'ok', confidence: 0.9, profile: [], height: 0.5, meanRadius: 0.2, offset: 0, wobble, frequency: 1.5,
    lean: 0, motion: 0.02, hands: 0, handSpeed: 0, ...extra,
  });

  it('finds instability, stabilization, tracking loss, movement and a tentative coupling', () => {
    const s: Sample[] = [];
    for (let t = 0; t < 30000; t += 100) {
      let w = 0.01;
      if (t > 3000 && t < 9000) w = 0.12;
      if (t > 15000 && t < 15800) w = 0.1;
      const lost = t > 20000 && t < 21000;
      const motion = t > 8000 && t < 9500 ? 0.5 : 0.02;
      s.push(mk(t, w, { tracking: lost ? 'lost' : 'ok', motion }));
    }
    const ev = detectEvents(s);
    const kinds = ev.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'instability').length).toBe(2);
    expect(kinds).toContain('stabilization');
    expect(kinds).toContain('tracking-loss');
    expect(kinds).toContain('hand-adjustment');
    const coup = ev.find((e) => e.kind === 'coupling')!;
    expect(coup.origin).toBe('interpreted');
    expect(coup.detail).toMatch(/does not know/);
  });

  it('a uniformly calm session produces no instability events (no "ideal" imposed)', () => {
    const s = Array.from({ length: 200 }, (_, i) => mk(i * 100, 0.008 + 0.002 * Math.sin(i)));
    expect(detectEvents(s).filter((e) => e.kind === 'instability').length).toBe(0);
  });
});
