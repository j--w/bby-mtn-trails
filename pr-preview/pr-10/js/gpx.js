// GPX tracks against an area's network: which pieces a track follows, and the stretches OpenStreetMap
// doesn't have (to add as drawn paths). Pure functions, no DOM (GPX is read with regular expressions so
// this also runs in Node and workers).

// GPX text -> [{name, pts: [[lat, lon, ele|null]]}], one entry per track segment or route.
export function parseGpx(text) {
  const out = [], num = (s, k) => { const m = s.match(new RegExp(`\\b${k}\\s*=\\s*["']([-+\\d.eE]+)["']`)); return m ? +m[1] : NaN; };
  const name = s => (s.match(/<name>([^<]*)<\/name>/) || [])[1]?.trim() || '';
  const points = (s, tag) => [...s.matchAll(new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g'))].map(m => {
    const ele = (m[2] || '').match(/<ele>\s*([-+\d.eE]+)\s*<\/ele>/);
    return [num(m[1], 'lat'), num(m[1], 'lon'), ele ? +ele[1] : null];
  }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  for (const [, trk] of text.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/g)) {
    const nm = name(trk.replace(/<trkseg[\s\S]*/, ''));
    for (const [, seg] of trk.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)) { const pts = points(seg, 'trkpt'); if (pts.length > 1) out.push({ name: nm, pts }); }
  }
  for (const [, rte] of text.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/g)) { const pts = points(rte, 'rtept'); if (pts.length > 1) out.push({ name: name(rte.replace(/<rtept[\s\S]*/, '')), pts }); }
  return out;
}

const R = 6371000;
function projector(lat0) {
  const kx = Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180), ky = Math.PI / 180 * R;
  return { xy: (lat, lon) => [lon * kx, lat * ky], ll: (x, y) => [y / ky, x / kx] };
}
// segments in metres, bucketed in a grid, for nearest-segment queries
function segIndex(cell) {
  const grid = new Map(), segs = [];
  return {
    add(a, b, ref) {
      const i = segs.push([a, b, ref]) - 1;
      for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
          const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
        }
    },
    // nearest segment within `cell` metres: {d, ref, t}
    near(p) {
      const x0 = Math.floor(p[0] / cell), y0 = Math.floor(p[1] / cell); let best = null;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get((x0 + dx) + ',' + (y0 + dy)) || []) {
        const [a, b, ref] = segs[i], vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
        const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
        const d = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
        if (!best || d < best.d) best = { d, ref, t };
      }
      return best;
    },
  };
}
// points every `step` metres along a polyline of [x, y]
function densify(xy, step) {
  const out = [xy[0]];
  for (let k = 1; k < xy.length; k++) {
    const [a, b] = [xy[k - 1], xy[k]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}
const runLen = pts => { let s = 0; for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return s; };
// Douglas-Peucker on [x, y]
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop(), [a, b] = [pts[i], pts[j]], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1;
    let worst = -1, wd = tol;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((pts[k][0] - a[0]) * vy - (pts[k][1] - a[1]) * vx) / L; if (d > wd) { wd = d; worst = k; } }
    if (worst > 0) { keep[worst] = 1; st.push([i, worst], [worst, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Match tracks to the network.
//   nodes   [[lat, lon, ...]] (the area's raw view, drawn paths included)
//   pieces  [{id, path: [node index], layer}]
//   tracks  [{pts: [[lat, lon]]}]
//   bbox    [s, w, n, e]: track outside it is ignored
// Returns {followed: [{id, layer, len}], gaps: [{pts: [{node|null, lat, lon}], m}], onM, offM}:
// pieces the track runs along for most of their length, and stretches at least `minGap` metres long where
// the track is more than `tol` metres from every piece (ends snapped to a piece node within `snap` metres).
export function matchTrack({ nodes, pieces, tracks, bbox, tol = 20, minGap = 60, snap = 35, cover = 0.7 }) {
  if (!nodes.length) return { followed: [], gaps: [], onM: 0, offM: 0 };
  const P = projector(nodes[0][0]), XY = nodes.map(n => P.xy(n[0], n[1]));
  const inBox = ([lat, lon]) => !bbox || (lat >= bbox[0] && lat <= bbox[2] && lon >= bbox[1] && lon <= bbox[3]);
  const net = segIndex(Math.max(tol, snap) * 2), trk = segIndex(tol * 2);
  for (const p of pieces) for (let k = 1; k < p.path.length; k++) net.add(XY[p.path[k - 1]], XY[p.path[k]], [p, k]);
  const runs = [];
  let onM = 0, offM = 0;
  for (const t of tracks) {
    // split at points outside the box, then densify
    let part = [];
    const flush = () => { if (part.length > 1) runs.push(densify(part, 8)); part = []; };
    for (const p of t.pts) { if (inBox(p)) part.push(P.xy(p[0], p[1])); else flush(); }
    flush();
  }
  for (const r of runs) for (let k = 1; k < r.length; k++) trk.add(r[k - 1], r[k], null);

  // pieces the track follows
  const followed = [];
  for (const p of pieces) {
    const xy = densify(p.path.map(n => XY[n]), 8);
    let hit = 0; for (const q of xy) { const m = trk.near(q); if (m && m.d <= tol) hit++; }
    if (hit / xy.length >= cover) followed.push({ id: p.id, layer: p.layer, len: runLen(p.path.map(n => XY[n])) });
  }

  // stretches away from every piece: off when > tol, back on when < tol * 0.6
  const gaps = [];
  const nearNode = q => {
    const m = net.near(q); if (!m || m.d > snap) return null;
    const [p, k] = m.ref, a = p.path[k - 1], b = p.path[k];
    const da = Math.hypot(XY[a][0] - q[0], XY[a][1] - q[1]), db = Math.hypot(XY[b][0] - q[0], XY[b][1] - q[1]);
    const n = da <= db ? a : b; return Math.min(da, db) <= snap ? n : null;
  };
  for (const r of runs) {
    let off = false, start = 0;
    const d = r.map(q => net.near(q)?.d ?? Infinity);
    for (let k = 0; k <= r.length; k++) {
      const end = k === r.length;
      if (!end && k > 0) { const s = Math.hypot(r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1]); if (d[k] > tol) offM += s; else onM += s; }
      if (!off && !end && d[k] > tol) { off = true; start = Math.max(0, k - 1); }
      else if (off && (end || d[k] < tol * 0.6)) {
        off = false;
        const stretch = r.slice(start, Math.min(k + 1, r.length));
        if (runLen(stretch) >= minGap) {
          const ends = [nearNode(stretch[0]), nearNode(stretch[stretch.length - 1])];
          const xy = simplify(stretch, 4);
          const pts = xy.map((q, j) => {
            const node = j === 0 ? ends[0] : j === xy.length - 1 ? ends[1] : null;
            const [lat, lon] = node != null ? [nodes[node][0], nodes[node][1]] : P.ll(q[0], q[1]);
            return { node, lat, lon };
          });
          gaps.push({ pts, m: runLen(xy) });
        }
      }
    }
  }
  return { followed, gaps, onM, offM };
}
