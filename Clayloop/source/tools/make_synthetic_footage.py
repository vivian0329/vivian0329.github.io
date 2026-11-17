#!/usr/bin/env python3
"""
Generate SYNTHETIC side-view footage of clay being centred, for development and for the
clearly-labelled documented demo. This is NOT a recording of real practice.

The script renders a shaded, axisymmetric lump of wet clay on a turning wheel head with:
  - a rotating surface texture (so rotation is visible but does not change the silhouette),
  - off-centre sway whose amplitude follows a scripted timeline (unstable -> settling -> stable ->
    disturbed -> settling -> stable),
  - two hand shapes that enter, press on the clay (partly hiding its edges), and withdraw,
  - camera noise and slight light flicker.

The ground-truth amplitude timeline is written next to the video as JSON so automated tests can
check that the pipeline's estimate follows it.

Usage: python3 tools/make_synthetic_footage.py [out_dir]   (needs numpy + opencv-python, ffmpeg)
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

W, H, FPS, DUR = 640, 360, 30, 48.0
WHEEL_HZ = 2.0  # 120 rpm
AXIS_X = 320
BASE_Y = 292
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/demo"
rng = np.random.default_rng(7)


def smooth(a, b, t0, t1, t):
    if t <= t0:
        return a
    if t >= t1:
        return b
    u = (t - t0) / (t1 - t0)
    u = u * u * (3 - 2 * u)
    return a + (b - a) * u


def amplitude(t):
    """Ground truth: peak lateral sway of the clay top, in pixels."""
    if t < 9:
        return 15.0
    if t < 16:
        return smooth(15.0, 1.2, 9, 15, t)
    if t < 25:
        return 1.2
    if t < 28.5:
        return smooth(1.2, 9.0, 25, 27, t)
    if t < 35:
        return smooth(9.0, 1.0, 29.5, 34, t)
    return 1.0


def shape(t):
    """Clay height and base radius (px). Slight coning up and down around 25-29 s."""
    h = 150 + 30 * math.exp(-((t - 27) / 1.6) ** 2)
    r = 92 - 12 * math.exp(-((t - 27) / 1.6) ** 2)
    return h, r


def hands(t):
    """Return a list of (cx, cy, rx, ry, angle) ellipses for hands, plus a contact flag."""
    out = []
    def side(prog, sgn, y):
        # prog 0 = outside frame, 1 = pressing on clay
        x_out = AXIS_X + sgn * 360
        x_in = AXIS_X + sgn * 112
        cx = x_out + (x_in - x_out) * prog
        out.append((cx, y, 70, 34, sgn * 8))
        out.append((cx - sgn * 40, y - 30, 38, 18, sgn * 20))  # thumb / upper finger mass
    p1 = smooth(0, 1, 6.5, 8.5, t) * (1 - smooth(0, 1, 14.5, 16.5, t))
    p2 = smooth(0, 1, 28, 29.5, t) * (1 - smooth(0, 1, 34, 36, t))
    p = max(p1, p2)
    if p > 0.01:
        # deeper press (more occlusion) around 9.5-11 s
        deep = 1 + 0.15 * math.exp(-((t - 10.2) / 0.7) ** 2)
        side(min(1.15, p * deep), -1, BASE_Y - 70)
        side(min(1.15, p * deep), 1, BASE_Y - 60)
    return out


def render(t):
    img = np.zeros((H, W, 3), np.float32)
    # backdrop: dark warm grey gradient (BGR)
    yy = np.linspace(0, 1, H)[:, None]
    img[:] = np.dstack([36 + 10 * yy, 37 + 10 * yy, 40 + 10 * yy])
    flicker = 1 + 0.02 * math.sin(t * 7.3) + 0.01 * math.sin(t * 2.1)

    # wheel head
    cv2.rectangle(img, (AXIS_X - 230, BASE_Y), (AXIS_X + 230, BASE_Y + 20), (70, 72, 76), -1)
    cv2.rectangle(img, (AXIS_X - 230, BASE_Y + 20), (AXIS_X + 230, BASE_Y + 24), (40, 40, 42), -1)
    # spoke marks on wheel rim rotating
    for k in range(6):
        ang = 2 * math.pi * (WHEEL_HZ * t + k / 6)
        x = AXIS_X + 225 * math.sin(ang)
        if math.cos(ang) > 0:
            cv2.line(img, (int(x), BASE_Y + 2), (int(x), BASE_Y + 18), (95, 97, 100), 2)

    h, r0 = shape(t)
    A = amplitude(t)
    phase = 2 * math.pi * WHEEL_HZ * t
    top = BASE_Y - h
    ys = np.arange(int(top), BASE_Y)
    for y in ys:
        u = min(1.0, max(0.0, (y - top) / h))  # 0 top .. 1 bottom
        radius = r0 * (0.42 + 0.58 * math.sqrt(u))
        if u < 0.12:  # rounded dome
            radius *= math.sqrt(max(0.0, 1 - (1 - u / 0.12) ** 2))
        sway = A * math.sin(phase) * (1 - u) ** 1.2
        cx = AXIS_X + sway
        x0, x1 = int(round(cx - radius)), int(round(cx + radius))
        xs = np.arange(max(0, x0), min(W, x1 + 1))
        if len(xs) == 0:
            continue
        s = np.clip((xs - cx) / max(radius, 1), -1, 1)
        theta = np.arcsin(s)
        shade = 0.55 + 0.45 * np.clip(np.cos(theta + 0.6), 0, 1)  # light from the left
        spec = 0.25 * np.clip(np.cos(theta + 0.35), 0, 1) ** 24
        tex_ang = theta + phase  # surface texture rotates with the wheel
        tex = 0.06 * np.sin(tex_ang * 5) + 0.04 * np.sin(tex_ang * 13 + 1.0)
        rings = 0.05 * math.sin(y * 0.55)
        val = shade * (1 + tex + rings) * flicker
        # wet grey-brown stoneware, BGR
        img[y, xs, 0] = np.clip(88 * val + 255 * spec, 0, 255)
        img[y, xs, 1] = np.clip(104 * val + 255 * spec, 0, 255)
        img[y, xs, 2] = np.clip(124 * val + 255 * spec, 0, 255)

    for (cx, cy, rx, ry, ang) in hands(t):
        cv2.ellipse(img, (int(cx), int(cy)), (rx, ry), ang, 0, 360, (128, 152, 196), -1, cv2.LINE_AA)
        cv2.ellipse(img, (int(cx), int(cy - ry * 0.3)), (int(rx * 0.8), int(ry * 0.45)), ang, 0, 360, (146, 170, 212), -1, cv2.LINE_AA)

    img += rng.normal(0, 3.0, img.shape).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, "_frames.avi")
    vw = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"MJPG"), FPS, (W, H))
    n = int(DUR * FPS)
    truth = []
    for i in range(n):
        t = i / FPS
        frame = render(t)
        cv2.putText(frame, "SYNTHETIC TEST FOOTAGE", (14, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1, cv2.LINE_AA)
        vw.write(frame)
        if i % 3 == 0:
            h, r0 = shape(t)
            truth.append({"t": round(t * 1000), "amp_px": round(amplitude(t), 3), "rel": round(amplitude(t) / (r0 * 0.75), 4), "hands": len(hands(t)) > 0})
    vw.release()
    webm = os.path.join(OUT, "synthetic-footage.webm")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:v", "libvpx", "-b:v", "1.6M", "-deadline", "good", "-an", webm], check=True)
    os.remove(tmp)
    with open(os.path.join(OUT, "synthetic-footage.truth.json"), "w") as f:
        json.dump({"note": "Ground truth for synthetic footage (not empirical).", "wheel_hz": WHEEL_HZ, "samples": truth}, f)
    print("wrote", webm)


if __name__ == "__main__":
    main()
