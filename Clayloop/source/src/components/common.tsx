import { ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import type { Sample, EventKind } from '../cv/types';
import type { SessionSource } from '../store/db';
import { sensing, SensingStatus } from '../cv/sensing';

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const KIND_COLOR: Record<EventKind, string> = {
  instability: 'var(--unstable)',
  stabilization: 'var(--stable)',
  'tracking-loss': 'var(--loss)',
  'hand-adjustment': 'var(--hand)',
  coupling: 'var(--interp)',
  marker: 'var(--user)',
};
export const KIND_LABEL: Record<EventKind, string> = {
  instability: 'Instability',
  stabilization: 'Stabilization',
  'tracking-loss': 'Clay not visible',
  'hand-adjustment': 'Movement / hands',
  coupling: 'Possible response',
  marker: 'Your marker',
};

export function SourceBadge({ source, provenance }: { source: SessionSource; provenance?: string }) {
  const cls = source === 'synthetic' ? 'synthetic' : source === 'camera' ? 'camera' : 'file';
  const label = source === 'synthetic' ? 'Synthetic test data' : source === 'camera' ? 'Live camera recording' : 'Analysed video file';
  return <span className={`badge ${cls}`} title={provenance}>{label}</span>;
}

export function Modal({ title, children, onClose, actions }: { title: string; children?: ReactNode; onClose: () => void; actions: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <div className="row" style={{ justifyContent: 'flex-end' }}>{actions}</div>
      </div>
    </div>
  );
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(msg: string) { toastSet?.(msg); }
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { toastSet = setMsg; return () => { toastSet = null; }; }, []);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); } }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function Sparkline({ data, color = 'currentColor', height = 42 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return <svg className="spark" style={{ height }} />;
  const max = Math.max(0.05, ...data);
  const n = data.length;
  const pts = data.map((v, i) => `${(i / (n - 1)) * 100},${50 - (v / max) * 46}`);
  const lower = data.map((v, i) => `${(i / (n - 1)) * 100},${50 + (v / max) * 46}`).reverse();
  return (
    <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }}>
      <polygon points={[...pts, ...lower].join(' ')} fill={color} opacity={0.75} />
      <line x1="0" x2="100" y1="50" y2="50" stroke={color} strokeWidth="0.6" vectorEffect="non-scaling-stroke" opacity={0.5} />
    </svg>
  );
}

/** Interpolated sample at time t (ms), for replay. */
export function sampleAt(samples: Sample[], t: number): Sample | null {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi];
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  const L = (x: number, y: number) => x + (y - x) * f;
  return {
    ...a,
    t,
    tracking: f < 0.5 ? a.tracking : b.tracking,
    confidence: L(a.confidence, b.confidence),
    profile: a.profile.map((v, i) => L(v, b.profile[i] ?? v)),
    height: L(a.height, b.height), meanRadius: L(a.meanRadius, b.meanRadius), offset: L(a.offset, b.offset),
    wobble: L(a.wobble, b.wobble), frequency: L(a.frequency, b.frequency), lean: L(a.lean, b.lean), motion: L(a.motion, b.motion),
    handSpeed: L(a.handSpeed, b.handSpeed),
  };
}

/** Subscribe to sensing status (low-frequency). */
export function useSensingStatus(): SensingStatus {
  return useSyncExternalStore(
    (cb) => sensing().onStatus(() => cb()) as unknown as () => void,
    () => sensing().status,
  );
}

/** Re-render at a modest rate with the latest live sample (for readouts, not for 3D). */
export function useLatestSample(hz = 8): Sample | null {
  const [s, setS] = useState<Sample | null>(sensing().latest);
  useEffect(() => {
    const id = setInterval(() => setS(sensing().latest), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return s;
}

export function download(name: string, data: Blob | string, type = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
