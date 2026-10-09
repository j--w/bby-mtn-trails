import type { LatLonEle } from './types.js';
import type { BBox, Layer } from './osm.js';
/** One GPX track segment or route. */
export interface GpxTrack {
    name: string;
    pts: LatLonEle[];
}
/** A point with lat and lon first (anything after them is ignored). */
export type LatLonLike = [number, number, ...unknown[]];
/** What matchTrack needs of a piece. */
export interface MatchPiece {
    id: string;
    path: number[];
    layer: Layer;
}
export interface MatchInput {
    nodes: LatLonLike[];
    pieces: MatchPiece[];
    tracks: Array<{
        pts: LatLonLike[];
    }>;
    bbox?: BBox | null;
    tol?: number;
    minGap?: number;
    snap?: number;
    cover?: number;
}
/** A gap point: snapped to a network node (ends only) or free. */
export interface GapPoint {
    node: number | null;
    lat: number;
    lon: number;
}
export interface TrackGap {
    pts: GapPoint[];
    m: number;
}
export interface TrackMatch {
    followed: Array<{
        id: string;
        layer: Layer;
        len: number;
    }>;
    gaps: TrackGap[];
    onM: number;
    offM: number;
}
export declare function parseGpx(text: string): GpxTrack[];
export declare function matchTrack({ nodes, pieces, tracks, bbox, tol, minGap, snap, cover }: MatchInput): TrackMatch;
