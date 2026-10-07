import type { LatLonEle } from './types.js';
import type { BuildSeg, Extra, RefLine } from './area-build.js';
/** [south, west, north, east] in degrees. */
export type BBox = [number, number, number, number];
export type OsmTags = Record<string, string>;
/** 'trail' is included by default, 'road' is a connector candidate. */
export type Layer = 'trail' | 'road';
/** A way of the raw network; drawn paths (see area-package withDrawn) have string ids. */
export interface RawWay {
    id: number | string;
    path: number[];
    tags: OsmTags;
    layer: Layer;
}
export interface Poi {
    id: number;
    lat: number;
    lon: number;
    kind: string;
    name: string;
}
/** The raw OSM network parseOsm makes: nodes shared between ways, with their OSM ids (or drawn keys) when known. */
export interface RawNetwork {
    nodes: LatLonEle[];
    osmNodes?: Array<number | string | null>;
    ways: RawWay[];
    pois?: Poi[];
}
/** A run of a way between junctions; id is `<way id>/<key of its first node>`. */
export interface Piece {
    id: string;
    way: number | string;
    path: number[];
    tags: OsmTags;
    layer: Layer;
}
/** A piece after the draft: its length (m), whether it's chosen, and (after compileArea) its state. */
export interface DraftPiece extends Piece {
    len: number;
    included: boolean;
    stub?: boolean;
    state?: PieceState;
}
export type PieceState = 'in' | 'cut' | 'auto' | 'off';
/** An unchosen piece offered to the build. */
export interface PieceExtra extends Extra {
    piece: string;
}
/** buildRouterData's input minus trailheads, as toBuildInput makes it. */
export interface NetworkInput {
    nodes: LatLonEle[];
    segs: BuildSeg[];
    extras: PieceExtra[];
    added: number[];
    ref: RefLine[];
}
export interface Draft extends NetworkInput {
    pieces: DraftPiece[];
}
export interface FetchOsmOptions {
    fetch?: typeof globalThis.fetch;
    servers?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface DraftOptions {
    stubMax?: number;
    overrides?: Record<string, boolean>;
    breaks?: Set<number>;
}
export declare const OVERPASS_SERVERS: string[];
export declare function overpassQuery([s, w, n, e]: BBox, timeout?: number): string;
export declare function bboxKm2([s, w, n, e]: BBox): number;
export declare function fetchOsm(bbox: BBox, { fetch, servers, timeoutMs, signal }?: FetchOsmOptions): Promise<any>;
export declare function classifyWay(t: OsmTags): Layer | null;
export declare const isPaved: (t: OsmTags) => boolean;
export declare function parseOsm(json: any): RawNetwork;
export declare const nodeKey: (raw: Pick<RawNetwork, 'osmNodes'>, i: number) => string;
export declare function nodeIndex(raw: RawNetwork): Map<string, number>;
export declare function splitWays(ways: RawWay[], { breaks, key }?: {
    breaks?: Set<number>;
    key?: (n: number) => string;
}): Piece[];
export declare function draftNetwork(raw: RawNetwork, { stubMax, overrides, breaks }?: DraftOptions): Draft;
export declare function toBuildInput(raw: RawNetwork, pieces: DraftPiece[]): NetworkInput;
