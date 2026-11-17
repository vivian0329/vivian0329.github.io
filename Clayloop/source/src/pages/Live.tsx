import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sensing } from '../cv/sensing';
import { SessionRecorder } from '../cv/recorder';
import { ClayMirror } from '../three/ClayMirror';
import { loadMapping } from '../three/mapping';
import { SensorView } from '../components/SensorView';
import { SourcePicker, isSyntheticSource } from '../components/SourcePicker';
import { fmtTime, Modal, toast, useLatestSample, useSensingStatus } from '../components/common';
import { CouplingStrip } from '../components/CouplingStrip';
import { buildSession } from '../store/build';
import { saveSession } from '../store/db';
import { loadJSON, saveJSON } from '../store/local';

export function MeasurementLegend() {
  return (
    <div className="legend">
      <div className="grp m"><b>Measured</b><span>Silhouette edges per height band, clay height, lateral offset from the wheel axis, tracking confidence.</span></div>
      <div className="grp e"><b>Estimated</b><span>Wobble: oscillation of the silhouette over 2 s, relative to radius. Frequency of that oscillation. Lean.</span></div>
      <div className="grp v"><b>Visualization</b><span>Displacement is exaggerated ×gain. Spin, surface tremor, light and material are artistic.</span></div>
    </div>
  );
}

export function Readouts() {
  const s = useLatestSample(8);
  const st = useSensingStatus();
  const rows: [string, string, number, string][] = s
    ? [
        ['Wobble (estimated)', `${(s.wobble * 100).toFixed(1)}% of radius`, Math.min(1, s.wobble / 0.25), 'var(--estimated)'],
        ['Oscillation (estimated)', s.frequency > 0.3 ? `${s.frequency.toFixed(2)} Hz` : '—', Math.min(1, s.frequency / 4), 'var(--estimated)'],
        ['Lateral offset (measured)', `${(s.offset * 100).toFixed(1)}% ROI`, Math.min(1, Math.abs(s.offset) * 8), 'var(--measured)'],
        ['Height (measured)', `${(s.height * 100).toFixed(0)}% ROI w`, Math.min(1, s.height), 'var(--measured)'],
        ['Confidence (measured)', `${Math.round(s.confidence * 100)}%`, s.confidence, 'var(--measured)'],
        [st.handStatus === 'ready' ? 'Hands in region' : 'Motion near clay', st.handStatus === 'ready' ? `${s.hands}` : `${Math.round(s.motion * 100)}%`, st.handStatus === 'ready' ? Math.min(1, s.hands / 2) : s.motion, 'var(--hand)'],
      ]
    : [];
  return (
    <div className="readouts" data-testid="readouts">
      {rows.map(([k, v, f, c]) => (
        <div className="readout" key={k} style={{ color: c }}>
          <span className="k">{k}</span>
          <span className="v" style={{ color: 'var(--stage-ink)' }}>{v}</span>
          <span className="bar"><i style={{ width: `${f * 100}%` }} /></span>
        </div>
      ))}
      {!s && <span className="small" style={{ color: 'var(--stage-ink-2)' }}>No measurements yet.</span>}
    </div>
  );
}

export function TrackingStatus() {
  const s = useLatestSample(6);
  const st = useSensingStatus();
  const state = st.source.kind === 'none' ? 'none' : !s ? 'none' : s.tracking;
  const label = state === 'none' ? (st.source.kind === 'none' ? 'No source' : 'Starting…') : state === 'ok' ? 'Tracking clay' : state === 'weak' ? 'Tracking (partial view)' : 'Clay not visible';
  return (
    <span className={`status ${state}`} data-testid="tracking-status" data-state={state}>
      <span className="led" /> {label}
      {st.source.kind !== 'none' && <span style={{ color: 'var(--stage-ink-2)' }}>· {st.fps} fps</span>}
    </span>
  );
}

