'use client';
// 요약 화면의 3D 저온저장고. 보관 중인 사과(로트) 하나 = 팔레트 하나.
// 보여 주는 값은 모두 요약 화면이 이미 가진 값(이름·품종·저장 일수·상태·저장 온도·물량)입니다. 새로 계산하거나 지어내는 값은 없습니다.
// 장면 구성은 농사로 저온저장 안내(유니트쿨러, 통풍 플라스틱 상자, 팔레트 간격)를 참고했습니다. 상자 색은 품종 구분용입니다.
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

export type StorageItem = {id: string; name: string; variety: string; hongro: boolean; day: number | null; tone: 'ok' | 'warn' | 'muted'; status: string; temp: number | null; qty: number | null; unit: string | null};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, rep?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; return t;
}

export default function Storage3D({items, onOpen}: {items: StorageItem[]; onOpen: (id: string) => void}) {
  const box = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<StorageItem | null>(null), [failed, setFailed] = useState(false);
  const selRef = useRef<string | null>(null);
  useEffect(() => {
    const host = box.current, lb = labels.current; if (!host || !lb) return;
    const mobile = matchMedia('(max-width: 720px)').matches;
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({antialias: !mobile, powerPreference: 'low-power'}); } catch { setFailed(true); return; }
    const W = () => host.clientWidth, H = () => host.clientHeight;
    r.setPixelRatio(Math.min(mobile ? 1.5 : 2, devicePixelRatio)); r.setSize(W(), H());
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .85;
    host.appendChild(r.domElement);
    const sc = new THREE.Scene(); sc.background = new THREE.Color('#1E2329');
    const pm = new THREE.PMREMGenerator(r); const env = pm.fromScene(new RoomEnvironment(), .04).texture; sc.environment = env; sc.environmentIntensity = .22;
    const cam = new THREE.PerspectiveCamera(42, W() / H(), .05, 100);
    const disposables: {dispose: () => void}[] = [env, pm];
    const keep = <T extends {dispose: () => void}>(x: T) => { disposables.push(x); return x; };

    // 방 크기: 팔레트 수에 맞춰 넓힘(한 줄 최대 4개, 팔레트 사이 약 0.6m)
    const COLS = mobile ? 2 : 4, n = items.length, perRow = Math.min(COLS, Math.max(1, n)), rows = Math.max(1, Math.ceil(n / COLS));
    const RW = Math.max(8, perRow * 1.75 + 4.5), RD = Math.max(7, rows * 1.9 + 4.5), RH = 4.2;
    const panelT = keep(canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#EDEEEA'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = x % 32 ? 'rgba(0,0,0,.025)' : 'rgba(0,0,0,.06)'; g.fillRect(x, 0, 2, h); } g.fillStyle = 'rgba(90,95,100,.45)'; g.fillRect(0, 0, 3, h); g.fillRect(w / 2, 0, 3, h); }, [Math.round(RW / 1.8), 1]));
    const floorT = keep(canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#8E969E'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},.03)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [3, 3]));
    const ventT = keep(canvasTex(256, 160, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); for (let rr = 0; rr < 3; rr++) for (let c = 0; c < 7; c++) g.clearRect(16 + c * 33, 28 + rr * 38, 22, 24); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 8, w, 8); }));
    const appleT = keep(canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { const x = Math.random() * w; g.strokeStyle = `rgba(255,${200 + Math.random() * 55},${120 + Math.random() * 80},${Math.random() * .55})`; g.lineWidth = rnd(.5, 2.5); g.beginPath(); g.moveTo(x, rnd(0, h * .3)); g.bezierCurveTo(x + rnd(-6, 6), h * .4, x + rnd(-6, 6), h * .7, x + rnd(-4, 4), h); g.stroke(); } for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(255,240,200,.5)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(.4, 1.1), 0, 7); g.fill(); } }));

    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(RW, RD)), keep(new THREE.MeshStandardMaterial({map: floorT, roughness: .45, metalness: .05}))); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    const pM = keep(new THREE.MeshStandardMaterial({map: panelT, roughness: .5, metalness: .1}));
    const plane = (w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, m: THREE.Material = pM) => { const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), m); p.position.set(x, y, z); p.rotation.set(rx, ry, 0); p.receiveShadow = true; sc.add(p); return p; };
    plane(RW, RH, 0, RH / 2, -RD / 2); plane(RD, RH, -RW / 2, RH / 2, 0, 0, Math.PI / 2); plane(RD, RH, RW / 2, RH / 2, 0, 0, -Math.PI / 2); plane(RW, RD, 0, RH, 0, Math.PI / 2, 0);
    const trimM = keep(new THREE.MeshStandardMaterial({color: '#C9CCC6', roughness: .6}));
    // 출입문 + 비닐커튼
    const dx = RW / 2 - .02, dz = RD / 2 - 1.6;
    const doorDark = new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2.55)), keep(new THREE.MeshBasicMaterial({color: '#0E1114'}))); doorDark.position.set(dx - .03, 1.28, dz); doorDark.rotation.y = -Math.PI / 2; sc.add(doorDark);
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(.08, 2.7, 2.2)), keep(new THREE.MeshStandardMaterial({color: '#AEB4B8', metalness: .6, roughness: .35}))); frame.position.set(dx, 1.35, dz); sc.add(frame);
    const stripM = keep(new THREE.MeshStandardMaterial({color: '#CFE3E6', transparent: true, opacity: .45, roughness: .15, side: THREE.DoubleSide}));
    const stripG = keep(new THREE.PlaneGeometry(.21, 2.5));
    for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(stripG, stripM); s.position.set(dx - .1, 1.3, dz - .95 + i * .21); s.rotation.y = -Math.PI / 2 + rnd(-.05, .05); sc.add(s); }
    // 천장 유니트쿨러(팬 3개)
    const cool = new THREE.Group(); cool.position.set(-RW / 2 + 2.4, RH - .45, -RD / 2 + .55); sc.add(cool);
    const cb = new THREE.Mesh(keep(new THREE.BoxGeometry(3, .62, .85)), keep(new THREE.MeshStandardMaterial({color: '#E6E8E6', roughness: .35, metalness: .35}))); cb.castShadow = true; cool.add(cb);
    const fans: THREE.Group[] = [];
    const ringG = keep(new THREE.TorusGeometry(.22, .025, 10, 40)), ringM = keep(new THREE.MeshStandardMaterial({color: '#5A6066', metalness: .5, roughness: .4}));
    const grillG = keep(new THREE.CircleGeometry(.21, 32)), grillM = keep(new THREE.MeshStandardMaterial({color: '#2B3035', roughness: .6}));
    const bladeG = keep(new THREE.BoxGeometry(.06, .36, .01)), bladeM = keep(new THREE.MeshStandardMaterial({color: '#7C848B', metalness: .4}));
    for (let i = 0; i < 3; i++) { const x = -.95 + i * .95; const ring = new THREE.Mesh(ringG, ringM); ring.position.set(x, 0, .43); cool.add(ring); const gr = new THREE.Mesh(grillG, grillM); gr.position.set(x, 0, .432); cool.add(gr);
      const bl = new THREE.Group(); bl.position.set(x, 0, .44); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(bladeG, bladeM); b.rotation.z = k * Math.PI / 4; bl.add(b); } cool.add(bl); fans.push(bl); }
    // 조명
    sc.add(new THREE.HemisphereLight(0xe8f0ff, 0x2f3438, 1.1));
    const lightXs = [-RW / 4, RW / 4];
    lightXs.forEach((x, i) => { const p = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, .04, .18)), keep(new THREE.MeshBasicMaterial({color: '#F7FBFF'}))); p.position.set(x, RH - .03, -RD / 6); sc.add(p);
      const s = new THREE.SpotLight(0xf2f7ff, 22, 0, Math.PI / 2.5, .6, 2); s.position.set(x, RH - .08, -RD / 6); s.target.position.set(x, 0, -RD / 6); s.castShadow = !mobile || i === 0; s.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024); s.shadow.bias = -.0004; sc.add(s, s.target); });

    // 사과 모양(위아래가 오목한 회전체)
    const appleGeo = keep(new THREE.LatheGeometry([[0, -.031], [.01, -.035], [.024, -.033], [.034, -.024], [.04, -.01], [.041, .004], [.039, .017], [.033, .028], [.022, .035], [.012, .035], [.006, .03], [0, .026]].map(([x, y]) => new THREE.Vector2(x, y)), mobile ? 16 : 24));
    const appleM = keep(new THREE.MeshPhysicalMaterial({map: appleT, roughness: .38, clearcoat: .5, clearcoatRoughness: .3}));
    const palM = keep(new THREE.MeshStandardMaterial({color: '#9C7A52', roughness: .85}));
    const cw = .54, cd = .36, ch = .29;
    const maxQty = Math.max(0, ...items.map(it => it.qty ?? 0));
    const groups: THREE.Group[] = [];
    const tops: number[] = [];
    items.forEach((it, i) => {
      const row = Math.floor(i / COLS), col = i % COLS, rowN = Math.min(COLS, n - row * COLS);
      const g = new THREE.Group(); g.position.set((col - (rowN - 1) / 2) * 1.75, 0, -RD / 2 + 1.5 + row * 1.9); sc.add(g); g.userData.id = it.id;
      // 팔레트(1.1m)
      const deckG = keep(new THREE.BoxGeometry(.13, .02, 1.1)), runG = keep(new THREE.BoxGeometry(.1, .1, 1.1));
      for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(runG, palM); s.position.set(-.5 + k * .5, .06, 0); s.castShadow = true; g.add(s); }
      for (let k = 0; k < 7; k++) { const d = new THREE.Mesh(deckG, palM); d.position.set(-.49 + k * .163, .12, 0); d.castShadow = d.receiveShadow = true; g.add(d); }
      // 상자 단 수: 물량을 입력한 사과끼리 상대 비교(2~7단), 입력이 없으면 4단
      const layers = it.qty && maxQty > 0 ? Math.max(2, Math.round(2 + 5 * it.qty / maxQty)) : 4;
      const tint = it.hongro ? '#E3B53B' : '#3E7CB1';
      const sideM = keep(new THREE.MeshStandardMaterial({color: tint, map: ventT, alphaTest: .5, side: THREE.DoubleSide, roughness: .55}));
      const solidM = keep(new THREE.MeshStandardMaterial({color: tint, roughness: .5}));
      const sideW = keep(new THREE.PlaneGeometry(cw, ch)), sideD = keep(new THREE.PlaneGeometry(cd, ch)), bottomG = keep(new THREE.BoxGeometry(cw, .012, cd)), rimG = keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(cw + .01, .02, cd + .01)));
      const top: THREE.Vector3[] = [];
      for (let y = 0; y < layers; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) {
        const c = new THREE.Group(); c.position.set(-.275 + a * .55, .13 + y * (ch + .005), -.37 + b * .37); c.rotation.y = rnd(-.02, .02);
        const bt = new THREE.Mesh(bottomG, solidM); bt.position.y = .006; c.add(bt);
        ([[sideW, 0, cd / 2, 0], [sideW, 0, -cd / 2, Math.PI], [sideD, cw / 2, 0, Math.PI / 2], [sideD, -cw / 2, 0, -Math.PI / 2]] as const).forEach(([geo, x, z, ry]) => { const s = new THREE.Mesh(geo, sideM); s.position.set(x, ch / 2, z); s.rotation.y = ry; s.castShadow = true; c.add(s); });
        const rim = new THREE.LineSegments(rimG, keep(new THREE.LineBasicMaterial({color: tint}))); rim.position.y = ch; c.add(rim);
        g.add(c); if (y === layers - 1) top.push(c.position.clone());
      }
      // 맨 위 상자에 사과(크기·기울기·색을 조금씩 다르게)
      const per = mobile ? 12 : 24, inst = new THREE.InstancedMesh(appleGeo, appleM, top.length * per), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col3 = new THREE.Color();
      const hue = it.hongro ? .0 : .99;
      top.forEach((p, ci) => { for (let k = 0; k < per; k++) { const rr = mobile ? Math.floor(k / 4) : Math.floor(k / 6), cc = mobile ? k % 4 : k % 6, step = mobile ? .12 : .09, s = rnd(.92, 1.12) * (mobile ? 1.25 : 1);
        const x = p.x - (mobile ? .18 : .225) + cc * step + (rr % 2) * .03 + rnd(-.008, .008), z = p.z - .135 + rr * (mobile ? .135 : .09) + rnd(-.008, .008), yy = p.y + ch - .01 + rnd(-.006, .008);
        e.set(rnd(-.35, .35), rnd(0, 6.28), rnd(-.35, .35)); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, yy, z), q, new THREE.Vector3(s, s * rnd(.9, 1), s)); inst.setMatrixAt(ci * per + k, m4);
        col3.setHSL((hue + rnd(-.018, .018) + 1) % 1, rnd(.62, .8), rnd(.33, .45)); inst.setColorAt(ci * per + k, col3); } });
      inst.castShadow = true; g.add(inst);
      if (it.tone === 'warn') { const ring = new THREE.Mesh(keep(new THREE.RingGeometry(.95, 1.05, 64)), keep(new THREE.MeshBasicMaterial({color: '#FF8A2A', transparent: true, opacity: .8}))); ring.rotation.x = -Math.PI / 2; ring.position.y = .01; g.add(ring); g.userData.ring = ring; }
      groups.push(g); tops.push(.13 + layers * (ch + .005) + .3);
    });
    // 이름표
    lb.replaceChildren(...items.map(it => { const d = document.createElement('div'); d.className = 's3d-tag' + (it.tone === 'warn' ? ' warn' : ''); d.textContent = it.name; return d; }));

    // 카메라: 드래그로 좌우·위아래 조금씩
    const tgt = new THREE.Vector3(0, .9, -RD / 2 + 1.5 + (rows - 1) * .95);
    let yaw = .35, pitch = .2, drag: [number, number] | null = null, moved = 0, raf = 0, alive = true;
    const R = (perRow * 1.3 + 2.4 + (rows - 1) * .8) * (mobile ? 1.35 : 1);
    const ray = new THREE.Raycaster(), v = new THREE.Vector3(), t0 = performance.now();
    const down = (e: PointerEvent) => { drag = [e.clientX, e.clientY]; moved = 0; };
    const move = (e: PointerEvent) => { if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; moved += Math.abs(dx) + Math.abs(dy); yaw = Math.min(.9, Math.max(-.7, yaw - dx * .004)); pitch = Math.min(.55, Math.max(.05, pitch + dy * .003)); drag = [e.clientX, e.clientY]; };
    const up = (e: PointerEvent) => { drag = null; if (moved > 6) return; const rect = r.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), cam);
      const hit = ray.intersectObjects(groups, true)[0]; if (!hit) return; let o: THREE.Object3D | null = hit.object; while (o && !groups.includes(o as THREE.Group)) o = o.parent; const id = o?.userData.id as string | undefined; const it = items.find(x => x.id === id); if (it) { selRef.current = it.id; setSel(it); } };
    r.domElement.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up);
    const resize = () => { r.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); }; addEventListener('resize', resize);
    let visible = true; const io = new IntersectionObserver(es => { visible = es[0]?.isIntersecting ?? true; }); io.observe(host);
    const tagEls = Array.from(lb.children) as HTMLElement[];
    const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); if (!visible || document.hidden) return; const tt = (performance.now() - t0) / 1000;
      cam.position.set(tgt.x + Math.sin(yaw) * Math.cos(pitch) * R, 1.55 + Math.sin(pitch) * R, tgt.z + Math.cos(yaw) * Math.cos(pitch) * R); cam.lookAt(tgt);
      fans.forEach(f => { f.rotation.z = tt * 9; });
      groups.forEach((g, i) => { g.position.y = items[i].id === selRef.current ? .04 : 0; const ring = g.userData.ring as THREE.Mesh | undefined; if (ring) (ring.material as THREE.MeshBasicMaterial).opacity = .5 + .35 * Math.sin(tt * 3);
        v.set(g.position.x, tops[i], g.position.z).project(cam); const el = tagEls[i]; if (el) { el.style.left = `${(v.x + 1) / 2 * 100}%`; el.style.top = `${(1 - v.y) / 2 * 100}%`; } });
      r.render(sc, cam); };
    loop();
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('resize', resize); r.domElement.removeEventListener('pointerdown', down);
      sc.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); }); disposables.forEach(d => d.dispose()); r.dispose(); r.domElement.remove(); lb.replaceChildren(); };
  }, [items]);

  if (failed) return null;
  const temps = Array.from(new Set(items.map(it => it.temp).filter((t): t is number => t !== null)));
  return <section className="s3d" aria-label="내 저온저장고 3D 보기">
    <div className="s3d-stage" ref={box} />
    <div className="s3d-tags" ref={labels} aria-hidden="true" />
    <p className="s3d-chip">내 저장고 · {temps.length === 1 ? `${temps[0]}℃ · ` : ''}보관 중 {items.length}건</p>
    {sel ? <div className="s3d-panel" role="status"><b>{sel.name}</b><span>{[sel.variety, sel.day !== null && sel.day >= 0 ? `${sel.day}일째` : null, sel.temp !== null ? `${sel.temp}℃` : null].filter(Boolean).join(' · ')}</span>
      <em className={sel.tone}>{sel.status}</em><button type="button" onClick={() => onOpen(sel.id)}>상세 대시보드 열기 →</button></div>
      : <p className="s3d-panel s3d-hint">상자 더미를 눌러 보세요 · 끌어서 돌려 보기</p>}
    <p className="s3d-legend"><span className="b" />후지 상자 <span className="y" />홍로 상자 <span className="o" />한 번 재 볼 사과 · 상자 높이는 입력한 물량 비교(입력 없으면 기본 높이)</p>
  </section>;
}
