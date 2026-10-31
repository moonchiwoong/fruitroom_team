import test from 'node:test';
import assert from 'node:assert/strict';
import {toAuthEmail, validId, displayLogin, isIdAccount, ID_DOMAIN} from '../lib/login-id';

test('아이디는 메일이 가지 않는 주소로, 예전 이메일은 그대로', () => {
  assert.equal(toAuthEmail(' Apple_Farm01 '), `apple_farm01@${ID_DOMAIN}`);
  assert.equal(toAuthEmail('Farmer@Naver.com'), 'farmer@naver.com');
  assert.ok(ID_DOMAIN.endsWith('.invalid'));
});
test('아이디 규칙', () => {
  for (const ok of ['abcd', 'apple_farm01', 'a1234567890123456789']) assert.ok(validId(ok), ok);
  for (const bad of ['abc', '_abcd', 'Abcd', '사과농가', 'a b c d', 'a12345678901234567890', 'ab-cd']) assert.ok(!validId(bad), bad);
});
test('화면 표시', () => {
  assert.equal(displayLogin(`apple01@${ID_DOMAIN}`), 'apple01');
  assert.equal(displayLogin('farmer@naver.com'), 'farmer@naver.com');
  assert.ok(isIdAccount(`x1234@${ID_DOMAIN.toUpperCase()}`));
});
