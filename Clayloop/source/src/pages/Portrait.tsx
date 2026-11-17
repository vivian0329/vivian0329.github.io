import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClayMirror } from '../three/ClayMirror';
import { loadMapping } from '../three/mapping';
import { Timeline } from '../components/Timeline';
import { SilhouetteStrata, usePlayback } from '../components/playback';
import { download, fmtDate, fmtTime, KIND_COLOR, KIND_LABEL, Modal, sampleAt, SourceBadge, toast } from '../components/common';
import { loadAnySession, Loaded } from '../store/demo';
import { deleteSession, exportSession, getVideo, importSession, setFeatured, updateSession } from '../store/db';
import type { PracticeEvent } from '../cv/types';
import { nearestThumb, redetect } from '../store/build';

type Filter = 'all' | 'observed' | 'interpreted' | 'user';

export default function Portrait() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  useEffect(() => {
    let url: string | null = null;
    loadAnySession(id).then((d) => { setData(d); url = d?.stored ? d.videoUrl : null; }).catch(() => setData(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (data === undefined) return <div className="page muted">Loading session…</div>;
  if (data === null) return <div className="page"><h1>Session not found</h1><p><Link to="/library">Back to the library</Link></p></div>;
  return <PortraitInner key={data.session.id} data={data} onChange={(s) => setData({ ...data, session: s })} nav={nav} />;
}

function PortraitInner({ data, onChange, nav }: { data: Loaded; onChange: (s: Loaded['session']) => void; nav: ReturnType<typeof useNavigate> }) {
  const { session, trace, videoUrl, stored } = data;
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = !!videoUrl;
  const pb = usePlayback(session.durationMs, videoRef, hasVideo);
  const mapping = useMemo(loadMapping, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDel, setConfirmDel] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [title, setTitle] = useState(session.title);
  const [notes, setNotes] = useState(session.notes);

  const persist = async (patch: Partial<Loaded['session']>) => {
    if (!stored) { toast('Import this session into the library to annotate it.'); return; }
    const next = await updateSession(session.id, patch);
    onChange(next);
  };
  const setEvent = (eid: string, patch: Partial<PracticeEvent>) =>
    persist({ events: session.events.map((e) => (e.id === eid ? { ...e, ...patch } : e)) });

  const addMarker = () => {
    const t = Math.round(pb.tRef.current);
    const e: PracticeEvent = {
      id: `mark-${Date.now().toString(36)}`, kind: 'marker', origin: 'user', tStart: t, tEnd: t,
      label: 'Marked moment', detail: 'Added by the practitioner during reflection.', note: '', tags: [], thumb: nearestThumb(trace.thumbs, t),
    };
    persist({ events: [...session.events, e].sort((a, b) => a.tStart - b.tStart) }).then(() => setSelected(e.id));
  };

  const selectEvent = (e: PracticeEvent) => {
    setSelected(e.id);
    pb.seek(Math.max(0, e.tStart - (e.kind === 'marker' ? 0 : 800)));
  };

  const visible = session.events.filter((e) => filter === 'all' || e.origin === filter);
  const count = (k: PracticeEvent['kind']) => session.events.filter((e) => e.kind === k && !e.dismissed).length;

  const doExport = async () => {
    const f = stored ? await exportSession(session.id) : { format: 'clayloop-session', version: 1, exportedAt: new Date().toISOString(), session, trace };
    download(`${session.id}.clayloop.json`, JSON.stringify(f));
  };
  const doExportVideo = async () => {
    const blob = stored ? await getVideo(session.id) : videoUrl ? await (await fetch(videoUrl)).blob() : null;
    if (blob) download(`${session.id}.${(blob.type || session.videoMime).includes('mp4') ? 'mp4' : 'webm'}`, blob);
  };
  const doExportCsv = () => {
    const head = 't_ms,tracking,confidence,wobble_est,frequency_est_hz,lean_est,offset_meas,height_meas,mean_radius_meas,motion_meas,hands,hand_speed';
    const rows = trace.samples.map((s) => [s.t, s.tracking, s.confidence.toFixed(3), s.wobble.toFixed(4), s.frequency.toFixed(3), s.lean.toFixed(4), s.offset.toFixed(4), s.height.toFixed(4), s.meanRadius.toFixed(4), s.motion.toFixed(3), s.hands, s.handSpeed.toFixed(3)].join(','));
    download(`${session.id}.samples.csv`, [head, ...rows].join('\n'), 'text/csv');
  };

  const cur = sampleAt(trace.samples, pb.t);
  return (
    <div className="page portrait" data-testid="portrait">
      <div className="portrait-head">
        <div>
          <div className="row small muted" style={{ marginBottom: 6 }}>
            <Link to="/library" className="muted">Library</Link><span>/</span><span>Practice Portrait</span>
          </div>
          <input className="title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== session.title && persist({ title })} aria-label="Session title" data-testid="portrait-title" readOnly={!stored} />
          <div className="row small" style={{ marginTop: 8, color: 'var(--ink-2)' }}>
            <SourceBadge source={session.source} provenance={session.provenance} />
            <span>{fmtDate(session.createdAt)}</span><span>·</span><span>{fmtTime(session.durationMs)}</span>
            {session.practitioner && <><span>·</span><span>{session.practitioner}</span></>}
            {session.experience && <span className="muted">({session.experience})</span>}
          </div>
          <p className="small muted" style={{ margin: '6px 0 0', maxWidth: '80ch' }}>{session.provenance}</p>
        </div>
        <div className="row">
          {!stored && (
            <button className="btn" onClick={async () => { const s = await importSession({ format: 'clayloop-session', version: 1, exportedAt: '', session, trace }, videoUrl ? await (await fetch(videoUrl)).blob() : undefined); toast('Imported into library'); nav(`/session/${s.id}`); }}>
              Import to library to annotate
            </button>
          )}
          {stored && (
            <button className="btn" onClick={async () => { await setFeatured(session.featured ? null : session.id); onChange({ ...session, featured: !session.featured }); toast(session.featured ? 'No longer the exhibition session' : 'Set as the exhibition session'); }} data-testid="btn-feature">
              {session.featured ? '★ Exhibition session' : 'Use in exhibition'}
            </button>
          )}
          <button className="btn" onClick={doExport} data-testid="btn-export">Export JSON</button>
          <button className="btn" onClick={doExportCsv}>CSV</button>
          {hasVideo && <button className="btn" onClick={doExportVideo}>Video</button>}
          {stored && <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete</button>}
        </div>
      </div>

      <div className="portrait-main">
        <div className="replay" data-testid="replay">
          <ClayMirror getSample={() => sampleAt(trace.samples, pb.tRef.current)} mapping={mapping} framing="compact" paused={!pb.playing} />
          <div className="overlay-tl">
            <div className="caps" style={{ color: 'var(--stage-ink-2)' }}>Replay of the material mirror</div>
            {cur?.tracking === 'lost' && <div className="hold-note">Clay not visible here.</div>}
          </div>
          <div className="overlay-tr small" style={{ color: 'var(--stage-ink-2)' }}>
            {cur && <>wobble {(cur.wobble * 100).toFixed(1)}% · {cur.frequency > 0.3 ? `${cur.frequency.toFixed(2)} Hz` : '—'}</>}
          </div>
        </div>
        <div className="video-box">
          {hasVideo ? (
            <video ref={videoRef} src={videoUrl!} playsInline muted preload="auto" style={session.calibration.mirror ? { transform: 'scaleX(-1)' } : undefined} data-testid="portrait-video" />
          ) : (
            <div className="none">No video was recorded for this session.<br />The measurements and the mirror replay are still available.</div>
          )}
        </div>
      </div>

      <div className="transport">
        <button className="btn primary" onClick={pb.toggle} data-testid="btn-play">{pb.playing ? 'Pause' : 'Play'}</button>
        <span className="small" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 96 }} data-testid="playhead">{fmtTime(pb.t)} / {fmtTime(session.durationMs)}</span>
        <select className="input" style={{ width: 80 }} value={pb.rate} onChange={(e) => pb.setRate(Number(e.target.value))} aria-label="Playback speed">
          {[0.5, 1, 2, 4].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <span className="spacer" />
        <button className="btn" onClick={addMarker} disabled={!stored} data-testid="btn-marker">Mark this moment</button>
      </div>

      <Timeline durationMs={session.durationMs} samples={trace.samples} events={session.events} currentT={pb.t} onSeek={pb.seek} onSelect={selectEvent} selectedId={selected} />

      <div className="cols">
        <div className="panel">
          <div className="row">
            <h2>Moments</h2>
            <span className="spacer" />
            <div className="tabs" style={{ margin: 0, border: 'none' }}>
              {(['all', 'observed', 'interpreted', 'user'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'observed' ? 'Observed' : f === 'interpreted' ? 'System readings' : 'Yours'}
                </button>
              ))}
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            <b>Observed</b> moments are threshold crossings in the measurements, relative to this session's own range.
            <b> System readings</b> are tentative and describe sequence only. Keep, revise or dismiss them. <b>Yours</b> are the moments you marked.
          </p>
          <div className="events" data-testid="events">
            {visible.length === 0 && <div className="muted small">No moments in this view.</div>}
            {visible.map((e) => (
              <EventCard key={e.id} e={e} active={selected === e.id} onSelect={() => selectEvent(e)} stored={stored}
                onNote={(note) => setEvent(e.id, { note })}
                onTags={(tags) => setEvent(e.id, { tags })}
                onDismiss={() => setEvent(e.id, { dismissed: !e.dismissed })}
                onDelete={() => persist({ events: session.events.filter((x) => x.id !== e.id) })}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 28 }}>
          <div className="panel">
            <h2>Reflection</h2>
            <textarea className="input" style={{ minHeight: 120 }} placeholder="What did you notice? What did the clay seem to ask for?" value={notes}
              onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== session.notes && persist({ notes })} readOnly={!stored} data-testid="session-notes" />
            <div className="row" style={{ gap: 6 }}>
              {session.tags.map((t) => <span className="chip" key={t}>{t}{stored && <span className="x" onClick={() => persist({ tags: session.tags.filter((x) => x !== t) })}>×</span>}</span>)}
              {stored && (
                <input className="input" style={{ width: 160, padding: '4px 10px', borderRadius: 999 }} placeholder="+ tag" value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && tagDraft.trim()) { persist({ tags: [...new Set([...session.tags, tagDraft.trim()])] }); setTagDraft(''); } }}
                  data-testid="session-tag-input" />
              )}
            </div>
          </div>
          <div className="panel">
            <h2>How the form changed</h2>
            <SilhouetteStrata samples={trace.samples} currentT={pb.t} />
            <p className="small muted" style={{ margin: 0 }}>Measured silhouettes at evenly spaced moments, earliest faintest. The dark outline is the moment at the playhead. Shapes are the camera's 2D view, not a 3D reconstruction.</p>
          </div>
          <div className="panel">
            <h2>Record</h2>
            <dl className="facts">
              <dt>Duration</dt><dd>{fmtTime(session.durationMs)}</dd>
              <dt>Clay visible</dt><dd>{Math.round(session.trackedFraction * 100)}% of time</dd>
              <dt>Instability</dt><dd>{count('instability')}</dd>
              <dt>Stabilization</dt><dd>{count('stabilization')}</dd>
              <dt>Movement</dt><dd>{count('hand-adjustment')}</dd>
              <dt>Readings</dt><dd>{count('coupling')}</dd>
              <dt>Samples</dt><dd>{trace.samples.length}</dd>
              <dt>Camera</dt><dd>{session.camera.label || '—'}</dd>
            </dl>
            <p className="small muted" style={{ margin: 0 }}>Counts describe this recording. They are not a measure of skill.</p>
            {stored && (
              <button className="btn" style={{ justifySelf: 'start' }} onClick={() => { persist({ events: redetect(session, trace) }); toast('Moments re-detected. Your markers were kept.'); }}>
                Re-detect moments
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmDel && (
        <Modal title="Delete this session?" onClose={() => setConfirmDel(false)}
          actions={<><button className="btn" onClick={() => setConfirmDel(false)}>Cancel</button>
            <button className="btn danger" data-testid="confirm-delete" onClick={async () => { await deleteSession(session.id); toast('Session deleted'); nav('/library'); }}>Delete permanently</button></>}>
          <p className="small" style={{ margin: 0 }}>The measurements, video and your annotations for “{session.title}” will be removed from this computer. Export first if you want to keep a copy.</p>
        </Modal>
      )}
    </div>
  );
}

