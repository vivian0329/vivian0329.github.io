import { useEffect, useRef, useState } from 'react';
import { sensing } from '../cv/sensing';
import { loadJSON } from '../store/local';
import { useSensingStatus } from './common';

export const SYNTHETIC_VIDEO = { url: 'demo/synthetic-footage.webm', name: 'Synthetic test footage (generated)' };

export function isSyntheticSource(name: string) { return name === SYNTHETIC_VIDEO.name; }

export function SourcePicker({ compact = false }: { compact?: boolean }) {
  const S = sensing();
  const status = useSensingStatus();
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setCams(await S.listCameras());
  useEffect(() => {
    refresh();
    const h = () => refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', h);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', h);
  }, []);

  const current = status.source.kind === 'camera' ? `cam:${status.source.deviceId}` : status.source.kind === 'file' ? 'file' : '';
  const choose = async (v: string) => {
    setBusy(true);
    try {
      if (v === 'none') S.closeSource();
      else if (v === 'synthetic') await S.openFile(SYNTHETIC_VIDEO);
      else if (v === 'pick-file') fileRef.current?.click();
      else if (v.startsWith('cam:')) await S.openCamera(v.slice(4) || undefined);
    } catch { /* error is shown via status */ }
    setBusy(false);
    refresh(); // labels become available after permission
  };

  const lastCam = loadJSON<string>('clayloop.lastCamera', '');
  return (
    <div className="row" style={{ gap: 8 }}>
      <select
        className="input"
        aria-label="Video source"
        value={current === 'file' ? 'file' : current}
        onChange={(e) => choose(e.target.value)}
        disabled={busy}
        style={{ flex: 1, minWidth: compact ? 0 : 220 }}
      >
        <option value="" disabled>Choose a source…</option>
        <optgroup label="Live camera">
          {cams.length === 0 && <option value="cam:">Default camera</option>}
          {cams.map((c, i) => (
            <option key={c.deviceId || i} value={`cam:${c.deviceId}`}>
              {c.label || `Camera ${i + 1}`}{c.deviceId === lastCam ? ' (last used)' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="Recorded footage">
          <option value="pick-file">Open a video file…</option>
          <option value="synthetic">Synthetic test footage (labelled)</option>
          {status.source.kind === 'file' && <option value="file">{status.source.name}</option>}
        </optgroup>
        {status.source.kind !== 'none' && <option value="none">Close source</option>}
      </select>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) { setBusy(true); try { await S.openFile(f); } catch { /* shown */ } setBusy(false); }
          e.target.value = '';
        }}
      />
    </div>
  );
}
