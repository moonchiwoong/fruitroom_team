/**
 * Appearance settings are intentionally separate from quality prediction.
 * These values have NOT been fitted to photographs, volume or wrinkle measurements.
 * Equal-density isotropic volume loss is an explanatory assumption, not a finding.
 */
export type AppleAppearanceConfig = {
  volumeLossStrength: number;
  wrinkleStrength: number;
  wrinkleHalfSaturationPercent: number;
  maxVisualLossPercent: number;
};
export const APPLE_APPEARANCE_CONFIG: Readonly<AppleAppearanceConfig> = Object.freeze({
  volumeLossStrength: 1,
  wrinkleStrength: 0.028,
  wrinkleHalfSaturationPercent: 3,
  maxVisualLossPercent: 35,
});

export type AppleAppearance = {
  available: boolean;
  lossPercent: number | null;
  visualLossPercent: number | null;
  lengthScale: number;
  wrinkleAmplitude: number;
  visuallyCapped: boolean;
};

export function appleAppearance(lossPercent: number | null, config: AppleAppearanceConfig = APPLE_APPEARANCE_CONFIG): AppleAppearance {
  if (lossPercent === null || !Number.isFinite(lossPercent) || lossPercent < 0) {
    // Neutral geometry is a placeholder, never a statement of zero actual shrinkage.
    return {available: false, lossPercent: null, visualLossPercent: null, lengthScale: 1, wrinkleAmplitude: 0, visuallyCapped: false};
  }
  const visualLossPercent = Math.min(lossPercent, config.maxVisualLossPercent);
  const remainingVolume = Math.max(0.05, 1 - visualLossPercent / 100 * config.volumeLossStrength);
  return {
    available: true,
    lossPercent,
    visualLossPercent,
    lengthScale: Math.cbrt(remainingVolume),
    wrinkleAmplitude: config.wrinkleStrength * visualLossPercent / (visualLossPercent + config.wrinkleHalfSaturationPercent),
    visuallyCapped: lossPercent > config.maxVisualLossPercent,
  };
}

/** Reproducible smooth displacement in normalized, body-centred coordinates. */
export function wrinkleApplePoint(x: number, y: number, z: number, appearance: AppleAppearance): [number, number, number] {
  if (!appearance.available || appearance.wrinkleAmplitude === 0) return [x, y, z];
  const radius = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  // Keep the stem socket and calyx stable; the stem is uniformly scaled with the fruit.
  const sideWeight = Math.min(1, radius * 1.6);
  // 넓고 얕은 굴곡: 짧은 주기의 물결은 텍스처를 뭉개 보이게 해서 낮은 주파수만 씁니다.
  const wave = Math.sin(theta * 9 + y * 3) * Math.sin(y * 7 + Math.sin(theta * 4) * 1.2);
  const depth = appearance.wrinkleAmplitude * sideWeight * (0.55 + 0.45 * wave);
  return [x * (1 - depth), y * (1 - depth * 0.12), z * (1 - depth)];
}

/** Used by both UI/QA: a checksum over the real updated position buffer. */
export function positionChecksum(positions: ArrayLike<number>): number {
  let checksum = 0;
  for (let i = 0; i < positions.length; i++) checksum += positions[i] * ((i % 19) + 1);
  return Number(checksum.toFixed(6));
}
