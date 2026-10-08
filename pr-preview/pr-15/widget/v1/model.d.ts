import type { RouteStats, routeGeometry, SolveParams, LongestParams } from '../../js/router-core.js';
import type { LatLonEle, RouterData } from '../../js/types.js';
/** An area file (`.trails.json`) made on the setup page. Treat it as opaque: store it, pass it back in. */
export interface AreaPackage {
    readonly format: 'trail-area';
    readonly version: number;
    readonly name: string;
    /** [south, west, north, east] */
    readonly bbox: readonly [number, number, number, number];
    /** Credits the widget shows (OpenStreetMap, the elevation source). */
    readonly attribution: readonly string[];
}
export interface LoadedArea extends AreaPackage {
    readonly data: RouterData;
}
export interface Trailhead {
    /** Its position ("49.27800,-122.91700"): stays the same when the area is edited and saved again. */
    id: string;
    name: string;
    at: [lat: number, lon: number];
    /** metres, approximate */
    ele: number;
}
export interface TrailheadNode extends Trailhead {
    node: number;
}
export type RouteMode = 'target' | 'longest';
export type PavedPreference = 'fine' | 'avoid' | 'avoid-strongly';
/** The inputs of a search. The same area + params (seed included) always gives the same routes. */
export interface RouteParams {
    /** Default 'target'. */
    mode: RouteMode;
    /** Target mode. 3000–80000. Default 21000. */
    distance: number;
    /** Target mode. 0–5000. Default 900. */
    climb: number;
    /** Trailhead id. Default: the area's first trailhead. */
    start: string;
    /** Target mode. Default 'avoid'. */
    paved: PavedPreference;
    /** Target mode. Come back through the start about every this many metres (aid stops); 0 = no need. Default 0. */
    lap: number;
    /** Default 4821. "New variations" picks a new one. */
    seed: number;
}
export interface RoutePoint {
    lat: number;
    lon: number;
    /** metres, approximate */
    ele: number;
    /** distance along the route */
    at: number;
    /** 0-based lap */
    lap: number;
}
export interface Route {
    /** 'A' | 'B' | 'C' in target mode; 'no-repeats' | 'skip-dead-ends' | 'every-trail' in longest mode. */
    id: string;
    /** 'Option A', or 'No repeats' etc. */
    label: string;
    /** Longest mode: what the option means. Empty in target mode. */
    description: string;
    distance: number;
    /** Approximate: from LiDAR or terrain tiles, smoothed. */
    climb: number;
    /** Metres run more than once. */
    repeated: number;
    /** Metres on roads, sidewalks and paved paths. */
    paved: number;
    laps: number;
    /** From prefs.pace (default 6:30/km) plus 4 s per metre of climb. */
    estimatedTime: number;
    start: Trailhead;
    points: RoutePoint[];
    /** Everything needed to rebuild this exact route. Store this rather than the points. */
    params: RouteParams;
    /** GPX 1.1 text. Default name: area, distance, climb and option. */
    gpx(name?: string): string;
}
export type WidgetErrorCode = 'area-unreadable' | 'area-not-routable' | 'invalid-params' | 'no-route' | 'search-failed' | 'map-unavailable';
export declare class WidgetError extends Error {
    readonly code: WidgetErrorCode;
    constructor(code: WidgetErrorCode, message: string);
}
/** Check and read an area file (JSON text or a parsed object). Throws a WidgetError ('area-unreadable' or
 *  'area-not-routable') with a message you can show. */
export declare function readArea(json: string | unknown): AreaPackage;
export declare function trailheadList(area: LoadedArea): TrailheadNode[];
/** The area's trailheads, for your own picker or a saved favourite. */
export declare function trailheads(area: AreaPackage): Trailhead[];
export declare const PAVED: Record<PavedPreference, number>;
export declare const DEFAULTS: Omit<RouteParams, 'start'>;
export declare function resolveParams(th: Trailhead[], p?: Partial<RouteParams>, base?: Partial<RouteParams>): RouteParams;
export declare function problem(p: RouteParams): string | null;
export declare function solverParams(p: RouteParams, startJ: number): SolveParams | (LongestParams & {
    mode: 'longest';
});
export interface WorkerRoute {
    label: string;
    desc: string;
    s: RouteStats;
    laps: number;
    geom: ReturnType<typeof routeGeometry>;
}
export declare function toRoute(raw: WorkerRoute, i: number, { area, nodes, params, start, pace }: {
    area: AreaPackage;
    nodes: LatLonEle[];
    params: RouteParams;
    start: Trailhead;
    pace?: number;
}): Route;
export declare function gpxText(points: RoutePoint[], name: string, areaName: string): string;
export declare function fmtTime(sec: number): string;
