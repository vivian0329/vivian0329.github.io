import { FrameMeasurement, PROFILE_BINS, Sample } from './types';

/**
 * Temporal stage: turns per-frame MEASUREMENTS into the smoothed sample stream (MEASURED + ESTIMATED).
 *
 * Wobble proxy (ESTIMATED):
 *   Over a sliding window (default 2.5 s, several wheel revolutions at centering speeds), we
 *   linearly detrend the silhouette's lateral offset and lean, lightly smooth them, and fit a
 *   sinusoid at every frequency in the wheel band (0.5–4 Hz, i.e. 30–240 rpm). The amplitude of the
 *   best fit is the oscillation amplitude and its frequency the estimated oscillation rate.
 *   A centred mass on a rotating wheel gives a flat signal (only sensor noise, which is spread over
 *   all frequencies and mostly rejected by the band-limited fit); off-centre mass gives a periodic
 *   oscillation at the wheel frequency. Slow drifts (camera nudged, clay pushed over gradually) are
 *   removed by the detrend and do not count as wobble. The amplitude is expressed relative to the
 *   clay's mean radius so it is independent of camera distance.
 *
 * Tracking confidence:
 *   row coverage of the silhouette × area stability against the recent median. Hands that wrap the
 *   clay widen or break the silhouette; those frames drop in confidence and are excluded from the
 *   oscillation window, so a hand touching the clay is not reported as material wobble.
 */

export interface TemporalOptions {
  windowMs: number;
  noiseFloor: number;
}

interface WinItem { t: number; offset: number; lean: number; radius: number }

export interface HandInfo { count: number; speed: number }

export class TemporalFilter {
  private win: WinItem[] = [];
  private areas: { t: number; a: number }[] = [];
  private profile: number[] = new Array(PROFILE_BINS).fill(0);
  private hasProfile = false;
  private height = 0;
  private meanRadius = 0;
  private offset = 0;
  private wobble = 0;
  private raw = 0;
  private freq = 0;
  private lean = 0;
  private motion = 0;
  private lostSince: number | null = null;
  constructor(public opts: TemporalOptions = { windowMs: 2500, noiseFloor: 0.004 }) {}

  reset() {
    this.win = []; this.areas = []; this.hasProfile = false; this.wobble = 0; this.raw = 0; this.freq = 0; this.lostSince = null;
  }

  push(t: number, m: FrameMeasurement, hands: HandInfo = { count: 0, speed: 0 }): Sample {
    // ---- confidence ----
    let conf = 0;
    if (m.found) {
      const recent = this.areas.filter((a) => t - a.t < 3000).map((a) => a.a).sort((x, y) => x - y);
      const med = recent.length ? recent[recent.length >> 1] : m.area;
      const dev = med > 0 ? Math.abs(m.area - med) / med : 0;
      const stability = recent.length < 5 ? 0.85 : Math.max(0, 1 - dev * 2.5);
      conf = Math.max(0, Math.min(1, m.rowCoverage)) * stability;
      // only learn area from confident-ish frames so a hand wrap does not become the new normal
      if (stability > 0.6 || recent.length < 5) this.areas.push({ t, a: m.area });
      if (this.areas.length > 200) this.areas.splice(0, this.areas.length - 200);
    }
    const tracking: Sample['tracking'] = conf >= 0.6 ? 'ok' : conf >= 0.35 ? 'weak' : 'lost';

    // ---- smoothed measured shape ----
    if (tracking !== 'lost') {
      const a = !this.hasProfile ? 1 : tracking === 'ok' ? 0.35 : 0.08;
      for (let i = 0; i < PROFILE_BINS; i++) this.profile[i] += a * (m.profile[i] - this.profile[i]);
      this.height += a * (m.height - this.height);
      this.meanRadius += a * (m.meanRadius - this.meanRadius);
      this.offset += a * (m.offset - this.offset);
      this.hasProfile = true;
      this.lostSince = null;
      this.win.push({ t, offset: m.offset, lean: m.lean, radius: m.meanRadius });
    } else if (this.lostSince === null) {
      this.lostSince = t;
    }
    this.motion += 0.3 * (m.motionEnergy - this.motion);
    while (this.win.length && t - this.win[0].t > this.opts.windowMs) this.win.shift();

    // ---- wobble & frequency (ESTIMATED) ----
    if (tracking !== 'lost' && this.win.length >= 8 && this.win[this.win.length - 1].t - this.win[0].t > this.opts.windowMs * 0.5) {
      const ts = this.win.map((w) => w.t);
      const o = sineFit(ts, smooth3(this.win.map((w) => w.offset)));
      const l = sineFit(ts, smooth3(this.win.map((w) => w.lean)), o.f, o.f);
      const r = Math.max(0.02, this.win.reduce((a, w) => a + w.radius, 0) / this.win.length);
      const amp = Math.sqrt(o.amp * o.amp + 0.5 * l.amp * l.amp);
      this.raw += 0.25 * (amp / r - this.raw);
      const rel = Math.max(0, amp / r - this.opts.noiseFloor);
      this.wobble += 0.25 * (rel - this.wobble);
      const f = rel > 0 ? o.f : 0;
      this.freq += 0.15 * (f - this.freq);
      const leanMean = this.win.reduce((a, w) => a + w.lean, 0) / this.win.length;
      this.lean += 0.2 * (leanMean - this.lean);
    }
    // while lost for long, slowly release the estimate rather than snapping (renderer shows "holding")
    if (tracking === 'lost' && this.lostSince !== null && t - this.lostSince > 1500) {
      this.wobble *= 0.98;
    }

    return {
      t,
      tracking,
      confidence: conf,
      profile: this.profile.slice(),
      height: this.height,
      meanRadius: this.meanRadius,
      offset: this.offset,
      wobble: this.wobble,
      wobbleRaw: this.raw,
      frequency: this.freq,
      lean: this.lean,
      motion: this.motion,
      hands: hands.count,
      handSpeed: hands.speed,
    };
  }
}

