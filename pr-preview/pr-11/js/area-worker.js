// Module Web Worker for the setup page: compiles the area and finds connector suggestions off the main thread.
import { compileArea, suggestConnectors } from './area-package.js';

let raw = null;
self.onmessage = e => {
  const m = e.data;
  if (m.raw) { raw = m.raw; return; }
  try {
    const compiled = compileArea(raw, m.edits);
    const suggestions = suggestConnectors(raw, compiled, m.edits);
    const states = Object.fromEntries(compiled.pieces.map(p => [p.id, p.state]));
    const pieces = m.withPieces ? compiled.pieces.map(({ id, way, path, layer, len, tags }) => ({ id, way, path, layer, len, name: tags.name || '', hw: tags.highway })) : null;
    const r = compiled.report;
    self.postMessage({ id: m.id, states, pieces, data: compiled.data, suggestions, provisional: compiled.provisional,
      trailheads: compiled.trailheads, joins: compiled.joins,
      snaps: r ? r.snapped.map(s => s.nodes) : [], keptM: r ? r.kept.m : 0 });
  } catch (err) {
    self.postMessage({ id: m.id, error: err.message });
  }
};
