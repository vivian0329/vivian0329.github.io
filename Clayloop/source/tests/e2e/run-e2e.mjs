/**
 * End-to-end smoke test of ClayLoop in a real Chromium.
 *
 * The webcam is Chromium's *fake* capture device fed with the SYNTHETIC footage (y4m), so the real
 * getUserMedia → analysis → 3D → recorder → IndexedDB path is exercised. It does not prove anything
 * about a physical webcam, lighting or real clay: that must be verified on the MacBook.
 *
 *   node tests/e2e/run-e2e.mjs
 *
 * Expects `npm run build` to have been run. Starts `vite preview` itself.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 4179;
const APP = `http://localhost:${PORT}/`;
const OUT = path.join(ROOT, 'tools/out');
const SHOTS = path.join(ROOT, 'docs/screenshots');
const Y4M = path.join(OUT, 'synthetic.y4m');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const SYNTH_CAL = { roi: { x: 0.2, y: 0.22, w: 0.6, h: 0.62 }, axisX: 0.5, baseY: 0.93, clayColor: { r: 125, g: 105, b: 90 }, backdropColor: { r: 42, g: 40, b: 36 }, tolerance: 0.55, noiseFloor: 0.025, mirror: false };

let failures = 0;
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
}

if (!fs.existsSync(Y4M)) {
  console.log('Converting synthetic footage to y4m for the fake camera…');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(ROOT, 'public/demo/synthetic-footage.webm'), '-r', '15', '-pix_fmt', 'yuv420p', Y4M]);
}

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(to); res(); } });
});

const external = new Set();
async function launch(userDataDir) {
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    permissions: ['camera'],
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`,
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(APP) && !u.startsWith('data:') && !u.startsWith('blob:')) external.add(u); });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error:', m.text().slice(0, 200)); });
  return { ctx, page };
}

const latest = (page) => page.evaluate(() => { const l = window.__clayloop.sensing().latest; return l && { tracking: l.tracking, wobble: l.wobble, f: l.frequency, h: l.height }; });

async function recordSession(page, { source, seconds, title, pauseAt }) {
  await page.goto(APP + '#/live');
  await page.waitForTimeout(500);
  const vals = await page.$$eval('select[aria-label="Video source"] option', (o) => o.map((x) => x.value));
  await page.selectOption('select[aria-label="Video source"]', source === 'camera' ? vals.find((v) => v.startsWith('cam:')) : source);
  await page.waitForFunction(() => window.__clayloop.sensing().latest?.tracking === 'ok', null, { timeout: 20000 });
  await page.click('[data-testid=btn-start]');
  const t0 = Date.now();
  if (pauseAt) {
    await page.waitForTimeout(pauseAt * 1000);
    await page.click('[data-testid=btn-pause]');
    const a = await page.textContent('[data-testid=timer]');
    await page.waitForTimeout(2500);
    const b = await page.textContent('[data-testid=timer]');
    check('pause freezes the session clock', a === b, `${a} → ${b}`);
    await page.click('[data-testid=btn-resume]');
  }
  while (Date.now() - t0 < seconds * 1000) await page.waitForTimeout(500);
  await page.click('[data-testid=btn-stop]');
  await page.waitForSelector('[data-testid=input-title]');
  await page.fill('[data-testid=input-title]', title);
  await page.click('[data-testid=btn-save]');
  await page.waitForSelector('[data-testid=portrait]', { timeout: 20000 });
  return page.url().split('/session/')[1];
}

try {
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clayloop-e2e-'));
    let { ctx, page } = await launch(dir);
    await page.addInitScript((cal) => {
      if (!localStorage.getItem('clayloop.calibration')) localStorage.setItem('clayloop.calibration', JSON.stringify(cal));
      if (!localStorage.getItem('clayloop.hands')) localStorage.setItem('clayloop.hands', 'false');
    }, SYNTH_CAL);

    // 1. app starts
    await page.goto(APP);
    await page.waitForSelector('.hero');
    check('app starts and home renders', true);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, '01-home.png') });

    // 2. camera opens via device selection; real frames; tracking
    await page.goto(APP + '#/live');
    const opts = await page.$$eval('select[aria-label="Video source"] option', (o) => o.map((x) => x.value + '|' + x.textContent));
    check('camera list populated', opts.some((o) => o.startsWith('cam:')), opts.filter((o) => o.startsWith('cam:')).join(', '));
    const pickCamera = async () => {
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(600); // device list refreshes once permission is known
        const vals = await page.$$eval('select[aria-label="Video source"] option', (o) => o.map((x) => x.value));
        try { await page.selectOption('select[aria-label="Video source"]', vals.find((v) => v.startsWith('cam:')), { timeout: 3000 }); return; } catch { /* list changed; retry */ }
      }
      throw new Error('could not select camera');
    };
    await pickCamera();
    await page.waitForFunction(() => window.__clayloop.sensing().status.source.kind === 'camera', null, { timeout: 15000 });
    const dims = await page.evaluate(() => { const v = window.__clayloop.sensing().video; return [v.videoWidth, v.videoHeight]; });
    check('camera delivers real frames', dims[0] > 0 && dims[1] > 0, `${dims[0]}×${dims[1]}`);
    await page.waitForFunction(() => window.__clayloop.sensing().latest?.tracking === 'ok', null, { timeout: 20000 });
    check('clay silhouette tracked from camera frames', true);

    // 3. features respond to changes in the footage; tracking loss is visible
    const trace = [];
    let sawLost = false, sawHold = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const s = await latest(page);
      if (s) trace.push(s);
      if (s?.tracking === 'lost') { sawLost = true; sawHold = sawHold || (await page.$('[data-testid=hold-note]')) !== null; }
      await page.waitForTimeout(400);
    }
    const w = trace.map((s) => s.wobble);
    const hiW = Math.max(...w), loW = Math.min(...w.slice(5));
    check('wobble estimate varies with the footage (unstable vs settled)', hiW > 0.08 && loW < hiW / 3, `max ${(hiW * 100).toFixed(1)}%, min ${(loW * 100).toFixed(1)}%`);
    const fs2 = trace.filter((s) => s.wobble > 0.08).map((s) => s.f);
    const fm = fs2.reduce((a, b) => a + b, 0) / Math.max(1, fs2.length);
    check('oscillation frequency near the synthetic wheel speed (2 Hz)', fm > 1.5 && fm < 2.5, `${fm.toFixed(2)} Hz`);
    check('tracking loss detected during occlusion', sawLost);
    check('tracking loss shown to the user (hold note)', sawHold);
    // (hand tracking is exercised separately at the end: on this machine's software GL, MediaPipe costs >1 s per frame)
    await page.screenshot({ path: path.join(SHOTS, '02-live.png') });

    // 4. the 3D canvas renders
    const canvasOk = await page.evaluate(() => { const c = document.querySelector('[data-testid=live-stage] canvas'); return !!c && c.width > 100; });
    check('3D material mirror canvas renders', canvasOk);

    // 5. record a real session from the (fake) camera with pause/resume
    const idA = await recordSession(page, { source: 'camera', seconds: 26, title: 'E2E camera session', pauseAt: 6 });
    check('session saved and Practice Portrait opened', !!idA, idA);
    const evCount = await page.$$eval('[data-testid=events] .event', (e) => e.length);
    check('portrait lists detected moments', evCount > 0, `${evCount} moments`);
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid=portrait-video]'); return v && v.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
    const vd = await page.evaluate(() => document.querySelector('[data-testid=portrait-video]')?.readyState ?? -1);
    check('recorded video is attached to the session', vd >= 1, `readyState ${vd}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOTS, '03-portrait.png'), fullPage: true });

    // 6. event selection seeks; annotation; marker; tags
    const firstEv = await page.$('[data-testid=events] .event:last-child');
    await firstEv.click();
    await page.waitForTimeout(800);
    const head = await page.textContent('[data-testid=playhead]');
    check('selecting a moment moves the playhead', !head.startsWith('0:00 /'), head);
    await page.fill('[data-testid=event-note]', 'Felt the clay push back on the left');
    await page.click('[data-testid=portrait-title]');
    await page.waitForTimeout(400);
    await page.click('[data-testid=btn-marker]');
    await page.waitForTimeout(400);
    await page.fill('[data-testid=session-notes]', 'E2E reflection note');
    await page.click('[data-testid=portrait-title]');
    await page.fill('[data-testid=session-tag-input]', 'wet-slip');
    await page.press('[data-testid=session-tag-input]', 'Enter');
    await page.waitForTimeout(500);

    // 7. second session from a video file source, for comparison
    const idB = await recordSession(page, { source: 'synthetic', seconds: 10, title: 'E2E file session' });
    check('second session (video file source) saved', !!idB);
    const srcBadge = await page.textContent('.portrait-head .badge');
    check('synthetic source is labelled as synthetic', /Synthetic/.test(srcBadge), srcBadge);

    // 8. restart the browser: persistence
    await ctx.close();
    ({ ctx, page } = await launch(dir));
    await page.goto(APP + '#/library');
    await page.waitForSelector('[data-testid=session-card]');
    const titles = await page.$$eval('[data-testid=session-card] h3', (h) => h.map((x) => x.textContent));
    check('sessions survive an application restart', titles.includes('E2E camera session') && titles.includes('E2E file session'), titles.join(', '));
    await page.screenshot({ path: path.join(SHOTS, '04-library.png') });
    await page.goto(APP + `#/session/${idA}`);
    await page.waitForSelector('[data-testid=portrait]');
    const notes = await page.inputValue('[data-testid=session-notes]');
    check('reflection note persisted', notes === 'E2E reflection note', notes);
    const hasMarker = await page.$('[data-testid=event-marker]');
    check('user marker persisted', !!hasMarker);
    const evNote = await page.textContent('[data-testid=events]');
    check('moment annotation persisted', evNote.includes('Felt the clay push back'));
    const tag = await page.textContent('.portrait .chip');
    check('session tag persisted', tag?.includes('wet-slip'), tag);
    await page.click('[data-testid=btn-play]');
    await page.waitForTimeout(2500);
    const head2 = await page.textContent('[data-testid=playhead]');
    check('recorded session replays after restart', !head2.startsWith('0:00 /'), head2);

    // 9. export
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=btn-export]')]);
    const ex = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('export produces a valid session file', ex.format === 'clayloop-session' && ex.trace.samples.length > 50, `${ex.trace.samples.length} samples`);

    // 10. compare
    await page.goto(APP + '#/library');
    await page.waitForSelector('[data-testid=session-card]');
    for (const cb of await page.$$('[data-testid=session-card] input[type=checkbox]')) await cb.check();
    await page.click('[data-testid=btn-compare]');
    await page.waitForSelector('[data-testid=compare-chart]');
    check('session comparison renders', (await page.$$('[data-testid=compare-chart] polyline')).length === 2);
    await page.screenshot({ path: path.join(SHOTS, '05-compare.png'), fullPage: true });

    // 11. exhibition with bundled synthetic demo (no featured session)
    await page.goto(APP + '#/exhibition');
    await page.waitForSelector('[data-testid=ex-guided]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOTS, '06-exhibition-intro.png') });
    await page.click('[data-testid=ex-guided]');
    await page.waitForSelector('[data-testid=ex-caption]');
    const prov = await page.textContent('.ex-top .badge');
    check('exhibition labels the documented session’s provenance', /Synthetic/.test(prov), prov);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, '07-exhibition-guided.png') });
    for (let i = 0; i < 6 && (await page.$('[data-testid=ex-next]')); i++) { await page.click('[data-testid=ex-next]'); await page.waitForTimeout(700); }
    await page.click('[data-testid=ex-to-portrait]');
    await page.waitForSelector('[data-testid=ex-portrait]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '08-exhibition-portrait.png') });
    await page.click('[data-testid=ex-return]');
    check('exhibition guided flow → portrait → return works', !!(await page.$('[data-testid=ex-guided]')));

    // 12. featured session is used by the exhibition
    await page.goto(APP + `#/session/${idA}`);
    await page.click('[data-testid=btn-feature]');
    await page.waitForTimeout(300);
    await page.goto(APP + '#/exhibition');
    await page.click('[data-testid=ex-guided]');
    const prov2 = await page.textContent('.ex-top .badge');
    check('exhibition uses the session marked for exhibition', /Live camera/.test(prov2), prov2);

    // 13. delete
    await page.goto(APP + '#/library');
    await page.waitForSelector('[data-testid=session-card]');
    const before = (await page.$$('[data-testid=session-card]')).length;
    await page.click('[data-testid=session-card]:last-child [data-testid=btn-delete]');
    await page.click('[data-testid=confirm-delete]');
    await page.waitForTimeout(500);
    const after = (await page.$$('[data-testid=session-card]')).length;
    check('delete removes a session', after === before - 1, `${before} → ${after}`);

    // 14. settings / calibration UI
    await page.goto(APP + '#/settings');
    await pickCamera();
    await page.waitForTimeout(2500);
    await page.click('[data-testid=mode-axis]');
    const box = await (await page.$('[data-testid=sensor-view]')).boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    const axis = await page.evaluate(() => JSON.parse(localStorage.getItem('clayloop.calibration')).axisX);
    check('calibration click sets the wheel axis', Math.abs(axis - (0.55 - 0.2) / 0.6) < 0.03, axis.toFixed(3));
    await page.screenshot({ path: path.join(SHOTS, '09-calibration.png'), fullPage: true });

    // 15. hand-tracking module loads from local files
    await page.click('[data-testid=toggle-hands]');
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__clayloop.sensing().hands.status), null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    const hs = await page.evaluate(() => ({ status: window.__clayloop.sensing().hands.status, cost: window.__clayloop.sensing().hands.cost }));
    check('hand-tracking module loads offline (MediaPipe)', hs.status === 'ready', `${hs.status}, ${hs.cost.toFixed(0)} ms per detection on software GL`);

    await ctx.close();
    check('no requests left this computer (offline-capable)', external.size === 0, [...external].slice(0, 5).join(', '));
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  server.kill();
}
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed${failures ? `, ${failures} failure(s)` : ''}`);
process.exit(failures ? 1 : 0);
