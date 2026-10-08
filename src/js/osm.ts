// OpenStreetMap: Overpass query and fetch, parsing into a node/way network, and the first-pass draft
// (which pieces start included as trails, which are left as connector candidates). Pure functions except
// fetchOsm, which takes the fetch function as an option so tests can stub it.
import { eqScale } from './types.js';
import type { LatLonEle } from './types.js';
import type { BuildSeg, Extra, RefLine } from './area-build.js';

/** [south, west, north, east] in degrees. */
export type BBox = [number, number, number, number];
export type OsmTags = Record<string, string>;
/** 'trail' is included by default, 'road' is a connector candidate. */
export type Layer = 'trail' | 'road';

/** A way of the raw network; drawn paths (see area-package withDrawn) have string ids. */
export interface RawWay { id: number | string; path: number[]; tags: OsmTags; layer: Layer }
export interface Poi { id: number; lat: number; lon: number; kind: string; name: string }
/** The raw OSM network parseOsm makes: nodes shared between ways, with their OSM ids (or drawn keys) when known. */
export interface RawNetwork { nodes: LatLonEle[]; osmNodes?: Array<number | string | null>; ways: RawWay[]; pois?: Poi[] }

/** A run of a way between junctions; id is `<way id>/<key of its first node>`. */
export interface Piece { id: string; way: number | string; path: number[]; tags: OsmTags; layer: Layer }
/** A piece after the draft: its length (m), whether it's chosen, and (after compileArea) its state. */
export interface DraftPiece extends Piece { len: number; included: boolean; stub?: boolean; state?: PieceState }
export type PieceState = 'in' | 'cut' | 'auto' | 'off';
/** An unchosen piece offered to the build. */
export interface PieceExtra extends Extra { piece: string }
/** buildRouterData's input minus trailheads, as toBuildInput makes it. */
export interface NetworkInput { nodes: LatLonEle[]; segs: BuildSeg[]; extras: PieceExtra[]; added: number[]; ref: RefLine[] }
export interface Draft extends NetworkInput { pieces: DraftPiece[] }

export interface FetchOsmOptions { fetch?: typeof globalThis.fetch; servers?: string[]; timeoutMs?: number; signal?: AbortSignal }
export interface DraftOptions { stubMax?: number; overrides?: Record<string, boolean>; breaks?: Set<number> }

export const OVERPASS_SERVERS: string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const TRAIL_HW = /^(path|footway|track|bridleway|steps)$/;
const ROAD_HW = /^(service|residential|living_street|unclassified|tertiary|cycleway|pedestrian)$/;
const PAVED = /^(asphalt|concrete|concrete:plates|concrete:lanes|paved|paving_stones|sett|chipseal|metal|grass_paver)$/;
const UNPAVED = /^(dirt|ground|gravel|fine_gravel|compacted|grass|unpaved|sand|woodchips|mud|earth|rock|pebblestone|wood)$/;

// bbox = [south, west, north, east] in degrees.
export function overpassQuery([s, w, n, e]: BBox, timeout = 90): string {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:${timeout}];
(
  way["highway"~"^(path|footway|track|bridleway|steps|cycleway|pedestrian)$"](${b});
  way["highway"~"^(service|residential|living_street|unclassified|tertiary)$"](${b});
  node["highway"="trailhead"](${b});
  node["amenity"~"^(parking|drinking_water|toilets)$"](${b});
);
out body geom;`;
}

// Area of a bbox in km² (for the size warning).
export function bboxKm2([s, w, n, e]: BBox): number {
  const kmLat = 111.195, kmLon = kmLat * Math.cos((s + n) / 2 * Math.PI / 180);
  return (n - s) * kmLat * (e - w) * kmLon;
}

// POST the query to each server in turn; move on after a rate limit, server error, timeout or network error.
// Resolves to the Overpass JSON as is.
export async function fetchOsm(bbox: BBox, { fetch = globalThis.fetch, servers = OVERPASS_SERVERS, timeoutMs = 100000, signal }: FetchOsmOptions = {}): Promise<any> {
  const body = 'data=' + encodeURIComponent(overpassQuery(bbox));
  const errors: string[] = [];
  for (const url of servers) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort(); signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: ctl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (res.ok) return await res.json();
      errors.push(`${url}: HTTP ${res.status}`);
      if (res.status < 429 && res.status !== 408) break;   // a bad query fails the same everywhere
    } catch (err: any) {
      if (signal?.aborted) throw err;
      errors.push(`${url}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  throw new Error('Could not load OpenStreetMap data. ' + errors.join('; '));
}

// Which layer a way belongs to: 'trail' (included by default), 'road' (connector candidate) or null (skip).
export function classifyWay(t: OsmTags): Layer | null {
  const hw = t.highway || '';
  if (/^(private|no)$/.test(t.access || '') || t.foot === 'no' || t.area === 'yes' || t.indoor === 'yes') return null;
  if (TRAIL_HW.test(hw)) {
    // most footways without a dirt-like surface are sidewalks and campus paths; offer them as connectors instead
    if (hw === 'footway' && (/^(sidewalk|crossing|traffic_island|access_aisle)$/.test(t.footway || '') || !UNPAVED.test(t.surface || ''))) return 'road';
    return 'trail';
  }
  return ROAD_HW.test(hw) ? 'road' : null;
}

export const isPaved = (t: OsmTags): boolean => PAVED.test(t.surface || '') || (!t.surface && /^(service|residential|living_street|unclassified|tertiary|cycleway|pedestrian)$/.test(t.highway || ''));

