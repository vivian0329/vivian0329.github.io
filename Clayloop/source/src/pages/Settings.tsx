import { useEffect, useState } from 'react';
import { sensing } from '../cv/sensing';
import { Calibration, DEFAULT_CALIBRATION } from '../cv/types';
import { CalibMode, SensorView } from '../components/SensorView';
import { SourcePicker } from '../components/SourcePicker';
import { toast, useLatestSample, useSensingStatus } from '../components/common';
import { DEFAULT_MAPPING, loadMapping, MAPPING_DOC, MappingParams, saveMapping } from '../three/mapping';
import { ClayMirror } from '../three/ClayMirror';

const MODES: { m: CalibMode; label: string; hint: string }[] = [
  { m: 'roi', label: '1 · Region', hint: 'Drag a rectangle around the clay and a little space either side. Exclude the wheel splash pan and your torso if possible.' },
  { m: 'axis', label: '2 · Wheel axis', hint: 'Click on the wheel’s centre line (the vertical line through the wheel-head centre).' },
  { m: 'base', label: '3 · Wheel head', hint: 'Click where the clay meets the wheel head.' },
  { m: 'clay', label: '4 · Sample clay', hint: 'Click on the clay surface.' },
  { m: 'backdrop', label: '5 · Sample backdrop', hint: 'Click on the background next to the clay. A plain, darker backdrop helps.' },
];

