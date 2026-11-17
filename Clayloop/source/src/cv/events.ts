import { PracticeEvent, Sample } from './types';

/**
 * Event detection over a recorded session.
 *
 * OBSERVED events are threshold crossings in measured/estimated signals, with thresholds set
 * relative to the session's own distribution (not to an "ideal" centered state):
 *   - instability   : wobble above a session-relative high threshold for ≥ minInstabilityMs
 *   - stabilization : after an instability episode, wobble stays below a fraction of that episode's
 *                     peak (bounded by the session's low/high thresholds) for ≥ minStableMs
 *   - tracking-loss : silhouette not reliably visible (often hands wrapping the clay) ≥ minLossMs
 *   - hand-adjustment: onset of hand presence/speed (MediaPipe) or, without hand tracking, onset of
 *                     motion energy around the clay (a proxy that is not hand-specific)
 * INTERPRETED events are tentative readings of temporal sequence only (coupling): a movement onset
 * followed shortly by settling. They state explicitly that causation is not inferred.
 */

export interface EventOptions {
  minHi: number;
  hiFactor: number;
  loRatio: number;
  minInstabilityMs: number;
  minStableMs: number;
  minLossMs: number;
  couplingMaxMs: number;
  /** settling = below this fraction of the preceding episode's peak (bounded by lo/hi) */
  settleRatio: number;
}

export const DEFAULT_EVENT_OPTIONS: EventOptions = {
  minHi: 0.03,
  hiFactor: 1.75,
  loRatio: 0.6,
  minInstabilityMs: 600,
  minStableMs: 2000,
  minLossMs: 300,
  couplingMaxMs: 6000,
  settleRatio: 0.35,
};

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function quantile(a: number[], q: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function thresholds(samples: Sample[], o: EventOptions = DEFAULT_EVENT_OPTIONS) {
  const w = samples.filter((s) => s.tracking !== 'lost').map((s) => s.wobble);
  const hi = Math.max(o.minHi, quantile(w, 0.5) * o.hiFactor);
  return { hi, lo: hi * o.loRatio };
}

function runs(samples: Sample[], pred: (s: Sample) => boolean, mergeGapMs: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < samples.length; i++) {
    if (pred(samples[i])) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, samples.length - 1]);
  // merge close runs
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && samples[r[0]].t - samples[last[1]].t <= mergeGapMs) last[1] = r[1];
    else merged.push([...r] as [number, number]);
  }
  return merged;
}

