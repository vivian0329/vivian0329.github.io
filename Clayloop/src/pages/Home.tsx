import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClayMirror } from '../three/ClayMirror';
import { loadMapping } from '../three/mapping';
import { DEMO_ID, loadBundledDemo } from '../store/demo';
import { sampleAt } from '../components/common';
import type { Sample } from '../cv/types';

export default function Home() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const t0 = useRef(performance.now());
  const mapping = useMemo(loadMapping, []);
  useEffect(() => { loadBundledDemo().then((f) => setSamples(f.trace.samples)).catch(() => {}); }, []);
  const dur = samples.length ? samples[samples.length - 1].t : 1;
  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="caps muted">MDes Thesis · UC Berkeley · 2026</div>
          <h1 style={{ marginTop: 18 }}>ClayLoop<br /><em>a material mirror</em></h1>
          <p className="lede" style={{ marginTop: 22 }}>
            How might interactive systems make embodied expertise perceptible without reducing it to explicit instructions?
          </p>
          <p style={{ color: 'var(--ink-2)', maxWidth: '58ch' }}>
            ClayLoop watches clay being centred on the wheel. It measures only what a camera can see, the sway of the clay's outline,
            and renders it as a form that grows unsettled and calm with the material. It does not instruct and it does not score.
            After practice, the session returns as a portrait for the potter to annotate, question and revise.
          </p>
          <div className="entries">
            <Link to="/live"><b>Live practice</b><span>Open a camera and practise with the mirror</span></Link>
            <Link to="/library"><b>Practice library</b><span>Sessions kept on this computer</span></Link>
            <Link to={`/session/${DEMO_ID}`}><b>Documented demo</b><span>Synthetic test session, clearly labelled</span></Link>
            <Link to="/exhibition"><b>Exhibition mode</b><span>Full-screen, self-guided, offline</span></Link>
            <Link to="/settings"><b>Camera &amp; calibration</b><span>Region, axis, colours, mapping</span></Link>
            <Link to="/about"><b>Method &amp; integrity</b><span>What is measured, estimated and drawn</span></Link>
          </div>
        </div>
        <div className="hero-art">
          <ClayMirror
            mapping={mapping}
            background="#e9e5dd"
            getSample={() => (samples.length ? sampleAt(samples, ((performance.now() - t0.current) % dur)) : null)}
          />
        </div>
      </section>
      <p className="small muted">The form above is replaying the bundled <b>synthetic</b> development session. It is not empirical data.</p>
    </div>
  );
}
