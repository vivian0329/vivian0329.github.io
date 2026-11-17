import { detectEvents } from '../cv/events';
import type { Calibration, PracticeEvent, Sample } from '../cv/types';
import { newId, SessionRecord, SessionSource, sparkline, Thumb, Trace } from './db';

export function nearestThumb(thumbs: Thumb[], t: number): string | undefined {
  let best: Thumb | undefined;
  for (const th of thumbs) if (!best || Math.abs(th.t - t) < Math.abs(best.t - t)) best = th;
  return best?.src;
}

export function attachThumbs(events: PracticeEvent[], thumbs: Thumb[]) {
  return events.map((e) => ({ ...e, thumb: e.thumb ?? nearestThumb(thumbs, e.kind === 'stabilization' ? (e.tStart + e.tEnd) / 2 : e.tStart) }));
}

export function buildSession(args: {
  samples: Sample[];
  thumbs: Thumb[];
  durationMs: number;
  title: string;
  practitioner: string;
  experience: string;
  notes: string;
  source: SessionSource;
  provenance: string;
  camera: { label: string; width: number; height: number };
  calibration: Calibration;
  hasVideo: boolean;
  videoMime: string;
  createdAt?: string;
}): { session: SessionRecord; trace: Trace } {
  const id = newId();
  const events = attachThumbs(detectEvents(args.samples), args.thumbs);
  const tracked = args.samples.filter((s) => s.tracking !== 'lost').length / Math.max(1, args.samples.length);
  const session: SessionRecord = {
    schema: 1,
    id,
    title: args.title,
    createdAt: args.createdAt ?? new Date().toISOString(),
    durationMs: args.durationMs,
    source: args.source,
    provenance: args.provenance,
    practitioner: args.practitioner,
    experience: args.experience,
    camera: args.camera,
    calibration: args.calibration,
    events,
    notes: args.notes,
    tags: [],
    hasVideo: args.hasVideo,
    videoMime: args.videoMime,
    sparkline: sparkline(args.samples),
    trackedFraction: Math.round(tracked * 1000) / 1000,
    featured: false,
  };
  return { session, trace: { id, samples: args.samples, thumbs: args.thumbs } };
}

/** Re-run detection on an existing trace, keeping user markers and notes on events that persist. */
export function redetect(session: SessionRecord, trace: Trace): PracticeEvent[] {
  const user = session.events.filter((e) => e.origin === 'user');
  const fresh = attachThumbs(detectEvents(trace.samples), trace.thumbs);
  return [...fresh, ...user].sort((a, b) => a.tStart - b.tStart);
}
