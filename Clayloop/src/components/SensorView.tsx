/**
 * Camera preview with the measurement overlay: ROI, wheel axis, wheel-head line, the detected
 * silhouette edges (what the system actually "sees"), and hand landmarks when enabled.
 * In calibration mode the overlay is interactive.
 */
import { useEffect, useRef, useState } from 'react';
import { sensing } from '../cv/sensing';
import { Calibration } from '../cv/types';
import { useSensingStatus } from './common';

export type CalibMode = 'none' | 'roi' | 'axis' | 'base' | 'clay' | 'backdrop';

export function SensorView({ mode = 'none', onCalibrate, showMask = false, className = 'preview', theme = 'stage' }: {
  mode?: CalibMode;
  onCalibrate?: (c: Calibration) => void;
  showMask?: boolean;
  className?: string;
  theme?: 'stage' | 'paper';
}) {
  const box = useRef<HTMLDivElement>(null);
  const vidHost = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const status = useSensingStatus();
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const S = sensing();

  useEffect(() => {
    S.mountVideo(vidHost.current);
    return () => S.mountVideo(null);
  }, [S]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cv.current, b = box.current;
      if (!c || !b) return;
      const W = b.clientWidth, H = b.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      if (S.status.source.kind === 'none') return;
      const cal = S.calibration;
      const r = dragRef.current
        ? { x: Math.min(dragRef.current.x0, dragRef.current.x1), y: Math.min(dragRef.current.y0, dragRef.current.y1), w: Math.abs(dragRef.current.x1 - dragRef.current.x0), h: Math.abs(dragRef.current.y1 - dragRef.current.y0) }
        : cal.roi;
      const rx = r.x * W, ry = r.y * H, rw = r.w * W, rh = r.h * H;
      // dim outside ROI
      x.fillStyle = 'rgba(10,9,8,0.55)';
      x.fillRect(0, 0, W, ry); x.fillRect(0, ry + rh, W, H - ry - rh); x.fillRect(0, ry, rx, rh); x.fillRect(rx + rw, ry, W - rx - rw, rh);
      x.strokeStyle = 'rgba(236,230,220,0.8)'; x.lineWidth = 1; x.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
      if (dragRef.current) return;
      // axis & base
      x.setLineDash([4, 4]);
      x.strokeStyle = 'rgba(201,154,116,0.9)';
      x.beginPath(); x.moveTo(rx + cal.axisX * rw, ry); x.lineTo(rx + cal.axisX * rw, ry + rh); x.stroke();
      x.strokeStyle = 'rgba(236,230,220,0.6)';
      x.beginPath(); x.moveTo(rx, ry + cal.baseY * rh); x.lineTo(rx + rw, ry + cal.baseY * rh); x.stroke();
      x.setLineDash([]);
      const res = S.lastResult;
      const g = S.lastGrid;
      if (res) {
        const sx = rw / g.w, sy = rh / g.h;
        if (showMask) {
          x.fillStyle = 'rgba(201,154,116,0.35)';
          for (let yy = 0; yy < g.h; yy += 1) for (let xx = 0; xx < g.w; xx += 1) if (res.mask[yy * g.w + xx]) x.fillRect(rx + xx * sx, ry + yy * sy, sx + 0.5, sy + 0.5);
        }
        // detected silhouette edges
        x.fillStyle = '#f1e6d8';
        for (let yy = Math.max(0, res.topRow); yy <= res.baseRow; yy++) {
          if (res.left[yy] < 0) continue;
          x.fillRect(rx + res.left[yy] * sx - 1, ry + yy * sy, 2, Math.max(1, sy));
          x.fillRect(rx + (res.right[yy] + 1) * sx - 1, ry + yy * sy, 2, Math.max(1, sy));
        }
        if (res.topRow >= 0) {
          x.strokeStyle = 'rgba(241,230,216,0.5)';
          x.beginPath(); x.moveTo(rx, ry + res.topRow * sy); x.lineTo(rx + rw, ry + res.topRow * sy); x.stroke();
        }
      }
      const hands = S.lastHands;
      x.fillStyle = '#9fb1c8';
      for (const p of hands.points) { x.beginPath(); x.arc(rx + p.x * rw, ry + p.y * rh, 3, 0, Math.PI * 2); x.fill(); }
      x.strokeStyle = 'rgba(159,177,200,0.6)';
      for (const bb of hands.boxes) x.strokeRect(rx + bb.x0 * rw, ry + bb.y0 * rh, (bb.x1 - bb.x0) * rw, (bb.y1 - bb.y0) * rh);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [S, showMask]);

  const norm = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode === 'none' || !onCalibrate) return;
    const p = norm(e);
    const cal = S.calibration;
    if (mode === 'roi') { (e.target as Element).setPointerCapture(e.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    if (mode === 'axis') onCalibrate({ ...cal, axisX: clamp01((p.x - cal.roi.x) / cal.roi.w) });
    if (mode === 'base') onCalibrate({ ...cal, baseY: clamp01((p.y - cal.roi.y) / cal.roi.h) });
    if (mode === 'clay' || mode === 'backdrop') {
      const c = S.samplePixel(p.x, p.y);
      if (c) onCalibrate({ ...cal, [mode === 'clay' ? 'clayColor' : 'backdropColor']: c });
    }
  };
  const onMove = (e: React.PointerEvent) => { if (drag) { const p = norm(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const onUp = () => {
    if (!drag || !onCalibrate) return;
    const roi = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (roi.w > 0.04 && roi.h > 0.04) onCalibrate({ ...S.calibration, roi });
  };

  const src = status.source;
  const aspect = src.kind !== 'none' && src.width ? `${src.width}/${src.height}` : '16/9';
  return (
    <div
      ref={box}
      className={className}
      style={{ aspectRatio: aspect, cursor: mode === 'none' ? 'default' : 'crosshair', touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      data-testid="sensor-view"
    >
      <div ref={vidHost} className={S.calibration.mirror ? 'vid-host mirror' : 'vid-host'} style={{ position: 'absolute', inset: 0 }} />
      <canvas ref={cv} className="overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {src.kind === 'none' && (
        <div className="empty" style={{ color: theme === 'stage' ? undefined : '#ddd' }}>
          {status.error || 'No camera or video open.'}
        </div>
      )}
    </div>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
