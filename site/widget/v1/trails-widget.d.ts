// Trail route builder widget, v1. Types for trails-widget.js (plain ES module, no build step).
//
//   import { mount } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/trails-widget.js';
//   const widget = mount(document.querySelector('#routes'), { area: 'https://example.org/my-area.trails.json' });
//
// The widget draws into the element you give it and lays itself out there (side panel when wide, stacked when
// narrow), so give the element a height. Everything here stays backward compatible within v1.
// Units: distances and climb in metres, times in seconds, coordinates [lat, lon] (WGS84).

// ---------- areas ----------

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

/** Check and read an area file (JSON text or a parsed object). Throws a WidgetError ('area-unreadable' or
 *  'area-not-routable') with a message you can show. */
export function readArea(json: string | unknown): AreaPackage;

/** The area's trailheads, for your own picker or a saved favourite. */
export function trailheads(area: AreaPackage): Trailhead[];

export interface Trailhead {
  /** Its position ("49.27800,-122.91700"): stays the same when the area is edited and saved again. */
  id: string;
  name: string;
  at: [lat: number, lon: number];
  /** metres, approximate */
  ele: number;
}

// ---------- route search ----------

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

// ---------- mounting ----------

export type RouteControl = 'mode' | 'distance' | 'climb' | 'start' | 'paved' | 'lap';

export interface MountOptions {
  /** An area, or the URL of an area file. Without one the widget says there's nothing to route on. */
  area?: AreaPackage | string;
  /** Starting values. Missing ones use the defaults in RouteParams. */
  params?: Partial<RouteParams>;
  /** Controls the runner sees. Default: all. Params behind hidden controls still apply.
   *  A training plan that fixes the target might show just ['start', 'paved', 'lap']. */
  controls?: RouteControl[];
  /** Search as soon as the area is ready. Default false. */
  autoBuild?: boolean;
  /** Parts of the widget. All default true. `results: false` hides the option list and GPX buttons:
   *  build your own from onRoutes and call select(). */
  panels?: { header?: boolean; results?: boolean; profile?: boolean };
  prefs?: {
    /** Seconds per km on flat trail, for estimatedTime. Default 390 (6:30/km). */
    pace?: number;
  };
  /** Default 'auto' (follows the system). Set --tw-accent, --tw-accent-soft, --tw-font, --tw-radius and
   *  --tw-radius-sm on any ancestor to match your app. */
  theme?: 'auto' | 'light' | 'dark';

  /** Routes from each search, best first (empty when nothing fits). */
  onRoutes?(routes: Route[]): void;
  /** The route on the map: the first after a search, then whatever the runner picks. */
  onRoute?(route: Route): void;
  /** Turns the widget's "Download GPX" button into "Use this route" and hands you the route.
   *  Without it the button downloads the GPX. */
  onExport?(route: Route, gpx: string): void;
  /** Problems worth telling the runner about. Without it they go to the console. */
  onError?(error: WidgetError): void;
}

export interface TrailWidget {
  /** Change options in place: a new area, a new target from the plan, other controls. Doesn't search;
   *  call build() after. Options you leave out keep their values. */
  update(options: Partial<MountOptions>): void;
  /** Search with the current params (including what the runner typed). Resolves with the routes, or []
   *  when nothing fits or the params are invalid (onError says which). */
  build(): Promise<Route[]>;
  /** Put this route on the map, as if the runner picked it. */
  select(routeId: string): void;
  readonly routes: readonly Route[];
  /** Null until the area has loaded. */
  readonly params: RouteParams | null;
  readonly area: AreaPackage | null;
  /** Stop the search worker and remove everything the widget added to the element. */
  destroy(): void;
}

export function mount(element: HTMLElement, options?: MountOptions): TrailWidget;

export type WidgetErrorCode =
  | 'area-unreadable' | 'area-not-routable' | 'invalid-params' | 'no-route' | 'search-failed' | 'map-unavailable';

export class WidgetError extends Error {
  readonly code: WidgetErrorCode;
}

export const version: string;
