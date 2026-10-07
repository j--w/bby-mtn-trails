import type { RouterData } from './types.js';
/** An elevation source: metres for each [lat, lon], null where it has no data. */
export interface ElevationSource {
    name: string;
    sample(points: number[][]): Promise<Array<number | null>>;
}
/** Decoded image pixels, RGBA. */
export interface PixelTile {
    width: number;
    height: number;
    data: ArrayLike<number>;
}
export interface TerrariumOptions {
    zoom?: number;
    url?: string;
    loadTile?: (url: string) => Promise<PixelTile>;
}
/** geotiff: the geotiff.js module (untyped here). */
export interface HrdemOptions {
    geotiff?: any;
    resolution?: number;
    base?: string;
}
export declare const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export declare const TERRARIUM_ATTRIBUTION = "Elevation: AWS Terrain Tiles (Mapzen, USGS, NRCan and others)";
export declare const decodeTerrarium: (r: number, g: number, b: number) => number;
export declare function tileXY(lat: number, lon: number, z: number): [number, number];
export declare function terrariumSource({ zoom, url, loadTile }?: TerrariumOptions): ElevationSource;
export declare const HRDEM_BASE = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/";
export declare const HRDEM_ATTRIBUTION = "Elevation: HRDEM, Natural Resources Canada (Open Government Licence \u2013 Canada)";
export declare function toCanadaLambert(lat: number, lon: number): [number, number];
export declare const hrdemTileId: (x: number, y: number) => string;
export declare function hrdemSource({ geotiff, resolution, base }?: HrdemOptions): ElevationSource;
export declare function sampleElevations(points: number[][], sources: ElevationSource[]): Promise<{
    ele: Array<number | null>;
    source: Array<string | null>;
}>;
export declare const SMOOTHING: Record<string, number>;
export declare function smoothAlongSegments(data: RouterData, window?: number): RouterData;
