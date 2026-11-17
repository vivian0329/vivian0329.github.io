import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadAnySession, Loaded } from '../store/demo';
import { fmtDate, fmtTime, SourceBadge } from '../components/common';
import { SilhouetteStrata } from '../components/playback';

const COLORS = ['#8f6d55', '#55697f', '#6e8676', '#9a6e8a'];

export default function Compare() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const [items, setItems] = useState<Loaded[] | null>(null);
  const [axis, setAxis] = useState<'relative' | 'absolute'>('relative');
  useEffect(() => {
    Promise.all(ids.map((id) => loadAnySession(id))).then((x) => setItems(x.filter(Boolean) as Loaded[]));
  }, [params]);

  if (!items) return <div className="page muted">Loading…</div>;
  if (items.length < 2) return <div className="page"><h1>Choose at least two sessions</h1><p><Link to="/library">Back to the library</Link></p></div>;

  const maxDur = Math.max(...items.map((i) => i.session.durationMs));
  const maxW = Math.max(0.08, ...items.flatMap((i) => i.trace.samples.map((s) => s.wobble)));
  const VW = 1000, VH = 260;
  return (
    <div className="page portrait" data-testid="compare">
      <div>
        <div className="row small muted" style={{ marginBottom: 6 }}><Link to="/library" className="muted">Library</Link><span>/</span><span>Compare</span></div>
        <h1 style={{ fontSize: 40 }}>Patterns across sessions</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>Oscillation over time for each session, overlaid. Differences in camera position, lighting and clay body change these values, so read them as patterns within a practice, not as comparisons of skill.</p>
      </div>
      <div className="row">
        <div className="tabs" style={{ margin: 0 }}>
          <button className={axis === 'relative' ? 'on' : ''} onClick={() => setAxis('relative')}>Proportion of session</button>
          <button className={axis === 'absolute' ? 'on' : ''} onClick={() => setAxis('absolute')}>Elapsed time</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 260 }} preserveAspectRatio="none" data-testid="compare-chart">
        <line x1={0} x2={VW} y1={VH - 1} y2={VH - 1} stroke="#d8d2c7" vectorEffect="non-scaling-stroke" />
        {items.map((it, k) => {
          const d = it.session.durationMs || 1;
          const pts = it.trace.samples.filter((_, i) => i % 2 === 0).map((s) => {
            const x = axis === 'relative' ? (s.t / d) * VW : (s.t / maxDur) * VW;
            return `${x.toFixed(1)},${(VH - 4 - (Math.min(maxW, s.wobble) / maxW) * (VH - 12)).toFixed(1)}`;
          });
          return <polyline key={it.session.id} points={pts.join(' ')} fill="none" stroke={COLORS[k]} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.9} />;
        })}
      </svg>
      <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: -16 }}>
        <span>{axis === 'relative' ? 'start' : '0:00'}</span><span>{axis === 'relative' ? 'end' : fmtTime(maxDur)}</span>
      </div>
      <div className="cards">
        {items.map((it, k) => (
          <div className="card" key={it.session.id}>
            <div className="row"><span className="kind-dot" style={{ background: COLORS[k] }} /><SourceBadge source={it.session.source} /></div>
            <h3><Link to={`/session/${it.session.id}`} style={{ textDecoration: 'none' }}>{it.session.title}</Link></h3>
            <div className="small muted">{fmtDate(it.session.createdAt)} · {fmtTime(it.session.durationMs)}</div>
            <SilhouetteStrata samples={it.trace.samples} currentT={it.session.durationMs} n={10} />
            <dl className="facts" style={{ gridTemplateColumns: 'repeat(2, auto)' }}>
              <dt>Instability periods</dt><dd>{it.session.events.filter((e) => e.kind === 'instability').length}</dd>
              <dt>Stabilization periods</dt><dd>{it.session.events.filter((e) => e.kind === 'stabilization').length}</dd>
              <dt>Movement onsets</dt><dd>{it.session.events.filter((e) => e.kind === 'hand-adjustment').length}</dd>
              <dt>Clay visible</dt><dd>{Math.round(it.session.trackedFraction * 100)}%</dd>
            </dl>
            {it.session.notes && <p className="small" style={{ margin: 0, fontFamily: 'var(--serif)', fontStyle: 'italic' }}>“{it.session.notes}”</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
