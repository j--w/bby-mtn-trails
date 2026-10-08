// Data shapes shared by the modules: the compact routing graph an area carries, and the route search's graph.

/** [lat, lon, ele]: ele is metres, null where no elevation source covered the point. */
export type LatLonEle = [number, number, number | null];

export type SegKind = 'trail' | 'connector';
export type Oneway = 'no' | 'forward' | 'reverse';

/** One segment of the routing graph: a run of nodes between junctions. */
export interface RouterSeg {
  /** node indices */
  p: number[];
  /** name */
  n: string;
  k: SegKind;
  /** grade 1–4, null when ungraded */
  g: number | null;
  /** grade when descending */
  gd: number | null;
  o: Oneway;
}

/** The compact routing graph an area file carries (`data`), made by buildRouterData. */
export interface RouterData {
  nodes: LatLonEle[];
  segs: RouterSeg[];
  /** trailheads, lowest first */
  th: Array<{ node: number; name: string }>;
  /** background reference lines, [lon, lat] */
  ref: Array<{ c: Array<[number, number]>; k: string }>;
  version: string;
}

/** Equirectangular scale factors in metres/degree around the first node: [kx (lon), ky (lat)]. */
export function eqScale(nodes: LatLonEle[]): [kx: number, ky: number] {
  const k = Math.PI / 180 * 6371000;
  return [k * Math.cos((nodes[0]?.[0] ?? 0) * Math.PI / 180), k];
}
