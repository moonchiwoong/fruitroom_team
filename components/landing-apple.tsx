'use client';
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

/** 화면 위치(가로·세로 -1~1)와 크기. 섹션마다 data-apple="x,y,scale" 로 지정합니다. */
type Pose = {x: number; y: number; s: number};

/**
 * 랜딩 페이지 배경에 고정된 3D 사과.
 * 스크롤하면 섹션마다 정해진 자리로 미끄러지듯 내려가며 회전합니다.
 */
export default function LandingApple() {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, alpha: true}); }
    catch { setFailed(true); return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); camera.position.set(0, 0, 7);
    const pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04); scene.environment = env.texture; room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7d58, 1.6));
    const key = new THREE.DirectionalLight(0xfff4e0, 3.2); key.position.set(-3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(4, 1, -2); scene.add(rim);

    // ── 사과 모델 (3D 시뮬레이터와 같은 형태식) ──
    const apple = new THREE.Group(); const spin = new THREE.Group(); apple.add(spin); scene.add(apple);
    const geo = new THREE.SphereGeometry(1, 160, 112), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), th = Math.atan2(z, x), r = Math.hypot(x, z);
      const w = (1 + 0.11 * y) * (1 + 0.035 * Math.cos(th * 5 + 0.2) * Math.abs(y) ** 3 + 0.008 * Math.sin(th * 3 + y * 5));
      const yy = y * 0.94 - (y > 0 ? 0.24 * Math.exp(-r * r / 0.07) : -0.08 * Math.exp(-r * r / 0.08));
      pos.setXYZ(i, x * w, yy, z * w);
    }
    geo.computeVertexNormals();
    const skin = new THREE.MeshPhysicalMaterial({color: 0xc23a2c, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.3});
    new THREE.TextureLoader().load('/assets/apple-skin.png', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; skin.map = t; skin.color.set(0xffffff); skin.needsUpdate = true; });
    spin.add(new THREE.Mesh(geo, skin));
    const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.62, 0), new THREE.Vector3(0.03, 0.93, 0), new THREE.Vector3(0.13, 1.18, -0.03)]);
    spin.add(new THREE.Mesh(new THREE.TubeGeometry(stem, 20, 0.04, 8, false), new THREE.MeshStandardMaterial({color: 0x5e3f24, roughness: 1})));
    const leafGeo = new THREE.BufferGeometry(), v: number[] = [], idx: number[] = [];
    for (let j = 0; j <= 24; j++) { const t = j / 24, ww = Math.sin(t * Math.PI) * 0.17; for (let k = 0; k < 3; k++) { const side = k - 1; v.push(0.08 + t * 0.72, 1.05 + Math.sin(t * Math.PI) * 0.16 + t * 0.2 + side * ww * 0.8, t * 0.05 + side * ww * 0.7 + Math.abs(side) * 0.03); } }
    for (let j = 0; j < 24; j++) for (let k = 0; k < 2; k++) { const a = j * 3 + k; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); leafGeo.setIndex(idx); leafGeo.computeVertexNormals();
    spin.add(new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({color: 0x4a7a2c, roughness: 0.6, side: THREE.DoubleSide})));
    apple.rotation.z = -0.12;

    // ── 스크롤 키프레임 ──
    let frames: {at: number; pose: Pose}[] = [];
    const measure = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const narrow = window.innerWidth < 760;
      frames = [...document.querySelectorAll<HTMLElement>('[data-apple]')].map(s => {
        const [x, y, sc] = (narrow ? s.dataset.appleMobile ?? s.dataset.apple! : s.dataset.apple!).split(',').map(Number);
        const top = s.getBoundingClientRect().top + window.scrollY;
        const at = Math.min(1, Math.max(0, (top + s.offsetHeight / 2 - window.innerHeight / 2) / max));
        return {at, pose: {x, y, s: sc}};
      }).sort((a, b) => a.at - b.at);
    };
    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const poseAt = (p: number): Pose => {
      if (!frames.length) return {x: 0, y: 0, s: 1};
      if (p <= frames[0].at) return frames[0].pose;
      for (let i = 1; i < frames.length; i++) {
        if (p <= frames[i].at) {
          const a = frames[i - 1], b = frames[i], t = ease((p - a.at) / Math.max(1e-6, b.at - a.at));
          return {x: a.pose.x + (b.pose.x - a.pose.x) * t, y: a.pose.y + (b.pose.y - a.pose.y) * t, s: a.pose.s + (b.pose.s - a.pose.s) * t};
        }
      }
      return frames[frames.length - 1].pose;
    };

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); measure();
    };
    resize(); window.addEventListener('resize', resize);
    const ro = new ResizeObserver(() => measure()); ro.observe(document.body);

    let raf = 0, last = performance.now(), cur: Pose | null = null, timeSpin = 0, alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      const target = poseAt(p);
      cur = cur ? {x: cur.x + (target.x - cur.x) * Math.min(1, dt * 6), y: cur.y + (target.y - cur.y) * Math.min(1, dt * 6), s: cur.s + (target.s - cur.s) * Math.min(1, dt * 6)} : target;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z, halfW = halfH * camera.aspect;
      const bob = reduce ? 0 : Math.sin(now / 1100) * 0.04;
      apple.position.set(cur.x * halfW, cur.y * halfH + bob, 0);
      apple.scale.setScalar(cur.s);
      if (!reduce) timeSpin += dt * 0.35;
      spin.rotation.y = timeSpin + p * Math.PI * 5;
      spin.rotation.x = Math.sin(p * Math.PI * 2) * 0.25 + 0.12;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); ro.disconnect();
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
      skin.map?.dispose(); env.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="landing-apple" aria-hidden="true">{failed && <div className="landing-apple-fallback" />}</div>;
}
