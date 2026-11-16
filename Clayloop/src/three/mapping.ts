/**
 * Measured → rendered mapping. Every number the renderer uses is listed here with its provenance,
 * and the gains are adjustable in Settings so the mapping can be inspected and tuned.
 */
import { loadJSON, saveJSON } from '../store/local';

export interface MappingParams {
  /** World units per ROI width (MEASURED profile → geometry scale). */
  scale: number;
  /** Off-axis displacement per unit of relative wobble (ESTIMATED wobble → VISUAL displacement). Exaggeration > 1 is intentional and labelled. */
  wobbleGain: number;
  /** Surface tremor per unit of wobble (purely VISUAL). */
  tremorGain: number;
  /** Lean → tilt of the upper body (ESTIMATED lean → VISUAL). */
  leanGain: number;
  /** Response smoothing 0..1 (higher = calmer, slower). */
  smoothing: number;
  /** Visual spin (rev/s) used when no oscillation frequency is estimated. */
  fallbackSpin: number;
  /** Use the estimated oscillation frequency as the digital spin rate. */
  spinFromFrequency: boolean;
  /** Show the flat measured silhouette line behind the digital clay. */
  showSilhouette: boolean;
}

export const DEFAULT_MAPPING: MappingParams = {
  scale: 3.2,
  wobbleGain: 2.2,
  tremorGain: 0.5,
  leanGain: 1.0,
  smoothing: 0.82,
  fallbackSpin: 0.35,
  spinFromFrequency: true,
  showSilhouette: true,
};

export const MAPPING_DOC: { key: keyof MappingParams; label: string; from: string; kind: 'measured' | 'estimated' | 'visual'; min?: number; max?: number; step?: number }[] = [
  { key: 'scale', label: 'Profile scale', from: 'Measured silhouette radius and height per height band', kind: 'measured', min: 1.5, max: 5, step: 0.1 },
  { key: 'wobbleGain', label: 'Wobble → off-axis displacement', from: 'Estimated oscillation amplitude (2 s window)', kind: 'estimated', min: 0, max: 6, step: 0.1 },
  { key: 'leanGain', label: 'Lean → tilt', from: 'Estimated upper-vs-lower lateral offset', kind: 'estimated', min: 0, max: 3, step: 0.1 },
  { key: 'tremorGain', label: 'Surface tremor', from: 'Artistic: scaled by wobble, not measured on the surface', kind: 'visual', min: 0, max: 2, step: 0.05 },
  { key: 'smoothing', label: 'Response smoothing', from: 'Renderer easing between incoming samples', kind: 'visual', min: 0, max: 0.97, step: 0.01 },
  { key: 'fallbackSpin', label: 'Fallback spin (rev/s)', from: 'Artistic spin when no frequency is estimated', kind: 'visual', min: 0, max: 2, step: 0.05 },
];

export function loadMapping(): MappingParams { return loadJSON('clayloop.mapping', DEFAULT_MAPPING); }
export function saveMapping(m: MappingParams) { saveJSON('clayloop.mapping', m); }
