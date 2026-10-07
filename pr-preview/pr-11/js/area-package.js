// Area packages: one JSON file per area holding the OSM snapshot, the user's edits (keyed by OSM ids so a
// later refresh can keep them) and the compiled routing graph the route builder loads. Pure functions.
import { draftNetwork, nodeKey, nodeIndex, isPaved } from './osm.js';
import { buildRouterData } from './area-build.js';

export const FORMAT = 'trail-area';
export const FORMAT_VERSION = 1;
export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors, ODbL';

// Edits (all optional):
//   pieces      {piece id: true|false}   include or leave out a piece, overriding the draft
//   splits      [node key]               extra junctions
//   joins       [[node key, node key]]   straight links between two nodes (gaps OSM doesn't close)
//   trailheads  [{node: node key, name}]
//   dismissed   [suggestion id]          connector suggestions the user said no to
//   drawn       [{id, name, pts}]        paths OSM doesn't have; each point is a node key (snapped to the
//                                        network) or [lat, lon, ele]
export const emptyEdits = () => ({ pieces: {}, splits: [], joins: [], trailheads: [], dismissed: [], drawn: [] });

// The OSM network plus the user's drawn paths, as one raw network. Drawn points get node keys
// `<path id>.<k>` and drawn paths become trail ways with the path's id, so edits can refer to them like OSM.
export function withDrawn(raw, drawn = []) {
  if (!drawn.length) return raw;
  const idx = nodeIndex(raw), nodes = raw.nodes.slice(), osmNodes = raw.nodes.map((_, i) => raw.osmNodes?.[i] ?? null), ways = raw.ways.slice();
  for (const d of drawn) {
    const path = [];
    d.pts.forEach((pt, k) => {
      let i = typeof pt === 'string' ? idx.get(pt) : undefined;
      if (i === undefined && Array.isArray(pt)) { i = nodes.length; nodes.push([pt[0], pt[1], pt[2] ?? null]); osmNodes.push(`${d.id}.${k}`); }
      if (i !== undefined && i !== path[path.length - 1]) path.push(i);
    });
    if (path.length > 1) ways.push({ id: d.id, path, tags: { highway: 'path', name: d.name || '', drawn: 'yes' }, layer: 'trail' });
  }
  return { ...raw, nodes, osmNodes, ways };
}

const R = 6371000;
function metres(raw) {
  const N = raw.nodes, lat0 = N.length ? N[0][0] * Math.PI / 180 : 0, kx = Math.PI / 180 * R * Math.cos(lat0), ky = Math.PI / 180 * R;
  return (a, b) => Math.hypot((N[a][1] - N[b][1]) * kx, (N[a][0] - N[b][0]) * ky);
}
const stripSuffix = id => id.replace(/[bt]+$/, '');

// raw OSM network + edits -> {pieces (with state), data (routing graph or null), report, joins, trailheads}.
// Piece states: 'in' (on the routable network), 'cut' (chosen but not connected to a trailhead),
// 'auto' (pulled in by the build to close a gap), 'off' (not used).
export function compileArea(raw, edits = emptyEdits(), opts = {}) {
  raw = withDrawn(raw, edits.drawn);
  const idx = nodeIndex(raw), dist = metres(raw);
  const toIdx = k => idx.get(String(k));
  const breaks = new Set(edits.splits.map(toIdx).filter(i => i !== undefined));
  const d = draftNetwork(raw, { overrides: edits.pieces, breaks });
  const joins = edits.joins.map(([a, b]) => [toIdx(a), toIdx(b)]).filter(([a, b]) => a !== undefined && b !== undefined && a !== b);
  joins.forEach(([a, b], k) => d.segs.push({ id: 'join' + k, path: [a, b], name: '', kind: 'connector', grade: null, gradeDown: null, oneway: 'no' }));
  const trailheads = edits.trailheads.map(t => ({ node: toIdx(t.node), name: t.name || '' })).filter(t => t.node !== undefined);
  const byId = new Map(d.pieces.map(p => [p.id, p]));
  for (const p of d.pieces) p.state = p.included ? 'cut' : 'off';
  if (!d.segs.length) return { pieces: d.pieces, data: null, report: null, joins, trailheads, provisional: false };

  // no trailhead yet: preview from a node of the biggest chosen network, without saving it as a trailhead
  let th = trailheads, provisional = false;
  const onNet = new Set(d.segs.flatMap(s => s.path));
  if (!th.some(t => onNet.has(t.node))) { th = [{ node: largestComponentNode(d.segs, dist), name: '' }]; provisional = true; }
  else th = th.filter(t => onNet.has(t.node));

  const { data, report } = buildRouterData({ ...d, trailheads: th }, { splitAtTrailheads: true, version: opts.version || '' });
  for (const id of report.keptIds) { const p = byId.get(stripSuffix(id)); if (p) p.state = 'in'; }
  for (const a of [...report.closed, ...report.autoAdded]) { const p = byId.get(d.extras[a.extra].piece); if (p) p.state = 'auto'; }
  if (provisional) data.th = [];
  return { pieces: d.pieces, data, report, joins, trailheads: th, provisional };
}

