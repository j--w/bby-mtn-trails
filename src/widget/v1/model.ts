// Route builder widget: the parts with no DOM (areas, trailheads, params, routes, GPX). Shared with the tests.
import { readPackage } from '../../js/area-package.js';
import type { RouteStats, routeGeometry, SolveParams, LongestParams } from '../../js/router-core.js';
import type { LatLonEle, RouterData } from '../../js/types.js';

// ---------- areas ----------

/** An area file (`.trails.json`) made on the setup page. Treat it as opaque: store it, pass it back in. */
export interface AreaPackage {
  readonly format: 'trail-area';
  readonly version: number;
  readonly name: string;
  /** [south, west, north, east] */
  readonly bbox: readonly [number, number, number, number];
  /** Credits the widget shows (OpenStreetMap, the elevation source). */
  readonly attribution: readonly string[];
}

// What the widgets read from an area: its routing graph.
export interface LoadedArea extends AreaPackage { readonly data: RouterData }

export interface Trailhead {
  /** Its position ("49.27800,-122.91700"): stays the same when the area is edited and saved again. */
  id: string;
  name: string;
  at: [lat: number, lon: number];
  /** metres, approximate */
  ele: number;
}

// A trailhead with its node in the routing graph.
export interface TrailheadNode extends Trailhead { node: number }

// ---------- route search ----------

export type RouteMode = 'target' | 'longest';
export type PavedPreference = 'fine' | 'avoid' | 'avoid-strongly';

/** The inputs of a search. The same area + params (seed included) always gives the same routes. */
export interface RouteParams {
  /** Default 'target'. */
  mode: RouteMode;
  /** Target mode. 3000–80000. Default 21000. */
  distance: number;
  /** Target mode. 0–5000. Default 900. */
  climb: number;
  /** Trailhead id. Default: the area's first trailhead. */
  start: string;
  /** Target mode. Default 'avoid'. */
  paved: PavedPreference;
  /** Target mode. Come back through the start about every this many metres (aid stops); 0 = no need. Default 0. */
  lap: number;
  /** Default 4821. "New variations" picks a new one. */
  seed: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  /** metres, approximate */
  ele: number;
  /** distance along the route */
  at: number;
  /** 0-based lap */
  lap: number;
}

export interface Route {
  /** 'A' | 'B' | 'C' in target mode; 'no-repeats' | 'skip-dead-ends' | 'every-trail' in longest mode. */
  id: string;
  /** 'Option A', or 'No repeats' etc. */
  label: string;
  /** Longest mode: what the option means. Empty in target mode. */
  description: string;
  distance: number;
  /** Approximate: from LiDAR or terrain tiles, smoothed. */
  climb: number;
  /** Metres run more than once. */
  repeated: number;
  /** Metres on roads, sidewalks and paved paths. */
  paved: number;
  laps: number;
  /** From prefs.pace (default 6:30/km) plus 4 s per metre of climb. */
  estimatedTime: number;
  start: Trailhead;
  points: RoutePoint[];
  /** Everything needed to rebuild this exact route. Store this rather than the points. */
  params: RouteParams;
  /** GPX 1.1 text. Default name: area, distance, climb and option. */
  gpx(name?: string): string;
}

export type WidgetErrorCode =
  | 'area-unreadable' | 'area-not-routable' | 'invalid-params' | 'no-route' | 'search-failed' | 'map-unavailable';

export class WidgetError extends Error {
  readonly code: WidgetErrorCode;
  constructor(code: WidgetErrorCode, message: string) { super(message); this.name = 'WidgetError'; this.code = code; }
}

/** Check and read an area file (JSON text or a parsed object). Throws a WidgetError ('area-unreadable' or
 *  'area-not-routable') with a message you can show. */
export function readArea(json: string | unknown): AreaPackage {
  let p = json;
  try { if (typeof json === 'string') p = JSON.parse(json); } catch { throw new WidgetError('area-unreadable', 'That file isn’t JSON.'); }
  try { return readPackage(p); } catch (err) {
    const msg = (err as Error).message;
    throw new WidgetError(/routable/.test(msg) ? 'area-not-routable' : 'area-unreadable', msg);
  }
}

// Trailheads with stable ids (their position, so a saved favourite survives re-saving the area).
// Unnamed ones are named by where they sit on the network ("North trailhead").
export function trailheadList(area: LoadedArea): TrailheadNode[] {
  const N = area.data.nodes, cos0 = Math.cos(N[0][0] * Math.PI / 180);
  const clat = N.reduce((a, n) => a + n[0], 0) / N.length, clon = N.reduce((a, n) => a + n[1], 0) / N.length;
  const dirs = ['East', 'North-east', 'North', 'North-west', 'West', 'South-west', 'South', 'South-east'];
  const compass = n => dirs[Math.round(((Math.atan2(n[0] - clat, (n[1] - clon) * cos0) * 180 / Math.PI + 360) % 360) / 45) % 8];
  return area.data.th.map(t => {
    const n = N[t.node];
    return { id: `${n[0].toFixed(5)},${n[1].toFixed(5)}`, name: t.name && t.name !== 'GPX start' ? t.name : `${compass(n)} trailhead`,
      at: [n[0], n[1]] as [number, number], ele: Math.round(n[2] ?? 0), node: t.node };
  });
}
/** The area's trailheads, for your own picker or a saved favourite. */
export function trailheads(area: AreaPackage): Trailhead[] { return trailheadList(area as LoadedArea).map(({ node, ...t }) => t); }

