# ClayLoop: implementation status

Last updated: 12 Nov 2026. "Verified" means an automated test was actually executed in this development environment
(Linux, headless Chromium with software WebGL and a **fake webcam fed with synthetic footage**). Nothing here has run yet on
the MacBook, a physical webcam, real clay or a real wheel.

## P0: must be functional

| Requirement | Status | Evidence |
|---|---|---|
| App starts | ✅ verified | e2e: home renders; `npm run build` passes typecheck |
| Webcam selection and opening | ✅ verified (fake camera) | e2e: device list populated, 640×360 frames delivered via `getUserMedia` |
| Clay region definable | ✅ verified | e2e: calibration click sets the axis; ROI drag, wheel-head line and colour sampling are implemented in the same component |
| Observable motion features extracted | ✅ verified (synthetic) | unit tests on generated frames; footage test: unstable ≈ 14–16 % vs settled ≈ 2 % of radius; wheel 2.0 Hz recovered as 2.0 Hz |
| Measurements drive the 3D form | ✅ verified | e2e: canvas renders while the live wobble varies 1.8 %→12.9 %; renderer reads the same samples |
| Sessions start / pause / stop | ✅ verified | e2e: pause freezes the clock; save opens the portrait |
| Persistence | ✅ verified | e2e: two sessions, notes, marker, moment note and tag all survive a full browser restart |
| Saved sessions reopen | ✅ verified | e2e: replay after restart advances, video attached (readyState 4) |
| Practice Portrait explorable | ✅ verified | e2e: selecting a moment seeks the playhead; markers, notes, tags |
| Exhibition Mode offline | ✅ verified | e2e: guided flow → portrait → return; **no request left localhost** during the whole run |

## P1: strongly desired

| Feature | Status |
|---|---|
| Hand tracking (MediaPipe, local files) | ✅ loads offline (verified). Not verified that it detects real hands: the synthetic "hands" are ellipses. It throttles itself if detection is slow |
| Human–material temporal overlay | ✅ live coupling strip; timeline movement lane + tentative "possible response" readings |
| Better deforming geometry | ✅ procedural lathe: measured profile, wobble sway, ellipticity, lean, tremor |
| Session comparison | ✅ verified (2–4 sessions, relative/absolute time) |
| Editable tags & reflections | ✅ verified |
| Video synchronisation | ✅ the video is the master clock for the 3D replay and timeline |

## P2: optional (not started, on purpose)
Automated reflective summaries, semantic event interpretation, extra comparison modes, other export formats (JSON + CSV + video exist).

## Acceptance criteria (brief §7)
1. Camera provides real frames: **verified with a fake device only**. Needs a check on the Mac.
2. Features respond to physical changes: **verified on synthetic footage only**. Needs a check with real clay.
3. 3D receives the features: verified.
4. Tracking loss handled visibly: verified (hold note, pale translucent form, timeline span).
5. Real session recorded and saved: verified with the fake camera.
6. Survives restart: verified.
7. Recorded events can be inspected again: verified.
8. Exhibition operable without dev tools: verified by clicking through the UI. Kiosk launcher is untested (macOS only).
9. Documented fallback without hardware: verified (bundled synthetic demo, labelled).
10. No network: verified (no external requests). `npm install` needs network once.

## Known issues / risks
- **No real data yet.** The documented demo is synthetic. Record real sessions before the critiques.
- **Segmentation is colour-based.** Clay that is similar in colour to hands, or a busy backdrop, lowers confidence. Mitigations: a dark matte backdrop, diffuse light, careful sampling. Hands that cover the clay read as "clay not visible" rather than as wobble. That is intended, but heavy hand contact means long tracking-loss spans.
- **Camera angle.** It assumes a roughly side-on view, with the axis vertical in the image. Strong top-down angles are not supported.
- **Wobble scale is relative,** and depends on the camera distance, lens and lighting. It is comparable within a setup, not across setups. The UI says so.
- **Performance:** in this headless environment, rendering + analysis ran at 5–6 fps and MediaPipe took more than 1 s per frame (software GL). An M-series Mac should be far faster, but this is unmeasured. The analysis and the wheel band (≤ 4 Hz) need at least ~10 fps. Check the fps in the Live status line.
- **Storage is per browser profile and port.** Always use the launchers. Use Export all for backups. Clearing Chrome data deletes the library.
- The live coupling strip and the "possible response" readings use the motion proxy unless hand tracking is on.
- Safari is not supported (MediaRecorder/WebM). Use Chrome.
- The kiosk exhibition launcher (`--kiosk`) and the macOS `.command` files were written, but couldn't be run here.

## Technical assumptions
- Centering speeds are 30–240 rpm, which is the 0.5–4 Hz band for the wobble fit.
- The clay is roughly axisymmetric when centred (the 3D form assumes this; the silhouette is the only measured geometry).
- Analysis grid is 128 px wide; samples are recorded at 10 Hz; there are thumbnails every 2 s.
- Event thresholds are relative to each session's own distribution (median × 1.75, with a minimum of 3 % of radius). No external ideal is used.

## Implemented vs proposed
Everything in the P0 and P1 tables is implemented in code. Items marked "not verified" are implemented but have not run on real hardware. P2 items are proposed only.
