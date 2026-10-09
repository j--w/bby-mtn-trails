import type * as Leaflet from 'leaflet';
type LeafletNS = typeof Leaflet;
export declare function loadLeaflet(): Promise<LeafletNS>;
export declare function addStyles(id: string, css: string): void;
export declare function baseLayers(L: LeafletNS, map: Leaflet.Map): void;
export declare const esc: (s: unknown) => string;
export declare const themeOf: (t?: string) => "auto" | "dark" | "light";
export declare function download(text: string, name: string, type: string): void;
export {};
