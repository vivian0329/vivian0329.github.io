/**
 * The Material Mirror: a procedural, parameterised 3D clay form.
 *
 * It is NOT a reconstruction. A single RGB camera sees only a silhouette, so:
 *   - the PROFILE (radius per height band) comes from the measured silhouette (assumed axisymmetric),
 *   - OFF-AXIS DISPLACEMENT is the estimated wobble amplitude, multiplied by an exaggeration gain,
 *   - SPIN uses the estimated oscillation frequency (off-centre clay oscillates at wheel speed),
 *     or a fixed artistic rate when unknown,
 *   - surface tremor, light and material are artistic.
 * During tracking loss the form holds the last observed shape and turns pale and translucent.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PROFILE_BINS, Sample } from '../cv/types';
import { MappingParams } from './mapping';

const RINGS = 56;
const CAP = 10;
const SEG = 120;
const TOTAL_RINGS = RINGS + CAP;

const IDLE_PROFILE = Array.from({ length: PROFILE_BINS }, (_, i) => {
  const u = i / (PROFILE_BINS - 1);
  return 0.2 * (1 - 0.35 * u * u);
});

export interface MirrorProps {
  getSample: () => Sample | null;
  mapping: MappingParams;
  /** 'stage' = large hero framing; 'compact' = smaller panel */
  framing?: 'stage' | 'compact';
  background?: string;
  paused?: boolean;
}

export function ClayMirror(props: MirrorProps) {
  const { framing = 'stage', background = '#14130f' } = props;
  const cam = framing === 'stage' ? { position: [1.0, 2.0, 7.0] as [number, number, number], fov: 30 } : { position: [1.0, 2.2, 7.8] as [number, number, number], fov: 30 };
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={cam}
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      onCreated={({ camera }) => camera.lookAt(1.0, 0.72, 0)}
      style={{ background }}
    >
      <Env />
      <color attach="background" args={[background]} />
      <fog attach="fog" args={[background, 9, 16]} />
      <hemisphereLight args={['#f4ede4', '#2a2622', 0.35]} />
      <directionalLight position={[-3.5, 5.5, 3]} intensity={2.0} color="#fff3e6" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
      <directionalLight position={[3.5, 2.5, -3]} intensity={0.9} color="#cfd8e6" />
      <Scene {...props} background={background} />
      <ContactShadows position={[0, -0.13, 0]} opacity={0.55} scale={7} blur={2.6} far={2.5} color="#000000" />
    </Canvas>
  );
}

function Env() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = 0.55;
    return () => { tex.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
}

/** Procedural throwing-line texture used as bump + roughness map (artistic). */
function useClayTextures() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    const x = c.getContext('2d')!;
    const img = x.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      const v = y / c.height;
      const ridge = 0.5 + 0.18 * Math.sin(v * 2 * Math.PI * 14 + 0.6 * Math.sin(v * 9)) + 0.07 * Math.sin(v * 2 * Math.PI * 47 + 1.3);
      for (let i = 0; i < c.width; i++) {
        const u = i / c.width;
        const n = 0.08 * Math.sin(u * 2 * Math.PI * 3 + v * 40) + (Math.random() - 0.5) * 0.12;
        const val = Math.max(0, Math.min(1, ridge + n)) * 255;
        const p = (y * c.width + i) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = val;
        img.data[p + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const bump = new THREE.CanvasTexture(c);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    return { bump };
  }, []);
}

