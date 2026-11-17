import { Calibration, FrameMeasurement, PROFILE_BINS, RGB } from './types';

/**
 * Single-frame silhouette analysis (all values here are MEASURED from pixels).
 *
 * Input is an RGBA buffer of the calibrated region of interest, already scaled down to a small
 * analysis grid (e.g. 128 px wide). We:
 *   1. classify each pixel as clay / not-clay by nearest-colour against two calibrated samples
 *      (clay colour and backdrop colour) with a tolerance,
 *   2. walk each row and find the run of clay pixels that sits on (or nearest to) the wheel axis,
 *      bridging small gaps caused by throwing lines / specular highlights,
 *   3. find the top of the clay (first run of consecutive valid rows),
 *   4. resample the edge pairs into PROFILE_BINS height bins (bottom → top),
 *   5. compute frame-difference motion energy outside the clay silhouette.
 *
 * Why rotation alone does not register as instability: a centred, roughly axisymmetric mass that
 * rotates presents the same left/right edges to the camera on every frame, regardless of surface
 * texture. Only off-centre mass, deformation or lean changes the silhouette, and it does so
 * periodically with the wheel. The temporal stage (temporal.ts) measures that oscillation.
 */

export interface Box { x0: number; y0: number; x1: number; y1: number } // in analysis-grid pixels

export interface AnalyzeOptions {
  /** Regions to ignore (e.g. detected hands). Rows whose clay edge touches a box are marked invalid. */
  exclude?: Box[];
  prevLuma?: Float32Array | null;
}

export interface AnalyzeResult {
  m: FrameMeasurement;
  luma: Float32Array;
  /** 1 = clay, 0 = other; for overlays. */
  mask: Uint8Array;
  /** per-row edges (-1 when invalid), for overlays */
  left: Int16Array;
  right: Int16Array;
  topRow: number;
  baseRow: number;
}

