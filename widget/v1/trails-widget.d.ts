import { WidgetError, readArea, trailheads } from './model.js';
import type { AreaPackage, RouteParams, Route } from './model.js';
export { WidgetError, readArea, trailheads };
export type { AreaPackage, Trailhead, RouteMode, PavedPreference, RouteParams, RoutePoint, Route, WidgetErrorCode } from './model.js';
export declare const version: string;
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
    panels?: {
        header?: boolean;
        results?: boolean;
        profile?: boolean;
    };
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
/**
 * Trail route builder widget, v1 (trails-widget.js: a plain ES module, no build step for your page).
 *
 *   import { mount } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/trails-widget.js';
 *   const widget = mount(document.querySelector('#routes'), { area: 'https://example.org/my-area.trails.json' });
 *
 * The widget draws into the element you give it and lays itself out there (side panel when wide, stacked when
 * narrow), so give the element a height. Everything here stays backward compatible within v1.
 * Area setup is a separate widget (setup-widget.js) so pages that only build routes stay light.
 * Units: distances and climb in metres, times in seconds, coordinates [lat, lon] (WGS84).
 */
export declare function mount(element: HTMLElement, options?: MountOptions): TrailWidget;
