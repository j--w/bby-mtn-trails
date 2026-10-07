// Area setup widget, v1. Types for setup-widget.js (plain ES module, no build step).
//
//   import { mountSetup } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/setup-widget.js';
//   const setup = mountSetup(document.querySelector('#setup'), { onAreaSaved: area => saveToAccount(area) });
//
// Runners pick a box on the map, load the OpenStreetMap trails and elevations there, choose their trails and
// trailheads, then save. The area that comes out is what the route builder (trails-widget.js) takes.
// It lives in its own module because it's much heavier than the route builder, so a page that only builds routes
// never loads it. Give the element a height. Everything here stays backward compatible within v1.
// Units: metres, coordinates [lat, lon] (WGS84).
import type { AreaPackage, WidgetError } from './trails-widget';
export { AreaPackage, WidgetError, readArea } from './trails-widget';

/** A GPS track, e.g. a Strava activity's latlng (and altitude) streams. */
export interface GpsTrack {
  name?: string;
  /** [lat, lon] or [lat, lon, ele] */
  points: ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;
}

/** GPX text to tracks, one per track segment or route. Handy when your app has files rather than streams. */
export function parseGpx(text: string): GpsTrack[];

/** What the tracks show about the area being set up. */
export interface Coverage {
  /** Metres of mapped path (trail, road or sidewalk) the tracks run along. */
  followed: number;
  /** Of that, metres not in the area's network yet (the runner can add them in one tap). */
  missing: number;
  /** Metres of track where OpenStreetMap has no path at all. */
  offMap: number;
  /** The longer of those stretches, which the runner can add as drawn paths. */
  gaps: Array<{ points: Array<[lat: number, lon: number]>; length: number }>;
}

export interface SetupOptions {
  /** An area (or the URL of an area file) to keep editing. Without one, the runner starts by picking a box. */
  area?: AreaPackage | string;
  /** Where the map starts when picking a box, e.g. near the runner's home. Default: the whole world. */
  view?: { center: [lat: number, lon: number]; zoom?: number };
  /** The runner's tracks to check against the area: shown on the map, with their trails and the bits
   *  OpenStreetMap is missing offered to add. Not saved in the area. */
  tracks?: GpsTrack[];
  /** Let the runner load GPX files in the widget too. Default true. */
  gpxFiles?: boolean;
  /** Keep a draft in this browser (IndexedDB) so a half-finished area survives a reload, and offer to continue
   *  it. Default true. */
  draft?: boolean;
  /** `header: false` hides the title. Default true. */
  panels?: { header?: boolean };
  /** Default 'auto' (follows the system). The same --tw-* CSS variables as the route builder apply. */
  theme?: 'auto' | 'light' | 'dark';
  /** Text of the save button. Default 'Save area'. */
  saveLabel?: string;

  /** The runner saved the area: store it, or hand it to the route builder's update({ area }). The button waits
   *  while a returned promise runs; a rejection's message is shown. Without this, saving downloads the file. */
  onAreaSaved?(area: AreaPackage): void | Promise<void>;
  /** Coverage whenever the tracks or the network change; null when there are no tracks. */
  onCoverage?(coverage: Coverage | null): void;
  /** Problems worth telling the runner about. Without it they go to the console. */
  onError?(error: WidgetError): void;
}

export interface SetupWidget {
  /** Change options in place: new tracks from your app, another area to edit, other callbacks.
   *  Options you leave out keep their values. */
  update(options: Partial<SetupOptions>): void;
  /** The area as it stands, or null until it has a trailhead on a routable trail. */
  readonly area: AreaPackage | null;
  /** Stop the worker and remove everything the widget added to the element. */
  destroy(): void;
}

export function mountSetup(element: HTMLElement, options?: SetupOptions): SetupWidget;

export const version: string;
