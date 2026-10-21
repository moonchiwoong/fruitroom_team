// 사과 껍질 텍스처를 그리는 코드 (브라우저용).
// 페이지 로딩이 느려지지 않도록 사이트에서는 실행하지 않습니다. paintSkin(mulberry32(11))의 결과
// 캔버스 세 장(color·bump·rough)을 WebP로 저장한 것이 public/assets/apple-real-*.webp 입니다.
// 무늬를 바꾸려면 이 함수를 고친 뒤 브라우저에서 실행해 canvas.toDataURL('image/webp', 0.9)로 다시 저장하세요.
// ─────────────────────────── 껍질 그리기 ───────────────────────────
export function paintSkin(rand: () => number) {
  const W = 1024, H = 512;          // 계산 해상도
  const OW = 2048, OH = 1024;       // 최종 해상도 (과점은 여기서 선명하게 그림)
  const noise = makeNoise(rand);
  const img = new ImageData(W, H), bimg = new ImageData(W, H), rimg = new ImageData(W, H);
  const red1 = [176, 28, 30], red2 = [120, 12, 22], orange = [214, 92, 40], yellow = [226, 186, 84], green = [186, 178, 70], russet = [122, 96, 52];
  const sun = rand() * Math.PI * 2;
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;                                         // 0 = 꼭지(위), 1 = 꽃받침(아래)
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W, th = u * Math.PI * 2, cx = Math.cos(th), sy = Math.sin(th);
      const sunSide = 0.5 + 0.5 * Math.cos(th - sun);
      const big = noise.fbm(cx * 1.4, sy * 1.4, v * 1.6, 3);
      const warp = (noise.fbm(cx * 2 + 7, sy * 2, v * 1.6, 2) - 0.5) * 0.16;   // 줄무늬를 불규칙하게 휘게
      const wc = Math.cos(th + warp), ws = Math.sin(th + warp);
      const mottle = noise.fbm(cx * 7, sy * 7, v * 5, 3);              // 얼룩
      const streak = noise.fbm(wc * 40, ws * 40, v * 2.8, 4) * 0.78 + mottle * 0.22;  // 끊기고 굵기가 다른 세로 줄무늬
      const fine = noise.fbm(cx * 90, sy * 90, v * 45, 2);
      const poleFade = smooth(0.03, 0.2, v) * (1 - smooth(0.8, 0.97, v));
      let cover = (0.54 + 0.48 * sunSide + (big - 0.5) * 0.8) * (0.45 + 0.55 * poleFade);
      cover = clamp(cover + (streak - 0.5) * 0.5, 0, 1);
      const redness = smooth(0.18, 0.72, cover);
      const ground = mix(yellow, green, clamp(0.55 - sunSide * 0.5 + (big - 0.5), 0, 1));
      let red = mix(red1, red2, clamp((streak - 0.35) * 1.8 + sunSide * 0.35, 0, 1));
      red = mix(orange, red, smooth(0.15, 0.55, cover));
      let col = mix(mix(ground, orange, smooth(0.05, 0.4, redness)), red, smooth(0.3, 1, redness));
      const rus = (1 - smooth(0.0, 0.1, v)) * (0.6 + 0.4 * noise.fbm(cx * 30, sy * 30, v * 60, 2));  // 꼭지 주변 녹
      col = mix(col, russet, clamp(rus, 0, 0.85));
      const shade = 1 + (fine - 0.5) * 0.16;
      const i = (py * W + px) * 4;
      img.data[i] = clamp(col[0] * shade, 0, 255); img.data[i + 1] = clamp(col[1] * shade, 0, 255); img.data[i + 2] = clamp(col[2] * shade, 0, 255); img.data[i + 3] = 255;
      const b = 128 + (fine - 0.5) * 50 + (rus * 30); bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = b; bimg.data[i + 3] = 255;
      const r = 120 + (fine - 0.5) * 40 + rus * 110 + (1 - redness) * 15; rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = clamp(r, 0, 255); rimg.data[i + 3] = 255;
    }
  }
  const up = (src: ImageData) => {
    const small = document.createElement('canvas'); small.width = W; small.height = H; small.getContext('2d')!.putImageData(src, 0, 0);
    const big = document.createElement('canvas'); big.width = OW; big.height = OH; const g = big.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(small, 0, 0, OW, OH); return big;
  };
  const color = up(img), bump = up(bimg), rough = up(rimg);
  // 과점(껍질의 작은 점): 위쪽에 더 많고 크며, 극 근처는 가로로 늘어나는 것을 보정
  const cg = color.getContext('2d')!, bg = bump.getContext('2d')!, rg = rough.getContext('2d')!;
  for (let n = 0; n < 3600; n++) {
    const v = Math.acos(1 - 2 * rand()) / Math.PI;                      // 구 표면에 고르게
    if (v < 0.05 || v > 0.95 || rand() > 1.15 - v * 0.6) continue;
    const x = rand() * OW, y = v * OH, stretch = 1 / Math.max(0.15, Math.sin(Math.PI * v));
    const s = (0.55 + rand() * 1.1) * (1.25 - v * 0.6), rx = s * stretch, ry = s * (0.8 + rand() * 0.5);
    cg.fillStyle = `rgba(246,${214 + rand() * 25 | 0},${150 + rand() * 40 | 0},${0.25 + rand() * 0.35})`;
    ellipse(cg, x, y, rx, ry); ellipse(cg, x - OW, y, rx, ry); ellipse(cg, x + OW, y, rx, ry);
    bg.fillStyle = 'rgba(255,255,255,0.75)'; ellipse(bg, x, y, rx, ry);
    rg.fillStyle = 'rgba(230,230,230,0.8)'; ellipse(rg, x, y, rx, ry);
  }
  return {color, bump, rough};
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** 3D 값 노이즈 (경도 방향으로 이음매 없이 쓰기 위해 원통 좌표로 샘플링) */
function makeNoise(rand: () => number) {
  const P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rand(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x: number, y: number, z: number) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
  const f = (t: number) => t * t * (3 - 2 * t);
  const n3 = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
             l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
  };
  return {fbm(x: number, y: number, z: number, oct: number) { let s = 0, a = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += a * n3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s / n; }};
}
