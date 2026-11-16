/**
 * Optional hand-tracking module (MediaPipe Hand Landmarker, fully local: WASM + model are served
 * from /mediapipe, no network). Kept modular: if it fails to load, the core clay tracking continues
 * and events fall back to the motion-energy proxy.
 *
 * Output is purely observational: number of hands overlapping the clay region and their speed.
 * Nothing about intention, expertise or skill is inferred.
 */
import type { HandLandmarker as HL } from '@mediapipe/tasks-vision';

export interface HandObservation {
  /** hands whose landmarks overlap the ROI */
  count: number;
  /** mean landmark speed, ROI widths per second */
  speed: number;
  /** bounding boxes in ROI-normalised coords (0..1), for segmentation exclusion and overlays */
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
  /** landmark points in ROI-normalised coords, for overlays */
  points: { x: number; y: number }[];
}

export type HandStatus = 'off' | 'loading' | 'ready' | 'error';

export class HandTracker {
  private lm: HL | null = null;
  status: HandStatus = 'off';
  error = '';
  private last: { t: number; pts: { x: number; y: number }[] } | null = null;
  private lastObs: HandObservation = { count: 0, speed: 0, boxes: [], points: [] };
  private lastRun = 0;
  /** running average cost of one detection (ms); used to throttle so sensing keeps its frame rate */
  cost = 0;

  async load() {
    if (this.lm || this.status === 'loading') return;
    this.status = 'loading';
    try {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const base = new URL('./mediapipe/', document.baseURI).href;
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
      const make = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try { this.lm = await make('GPU'); } catch { this.lm = await make('CPU'); }
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.error = String(e);
      console.warn('[ClayLoop] hand tracking unavailable', e);
    }
  }

  stop() { this.lm?.close(); this.lm = null; this.status = 'off'; this.last = null; }

  /** roi in video-normalised coords; mirror flips x like the analysis view */
  detect(video: HTMLVideoElement, roi: { x: number; y: number; w: number; h: number }, mirror: boolean, now: number): HandObservation {
    if (!this.lm || this.status !== 'ready' || video.readyState < 2) return { count: 0, speed: 0, boxes: [], points: [] };
    // ~11 Hz when cheap (GPU); automatically slower if detection is expensive, so it never takes
    // more than ~25% of the main thread and the clay measurements keep their rate
    if (now - this.lastRun < Math.max(90, this.cost * 4)) return this.lastObs;
    this.lastRun = now;
    let res;
    const t0 = performance.now();
    try { res = this.lm.detectForVideo(video, now); } catch { return this.lastObs; }
    const dt = performance.now() - t0;
    this.cost = this.cost ? this.cost * 0.8 + dt * 0.2 : dt;
    const pts: { x: number; y: number }[] = [];
    const boxes: HandObservation['boxes'] = [];
    let count = 0;
    for (const hand of res.landmarks ?? []) {
      const p = hand.map((l) => ({ x: ((mirror ? 1 - l.x : l.x) - roi.x) / roi.w, y: (l.y - roi.y) / roi.h }));
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      const b = { x0: Math.min(...xs) - 0.04, y0: Math.min(...ys) - 0.04, x1: Math.max(...xs) + 0.04, y1: Math.max(...ys) + 0.04 };
      const overlaps = b.x1 > 0 && b.x0 < 1 && b.y1 > 0 && b.y0 < 1;
      if (!overlaps) continue;
      count++;
      boxes.push(b);
      // wrist + five fingertips are enough for a speed estimate
      for (const i of [0, 4, 8, 12, 16, 20]) pts.push(p[i]);
    }
    let speed = 0;
    if (this.last && this.last.pts.length === pts.length && pts.length) {
      const dt = Math.max(0.03, (now - this.last.t) / 1000);
      let acc = 0;
      for (let i = 0; i < pts.length; i++) acc += Math.hypot(pts[i].x - this.last.pts[i].x, pts[i].y - this.last.pts[i].y);
      speed = acc / pts.length / dt;
    }
    this.last = { t: now, pts };
    this.lastObs = { count, speed, boxes, points: pts };
    return this.lastObs;
  }
}
