// OSM loading and first-pass draft tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overpassQuery, fetchOsm, parseOsm, splitWays, draftNetwork, classifyWay, bboxKm2 } from '../site/js/osm.js';
import { buildRouterData } from '../site/js/area-build.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// A tiny Overpass response (out body geom): a dirt trail crossing a road, a sidewalk, a private path,
// a 10 m dead-end stub and a parking lot. ~0.0001° lat = 11 m.
const node = (id, lat, lon) => ({ id, lat, lon });
const way = (id, tags, pts) => ({ type: 'way', id, tags, nodes: pts.map(p => p.id), geometry: pts.map(({ lat, lon }) => ({ lat, lon })) });
const A = node(1, 49.2800, -122.9200), B = node(2, 49.2810, -122.9200), C = node(3, 49.2820, -122.9200),
  D = node(4, 49.2810, -122.9190), E = node(5, 49.2810, -122.9210), F = node(6, 49.2811, -122.9200 + 0.0001),
  G = node(7, 49.2830, -122.9200);
const SAMPLE = { elements: [
  way(10, { highway: 'path', name: 'Ridge Trail', surface: 'dirt' }, [A, B, C]),
  way(11, { highway: 'residential', name: 'Hill Rd' }, [E, B, D]),
  way(12, { highway: 'footway', footway: 'sidewalk' }, [C, G]),
  way(13, { highway: 'path', access: 'private' }, [D, G]),
  way(14, { highway: 'path' }, [B, F]),
  { type: 'node', id: 99, lat: 49.2801, lon: -122.9201, tags: { amenity: 'parking', name: 'Lot 1' } },
] };

test('query covers trails, roads and trailhead points in the box', () => {
  const q = overpassQuery([49.245, -122.985, 49.305, -122.86]);
  assert.match(q, /\(49\.245,-122\.985,49\.305,-122\.86\)/);
  assert.match(q, /highway"~"\^\(path\|footway/);
  assert.match(q, /residential/);
  assert.match(q, /out body geom;/);
  assert.ok(Math.abs(bboxKm2([49.245, -122.985, 49.305, -122.86]) - 60.4) < 1);
});

test('fetch moves to the next server after a rate limit, and stops on a bad query', async () => {
  const calls = [];
  const fake = statuses => async url => { calls.push(url); const status = statuses.shift(); return { ok: status === 200, status, json: async () => SAMPLE }; };
  const json = await fetchOsm([0, 0, 1, 1], { fetch: fake([429, 200]), servers: ['a', 'b'] });
  assert.equal(json, SAMPLE);
  assert.deepEqual(calls, ['a', 'b']);
  calls.length = 0;
  await assert.rejects(fetchOsm([0, 0, 1, 1], { fetch: fake([400, 200]), servers: ['a', 'b'] }), /HTTP 400/);
  assert.deepEqual(calls, ['a']);
  await assert.rejects(fetchOsm([0, 0, 1, 1], { fetch: async () => { throw new TypeError('offline'); }, servers: ['a', 'b'] }), /a: offline; b: offline/);
});

test('ways are classified into trail and road layers', () => {
  assert.equal(classifyWay({ highway: 'path' }), 'trail');
  assert.equal(classifyWay({ highway: 'footway', surface: 'dirt' }), 'trail');
  assert.equal(classifyWay({ highway: 'footway' }), 'road');          // usually a sidewalk or campus path
  assert.equal(classifyWay({ highway: 'footway', footway: 'crossing', surface: 'dirt' }), 'road');
  assert.equal(classifyWay({ highway: 'service' }), 'road');
  assert.equal(classifyWay({ highway: 'path', access: 'private' }), null);
  assert.equal(classifyWay({ highway: 'primary' }), null);
});

test('parsing shares nodes between ways and keeps points of interest', () => {
  const raw = parseOsm(SAMPLE);
  assert.equal(raw.ways.length, 4);                       // the private path is dropped
  const ridge = raw.ways.find(w => w.id === 10), road = raw.ways.find(w => w.id === 11);
  assert.equal(ridge.path[1], road.path[1]);               // they cross at node B
  assert.deepEqual(raw.osmNodes[ridge.path[1]], 2);
  assert.deepEqual(raw.pois, [{ id: 99, lat: 49.2801, lon: -122.9201, kind: 'parking', name: 'Lot 1' }]);
  // without node ids (out geom tags) the same position still joins
  const noIds = parseOsm({ elements: SAMPLE.elements.map(({ nodes, ...rest }) => rest) });
  assert.equal(noIds.ways[0].path[1], noIds.ways[1].path[1]);
});

test('ways split at junctions; the draft keeps trails and drops short stubs', () => {
  const raw = parseOsm(SAMPLE);
  const pieces = splitWays(raw.ways);
  assert.deepEqual(pieces.filter(p => p.way === 10).map(p => p.id), ['10/0', '10/1']);   // keys default to node indices
  const d = draftNetwork(raw);
  const byId = Object.fromEntries(d.pieces.map(p => [p.id, p]));
  assert.ok(byId['10/1'].included && byId['10/2'].included);
  assert.ok(!byId['11/5'].included);                       // roads start as candidates
  assert.ok(!byId['14/2'].included && byId['14/2'].stub);  // 11 m dead end
  assert.deepEqual(d.segs.map(s => s.id), ['10/1', '10/2']);
  assert.equal(d.extras.length, 4);
  assert.equal(d.segs[0].name, 'Ridge Trail');
});

// The OSM exports Burnaby's network was first made from, cut to the network's box: the automatic draft
// alone should already give a large connected network around the trailheads.
test('Burnaby Mountain raw OSM: draft and build give a usable network', () => {
  const site = load('fixtures/burnaby-legacy.json');
  const lats = site.nodes.map(n => n[0]), lons = site.nodes.map(n => n[1]);
  const [s, w, n, e] = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  const elements = [...load('../data/burnaby-mountain/raw/osm-trails.json').elements, ...load('../data/burnaby-mountain/raw/osm-roads.json').elements]
    .filter(el => el.geometry.some(g => g.lat >= s && g.lat <= n && g.lon >= w && g.lon <= e));
  const raw = parseOsm({ elements });
  const d = draftNetwork(raw);
  const onNet = [...new Set(d.segs.flatMap(sg => sg.path))];
  const nearest = (lat, lon) => onNet.reduce((b, k) => { const dd = (raw.nodes[k][0] - lat) ** 2 + ((raw.nodes[k][1] - lon) * 0.65) ** 2; return dd < b[1] ? [k, dd] : b; }, [-1, Infinity])[0];
  const trailheads = site.th.map(t => ({ node: nearest(site.nodes[t.node][0], site.nodes[t.node][1]), name: t.name }));
  const { data, report } = buildRouterData({ ...d, trailheads }, { splitAtTrailheads: true });
  assert.equal(data.th.length, 3);
  assert.ok(report.kept.m > 35000 && report.kept.m < 60000, `kept ${Math.round(report.kept.m)} m`);
  const ends = new Set(data.segs.flatMap(sg => [sg.p[0], sg.p[sg.p.length - 1]]));
  for (const t of data.th) assert.ok(ends.has(t.node), 'trailhead is a junction');
});
