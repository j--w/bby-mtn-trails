import type { LatLonEle, Oneway, RouterData, SegKind } from './types.js';
/** A segment of the curated network (the build's input and working form). */
export interface BuildSeg {
    id: string;
    path: number[];
    name: string;
    kind: SegKind;
    grade: number | null;
    gradeDown: number | null;
    oneway: Oneway;
}
/** OSM facts about an extra: conn is a road, paved the paved share (0-1), imba the trail grade. */
export interface ExtraOsm {
    name?: string;
    via?: string;
    conn?: boolean;
    paved?: number;
    imba?: number | null;
}
/** A candidate piece the build may add. */
export interface Extra {
    p: number[];
    osm?: ExtraOsm;
}
/** A background reference line, [lon, lat] points. */
export interface RefLine {
    c: Array<[number, number]>;
    k: string;
}
export interface Trailhead {
    node: number;
    name: string;
}
export interface BuildInput {
    nodes: LatLonEle[];
    segs: BuildSeg[];
    trailheads: Trailhead[];
    extras?: Extra[];
    added?: number[];
    ref?: RefLine[];
}
export interface BuildOptions {
    snapTol?: number;
    fillMax?: number;
    islandMax?: number;
    version?: string;
    splitAtTrailheads?: boolean;
}
/** An extra the build pulled in, by index. */
export interface AddedExtra {
    extra: number;
    name: string | null;
    m: number;
}
/** What the build did, for the setup page. */
export interface BuildReport {
    snapped: Array<{
        at: [number, number];
        m: number;
        nodes: [number, number];
    }>;
    closed: AddedExtra[];
    autoAdded: AddedExtra[];
    kept: {
        segs: number;
        m: number;
    };
    dropped: {
        segs: number;
        m: number;
        names: string[];
    };
    keptIds: string[];
    droppedIds: string[];
}
export declare function buildRouterData(input: BuildInput, opts?: BuildOptions): {
    data: RouterData;
    report: BuildReport;
};
export interface EditorFile {
    _editor: {
        segs: BuildSeg[];
        added?: number[];
        nodes: Record<string, {
            type?: string;
            name: string;
        }>;
    };
}
export interface EditorBase {
    nodes: LatLonEle[];
    extras: Extra[];
    ref: RefLine[];
}
export declare function inputFromEditor(curated: EditorFile, editorBase: EditorBase): BuildInput;
export declare function splitAll(segs: BuildSeg[]): BuildSeg[];
export declare function components(segs: Array<{
    path: number[];
}>): {
    comp: number[];
    adj: Map<number, number[]>;
};
export declare function pyRound(x: number, nd: number): number;
