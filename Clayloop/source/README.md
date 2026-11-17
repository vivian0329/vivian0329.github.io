# ClayLoop: an interactive material mirror for embodied expertise

ClayLoop is a UC Berkeley MDes thesis artifact (December 2026). It is a camera-based interactive system for the **centering** stage of wheel-throwing.
A webcam watches the clay from the side. ClayLoop measures what a single camera can honestly see, which is the silhouette and how it sways, and renders
that as a calm, sculptural 3D form that becomes unsettled and calm along with the material. After practice, it gives the session back as a
**Practice Portrait** to revisit, annotate and question. Sessions are kept in a local **Practice Library**. A full-screen **Exhibition Mode** runs
offline, either from a recorded session or live.

> Research question: *How might interactive systems make embodied expertise perceptible without reducing it to explicit instructions?*

ClayLoop is not a pottery instructor. It gives no instructions, scores, rankings or skill estimates.

---

## Online demo (GitHub Pages)

In the `vivian0329.github.io` repository, this folder is `Clayloop/source/`, and the built app sits one level up in `Clayloop/`, so
<https://vivian0329.github.io/Clayloop/> opens ClayLoop directly in Chrome. The camera works there (HTTPS), video never leaves the browser, and
sessions recorded there are stored in that browser only, separately from the local app below. For the exhibition, use the local app: it needs no internet.

To update the online demo after changing the source: `npm run build`, then copy the contents of `dist/` into `Clayloop/`
(the `vision_wasm_module_internal.*` files in `mediapipe/wasm/` can be left out) and commit.

---

## Quick start (MacBook, Apple Silicon)

One-time setup, which needs internet:

1. Install **Node.js 20 or newer** from <https://nodejs.org> and **Google Chrome**.
2. Put this folder somewhere permanent, e.g. `~/Documents/ClayLoop`.
3. In Terminal: `cd ~/Documents/ClayLoop && npm install && npm run build`.
   `npm install` also downloads the MediaPipe hand model (7.8 MB) into `public/mediapipe/`.

Every time after that, no internet needed:

- Double-click **`ClayLoop.command`** for the normal app window. The first time, macOS may ask you to allow it: right-click → Open.
- Double-click **`ClayLoop-Exhibition.command`** for the gallery: a full-screen kiosk window straight into Exhibition Mode. Quit with ⌘Q.

Both launchers serve the built app on `http://localhost:4173` and open Chrome with a **dedicated ClayLoop profile**
(`~/Library/Application Support/ClayLoop/chrome-profile`). **Your sessions live in that profile.** Always start ClayLoop through one of these
launchers, or the library will look empty. That isn't data loss; it's a different browser storage. Use *Library → Export all* for backups.

Developer mode: `npm run dev`, then open <http://localhost:5173> (hot reload; a separate storage origin from 4173).

## Using it

1. **Calibration** (`Calibration` in the top bar). Choose the external webcam. Then:
   1. drag a **Region** around the clay,
   2. click the **wheel axis**,
   3. click the **wheel head** line,
   4. **sample the clay**,
   5. **sample the backdrop**.

   The overlay shows exactly what is measured: light ticks on the silhouette edges. With the clay centred and the wheel turning,
   press **Measure noise floor**. A plain, darker backdrop behind the wheel helps a lot.
2. **Live practice.** The 3D mirror responds to the measured silhouette. Press **Start session** (or Space), practise, and **Stop & review**.
   The session and its video are saved to the library and the Practice Portrait opens.
3. **Practice Portrait.** Play the video and the mirror replay in sync. Click any moment on the timeline or in the list to revisit it. Write notes on moments,
   tag them, add your own markers, and dismiss or keep the system's tentative readings. You can also export JSON, CSV or the video.
4. **Library.** Browse, search, tag-filter, compare 2–4 sessions, delete, import or export. Use **Use in exhibition** on the best real session.
5. **Exhibition.** Intro screen → *Explore a documented session* (a guided replay in four parts, then the portrait) or *Live mirror*.
   **F** = full screen, **←/→** = parts, **Esc** = back to start. After 2.5 minutes without input it returns to the intro.