function dist(r: number, g: number, b: number, c: RGB): number {
  const dr = r - c.r, dg = g - c.g, db = b - c.b;
  // slightly luminance-tolerant metric: chroma differences weigh more than brightness
  const l = (dr + dg + db) / 3;
  const cr = dr - l, cg = dg - l, cb = db - l;
  return Math.sqrt(0.5 * l * l + 1.5 * (cr * cr + cg * cg + cb * cb));
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function analyzeFrame(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cal: Calibration,
  opts: AnalyzeOptions = {},
): AnalyzeResult {
  const n = w * h;
  const mask = new Uint8Array(n);
  const luma = new Float32Array(n);
  const D = Math.max(20, dist(cal.clayColor.r, cal.clayColor.g, cal.clayColor.b, cal.backdropColor));
  const maxClayDist = D * (0.25 + cal.tolerance);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const dc = dist(r, g, b, cal.clayColor);
    if (dc <= maxClayDist) {
      const db = dist(r, g, b, cal.backdropColor);
      if (dc < db) mask[i] = 1;
    }
  }

  const excl = opts.exclude ?? [];
  const inExcl = (x: number, y: number) => excl.some((bx) => x >= bx.x0 && x <= bx.x1 && y >= bx.y0 && y <= bx.y1);

  const axis = Math.round(cal.axisX * (w - 1));
  const baseRow = Math.min(h - 1, Math.max(1, Math.round(cal.baseY * (h - 1))));
  const left = new Int16Array(h).fill(-1);
  const right = new Int16Array(h).fill(-1);
  const maxGap = Math.max(2, Math.round(w * 0.03));
  const searchHalf = Math.round(w * 0.3);

  for (let y = 0; y <= baseRow; y++) {
    const row = y * w;
    // collect runs with gap bridging
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    let x = 0;
    while (x < w) {
      if (!mask[row + x]) { x++; continue; }
      const start = x;
      let end = x;
      let gap = 0;
      x++;
      while (x < w) {
        if (mask[row + x]) { end = x; gap = 0; } else if (++gap > maxGap) break;
        x++;
      }
      const len = end - start + 1;
      if (len >= 3) {
        const contains = start <= axis && end >= axis;
        const centre = (start + end) / 2;
        const score = contains ? 0 : Math.abs(centre - axis);
        if (score < bestScore && (contains || score < searchHalf)) { bestScore = score; best = [start, end]; }
      }
    }
    if (best) {
      const [L, R] = best;
      const width = R - L + 1;
      const touchesFrame = L === 0 || R === w - 1;
      if (width < w * 0.95 && !touchesFrame && !inExcl(L, y) && !inExcl(R, y)) {
        left[y] = L;
        right[y] = R;
      }
    }
  }

  // top of clay: first row that starts 3 consecutive valid rows (scanning downward)
  let topRow = -1;
  for (let y = 0; y <= baseRow - 2; y++) {
    if (left[y] >= 0 && left[y + 1] >= 0 && left[y + 2] >= 0) { topRow = y; break; }
  }

  const empty: FrameMeasurement = {
    found: false, profile: new Array(PROFILE_BINS).fill(0), centers: new Array(PROFILE_BINS).fill(0),
    height: 0, meanRadius: 0, offset: 0, lean: 0, rowCoverage: 0, area: 0, motionEnergy: 0,
  };

  // motion energy outside clay rows' silhouette (computed regardless of whether clay found)
  let motion = 0;
  if (opts.prevLuma && opts.prevLuma.length === n) {
    let acc = 0, cnt = 0;
    for (let y = 0; y <= baseRow; y++) {
      const L = left[y], R = right[y];
      for (let xx = 0; xx < w; xx += 2) {
        if (L >= 0 && xx >= L - 1 && xx <= R + 1) continue;
        const i = y * w + xx;
        acc += Math.abs(luma[i] - opts.prevLuma[i]);
        cnt++;
      }
    }
    motion = cnt ? Math.min(1, (acc / cnt) / 25) : 0; // ~25 grey levels mean change == saturated
  }

  const clayRows = topRow >= 0 ? baseRow - topRow + 1 : 0;
  if (topRow < 0 || clayRows < Math.max(6, h * 0.06)) {
    return { m: { ...empty, motionEnergy: motion }, luma, mask, left, right, topRow, baseRow };
  }

  let valid = 0, area = 0;
  for (let y = topRow; y <= baseRow; y++) if (left[y] >= 0) { valid++; area += right[y] - left[y] + 1; }

  const profile: number[] = [];
  const centers: number[] = [];
  for (let b = 0; b < PROFILE_BINS; b++) {
    // bin 0 = bottom
    const yHi = baseRow - Math.floor((b * clayRows) / PROFILE_BINS);
    const yLo = baseRow - Math.floor(((b + 1) * clayRows) / PROFILE_BINS) + 1;
    const rs: number[] = [], cs: number[] = [];
    for (let y = Math.max(topRow, yLo); y <= yHi; y++) {
      if (left[y] < 0) continue;
      rs.push((right[y] - left[y] + 1) / 2);
      cs.push((left[y] + right[y]) / 2 - axis);
    }
    profile.push(rs.length ? median(rs) / w : NaN);
    centers.push(cs.length ? median(cs) / w : NaN);
  }
  // fill missing bins by interpolation from neighbours
  fillNaN(profile);
  fillNaN(centers);
  // light vertical smoothing: per-row thresholding of shaded, ridged clay makes edges jagged
  smoothBins(profile);

  const meanRadius = profile.reduce((a, v) => a + v, 0) / PROFILE_BINS;
  // weight upper bins a little more: wobble is most visible away from the wheel head
  let wsum = 0, osum = 0;
  for (let b = 0; b < PROFILE_BINS; b++) { const wt = 0.5 + b / PROFILE_BINS; wsum += wt; osum += wt * centers[b]; }
  const third = Math.floor(PROFILE_BINS / 3);
  const lower = centers.slice(0, third).reduce((a, v) => a + v, 0) / third;
  const upper = centers.slice(PROFILE_BINS - third).reduce((a, v) => a + v, 0) / third;

  return {
    m: {
      found: true,
      profile,
      centers,
      height: clayRows / w,
      meanRadius,
      offset: osum / wsum,
      lean: upper - lower,
      rowCoverage: valid / clayRows,
      area,
      motionEnergy: motion,
    },
    luma, mask, left, right, topRow, baseRow,
  };
}

function fillNaN(a: number[]) {
  const n = a.length;
  let firstValid = a.findIndex((v) => !Number.isNaN(v));
  if (firstValid < 0) { a.fill(0); return; }
  for (let i = 0; i < firstValid; i++) a[i] = a[firstValid];
  let last = firstValid;
  for (let i = firstValid + 1; i < n; i++) {
    if (!Number.isNaN(a[i])) {
      for (let j = last + 1; j < i; j++) a[j] = a[last] + ((a[i] - a[last]) * (j - last)) / (i - last);
      last = i;
    }
  }
  for (let i = last + 1; i < n; i++) a[i] = a[last];
}

function smoothBins(a: number[]) {
  const src = a.slice();
  for (let i = 0; i < a.length; i++) {
    let acc = 0, w = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= a.length) continue;
      const wt = 3 - Math.abs(k);
      acc += src[j] * wt; w += wt;
    }
    a[i] = acc / w;
  }
}