export default function Live() {
  const S = sensing();
  const status = useSensingStatus();
  const nav = useNavigate();
  const mapping = useMemo(loadMapping, []);
  const rec = useRef(new SessionRecorder());
  const [recState, setRecState] = useState(rec.current.state);
  const [elapsed, setElapsed] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [pending, setPending] = useState<Awaited<ReturnType<SessionRecorder['stop']>> | null>(null);
  const [form, setForm] = useState(() => ({ title: '', practitioner: loadJSON('clayloop.practitioner', ''), experience: loadJSON('clayloop.experience', ''), notes: '' }));
  const [saving, setSaving] = useState(false);
  const latest = useLatestSample(4);

  // auto-open last camera when arriving with no source
  useEffect(() => {
    if (S.status.source.kind === 'none') {
      const last = loadJSON<string>('clayloop.lastCamera', '');
      if (last) S.openCamera(last).catch(() => {});
    }
  }, [S]);

  useEffect(() => {
    const id = setInterval(() => setElapsed(rec.current.elapsed()), 250);
    return () => clearInterval(id);
  }, []);

  // stop recording if the page unmounts mid-session (keeps nothing half-written)
  useEffect(() => () => { if (rec.current.state !== 'idle') rec.current.stop(); }, []);

  const start = () => { rec.current.start(true); setRecState('recording'); };
  const pause = () => { rec.current.pause(); setRecState(rec.current.state); };
  const resume = () => { rec.current.resume(); setRecState(rec.current.state); };
  const stop = async () => {
    const r = await rec.current.stop();
    setRecState('idle');
    setPending(r);
    const d = new Date();
    setForm((f) => ({ ...f, title: `Centering, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`, notes: '' }));
    setSaveOpen(true);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || saveOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (rec.current.state === 'idle' && S.status.source.kind !== 'none') start();
        else if (rec.current.state === 'recording') pause();
        else if (rec.current.state === 'paused') resume();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [saveOpen, S]);

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    saveJSON('clayloop.practitioner', form.practitioner);
    saveJSON('clayloop.experience', form.experience);
    const src = S.status.source;
    const synthetic = src.kind === 'file' && isSyntheticSource(src.name);
    const { session, trace } = buildSession({
      samples: pending.samples,
      thumbs: pending.thumbs,
      durationMs: pending.durationMs,
      title: form.title || 'Untitled session',
      practitioner: form.practitioner,
      experience: form.experience,
      notes: form.notes,
      source: src.kind === 'camera' ? 'camera' : synthetic ? 'synthetic' : 'video-file',
      provenance:
        src.kind === 'camera' ? `Recorded live from “${src.label}”.`
          : synthetic ? 'Synthetic development footage generated by tools/make_synthetic_footage.py; not empirical data.'
          : src.kind === 'file' ? `Analysed from video file “${src.name}”.` : 'Unknown source',
      camera: { label: src.kind === 'camera' ? src.label : src.kind === 'file' ? src.name : '', width: S.video.videoWidth, height: S.video.videoHeight },
      calibration: S.calibration,
      hasVideo: !!pending.video,
      videoMime: pending.mime,
    });
    try {
      await saveSession(session, trace, pending.video ?? undefined);
      setSaveOpen(false);
      setPending(null);
      toast('Session saved');
      nav(`/session/${session.id}`);
    } catch (e) {
      toast('Could not save: ' + String(e));
    }
    setSaving(false);
  };

  const lost = latest?.tracking === 'lost' && status.source.kind !== 'none';
  return (
    <div className="live">
      <aside className="live-side">
        <div className="caps" style={{ color: 'var(--stage-ink-2)' }}>Source</div>
        <SourcePicker />
        <SensorView />
        <div className="row"><TrackingStatus /><span className="spacer" /><Link to="/settings" className="small" style={{ color: 'var(--stage-ink-2)' }}>Calibrate</Link></div>
        {status.error && <div className="notice">{status.error}</div>}
        <Readouts />
        <MeasurementLegend />
      </aside>
      <section className="live-stage" data-testid="live-stage">
        <ClayMirror getSample={() => S.latest} mapping={mapping} />
        <div className="overlay-tl">
          <div className="caps" style={{ color: 'var(--stage-ink-2)' }}>Material Mirror</div>
          <div className="serif" style={{ fontSize: 26, marginTop: 4 }}>{recState === 'idle' ? 'Observing' : recState === 'recording' ? 'Recording practice' : 'Paused'}</div>
          {lost && <div className="hold-note" data-testid="hold-note">Clay not visible. Holding the last observed shape.</div>}
          {!lost && latest?.tracking === 'weak' && <div className="hold-note">Partial view. The form responds more slowly.</div>}
        </div>
        <CouplingStrip />
        <div className="controlbar" data-testid="controlbar">
          {recState === 'idle' && (
            <button className="btn primary rec big" onClick={start} disabled={status.source.kind === 'none'} data-testid="btn-start"><span className="dot" />Start session</button>
          )}
          {recState === 'recording' && <button className="btn big" onClick={pause} data-testid="btn-pause">Pause</button>}
          {recState === 'paused' && <button className="btn big" onClick={resume} data-testid="btn-resume">Resume</button>}
          {recState !== 'idle' && <span className="timer" data-testid="timer">{fmtTime(elapsed)}</span>}
          {recState !== 'idle' && <button className="btn primary big" onClick={stop} data-testid="btn-stop">Stop &amp; review</button>}
        </div>
      </section>
      {saveOpen && pending && (
        <Modal
          title="Keep this session?"
          onClose={() => {}}
          actions={
            <>
              <button className="btn danger" onClick={() => { setSaveOpen(false); setPending(null); toast('Session discarded'); }}>Discard</button>
              <button className="btn primary" onClick={save} disabled={saving} data-testid="btn-save">{saving ? 'Saving…' : 'Save to library'}</button>
            </>
          }
        >
          <p className="small muted" style={{ margin: 0 }}>
            {fmtTime(pending.durationMs)} of practice · {pending.samples.length} measurements · {pending.video ? 'video recorded' : 'no video'}
          </p>
          <label className="field">Title<input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-title" /></label>
          <label className="field">Practitioner (optional)<input className="input" value={form.practitioner} onChange={(e) => setForm({ ...form, practitioner: e.target.value })} /></label>
          <label className="field">Experience, in your own words (optional)<input className="input" placeholder="e.g. third year throwing, returning after a break" value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} /></label>
          <label className="field">A first note (optional)<textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  );
}
