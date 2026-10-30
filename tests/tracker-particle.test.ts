import test from 'node:test';
import assert from 'node:assert/strict';
import {subjectParticle, computeSeries} from '../lib/tracker';

test('주격 조사는 받침에 따라 이/가를 고른다', () => {
  assert.equal(subjectParticle('초기 경도'), '가');
  assert.equal(subjectParticle('초기 당도'), '가');
  assert.equal(subjectParticle('추적 표본 초기 중량'), '이');
  assert.equal(subjectParticle('감모율'), '이');
  assert.equal(subjectParticle('pH'), '이(가)');
});

test('초기값이 없을 때 안내 문구 맞춤법', () => {
  const s = computeSeries({variety: '후지', metric: 'firmness', anchor: null, recorded: 'cold', future: 'cold', asOfDay: 10});
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.reason, '초기 경도가 없습니다.');
});
