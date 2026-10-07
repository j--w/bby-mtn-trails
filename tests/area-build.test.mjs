// Area build tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRouterData } from '../site/js/area-build.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// Small made-up network that exercises every step: a near-miss snap, a dead end closed by a short extra,
// an island joined through a 50 m extra (splitting the segment it lands on), and a far island that is dropped.
// The expected output was first made by the old Python build and still matches it.
test('synthetic network: snaps, closes, joins and drops as expected', () => {
  const { data, report } = buildRouterData(load('fixtures/synthetic-input.json'), { version: 'test' });
  assert.deepEqual(data, load('fixtures/synthetic-expected.json'));
  assert.deepEqual(report.closed.map(a => a.extra), [0]);
  assert.deepEqual(report.autoAdded.map(a => a.extra), [1]);
  assert.deepEqual(report.dropped.names, ['Far loop']);
});

test('output coordinates are rounded to 6 places, elevations to 1', () => {
  const { data } = buildRouterData(load('fixtures/synthetic-input.json'));
  for (const [lat, lon, ele] of data.nodes) {
    assert.equal(lat, Number(lat.toFixed(6))); assert.equal(lon, Number(lon.toFixed(6)));
    if (ele != null) assert.equal(ele, Number(ele.toFixed(1)));
  }
});

test('an island joins through the shortest connector', () => {
  // the island (3-4) can reach the loop at node 1 by a 60 m extra from node 3 or a 35 m extra from node 4
  const seg = (id, path, name) => ({ id, path, name, kind: 'trail', grade: null, gradeDown: null, oneway: 'no' });
  const { report } = buildRouterData({
    nodes: [[49.28, -122.92, 0], [49.28, -122.919, 0], [49.2805, -122.9195, 0], [49.27946, -122.919, 0], [49.28, -122.918518, 0]],
    segs: [seg('m1', [0, 1], 'Loop'), seg('m2', [1, 2], 'Loop'), seg('m3', [2, 0], 'Loop'), seg('i', [3, 4], 'Island')],
    trailheads: [{ node: 0, name: 'Lot' }],
    extras: [{ p: [3, 1], osm: { name: 'Long way' } }, { p: [4, 1], osm: { name: 'Short way' } }],
  });
  assert.deepEqual(report.autoAdded.map(a => a.name), ['Short way']);
  assert.equal(report.dropped.segs, 0);
});
