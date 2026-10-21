import * as THREE from 'three';
import {mulberry32} from '@/lib/apple-skin-painter';

/**
 * 사실적인 사과(후지 계열) 3D 모델.
 * 껍질 무늬(줄무늬 착색·바탕색·과점·꼭지 주변 녹)를 캔버스로 직접 그려 텍스처로 씁니다.
 */
export function buildApple(opts: {seed?: number; leaf?: boolean} = {}) {
  const rand = mulberry32(opts.seed ?? 7);
  const group = new THREE.Group();
  const disposables: {dispose: () => void}[] = [];
  const keep = <T extends {dispose: () => void}>(x: T) => { disposables.push(x); return x; };

  // ── 과실 모양: 어깨가 넓고 아래로 갈수록 좁아지며, 꼭지·꽃받침 자리가 움푹하고 아래쪽에 다섯 개의 굴곡 ──
  const geo = keep(new THREE.SphereGeometry(1, 192, 144)), pos = geo.attributes.position;
  const tilt = rand() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), th = Math.atan2(z, x), r = Math.hypot(x, z);
    let w = 1 + 0.07 * y - 0.13 * Math.max(0, -y) ** 2;                         // 위는 넓고 아래는 좁게
    w *= 1 + 0.028 * Math.cos(th * 5 + 0.4) * Math.max(0, -y) ** 2.2;           // 아래쪽 다섯 굴곡
    w *= 1 + 0.01 * Math.cos(th * 5 + 1.1) * Math.max(0, y) ** 3;              // 어깨의 약한 굴곡
    w *= 1 + 0.015 * Math.cos(th - tilt) * (0.6 + 0.4 * y);                      // 약간 비대칭
    let yy = y * 0.93;
    if (y > 0) yy -= 0.3 * Math.exp(-(r * r) / 0.075);                          // 꼭지 자리
    else yy += 0.16 * Math.exp(-(r * r) / 0.05);                                // 꽃받침 자리
    pos.setXYZ(i, x * w, yy, z * w);
  }
  geo.computeVertexNormals();
  const skin = keep(new THREE.MeshPhysicalMaterial({
    color: 0xb3262a, roughness: 0.5, metalness: 0,
    clearcoat: 0.5, clearcoatRoughness: 0.32, sheen: 0.12, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xfff1e6),
    envMapIntensity: 0.5,
  }));
  group.add(new THREE.Mesh(geo, skin));

  // ── 껍질 텍스처: 미리 그려 둔 이미지(줄무늬 착색·과점·꼭지 녹). 불러오기 전엔 단색 빨강 ──
  const loader = new THREE.TextureLoader();
  const loadTex = (url: string, apply: (t: THREE.Texture) => void) => loader.load(url, t => { keep(t); t.anisotropy = 8; apply(t); skin.needsUpdate = true; });
  loadTex('/assets/apple-real-color.webp', t => { t.colorSpace = THREE.SRGBColorSpace; skin.map = t; skin.color.set(0xffffff); });
  loadTex('/assets/apple-real-bump.webp', t => { skin.bumpMap = t; skin.bumpScale = 0.9; });
  loadTex('/assets/apple-real-rough.webp', t => { skin.roughnessMap = t; skin.roughness = 1; });


  // ── 꼭지: 가늘고 끝으로 갈수록 얇아지며, 끝은 마른 갈색 ──
  const stemCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0.015, 0.8, 0.01), new THREE.Vector3(0.06, 0.98, 0.02), new THREE.Vector3(0.12, 1.1, 0.02)]);
  const stemGeo = keep(taperedTube(stemCurve, 40, 10, t => 0.034 * (1 - 0.35 * t) + 0.012 * Math.exp(-((1 - t) * 18))));
  const stemColors: number[] = []; const cs = new THREE.Color(), cBase = new THREE.Color(0x6b5a2a), cMid = new THREE.Color(0x5a3a1e), cTip = new THREE.Color(0x3b2614);
  const sp = stemGeo.attributes.position, sUv = stemGeo.attributes.uv;
  for (let i = 0; i < sp.count; i++) { const t = sUv.getX(i); cs.copy(t < 0.5 ? cBase : cMid).lerp(t < 0.5 ? cMid : cTip, t < 0.5 ? t * 2 : (t - 0.5) * 2); stemColors.push(cs.r, cs.g, cs.b); }
  stemGeo.setAttribute('color', new THREE.Float32BufferAttribute(stemColors, 3));
  group.add(new THREE.Mesh(stemGeo, keep(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.85}))));

  // ── 꽃받침: 아래 오목한 자리의 마른 꽃받침 조각 다섯 개 ──
  const calyxMat = keep(new THREE.MeshStandardMaterial({color: 0x3d2a17, roughness: 1, side: THREE.DoubleSide}));
  const bottomY = -0.93 + 0.16 - 0.006;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand() * 0.3;
    const g = keep(new THREE.BufferGeometry());
    const len = 0.1 + rand() * 0.025, wid = 0.03;
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -wid, len, 0.012, 0, 0, 0, wid, 0, -0.01, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, calyxMat); m.position.y = bottomY; m.rotation.y = a; m.rotation.z = -0.35 - rand() * 0.25; group.add(m);
  }
  const calyxCore = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 12, 8)), calyxMat); calyxCore.position.y = bottomY; calyxCore.scale.y = 0.4; group.add(calyxCore);

  // ── 잎: 끝이 뾰족한 타원형, 가운데 맥을 따라 살짝 접히고 휘어짐 ──
  if (opts.leaf !== false) group.add(buildLeaf(keep));

  return {group, dispose: () => disposables.forEach(d => d.dispose())};
}