/** RMS of a linearly detrended signal and its zero-crossing count. */
export function detrendedStats(ts: number[], ys: number[]): { rms: number; crossings: number; span: number } {
  const n = ys.length;
  if (n < 3) return { rms: 0, crossings: 0, span: 0 };
  let mt = 0, my = 0;
  for (let i = 0; i < n; i++) { mt += ts[i]; my += ys[i]; }
  mt /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ts[i] - mt) * (ys[i] - my); den += (ts[i] - mt) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const res = new Array<number>(n);
  let ss = 0;
  for (let i = 0; i < n; i++) { res[i] = ys[i] - (my + slope * (ts[i] - mt)); ss += res[i] * res[i]; }
  const rms = Math.sqrt(ss / n);
  // zero crossings with hysteresis so sensor noise around zero is not counted as oscillation
  const hyst = rms * 0.3;
  let crossings = 0, state = 0;
  for (let i = 0; i < n; i++) {
    const s = res[i] > hyst ? 1 : res[i] < -hyst ? -1 : 0;
    if (s !== 0) { if (state !== 0 && s !== state) crossings++; state = s; }
  }
  return { rms, crossings, span: ts[n - 1] - ts[0] };
}

function smooth3(y: number[]): number[] {
  return y.map((v, i) => (i === 0 || i === y.length - 1 ? v : (y[i - 1] + v + y[i + 1]) / 3));
}

/**
 * Band-limited sinusoid fit: detrend, then least-squares amplitude of a sinusoid at each candidate
 * frequency in [fmin, fmax] (Hz); returns the best amplitude and its frequency.
 */
export function sineFit(ts: number[], ys: number[], fmin = 0.5, fmax = 4, step = 0.05): { amp: number; f: number } {
  const n = ys.length;
  if (n < 4) return { amp: 0, f: 0 };
  let mt = 0, my = 0;
  for (let i = 0; i < n; i++) { mt += ts[i]; my += ys[i]; }
  mt /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ts[i] - mt) * (ys[i] - my); den += (ts[i] - mt) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const r = ys.map((y, i) => y - (my + slope * (ts[i] - mt)));
  let best = { amp: 0, f: fmin };
  for (let f = fmin; f <= fmax + 1e-9; f += step) {
    const w = (2 * Math.PI * f) / 1000;
    // solve 2x2 normal equations for a*cos + b*sin (handles uneven sampling and short windows)
    let cc = 0, ss = 0, cs = 0, yc = 0, ysn = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.cos(w * ts[i]), s = Math.sin(w * ts[i]);
      cc += c * c; ss += s * s; cs += c * s; yc += r[i] * c; ysn += r[i] * s;
    }
    const det = cc * ss - cs * cs;
    if (Math.abs(det) < 1e-9) continue;
    const a = (yc * ss - ysn * cs) / det, b = (ysn * cc - yc * cs) / det;
    const amp = Math.hypot(a, b);
    if (amp > best.amp) best = { amp, f };
  }
  return best;
}
