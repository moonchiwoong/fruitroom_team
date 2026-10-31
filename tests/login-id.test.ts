import test from 'node:test';
import assert from 'node:assert/strict';
import {toAuthEmail, validId, displayLogin, isIdAccount, ID_DOMAIN} from '../lib/login-id';

test('아무 아이디나 메일이 가지 않는 주소로 바꾸고 다시 읽을 수 있다', () => {
  for (const id of ['사과농가', 'Apple-Farm 01', '홍길동!', 'ab', '거창사과농장123']) {
    const e = toAuthEmail(id);
    assert.ok(e.endsWith('@' + ID_DOMAIN) && e.split('@')[0].length <= 64, e);
    assert.match(e, /^[a-z0-9]+@/);
    assert.equal(displayLogin(e), id.normalize('NFC').trim().toLowerCase());
  }
  assert.equal(toAuthEmail('Farmer@Naver.com'), 'farmer@naver.com');
  assert.equal(displayLogin('farmer@naver.com'), 'farmer@naver.com');
  assert.ok(isIdAccount(toAuthEmail('사과')));
});
test('아이디 길이 제한', () => {
  assert.ok(validId('사과')); assert.ok(validId('가'.repeat(10))); assert.ok(validId('a'.repeat(30)));
  assert.ok(!validId('가')); assert.ok(!validId('가'.repeat(11))); assert.ok(!validId('a'.repeat(32))); assert.ok(!validId('a@b')); assert.ok(!validId('   '));
});
