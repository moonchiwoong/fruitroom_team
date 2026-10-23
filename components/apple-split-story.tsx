'use client';
import {useEffect, useMemo, useRef, type ReactNode} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildApple} from './apple-model';
import {mulberry32} from '@/lib/apple-skin-painter';
import {addDays, computeSeries, fmtNum, todayKST} from '@/lib/tracker';

/**
 * 첫 화면 스크롤 이야기: 사과가 반으로 갈라지고, 단면에서 측정값이 뽑혀 나와 그래프가 됩니다.
 * 스크롤 위치에 맞춰 움직이므로 위로 올리면 거꾸로 되감깁니다.
 * 값은 모두 예시 데이터이며, 그래프는 시연용 계산입니다.
 */

const METRICS = [
  {id: 'firmness', name: '경도', value: 72, unit: 'N', digits: 1, anchor: [0.6, 0.22] as const, half: 0 as const},
  {id: 'brix', name: '당도', value: 14.2, unit: '°Brix', digits: 1, anchor: [-0.32, 0.42] as const, half: 1 as const},
  {id: 'acidity', name: '산도', value: 0.38, unit: '%', digits: 2, anchor: [0.12, 0.13] as const, half: 1 as const},
];
const CAPTIONS = [
  {at: [0.12, 0.34], step: '01 · 측정', title: '사과 한 알을 열어 보면', body: '겉으로는 같아 보여도 단단함, 단맛, 신맛은 한 알마다 달라요.'},
  {at: [0.34, 0.57], step: '02 · 데이터화', title: '품질을 숫자로 남깁니다', body: '경도(N)·당도(°Brix)·산도(%)를 기록하면 사과 한 알이 데이터가 됩니다.'},
  {at: [0.57, 0.85], step: '03 · 예측', title: '저장 중 변화를 미리 봅니다', body: '초기 품질과 저장 조건으로 날짜별 변화를 계산하고, 나중에 잰 값과 비교해요.'},
];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 구간 [a,b] 안에서만 보이고, 앞뒤 f 만큼 서서히 나타나고 사라짐 (last=true면 끝에서 사라지지 않음) */
const windowOp = (p: number, a: number, b: number, f = 0.035, last = false) => Math.min(seg(p, a, a + f), last ? 1 : 1 - seg(p, b - f, b));

