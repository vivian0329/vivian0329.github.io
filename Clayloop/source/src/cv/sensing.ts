/**
 * Sensing service: owns the single <video> source (webcam or video file), runs the analysis loop
 * (~20 Hz) and broadcasts samples. Shared by Live Practice and Calibration so the camera opens once.
 */
import { analyzeFrame, AnalyzeResult, Box } from './segment';
import { TemporalFilter } from './temporal';
import { Calibration, DEFAULT_CALIBRATION, Sample } from './types';
import { HandObservation, HandTracker } from '../hands/handTracker';
import { loadJSON, saveJSON } from '../store/local';

export type SourceInfo =
  | { kind: 'none' }
  | { kind: 'camera'; deviceId: string; label: string; width: number; height: number }
  | { kind: 'file'; name: string; url: string; width: number; height: number };

export interface SensingStatus {
  source: SourceInfo;
  running: boolean;
  error: string;
  fps: number;
  handStatus: string;
}

const GRID_W = 128;

class Sensing {
  readonly video: HTMLVideoElement;
  private holder: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private filter = new TemporalFilter();
  private prevLuma: Float32Array | null = null;
  private t0 = performance.now();
  private frames: number[] = [];
  calibration: Calibration = loadJSON('clayloop.calibration', DEFAULT_CALIBRATION);
  handsEnabled: boolean = loadJSON('clayloop.hands', true);
  hands = new HandTracker();
  lastHands: HandObservation = { count: 0, speed: 0, boxes: [], points: [] };
  lastResult: AnalyzeResult | null = null;
  lastGrid = { w: GRID_W, h: GRID_W };
  latest: Sample | null = null;
  status: SensingStatus = { source: { kind: 'none' }, running: false, error: '', fps: 0, handStatus: 'off' };
  private sampleListeners = new Set<(s: Sample) => void>();
  private statusListeners = new Set<(s: SensingStatus) => void>();

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.loop = true;
    this.video.className = 'sensing-video';
    this.holder = document.createElement('div');
    this.holder.style.cssText = 'position:fixed;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px';
    this.holder.appendChild(this.video);
    document.body.appendChild(this.holder);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.filter.opts.noiseFloor = this.calibration.noiseFloor;
  }

  /** Move the shared video element into a visible container (and back to the hidden holder on null). */
  mountVideo(el: HTMLElement | null) {
    (el ?? this.holder).appendChild(this.video);
    if (this.video.srcObject || this.video.src) this.video.play().catch(() => {});
  }

  get stream_(): MediaStream | null { return this.stream; }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  async openCamera(deviceId?: string) {
    this.closeSource();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      await waitForVideo(this.video);
      const track = stream.getVideoTracks()[0];
      const set = track.getSettings();
      this.setStatus({
        source: { kind: 'camera', deviceId: set.deviceId ?? deviceId ?? '', label: track.label || 'Camera', width: this.video.videoWidth, height: this.video.videoHeight },
        error: '',
      });
      saveJSON('clayloop.lastCamera', set.deviceId ?? deviceId ?? '');
      track.addEventListener('ended', () => this.setStatus({ error: 'Camera disconnected.' }));
      this.start();
    } catch (e) {
      this.setStatus({ source: { kind: 'none' }, error: cameraError(e) });
      throw e;
    }
  }

  async openFile(file: File | { url: string; name: string }) {
    this.closeSource();
    const url = file instanceof File ? URL.createObjectURL(file) : file.url;
    const name = file instanceof File ? file.name : file.name;
    this.video.srcObject = null;
    this.video.src = url;
    try {
      await this.video.play();
      await waitForVideo(this.video);
      this.setStatus({ source: { kind: 'file', name, url, width: this.video.videoWidth, height: this.video.videoHeight }, error: '' });
      this.start();
    } catch (e) {
      this.setStatus({ source: { kind: 'none' }, error: 'Could not play this video file: ' + String(e) });
      throw e;
    }
  }

  closeSource() {
    this.stopLoop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
    this.latest = null;
    this.lastResult = null;
    this.setStatus({ source: { kind: 'none' }, running: false });
  }

  setCalibration(c: Calibration) {
    this.calibration = c;
    this.filter.opts.noiseFloor = c.noiseFloor;
    saveJSON('clayloop.calibration', c);
  }

  async setHandsEnabled(on: boolean) {
    this.handsEnabled = on;
    saveJSON('clayloop.hands', on);
    if (on) await this.hands.load(); else this.hands.stop();
    this.setStatus({ handStatus: this.hands.status });
  }

  /** Session-relative restart of the temporal filter (e.g. after recalibration). */
  resetFilter() { this.filter.reset(); this.prevLuma = null; }

  onSample(fn: (s: Sample) => void) { this.sampleListeners.add(fn); return () => this.sampleListeners.delete(fn); }
  onStatus(fn: (s: SensingStatus) => void) { this.statusListeners.add(fn); fn(this.status); return () => this.statusListeners.delete(fn); }

  /** Grab a small JPEG of the current frame (for event thumbnails). */
  snapshot(width = 200): string | null {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    const x = c.getContext('2d')!;
    if (this.calibration.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }

  /** Sample a pixel colour at normalised video coords (for clay/backdrop calibration clicks). */
  samplePixel(nx: number, ny: number): { r: number; g: number; b: number } | null {
    const v = this.video;
    if (v.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = 9; c.height = 9;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    const sx = (this.calibration.mirror ? 1 - nx : nx) * v.videoWidth - 4;
    x.drawImage(v, sx, ny * v.videoHeight - 4, 9, 9, 0, 0, 9, 9);
    const d = x.getImageData(0, 0, 9, 9).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  private start() {
    this.stopLoop();
    this.filter.reset();
    this.prevLuma = null;
    this.t0 = performance.now();
    if (this.handsEnabled) this.hands.load().then(() => this.setStatus({ handStatus: this.hands.status }));
    this.timer = window.setInterval(() => this.tick(), 45);
    this.setStatus({ running: true });
  }

  private stopLoop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const now = performance.now();
    const cal = this.calibration;
    const sx = cal.roi.x * v.videoWidth, sy = cal.roi.y * v.videoHeight;
    const sw = Math.max(8, cal.roi.w * v.videoWidth), sh = Math.max(8, cal.roi.h * v.videoHeight);
    const gw = GRID_W, gh = Math.max(16, Math.round((GRID_W * sh) / sw));
    if (this.canvas.width !== gw || this.canvas.height !== gh) { this.canvas.width = gw; this.canvas.height = gh; this.prevLuma = null; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cal.mirror) {
      // mirror the whole frame, then crop the ROI expressed in mirrored coordinates
      ctx.translate(gw, 0); ctx.scale(-1, 1);
      const msx = v.videoWidth - sx - sw;
      ctx.drawImage(v, msx, sy, sw, sh, 0, 0, gw, gh);
    } else {
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, gw, gh);
    }
    const img = ctx.getImageData(0, 0, gw, gh);

    let exclude: Box[] = [];
    if (this.handsEnabled && this.hands.status === 'ready') {
      this.lastHands = this.hands.detect(v, cal.roi, cal.mirror, now);
      exclude = this.lastHands.boxes.map((b) => ({ x0: b.x0 * gw, y0: b.y0 * gh, x1: b.x1 * gw, y1: b.y1 * gh }));
    } else {
      this.lastHands = { count: 0, speed: 0, boxes: [], points: [] };
    }
    const res = analyzeFrame(img.data, gw, gh, cal, { exclude, prevLuma: this.prevLuma });
    this.prevLuma = res.luma;
    this.lastResult = res;
    this.lastGrid = { w: gw, h: gh };
    const s = this.filter.push(now - this.t0, res.m, { count: this.lastHands.count, speed: this.lastHands.speed });
    this.latest = s;
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 1000) this.frames.shift();
    this.status.fps = this.frames.length;
    this.sampleListeners.forEach((fn) => fn(s));
  }

  private setStatus(p: Partial<SensingStatus>) {
    this.status = { ...this.status, ...p, handStatus: this.hands.status };
    this.statusListeners.forEach((fn) => fn(this.status));
  }
}

function waitForVideo(v: HTMLVideoElement): Promise<void> {
  if (v.readyState >= 2 && v.videoWidth) return Promise.resolve();
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('Video did not start within 8 s')), 8000);
    v.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
  });
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access for this page in the browser settings.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'That camera could not be found. Is it plugged in?';
  if (name === 'NotReadableError') return 'The camera is in use by another application.';
  if (!navigator.mediaDevices) return 'Camera access needs a secure page (http://localhost).';
  return 'Could not open camera: ' + String(e);
}

let instance: Sensing | null = null;
export function sensing(): Sensing {
  if (!instance) instance = new Sensing();
  return instance;
}
export type { Sensing };