function EventCard({ e, active, onSelect, stored, onNote, onTags, onDismiss, onDelete }: {
  e: PracticeEvent; active: boolean; onSelect: () => void; stored: boolean;
  onNote: (n: string) => void; onTags: (t: string[]) => void; onDismiss: () => void; onDelete: () => void;
}) {
  const [note, setNote] = useState(e.note);
  const [tag, setTag] = useState('');
  return (
    <div className={`event ${active ? 'active' : ''} ${e.dismissed ? 'dismissed' : ''}`} onClick={onSelect} data-testid={`event-${e.kind}`}>
      {e.thumb ? <img src={e.thumb} alt="" /> : <div className="noimg" />}
      <div>
        <div className="meta">
          <span className="kind-dot" style={{ background: KIND_COLOR[e.kind] }} />
          <b style={{ fontWeight: 500 }}>{e.label}</b>
          <span className={`origin ${e.origin}`}>{e.origin === 'observed' ? 'Observed' : e.origin === 'interpreted' ? 'System reading' : 'Yours'}</span>
          <span className="muted">{fmtTime(e.tStart)}{e.tEnd > e.tStart + 500 ? `–${fmtTime(e.tEnd)}` : ''}</span>
          <span className="muted small">{KIND_LABEL[e.kind]}</span>
        </div>
        <p className="detail">{e.detail}</p>
        {active && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }} onClick={(ev) => ev.stopPropagation()}>
            <textarea className="input" placeholder={stored ? 'Your note on this moment…' : 'Import to annotate'} value={note} readOnly={!stored}
              onChange={(ev) => setNote(ev.target.value)} onBlur={() => note !== e.note && onNote(note)} data-testid="event-note" />
            <div className="row" style={{ gap: 6 }}>
              {e.tags.map((t) => <span className="chip" key={t}>{t}{stored && <span className="x" onClick={() => onTags(e.tags.filter((x) => x !== t))}>×</span>}</span>)}
              {stored && <input className="input" style={{ width: 140, padding: '3px 10px', borderRadius: 999 }} placeholder="+ tag" value={tag} onChange={(ev) => setTag(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && tag.trim()) { onTags([...new Set([...e.tags, tag.trim()])]); setTag(''); } }} data-testid="event-tag-input" />}
              <span className="spacer" />
              {stored && e.origin === 'interpreted' && <button className="btn" onClick={onDismiss}>{e.dismissed ? 'Restore reading' : 'Dismiss reading'}</button>}
              {stored && e.origin === 'user' && <button className="btn danger" onClick={onDelete}>Remove marker</button>}
            </div>
          </div>
        )}
        {!active && e.note && <p className="detail" style={{ color: 'var(--ink)', fontStyle: 'italic' }}>“{e.note}”</p>}
      </div>
    </div>
  );
}
