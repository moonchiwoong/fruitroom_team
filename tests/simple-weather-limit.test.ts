import test from 'node:test';
import assert from 'node:assert/strict';
import simpleWeatherLimit, {config} from '../netlify/edge-functions/simple-weather-limit';

test('weather rate limit targets only the simple forecast endpoint and passes allowed requests through',()=>{
  assert.equal(config.path,'/api/weather/simple');
  assert.equal(config.rateLimit.action,'rate_limit');
  assert.equal(config.rateLimit.windowLimit,3);
  assert.equal(config.rateLimit.windowSize,60);
  assert.deepEqual(config.rateLimit.aggregateBy,['ip','domain']);
  assert.equal(simpleWeatherLimit(),undefined);
});