function largestComponentNode(segs, dist) {
  const parent = new Map(), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = x => { if (!parent.has(x)) parent.set(x, x); };
  const size = new Map();
  for (const s of segs) { s.path.forEach(add); for (let k = 1; k < s.path.length; k++) parent.set(find(s.path[k]), find(s.path[0])); }
  for (const s of segs) { let L = 0; for (let k = 1; k < s.path.length; k++) L += dist(s.path[k - 1], s.path[k]); const r = find(s.path[0]); size.set(r, (size.get(r) || 0) + L); }
  const best = [...size].sort((a, b) => b[1] - a[1])[0][0];
  return segs.find(s => find(s.path[0]) === best).path[0];
}

// Road or path pieces worth adding as connectors: the shortest stretch of unused pieces (at most `maxM`
// metres) that joins a chosen-but-unconnected part to the routable network, or that links a dead end to
// another part of the network (at most `deadEndM`). Returns [{id, pieces:[piece id], m, joins: metres
// of trail it connects, kind:'island'|'dead-end'}], biggest gain first, minus dismissed ones.
export function suggestConnectors(raw, compiled, edits = emptyEdits(), { maxM = 400, deadEndM = 250 } = {}) {
  if (!compiled.data) return [];
  raw = withDrawn(raw, edits.drawn);
  const dist = metres(raw);
  const pieces = compiled.pieces;
  const netPieces = pieces.filter(p => p.state === 'in' || p.state === 'auto');
  const netNodes = new Set(netPieces.flatMap(p => p.path));
  for (const [a, b] of compiled.joins) { netNodes.add(a); netNodes.add(b); }
  // graph of unused pieces only
  const G = new Map(), link = (a, b, m, id) => { if (!G.has(a)) G.set(a, []); G.get(a).push([b, m, id]); };
  for (const p of pieces) if (p.state === 'off') for (let k = 1; k < p.path.length; k++) { const a = p.path[k - 1], b = p.path[k], m = dist(a, b); link(a, b, m, p.id); link(b, a, m, p.id); }
  const search = (sources, isTarget, limit) => {
    const best = new Map(), prev = new Map(), heap = [];
    for (const s of sources) { best.set(s, 0); heap.push([0, s]); }
    while (heap.length) {
      heap.sort((x, y) => y[0] - x[0]);
      const [c, u] = heap.pop();
      if (c > best.get(u)) continue;
      if (c > 0 && isTarget(u)) { const ids = []; for (let v = u; prev.has(v); v = prev.get(v)[0]) if (!ids.includes(prev.get(v)[1])) ids.push(prev.get(v)[1]); return { m: c, ids }; }
      for (const [v, m, id] of G.get(u) || []) {
        const nc = c + m;
        if (nc <= limit && nc < (best.get(v) ?? Infinity)) { best.set(v, nc); prev.set(v, [u, id]); heap.push([nc, v]); }
      }
    }
    return null;
  };
  const out = [], seen = new Set(edits.dismissed);
  const push = (s, kind, gain) => {
    if (!s) return;
    const id = [...s.ids].sort().join('+');
    if (seen.has(id)) return;
    seen.add(id); out.push({ id, pieces: s.ids, m: s.m, joins: gain, kind });
  };
  // chosen pieces cut off from the network, grouped into connected parts
  const cut = pieces.filter(p => p.state === 'cut'), groups = [], groupOf = new Map();
  for (const p of cut) {
    const ends = [p.path[0], p.path[p.path.length - 1]];
    const hit = [...new Set(ends.map(n => groupOf.get(n)).filter(Boolean))];
    let g = hit[0] || { nodes: new Set(), m: 0 };
    if (!hit.length) groups.push(g);
    for (const o of hit.slice(1)) { for (const n of o.nodes) { g.nodes.add(n); groupOf.set(n, g); } g.m += o.m; groups.splice(groups.indexOf(o), 1); }
    p.path.forEach(n => { g.nodes.add(n); groupOf.set(n, g); });
    g.m += p.len;
  }
  for (const g of groups.filter(g => g.m >= 100)) push(search([...g.nodes], n => netNodes.has(n), maxM), 'island', g.m);
  // dead ends on the network
  const deg = new Map();
  for (const p of netPieces) for (const n of [p.path[0], p.path[p.path.length - 1]]) deg.set(n, (deg.get(n) || 0) + 1);
  for (const [a, b] of compiled.joins) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  const thNodes = new Set(compiled.trailheads.map(t => t.node));
  for (const p of netPieces) for (const end of [p.path[0], p.path[p.path.length - 1]]) {
    if (deg.get(end) !== 1 || thNodes.has(end)) continue;
    const own = new Set(p.path);
    push(search([end], n => netNodes.has(n) && !own.has(n), deadEndM), 'dead-end', 0);
  }
  return out.sort((x, y) => y.joins - x.joins || x.m - y.m);
}

