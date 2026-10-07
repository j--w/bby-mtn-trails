// Module Web Worker for the setup page: compiles the area and finds connector suggestions off the main thread.
import { compileArea, suggestConnectors } from './area-package.js';
import type { CompiledArea, Edits, Suggestion } from './area-package.js';
import type { Layer, PieceState, RawNetwork } from './osm.js';
import type { RouterData } from './types.js';

/** Messages to the worker: the raw network (once, and again when it changes), then edits to compile. */
export type AreaWorkerRequest = { raw: RawNetwork } | { raw?: undefined; id: number; edits: Edits; withPieces?: boolean };
/** A piece as the page draws it (sent when withPieces is set). */
export interface WorkerPiece { id: string; way: number | string; path: number[]; layer: Layer; len: number; name: string; hw: string }
/** The worker's answer to a request with that id, or the error it hit. */
export type AreaWorkerResponse = {
  id: number; states: Record<string, PieceState | undefined>; pieces: WorkerPiece[] | null; data: RouterData | null;
  suggestions: Suggestion[]; provisional: boolean; trailheads: CompiledArea['trailheads']; joins: CompiledArea['joins'];
  snaps: Array<[number, number]>; keptM: number;
} | { id: number; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<AreaWorkerRequest>) => void) | null; postMessage(m: AreaWorkerResponse): void };
let raw: RawNetwork | null = null;
ctx.onmessage = e => {
  const m = e.data;
  if (m.raw) { raw = m.raw; return; }
  try {
    // raw comes first; if it didn't, compileArea throws and the page gets the error below
    const compiled = compileArea(raw!, m.edits);
    const suggestions = suggestConnectors(raw!, compiled, m.edits);
    const states = Object.fromEntries(compiled.pieces.map(p => [p.id, p.state]));
    const pieces = m.withPieces ? compiled.pieces.map(({ id, way, path, layer, len, tags }) => ({ id, way, path, layer, len, name: tags.name || '', hw: tags.highway })) : null;
    const r = compiled.report;
    ctx.postMessage({ id: m.id, states, pieces, data: compiled.data, suggestions, provisional: compiled.provisional,
      trailheads: compiled.trailheads, joins: compiled.joins,
      snaps: r ? r.snapped.map(s => s.nodes) : [], keptM: r ? r.kept.m : 0 });
  } catch (err: any) {
    ctx.postMessage({ id: m.id, error: err.message });
  }
};
