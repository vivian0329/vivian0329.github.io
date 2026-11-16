/**
 * Persistent session archive. IndexedDB (via `idb`) lives in the browser profile on disk, survives
 * restarts, and stores video blobs natively, without needing a server. Three object stores:
 *   sessions : metadata, events, notes, tags, sparkline (small; listed in the Library)
 *   traces   : the full sample stream + thumbnails (large; loaded on demand)
 *   videos   : recorded video blobs
 */
import { openDB, IDBPDatabase } from 'idb';
import type { Calibration, PracticeEvent, Sample } from '../cv/types';

export type SessionSource = 'camera' | 'video-file' | 'synthetic';

export interface SessionRecord {
  schema: 1;
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  source: SessionSource;
  /** Human-readable provenance shown wherever the session appears. */
  provenance: string;
  practitioner: string;
  experience: string;
  camera: { label: string; width: number; height: number };
  calibration: Calibration;
  events: PracticeEvent[];
  notes: string;
  tags: string[];
  hasVideo: boolean;
  videoMime: string;
  /** Downsampled wobble (≈160 points) for library thumbnails. */
  sparkline: number[];
  trackedFraction: number;
  featured: boolean;
  /** For bundled demo sessions: URL of the video next to the app. */
  videoUrl?: string;
}

export interface Thumb { t: number; src: string }
export interface Trace { id: string; samples: Sample[]; thumbs: Thumb[] }

export interface ExportFile {
  format: 'clayloop-session';
  version: 1;
  exportedAt: string;
  session: SessionRecord;
  trace: Trace;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB('clayloop', 1, {
      upgrade(d) {
        d.createObjectStore('sessions', { keyPath: 'id' });
        d.createObjectStore('traces', { keyPath: 'id' });
        d.createObjectStore('videos');
      },
    });
  }
  return dbp;
}

export async function saveSession(s: SessionRecord, trace?: Trace, video?: Blob) {
  const d = await db();
  const tx = d.transaction(['sessions', 'traces', 'videos'], 'readwrite');
  await tx.objectStore('sessions').put(s);
  if (trace) await tx.objectStore('traces').put(trace);
  if (video) await tx.objectStore('videos').put(video, s.id);
  await tx.done;
  // ask the browser to keep this origin's data even under storage pressure
  navigator.storage?.persist?.().catch(() => {});
}

export async function updateSession(id: string, patch: Partial<SessionRecord>) {
  const d = await db();
  const cur = (await d.get('sessions', id)) as SessionRecord | undefined;
  if (!cur) throw new Error('Session not found');
  const next = { ...cur, ...patch, id };
  await d.put('sessions', next);
  return next;
}

export async function listSessions(): Promise<SessionRecord[]> {
  const all = (await (await db()).getAll('sessions')) as SessionRecord[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(id: string) { return (await (await db()).get('sessions', id)) as SessionRecord | undefined; }
export async function getTrace(id: string) { return (await (await db()).get('traces', id)) as Trace | undefined; }
export async function getVideo(id: string) { return (await (await db()).get('videos', id)) as Blob | undefined; }

export async function deleteSession(id: string) {
  const d = await db();
  const tx = d.transaction(['sessions', 'traces', 'videos'], 'readwrite');
  await Promise.all([tx.objectStore('sessions').delete(id), tx.objectStore('traces').delete(id), tx.objectStore('videos').delete(id), tx.done]);
}

export async function setFeatured(id: string | null) {
  const d = await db();
  const all = (await d.getAll('sessions')) as SessionRecord[];
  const tx = d.transaction('sessions', 'readwrite');
  for (const s of all) if (s.featured !== (s.id === id)) await tx.store.put({ ...s, featured: s.id === id });
  await tx.done;
}

export async function exportSession(id: string): Promise<ExportFile> {
  const session = await getSession(id);
  const trace = await getTrace(id);
  if (!session || !trace) throw new Error('Session not found');
  return { format: 'clayloop-session', version: 1, exportedAt: new Date().toISOString(), session, trace };
}

export function validateExport(x: unknown): ExportFile {
  const f = x as ExportFile;
  if (!f || f.format !== 'clayloop-session' || f.version !== 1 || !f.session?.id || !Array.isArray(f.trace?.samples)) {
    throw new Error('This file is not a ClayLoop session export.');
  }
  return f;
}

export async function importSession(x: unknown, video?: Blob): Promise<SessionRecord> {
  const f = validateExport(x);
  const exists = await getSession(f.session.id);
  const id = exists ? `${f.session.id}-import-${Date.now().toString(36)}` : f.session.id;
  const s: SessionRecord = { ...f.session, id, featured: false, hasVideo: !!video || (!!f.session.videoUrl && f.session.hasVideo) };
  await saveSession(s, { ...f.trace, id }, video);
  return s;
}

export function newId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `s${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

export function sparkline(samples: Sample[], n = 160): number[] {
  if (!samples.length) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * samples.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * samples.length) / n));
    let m = 0;
    for (let j = a; j < b && j < samples.length; j++) m = Math.max(m, samples[j].wobble);
    out.push(Math.round(m * 10000) / 10000);
  }
  return out;
}
