import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fields, validate, displayValue, apiURL } from '../../frontend/public/park-ops/ops-data-model.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
test('user supplied figures control the eight headline cards', () => {
  const d = validate(defaults);
  assert.deepEqual(fields.slice(0, 8).map(([key]) => d.metrics[key]), [660, 68, 26, 171, 14.43, 19.4, 26, 85]);
  assert.equal(displayValue(d, 'builtCountedFloor'), '19.40');
  assert.equal(displayValue(d, 'occupancy'), '约 85');
});
test('unknown is not zero', () => {
  const d = clone(defaults); d.metrics.people = null; assert.equal(displayValue(d, 'people'), '—');
  d.metrics.people = 0; assert.equal(displayValue(validate(d), 'people'), '0');
});
test('latest amendment overrides financial figures and restores original placeholders', () => {
  const d = validate(defaults);
  assert.equal(d.metrics.annualOutput, 3.68); assert.equal(d.metrics.annualTax, 2260);
  assert.equal(displayValue(d, 'annualTax'), '2260');
  assert.deepEqual(['people', 'visitors', 'vehicles', 'vehiclePasses', 'camerasOnline', 'camerasOffline', 'cameraRate', 'safetyAlerts', 'fireRate', 'inspections', 'hazards'].map(key => d.metrics[key]), [486,18,127,312,86,2,97.7,0,99.2,26,2]);
  assert.equal(d.placeholderKeys.includes('annualOutput'), false);
  assert.equal(d.placeholderKeys.includes('annualTax'), false);
  assert.equal(d.placeholderKeys.includes('people'), true);
  assert.equal(fields.some(([key]) => d.metrics[key] === null), false);
});
test('reject invalid, negative, infinite, string, absent and over-100 rates', () => {
  for (const value of [-1, Infinity, NaN, '32', undefined]) { const d = clone(defaults); d.metrics.people = value; assert.throws(() => validate(d)); }
  const d = clone(defaults); d.metrics.occupancy = 101; assert.throws(() => validate(d));
  d.metrics.occupancy = 85; d.metrics.people = 1.4; assert.throws(() => validate(d));
});
test('cloned output drops layout and unknown keys without mutating input', () => {
  const d = clone(defaults); d.phases = [{ points: [] }]; const out = validate(d);
  assert.equal(out.phases, undefined); out.content.companies[0] = 'changed'; assert.notEqual(d.content.companies[0], 'changed');
});
test('future API is read-only business scope on same origin only', () => {
  const origin = 'http://127.0.0.1:5200';
  assert.equal(apiURL('/api/park-ops/metrics', origin), `${origin}/api/park-ops/metrics`);
  for (const value of ['https://example.com/api/x', '//evil.test/api/x', '/api/../admin', '/api/system-branding/park-ops', '/api/auth', '/api/a?token=x', '/api/a#x', '/api/\\evil']) assert.throws(() => apiURL(value, origin));
});
