import type { RouterData, LatLonEle, SegKind, Oneway } from './types.js';
/** A graph edge: one segment between junctions a and b. */
export interface Edge {
    a: number;
    b: number;
    len: number;
    up: number;
    dn: number;
    g: number | null;
    gd: number | null;
    k: SegKind;
    o: Oneway;
    n?: string;
    p?: number[];
}
/** Travelling edge e from junction `from` to `to` (dir 1 along the segment, -1 against it). */
export interface Turn {
    e: number;
    dir: 1 | -1;
    from: number;
    to: number;
}
export interface Graph {
    edges: Edge[];
    adj: Turn[][];
    inc: Turn[][];
}
export interface FullGraph extends Graph {
    jnodes: number[];
    J: (node: number) => number;
}
/** A route as steps of [edge, dir]; bounds are the step indices where each lap starts. */
export type Step = [number, 1 | -1];
export interface RouteStats {
    dist: number;
    gain: number;
    loss: number;
    rep: number;
    paved: number;
    uturn: number;
}
export interface RawRoute {
    steps: Step[];
    bounds: number[];
    s: RouteStats;
    laps: number;
    label?: string;
    desc?: string;
}
/** Target-mode search params: D metres, E metres of climb, lap km (0 = none), pavedW the paved penalty. */
export interface SolveParams {
    start: number;
    D: number;
    E: number;
    maxg: number;
    late: number;
    lap: number;
    pavedW: number;
    seed: number;
    hAll?: Float64Array;
    hLate?: Float64Array;
}
export interface LongestParams {
    start: number;
    maxg: number;
}
export declare function setGraph(g: Graph): void;
export declare function buildGraph(DATA: RouterData): FullGraph;
export declare function workerGraph({ edges, adj, inc }: Graph): Graph;
export declare function routeGeometry(r: {
    steps: Step[];
    bounds: number[];
}, edges: Edge[], nodes: LatLonEle[]): {
    pts: {
        n: number;
        cum: number;
        lap: number;
    }[];
    cuts: number[];
};
export declare function reachableKm(start: number, maxg: number, edges: Edge[], adj: Turn[][]): number;
export declare function solveLongest(p: LongestParams): RawRoute[];
export declare function solve(p: SolveParams): RawRoute[];
