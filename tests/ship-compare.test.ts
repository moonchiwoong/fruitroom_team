import test from 'node:test';
import assert from 'node:assert/strict';
import {compareShipping} from '../lib/ship-compare';

const base = {nowKg: '1000', nowPrice: '3000', laterKg: '1000', cost: '120000', laterPrice: ''};

test('기준 가격: 전량 판매 3,120원/kg, 980kg이면 약 3,184원/kg', () => {
  const a = compareShipping(base); assert.ok(a.ok); assert.equal(a.breakEven, 3120); assert.equal(a.diff, null);
  const b = compareShipping({...base, laterKg: '980'}); assert.ok(b.ok); assert.equal(b.breakEven, 3184);
});

test('수입 차이: 980kg × 3,300원 → +114,000원, × 3,150원 → −33,000원', () => {
  const a = compareShipping({...base, laterKg: '980', laterPrice: '3300'}); assert.ok(a.ok); assert.equal(a.diff, 114000);
  const b = compareShipping({...base, laterKg: '980', laterPrice: '3150'}); assert.ok(b.ok); assert.equal(b.diff, -33000);
});

test('30일 뒤 물량 0이면 계산하지 않음, 빈 칸은 항목을 알려 줌', () => {
  const z = compareShipping({...base, laterKg: '0'}); assert.equal(z.ok, false); assert.match(z.ok ? '' : z.reason ?? '', /0이면/);
  const e = compareShipping({...base, nowPrice: '', cost: ''}); assert.equal(e.ok, false); assert.deepEqual(e.ok ? [] : e.missing, ['지금 가격', '추가 저장비']);
});

test('나누어떨어지면 올림하지 않고, 쉼표 입력도 읽음', () => {
  const a = compareShipping({...base, nowKg: '1,000', cost: '0'}); assert.ok(a.ok); assert.equal(a.breakEven, 3000);
});

test('제안서 표기: +114,000원 유리 / −33,000원 불리 (원 단위)', () => {
  const up = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '980', cost: '120000', laterPrice: '3300'});
  const down = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '980', cost: '120000', laterPrice: '3150'});
  assert.ok(up.ok && down.ok);
  if (up.ok && down.ok) { assert.equal(Math.round(Math.abs(up.diff!)).toLocaleString('ko-KR') + '원 ' + (up.diff! > 0 ? '유리' : '불리'), '114,000원 유리'); assert.equal(Math.round(Math.abs(down.diff!)).toLocaleString('ko-KR') + '원 ' + (down.diff! > 0 ? '유리' : '불리'), '33,000원 불리'); }
});

test('60일 비교: 식은 같고 안내 문구만 기간을 따른다', () => {
  const r = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '980', cost: '120000', laterPrice: '3300'}, 60);
  assert.ok(r.ok); if (r.ok) { assert.equal(r.breakEven, 3184); assert.equal(r.diff, 114000); }
  const z = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '0', cost: '0', laterPrice: ''}, 60);
  assert.ok(!z.ok && /60일 뒤/.test(z.reason ?? ''));
});

test('요청서 검산: 30일·60일 예시(손익분기 원 단위 올림)', () => {
  const r30 = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '1000', cost: '186000', laterPrice: '3297'}, 30);
  const r60 = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '960', cost: '240000', laterPrice: '3500'}, 60);
  assert.ok(r30.ok && r60.ok);
  if (r30.ok) { assert.equal(r30.breakEven, 3186); assert.equal(r30.diff, 111000); }
  if (r60.ok) { assert.equal(r60.breakEven, 3375); assert.equal(r60.diff, 120000); }
});
