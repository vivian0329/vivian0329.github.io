import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteSession, exportSession, importSession, listSessions, SessionRecord } from '../store/db';
import { DEMO_ID } from '../store/demo';
import { download, fmtDate, fmtTime, Modal, SourceBadge, Sparkline, toast } from '../components/common';

export default function Library() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [del, setDel] = useState<SessionRecord | null>(null);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const reload = () => listSessions().then(setSessions).catch(() => setSessions([]));
  useEffect(() => { reload(); }, []);

  const allTags = [...new Set((sessions ?? []).flatMap((s) => [...s.tags, ...s.events.flatMap((e) => e.tags)]))].sort();
  const shown = (sessions ?? []).filter((s) =>
    (!tag || s.tags.includes(tag) || s.events.some((e) => e.tags.includes(tag))) &&
    (!q || (s.title + ' ' + s.notes + ' ' + s.practitioner).toLowerCase().includes(q.toLowerCase())));

  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 4 ? x : [...x, id]));

  const exportAll = async () => {
    const files = await Promise.all((sessions ?? []).map((s) => exportSession(s.id)));
    download(`clayloop-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'clayloop-library', version: 1, sessions: files }));
  };

  const onImport = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const list = j.format === 'clayloop-library' ? j.sessions : [j];
      for (const x of list) await importSession(x);
      toast(`Imported ${list.length} session${list.length === 1 ? '' : 's'} (measurements and notes; video files are not part of JSON exports)`);
      reload();
    } catch (e) {
      toast(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="page" data-testid="library">
      <div className="lib-head">
        <div>
          <div className="caps muted">Practice Library</div>
          <h1>Sessions kept on this computer</h1>
        </div>
        <span className="spacer" />
        <input className="input" style={{ width: 220 }} placeholder="Search titles and notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <button className="btn" onClick={exportAll} disabled={!sessions?.length}>Export all</button>
        <button className="btn primary" disabled={sel.length < 2} onClick={() => nav(`/compare?ids=${sel.join(',')}`)} data-testid="btn-compare">
          Compare{sel.length ? ` (${sel.length})` : ''}
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
      </div>

      {allTags.length > 0 && (
        <div className="row" style={{ gap: 6, marginBottom: 20 }}>
          <span className="small muted">Tags</span>
          {allTags.map((t) => <button key={t} className={`chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(tag === t ? null : t)} style={{ cursor: 'pointer', background: tag === t ? undefined : 'transparent' }}>{t}</button>)}
        </div>
      )}

      {sessions === null && <p className="muted">Opening the archive…</p>}
      {sessions && sessions.length === 0 && (
        <div className="empty-state">
          <h2 className="serif">No sessions yet</h2>
          <p style={{ margin: 0, maxWidth: '48ch' }}>Sessions you record in Live Practice are stored here, in this browser's database on this computer. They are still here after you restart.</p>
          <div className="row"><Link className="btn primary" to="/live">Start a practice session</Link><Link className="btn" to={`/session/${DEMO_ID}`}>Open the synthetic demo</Link></div>
        </div>
      )}

      <div className="cards" data-testid="session-cards">
        {shown.map((s) => (
          <div className={`card ${sel.includes(s.id) ? 'selected' : ''}`} key={s.id} data-testid="session-card">
            <Link className="cover" to={`/session/${s.id}`} aria-label={`Open ${s.title}`} />
            <div className="row on-top" style={{ pointerEvents: 'none' }}>
              <SourceBadge source={s.source} provenance={s.provenance} />
              {s.featured && <span className="badge">★ exhibition</span>}
              <span className="spacer" />
              <label className="small muted" style={{ pointerEvents: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} /> compare
              </label>
            </div>
            <h3>{s.title}</h3>
            <div className="small muted">{fmtDate(s.createdAt)} · {fmtTime(s.durationMs)}{s.practitioner ? ` · ${s.practitioner}` : ''}</div>
            <div style={{ color: '#8f6d55' }}><Sparkline data={s.sparkline} /></div>
            <div className="row small muted" style={{ gap: 10 }}>
              <span>{s.events.filter((e) => e.kind === 'instability').length} instability</span>
              <span>{s.events.filter((e) => e.kind === 'stabilization').length} stabilization</span>
              <span>{s.events.filter((e) => e.origin === 'user').length} markers</span>
              <span>{s.hasVideo ? 'video' : 'no video'}</span>
            </div>
            {s.tags.length > 0 && <div className="row" style={{ gap: 4 }}>{s.tags.map((t) => <span className="chip" key={t}>{t}</span>)}</div>}
            {s.notes && <p className="small" style={{ margin: 0, color: 'var(--ink-2)', fontFamily: 'var(--serif)', fontStyle: 'italic' }}>“{s.notes.slice(0, 140)}{s.notes.length > 140 ? '…' : ''}”</p>}
            <div className="row on-top">
              <span className="spacer" />
              <button className="btn danger" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setDel(s)} data-testid="btn-delete">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {sessions && sessions.length > 0 && (
        <p className="small muted" style={{ marginTop: 32 }}>
          Also available: <Link to={`/session/${DEMO_ID}`}>the bundled synthetic demo session</Link> (generated footage, labelled as such).
        </p>
      )}

      {del && (
        <Modal title="Delete this session?" onClose={() => setDel(null)}
          actions={<><button className="btn" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" data-testid="confirm-delete" onClick={async () => { await deleteSession(del.id); setDel(null); setSel((x) => x.filter((y) => y !== del.id)); toast('Session deleted'); reload(); }}>Delete permanently</button></>}>
          <p className="small" style={{ margin: 0 }}>“{del.title}”: its measurements, video and annotations will be removed from this computer.</p>
        </Modal>
      )}
    </div>
  );
}