function Scene({ getSample, mapping, paused, background = '#14130f' }: MirrorProps) {
  const silColor = isLight(background) ? '#57524b' : '#d9cfc4';
  const mesh = useRef<THREE.Mesh>(null!);
  const wheel = useRef<THREE.Group>(null!);
  const silLine = useRef<THREE.LineLoop>(null!);
  const { bump } = useClayTextures();

  // displayed (eased) state
  const st = useRef({
    profile: IDLE_PROFILE.slice(),
    height: 0.55,
    wobble: 0,
    lean: 0,
    spin: 0,
    ghost: 1, // 1 = no data / lost, 0 = tracking
    t: 0,
  });

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(TOTAL_RINGS * (SEG + 1) * 3);
    const uv = new Float32Array(TOTAL_RINGS * (SEG + 1) * 2);
    const idx: number[] = [];
    for (let j = 0; j < TOTAL_RINGS; j++) {
      for (let k = 0; k <= SEG; k++) {
        const i = j * (SEG + 1) + k;
        uv[i * 2] = k / SEG;
        uv[i * 2 + 1] = j / (TOTAL_RINGS - 1);
        if (j < TOTAL_RINGS - 1 && k < SEG) {
          const a = i, b = i + SEG + 1, c = i + 1, d = i + SEG + 2;
          idx.push(a, c, b, c, d, b);
        }
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, []);

  const silGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PROFILE_BINS * 2 + 2) * 3), 3));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#b49a84'),
        roughness: 0.58,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.45,
        sheen: 0.4,
        sheenColor: new THREE.Color('#e8d6c4'),
        sheenRoughness: 0.6,
        bumpMap: bump,
        bumpScale: 0.18,
        transparent: true,
        opacity: 1,
      }),
    [bump],
  );
  const baseColor = useMemo(() => new THREE.Color('#b49a84'), []);
  const ghostColor = useMemo(() => new THREE.Color('#8f8c88'), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw);
    const s = st.current;
    s.t += dt;
    const sample = getSample();
    const k = 1 - Math.pow(mapping.smoothing, dt * 30);
    const tracking = sample && sample.tracking !== 'lost' && sample.height > 0.02;
    if (tracking && sample) {
      for (let i = 0; i < PROFILE_BINS; i++) s.profile[i] += k * ((sample.profile[i] ?? s.profile[i]) - s.profile[i]);
      s.height += k * (sample.height - s.height);
      s.wobble += k * (sample.wobble - s.wobble);
      s.lean += k * (sample.lean - s.lean);
    } else if (sample) {
      // holding last observed shape; wobble estimate is also held by the filter
      s.wobble += k * 0.5 * (sample.wobble - s.wobble);
    }
    const ghostTarget = !sample ? 1 : sample.tracking === 'lost' ? 1 : sample.tracking === 'weak' ? 0.35 : 0;
    s.ghost += (1 - Math.pow(0.9, dt * 30)) * (ghostTarget - s.ghost);
    const spinRate = mapping.spinFromFrequency && sample && sample.frequency > 0.3 && sample.frequency < 5 ? sample.frequency : mapping.fallbackSpin;
    if (!paused) s.spin += dt * spinRate * Math.PI * 2;

    // ---- rebuild geometry ----
    const sc = mapping.scale;
    const H = Math.max(0.15, s.height * sc);
    const pos = geometry.attributes.position.array as Float32Array;
    const meanR = (s.profile.reduce((a, v) => a + v, 0) / PROFILE_BINS) * sc;
    const disp = s.wobble * mapping.wobbleGain * meanR; // world units at the top
    const tremor = s.wobble * mapping.tremorGain;
    const ell = s.wobble * 0.6;
    const leanW = s.lean * sc * mapping.leanGain;
    // lean is in the camera's frame; counter-rotate so it stays put while the body spins
    const lx = Math.cos(-s.spin), lz = Math.sin(-s.spin);
    const topR = Math.max(0.02, s.profile[PROFILE_BINS - 1] * sc);
    const domeH = Math.min(topR * 0.45, H * 0.18);
    for (let j = 0; j < TOTAL_RINGS; j++) {
      let y: number, r: number;
      if (j < RINGS) {
        const u = j / (RINGS - 1);
        const f = u * (PROFILE_BINS - 1);
        const i0 = Math.floor(f), i1 = Math.min(PROFILE_BINS - 1, i0 + 1);
        r = (s.profile[i0] + (s.profile[i1] - s.profile[i0]) * (f - i0)) * sc;
        y = u * (H - domeH);
        // soften the foot where it meets the wheel head
        if (u < 0.04) r *= 0.96 + u;
      } else {
        const a = ((j - RINGS + 1) / CAP) * (Math.PI / 2);
        r = topR * Math.cos(a);
        y = H - domeH + domeH * Math.sin(a);
      }
      const hn = Math.min(1, y / H);
      const d = disp * Math.pow(hn, 1.4);
      const ln = leanW * hn;
      for (let q = 0; q <= SEG; q++) {
        const th = (q / SEG) * Math.PI * 2;
        const n = Math.sin(th * 5 + s.t * 3 + y * 7) * 0.5 + Math.sin(th * 11 - s.t * 5 + y * 13) * 0.3;
        const rr = Math.max(0, r * (1 + tremor * 0.12 * n * hn + ell * 0.25 * Math.cos(2 * th) * hn));
        const i = (j * (SEG + 1) + q) * 3;
        pos[i] = rr * Math.cos(th) + d + ln * lx;
        pos[i + 1] = y;
        pos[i + 2] = rr * Math.sin(th) + ln * lz;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    mesh.current.rotation.y = s.spin;
    if (wheel.current) wheel.current.rotation.y = s.spin;
    material.color.copy(baseColor).lerp(ghostColor, s.ghost * 0.7);
    material.opacity = 1 - s.ghost * 0.45;
    material.depthWrite = s.ghost < 0.5;

    // ---- measured silhouette (flat, camera frame; no exaggeration) ----
    if (silLine.current) {
      silLine.current.visible = mapping.showSilhouette && !!sample && sample.height > 0.02;
      if (sample && silLine.current.visible) {
        const p = silGeom.attributes.position.array as Float32Array;
        const Hs = sample.height * sc;
        const off = sample.offset * sc;
        let w = 0;
        for (let b = 0; b < PROFILE_BINS; b++, w++) {
          p[w * 3] = off + sample.profile[b] * sc; p[w * 3 + 1] = (b / (PROFILE_BINS - 1)) * Hs; p[w * 3 + 2] = 0;
        }
        p[w * 3] = off; p[w * 3 + 1] = Hs; p[w * 3 + 2] = 0; w++;
        for (let b = PROFILE_BINS - 1; b >= 0; b--, w++) {
          p[w * 3] = off - sample.profile[b] * sc; p[w * 3 + 1] = (b / (PROFILE_BINS - 1)) * Hs; p[w * 3 + 2] = 0;
        }
        p[w * 3] = off; p[w * 3 + 1] = 0; p[w * 3 + 2] = 0;
        silGeom.attributes.position.needsUpdate = true;
        silGeom.computeBoundingSphere();
        (silLine.current.material as THREE.LineBasicMaterial).opacity = sample.tracking === 'lost' ? 0.15 : 0.55;
      }
    }
  });

  return (
    <group>
      <mesh ref={mesh} geometry={geometry} material={material} castShadow receiveShadow />
      {/* wheel head */}
      <group ref={wheel} position={[0, -0.07, 0]}>
        <mesh receiveShadow castShadow>
          <cylinderGeometry args={[1.25, 1.25, 0.12, 96]} />
          <meshStandardMaterial color="#3a3835" roughness={0.35} metalness={0.75} />
        </mesh>
        <mesh position={[0, 0.061, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.7, 0.715, 96]} />
          <meshBasicMaterial color="#55524d" />
        </mesh>
        <mesh position={[0, 0.061, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.05, 1.06, 96]} />
          <meshBasicMaterial color="#55524d" />
        </mesh>
      </group>
      {/* measured silhouette: flat 2D outline beside the form, at true scale, without exaggeration */}
      <group position={[2.15, 0, 0]}>
        <lineLoop ref={silLine} geometry={silGeom}>
          <lineBasicMaterial color={silColor} transparent opacity={0.55} />
        </lineLoop>
        {mapping.showSilhouette && <Label text="MEASURED OUTLINE" color={silColor} position={[0, -0.28, 0]} />}
      </group>
    </group>
  );
}

function isLight(hex: string) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.5;
}

/** Small text label as a canvas-texture sprite (no DOM, no font download). */
function Label({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const x = c.getContext('2d')!;
    x.font = '500 26px Inter, -apple-system, sans-serif';
    x.fillStyle = color;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    (x as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '4px';
    x.fillText(text, 256, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[1.6, 0.2, 1]}>
      <spriteMaterial map={tex} transparent opacity={0.75} depthWrite={false} />
    </sprite>
  );
}
