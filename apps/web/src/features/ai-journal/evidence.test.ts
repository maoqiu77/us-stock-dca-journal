import assert from 'node:assert/strict';
import test from 'node:test';
import {indicatorObservationTime} from './evidence.ts';

test('indicator cutoff uses the final bar time recorded in old calculation payloads', () => {
  const oldSource = {as_of: '2026-10-01T05:57:54Z', payload: {ma5: '18', as_of: '2026-09-30T05:57:54Z'}};
  assert.equal(indicatorObservationTime(oldSource.payload), '2026-09-30T05:57:54Z');
  assert.equal(oldSource.as_of, '2026-10-01T05:57:54Z');
});

test('missing or invalid cutoff stays unknown rather than displaying retrieval time', () => {
  for (const payload of [{}, {as_of: null}, {as_of: 123}, {as_of: ''}, {as_of: 'invalid'}]) {
    assert.equal(indicatorObservationTime(payload), null);
  }
});