function buildLeaf(keep: <T extends {dispose: () => void}>(x: T) => T) {
  const seg = 36, across = 9, verts: number[] = [], uvs: number[] = [], colors: number[] = [], idx: number[] = [];
  const dark = new THREE.Color(0x24481a), light = new THREE.Color(0x4f7d28), c = new THREE.Color();
  for (let j = 0; j <= seg; j++) {
    const t = j / seg, half = 0.2 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9) * (1 - 0.15 * t);
    for (let k = 0; k <= across; k++) {
      const s = k / across * 2 - 1;                                 // -1 ~ 1 가로
      const serr = 1 + 0.03 * Math.sin(t * 90) * Math.abs(s) ** 4; // 가장자리 톱니
      const x = t * 0.85, y = Math.sin(t * Math.PI) * 0.05 - t * t * 0.12, z = s * half * serr;
      const fold = Math.abs(s) * half * 0.55;                       // 가운데 맥을 따라 V자로 접힘
      verts.push(x, y + fold, z); uvs.push(t, (s + 1) / 2);
      c.copy(dark).lerp(light, 0.35 + 0.4 * Math.abs(s) * (1 - t * 0.5) - (Math.abs(s) < 0.08 ? -0.35 : 0)); colors.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < seg; j++) for (let k = 0; k < across; k++) { const a = j * (across + 1) + k, b = a + across + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = keep(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(idx); g.computeVertexNormals();
  const leaf = new THREE.Mesh(g, keep(new THREE.MeshPhysicalMaterial({vertexColors: true, roughness: 0.6, clearcoat: 0.15, clearcoatRoughness: 0.6, side: THREE.DoubleSide, sheen: 0.1, sheenColor: new THREE.Color(0xc8e6a0)})));
  const pet = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.011, 0.12, 8)), keep(new THREE.MeshStandardMaterial({color: 0x5e6a2c, roughness: 0.8})));
  pet.rotation.z = Math.PI / 2 + 0.5; pet.position.set(-0.05, -0.03, 0);
  const holder = new THREE.Group(); holder.add(leaf, pet);
  holder.position.set(0.035, 0.86, 0.015); holder.rotation.set(0.5, -0.5, 0.42);
  return holder;
}

/** 굵기가 변하는 튜브 (uv.x = 길이 방향 0~1) */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, radius: (t: number) => number) {
  const frames = curve.computeFrenetFrames(segs, false), pts: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), n = frames.normals[i], b = frames.binormals[i], r = radius(t);
    for (let j = 0; j <= radial; j++) { const a = j / radial * Math.PI * 2; pts.push(p.x + r * (Math.cos(a) * n.x + Math.sin(a) * b.x), p.y + r * (Math.cos(a) * n.y + Math.sin(a) * b.y), p.z + r * (Math.cos(a) * n.z + Math.sin(a) * b.z)); uvs.push(t, j / radial); }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const end = curve.getPointAt(1), cap = pts.length / 3; pts.push(end.x, end.y, end.z); uvs.push(1, 0.5);
  for (let j = 0; j < radial; j++) idx.push(segs * (radial + 1) + j, segs * (radial + 1) + j + 1, cap);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

