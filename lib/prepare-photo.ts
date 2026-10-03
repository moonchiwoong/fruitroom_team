// Keep observation uploads practical on slower farm connections.
// The UI discloses that this creates an optimized copy, not an original archive.
export async function preparePhoto(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024)
    throw new Error('12MB 이하의 JPG·PNG·WebP 사진을 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 브라우저에서는 사진을 처리할 수 없습니다.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('사진 변환에 실패했습니다.')), 'image/jpeg', quality));
    let blob = await encode(.88);
    if (blob.size > 750000) blob = await encode(.7);
    if (blob.size > 900000) throw new Error('사진의 해상도를 줄인 뒤 다시 시도해 주세요.');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-optimized.jpg', {type:'image/jpeg'});
  } catch (error) {
    if (error instanceof Error && error.name !== 'EncodingError') throw error;
    throw new Error('사진 파일을 읽을 수 없습니다. 다른 사진을 선택해 주세요.');
  } finally { URL.revokeObjectURL(url); }
}
