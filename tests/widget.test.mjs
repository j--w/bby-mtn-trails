// Route builder widget: the parts with no DOM (site/widget/v1/model.js), run against a real search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readArea, trailheads, trailheadList, resolveParams, problem, solverParams, toRoute, WidgetError } from '../site/widget/v1/model.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const data = load('fixtures/burnaby-legacy.json');
const pkg = { format: 'trail-area', version: 1, name: 'Test area', bbox: [0, 0, 0, 0], attribution: ['OSM', 'Elevation: test'], edits: {}, data };

// router-core as the widget's worker runs it
const ctx = vm.createContext({ Math, Map, Set, Float64Array, Uint8Array, Infinity, Number, Array, Object });
vm.runInContext(readFileSync(new URL('../site/js/router-core.js', import.meta.url), 'utf8') +
  '\nthis.api={setGraph,buildGraph,workerGraph,solve,solveLongest,routeGeometry,reachableKm};', ctx);
const core = ctx.api;
const graph = core.buildGraph(data);
core.setGraph(core.workerGraph(graph));
const starts = data.th.map(t => graph.J(t.node));
function search(params) {
  const th = trailheadList(pkg), i = th.findIndex(t => t.id === params.start);
  const sp = solverParams(params, starts[i]);
  const res = params.mode === 'longest' ? core.solveLongest(sp) : core.solve(sp);
  return res.map((r, k) => toRoute({ label: r.label || '', desc: r.desc || '', s: r.s, laps: r.laps || 1, geom: core.routeGeometry(r, graph.edges, data.nodes) },
    k, { area: pkg, nodes: data.nodes, params, start: trailheads(pkg)[i] }));
}

test('readArea explains what is wrong with a file', () => {
  assert.equal(readArea(JSON.stringify(pkg)).name, 'Test area');
  const code = f => { try { readArea(f); } catch (e) { assert.ok(e instanceof WidgetError); return e.code; } };
  assert.equal(code('not json'), 'area-unreadable');
  assert.equal(code({ format: 'something else' }), 'area-unreadable');
  assert.equal(code({ ...pkg, data: { ...data, th: [] } }), 'area-not-routable');
});

test('trailheads have position ids and readable names', () => {
  const th = trailheads(pkg);
  assert.equal(th.length, data.th.length);
  for (const t of th) {
    assert.match(t.id, /^-?\d+\.\d{5},-?\d+\.\d{5}$/);
    assert.ok(t.name.length > 0 && !/GPX start/.test(t.name));
    assert.ok(!('node' in t), 'internal node index stays private');
  }
  assert.equal(new Set(th.map(t => t.id)).size, th.length);
});

test('params fill in defaults and fall back to the first trailhead', () => {
  const th = trailheads(pkg);
  const p = resolveParams(th, { distance: 15000, start: 'nowhere', paved: 'sometimes' });
  assert.deepEqual(p, { mode: 'target', distance: 15000, climb: 900, start: th[0].id, paved: 'avoid', lap: 0, seed: 4821 });
  assert.equal(resolveParams(th, { lap: 10000 }, p).distance, 15000, 'later params build on earlier ones');
  assert.equal(problem({ ...p, distance: 1000 }), 'Pick a distance between 3 and 80 km.');
  assert.equal(problem({ ...p, lap: 500 }), 'Laps need to be at least 3 km.');
  assert.equal(problem({ ...p, mode: 'longest', distance: 0 }), null);
  assert.deepEqual(solverParams({ ...p, lap: 10000 }, 7), { start: 7, D: 15000, E: 900, maxg: 4, late: 0, lap: 10, pavedW: 1.5, seed: 4821 });
});

test('a target search gives routes that rebuild from their params', () => {
  const params = resolveParams(trailheads(pkg), { distance: 12000, climb: 400 });
  const routes = search(params);
  assert.ok(routes.length >= 1);
  const r = routes[0];
  assert.equal(r.id, 'A'); assert.equal(r.label, 'Option A');
  assert.ok(Math.abs(r.distance - 12000) < 2500, `${r.distance} m`);
  assert.equal(r.points[0].at, 0);
  assert.ok(Math.abs(r.points.at(-1).at - r.distance) < 1, 'points run the whole route');
  assert.deepEqual([r.points[0].lat, r.points[0].lon], [r.points.at(-1).lat, r.points.at(-1).lon], 'a loop');
  assert.deepEqual(r.start.at, [r.points[0].lat, r.points[0].lon]);
  assert.ok(r.estimatedTime > r.distance / 1000 * 390);
  assert.deepEqual(search(r.params)[0].points, r.points, 'same params, same route');
  const gpx = r.gpx();
  assert.match(gpx, /<name>Test area 1\d\.\dk \d+m A<\/name>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, r.points.length);
  assert.ok(!Object.keys(r).includes('gpx'), 'gpx() stays off the JSON');
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('laps come back through the start', () => {
  const routes = search(resolveParams(trailheads(pkg), { distance: 20000, climb: 600, lap: 10000 }));
  const r = routes[0];
  assert.equal(r.laps, 2);
  const turn = r.points[r.points.findIndex(p => p.lap === 1) - 1];   // end of the first lap
  assert.deepEqual([turn.lat, turn.lon], r.start.at);
});

test('longest mode names its options', () => {
  const routes = search(resolveParams(trailheads(pkg), { mode: 'longest' }));
  assert.deepEqual([...routes.map(r => r.id)].sort(), ['every-trail', 'no-repeats', 'skip-dead-ends']);
  assert.ok(routes.every(r => r.description.length > 0));
});
