// Quick probe: fake webcam (synthetic y4m) -> live sensing values over time vs ground truth.
import { chromium } from 'playwright';
import fs from 'node:fs';
const Y4M = process.env.Y4M;
const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const truth = JSON.parse(fs.readFileSync('public/demo/synthetic-footage.truth.json', 'utf8')).samples;
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`, '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  localStorage.setItem('clayloop.calibration', JSON.stringify({ roi: { x: 0.2, y: 0.22, w: 0.6, h: 0.62 }, axisX: 0.5, baseY: 0.93, clayColor: { r: 125, g: 105, b: 90 }, backdropColor: { r: 42, g: 40, b: 36 }, tolerance: 0.55, noiseFloor: 0.004, mirror: false }));
  localStorage.setItem('clayloop.hands', 'false');
});
await page.goto(URL + '#/live');
await page.selectOption('select[aria-label="Video source"]', { index: 1 });
const out = [];
const t0 = Date.now();
while (Date.now() - t0 < 50000) {
  const s = await page.evaluate(() => { const l = window.__clayloop.sensing().latest; return l && { tracking: l.tracking, wobble: l.wobble, f: l.frequency, conf: l.confidence, h: l.height, motion: l.motion }; });
  out.push({ wall: Date.now() - t0, ...s });
  await page.waitForTimeout(500);
}
await page.screenshot({ path: process.env.SHOT ?? '/tmp/claude-0/live.png' });
for (const o of out.filter((_, i) => i % 2 === 0)) console.log((o.wall / 1000).toFixed(1).padStart(5), o.tracking, 'wob', (o.wobble * 100).toFixed(1), 'f', o.f?.toFixed(2), 'conf', o.conf?.toFixed(2), 'mot', o.motion?.toFixed(2));
await browser.close();
