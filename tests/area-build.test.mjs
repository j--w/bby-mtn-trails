// Area build tests: the JS port must give the same routing data as scripts/build_router_data.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRouterData, inputFromEditor, pyRound } from '../site/js/area-build.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const strip = d => { const { version, ...rest } = d; return rest; };

test('Burnaby Mountain: same output as the committed site data', () => {
  const { data, report } = buildRouterData(inputFromEditor(load('../data/burnaby-mountain/curated.json'), load('../site/data/burnaby-mountain-editor.json')));
  assert.deepEqual(strip(data), strip(load('../site/data/burnaby-mountain.json')));
  assert.equal(report.snapped.length, 3);
  assert.equal(report.closed.length, 4);
});

// Small made-up network that exercises every step: a near-miss snap, a dead end closed by a short extra,
// an island joined through a 50 m extra (splitting the segment it lands on), and a far island that is dropped.
// Expected output made with:
//   python3 scripts/build_router_data.py --editor tests/fixtures/synthetic-editor.json \
//     --curated tests/fixtures/synthetic-curated.json --out tests/fixtures/synthetic-expected.json --version test
test('synthetic network: same output as the Python build', () => {
  const { data, report } = buildRouterData(inputFromEditor(load('fixtures/synthetic-curated.json'), load('fixtures/synthetic-editor.json')), { version: 'test' });
  assert.deepEqual(data, load('fixtures/synthetic-expected.json'));
  assert.deepEqual(report.autoAdded.map(a => a.extra), [1]);
  assert.deepEqual(report.dropped.names, ['Far loop']);
});

test('pyRound matches Python round() on ties', () => {
  assert.equal(pyRound(0.125, 2), 0.12);   // exact binary tie: half to even
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.675, 2), 2.67);   // 2.675 is really 2.67499999...
  assert.equal(pyRound(-1.25, 1), -1.2);
  assert.equal(pyRound(123.0, 1), 123);
});
