// Copies MediaPipe WASM runtime + hand model into public/ so hand tracking works fully offline.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
mkdirSync('public/mediapipe/wasm', { recursive: true });
cpSync(src, 'public/mediapipe/wasm', { recursive: true });
const model = 'public/mediapipe/hand_landmarker.task';
if (!existsSync(model)) {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  console.log('Downloading hand model (one-time, needs network)…');
  const res = await fetch(url);
  if (!res.ok) throw new Error('model download failed ' + res.status);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log('MediaPipe assets ready in public/mediapipe');
