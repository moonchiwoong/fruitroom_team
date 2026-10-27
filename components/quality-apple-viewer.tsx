'use client';

import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Minus, Plus, RotateCcw, Rotate3D, AlertTriangle} from 'lucide-react';
import {APPLE_APPEARANCE_CONFIG, appleAppearance, positionChecksum, wrinkleApplePoint, type AppleAppearance} from '@/lib/apple-appearance';
import styles from './quality-apple-viewer.module.css';

export type AppearanceMetric = {
  ok: boolean;
  value: number | null;
  unit: string;
  kind?: string;
  source?: readonly string[];
  reason?: string | null;
  modelVersion?: string | null;
  validation?: string;
  warnings?: readonly string[];
};

export type QualityAppleViewerProps = {
  day: number;
  cultivar: string;
  metrics: Record<'firmness' | 'brix' | 'acidity' | 'loss', AppearanceMetric>;
  /** Allows deployments/tests to choose another actual model or exercise load failure. */
  modelUrl?: string;
};

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
function modelBytes(url: string): Promise<ArrayBuffer> {
  const cached = bytesCache.get(url);
  if (cached) return cached;
  const pending = fetch(url, {cache: 'force-cache'}).then(response => {
    if (!response.ok) throw new Error(`모델 파일 응답 ${response.status}`);
    return response.arrayBuffer();
  }).catch(error => {bytesCache.delete(url); throw error;});
  bytesCache.set(url, pending);
  if (bytesCache.size > 4) bytesCache.delete(bytesCache.keys().next().value!);
  return pending;
}

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const property of Object.values(material)) if (property instanceof THREE.Texture) textures.add(property);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => {
    const image = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  });
}

type MutableBody = {geometry: THREE.BufferGeometry; original: Float32Array; centre: THREE.Vector3; radius: number};
type ViewerApi = {controls: OrbitControls; camera: THREE.PerspectiveCamera; group: THREE.Group; bodies: MutableBody[]; update: (appearance: AppleAppearance) => void};

