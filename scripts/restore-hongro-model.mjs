import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Reassemble the checked-in model and verify its integrity before use.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chunks = await Promise.all([1, 2, 3, 4].map(n =>
  readFile(resolve(root, `scripts/model-data/hongro-0${n}.b64`), 'utf8')));
const encoded = chunks.join('').replace(/\s/g, '');
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
  throw new Error('홍로 모델 조각의 base64 형식이 올바르지 않습니다.');
}
const bytes = Buffer.from(encoded, 'base64');
const hash = createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== 1168632 || hash !== '16bb1af6d1c4e98dc6281e3289a467ceecf8112cee076ac2c88b6227faee13eb' ||
    bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
  throw new Error('홍로 모델의 길이, 해시 또는 GLB 헤더가 원본과 다릅니다.');
}
const destination = resolve(root, 'public/models/hongro-web.glb');
await mkdir(dirname(destination), {recursive: true});
await writeFile(destination, bytes);
console.log('홍로 3D 모델 복원 및 SHA-256 검증 완료');
