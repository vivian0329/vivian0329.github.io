/**
 * Runs the real analysis pipeline on the synthetic footage (decoded to raw frames by ffmpeg) and
 * compares the wobble estimate with the generator's ground-truth timeline.
 * Skipped when the decoded frames are not present (run `npm run footage` first).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { analyzeFrame } from '../../src/cv/segment';
import { TemporalFilter } from '../../src/cv/temporal';
import { detectEvents } from '../../src/cv/events';
import { Calibration, DEFAULT_CALIBRATION, Sample } from '../../src/cv/types';

const RAW = 'tools/out/synthetic-128x74-20fps.rgba';
const TRUTH = 'public/demo/synthetic-footage.truth.json';
const W = 128, H = 74, FPS = 20;
export const SYNTH_CAL: Calibration = {
  ...DEFAULT_CALIBRATION,
  roi: { x: 0.2, y: 0.22, w: 0.6, h: 0.62 }, axisX: 0.5, baseY: 0.93,
  clayColor: { r: 125, g: 105, b: 90 }, backdropColor: { r: 42, g: 40, b: 36 }, tolerance: 0.55, noiseFloor: 0.025,
};

const has = fs.existsSync(RAW) && fs.existsSync(TRUTH);
describe.skipIf(!has)('pipeline on synthetic footage', () => {
  const buf = has ? fs.readFileSync(RAW) : Buffer.alloc(0);
  const n = Math.floor(buf.length / (W * H * 4));
  const tf = new TemporalFilter({ windowMs: 2500, noiseFloor: SYNTH_CAL.noiseFloor });
  const samples: Sample[] = [];
  let prev: Float32Array | null = null;
  for (let i = 0; i < n; i++) {
    const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset + i * W * H * 4, W * H * 4);
    const r = analyzeFrame(data, W, H, SYNTH_CAL, { prevLuma: prev });
    prev = r.luma;
    samples.push(tf.push((i * 1000) / FPS, r.m));
  }
  const truth: { t: number; rel: number; hands: boolean }[] = has ? JSON.parse(fs.readFileSync(TRUTH, 'utf8')).samples : [];
  const at = (t: number) => samples.reduce((b, s) => (Math.abs(s.t - t) < Math.abs(b.t - t) ? s : b));
  const mean = (a: number, b: number) => { const xs = samples.filter((s) => s.t >= a && s.t <= b && s.tracking !== 'lost'); return xs.reduce((x, s) => x + s.wobble, 0) / xs.length; };

  it('prints a trace (for inspection)', () => {
    const lines: string[] = [];
    for (let t = 1000; t < 48000; t += 2000) {
      const s = at(t);
      const g = truth.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b));
      lines.push(`${(t / 1000).toFixed(0).padStart(3)}s truth ${(g.rel * 100).toFixed(1).padStart(5)}%  est ${(s.wobble * 100).toFixed(1).padStart(5)}%  f ${s.frequency.toFixed(2)}  ${s.tracking} conf ${s.confidence.toFixed(2)} off ${(s.offset*100).toFixed(2)} r ${(s.meanRadius*100).toFixed(1)}`);
    }
    fs.mkdirSync('tools/out', { recursive: true }); fs.writeFileSync('tools/out/footage-trace.txt', lines.join('\n'));
  });

  it('wobble is high when the clay sways and low when it is centred', () => {
    const unstable = mean(3000, 8000);
    const stable = mean(18000, 24500);
    const stableEnd = mean(38000, 47000);
    expect(unstable).toBeGreaterThan(0.08);
    expect(stable).toBeLessThan(unstable / 4);
    expect(stableEnd).toBeLessThan(unstable / 4);
  });

  it('estimated oscillation frequency is near the wheel speed (2 Hz) while unstable', () => {
    const f = samples.filter((s) => s.t > 3000 && s.t < 8000).map((s) => s.frequency);
    const m = f.reduce((a, b) => a + b, 0) / f.length;
    expect(m).toBeGreaterThan(1.5);
    expect(m).toBeLessThan(2.5);
  });

  it('detects the scripted instability, settling and hands', () => {
    const ev = detectEvents(samples);
    const inst = ev.filter((e) => e.kind === 'instability');
    const stab = ev.filter((e) => e.kind === 'stabilization');
    console.log(ev.map((e) => `${e.kind}@${(e.tStart / 1000).toFixed(1)}-${(e.tEnd / 1000).toFixed(1)}`).join('  '));
    expect(inst.some((e) => e.tStart < 4000)).toBe(true);
    expect(inst.some((e) => e.tStart > 24000 && e.tStart < 31000)).toBe(true);
    expect(stab.some((e) => e.tStart > 11000 && e.tStart < 20000)).toBe(true);
    expect(ev.some((e) => e.kind === 'hand-adjustment' && e.tStart > 5000 && e.tStart < 10000)).toBe(true);
  });
});