/** The downloaded GLB is immutable; this viewer owns its parsed GPU resources. */
export default function QualityAppleViewer({day, cultivar, metrics, modelUrl = '/models/apple-web.glb'}: QualityAppleViewerProps) {
  const mount = useRef<HTMLDivElement>(null), api = useRef<ViewerApi | null>(null);
  const loss = metrics.loss.ok && metrics.loss.value !== null ? metrics.loss.value : null;
  const appearance = appleAppearance(loss), appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState(''), [retry, setRetry] = useState(0);
  const isHongro = /홍로|hongro/i.test(cultivar), isReference = metrics.loss.kind === '참고 추정';

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false, frame = 0;
    let renderer: THREE.WebGLRenderer;
    setLoadState('loading'); setErrorText('');
    try {
      renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
    } catch {
      setLoadState('error'); setErrorText('이 기기에서 WebGL 3D를 시작하지 못했습니다. WebGL을 지원하는 브라우저에서 다시 시도해 주세요.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);
    camera.position.set(0, 0.28, 4.7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 2.2; controls.maxDistance = 8; controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI - 0.05;
    controls.saveState();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4d5b42, 2.3));
    const key = new THREE.DirectionalLight(0xfff5e8, 3); key.position.set(-3, 4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.1); fill.position.set(3, 1, -2); scene.add(fill);
    const group = new THREE.Group(); scene.add(group);
    const bodies: MutableBody[] = [];
    const update = (current: AppleAppearance) => {
      group.scale.setScalar(current.lengthScale);
      let checksum = 0, vertexCount = 0;
      for (const body of bodies) {
        const position = body.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < position.count; i++) {
          const x = (body.original[i * 3] - body.centre.x) / body.radius;
          const y = (body.original[i * 3 + 1] - body.centre.y) / body.radius;
          const z = (body.original[i * 3 + 2] - body.centre.z) / body.radius;
          const changed = wrinkleApplePoint(x, y, z, current);
          position.setXYZ(i, changed[0] * body.radius + body.centre.x, changed[1] * body.radius + body.centre.y, changed[2] * body.radius + body.centre.z);
        }
        position.needsUpdate = true;
        body.geometry.computeVertexNormals(); body.geometry.computeBoundingSphere();
        checksum += positionChecksum(position.array); vertexCount += position.count;
      }
      // Values reflect the actual geometry buffer after deformation, not just a slider.
      host.dataset.meshChecksum = checksum.toFixed(6);
      host.dataset.meshVertices = String(vertexCount);
      host.dataset.meshScale = String(group.scale.x);
      host.dataset.appearanceAvailable = String(current.available);
    };
    api.current = {controls, camera, group, bodies, update};
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    const render = () => {
      if (disposed) return;
      frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera);
    };
    render();
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) {setLoadState('error'); setErrorText('3D 그래픽 연결이 중단되었습니다. 다시 불러오기를 눌러 주세요.');}
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    (async () => {
      const bytes = await modelBytes(modelUrl);
      if (disposed) return;
      const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', new URL(modelUrl, window.location.href)).href);
      if (disposed) {disposeScene(gltf.scene); return;}
      const original = gltf.scene;
      original.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(original), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.length()) || size.length() === 0) {disposeScene(original); throw new Error('빈 3D 모델입니다.');}
      const scale = 2 / Math.max(size.x, size.y, size.z);
      const normalize = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      const originals = new Set<THREE.BufferGeometry>();
      const meshCandidates: THREE.Mesh[] = [];
      original.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.geometry.getAttribute('position')) return;
        originals.add(object.geometry);
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld); geometry.applyMatrix4(normalize); geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(geometry, object.material); mesh.name = object.name;
        meshCandidates.push(mesh); group.add(mesh);
      });
      originals.forEach(geometry => geometry.dispose());
      if (!meshCandidates.length) {disposeScene(original); throw new Error('표시할 메시가 없습니다.');}
      const namedBodies = meshCandidates.filter(mesh => /apple.*body|fruit.*body/i.test(mesh.name));
      const selected = namedBodies.length ? namedBodies : [meshCandidates.reduce((a, b) => a.geometry.getAttribute('position').count >= b.geometry.getAttribute('position').count ? a : b)];
      for (const mesh of selected) {
        const geometry = mesh.geometry, position = geometry.getAttribute('position');
        const centre = geometry.boundingBox!.getCenter(new THREE.Vector3()), size = geometry.boundingBox!.getSize(new THREE.Vector3());
        const values = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {values[i * 3] = position.getX(i); values[i * 3 + 1] = position.getY(i); values[i * 3 + 2] = position.getZ(i);}
        bodies.push({geometry, original: values, centre, radius: Math.max(size.x, size.y, size.z) / 2});
      }
      update(appearanceRef.current);
      setLoadState('ready');
    })().catch(error => {
      if (!disposed) {setLoadState('error'); setErrorText(`사과 3D 모델을 불러오지 못했습니다. ${error instanceof Error ? error.message : '네트워크 또는 파일을 확인해 주세요.'}`);}
    });
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeScene(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      api.current = null;
    };
  }, [modelUrl, retry]);

  useEffect(() => {api.current?.update(appearanceRef.current);}, [loss]);

  const zoom = (factor: number) => {
    const current = api.current; if (!current) return;
    const direction = current.camera.position.clone().sub(current.controls.target);
    direction.setLength(THREE.MathUtils.clamp(direction.length() * factor, current.controls.minDistance, current.controls.maxDistance));
    current.camera.position.copy(current.controls.target).add(direction); current.controls.update();
  };
  const reset = () => {const current = api.current; if (current) {current.group.rotation.set(0, 0, 0); current.controls.reset();}};
  const metricInfo = {firmness: ['경도', 1], brix: ['당도', 1], acidity: ['산도', 3], loss: ['감모율', 3]} as const;
  return <section className={styles.viewer} data-testid="quality-apple-viewer" data-day={day} data-load-state={loadState}>
    <div className={styles.heading}><span>설명용 외관 시각화</span><b>저장 {Number.isFinite(day) ? day : '—'}일차</b></div>
    <p className={styles.modelNote}>공통 설명용 사과 모델 · {isHongro ? '홍로' : '후지'}의 실측 외형이 아닙니다. 정밀 스캔이 아니며 실제 크기는 확인되지 않았습니다.</p>
    <div className={styles.stage}>
      <div className={styles.canvas} ref={mount} role="img" aria-label="품질 계산과 연결된 사과 3D 모델. 드래그로 회전, 확대·축소 버튼으로 크기를 조절합니다." tabIndex={0}
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            if (event.key === '+' || event.key === '=') zoom(0.85);
            else if (event.key === '-') zoom(1.15);
            else if (api.current) {
              const r = api.current.group.rotation;
              if (event.key === 'ArrowLeft') r.y -= 0.2;
              if (event.key === 'ArrowRight') r.y += 0.2;
              if (event.key === 'ArrowUp') r.x -= 0.2;
              if (event.key === 'ArrowDown') r.x += 0.2;
            }
          }
        }} />
      {loadState === 'loading' && <p className={styles.overlay} role="status">사과 3D 모델을 불러오는 중입니다…</p>}
      {loadState === 'error' && <div className={styles.overlay} role="alert"><AlertTriangle size={22}/><p>{errorText}</p><button type="button" onClick={() => {bytesCache.delete(modelUrl); setRetry(value => value + 1);}}>3D 모델 다시 불러오기</button><small>아래 품질 계산값은 계속 확인할 수 있습니다.</small></div>}
    </div>
    <div className={styles.tools}>
      <small><Rotate3D size={15}/> 드래그로 회전 · 두 손가락으로 확대</small>
      <div><button type="button" disabled={loadState !== 'ready'} onClick={() => zoom(1.15)} aria-label="3D 사과 축소"><Minus size={17}/></button><button type="button" disabled={loadState !== 'ready'} onClick={() => zoom(0.85)} aria-label="3D 사과 확대"><Plus size={17}/></button><button type="button" disabled={loadState !== 'ready'} onClick={reset}><RotateCcw size={16}/>시점 초기화</button></div>
    </div>
    <dl className={styles.metrics}>{(Object.keys(metricInfo) as Array<keyof typeof metricInfo>).map(key => {
      const metric = metrics[key], [label, digits] = metricInfo[key];
      return <div key={key}><dt>{label}</dt><dd>{metric.ok && metric.value !== null ? <>{metric.value.toLocaleString('ko-KR', {minimumFractionDigits: digits, maximumFractionDigits: digits})}<small> {metric.unit}</small></> : '계산 없음'}</dd><small>{metric.ok ? metric.kind ?? '모델 계산' : metric.reason ?? '자료 부족'}</small></div>;
    })}</dl>
    {!appearance.available ? <p className={styles.notice} data-testid="appearance-unavailable">감모율 자료가 없어 외관 변형을 계산하지 않았습니다. 표시된 기본 형태는 수축·주름이 없다는 뜻이 아닙니다.{metrics.loss.reason && <small>{metrics.loss.reason}</small>}</p> : <p className={styles.notice}>{isReference ? <strong>홍로에 대해 검증되지 않은 후지 기반 참고 추정</strong> : <strong>{metrics.loss.kind ?? '모델 계산'} 감모율로 표현한 외관 예시</strong>}감모율 {loss!.toFixed(3)}%를 사용했습니다. {isReference && '0~120일 표시 제한은 홍로에 대한 타당성을 검증하지 않습니다.'}{appearance.visuallyCapped && ` 외관 효과만 ${APPLE_APPEARANCE_CONFIG.maxVisualLossPercent}%에서 제한하며 계산값은 바꾸지 않습니다.`}</p>}
    {metrics.loss.source && metrics.loss.source.length > 0 && <p className={styles.source}>감모율 출처: {metrics.loss.source.join(' · ')}{metrics.loss.modelVersion && ` · ${metrics.loss.modelVersion}`}<br/>{metrics.loss.validation}</p>}
    {metrics.loss.warnings?.map(warning => <p key={warning} className={styles.source}>{warning}</p>)}
    <details className={styles.explanation}><summary>외관 연결 방식과 한계</summary><p>감모율을 길이 감소율로 그대로 적용하지 않습니다. 일정 밀도·등방 수축을 가정해 길이 배율 = (1 − 감모율/100 × 수축 강도)의 세제곱근으로 나타내고, 표면 메시 좌표에 연속적인 주름 변형을 더합니다. 이 가정과 주름 강도는 실제 외관 자료로 보정되지 않은 설명용 설정입니다.</p><p>경도·당도·산도는 위 수치로 표시하며 형태 변형·껍질 색·부패를 결정하지 않습니다. 실측 사진이나 상품성·안전 보관 기간을 예측하는 모델이 아닙니다.</p><p>설정: 수축 강도 {APPLE_APPEARANCE_CONFIG.volumeLossStrength}, 주름 강도 {APPLE_APPEARANCE_CONFIG.wrinkleStrength}. 원본 GLB에는 품질 변화용 morph target이 없어 웹에서 본체 메시를 직접 변형합니다.</p></details>
  </section>;
}
