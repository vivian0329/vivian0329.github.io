export default function About() {
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="caps muted">Method &amp; integrity</div>
      <h1 style={{ fontSize: 40, margin: '8px 0 24px' }}>What ClayLoop measures, estimates and draws</h1>
      <div style={{ display: 'grid', gap: 22, fontSize: 15, color: 'var(--ink-2)' }}>
        <section>
          <h2 style={{ fontSize: 22, color: 'var(--ink)' }}>Measured, from each camera frame</h2>
          <p>Inside the calibrated region, each pixel is classified as clay or background by its colour, compared with the clay and backdrop samples you set. In each row, the system finds the clay's left and right edge along the wheel axis. From those edges come the clay's height, its radius at 24 heights, and its sideways offset from the axis. Motion near the clay comes from frame-to-frame differences outside the silhouette. When hand tracking is on, MediaPipe hand landmarks are found locally and used only to mark where hands are.</p>
        </section>
        <section>
          <h2 style={{ fontSize: 22, color: 'var(--ink)' }}>Estimated, over time</h2>
          <p>A centred lump on a turning wheel shows the camera the same outline on every frame, however its surface texture moves. Off-centre mass makes the outline sway once per revolution. ClayLoop takes a two-second window, removes slow drift, and treats how far the outline sways (relative to the clay's radius) as its <i>wobble</i> estimate. The rate of that sway gives a frequency, which is usually the wheel speed. Frames where hands hide or widen the outline lose confidence and are left out, so a hand is not mistaken for wobble.</p>
        </section>
        <section>
          <h2 style={{ fontSize: 22, color: 'var(--ink)' }}>Drawn, for perception</h2>
          <p>The 3D form is a parameterised approximation and not a reconstruction, because one camera cannot see the hidden side. It takes its profile from the measured silhouette and assumes the clay is round. Its off-axis sway is the wobble estimate, deliberately exaggerated. Spin, surface tremor, light and glaze are artistic. All gains can be inspected and changed in Settings.</p>
        </section>
        <section>
          <h2 style={{ fontSize: 22, color: 'var(--ink)' }}>What ClayLoop does not claim</h2>
          <p>It does not measure tacit knowledge, skill, intention or expertise, and it gives no instructions, scores or rankings. Moments are marked when a signal crosses a threshold set by that session's own range, not by an ideal. System readings, such as “oscillation began to settle 1.8 s after movement”, describe sequence only, and the practitioner can revise or dismiss them. Following Polanyi, Schön, Dourish and Klemmer, Hartmann &amp; Takayama, the knowing stays with the potter's body. The mirror only offers something to notice.</p>
        </section>
        <section>
          <h2 style={{ fontSize: 22, color: 'var(--ink)' }}>Data provenance</h2>
          <p>Every session carries a provenance label: <span className="badge camera">Live camera recording</span>, <span className="badge file">Analysed video file</span> or <span className="badge synthetic">Synthetic test data</span>. The bundled demo session was made by running ClayLoop's own pipeline on computer-generated footage, so it shows how the system works and is not empirical data.</p>
        </section>
      </div>
    </div>
  );
}
