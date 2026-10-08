// Module Web Worker for the route builder: holds the area's graph and runs the searches off the main thread.
// The widget inlines this module, bundled, as a blob (scripts/build.mjs), so it needs no file of its own at runtime.
import { buildGraph, setGraph, workerGraph, solve, solveLongest, reachableKm, routeGeometry } from './router-core.js';
import type { RouterData } from './types.js';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void };
let graph: ReturnType<typeof buildGraph> | null = null, nodes: RouterData['nodes'] | null = null;
ctx.onmessage = e => {
  const m = e.data;
  if (m.type === 'area') {
    nodes = m.data.nodes; graph = buildGraph(m.data); setGraph(workerGraph(graph));
    const g = graph;
    ctx.postMessage({ type: 'ready', id: m.id, km: g.edges.reduce((a, x) => a + x.len, 0) / 1000, starts: m.data.th.map(t => g.J(t.node)) });
  } else if (m.type === 'search') {
    try {
      const p = m.params, g = graph!, res = p.mode === 'longest' ? solveLongest(p) : solve(p);
      ctx.postMessage({ type: 'routes', id: m.id, reach: p.mode === 'longest' ? reachableKm(p.start, p.maxg, g.edges, g.adj) : 0,
        routes: res.map(r => ({ label: r.label || '', desc: r.desc || '', s: r.s, laps: r.laps || 1, geom: routeGeometry(r, g.edges, nodes!) })) });
    } catch (err: any) { ctx.postMessage({ type: 'routes', id: m.id, error: String(err && err.message || err) }); }
  }
};
