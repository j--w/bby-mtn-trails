// Web Worker wrapper around router-core.js.
importScripts('router-core.js');
self.onmessage = e => {
  if(e.data.graph){ setGraph(e.data.graph); return; }
  const p = e.data.params;
  const res = p.mode === 'longest' ? solveLongest(p) : solve(p);
  self.postMessage({ id: e.data.id, res });
};
