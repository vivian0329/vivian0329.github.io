import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Sample } from '../cv/types';
import { PROFILE_BINS } from '../cv/types';

/**
 * Playback clock for a recorded session. When a video is present it is the master clock
 * (so the 3D replay stays synchronised with the footage); otherwise an internal clock runs.
 */
export function usePlayback(durationMs: number, videoRef: RefObject<HTMLVideoElement | null>, hasVideo: boolean) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = playing;

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = now - last; last = now;
      const v = videoRef.current;
      if (hasVideo && v && v.readyState >= 1 && Number.isFinite(v.duration)) {
        tRef.current = v.currentTime * 1000;
        if (v.ended && playingRef.current) setPlaying(false);
      } else if (playingRef.current) {
        tRef.current = Math.min(durationMs, tRef.current + dt * rate);
        if (tRef.current >= durationMs) setPlaying(false);
      }
      setT((prev) => (Math.abs(prev - tRef.current) > 30 ? tRef.current : prev));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [durationMs, hasVideo, rate, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasVideo) return;
    v.playbackRate = rate;
    if (playing) v.play().catch(() => setPlaying(false)); else v.pause();
  }, [playing, rate, hasVideo, videoRef]);

  const seek = useCallback((ms: number) => {
    const c = Math.max(0, Math.min(durationMs, ms));
    tRef.current = c;
    setT(c);
    const v = videoRef.current;
    if (hasVideo && v) v.currentTime = c / 1000;
  }, [durationMs, hasVideo, videoRef]);

  const toggle = useCallback(() => {
    if (!playingRef.current && tRef.current >= durationMs - 50) seek(0);
    setPlaying((p) => !p);
  }, [durationMs, seek]);

  return { t, tRef, playing, setPlaying, toggle, seek, rate, setRate };
}

/**
 * Profile drift: the measured silhouette at evenly spaced moments, drawn on top of each other,
 * earliest faintest. Shows how the material's form changed across the session.
 */
export function SilhouetteStrata({ samples, currentT, theme = 'paper', n = 14 }: { samples: Sample[]; currentT: number; theme?: 'paper' | 'stage'; n?: number }) {
  const ok = samples.filter((s) => s.tracking !== 'lost' && s.height > 0.02);
  if (ok.length < 2) return <svg className="strata" />;
  const picks: Sample[] = [];
  for (let i = 0; i < n; i++) picks.push(ok[Math.floor((i * (ok.length - 1)) / (n - 1))]);
  const cur = ok.reduce((b, s) => (Math.abs(s.t - currentT) < Math.abs(b.t - currentT) ? s : b), ok[0]);
  const maxH = Math.max(...ok.map((s) => s.height));
  const maxR = Math.max(...ok.map((s) => Math.max(...s.profile)));
  const VW = 400, VH = 220, sc = Math.min((VH - 20) / maxH, (VW / 2 - 20) / maxR);
  const path = (s: Sample) => {
    const pts: string[] = [];
    for (let b = 0; b < PROFILE_BINS; b++) pts.push(`${VW / 2 + (s.offset + s.profile[b]) * sc},${VH - 10 - (b / (PROFILE_BINS - 1)) * s.height * sc}`);
    for (let b = PROFILE_BINS - 1; b >= 0; b--) pts.push(`${VW / 2 + (s.offset - s.profile[b]) * sc},${VH - 10 - (b / (PROFILE_BINS - 1)) * s.height * sc}`);
    return `M${pts.join(' L')} Z`;
  };
  const ink = theme === 'paper' ? '#1d1b18' : '#ece6dc';
  return (
    <svg className="strata" viewBox={`0 0 ${VW} ${VH}`} data-testid="strata">
      <line x1={VW / 2} x2={VW / 2} y1={4} y2={VH - 6} stroke={theme === 'paper' ? '#d8d2c7' : '#34302a'} strokeDasharray="3 3" />
      {picks.map((s, i) => (
        <path key={i} d={path(s)} fill="none" stroke={theme === 'paper' ? '#8f6d55' : '#c99a74'} strokeWidth={0.8} opacity={0.15 + (0.55 * i) / (n - 1)} />
      ))}
      <path d={path(cur)} fill="none" stroke={ink} strokeWidth={1.6} />
      <line x1={20} x2={VW - 20} y1={VH - 10} y2={VH - 10} stroke={theme === 'paper' ? '#d8d2c7' : '#34302a'} />
    </svg>
  );
}
