/**
 * Core data types for the ClayLoop sensing pipeline.
 *
 * Vocabulary used throughout the code and the UI:
 *  - MEASURED   : read directly from pixels of the current frame (silhouette edges, height, lateral offset).
 *  - ESTIMATED  : derived from a window of measurements over time (wobble amplitude, oscillation frequency, lean).
 *  - VISUAL     : artistic choices of the renderer that are not measurements (spin of the digital clay,
 *                 surface tremor, light, colour).
 */

export interface RGB { r: number; g: number; b: number }

/** All coordinates normalised. ROI is relative to the video frame; axisX/baseY are relative to the ROI. */
export interface Calibration {
  roi: { x: number; y: number; w: number; h: number };
  /** Wheel rotation axis inside the ROI (0..1 of ROI width). */
  axisX: number;
  /** Wheel-head surface / bottom of clay inside the ROI (0..1 of ROI height). */
  baseY: number;
  clayColor: RGB;
  backdropColor: RGB;
  /** 0..1, how far a pixel may be from the clay colour (relative to clay–backdrop distance) and still count as clay. */
  tolerance: number;
  /** Wobble below this relative amplitude is treated as sensor noise (camera/compression jitter). */
  noiseFloor: number;
  /** Flip horizontally (useful for mirrored webcams). Measurements are mirrored too, so they stay consistent. */
  mirror: boolean;
}

export const DEFAULT_CALIBRATION: Calibration = {
  roi: { x: 0.25, y: 0.15, w: 0.5, h: 0.75 },
  axisX: 0.5,
  baseY: 0.9,
  clayColor: { r: 170, g: 140, b: 115 },
  backdropColor: { r: 40, g: 40, b: 42 },
  tolerance: 0.55,
  noiseFloor: 0.02,
  mirror: false,
};

export const PROFILE_BINS = 24;

/** Per-frame, instantaneous measurement (MEASURED). */
export interface FrameMeasurement {
  /** True when a plausible clay silhouette was found. */
  found: boolean;
  /** Radius per height bin, bottom (index 0) to top, as a fraction of ROI width. */
  profile: number[];
  /** Lateral offset of the silhouette centre from the calibrated axis, per bin (fraction of ROI width). */
  centers: number[];
  /** Clay height as fraction of ROI height. */
  height: number;
  /** Mean radius, fraction of ROI width. */
  meanRadius: number;
  /** Weighted mean lateral offset from axis (fraction of ROI width). */
  offset: number;
  /** Offset of upper third relative to lower third (fraction of ROI width): instantaneous lean. */
  lean: number;
  /** Fraction of clay rows that produced a clean, continuous edge pair (0..1). */
  rowCoverage: number;
  /** Silhouette area in pixels of the analysis grid. */
  area: number;
  /** Frame-difference energy outside the clay silhouette (0..1): motion near the clay, NOT hand-specific. */
  motionEnergy: number;
}

/** Per-sample output after temporal filtering (MEASURED + ESTIMATED), what the renderer and recorder consume. */
export interface Sample {
  /** ms since session start (or since tracker start when not recording). */
  t: number;
  tracking: 'ok' | 'weak' | 'lost';
  /** 0..1 */
  confidence: number;
  /** MEASURED, smoothed */
  profile: number[];
  height: number;
  meanRadius: number;
  offset: number;
  /** ESTIMATED: relative oscillation amplitude of the silhouette (fraction of mean radius) over the last window. */
  wobble: number;
  /** ESTIMATED: amplitude before the noise floor is subtracted (for noise-floor calibration). */
  wobbleRaw?: number;
  /** ESTIMATED: dominant oscillation frequency of the silhouette in Hz (0 when unknown). */
  frequency: number;
  /** ESTIMATED: smoothed lean (fraction of ROI width). */
  lean: number;
  /** MEASURED proxy: motion energy around the clay (0..1). */
  motion: number;
  /** MEASURED (MediaPipe, if enabled): number of hands in ROI and their speed (ROI widths / s). */
  hands: number;
  handSpeed: number;
}

export type EventKind = 'instability' | 'stabilization' | 'tracking-loss' | 'hand-adjustment' | 'coupling' | 'marker';
/** observed = threshold crossing in measured data; interpreted = tentative system reading; user = added by practitioner. */
export type EventOrigin = 'observed' | 'interpreted' | 'user';

export interface PracticeEvent {
  id: string;
  kind: EventKind;
  origin: EventOrigin;
  tStart: number;
  tEnd: number;
  /** e.g. peak wobble during an instability episode */
  value?: number;
  label: string;
  detail: string;
  note: string;
  tags: string[];
  thumb?: string;
  dismissed?: boolean;
}
