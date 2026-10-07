// Leaflet from npm, in a module of its own so it's only downloaded when the host page doesn't have Leaflet already.
import * as Leaflet from 'leaflet';

// Leaflet's stylesheet with its images inlined (scripts/build.mjs puts it here).
declare const __LEAFLET_CSS__: string;
export const css: string = __LEAFLET_CSS__;
export default Leaflet;
