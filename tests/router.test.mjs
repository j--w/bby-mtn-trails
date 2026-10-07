// Route search tests. Run with: npm test   (Node 20+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const core = readFileSync(new URL('../site/js/router-core.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Math, Map, Set, Float64Array, Uint8Array, Infinity, Number, Array, Object });
vm.runInContext(core + '\nthis.api={setGraph,buildGraph,workerGraph,solve,solveLongest};', ctx);
const { setGraph, buildGraph, workerGraph, solve, solveLongest } = ctx.api;

const DATA = JSON.parse(readFileSync(new URL('fixtures/burnaby-legacy.json', import.meta.url), 'utf8'));
const g = buildGraph(DATA);
setGraph(workerGraph(g));
const starts = DATA.th.map(t => g.J(t.node));

// A route is a list of [edgeIndex, dir]; it must be continuous and end where it started.
function assertClosedLoop(steps, start) {
  let cur = start;
  for (const [e, dir] of steps) {
    const ed = g.edges[e];
    assert.equal(dir > 0 ? ed.a : ed.b, cur, 'route jumps between junctions');
    cur = dir > 0 ? ed.b : ed.a;
  }
  assert.equal(cur, start, 'route does not return to its start');
}

test('every trailhead is on the network', () => {
  for (const s of starts) assert.ok(g.adj[s].length > 0);
});

test('target mode hits distance and climb within tolerance', () => {
  const res = solve({ start: starts[0], D: 21000, E: 900, maxg: 2, late: 0, lap: 0, pavedW: 1.5, seed: 4821 });
  assert.ok(res.length >= 1);
  for (const r of res) {
    assertClosedLoop(r.steps, starts[0]);
    assert.ok(Math.abs(r.s.dist - 21000) / 21000 < 0.08, `distance ${r.s.dist}`);
    assert.ok(Math.abs(r.s.gain - 900) / 900 < 0.2, `climb ${r.s.gain}`);
  }
});

test('same seed gives the same route (route codes rely on this)', () => {
  const p = { start: starts[1], D: 15000, E: 600, maxg: 3, late: 0, lap: 0, pavedW: 1.5, seed: 77 };
  const a = solve({ ...p }), b = solve({ ...p });
  assert.deepEqual(a.map(r => r.steps), b.map(r => r.steps));
});

test('lap mode returns to the start between laps', () => {
  const res = solve({ start: starts[0], D: 30000, E: 1200, maxg: 2, late: 0, lap: 10, pavedW: 1.5, seed: 1 });
  assert.ok(res.length >= 1);
  for (const r of res) { assertClosedLoop(r.steps, starts[0]); assert.equal(r.laps, 3); }
});

test('longest-loop mode: valid loops, "No repeats" has none, "Every trail" covers everything', () => {
  const res = solveLongest({ mode: 'longest', start: starts[0], maxg: 2 });
  const byLabel = Object.fromEntries(res.map(r => [r.label, r]));
  for (const r of res) assertClosedLoop(r.steps, starts[0]);
  assert.equal(byLabel['No repeats'].s.rep, 0);
  // every edge allowed at this difficulty and reachable from the start appears in "Every trail"
  const used = new Set(byLabel['Every trail'].steps.map(([e]) => e));
  const ok = e => (g.edges[e].g || 2) <= 2;
  const seen = new Set([starts[0]]), stack = [starts[0]], reach = new Set();
  while (stack.length) { const u = stack.pop(); for (const t of g.adj[u]) { if (!ok(t.e)) continue; reach.add(t.e); if (!seen.has(t.to)) { seen.add(t.to); stack.push(t.to); } } }
  for (const e of reach) assert.ok(used.has(e), `edge ${e} (${g.edges[e].n || 'unnamed'}) not covered`);
});

test('longest-loop mode: "No repeats" finds a long loop from every trailhead', () => {
  // the whole network is ~51 km and the old search found ~35 km; the cycle annealing keeps it there or better
  for (const s of starts) {
    const r = solveLongest({ mode: 'longest', start: s, maxg: 4 }).find(x => x.label === 'No repeats');
    assertClosedLoop(r.steps, s);
    assert.ok(r.s.dist >= 35000, `${(r.s.dist / 1000).toFixed(1)} km from junction ${s}`);
    assert.ok(r.s.rep <= 500, 'at most a short way in and out');
  }
});