## Architecture

Everything runs in the browser on the Mac. There is no server logic and no network at runtime.

```
webcam / video file ─▶ <video> ─▶ ROI crop → 128-px analysis grid (canvas, ~20 Hz)
                                     │
                    segment.ts       ▼  colour classification → per-row edges on the wheel axis
                                        → profile (24 bands), height, lateral offset, lean, motion energy   [MEASURED]
                    temporal.ts      ▼  confidence (coverage × area stability) → tracking ok/weak/lost
                                        2.5 s window, detrend, band-limited sinusoid fit (0.5–4 Hz)
                                        → wobble amplitude (relative to radius) + oscillation frequency     [ESTIMATED]
   handTracker.ts (MediaPipe, local)──▶ hands in region, speed; hands excluded from segmentation             [MEASURED, optional]
                                     ▼
                ClayMirror.tsx (three.js / R3F): procedural lathe form from the profile;
                                        off-axis sway = wobble × gain; spin = estimated frequency           [VISUAL]
                    recorder.ts      ▼  samples @10 Hz + thumbnails + MediaRecorder video
                    events.ts        ▼  observed moments (thresholds relative to the session) + tentative readings
                    db.ts (IndexedDB)▼  sessions / traces / videos: persists across restarts
```

Why there is no Python/FastAPI backend: the brief allowed a simpler architecture when it improves reliability. Running CV in the browser gives
real camera names in device selection and a single camera permission. It also removes a second process that could fail during a critique and needs no Python
environment on the exhibition laptop. Python + OpenCV is used offline to generate the labelled synthetic test footage
(`tools/make_synthetic_footage.py`). IndexedDB stands in for SQLite: it lives on disk in the Chrome profile, stores video blobs natively, and
survives restarts (verified by the end-to-end test).

### Why normal rotation is not counted as instability
A centred, roughly round lump spinning on the wheel shows the camera the same left and right edges on every frame, however its surface texture
moves. Off-centre mass makes the silhouette sway once per revolution. ClayLoop therefore measures the *band-limited oscillation of the
silhouette*, not image motion. Slow drift is removed by detrending. Frames where hands hide or widen the outline lose confidence and are left out.
These claims are covered by unit tests (`tests/unit/cv.test.ts`): rotating texture on a centred mass reads as approximately 0, and static offset or drift reads as approximately 0.

## Tests

```bash
npm test                 # unit tests: segmentation, wobble, events; plus pipeline-vs-ground-truth on synthetic footage
npm run footage          # (re)generate synthetic footage + decoded frames (needs python3, numpy, opencv-python, ffmpeg)
npm run build && npm run e2e   # end-to-end in Chromium with a fake webcam fed by the synthetic footage
```

The e2e test (`tests/e2e/run-e2e.mjs`) opens the "camera", tracks, records with pause/resume, saves, restarts the browser, checks persistence of
the session, notes, markers and tags, replays, exports, compares, runs the exhibition flow, deletes, calibrates, and checks that no request left
localhost. Screenshots go to `docs/screenshots/`. To run it on the Mac: `npx playwright install chromium` once.

## Files

| Path | What |
|---|---|
| `src/cv/` | segmentation, temporal filter, events, sensing service, recorder |
| `src/hands/` | optional MediaPipe hand tracker (local WASM + model) |
| `src/three/` | material mirror renderer and measured → rendered mapping |
| `src/store/` | IndexedDB archive, session building, bundled demo loader |
| `src/pages/` | Home, Live, Portrait, Library, Compare, Settings, Exhibition, About |
| `public/demo/` | **synthetic** footage, its ground truth, and the documented demo session built from it |
| `tools/` | synthetic footage generator |
| `docs/STATUS.md` | implementation status, verification record, known issues, assumptions |
| `docs/CRITIQUE-FORMAT.md` | portable vs installation recommendation and hardware list |