// Overpass JSON -> {nodes:[[lat, lon, ele]], osmNodes:[id], ways:[{id, path, tags, layer}], pois:[{id, lat, lon, kind, name}]}.
// Ways that meet share a node index. Uses OSM node ids when the response has them (out body geom); without
// them (out geom tags) nodes at the same rounded position are merged instead.
export function parseOsm(json: any): RawNetwork {
  const nodes: LatLonEle[] = [], osmNodes: Array<number | null> = [], index = new Map<number | string, number>(), ways: RawWay[] = [], pois: Poi[] = [];
  const nodeAt = (key: number | string, lat: number, lon: number, id: number | undefined) => {
    let i = index.get(key);
    if (i === undefined) { i = nodes.length; index.set(key, i); nodes.push([lat, lon, null]); osmNodes.push(id ?? null); }
    return i;
  };
  for (const el of json.elements || []) {
    if (el.type === 'node') {
      const t = el.tags || {};
      const kind = t.highway === 'trailhead' ? 'trailhead' : t.amenity;
      if (kind) pois.push({ id: el.id, lat: el.lat, lon: el.lon, kind, name: t.name || '' });
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags: OsmTags = el.tags || {}, layer = classifyWay(tags);
    if (!layer) continue;
    const path: number[] = el.geometry.map((g: { lat: number; lon: number }, k: number) => {
      const id: number | undefined = el.nodes?.[k];
      return nodeAt(id ?? `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`, g.lat, g.lon, id);
    });
    ways.push({ id: el.id, path, tags, layer });
  }
  return { nodes, osmNodes, ways, pois };
}

// Stable key for a node: its OSM id, or `i<index>` for data without node ids (older exports).
export const nodeKey = (raw: Pick<RawNetwork, 'osmNodes'>, i: number): string => raw.osmNodes?.[i] != null ? String(raw.osmNodes[i]) : 'i' + i;
export function nodeIndex(raw: RawNetwork): Map<string, number> {
  const m = new Map<string, number>();
  raw.nodes.forEach((_, i) => m.set(nodeKey(raw, i), i));
  return m;
}

// Cut ways into pieces at junctions (nodes used by more than one way, or by the same way twice) and at
// any extra `breaks` (user splits). Piece ids are `<way id>/<key of its first node>`: splitting a piece
// elsewhere doesn't change the id of the part before the split.
export function splitWays(ways: RawWay[], { breaks = new Set<number>(), key = (n: number) => String(n) }: { breaks?: Set<number>; key?: (n: number) => string } = {}): Piece[] {
  const uses = new Map<number, number>();
  for (const w of ways) w.path.forEach((n, k) => { if (k === 0 || k === w.path.length - 1) uses.set(n, (uses.get(n) || 0) + 2); else uses.set(n, (uses.get(n) || 0) + 1); });
  const pieces: Piece[] = [], seen = new Set<string>();
  for (const w of ways) {
    let start = 0;
    for (let k = 1; k < w.path.length; k++) {
      if (k === w.path.length - 1 || uses.get(w.path[k])! > 1 || breaks.has(w.path[k])) {
        let id = `${w.id}/${key(w.path[start])}`;
        for (let d = 2; seen.has(id); d++) id = `${w.id}/${key(w.path[start])}~${d}`;
        seen.add(id);
        pieces.push({ id, way: w.id, path: w.path.slice(start, k + 1), tags: w.tags, layer: w.layer });
        start = k;
      }
    }
  }
  return pieces;
}

// First-pass draft for a new area: trail pieces in, everything else a candidate; short dead-end stubs out.
// `overrides` ({piece id: true|false}) are the user's choices and win over the defaults; `breaks` are
// node indices to split at. Returns the buildRouterData input (minus trailheads) plus the pieces.
export function draftNetwork(raw: RawNetwork, { stubMax = 25, overrides = {}, breaks }: DraftOptions = {}): Draft {
  // len and included are set just below
  const pieces = splitWays(raw.ways, { breaks, key: n => nodeKey(raw, n) }) as DraftPiece[];
  const N = raw.nodes, [kx, ky] = eqScale(N);
  const dist = (a: number, b: number) => Math.hypot((N[a][1] - N[b][1]) * kx, (N[a][0] - N[b][0]) * ky);
  const len = (p: number[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
  for (const pc of pieces) { pc.len = len(pc.path); pc.included = pc.id in overrides ? overrides[pc.id] : pc.layer === 'trail'; }
  for (let round = 0; round < 5; round++) {
    const deg = new Map<number, number>();
    for (const pc of pieces) if (pc.included) for (const n of [pc.path[0], pc.path[pc.path.length - 1]]) deg.set(n, (deg.get(n) || 0) + 1);
    let moved = 0;
    for (const pc of pieces) {
      if (!pc.included || pc.len >= stubMax || pc.id in overrides) continue;
      if (deg.get(pc.path[0]) === 1 || deg.get(pc.path[pc.path.length - 1]) === 1) { pc.included = false; pc.stub = true; moved++; }
    }
    if (!moved) break;
  }
  return { pieces, ...toBuildInput(raw, pieces) };
}

// Included pieces become segments, the rest extras (the build may pull short ones in to close gaps).
export function toBuildInput(raw: RawNetwork, pieces: DraftPiece[]): NetworkInput {
  const segs: BuildSeg[] = [], extras: PieceExtra[] = [];
  for (const pc of pieces) {
    const t = pc.tags, paved = isPaved(t);
    if (pc.included) segs.push({ id: pc.id, path: pc.path, name: t.name || '', kind: pc.layer === 'road' || paved ? 'connector' : 'trail', grade: null, gradeDown: null, oneway: 'no' });
    else extras.push({ p: pc.path, piece: pc.id, osm: { name: t.name || '', via: t.highway, conn: pc.layer === 'road', paved: paved ? 1 : 0 } });
  }
  return { nodes: raw.nodes, segs, extras, added: [], ref: [] };
}