export default function Settings() {
  const S = sensing();
  const status = useSensingStatus();
  const [cal, setCal] = useState<Calibration>(S.calibration);
  const [mode, setMode] = useState<CalibMode>('roi');
  const [mask, setMask] = useState(true);
  const [map, setMap] = useState<MappingParams>(loadMapping());
  const [hands, setHands] = useState(S.handsEnabled);
  const s = useLatestSample(6);

  const update = (c: Calibration) => { setCal(c); S.setCalibration(c); };
  const updateMap = (m: MappingParams) => { setMap(m); saveMapping(m); };
  useEffect(() => () => S.resetFilter(), [S]);

  const autoAxis = () => {
    const r = S.lastResult;
    if (!r || !r.m.found) { toast('No silhouette found to fit the axis to.'); return; }
    update({ ...cal, axisX: Math.min(1, Math.max(0, cal.axisX + r.m.offset)) });
    toast('Axis moved to the current silhouette centre');
  };

  const [measuring, setMeasuring] = useState(false);
  const measureNoise = async () => {
    setMeasuring(true);
    const vals: number[] = [];
    const un = S.onSample((x) => { if (x.tracking === 'ok' && x.wobbleRaw !== undefined) vals.push(x.wobbleRaw); });
    await new Promise((r) => setTimeout(r, 5000));
    un();
    setMeasuring(false);
    if (vals.length < 20) { toast('Not enough tracked frames. Check the calibration first.'); return; }
    const sorted = vals.slice(Math.floor(vals.length * 0.3)).sort((a, b) => a - b);
    const nf = Math.min(0.08, sorted[Math.floor(sorted.length * 0.8)] * 1.15);
    update({ ...cal, noiseFloor: Math.round(nf * 1000) / 1000 });
    toast(`Noise floor set to ${(nf * 100).toFixed(1)}% of radius`);
  };

  const hint = MODES.find((x) => x.m === mode)?.hint;
  return (
    <div className="page" data-testid="settings">
      <div className="lib-head">
        <div><div className="caps muted">Settings</div><h1>Camera &amp; calibration</h1></div>
      </div>
      <div className="calib">
        <div style={{ display: 'grid', gap: 14 }}>
          <SourcePicker />
          <div className="row" style={{ gap: 6 }}>
            {MODES.map((x) => <button key={x.m} className={`btn ${mode === x.m ? 'primary' : ''}`} onClick={() => setMode(x.m)} data-testid={`mode-${x.m}`}>{x.label}</button>)}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{hint}</p>
          <SensorView className="calib-view" mode={mode} onCalibrate={update} showMask={mask} theme="paper" />
          <div className="row small">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> Show clay mask</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={cal.mirror} onChange={(e) => update({ ...cal, mirror: e.target.checked })} /> Mirror image</label>
            <span className="spacer" />
            <button className="btn" onClick={autoAxis}>Fit axis to silhouette</button>
            <button className="btn" onClick={() => { update({ ...DEFAULT_CALIBRATION }); toast('Calibration reset'); }}>Reset</button>
          </div>
          {status.error && <div className="notice">{status.error}</div>}
          <div className="notice">
            The overlay shows exactly what the system measures: the silhouette edges per row (light ticks), the top of the clay, the axis (dashed) and the wheel head.
            If the ticks don’t hug the clay, adjust the samples or the tolerance. Hands that cover the edges are expected to lower the confidence.
          </div>
        </div>
        <div style={{ display: 'grid', gap: 22, alignContent: 'start' }}>
          <div className="panel">
            <h2>Segmentation</h2>
            <div className="row small">
              <span>Clay</span><span className="swatch" style={{ background: `rgb(${cal.clayColor.r},${cal.clayColor.g},${cal.clayColor.b})` }} />
              <span>Backdrop</span><span className="swatch" style={{ background: `rgb(${cal.backdropColor.r},${cal.backdropColor.g},${cal.backdropColor.b})` }} />
            </div>
            <Slider label="Colour tolerance" value={cal.tolerance} min={0.05} max={1.2} step={0.01} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ ...cal, tolerance: v })} hint="Higher includes more pixels as clay." />
            <Slider label="Noise floor" value={cal.noiseFloor} min={0} max={0.05} step={0.001} fmt={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => update({ ...cal, noiseFloor: v })}
              hint="Oscillation below this (relative to radius) is treated as camera noise. Raise it until a centred, spinning lump reads near 0." />
            <button className="btn" style={{ justifySelf: 'start' }} onClick={measureNoise} disabled={measuring || status.source.kind === 'none'}>
              {measuring ? 'Measuring for 5 s…' : 'Measure noise floor (clay centred, wheel turning)'}
            </button>
            <div className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Now: {s ? <>wobble {(s.wobble * 100).toFixed(1)}% (raw {((s.wobbleRaw ?? 0) * 100).toFixed(1)}%) · confidence {Math.round(s.confidence * 100)}% · {s.tracking}</> : 'no data'}
            </div>
          </div>
          <div className="panel">
            <h2>Hand tracking</h2>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={hands} onChange={async (e) => { setHands(e.target.checked); await S.setHandsEnabled(e.target.checked); }} data-testid="toggle-hands" />
              Use MediaPipe hand landmarks (runs locally) · status: <b>{status.handStatus}</b>
            </label>
            <p className="small muted" style={{ margin: 0 }}>Used only to mark when hands are in the clay region and to keep hands from being read as clay. When off, the system uses motion energy around the clay instead.</p>
          </div>
          <div className="panel">
            <div className="row"><h2>Measured → rendered mapping</h2><span className="spacer" /><button className="btn" onClick={() => updateMap({ ...DEFAULT_MAPPING })}>Defaults</button></div>
            {MAPPING_DOC.map((d) => (
              <Slider key={d.key} label={d.label} value={map[d.key] as number} min={d.min!} max={d.max!} step={d.step!} fmt={(v) => v.toFixed(2)}
                onChange={(v) => updateMap({ ...map, [d.key]: v })} hint={`${d.kind.toUpperCase()}: ${d.from}`} />
            ))}
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={map.spinFromFrequency} onChange={(e) => updateMap({ ...map, spinFromFrequency: e.target.checked })} /> Spin the digital clay at the estimated oscillation frequency</label>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={map.showSilhouette} onChange={(e) => updateMap({ ...map, showSilhouette: e.target.checked })} /> Show measured silhouette behind the form</label>
            <div style={{ height: 260, borderRadius: 10, overflow: 'hidden' }}>
              <ClayMirror getSample={() => S.latest} mapping={map} framing="compact" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; hint?: string }) {
  return (
    <label className="slider">
      <span>{label}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
