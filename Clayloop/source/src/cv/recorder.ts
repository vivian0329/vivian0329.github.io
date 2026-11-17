/**
 * Session recorder: collects the sample stream (~10 Hz), periodic thumbnails and, when possible,
 * the video itself (MediaRecorder). Pausing pauses both, so sample time and video time stay aligned.
 */
import type { Sample } from './types';
import type { Thumb } from '../store/db';
import { sensing } from './sensing';

export type RecState = 'idle' | 'recording' | 'paused';

export class SessionRecorder {
  state: RecState = 'idle';
  samples: Sample[] = [];
  thumbs: Thumb[] = [];
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private activeMs = 0;
  private segStart = 0;
  private lastSampleT = -1e9;
  private lastThumbT = -1e9;
  private unsub: (() => void) | null = null;
  mime = '';
  videoError = '';

  elapsed(): number {
    return this.activeMs + (this.state === 'recording' ? performance.now() - this.segStart : 0);
  }

  start(recordVideo = true) {
    const s = sensing();
    this.samples = []; this.thumbs = []; this.chunks = []; this.activeMs = 0; this.videoError = '';
    this.segStart = performance.now();
    this.state = 'recording';
    if (recordVideo) {
      try {
        const stream: MediaStream | null = s.stream_ ?? ((s.video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.() ?? null);
        if (stream) {
          const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
          this.mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
          this.mr = new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 2_500_000 });
          this.mr.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
          this.mr.start(1000);
        }
      } catch (e) {
        this.videoError = String(e);
        this.mr = null;
      }
    }
    this.unsub = s.onSample((x) => this.onSample(x)) as unknown as () => void;
  }

  private onSample(x: Sample) {
    if (this.state !== 'recording') return;
    const t = this.elapsed();
    if (t - this.lastSampleT >= 95) {
      this.lastSampleT = t;
      this.samples.push({ ...x, t: Math.round(t), profile: x.profile.map((v) => Math.round(v * 10000) / 10000) });
    }
    if (t - this.lastThumbT >= 2000) {
      this.lastThumbT = t;
      const src = sensing().snapshot(200);
      if (src) this.thumbs.push({ t: Math.round(t), src });
    }
  }

  pause() {
    if (this.state !== 'recording') return;
    this.activeMs += performance.now() - this.segStart;
    this.state = 'paused';
    try { this.mr?.pause(); } catch { /* ignore */ }
  }

  resume() {
    if (this.state !== 'paused') return;
    this.segStart = performance.now();
    this.state = 'recording';
    try { this.mr?.resume(); } catch { /* ignore */ }
  }

  async stop(): Promise<{ samples: Sample[]; thumbs: Thumb[]; video: Blob | null; durationMs: number; mime: string }> {
    if (this.state === 'recording') this.activeMs += performance.now() - this.segStart;
    this.state = 'idle';
    this.unsub?.();
    let video: Blob | null = null;
    if (this.mr && this.mr.state !== 'inactive') {
      await new Promise<void>((res) => { this.mr!.onstop = () => res(); this.mr!.stop(); });
      if (this.chunks.length) video = new Blob(this.chunks, { type: this.mime || 'video/webm' });
    }
    this.mr = null;
    return { samples: this.samples, thumbs: this.thumbs, video, durationMs: Math.round(this.activeMs), mime: this.mime };
  }
}
