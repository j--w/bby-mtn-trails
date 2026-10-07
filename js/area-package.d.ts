import type { BuildReport, Trailhead } from './area-build.js';
import type { BBox, DraftPiece, Layer, OsmTags, RawNetwork } from './osm.js';
import type { RouterData, SegKind } from './types.js';
export declare const FORMAT: 'trail-area';
export declare const FORMAT_VERSION = 1;
export declare const OSM_ATTRIBUTION = "Map data \u00A9 OpenStreetMap contributors, ODbL";
/** A drawn path's point: a node key, or [lat, lon, ele]. */
export type DrawnPoint = string | [number, number, (number | null)?];
export interface DrawnPath {
    id: string;
    name?: string;
    pts: DrawnPoint[];
}
/** The user's edits to an area, keyed by OSM ids (see above). */
export interface Edits {
    pieces: Record<string, boolean>;
    splits: string[];
    joins: Array<[string, string]>;
    trailheads: Array<{
        node: string;
        name?: string;
    }>;
    dismissed: string[];
    drawn: DrawnPath[];
}
/** compileArea's result: joins and trailheads as node indices of the raw network (drawn paths included). */
export interface CompiledArea {
    pieces: DraftPiece[];
    data: RouterData | null;
    report: BuildReport | null;
    joins: Array<[number, number]>;
    trailheads: Trailhead[];
    provisional: boolean;
}
/** A suggested connector: the unused pieces to add, their length and the metres of trail they join. */
export interface Suggestion {
    id: string;
    pieces: string[];
    m: number;
    joins: number;
    kind: 'island' | 'dead-end';
}
/** Elevation facts saved with a package: points per source, smoothing window (m), credits. */
export interface ElevationInfo {
    sources?: Record<string, number>;
    smoothing?: number | null;
    attribution?: string[];
}
/** An area file (`.trails.json`). */
export interface AreaPackage {
    format: typeof FORMAT;
    version: number;
    name: string;
    bbox: BBox;
    created: string;
    osmTimestamp: string | null;
    attribution: string[];
    elevation: {
        sources: Record<string, number>;
        smoothing: number | null;
    };
    osm: RawNetwork;
    edits: Edits;
    data: RouterData | null;
}
export interface MakePackageInput {
    name: string;
    bbox: BBox;
    raw: RawNetwork;
    edits: Edits;
    compiled: Pick<CompiledArea, 'data'>;
    elevation?: ElevationInfo;
    osmTimestamp?: string | null;
    created?: string;
}
export declare const emptyEdits: () => Edits;
export declare function withDrawn(raw: RawNetwork, drawn?: DrawnPath[]): RawNetwork;
export declare function compileArea(raw: RawNetwork, edits?: Edits, opts?: {
    version?: string;
}): CompiledArea;
export declare function suggestConnectors(raw: RawNetwork, compiled: CompiledArea, edits?: Edits, { maxM, deadEndM }?: {
    maxM?: number;
    deadEndM?: number;
}): Suggestion[];
export declare function makePackage({ name, bbox, raw, edits, compiled, elevation, osmTimestamp, created }: MakePackageInput): AreaPackage;
export declare function readPackage(json: unknown): AreaPackage & {
    data: RouterData;
};
export declare const keyOf: (raw: RawNetwork, i: number) => string;
export declare const pieceKind: (p: {
    layer: Layer;
    tags: OsmTags;
}) => SegKind;
