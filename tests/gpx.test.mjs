// GPX matching tests: parsing, which pieces a track follows, and the stretches OpenStreetMap lacks. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGpx, matchTrack } from '../site/js/gpx.js';
import { parseOsm } from '../site/js/osm.js';
import { compileArea, emptyEdits, withDrawn } from '../site/js/area-package.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const gpx = name => parseGpx(readFileSync(new URL(`../data/burnaby-mountain/raw/${name}.gpx`, import.meta.url), 'utf8'));
const site = load('fixtures/burnaby-legacy.json');
const lats = site.nodes.map(n => n[0]), lons = site.nodes.map(n => n[1]);
const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
const elements = [...load('../data/burnaby-mountain/raw/osm-trails.json').elements, ...load('../data/burnaby-mountain/raw/osm-roads.json').elements]
  .filter(el => el.geometry.some(g => g.lat >= bbox[0] && g.lat <= bbox[2] && g.lon >= bbox[1] && g.lon <= bbox[3]));

test('parseGpx reads tracks, segments and routes', () => {
  const t = gpx('exhaustive');
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'Exhaustive');
  assert.equal(t[0].pts.length, 2258);
  assert.ok(t[0].pts.every(p => p[0] > 49 && p[0] < 50 && p[1] < -122));
  const two = parseGpx(`<gpx><trk><name>A</name><trkseg><trkpt lon="-122.9" lat="49.2"><ele>10</ele></trkpt><trkpt lat="49.21" lon="-122.9"/></trkseg>
    <trkseg><trkpt lat="49.3" lon="-122.8"/><trkpt lat="49.31" lon="-122.8"/></trkseg></trk><rte><name>R</name><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2"/></rte></gpx>`);
  assert.deepEqual(two.map(t => [t.name, t.pts.length]), [['A', 2], ['A', 2], ['R', 2]]);
  assert.deepEqual(two[0].pts[0], [49.2, -122.9, 10]);
  assert.deepEqual(parseGpx('not a gpx'), []);
});

test('a track picks out the trails it follows', () => {
  const raw = parseOsm({ elements });
  const c = compileArea(raw);
  const m = matchTrack({ nodes: raw.nodes, pieces: c.pieces, tracks: [...gpx('exhaustive'), ...gpx('spiral-of-doom')], bbox });
  const km = m.followed.reduce((s, f) => s + f.len, 0) / 1000;
  // the old hand-curated network (built from these tracks) was ~51 km
  assert.ok(km > 40 && km < 60, `${km.toFixed(1)} km followed`);
  assert.ok(m.offM < 2000, `${m.offM} m off the network`);
});

test('a trail missing from OpenStreetMap shows up as a gap, and drawing it fills the gap', () => {
  const tracks = gpx('exhaustive');
  const full = parseOsm({ elements });
  const base = compileArea(full);
  const before = matchTrack({ nodes: full.nodes, pieces: base.pieces, tracks, bbox });
  // drop the longest trail way the track follows end to end
  const followed = new Set(before.followed.map(f => f.id)), gapM = r => r.gaps.reduce((s, g) => s + g.m, 0);
  const way = full.ways.filter(w => w.layer === 'trail').map(w => ({ w, ps: base.pieces.filter(p => p.way === w.id) }))
    .filter(x => x.ps.length && x.ps.every(p => followed.has(p.id))).map(x => ({ ...x, len: x.ps.reduce((s, p) => s + p.len, 0) }))
    .sort((a, b) => b.len - a.len)[0];
  const raw = parseOsm({ elements: elements.filter(el => el.id !== way.w.id) });
  const c = compileArea(raw);
  const m = matchTrack({ nodes: raw.nodes, pieces: c.pieces, tracks, bbox });
  assert.ok(gapM(m) - gapM(before) > way.len * 0.6, `removing ${Math.round(way.len)} m added ${Math.round(gapM(m) - gapM(before))} m of gaps`);
  const big = m.gaps.filter(g => g.m > 300);
  assert.ok(big.length && big.every(g => g.pts[0].node != null && g.pts[g.pts.length - 1].node != null), 'long gaps end on the network');
  // add the gaps as drawn paths: they're gone on the next match
  const drawn = m.gaps.map((g, k) => ({ id: 'd' + (k + 1), name: '', pts: g.pts.map(p => p.node != null ? String(raw.osmNodes[p.node] ?? 'i' + p.node) : [p.lat, p.lon, 300]) }));
  const edits = { ...emptyEdits(), drawn };
  const c2 = compileArea(raw, edits);
  const view = withDrawn(raw, drawn);
  const after = matchTrack({ nodes: view.nodes, pieces: c2.pieces, tracks, bbox });
  assert.ok(gapM(after) < 100, `gaps left: ${after.gaps.map(g => Math.round(g.m))}`);
});
