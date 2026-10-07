// Area build: a curated trail network -> the compact routing graph the route builder loads.
// Pure functions, no DOM. Started as a port of the old Python build (scripts/build_router_data.py; see git history).
//
// Steps: keep the curated segments, join dead ends that nearly touch (< snapTol m), fill dead ends with short
// unadded extras (<= fillMax m), connect islands through short extras (<= islandMax m in total), split at shared
// nodes, keep the component that holds the first trailhead, then write nodes/segs/th/ref.

import FlatQueue from 'flatqueue';
import type { LatLonEle, Oneway, RouterData, SegKind } from './types.js';

const R = 6371000;

/** A segment of the curated network (the build's input and working form). */
export interface BuildSeg { id: string; path: number[]; name: string; kind: SegKind; grade: number | null; gradeDown: number | null; oneway: Oneway }
/** OSM facts about an extra: conn is a road, paved the paved share (0-1), imba the trail grade. */
export interface ExtraOsm { name?: string; via?: string; conn?: boolean; paved?: number; imba?: number | null }
/** A candidate piece the build may add. */
export interface Extra { p: number[]; osm?: ExtraOsm }
/** A background reference line, [lon, lat] points. */
export interface RefLine { c: Array<[number, number]>; k: string }
export interface Trailhead { node: number; name: string }
export interface BuildInput {
  nodes: LatLonEle[];
  segs: BuildSeg[];
  trailheads: Trailhead[];
  extras?: Extra[];
  added?: number[];
  ref?: RefLine[];
}
export interface BuildOptions { snapTol?: number; fillMax?: number; islandMax?: number; version?: string; splitAtTrailheads?: boolean }
/** An extra the build pulled in, by index. */
export interface AddedExtra { extra: number; name: string | null; m: number }
/** What the build did, for the setup page. */
export interface BuildReport {
  snapped: Array<{ at: [number, number]; m: number; nodes: [number, number] }>;
  closed: AddedExtra[];
  autoAdded: AddedExtra[];
  kept: { segs: number; m: number };
  dropped: { segs: number; m: number; names: string[] };
  keptIds: string[];
  droppedIds: string[];
}

