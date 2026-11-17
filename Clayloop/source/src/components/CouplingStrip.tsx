/**
 * Live human–material coupling strip: the last 20 s of material oscillation (above the line) and
 * movement/hand activity (below the line) on a shared time axis, so sequences become visible
 * without being labelled as cause and effect.
 */
import { useEffect, useRef } from 'react';
import { sensing } from '../cv/sensing';
import type { Sample } from '../cv/types';

const SPAN = 20000;

export function CouplingStrip({ source }: { source?: () => Sample[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const buf = useRef<{ t: number; w: number; a: number; lost: boolean }[]>([]);

  useEffect(() => {
    if (source) return;
    const S = sensing();
    const un = S.onSample((s) => {
      const b = buf.current;
      const now = performance.now();
      if (b.length && now - b[b.length - 1].t < 90) return;
      b.push({ t: now, w: s.wobble, a: s.hands > 0 ? Math.min(1, 0.4 + s.handSpeed) : s.motion, lost: s.tracking === 'lost' });
      while (b.length && now - b[0].t > SPAN) b.shift();
    });
    return () => { un(); };
  }, [source]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cv.current;
      if (!c) return;
      const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      const b = buf.current;
      const now = performance.now();
      const mid = H * 0.55;
      x.strokeStyle = 'rgba(236,230,220,0.12)';
      x.beginPath(); x.moveTo(0, mid); x.lineTo(W, mid); x.stroke();
      if (b.length < 2) return;
      const X = (t: number) => W - ((now - t) / SPAN) * W;
      // lost spans
      x.fillStyle = 'rgba(154,149,141,0.12)';
      for (const p of b) if (p.lost) x.fillRect(X(p.t) - 2, 0, 4, H);
      // material oscillation (up)
      x.fillStyle = 'rgba(201,154,116,0.75)';
      x.beginPath(); x.moveTo(X(b[0].t), mid);
      for (const p of b) x.lineTo(X(p.t), mid - Math.min(1, p.w / 0.2) * (mid - 4));
      x.lineTo(X(b[b.length - 1].t), mid); x.closePath(); x.fill();
      // activity (down)
      x.fillStyle = 'rgba(140,160,186,0.6)';
      x.beginPath(); x.moveTo(X(b[0].t), mid);
      for (const p of b) x.lineTo(X(p.t), mid + Math.min(1, p.a) * (H - mid - 2));
      x.lineTo(X(b[b.length - 1].t), mid); x.closePath(); x.fill();
      x.fillStyle = 'rgba(163,155,143,0.9)';
      x.font = '10px Inter, sans-serif';
      x.fillText('material oscillation', 0, 10);
      x.fillText('movement near clay', 0, H - 2);
      x.textAlign = 'right';
      x.fillText('now', W, 10);
      x.fillText('−20 s', 34, mid - 4);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={cv} className="coupling" />;
}
