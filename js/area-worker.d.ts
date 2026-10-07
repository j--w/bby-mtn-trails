import type { CompiledArea, Edits, Suggestion } from './area-package.js';
import type { Layer, PieceState, RawNetwork } from './osm.js';
import type { RouterData } from './types.js';
/** Messages to the worker: the raw network (once, and again when it changes), then edits to compile. */
export type AreaWorkerRequest = {
    raw: RawNetwork;
} | {
    raw?: undefined;
    id: number;
    edits: Edits;
    withPieces?: boolean;
};
/** A piece as the page draws it (sent when withPieces is set). */
export interface WorkerPiece {
    id: string;
    way: number | string;
    path: number[];
    layer: Layer;
    len: number;
    name: string;
    hw: string;
}
/** The worker's answer to a request with that id, or the error it hit. */
export type AreaWorkerResponse = {
    id: number;
    states: Record<string, PieceState | undefined>;
    pieces: WorkerPiece[] | null;
    data: RouterData | null;
    suggestions: Suggestion[];
    provisional: boolean;
    trailheads: CompiledArea['trailheads'];
    joins: CompiledArea['joins'];
    snaps: Array<[number, number]>;
    keptM: number;
} | {
    id: number;
    error: string;
};