// Input
//   nodes      [[lat, lon, ele], ...]                    every node the segments and extras refer to
//   segs       [{id, path:[node], name, kind, grade, gradeDown, oneway}]   the curated network
//   trailheads [{node, name}]                            routing starts; the first one picks the kept component
//   extras     [{p:[node], osm:{name, via, conn, paved, imba}}]            candidate pieces the build may add
//   added      [extra index]                             extras the curated network already contains
//   ref        [{c:[[lon, lat]], k}]                     background reference lines
export function buildRouterData(input: BuildInput, opts: BuildOptions = {}): { data: RouterData; report: BuildReport } {
  const { snapTol = 8, fillMax = 30, islandMax = 80, version = '', splitAtTrailheads = false } = opts;
  const N = input.nodes, extras = input.extras || [];
  const th = input.trailheads.map(t => t.node), thSet = new Set(th);
  const lat0 = N[0][0] * Math.PI / 180, cos0 = Math.cos(lat0);
  const X = N.map(n => n[1] * Math.PI / 180 * R * cos0), Y = N.map(n => n[0] * Math.PI / 180 * R);
  const dist = (a: number, b: number) => Math.hypot(X[a] - X[b], Y[a] - Y[b]);
  const len = (p: number[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
  const first = (p: number[]) => p[0], last = (p: number[]) => p[p.length - 1];
  const extraSeg = (i: number, e: Extra): BuildSeg => {
    const o: ExtraOsm = e.osm || {};
    return { id: 'x' + i, path: e.p.slice(), name: o.name ?? '', kind: o.conn || (o.paved || 0) >= 0.6 ? 'connector' : 'trail',
      grade: o.imba ?? null, gradeDown: null, oneway: 'no' };
  };
  let segs = input.segs.map(s => ({ ...s, path: s.path.slice() }));
  const added = new Set(input.added || []);
  const report = {} as BuildReport;   // filled in step by step below
  // optionally make a trailhead in the middle of a segment a junction (the build expects them at segment ends)
  if (splitAtTrailheads) for (const t of th) {
    const s = segs.find(s => s.path.indexOf(t) > 0 && s.path.indexOf(t) < s.path.length - 1);
    if (s) { const k = s.path.indexOf(t); segs.push({ ...s, path: s.path.slice(k), id: s.id + 't' }); s.path = s.path.slice(0, k + 1); }
  }

  const degrees = () => {
    const deg = new Map<number, number>();
    for (const s of segs) for (const n of [first(s.path), last(s.path)]) deg.set(n, (deg.get(n) || 0) + 1);
    return deg;
  };

  // join dead ends that sit within a few metres of another segment (OSM ways that nearly touch)
  // A grid of snapTol cells finds the candidates; the smallest distance wins, ties to the earliest segment and node.
  report.snapped = [];
  const cell = snapTol, grid = new Map<string, Array<[number, number, number]>>(), cellKey = (cx: number, cy: number) => cx + ',' + cy;
  const addToGrid = (j: number, path: number[]) => path.forEach((n, k) => {
    const key = cellKey(Math.floor(X[n] / cell), Math.floor(Y[n] / cell));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push([j, k, n]);
  });
  segs.forEach((s, j) => addToGrid(j, s.path));
  for (let round = 0; round < 3; round++) {
    const deg = degrees();
    let made = false;
    for (const [si, s] of segs.slice().entries()) {
      for (const end of [first(s.path), last(s.path)]) {
        if (deg.get(end) !== 1 || thSet.has(end)) continue;
        let best: { d: number; n: number; j: number; k: number } | null = null;
        const cx = Math.floor(X[end] / cell), cy = Math.floor(Y[end] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const [j, k, n] of grid.get(cellKey(cx + dx, cy + dy)) || []) {
            if (j === si) continue;
            const d = dist(end, n);
            if (d < snapTol && (best === null || d < best.d || (d === best.d && (j < best.j || (j === best.j && k < best.k))))) best = { d, n, j, k };
          }
        }
        if (best) {
          segs.push({ id: 'snap' + report.snapped.length, path: [end, best.n], name: '', kind: 'connector', grade: null, gradeDown: null, oneway: 'no' });
          addToGrid(segs.length - 1, [end, best.n]);
          report.snapped.push({ at: N[end].slice(0, 2) as [number, number], m: best.d, nodes: [end, best.n] });
          deg.set(end, deg.get(end)! + 1); deg.set(best.n, (deg.get(best.n) || 0) + 1); made = true;
        }
      }
    }
    if (!made) break;
  }

  // close dead ends with a short unadded extra that leads to another part of the network
  report.closed = [];
  for (let round = 0; round < 3; round++) {
    const deg = degrees(), netn = new Set<number>();
    for (const s of segs) for (const n of s.path) netn.add(n);
    let made = false;
    extras.forEach((e, i) => {
      if (added.has(i) || len(e.p) > fillMax) return;
      const a = first(e.p), b = last(e.p);
      if ((deg.get(a) === 1 && netn.has(b)) || (deg.get(b) === 1 && netn.has(a))) {
        segs.push(extraSeg(i, e)); added.add(i);
        report.closed.push({ extra: i, name: e.osm?.name || e.osm?.via || null, m: len(e.p) }); made = true;
      }
    });
    if (!made) break;
  }

  // connect islands to the trailhead component through short extras
  report.autoAdded = [];
  for (let round = 0; round < 10; round++) {
    segs = splitAll(segs);
    const { comp, adj } = components(segs);
    const main = comp[adj.get(th[0])![0]];
    const mainNodes = new Set<number>(), islands = new Set<number>();
    segs.forEach((s, j) => { if (comp[j] === main) s.path.forEach(n => mainNodes.add(n)); else islands.add(comp[j]); });
    if (!islands.size) break;
    const G = new Map<number, Array<[number, number, number | null]>>(), link = (a: number, b: number, d: number, tag: number | null) => { if (!G.has(a)) G.set(a, []); G.get(a)!.push([b, d, tag]); };
    for (const s of segs) for (let k = 1; k < s.path.length; k++) { const a = s.path[k - 1], b = s.path[k], d = dist(a, b); link(a, b, d, null); link(b, a, d, null); }
    extras.forEach((e, i) => {
      if (added.has(i)) return;
      for (let k = 1; k < e.p.length; k++) { const a = e.p[k - 1], b = e.p[k], d = dist(a, b); link(a, b, d, i); link(b, a, d, i); }
    });
    let progress = false;
    for (const c of [...islands].sort((a, b) => a - b)) {
      const src = new Set<number>();
      segs.forEach((s, j) => { if (comp[j] === c) s.path.forEach(n => src.add(n)); });
      const srcList = [...src].sort((a, b) => a - b);
      // shortest path to the main network; extras cost 3x so paths along the existing network win
      const pq = new FlatQueue<number>(), cost = new Map<number, number>(), prev = new Map<number, [number, number | null] | null>(), done = new Set<number>();
      for (const n of srcList) { pq.push(n, 0); cost.set(n, 0); prev.set(n, null); }
      let hit: number | null = null;
      while (pq.length) {
        const u = pq.pop()!;
        if (done.has(u)) continue;
        done.add(u);
        if (mainNodes.has(u)) { hit = u; break; }
        for (const [v, dd, tag] of G.get(u) || []) {
          if (done.has(v)) continue;
          const c = cost.get(u)! + dd * (tag === null ? 1 : 3);
          if (c < (cost.get(v) ?? Infinity)) { cost.set(v, c); prev.set(v, [u, tag]); pq.push(v, c); }
        }
      }
      if (hit === null) continue;
      const need: number[] = [];
      for (let u = hit; prev.get(u); u = prev.get(u)![0]) { const tag = prev.get(u)![1]; if (tag !== null && !need.includes(tag)) need.push(tag); }
      const extLen = need.reduce((s, i) => s + len(extras[i].p), 0);
      if (need.length && extLen <= islandMax) {
        for (const i of need) {
          segs.push(extraSeg(i, extras[i])); added.add(i);
          report.autoAdded.push({ extra: i, name: extras[i].osm?.name || extras[i].osm?.via || null, m: len(extras[i].p) });
        }
        progress = true; break;
      }
    }
    if (!progress) break;
  }

  segs = splitAll(segs);
  const { comp, adj } = components(segs);
  const main = comp[adj.get(th[0])![0]];
  const keep = segs.filter((s, j) => comp[j] === main), drop = segs.filter((s, j) => comp[j] !== main);
  report.kept = { segs: keep.length, m: keep.reduce((s, x) => s + len(x.path), 0) };
  report.dropped = { segs: drop.length, m: drop.reduce((s, x) => s + len(x.path), 0), names: drop.map(s => s.name || '-') };
  report.keptIds = keep.map(s => s.id); report.droppedIds = drop.map(s => s.id);

  // compact output: renumber the nodes the kept segments use
  const used = [...new Set(keep.flatMap(s => s.path))].sort((a, b) => a - b), idx = new Map(used.map((k, i) => [k, i]));
  const outSegs = keep.map(s => ({ p: s.path.map(x => idx.get(x)!), n: s.name || '', k: s.kind, g: s.grade ?? null, gd: s.gradeDown ?? null, o: s.oneway ?? 'no' }));
  const thOut = input.trailheads.slice().sort((a, b) => (N[a.node][2] ?? 0) - (N[b.node][2] ?? 0)).map(t => ({ node: idx.get(t.node)!, name: t.name }));
  const nodes = used.map((k): LatLonEle => [fixed(N[k][0], 6), fixed(N[k][1], 6), N[k][2] == null ? null : fixed(N[k][2], 1)]);
  const lats = nodes.map(n => n[0]), lons = nodes.map(n => n[1]), pad = 0.004;
  const bb = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad * 1.5, Math.max(...lons) + pad * 1.5];
  const ref: RefLine[] = [];
  for (const w of input.ref || []) {
    if (w.c.some(([x, y]) => bb[2] <= x && x <= bb[3] && bb[0] <= y && y <= bb[1])) ref.push({ c: w.c.map(([x, y]): [number, number] => [fixed(x, 5), fixed(y, 5)]), k: w.k });
  }
  return { data: { nodes, segs: outSegs, th: thOut, ref, version }, report };
}