export function detectEvents(samples: Sample[], o: EventOptions = DEFAULT_EVENT_OPTIONS): PracticeEvent[] {
  if (samples.length < 5) return [];
  const ev: PracticeEvent[] = [];
  const { hi, lo } = thresholds(samples, o);
  const base = { note: '', tags: [] as string[] };

  // instability (lost frames neither start nor break an episode)
  const inst = runs(samples, (s) => s.tracking !== 'lost' && s.wobble > hi, 1500).filter(
    ([a, b]) => samples[b].t - samples[a].t >= o.minInstabilityMs,
  );
  for (const [a, b] of inst) {
    let peak = 0, pt = samples[a].t;
    for (let i = a; i <= b; i++) if (samples[i].wobble > peak) { peak = samples[i].wobble; pt = samples[i].t; }
    ev.push({
      ...base, id: uid('inst'), kind: 'instability', origin: 'observed', tStart: samples[a].t, tEnd: samples[b].t, value: peak,
      label: 'Period of instability',
      detail: `Silhouette oscillation stayed above this session's high threshold (${(hi * 100).toFixed(1)}% of radius) for ${fmt(samples[b].t - samples[a].t)}. Peak ${(peak * 100).toFixed(1)}% at ${fmt(pt)}.`,
    });
  }

  // stabilization following each instability episode: a sustained drop to well below that episode's peak
  for (const [a, b] of inst) {
    let peak = 0;
    for (let i = a; i <= b; i++) peak = Math.max(peak, samples[i].wobble);
    const settle = Math.min(hi, Math.max(lo, peak * o.settleRatio));
    let i = b + 1;
    while (i < samples.length && !(samples[i].tracking !== 'lost' && samples[i].wobble < settle)) i++;
    if (i >= samples.length) continue;
    const start = i;
    while (i < samples.length && (samples[i].wobble < settle || samples[i].tracking === 'lost')) i++;
    const end = i - 1;
    const overlaps = ev.some((e) => e.kind === 'stabilization' && samples[start].t <= e.tEnd && samples[end].t >= e.tStart);
    if (!overlaps && samples[end].t - samples[start].t >= o.minStableMs) {
      const mean = samples.slice(start, end + 1).reduce((x, s) => x + s.wobble, 0) / (end - start + 1);
      ev.push({
        ...base, id: uid('stab'), kind: 'stabilization', origin: 'observed', tStart: samples[start].t, tEnd: samples[end].t, value: mean,
        label: 'Observable stabilization',
        detail: `Oscillation stayed below ${(settle * 100).toFixed(1)}% of radius for ${fmt(samples[end].t - samples[start].t)} (mean ${(mean * 100).toFixed(1)}%, after a peak of ${(peak * 100).toFixed(1)}%).`,
      });
    }
  }

  // tracking loss
  for (const [a, b] of runs(samples, (s) => s.tracking === 'lost', 200)) {
    if (samples[b].t - samples[a].t < o.minLossMs) continue;
    ev.push({
      ...base, id: uid('loss'), kind: 'tracking-loss', origin: 'observed', tStart: samples[a].t, tEnd: samples[b].t,
      label: 'Clay not visible',
      detail: `The silhouette could not be read for ${fmt(samples[b].t - samples[a].t)}, often because hands cover the clay. The mirror held the last observed shape.`,
    });
  }

  // hand / motion onsets
  const usesHands = samples.some((s) => s.hands > 0);
  const act = (s: Sample) => (usesHands ? (s.hands > 0 ? 0.3 + Math.min(1, s.handSpeed) : 0) : s.motion);
  const actVals = samples.map(act);
  const thrA = usesHands ? 0.3 : Math.max(0.12, quantile(actVals, 0.75) * 2);
  const handRuns = runs(samples, (s) => act(s) >= thrA, 800).filter(([a, b]) => samples[b].t - samples[a].t >= 250);
  const handEvents: PracticeEvent[] = [];
  for (const [a, b] of handRuns) {
    const e: PracticeEvent = {
      ...base, id: uid('hand'), kind: 'hand-adjustment', origin: 'observed', tStart: samples[a].t, tEnd: samples[b].t,
      label: usesHands ? 'Hands in contact zone' : 'Movement near the clay',
      detail: usesHands
        ? `Hand landmarks detected inside the clay region for ${fmt(samples[b].t - samples[a].t)}. Nothing is inferred about intention or skill.`
        : `Image motion around the clay rose for ${fmt(samples[b].t - samples[a].t)}. This is a motion proxy (hands, sponge, tools or lighting) and is not hand-specific.`,
    };
    handEvents.push(e);
    ev.push(e);
  }

  // interpreted coupling: movement onset followed by settling
  const settles = ev.filter((e) => e.kind === 'stabilization');
  const instEnds = inst.map(([, b]) => samples[b].t);
  for (const h of handEvents) {
    const nextSettle = settles.find((s) => s.tStart > h.tStart && s.tStart - h.tEnd <= o.couplingMaxMs);
    const nextEnd = instEnds.find((t) => t > h.tStart && t - h.tEnd <= o.couplingMaxMs);
    const t = nextSettle ? nextSettle.tStart : nextEnd;
    if (t === undefined) continue;
    const lag = Math.max(0, t - h.tStart);
    ev.push({
      ...base, id: uid('coup'), kind: 'coupling', origin: 'interpreted', tStart: h.tStart, tEnd: t,
      label: 'Possible response',
      detail: `Oscillation began to settle ${fmt(lag)} after the observed movement. This is a temporal sequence only; the system does not know whether one caused the other. Keep, revise or dismiss.`,
    });
  }

  return ev.sort((a, b) => a.tStart - b.tStart);
}
