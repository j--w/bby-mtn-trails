// Area package tests: compiling edits into a routing graph, connector suggestions, save/load. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOsm } from '../site/js/osm.js';
import { compileArea, suggestConnectors, makePackage, readPackage, emptyEdits, keyOf } from '../site/js/area-package.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// Burnaby's raw OSM exports cut to the network's box (no node ids in these exports: keys are i<index>)
const site = load('../site/data/burnaby-mountain.json');
const lats = site.nodes.map(n => n[0]), lons = site.nodes.map(n => n[1]);
const [S, W, Nn, E] = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
const raw = parseOsm({ elements: [...load('../data/burnaby-mountain/raw/osm-trails.json').elements, ...load('../data/burnaby-mountain/raw/osm-roads.json').elements]
  .filter(el => el.geometry.some(g => g.lat >= S && g.lat <= Nn && g.lon >= W && g.lon <= E)) });
const km = c => c.pieces.filter(p => p.state === 'in' || p.state === 'auto').reduce((s, p) => s + p.len, 0) / 1000;

test('with no trailhead the preview uses the biggest network but saves no trailhead', () => {
  const c = compileArea(raw);
  assert.equal(c.provisional, true);
  assert.deepEqual(c.data.th, []);
  assert.ok(km(c) > 30, `${km(c)} km`);
  assert.ok(c.pieces.some(p => p.state === 'cut'), 'disconnected trails are marked');
});

test('trailheads, overrides, splits and joins change the network', () => {
  const base = compileArea(raw);
  const inPiece = base.pieces.find(p => p.state === 'in' && p.path.length > 4 && p.len > 200);
  const mid = inPiece.path[2];
  const edits = { ...emptyEdits(), trailheads: [{ node: keyOf(raw, mid), name: 'Lot' }] };
  const withTh = compileArea(raw, edits);
  assert.equal(withTh.provisional, false);
  assert.equal(withTh.data.th[0].name, 'Lot');
  // the trailhead sits mid-piece: the build makes it a junction
  const ends = new Set(withTh.data.segs.flatMap(s => [s.p[0], s.p[s.p.length - 1]]));
  assert.ok(ends.has(withTh.data.th[0].node));

  // leave a piece out
  const off = compileArea(raw, { ...edits, pieces: { [inPiece.id]: false } });
  assert.equal(off.pieces.find(p => p.id === inPiece.id).state, 'off');

  // split: the first part keeps the id, the second part is new
  const split = compileArea(raw, { ...edits, splits: [keyOf(raw, inPiece.path[1])] });
  const parts = split.pieces.filter(p => p.way === inPiece.way && p.path.includes(inPiece.path[1]));
  assert.ok(parts.some(p => p.id === inPiece.id && p.path.length === 2));

  // join two nodes with a straight connector
  const a = inPiece.path[0], b = inPiece.path[inPiece.path.length - 1];
  const joined = compileArea(raw, { ...edits, joins: [[keyOf(raw, a), keyOf(raw, b)]] });
  assert.equal(joined.joins.length, 1);
  assert.equal(joined.data.segs.length, withTh.data.segs.length + 1);
});

test('accepting connector suggestions grows the routable network', () => {
  const edits = emptyEdits();
  const c = compileArea(raw, edits);
  const sugg = suggestConnectors(raw, c, edits);
  assert.ok(sugg.length > 0);
  const island = sugg.find(s => s.kind === 'island');
  assert.ok(island && island.m <= 400 && island.joins >= 100);
  for (const s of sugg) assert.ok(s.pieces.every(id => c.pieces.find(p => p.id === id).state === 'off'));
  // accept every island suggestion
  for (const s of sugg.filter(s => s.kind === 'island')) for (const id of s.pieces) edits.pieces[id] = true;
  const after = compileArea(raw, edits);
  assert.ok(km(after) > km(c) + 1, `${km(c).toFixed(1)} -> ${km(after).toFixed(1)} km`);
  // dismissed suggestions don't come back
  const left = suggestConnectors(raw, after, { ...edits, dismissed: sugg.map(s => s.id) });
  assert.ok(left.every(s => !sugg.some(o => o.id === s.id)));
});

test('packages round-trip and are checked on load', () => {
  const edits = { ...emptyEdits(), trailheads: [{ node: keyOf(raw, compileArea(raw).data ? compileArea(raw).pieces.find(p => p.state === 'in').path[0] : 0), name: 'Top' }] };
  const c = compileArea(raw, edits);
  const pkg = makePackage({ name: 'Burnaby test', bbox: [S, W, Nn, E], raw, edits, compiled: c, elevation: { sources: { hrdem: 10 }, smoothing: 30 } });
  const back = readPackage(JSON.stringify(pkg));
  assert.equal(back.name, 'Burnaby test');
  assert.deepEqual(back.data, c.data);
  assert.equal(back.attribution[0], 'Map data © OpenStreetMap contributors, ODbL');
  // the stored OSM snapshot recompiles to the same network
  assert.deepEqual(compileArea(back.osm, back.edits).data, c.data);
  assert.throws(() => readPackage({ format: 'other' }), /isn’t a trail area/);
  assert.throws(() => readPackage({ ...pkg, data: { ...pkg.data, th: [] } }), /no routable network/);
});
