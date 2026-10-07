// Area build: a curated trail network -> the compact routing graph the route builder loads.
// Pure functions, no DOM. A port of scripts/build_router_data.py that produces the same output for the same
// input (tests/area-build.test.mjs checks this against site/data/burnaby-mountain.json).
//
// Steps: keep the curated segments, join dead ends that nearly touch (< snapTol m), fill dead ends with short
// unadded extras (<= fillMax m), connect islands through short extras (<= islandMax m in total), split at shared
// nodes, keep the component that holds the first trailhead, then write nodes/segs/th/ref.

const R = 6371000;

// Input
//   nodes      [[lat, lon, ele], ...]                    every node the segments and extras refer to
//   segs       [{id, path:[node], name, kind, grade, gradeDown, oneway}]   the curated network
//   trailheads [{node, name}]                            routing starts; the first one picks the kept component
//   extras     [{p:[node], osm:{name, via, conn, paved, imba}}]            candidate pieces the build may add
//   added      [extra index]                             extras the curated network already contains
//   ref        [{c:[[lon, lat]], k}]                     background reference lines
export function buildRouterData(input, opts = {}) {
  const { snapTol = 8, fillMax = 30, islandMax = 80, version = '' } = opts;
  const N = input.nodes, extras = input.extras || [];
  const th = input.trailheads.map(t => t.node), thSet = new Set(th);
  const lat0 = N[0][0] * Math.PI / 180, cos0 = Math.cos(lat0);
  // same evaluation order as the Python so lengths match to the last bit
  const X = N.map(n => n[1] * Math.PI / 180 * R * cos0), Y = N.map(n => n[0] * Math.PI / 180 * R);
  const dist = (a, b) => Math.hypot(X[a] - X[b], Y[a] - Y[b]);
  const len = p => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
  const first = p => p[0], last = p => p[p.length - 1];
  const extraSeg = (i, e) => {
    const o = e.osm || {};
    return { id: 'x' + i, path: e.p.slice(), name: o.name ?? '', kind: o.conn || (o.paved || 0) >= 0.6 ? 'connector' : 'trail',
      grade: o.imba ?? null, gradeDown: null, oneway: 'no' };
  };
  let segs = input.segs.map(s => ({ ...s, path: s.path.slice() }));
  const added = new Set(input.added || []);
  const report = {};

  const degrees = () => {
    const deg = new Map();
    for (const s of segs) for (const n of [first(s.path), last(s.path)]) deg.set(n, (deg.get(n) || 0) + 1);
    return deg;
  };

  // join dead ends that sit within a few metres of another segment (OSM ways that nearly touch)
  report.snapped = [];
  for (let round = 0; round < 3; round++) {
    const deg = degrees();
    let made = false;
    for (const s of segs.slice()) {
      for (const end of [first(s.path), last(s.path)]) {
        if (deg.get(end) !== 1 || thSet.has(end)) continue;
        let best = null;
        for (const t of segs) {
          if (t === s) continue;
          for (const n of t.path) {
            const d = dist(end, n);
            if (d < snapTol && (best === null || d < best.d)) best = { d, n };
          }
        }
        if (best) {
          segs.push({ id: 'snap' + report.snapped.length, path: [end, best.n], name: '', kind: 'connector', grade: null, gradeDown: null, oneway: 'no' });
          report.snapped.push({ at: N[end].slice(0, 2), m: best.d });
          deg.set(end, deg.get(end) + 1); deg.set(best.n, (deg.get(best.n) || 0) + 1); made = true;
        }
      }
    }
    if (!made) break;
  }

  // close dead ends with a short unadded extra that leads to another part of the network
  // (like the Python, this pass keeps its own copy of `added`; the island pass below doesn't see these)
  report.closed = [];
  const closedSet = new Set(added);
  for (let round = 0; round < 3; round++) {
    const deg = degrees(), netn = new Set();
    for (const s of segs) for (const n of s.path) netn.add(n);
    let made = false;
    extras.forEach((e, i) => {
      if (closedSet.has(i) || len(e.p) > fillMax) return;
      const a = first(e.p), b = last(e.p);
      if ((deg.get(a) === 1 && netn.has(b)) || (deg.get(b) === 1 && netn.has(a))) {
        segs.push(extraSeg(i, e)); closedSet.add(i);
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
    const main = comp[adj.get(th[0])[0]];
    const mainNodes = new Set(), islands = new Set();
    segs.forEach((s, j) => { if (comp[j] === main) s.path.forEach(n => mainNodes.add(n)); else islands.add(comp[j]); });
    if (!islands.size) break;
    const G = new Map(), link = (a, b, d, tag) => { if (!G.has(a)) G.set(a, []); G.get(a).push([b, d, tag]); };
    for (const s of segs) for (let k = 1; k < s.path.length; k++) { const a = s.path[k - 1], b = s.path[k], d = dist(a, b); link(a, b, d, null); link(b, a, d, null); }
    extras.forEach((e, i) => {
      if (added.has(i)) return;
      for (let k = 1; k < e.p.length; k++) { const a = e.p[k - 1], b = e.p[k], d = dist(a, b); link(a, b, d, i); link(b, a, d, i); }
    });
    let progress = false;
    for (const c of [...islands].sort((a, b) => a - b)) {
      const src = new Set();
      segs.forEach((s, j) => { if (comp[j] === c) s.path.forEach(n => src.add(n)); });
      const srcList = [...src].sort((a, b) => a - b);
      const pq = srcList.map(n => [0, 0, n]), prev = new Map(srcList.map(n => [n, null])), done = new Set();
      let hit = null;
      while (pq.length) {
        const [cost, d, u] = heapPop(pq);
        if (done.has(u)) continue;
        done.add(u);
        if (mainNodes.has(u)) { hit = u; break; }
        for (const [v, dd, tag] of G.get(u) || []) {
          if (done.has(v)) continue;
          heapPush(pq, [cost + dd * (tag === null ? 1 : 3), d + dd, v]);
          if (!prev.has(v)) prev.set(v, [u, tag]);
        }
      }
      if (hit === null) continue;
      const need = [];
      for (let u = hit; prev.get(u); u = prev.get(u)[0]) { const tag = prev.get(u)[1]; if (tag !== null && !need.includes(tag)) need.push(tag); }
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
  const main = comp[adj.get(th[0])[0]];
  const keep = segs.filter((s, j) => comp[j] === main), drop = segs.filter((s, j) => comp[j] !== main);
  report.kept = { segs: keep.length, m: keep.reduce((s, x) => s + len(x.path), 0) };
  report.dropped = { segs: drop.length, m: drop.reduce((s, x) => s + len(x.path), 0), names: drop.map(s => s.name || '-') };

  // compact output: renumber the nodes the kept segments use
  const used = [...new Set(keep.flatMap(s => s.path))].sort((a, b) => a - b), idx = new Map(used.map((k, i) => [k, i]));
  const outSegs = keep.map(s => ({ p: s.path.map(x => idx.get(x)), n: s.name || '', k: s.kind, g: s.grade ?? null, gd: s.gradeDown ?? null, o: s.oneway ?? 'no' }));
  const thOut = input.trailheads.slice().sort((a, b) => N[a.node][2] - N[b.node][2]).map(t => ({ node: idx.get(t.node), name: t.name }));
  const nodes = used.map(k => [pyRound(N[k][0], 6), pyRound(N[k][1], 6), pyRound(N[k][2], 1)]);
  const lats = nodes.map(n => n[0]), lons = nodes.map(n => n[1]), pad = 0.004;
  const bb = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad * 1.5, Math.max(...lons) + pad * 1.5];
  const ref = [];
  for (const w of input.ref || []) {
    if (w.c.some(([x, y]) => bb[2] <= x && x <= bb[3] && bb[0] <= y && y <= bb[1])) ref.push({ c: w.c.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)]), k: w.k });
  }
  return { data: { nodes, segs: outSegs, th: thOut, ref, version }, report };
}

// Adapter for today's files: the editor's Export JSON (curated.json) + the editor base data.
export function inputFromEditor(curated, editorBase) {
  const S = curated._editor;
  return {
    nodes: editorBase.nodes, segs: S.segs, extras: editorBase.extras, added: S.added || [], ref: editorBase.ref,
    trailheads: Object.entries(S.nodes).filter(([, v]) => v.type === 'trailhead').map(([k, v]) => ({ node: Number(k), name: v.name })),
  };
}

// Split segments at interior nodes that are another segment's endpoint.
export function splitAll(segs) {
  for (let changed = true; changed;) {
    changed = false;
    const ends = new Set(segs.flatMap(s => [s.path[0], s.path[s.path.length - 1]]));
    outer: for (const s of segs) {
      for (let k = 1; k < s.path.length - 1; k++) {
        if (ends.has(s.path[k])) {
          segs.push({ ...s, path: s.path.slice(k), id: s.id + 'b' });
          s.path = s.path.slice(0, k + 1); changed = true; break outer;
        }
      }
    }
  }
  return segs;
}

// Connected components of segments joined at their endpoints. adj: node -> [segment index].
export function components(segs) {
  const adj = new Map();
  segs.forEach((s, i) => { for (const n of [s.path[0], s.path[s.path.length - 1]]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(i); } });
  const comp = new Array(segs.length); let c = 0;
  for (let i = 0; i < segs.length; i++) {
    if (comp[i] !== undefined) continue;
    const st = [i];
    while (st.length) {
      const j = st.pop();
      if (comp[j] !== undefined) continue;
      comp[j] = c;
      for (const n of [segs[j].path[0], segs[j].path[segs[j].path.length - 1]]) st.push(...adj.get(n));
    }
    c++;
  }
  return { comp, adj };
}

// Binary heap of [cost, dist, node] tuples, ordered like Python's heapq (ties broken by the next field).
const less = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
function heapPush(h, item) {
  let pos = h.length; h.push(item);
  while (pos > 0) { const p = (pos - 1) >> 1; if (!less(item, h[p])) break; h[pos] = h[p]; pos = p; }
  h[pos] = item;
}
function heapPop(h) {
  const lastItem = h.pop();
  if (!h.length) return lastItem;
  const top = h[0];
  // Python's _siftup: walk the smaller child to a leaf, then sift the moved item back up
  let pos = 0; const end = h.length;
  let child = 1;
  while (child < end) { const r = child + 1; if (r < end && !less(h[child], h[r])) child = r; h[pos] = h[child]; pos = child; child = 2 * pos + 1; }
  h[pos] = lastItem;
  while (pos > 0) { const p = (pos - 1) >> 1; if (!less(lastItem, h[p])) break; h[pos] = h[p]; pos = p; }
  h[pos] = lastItem;
  return top;
}

// Python's round(x, nd): round half to even on the exact binary value.
export function pyRound(x, nd) {
  const exact = Math.abs(x).toFixed(Math.min(100, nd + 60));
  const [ip, fp] = exact.split('.');
  const keep = fp.slice(0, nd), rest = fp.slice(nd);
  const half = '5'.padEnd(rest.length, '0');
  let up = rest > half || (rest === half && Number((nd ? keep : ip).slice(-1)) % 2 === 1);
  const digits = ip + keep;
  let n = BigInt(digits) + (up ? 1n : 0n);
  const s = n.toString().padStart(nd + 1, '0');
  const v = Number(nd ? s.slice(0, -nd) + '.' + s.slice(-nd) : s);
  return x < 0 ? -v : v;
}
