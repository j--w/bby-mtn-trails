// Route builder widget: the parts with no DOM (areas, trailheads, params, routes, GPX). Shared with the tests.
import { readPackage } from '../../js/area-package.js';

export class WidgetError extends Error {
  constructor(code, message) { super(message); this.name = 'WidgetError'; this.code = code; }
}

// Check and read an area file (JSON text or parsed object).
export function readArea(json) {
  let p = json;
  try { if (typeof json === 'string') p = JSON.parse(json); } catch { throw new WidgetError('area-unreadable', 'That file isn’t JSON.'); }
  try { return readPackage(p); } catch (err) {
    throw new WidgetError(/routable/.test(err.message) ? 'area-not-routable' : 'area-unreadable', err.message);
  }
}

// Trailheads with stable ids (their position, so a saved favourite survives re-saving the area).
// Unnamed ones are named by where they sit on the network ("North trailhead").
export function trailheadList(area) {
  const N = area.data.nodes, cos0 = Math.cos(N[0][0] * Math.PI / 180);
  const clat = N.reduce((a, n) => a + n[0], 0) / N.length, clon = N.reduce((a, n) => a + n[1], 0) / N.length;
  const dirs = ['East', 'North-east', 'North', 'North-west', 'West', 'South-west', 'South', 'South-east'];
  const compass = n => dirs[Math.round(((Math.atan2(n[0] - clat, (n[1] - clon) * cos0) * 180 / Math.PI + 360) % 360) / 45) % 8];
  return area.data.th.map(t => {
    const n = N[t.node];
    return { id: `${n[0].toFixed(5)},${n[1].toFixed(5)}`, name: t.name && t.name !== 'GPX start' ? t.name : `${compass(n)} trailhead`,
      at: [n[0], n[1]], ele: Math.round(n[2] ?? 0), node: t.node };
  });
}
export const trailheads = area => trailheadList(area).map(({ node, ...t }) => t);

export const PAVED = { fine: 0, avoid: 1.5, 'avoid-strongly': 3.5 };
export const DEFAULTS = { mode: 'target', distance: 21000, climb: 900, paved: 'avoid', lap: 0, seed: 4821 };

// Full params from partial ones: unknown or missing values fall back to the defaults and the first trailhead.
export function resolveParams(th, p = {}, base = DEFAULTS) {
  const q = { ...DEFAULTS, ...base, ...p };
  if (q.mode !== 'longest') q.mode = 'target';
  if (!(q.paved in PAVED)) q.paved = DEFAULTS.paved;
  for (const k of ['distance', 'climb', 'lap', 'seed']) q[k] = Number.isFinite(+q[k]) ? +q[k] : DEFAULTS[k];
  if (!th.some(t => t.id === q.start)) q.start = th[0]?.id;
  return { mode: q.mode, distance: q.distance, climb: q.climb, start: q.start, paved: q.paved, lap: q.lap, seed: Math.round(q.seed) };
}

// A sentence for the runner when the params can't be searched, else null.
export function problem(p) {
  if (p.mode === 'longest') return null;
  if (!(p.distance >= 3000 && p.distance <= 80000)) return 'Pick a distance between 3 and 80 km.';
  if (!(p.climb >= 0 && p.climb <= 5000)) return 'Pick a climb between 0 and 5000 m.';
  if (p.lap && !(p.lap >= 3000)) return 'Laps need to be at least 3 km.';
  return null;
}

// What router-core's solve / solveLongest take. Every trail is allowed (maxg 4): grades aren't offered.
export function solverParams(p, startJ) {
  if (p.mode === 'longest') return { mode: 'longest', start: startJ, maxg: 4 };
  return { start: startJ, D: p.distance, E: p.climb, maxg: 4, late: 0, lap: p.lap / 1000, pavedW: PAVED[p.paved], seed: p.seed };
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtKm = m => (m / 1000).toFixed(1);

// A worker result ({label, desc, s, laps, geom}) as the public Route.
export function toRoute(raw, i, { area, nodes, params, start, pace = 390 }) {
  const id = params.mode === 'longest' ? slug(raw.label) : 'ABC'[i];
  const label = params.mode === 'longest' ? raw.label : `Option ${id}`;
  const points = raw.geom.pts.map(p => ({ lat: nodes[p.n][0], lon: nodes[p.n][1], ele: nodes[p.n][2] ?? 0, at: p.cum, lap: Math.max(0, p.lap) }));
  const s = raw.s;
  const route = {
    id, label, description: raw.desc || '',
    distance: s.dist, climb: s.gain, repeated: s.rep, paved: s.paved || 0, laps: raw.laps || 1,
    estimatedTime: Math.round(s.dist / 1000 * pace + s.gain * 4),
    start, points, params: { ...params },
  };
  const defaultName = params.mode === 'longest' ? `${area.name} ${label} ${fmtKm(s.dist)}k` : `${area.name} ${fmtKm(s.dist)}k ${Math.round(s.gain)}m ${id}`;
  Object.defineProperty(route, 'gpx', { value: (name = defaultName) => gpxText(points, name, area.name), enumerable: false });
  return route;
}

const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function gpxText(points, name, areaName) {
  const pts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${xml(areaName)} Route Builder" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `<metadata><name>${xml(name)}</name></metadata>\n<trk><name>${xml(name)}</name><type>running</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
}

// "2h 05m" from seconds
export function fmtTime(sec) {
  const min = Math.round(sec / 60), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}