export default function AppleSplitStory({intro, onFail}: {intro: ReactNode; onFail: () => void}) {
  const section = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null), hintRef = useRef<HTMLDivElement>(null), finalRef = useRef<HTMLDivElement>(null);
  const capRefs = useRef<(HTMLDivElement | null)[]>([]), labelRefs = useRef<(HTMLDivElement | null)[]>([]), valueRefs = useRef<(HTMLElement | null)[]>([]);
  const lineRefs = useRef<(SVGPathElement | null)[]>([]), dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const cardRef = useRef<HTMLDivElement>(null), slotRefs = useRef<(HTMLDivElement | null)[]>([]), clipRef = useRef<SVGRectElement>(null), endDotRef = useRef<SVGCircleElement>(null);

  // 카드 안 예시 그래프 (후지 · 저온저장 · 경도). 실제 계산 엔진으로 만든 시연용 값입니다.
  const chart = useMemo(() => {
    const start = addDays(todayKST(), -28), asOfDay = 28;
    const s = computeSeries({variety: '후지', metric: 'firmness', anchor: {day: 0, date: start, value: 72, kind: '예시', source: 'initial'}, recorded: 'cold', future: 'cold', asOfDay});
    const pts = s.ok ? s.points : [];
    const W = 420, H = 150, L = 22, R = 24, T = 10, B = 24;
    const vals = pts.map(p => p.value), lo = Math.min(...vals) - 0.3, hi = Math.max(...vals) + 0.3;
    const x = (d: number) => L + d / 300 * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
    const ff = pts.findIndex(p => p.segment === 'future');
    const toPath = (list: typeof pts) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    return {W, H, L, R, T, B, x, asOfDay, past: toPath(pts.filter(p => p.segment === 'past')), future: toPath(pts.slice(Math.max(0, ff - 1))),
      end: last ? {cx: x(last.day), cy: y(last.value), v: last.value} : null};
  }, []);

  useEffect(() => {
    const sec = section.current, stg = stage.current, el = host.current; if (!sec || !stg || !el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, alpha: true}); } catch { onFail(); return; }
    const narrowQ = () => stg.clientWidth < 820;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrowQ() ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); camera.position.set(0, 0, 7);
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.08); scene.environment = env.texture; scene.environmentIntensity = 0.55; room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xfffaf0, 0x5d4a3a, 0.9));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(-3, 4.5, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.8); fill.position.set(4, 0.5, 4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(1.5, 2.5, -4.5); scene.add(rim);

    // ── 사과 두 쪽: 같은 모양의 사과 두 개를 x=0 면에서 반대로 잘라 붙여 둡니다 ──
    const root = new THREE.Group(); scene.add(root);
    // 단면 그림은 한 번만 그려 두 쪽이 함께 씁니다 (같은 면을 양쪽에서 보는 것이므로 거울상)
    const base = buildApple({seed: 11, leaf: false}), profZ = base.cutProfile(192); base.dispose();
    const pbox = new THREE.Box2().setFromPoints(profZ), pc = pbox.getCenter(new THREE.Vector2()), S = Math.max(pbox.max.x - pbox.min.x, pbox.max.y - pbox.min.y) * 1.02;
    const painted = paintFlesh(profZ, pc, S);
    const tex = new THREE.CanvasTexture(painted.color); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const bump = new THREE.CanvasTexture(painted.bump); bump.anisotropy = 8;
    const capMat = new THREE.MeshPhysicalMaterial({map: tex, bumpMap: bump, bumpScale: 0.35, color: 0xeee4d2, roughness: 0.55, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.4, sheen: 0.08, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff4d6), envMapIntensity: 0.35});
    const halves = [0, 1].map(i => {
      const sign = i === 0 ? -1 : 1;                                   // 0: 왼쪽(x<0을 남김), 1: 오른쪽(x>0을 남김)
      const half = new THREE.Group(); root.add(half);
      const model = buildApple({seed: 11}); half.add(model.group);
      const local = new THREE.Plane(new THREE.Vector3(sign, 0, 0), 0), world = new THREE.Plane();
      model.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.clippingPlanes = [world]; });
      // 단면: 같은 윤곽으로 만든 판에 과육 그림을 입힙니다
      const prof = profZ.map(v => new THREE.Vector2(i === 0 ? -v.x : v.x, v.y));
      const capGeo = new THREE.ShapeGeometry(new THREE.Shape(prof), 1);
      const uv = capGeo.attributes.uv, cp = capGeo.attributes.position;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, ((i === 0 ? -cp.getX(k) : cp.getX(k)) - pc.x) / S + 0.5, (cp.getY(k) - pc.y) / S + 0.5);
      const cap = new THREE.Mesh(capGeo, capMat); cap.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2; half.add(cap);
      return {half, model, local, world, sign, cap, capGeo};
    });
    const anchorLocal = METRICS.map(m => new THREE.Vector3(halves[m.half].sign * -0.002, m.anchor[1], m.anchor[0]));

    let W = 1, H = 1;
    const resize = () => { W = stg.clientWidth; H = stg.clientHeight; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(stg);

    const tmp = new THREE.Vector3();
    const toScreen = (v: THREE.Vector3, obj: THREE.Object3D) => { tmp.copy(v).applyMatrix4(obj.matrixWorld).project(camera); return {x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H}; };
    const rel = (e: Element) => { const a = e.getBoundingClientRect(), b = stg.getBoundingClientRect(); return {x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height}; };
    const show = (e: HTMLElement | SVGElement | null, op: number, ty = 0) => {
      if (!e) return; e.style.opacity = op.toFixed(3); e.style.visibility = op < 0.01 ? 'hidden' : 'visible';
      e.style.pointerEvents = op > 0.6 ? 'auto' : 'none'; if (ty || e.style.transform) e.style.transform = `translateY(${ty.toFixed(1)}px)`;
    };

    let raf = 0, running = false, cur = -1, last = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      const r = sec.getBoundingClientRect(), stick = parseFloat(getComputedStyle(stg).top) || 0, target = clamp((stick - r.top) / Math.max(1, r.height - stg.clientHeight));
      cur = cur < 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt * 9));
      const p = cur, narrow = W < 820;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z, halfW = halfH * camera.aspect;

      // ── 사과: 소개 → 갈라짐 → 단면을 보여 줌 → 카드 뒤로 작아짐 ──
      const split = ease(seg(p, 0.12, 0.33)), away = ease(seg(p, 0.57, 0.67));
      const baseX = narrow ? 0 : halfW * 0.3, baseY = narrow ? lerp(-halfH * 0.42, halfH * 0.3, ease(seg(p, 0.04, 0.2))) : 0;
      const size = (narrow ? Math.min(0.62, halfW * 0.5) : Math.min(1.15, halfW * 0.28)) * lerp(1, 0.55, away);
      root.position.set(lerp(baseX, narrow ? 0 : halfW * 0.28, away), lerp(baseY, baseY + halfH * (narrow ? 0.15 : 0.1), away) + Math.sin(now / 1300) * 0.03 * (1 - split), 0);
      root.scale.setScalar(size);
      root.rotation.set(0.1 * (1 - split), (0.16 - Math.min(p, 0.16)) * 9 + 0.35 * (1 - seg(p, 0, 0.16)) * Math.sin(now / 2400), -0.1 * (1 - split));
      const gap = split * 0.72, turn = split * 1.05;
      halves.forEach(h => { h.half.position.x = h.sign * gap; h.half.rotation.y = h.sign * turn; h.half.rotation.x = split * 0.1; });
      el.style.opacity = (1 - seg(p, 0.61, 0.67)).toFixed(3);
      scene.updateMatrixWorld();
      halves.forEach(h => h.world.copy(h.local).applyMatrix4(h.half.matrixWorld));
      renderer.render(scene, camera);

      // ── 글 ──
      show(introRef.current, 1 - seg(p, 0.03, 0.1), -seg(p, 0.03, 0.1) * 40);
      show(hintRef.current, 1 - seg(p, 0.0, 0.04));
      CAPTIONS.forEach((c, i) => { const op = windowOp(p, c.at[0], c.at[1]); show(capRefs.current[i], op, (1 - seg(p, c.at[0], c.at[0] + 0.04)) * 24); });
      const fin = seg(p, 0.86, 0.92); show(finalRef.current, fin, (1 - fin) * 24);

      // ── 카드·그래프 ──
      const cardOp = seg(p, 0.63, 0.69); show(cardRef.current, cardOp, (1 - cardOp) * 30);
      if (clipRef.current) clipRef.current.setAttribute('width', String((chart.W - chart.L - chart.R + 8) * ease(seg(p, 0.7, 0.86))));
      if (endDotRef.current) { const e = seg(p, 0.85, 0.88); endDotRef.current.style.opacity = String(e); }

      // ── 단면에서 뽑혀 나오는 측정값 → 카드 칸으로 모임 ──
      const fly = ease(seg(p, 0.65, 0.76));
      METRICS.forEach((m, i) => {
        const a = toScreen(anchorLocal[i], halves[m.half].half);
        const t = seg(p, 0.35 + i * 0.045, 0.45 + i * 0.045), te = ease(t);
        const lab = labelRefs.current[i], line = lineRefs.current[i], dot = dotRefs.current[i], slot = slotRefs.current[i];
        if (!lab || !line || !dot) return;
        const lw = narrow ? Math.min(112, (W - 48) / 3) : 132, lh = narrow ? 58 : 64;
        // 펼쳐진 자리
        let tx: number, ty: number;
        if (narrow) { tx = 16 + i * ((W - 32 - lw) / 2); ty = H * 0.56; }
        else { const off = [[-230, -110], [150, -120], [150, 70]][i]; tx = a.x + off[0]; ty = a.y + off[1]; }
        tx = clamp(tx, 12, W - lw - 12); ty = clamp(ty, 12, H - lh - 12);
        // 카드 칸으로 이동
        let w = lw, h = lh;
        if (slot && fly > 0) { const s = rel(slot); tx = lerp(tx, s.x, fly); ty = lerp(ty, s.y, fly); w = lerp(lw, s.w, fly); h = lerp(lh, s.h, fly); }
        lab.style.transform = `translate(${tx.toFixed(1)}px,${(ty + (1 - te) * 14).toFixed(1)}px)`; lab.style.width = `${w.toFixed(1)}px`; lab.style.height = `${h.toFixed(1)}px`;
        lab.style.opacity = String(Math.max(te, fly > 0 ? 1 : 0) * (p < 0.3 ? 0 : 1)); lab.style.visibility = te > 0.01 ? 'visible' : 'hidden';
        lab.style.setProperty('--shadow', String(1 - fly));
        const v = valueRefs.current[i]; if (v) { const txt = fmtNum(m.value * ease(seg(p, 0.37 + i * 0.045, 0.5 + i * 0.045)), m.digits); if (v.textContent !== txt) v.textContent = txt; }
        // 선: 단면의 점 → 라벨 가장자리
        const ex = narrow ? tx + w / 2 : (tx + w / 2 < a.x ? tx + w : tx), ey = narrow ? ty : ty + h / 2;
        line.setAttribute('d', `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`);
        const lineOp = 1 - seg(p, 0.57, 0.62);
        line.style.strokeDashoffset = String(1 - ease(seg(p, 0.34 + i * 0.045, 0.41 + i * 0.045))); line.style.opacity = String(lineOp);
        dot.setAttribute('cx', a.x.toFixed(1)); dot.setAttribute('cy', a.y.toFixed(1));
        dot.style.opacity = String(seg(p, 0.33 + i * 0.045, 0.36 + i * 0.045) * lineOp);
      });
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? start() : stop()), {rootMargin: '200px 0px'});
    io.observe(sec);

    return () => {
      stop(); io.disconnect(); ro.disconnect();
      halves.forEach(h => { h.model.dispose(); h.capGeo.dispose(); }); tex.dispose(); bump.dispose(); capMat.dispose();
      env.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [chart, onFail]);

  return <section ref={section} className="as-story" aria-label="사과 한 알이 데이터가 되는 과정">
    <div ref={stage} className="as-stage">
      <div ref={host} className="as-canvas" aria-hidden="true" />
      <svg className="as-lines" aria-hidden="true">
        {METRICS.map((m, i) => <g key={m.id}><path ref={e => { lineRefs.current[i] = e; }} pathLength={1} /><circle ref={e => { dotRefs.current[i] = e; }} r="5" /></g>)}
      </svg>

      <div ref={introRef} className="as-intro">{intro}</div>
      <div ref={hintRef} className="as-hint" aria-hidden="true"><span>아래로 스크롤해 보세요</span><i /></div>

      {CAPTIONS.map((c, i) => <div key={c.step} ref={e => { capRefs.current[i] = e; }} className="as-cap">
        <p className="as-step">{c.step}</p><h2>{c.title}</h2><p>{c.body}</p>
      </div>)}
      <div ref={finalRef} className="as-cap as-final">
        <p className="as-step">04 · 시작</p><h2>내 사과로 해 볼까요?</h2>
        <p>가입하지 않아도 바로 볼 수 있어요. 기록으로 저장할 때만 로그인합니다.</p>
        <div className="lv-actions"><a className="btn btn-primary btn-lg" href="/try">예시로 체험하기</a><a className="btn btn-soft btn-lg" href="/try?mode=real">내 측정값 입력하기</a></div>
      </div>

      <div ref={cardRef} className="as-card lv-preview">
        <div className="lv-preview-head"><span className="kind k-example">예시 데이터</span><span>후지 · 저온저장 · 초기 품질</span></div>
        <div className="as-slots">{METRICS.map((m, i) => <div key={m.id} ref={e => { slotRefs.current[i] = e; }} className="as-slot" />)}</div>
        <p className="as-card-title">저장 기간에 따른 경도 변화</p>
        <svg viewBox={`0 0 ${chart.W} ${chart.H}`} role="img" aria-label="예시 경도 변화 그래프. 실선은 분석 기준일까지, 점선은 이후 가정 구간">
          <defs><clipPath id="as-draw"><rect ref={clipRef} x={chart.L - 4} y={0} width={0} height={chart.H} /></clipPath></defs>
          {[0, 100, 200, 300].map(t => <g key={t}><line x1={chart.x(t)} x2={chart.x(t)} y1={chart.T} y2={chart.H - chart.B} stroke="#eef0f2" /><text x={chart.x(t)} y={chart.H - 6} textAnchor="middle" fontSize="12" fill="#6b7684">{t}일</text></g>)}
          <line x1={chart.x(chart.asOfDay)} x2={chart.x(chart.asOfDay)} y1={chart.T} y2={chart.H - chart.B} stroke="#4e5968" strokeDasharray="3 3" />
          <g clipPath="url(#as-draw)">
            <path d={chart.past} fill="none" stroke="#1d5c3c" strokeWidth="2.6" />
            <path d={chart.future} fill="none" stroke="#1d5c3c" strokeWidth="2.4" strokeDasharray="7 5" />
          </g>
          {chart.end && <circle ref={endDotRef} cx={chart.end.cx} cy={chart.end.cy} r="5" fill="#fff" stroke="#1d5c3c" strokeWidth="2.4" style={{opacity: 0}} />}
        </svg>
        <p className="lv-preview-foot"><span className="kind k-model">시연용 계산</span>검증 미확인 · 출하·안전 판정이 아닙니다</p>
      </div>

      {METRICS.map((m, i) => <div key={m.id} ref={e => { labelRefs.current[i] = e; }} className="as-label" style={{visibility: 'hidden'}}>
        <span className="as-label-name">{m.name}<em>예시</em></span>
        <span className="as-label-value"><b ref={e => { valueRefs.current[i] = e; }}>0</b><small>{m.unit}</small></span>
      </div>)}
    </div>
  </section>;
}