export const PAVED: Record<PavedPreference, number> = { fine: 0, avoid: 1.5, 'avoid-strongly': 3.5 };
export const DEFAULTS: Omit<RouteParams, 'start'> = { mode: 'target', distance: 21000, climb: 900, paved: 'avoid', lap: 0, seed: 4821 };

// Full params from partial ones: unknown or missing values fall back to the defaults and the first trailhead.
export function resolveParams(th: Trailhead[], p: Partial<RouteParams> = {}, base: Partial<RouteParams> = DEFAULTS): RouteParams {
  const q: Partial<RouteParams> & typeof DEFAULTS = { ...DEFAULTS, ...base, ...p };
  if (q.mode !== 'longest') q.mode = 'target';
  if (!(q.paved in PAVED)) q.paved = DEFAULTS.paved;
  for (const k of ['distance', 'climb', 'lap', 'seed'] as const) q[k] = Number.isFinite(+q[k]) ? +q[k] : DEFAULTS[k];
  if (!q.start || !th.some(t => t.id === q.start)) q.start = th[0]?.id;
  return { mode: q.mode, distance: q.distance, climb: q.climb, start: q.start, paved: q.paved, lap: q.lap, seed: Math.round(q.seed) };
}

// A sentence for the runner when the params can't be searched, else null.
export function problem(p: RouteParams): string | null {
  if (p.mode === 'longest') return null;
  if (!(p.distance >= 3000 && p.distance <= 80000)) return 'Pick a distance between 3 and 80 km.';
  if (!(p.climb >= 0 && p.climb <= 5000)) return 'Pick a climb between 0 and 5000 m.';
  if (p.lap && !(p.lap >= 3000)) return 'Laps need to be at least 3 km.';
  return null;
}

// What router-core's solve / solveLongest take. Every trail is allowed (maxg 4): grades aren't offered.
export function solverParams(p: RouteParams, startJ: number): SolveParams | LongestParams & { mode: 'longest' } {
  if (p.mode === 'longest') return { mode: 'longest', start: startJ, maxg: 4 };
  return { start: startJ, D: p.distance, E: p.climb, maxg: 4, late: 0, lap: p.lap / 1000, pavedW: PAVED[p.paved], seed: p.seed };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtKm = (m: number) => (m / 1000).toFixed(1);

// A route as the search worker posts it.
export interface WorkerRoute { label: string; desc: string; s: RouteStats; laps: number; geom: ReturnType<typeof routeGeometry> }

// A worker result ({label, desc, s, laps, geom}) as the public Route.
export function toRoute(raw: WorkerRoute, i: number, { area, nodes, params, start, pace = 390 }:
  { area: AreaPackage; nodes: LatLonEle[]; params: RouteParams; start: Trailhead; pace?: number }): Route {
  const id = params.mode === 'longest' ? slug(raw.label) : 'ABC'[i];
  const label = params.mode === 'longest' ? raw.label : `Option ${id}`;
  const points = raw.geom.pts.map(p => ({ lat: nodes[p.n][0], lon: nodes[p.n][1], ele: nodes[p.n][2] ?? 0, at: p.cum, lap: Math.max(0, p.lap) }));
  const s = raw.s;
  const route: Omit<Route, 'gpx'> = {
    id, label, description: raw.desc || '',
    distance: s.dist, climb: s.gain, repeated: s.rep, paved: s.paved || 0, laps: raw.laps || 1,
    estimatedTime: Math.round(s.dist / 1000 * pace + s.gain * 4),
    start, points, params: { ...params },
  };
  const defaultName = params.mode === 'longest' ? `${area.name} ${label} ${fmtKm(s.dist)}k` : `${area.name} ${fmtKm(s.dist)}k ${Math.round(s.gain)}m ${id}`;
  Object.defineProperty(route, 'gpx', { value: (name = defaultName) => gpxText(points, name, area.name), enumerable: false });
  return route as Route;
}

const xml = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
export function gpxText(points: RoutePoint[], name: string, areaName: string) {
  const pts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${xml(areaName)} Route Builder" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `<metadata><name>${xml(name)}</name></metadata>\n<trk><name>${xml(name)}</name><type>running</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
}

// "2h 05m" from seconds
export function fmtTime(sec: number) {
  const min = Math.round(sec / 60), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}