// Ways and nodes worth keeping in the package: everything parsed, with tags cut to the ones we use.
const KEEP_TAGS = ['highway', 'name', 'surface', 'footway', 'access', 'foot', 'sac_scale', 'mtb:scale:imba', 'trail_visibility'];
function trimRaw(raw) {
  const tags = t => Object.fromEntries(KEEP_TAGS.filter(k => t[k] != null).map(k => [k, t[k]]));
  return { nodes: raw.nodes, osmNodes: raw.osmNodes, ways: raw.ways.map(w => ({ id: w.id, path: w.path, tags: tags(w.tags), layer: w.layer })), pois: raw.pois || [] };
}

export function makePackage({ name, bbox, raw, edits, compiled, elevation = {}, osmTimestamp = null, created = new Date().toISOString() }) {
  return {
    format: FORMAT, version: FORMAT_VERSION, name, bbox, created, osmTimestamp,
    attribution: [OSM_ATTRIBUTION, ...(elevation.attribution || [])],
    elevation: { sources: elevation.sources || {}, smoothing: elevation.smoothing ?? null },
    osm: trimRaw(raw),
    edits,
    data: compiled.data,
  };
}

export function readPackage(json) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  if (p?.format !== FORMAT) throw new Error('This file isn’t a trail area.');
  if (p.version > FORMAT_VERSION) throw new Error('This area was saved by a newer version. Reload the page and try again.');
  if (!p.data?.nodes?.length || !p.data?.th?.length) throw new Error('This area has no routable network yet.');
  return { ...p, edits: { ...emptyEdits(), ...p.edits } };
}

// Helpers the setup page uses to turn map clicks into edits.
export const keyOf = (raw, i) => nodeKey(raw, i);
export const pieceKind = p => p.layer === 'road' || isPaved(p.tags) ? 'connector' : 'trail';
