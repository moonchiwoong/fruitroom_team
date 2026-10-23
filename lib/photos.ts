/**
 * 화면에 쓰는 사진 목록입니다.
 * 사진을 바꾸려면 public/assets/photos 폴더의 파일을 같은 이름으로 덮어쓰거나, 아래 경로만 바꾸면 됩니다.
 * (가로세로 비율: hero 약 16:10, 사과 사진 4:3 권장 · WebP·JPG·PNG 모두 가능)
 */
export const PHOTOS = {
  /** 홈 첫 화면 큰 사진 (나무 상자에 담긴 사과) */
  hero: '/assets/photos/hero.webp',
  /** 저장고 사진 (물량 관리 화면 머리 등) */
  storage: '/assets/photos/storage.webp',
  /** 사과(물량) 목록의 작은 사진. 물량마다 순서대로 돌아가며 씁니다. */
  apples: ['/assets/photos/apple-1.webp', '/assets/photos/apple-2.webp', '/assets/photos/apple-3.webp'],
} as const;

/** 같은 물량에는 늘 같은 사진이 나오도록 id로 고릅니다. */
export function applePhoto(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PHOTOS.apples[h % PHOTOS.apples.length];
}
