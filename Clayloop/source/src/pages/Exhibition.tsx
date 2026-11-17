/**
 * Exhibition Mode: a self-running, full-screen experience for the gallery.
 * DOCUMENTED mode replays a recorded session (the library session marked for exhibition, or the
 * bundled, clearly labelled synthetic demo). LIVE mode uses the webcam and real sensing.
 * Works offline; no developer tools needed: click, arrow keys, Esc, F.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClayMirror } from '../three/ClayMirror';
import { loadMapping } from '../three/mapping';
import { loadExhibitionSession, Loaded } from '../store/demo';
import { fmtTime, KIND_COLOR, sampleAt, SourceBadge } from '../components/common';
import { Timeline } from '../components/Timeline';
import { SilhouetteStrata, usePlayback } from '../components/playback';
import { sensing } from '../cv/sensing';
import { SensorView } from '../components/SensorView';
import { TrackingStatus } from './Live';
import { loadJSON } from '../store/local';
import type { PracticeEvent } from '../cv/types';

type View = 'intro' | 'guided' | 'portrait' | 'live';

interface Chapter { title: string; body: string; t: number; until: number }

function buildChapters(d: Loaded): Chapter[] {
  const ev = d.session.events.filter((e) => !e.dismissed);
  const dur = d.session.durationMs;
  const first = (k: PracticeEvent['kind']) => ev.find((e) => e.kind === k);
  const inst = first('instability');
  const hand = inst ? ev.find((e) => e.kind === 'hand-adjustment' && e.tStart >= inst.tStart - 2000) ?? first('hand-adjustment') : first('hand-adjustment');
  const stab = inst ? ev.find((e) => e.kind === 'stabilization' && e.tStart > inst.tStart) ?? first('stabilization') : first('stabilization');
  const ch: Chapter[] = [
    { title: 'The material, as the camera sees it', t: 0, until: Math.min(dur, 7000),
      body: 'A webcam watches the clay from the side. The system reads only its outline. The thin line behind the form is that measured silhouette. The form in front is an interpretation of it.' },
  ];
  if (inst) ch.push({ title: 'Instability', t: Math.max(0, inst.tStart - 1000), until: Math.min(dur, inst.tEnd + 1500),
    body: 'When off-centre mass turns with the wheel, the outline sways once per revolution. The mirror amplifies that sway so it can be seen. It does not say what is wrong or how to fix it.' });
  if (hand) ch.push({ title: 'Adjustment', t: Math.max(0, hand.tStart - 1500), until: Math.min(dur, hand.tEnd + 3000),
    body: 'Hands enter, brace and press. The system records only that movement happened near the clay. What the hands knew, the pressure, the timing and the feel of the clay pushing back, stays with the potter.' });
  if (stab) ch.push({ title: 'Stabilization', t: Math.max(0, stab.tStart - 1000), until: Math.min(dur, stab.tStart + 6000),
    body: 'The sway subsides. The silhouette holds still while the wheel keeps turning. The mirror grows calm. It shows that the material changed, not why.' });
  return ch;
}

export default function Exhibition() {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('intro');
  const [chapter, setChapter] = useState(0);
  const [hasCamera, setHasCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mapping = useMemo(() => ({ ...loadMapping(), smoothing: 0.86 }), []);
  const S = sensing();

  useEffect(() => { loadExhibitionSession().then(setData).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { S.listCameras().then((c) => setHasCamera(c.length > 0)).catch(() => {}); }, [S]);

  const dur = data?.session.durationMs ?? 1000;
  const pb = usePlayback(dur, videoRef, !!data?.videoUrl);
  const chapters = useMemo(() => (data ? buildChapters(data) : []), [data]);

  // intro: slow ambient loop of the documented session
  useEffect(() => {
    if (view === 'intro' && data) { pb.setRate(1); pb.seek(0); pb.setPlaying(true); }
  }, [view, data]);
  useEffect(() => {
    if (view === 'intro' && !pb.playing && data) { pb.seek(0); pb.setPlaying(true); }
  }, [pb.playing, view]);

  // guided: play each chapter's segment, then advance
  useEffect(() => {
    if (view !== 'guided' || !chapters[chapter]) return;
    pb.seek(chapters[chapter].t);
    pb.setPlaying(true);
  }, [view, chapter, chapters]);
  useEffect(() => {
    if (view !== 'guided') return;
    const c = chapters[chapter];
    if (c && pb.t >= c.until) {
      if (chapter < chapters.length - 1) setChapter(chapter + 1);
      else { pb.setPlaying(false); }
    }
  }, [pb.t, view, chapter, chapters]);

  // idle → back to intro
  const lastInput = useRef(performance.now());
  useEffect(() => {
    const bump = () => { lastInput.current = performance.now(); };
    window.addEventListener('pointerdown', bump); window.addEventListener('keydown', bump); window.addEventListener('pointermove', bump);
    const id = setInterval(() => { if (view !== 'intro' && performance.now() - lastInput.current > 150000) goIntro(); }, 5000);
    return () => { clearInterval(id); window.removeEventListener('pointerdown', bump); window.removeEventListener('keydown', bump); window.removeEventListener('pointermove', bump); };
  }, [view]);

  const goIntro = useCallback(() => {
    if (view === 'live') S.closeSource();
    setView('intro'); setChapter(0);
  }, [view, S]);

  const startLive = async () => {
    setView('live');
    try { await S.openCamera(loadJSON<string>('clayloop.lastCamera', '') || undefined); } catch { /* status shows error */ }
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') fullscreen();
      if (e.key === 'Escape' && !document.fullscreenElement) goIntro();
      if (view === 'guided') {
        if (e.key === 'ArrowRight') chapter < chapters.length - 1 ? setChapter(chapter + 1) : setView('portrait');
        if (e.key === 'ArrowLeft' && chapter > 0) setChapter(chapter - 1);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [view, chapter, chapters, goIntro]);

  const getSample = useCallback(() => (view === 'live' ? S.latest : data ? sampleAt(data.trace.samples, pb.tRef.current) : null), [view, data, S]);

  if (err) return <div className="ex" style={{ display: 'grid', placeItems: 'center' }}><p>Could not load the exhibition session: {err}</p></div>;

  const c = chapters[chapter];
  const prov = data && <SourceBadge source={data.session.source} provenance={data.session.provenance} />;
  return (
    <div className="ex stage" data-testid="exhibition" data-view={view}>
      <div className="canvas-wrap" style={view === 'intro' ? { left: '48%' } : view === 'portrait' ? { opacity: 0 } : undefined}>
        {view !== 'portrait' && <ClayMirror getSample={getSample} mapping={mapping} background="#14130f" />}
      </div>

      {data?.videoUrl && (
        <div className="ex-video" style={{ display: view === 'guided' ? 'block' : 'none' }}>
          <video ref={videoRef} src={data.videoUrl} muted playsInline preload="auto" />
          <div className="cap">Source footage · {data.session.source === 'synthetic' ? 'synthetic, generated for development' : data.session.camera.label || 'recorded session'}</div>
        </div>
      )}

      {view === 'intro' && (
        <div className="ex-intro">
          <div>
            <div className="caps" style={{ color: 'var(--stage-ink-2)' }}>UC Berkeley · Master of Design · 2026</div>
            <h1 style={{ marginTop: 18 }}>ClayLoop</h1>
            <div className="sub">An interactive material mirror for embodied expertise</div>
            <p className="concept">
              Centering clay on the wheel is learned through the hands, and a potter can know it without being able to say it.
              ClayLoop does not teach centering. A camera watches the clay. The system measures only what it can see, the sway of the clay's outline,
              and turns it into a form you can watch beside the real material. Then it offers the session back as a portrait to reflect on.
            </p>
            <div className="ex-choices">
              <button className="ex-choice" onClick={() => { setChapter(0); setView('guided'); }} data-testid="ex-guided">
                <b>Explore a documented session</b>
                <span>A recorded practice, replayed with its measurements</span>
              </button>
              <button className="ex-choice" onClick={startLive} disabled={!hasCamera} style={!hasCamera ? { opacity: 0.45 } : undefined} data-testid="ex-live">
                <b>Live mirror</b>
                <span>{hasCamera ? 'Uses the camera on the table' : 'No camera connected'}</span>
              </button>
            </div>
          </div>
          <div />
          <div style={{ position: 'absolute', left: '7vw', bottom: '4vh', display: 'flex', gap: 14, alignItems: 'center' }} className="small">
            {prov}<span style={{ color: 'var(--stage-ink-2)' }}>The form on the right is replaying this session.</span>
          </div>
          <div style={{ position: 'absolute', right: '7vw', bottom: '4vh', display: 'flex', gap: 10 }}>
            <button className="btn" onClick={fullscreen}>Full screen (F)</button>
            <Link className="btn" to="/">Leave exhibition</Link>
          </div>
        </div>
      )}

      {view === 'guided' && c && (
        <>
          <div className="ex-top">
            {prov}
            <span className="small" style={{ color: 'var(--stage-ink-2)' }}>{fmtTime(pb.t)}</span>
            <span className="spacer" />
            <button className="btn" onClick={goIntro}>Return</button>
          </div>
          <div className="ex-caption" data-testid="ex-caption">
            <div className="caps step">Part {chapter + 1} of {chapters.length + 1}</div>
            <h2>{c.title}</h2>
            <p>{c.body}</p>
          </div>
          <div className="ex-bar">
            <div className="dots">{[...chapters, null].map((_, i) => <i key={i} className={i === chapter ? 'on' : ''} />)}</div>
            <span className="spacer" />
            <button className="btn" onClick={() => setChapter(Math.max(0, chapter - 1))} disabled={chapter === 0}>Back</button>
            {chapter < chapters.length - 1
              ? <button className="btn primary" onClick={() => setChapter(chapter + 1)} data-testid="ex-next">Next</button>
              : <button className="btn primary" onClick={() => { pb.setPlaying(false); setView('portrait'); }} data-testid="ex-to-portrait">See the practice portrait</button>}
          </div>
        </>
      )}

      {view === 'portrait' && data && (
        <div className="ex-portrait" data-testid="ex-portrait">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="caps" style={{ color: 'var(--stage-ink-2)' }}>Part {chapters.length + 1} · Practice portrait</div>
              <h2 style={{ fontSize: 'clamp(28px,3vw,52px)', marginTop: 8 }}>{data.session.title}</h2>
              <div className="row small" style={{ marginTop: 8 }}>{prov}<span style={{ color: 'var(--stage-ink-2)' }}>{fmtTime(dur)} of practice</span></div>
            </div>
            <span className="spacer" />
            <button className="btn" onClick={() => { setChapter(0); setView('guided'); }}>Replay</button>
            <button className="btn primary" onClick={goIntro} data-testid="ex-return">Return to start</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '4vw', alignItems: 'center' }}>
            <div>
              <Timeline theme="stage" durationMs={dur} samples={data.trace.samples} events={data.session.events} currentT={pb.t} onSeek={pb.seek} height={220}
                onSelect={(e) => { const i = chapters.findIndex((ch) => e.tStart >= ch.t && e.tStart <= ch.until); setChapter(Math.max(0, i)); setView('guided'); pb.seek(Math.max(0, e.tStart - 800)); }} />
              <p className="small" style={{ color: 'var(--stage-ink-2)', maxWidth: '70ch' }}>
                Above the line: how much the clay's outline swayed. Shaded bands mark periods the system observed as unstable or settling.
                Below: movement near the clay. Dashed arcs are the system's tentative readings of sequence, not of cause. Select any mark to revisit that moment.
              </p>
            </div>
            <div>
              <SilhouetteStrata samples={data.trace.samples} currentT={dur} theme="stage" />
              <p className="small" style={{ color: 'var(--stage-ink-2)' }}>The measured outline across the session, earliest faintest.</p>
            </div>
          </div>
          <div className="row small" style={{ color: 'var(--stage-ink-2)', gap: 24 }}>
            {data.session.events.filter((e) => e.origin !== 'interpreted' && e.note).slice(0, 3).map((e) => (
              <span key={e.id} style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16, maxWidth: '40ch' }}>
                <span className="kind-dot" style={{ background: KIND_COLOR[e.kind], marginRight: 8 }} />“{e.note}” <span style={{ fontStyle: 'normal', fontSize: 12 }}>· {fmtTime(e.tStart)}</span>
              </span>
            ))}
            {data.session.notes && <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16, maxWidth: '50ch' }}>“{data.session.notes}”</span>}
            <span className="spacer" />
            <span>ClayLoop makes no judgement of skill. Its readings are provisional and open to the practitioner's revision.</span>
          </div>
        </div>
      )}

      {view === 'live' && (
        <>
          <div className="ex-top">
            <span className="badge camera">Live sensing</span>
            <TrackingStatus />
            <span className="spacer" />
            <button className="btn" onClick={goIntro}>Return</button>
          </div>
          <div className="ex-video" style={{ padding: 0 }}>
            <SensorView className="preview" />
            <div className="cap">What the camera measures: the silhouette edges</div>
          </div>
          <div className="ex-caption">
            <div className="caps step">Live</div>
            <h2>Move the clay</h2>
            <p>Turn the banding wheel, or nudge the clay off centre. The form responds to the outline the camera sees. If your hands cover the clay, it holds the last shape it saw.</p>
          </div>
        </>
      )}
    </div>
  );
}