// Split segments at interior nodes that are another segment's endpoint. One pass is enough: a split never adds
// a new endpoint, and the tail it appends is checked when the pass reaches it.
export function splitAll(segs: BuildSeg[]): BuildSeg[] {
  const ends = new Set(segs.flatMap(s => [s.path[0], s.path[s.path.length - 1]]));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let k = 1; k < s.path.length - 1; k++) {
      if (ends.has(s.path[k])) { segs.push({ ...s, path: s.path.slice(k), id: s.id + 'b' }); s.path = s.path.slice(0, k + 1); break; }
    }
  }
  return segs;
}

// Connected components of segments joined at their endpoints. adj: node -> [segment index].
export function components(segs: Array<{ path: number[] }>): { comp: number[]; adj: Map<number, number[]> } {
  const adj = new Map<number, number[]>();
  segs.forEach((s, i) => { for (const n of [s.path[0], s.path[s.path.length - 1]]) { if (!adj.has(n)) adj.set(n, []); adj.get(n)!.push(i); } });
  const comp: number[] = new Array(segs.length); let c = 0;
  for (let i = 0; i < segs.length; i++) {
    if (comp[i] !== undefined) continue;
    const st = [i];
    while (st.length) {
      const j = st.pop()!;
      if (comp[j] !== undefined) continue;
      comp[j] = c;
      for (const n of [segs[j].path[0], segs[j].path[segs[j].path.length - 1]]) st.push(...adj.get(n)!);
    }
    c++;
  }
  return { comp, adj };
}

// x to nd decimal places (nearest, on the exact binary value).
const fixed = (x: number, nd: number): number => Number(x.toFixed(nd));
