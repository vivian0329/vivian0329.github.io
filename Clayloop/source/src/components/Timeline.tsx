/**
 * Practice timeline. Lanes, top to bottom:
 *   material  : estimated oscillation (mirrored area) with observed instability / stabilization bands
 *   visibility: spans where the clay could not be read
 *   movement  : hand / motion activity and observed movement onsets
 *   readings  : tentative system interpretations (dashed) and the practitioner's own markers
 */
import { useMemo, useRef } from 'react';
import type { PracticeEvent, Sample } from '../cv/types';
import { fmtTime, KIND_COLOR } from './common';

export interface TimelineProps {
  durationMs: number;
  samples: Sample[];
  events: PracticeEvent[];
  currentT: number;
  onSeek: (t: number) => void;
  onSelect?: (e: PracticeEvent) => void;
  selectedId?: string | null;
  theme?: 'paper' | 'stage';
  height?: number;
}

const W = 1000;

export function Timeline({ durationMs, samples, events, currentT, onSeek, onSelect, selectedId, theme = 'paper', height = 190 }: TimelineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const dur = Math.max(1000, durationMs);
  const X = (t: number) => (t / dur) * W;
  const ink = theme === 'paper' ? '#57524b' : '#a39b8f';
  const rule = theme === 'paper' ? '#d8d2c7' : '#34302a';
  const lane = { matTop: 18, matH: 78, visY: 104, visH: 8, movY: 122, movH: 26, readY: 160, readH: 18 };
  const H = height;

  const { matPath, movPath } = useMemo(() => {
    if (!samples.length) return { matPath: '', movPath: '' };
    const step = Math.max(1, Math.floor(samples.length / 600));
    const max = Math.max(0.08, ...samples.map((s) => s.wobble));
    const mid = lane.matTop + lane.matH / 2;
    const up: string[] = [], down: string[] = [], mv: string[] = [];
    const usesHands = samples.some((s) => s.hands > 0);
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      const a = (Math.min(max, s.wobble) / max) * (lane.matH / 2 - 2);
      up.push(`${X(s.t).toFixed(1)},${(mid - a).toFixed(1)}`);
      down.push(`${X(s.t).toFixed(1)},${(mid + a).toFixed(1)}`);
      const act = usesHands ? (s.hands > 0 ? Math.min(1, 0.4 + s.handSpeed) : 0) : Math.min(1, s.motion * 2);
      mv.push(`${X(s.t).toFixed(1)},${(lane.movY + lane.movH - act * lane.movH).toFixed(1)}`);
    }
    const matPath = `M${up.join(' L')} L${down.reverse().join(' L')} Z`;
    const first = X(samples[0].t), last = X(samples[samples.length - 1].t);
    const movPath = `M${first},${lane.movY + lane.movH} L${mv.join(' L')} L${last},${lane.movY + lane.movH} Z`;
    return { matPath, movPath };
  }, [samples, dur]);

  const seekFromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)));
  };

  const ticks = useMemo(() => {
    const stepS = dur > 600000 ? 120 : dur > 240000 ? 60 : dur > 90000 ? 30 : dur > 30000 ? 10 : 5;
    const out: number[] = [];
    for (let t = 0; t <= dur; t += stepS * 1000) out.push(t);
    return out;
  }, [dur]);

  const vis = events.filter((e) => !e.dismissed || e.origin !== 'interpreted');
  return (
    <div className="timeline" data-testid="timeline">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H, cursor: 'pointer' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); seekFromEvent(e); }}
        onPointerMove={(e) => { if (e.buttons) seekFromEvent(e); }}
        role="slider"
        aria-label="Session timeline"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={currentT}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(dur, currentT + 2000));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentT - 2000));
        }}
      >
        {/* instability & stabilization bands */}
        {vis.filter((e) => e.kind === 'instability' || e.kind === 'stabilization').map((e) => (
          <rect key={e.id} x={X(e.tStart)} width={Math.max(1.5, X(e.tEnd) - X(e.tStart))} y={lane.matTop} height={lane.matH}
            fill={KIND_COLOR[e.kind]} opacity={e.id === selectedId ? 0.28 : 0.13}
            onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(e); }} />
        ))}
        <line x1={0} x2={W} y1={lane.matTop + lane.matH / 2} y2={lane.matTop + lane.matH / 2} stroke={rule} vectorEffect="non-scaling-stroke" />
        <path d={matPath} fill={theme === 'paper' ? '#8f6d55' : '#c99a74'} opacity={0.85} />
        {/* visibility lane */}
        <rect x={0} width={W} y={lane.visY} height={lane.visH} fill={rule} opacity={0.4} />
        {vis.filter((e) => e.kind === 'tracking-loss').map((e) => (
          <rect key={e.id} x={X(e.tStart)} width={Math.max(2, X(e.tEnd) - X(e.tStart))} y={lane.visY} height={lane.visH} fill={KIND_COLOR['tracking-loss']}
            onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(e); }} />
        ))}
        {/* movement lane */}
        <path d={movPath} fill={theme === 'paper' ? '#6c7b8f' : '#8ca0ba'} opacity={0.45} />
        {vis.filter((e) => e.kind === 'hand-adjustment').map((e) => (
          <g key={e.id} onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(e); }}>
            <rect x={X(e.tStart) - 4} width={8} y={lane.movY - 4} height={lane.movH + 8} fill="transparent" />
            <line x1={X(e.tStart)} x2={X(e.tStart)} y1={lane.movY - 2} y2={lane.movY + lane.movH} stroke={KIND_COLOR['hand-adjustment']} strokeWidth={e.id === selectedId ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {/* readings lane: interpretations (dashed arcs) and user markers */}
        {vis.filter((e) => e.kind === 'coupling' && !e.dismissed).map((e) => (
          <g key={e.id} onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(e); }}>
            <path d={`M${X(e.tStart)},${lane.readY + lane.readH} Q${(X(e.tStart) + X(e.tEnd)) / 2},${lane.readY - 4} ${X(e.tEnd)},${lane.readY + lane.readH}`}
              fill="none" stroke={KIND_COLOR.coupling} strokeDasharray="4 3" strokeWidth={e.id === selectedId ? 2.5 : 1.3} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {vis.filter((e) => e.kind === 'marker').map((e) => (
          <g key={e.id} onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.(e); }}>
            <line x1={X(e.tStart)} x2={X(e.tStart)} y1={lane.matTop} y2={lane.readY + lane.readH} stroke={theme === 'paper' ? '#2f2b26' : '#ece6dc'} strokeWidth={e.id === selectedId ? 2.5 : 1} vectorEffect="non-scaling-stroke" />
            <circle cx={X(e.tStart)} cy={lane.readY + lane.readH - 3} r={4} fill={theme === 'paper' ? '#2f2b26' : '#ece6dc'} />
          </g>
        ))}
        {/* ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={H - 10} y2={H - 6} stroke={ink} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {/* playhead */}
        <line x1={X(currentT)} x2={X(currentT)} y1={4} y2={H - 12} stroke={theme === 'paper' ? '#1d1b18' : '#ece6dc'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="row small" style={{ justifyContent: 'space-between', color: ink, marginTop: -4 }}>
        {ticks.filter((_, i) => i % Math.ceil(ticks.length / 8) === 0).map((t) => <span key={t}>{fmtTime(t)}</span>)}
      </div>
      <div className="tl-legend">
        <span><i style={{ background: theme === 'paper' ? '#8f6d55' : '#c99a74' }} />Oscillation (estimated)</span>
        <span><i style={{ background: KIND_COLOR.instability, opacity: 0.5 }} />Instability (observed)</span>
        <span><i style={{ background: KIND_COLOR.stabilization, opacity: 0.5 }} />Stabilization (observed)</span>
        <span><i style={{ background: KIND_COLOR['tracking-loss'] }} />Clay not visible</span>
        <span><i style={{ background: KIND_COLOR['hand-adjustment'] }} />Movement / hands (observed)</span>
        <span><i style={{ border: `1px dashed ${KIND_COLOR.coupling}`, background: 'transparent' }} />System reading (tentative)</span>
        <span><i style={{ background: theme === 'paper' ? '#2f2b26' : '#ece6dc', borderRadius: '50%' }} />Your marker</span>
      </div>
    </div>
  );
}