/**
 * 세로(꼭지-꽃받침)로 자른 사과 단면을 그립니다.
 * 크림색 과육과 세포 결, 껍질 바로 아래의 붉은 기, 씨방을 둘러싼 관다발 선,
 * 양피지 같은 씨방 막과 윤기 있는 씨, 꼭지 쪽 심과 꽃받침 관까지. 결 무늬는 요철(bump)로도 씁니다.
 */
function paintFlesh(prof: THREE.Vector2[], c: THREE.Vector2, S: number) {
  const N = typeof window !== 'undefined' && window.innerWidth < 820 ? 1024 : 1536, rand = mulberry32(5);
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = N; return [cv, cv.getContext('2d')!] as const; };
  const [cv, g] = mk(), [bv, b] = mk();
  const u = N / S, px = (x: number) => ((x - c.x) / S + 0.5) * N, py = (y: number) => (1 - ((y - c.y) / S + 0.5)) * N;
  const cx = px(0), coreY = 0.06;
  const outline = (ctx: CanvasRenderingContext2D, k = 1, cy = 0, wob = 0) => {
    ctx.beginPath(); prof.forEach((v, i) => { const a = i / prof.length * Math.PI * 2, w = 1 + wob * Math.sin(a * 7 + 1.3) + wob * 0.6 * Math.sin(a * 13 + 0.4);
      const X = px(v.x * k * w), Y = py(cy + (v.y - cy) * k * w); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath();
  };
  // 부드러운 값 잡음 (과육의 얼룩진 밝기 차이)
  const G = 64, grid = Array.from({length: G * G}, () => rand());
  const vn = (x: number, y: number) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s1 = xf * xf * (3 - 2 * xf), s2 = yf * yf * (3 - 2 * yf);
    const at = (i: number, j: number) => grid[((j % G + G) % G) * G + ((i % G + G) % G)];
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), s1), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), s1), s2); };
  const fbm = (x: number, y: number) => vn(x, y) * 0.55 + vn(x * 2.1, y * 2.1) * 0.3 + vn(x * 4.3, y * 4.3) * 0.15;

  // ── 1. 과육 바탕: 가운데는 밝은 크림색, 껍질 쪽으로 갈수록 노란 기 ──
  g.fillStyle = '#f2e3b6'; g.fillRect(0, 0, N, N); b.fillStyle = '#808080'; b.fillRect(0, 0, N, N);
  const grad = g.createRadialGradient(cx, py(coreY), u * 0.12, cx, py(coreY), u * 1.0);
  grad.addColorStop(0, '#f9efcf'); grad.addColorStop(0.45, '#f6e8bf'); grad.addColorStop(0.8, '#f1dfaa'); grad.addColorStop(1, '#e7d092');
  outline(g); g.fillStyle = grad; g.fill();

  // ── 2. 과육 결: 작은 캔버스에 얼룩을, 작은 타일에 알갱이를 만들어 늘려 덮습니다 (계산을 가볍게) ──
  const M = 320, [nv, nx] = (() => { const cv2 = document.createElement('canvas'); cv2.width = cv2.height = M; return [cv2, cv2.getContext('2d')!] as const; })();
  const nimg = nx.createImageData(M, M);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { const k = (y * M + x) * 4, v = 128 + (fbm(x / M * 9, y / M * 9) - 0.5) * 120; nimg.data[k] = nimg.data[k + 1] = nimg.data[k + 2] = v; nimg.data[k + 3] = 255; }
  nx.putImageData(nimg, 0, 0);
  const T = 256, [tv, tx] = (() => { const cv2 = document.createElement('canvas'); cv2.width = cv2.height = T; return [cv2, cv2.getContext('2d')!] as const; })();
  const timg = tx.createImageData(T, T);
  for (let k = 0; k < T * T * 4; k += 4) { const v = 128 + (rand() - 0.5) * 110; timg.data[k] = timg.data[k + 1] = timg.data[k + 2] = v; timg.data[k + 3] = 255; }
  tx.putImageData(timg, 0, 0);
  const grainPat = (ctx: CanvasRenderingContext2D) => { const pt = ctx.createPattern(tv, 'repeat')!; pt.setTransform(new DOMMatrix().scale(N / 1536 * 1.2)); return pt; };
  g.save(); outline(g); g.clip();
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.4; g.drawImage(nv, 0, 0, N, N);
  g.globalAlpha = 0.16; g.fillStyle = grainPat(g); g.fillRect(0, 0, N, N); g.restore();
  b.drawImage(nv, 0, 0, N, N); b.globalAlpha = 0.45; b.fillStyle = grainPat(b); b.fillRect(0, 0, N, N); b.globalAlpha = 1;
  // 세포가 모인 작은 반짝임(즙이 많은 과육의 결)
  g.save(); outline(g); g.clip();
  for (let i = 0, n = Math.round(2600 * (N / 1536) ** 2); i < n; i++) {
    const x = rand() * N, y = rand() * N, r = u * (0.004 + rand() * 0.007);
    g.fillStyle = rand() < 0.5 ? 'rgba(255,253,240,0.35)' : 'rgba(225,205,150,0.18)';
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2); g.fill();
    b.fillStyle = `rgba(${rand() < 0.5 ? 200 : 70},${rand() < 0.5 ? 200 : 70},${rand() < 0.5 ? 200 : 70},0.25)`; b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
  }

  // ── 3. 껍질 바로 아래 붉은 기: 고르지 않게 번진 안토시아닌 ──
  for (let pass = 0; pass < 3; pass++) {
    const wdt = [0.09, 0.05, 0.022][pass], al = [0.1, 0.18, 0.3][pass];
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i], bb = prof[(i + 1) % prof.length], t = i / prof.length;
      const amt = al * (0.45 + 0.9 * vn(t * 18 + pass * 3, pass * 5.1));                  // 위치마다 진하기가 다름
      g.strokeStyle = `rgba(196,58,52,${amt.toFixed(3)})`; g.lineWidth = u * wdt * (0.7 + 0.6 * vn(t * 11, 7 + pass)); g.lineCap = 'round';
      g.beginPath(); g.moveTo(px(a.x), py(a.y)); g.lineTo(px(bb.x), py(bb.y)); g.stroke();
    }
  }
  // 껍질 바로 안쪽 얇은 노란 녹색 층
  g.lineWidth = u * 0.014; g.strokeStyle = 'rgba(214,196,120,0.35)'; outline(g, 0.975); g.stroke();
  g.restore();

  // ── 4. 씨방 둘레 관다발: 꼭지에서 꽃받침까지 하트 모양으로 이어지는 점선 + 세로 줄기 ──
  const heart = (ctx: CanvasRenderingContext2D, s: number, wob = 0) => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 90; k++) {
      const a = k / 90 * Math.PI * 2, r = 1 + wob * Math.sin(a * 5 + 0.7);
      const xx = Math.sin(a) * (0.3 + 0.06 * Math.cos(a)) * s * r, yy = (Math.cos(a) * 0.36 + 0.05 * Math.cos(2 * a)) * s * r;
      pts.push([cx + xx * u, py(coreY + yy)]);
    }
    ctx.beginPath(); pts.forEach(([X, Y], k) => k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y)); ctx.closePath();
  };
  g.save(); heart(g, 1.55, 0.03); g.fillStyle = 'rgba(226,212,150,0.3)'; g.fill(); g.restore();         // 씨방 주변 살짝 투명한 과육
  for (let k = 0; k < 2; k++) {
    g.save(); g.setLineDash([u * (0.01 + rand() * 0.01), u * 0.016]); g.lineDashOffset = rand() * 50;
    g.lineWidth = u * (0.009 - k * 0.003); g.strokeStyle = k ? 'rgba(140,150,70,0.45)' : 'rgba(160,146,76,0.7)';
    heart(g, 1.55 + k * 0.05, 0.03); g.stroke(); g.restore();
  }
  b.save(); b.lineWidth = u * 0.008; b.strokeStyle = 'rgba(60,60,60,0.5)'; heart(b, 1.55, 0.03); b.stroke(); b.restore();
  // 세로 관다발 몇 가닥 (희미하게)
  g.lineCap = 'round';
  [-0.36, -0.2, 0.2, 0.36].forEach((off, k) => {
    g.strokeStyle = 'rgba(170,156,88,0.3)'; g.lineWidth = u * 0.006;
    g.beginPath(); g.moveTo(cx + off * 0.2 * u, py(0.58)); g.bezierCurveTo(cx + off * 1.3 * u, py(0.38), cx + off * 1.45 * u, py(-0.3 - k * 0.02), cx + off * 0.25 * u, py(-0.66)); g.stroke();
  });

  // ── 5. 꼭지 쪽 심(섬유) + 꽃받침 관 ──
  const fiber = (y0: number, y1: number, w: number, col: string) => {
    for (let k = 0; k < 5; k++) { g.strokeStyle = col; g.lineWidth = u * w * (0.5 + rand() * 0.6);
      g.beginPath(); g.moveTo(cx + (rand() - 0.5) * u * 0.02, py(y0)); g.bezierCurveTo(cx + (rand() - 0.5) * u * 0.03, py(lerp(y0, y1, 0.35)), cx + (rand() - 0.5) * u * 0.03, py(lerp(y0, y1, 0.7)), cx + (rand() - 0.5) * u * 0.015, py(y1)); g.stroke(); }
  };
  fiber(0.3, 0.63, 0.007, 'rgba(196,172,104,0.45)');
  // 꽃받침 관: 아래쪽 오목한 자리에서 씨방까지 좁아지는 깔때기, 안쪽은 갈색
  g.beginPath(); g.moveTo(cx - u * 0.05, py(-0.76)); g.bezierCurveTo(cx - u * 0.016, py(-0.64), cx - u * 0.02, py(-0.48), cx, py(-0.22));
  g.bezierCurveTo(cx + u * 0.02, py(-0.48), cx + u * 0.016, py(-0.64), cx + u * 0.05, py(-0.76)); g.closePath();
  const tube = g.createLinearGradient(0, py(-0.3), 0, py(-0.76)); tube.addColorStop(0, 'rgba(214,192,130,0.25)'); tube.addColorStop(0.55, 'rgba(176,140,84,0.45)'); tube.addColorStop(1, 'rgba(120,84,46,0.75)');
  g.fillStyle = tube; g.fill();
  for (let k = 0; k < 7; k++) { g.strokeStyle = 'rgba(90,58,30,0.6)'; g.lineWidth = u * 0.004; const xx = cx + (k - 3) * u * 0.012;
    g.beginPath(); g.moveTo(xx, py(-0.74)); g.lineTo(xx + (rand() - 0.5) * u * 0.02, py(-0.6 - rand() * 0.06)); g.stroke(); }  // 수술 흔적

  // ── 6. 씨방: 가운데 심을 사이에 두고 양쪽에 배 모양의 방, 양피지 같은 막, 안에 씨 하나씩 ──
  g.fillStyle = 'rgba(226,210,160,0.55)'; g.beginPath(); g.ellipse(cx, py(coreY), u * 0.026, u * 0.25, 0, 0, Math.PI * 2); g.fill();   // 가운데 심
  [-1, 1].forEach(sd => {
    const lx = cx + sd * u * 0.11, ly = py(coreY + 0.01), tilt = sd * 0.2, lw = u * 0.085, lh = u * 0.2;
    const boat = (ctx: CanvasRenderingContext2D, k: number) => { ctx.beginPath(); ctx.moveTo(0, -lh * k);
      ctx.bezierCurveTo(lw * 1.25 * k, -lh * 0.55 * k, lw * 1.05 * k, lh * 0.75 * k, 0, lh * k);
      ctx.bezierCurveTo(-lw * 1.05 * k, lh * 0.75 * k, -lw * 1.25 * k, -lh * 0.55 * k, 0, -lh * k); ctx.closePath(); };
    for (const ctx of [g, b]) { ctx.save(); ctx.translate(lx, ly); ctx.rotate(tilt); }
    // 막 바깥 테두리(연골질) — 옅은 황갈색, 살짝 반짝임
    boat(g, 1.18); g.fillStyle = '#eadcae'; g.fill(); g.lineWidth = u * 0.006; g.strokeStyle = 'rgba(176,150,90,0.75)'; g.stroke();
    boat(g, 1.0); const lg = g.createLinearGradient(-lw, 0, lw, 0); lg.addColorStop(0, '#d9c58f'); lg.addColorStop(0.5, '#efe3bb'); lg.addColorStop(1, '#cdb57a');
    g.fillStyle = lg; g.fill(); g.lineWidth = u * 0.004; g.strokeStyle = 'rgba(150,120,70,0.8)'; g.stroke();
    boat(b, 1.0); b.fillStyle = '#3a3a3a'; b.fill();                                                    // 방은 움푹하게
    g.strokeStyle = 'rgba(255,252,236,0.7)'; g.lineWidth = u * 0.004; g.beginPath(); g.moveTo(-lw * 0.5, -lh * 0.55); g.quadraticCurveTo(-lw * 0.85, 0, -lw * 0.45, lh * 0.6); g.stroke();  // 막의 윤기
    // 씨: 끝이 뾰족한 물방울, 짙은 갈색에 반사광
    const sw = u * 0.062, sh = u * 0.155, sy = lh * 0.1;
    const seed = (ctx: CanvasRenderingContext2D) => { ctx.beginPath(); ctx.moveTo(0, sy - sh * 0.55); ctx.bezierCurveTo(sw * 0.95, sy - sh * 0.1, sw * 0.85, sy + sh * 0.5, 0, sy + sh * 0.5); ctx.bezierCurveTo(-sw * 0.85, sy + sh * 0.5, -sw * 0.95, sy - sh * 0.1, 0, sy - sh * 0.55); ctx.closePath(); };
    g.save(); g.shadowColor = 'rgba(70,40,10,0.35)'; g.shadowBlur = u * 0.012; seed(g);
    const sg = g.createRadialGradient(-sw * 0.25, sy - sh * 0.05, sw * 0.1, 0, sy, sh * 0.6); sg.addColorStop(0, '#8a5530'); sg.addColorStop(0.5, '#5a321a'); sg.addColorStop(1, '#2c170b');
    g.fillStyle = sg; g.fill(); g.restore();
    g.fillStyle = 'rgba(255,240,220,0.45)'; g.beginPath(); g.ellipse(-sw * 0.3, sy - sh * 0.08, sw * 0.12, sh * 0.2, -0.15, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-sw * 0.33, sy - sh * 0.15, sw * 0.04, sh * 0.06, -0.15, 0, Math.PI * 2); g.fill();
    seed(b); b.fillStyle = '#e0e0e0'; b.fill();                                                          // 씨는 볼록하게
    g.restore(); b.restore();
  });

  // ── 7. 껍질: 짙은 빨강 테두리와 바깥쪽 얇은 밝은 선 ──
  outline(g); g.lineWidth = u * 0.03; g.strokeStyle = '#8c1820'; g.stroke();
  outline(g); g.lineWidth = u * 0.012; g.strokeStyle = '#b8302f'; g.stroke();
  outline(b); b.lineWidth = u * 0.03; b.strokeStyle = '#b0b0b0'; b.stroke();
  return {color: cv, bump: bv};
}
