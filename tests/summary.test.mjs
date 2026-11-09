import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const L = createRequire(import.meta.url)('../logic.cjs');

test('weighted mean of measured windows, not missing-as-zero', () => {
  const samples = [
    { from: 0, time: 120000, value: 5 },
    { from: 120000, time: 240000, value: 15 },
    { from: 480000, time: 600000, value: 30 },
  ];
  const s = L.summarize(samples, 0, 600000);
  assert.equal(s.latest, 30);
  assert.equal(s.average, (5 + 15 + 30) / 3);
  assert.equal(s.max, 30);
  assert.equal(s.sampleCount, 3);
  assert.equal(s.observedSeconds, 360);
  assert.equal(s.coverageRatio, 0.6);
});
test('clamps intervals to query boundaries and prevents overlap overcount', () => {
  const samples = [
    { from: 0, time: 120000, value: 10 },
    { from: 60000, time: 180000, value: 20 },
    { from: 180000, time: 300000, value: 40 },
  ];
  const s = L.summarize(samples, 60000, 180000);
  assert.equal(s.observedSeconds, 120);
  assert.equal(s.coverageRatio, 1);
  assert.equal(s.average, 15);
});
test('missing observations are null, never 0%', () => {
  const s = L.summarize([], 0, 86400000);
  assert.equal(s.latest, null);
  assert.equal(s.max, null);
  assert.equal(s.average, null);
  assert.equal(s.observedSeconds, 0);
  assert.equal(s.coverageRatio, 0);
});
test('0% is a valid observation', () => {
  assert.equal(L.summarize([{ from: 0, time: 120000, value: 0 }], 0, 120000).latest, 0);
});
