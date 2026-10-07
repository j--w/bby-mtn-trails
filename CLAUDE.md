# Trail Route Builder

Generates trail-running loops on a hand-curated trail network (any area; first built for Burnaby Mountain, BC) from a
distance and climb target, or as "longest loop" options, and exports GPX. Built for ultramarathon training and a
local running club. Static site, no server. Areas are set up in the browser from OpenStreetMap
(`site/setup/`) and saved as area files (`.trails.json`); there is no built-in area.

## Layout

- `site/` is the deployed static site (GitHub Pages serves it from the `gh-pages` branch; `pages.yml` publishes main
  there and `preview.yml` puts each PR at `pr-preview/pr-<number>/`).
  - `index.html`: the route builder page, a thin consumer of the widget (top bar, start screen). Opens
    `?area=<url of a .trails.json>`, else the last area opened in this browser (IndexedDB `current`), else a start
    screen (open an area file / set one up).
  - `widget/v1/`: the two embeddable widgets. `trails-widget.js` exports `mount(el, options)`, the route builder
    (map, controls, results, elevation profile, GPX; search runs in a blob worker that `importScripts`
    `js/router-core.js`, so it works cross-origin). `setup-widget.js` exports `mountSetup(el, options)`, area setup
    (tracks from the host, `onCoverage`, `onAreaSaved`; compiling runs in a blob module worker that imports
    `js/area-worker.js`). They're separate so route-only pages don't load setup. `common.js` has what both share
    (Leaflet 1.9.4 from cdnjs, injected if the host lacks it; the theme tokens and base CSS, scoped under `.tw`).
    `model.js` holds the route builder's DOM-free parts (params, trailheads, `toRoute`, GPX). The `.d.ts` files are
    the public contract: keep them backward compatible within v1 (new optional fields only; breaking changes go in
    `v2/`). Params are metres; trailhead ids are positions (`lat,lon` to 5 places). Grades still drive routing data
    but aren't offered: every vetted trail is allowed (maxg 4).
  - `js/router-core.js`: route search. Pure functions, no DOM, classic script (no exports). `buildGraph`, `solve`
    (target mode), `solveLongest` (longest-loop mode), `routeGeometry` (route → points with distance and lap),
    `reachableKm`. Shared by the widget's worker and the tests.
  - `js/area-build.js`: `buildRouterData` (snap near-misses, close dead ends, drop islands) → compact routing
    graph. Port of the old Python build (removed; see git history). ES module, pure.
  - `js/osm.js`: Overpass query/fetch (with fallback server), parsing to a shared-node network, trail/road
    layers, junction splitting and the first-pass draft (`draftNetwork`).
  - `js/elevation.js`: elevations from HRDEM LiDAR (geotiff.js range reads, EPSG:3979) with AWS Terrain Tiles
    as fallback, and `smoothAlongSegments` so DEM noise doesn't inflate climb.
  - `js/area-package.js`: area packages (`.trails.json`: OSM snapshot, the user's edits keyed by OSM ids, compiled
    routing graph). `compileArea`, `suggestConnectors`, `makePackage`, `readPackage`. Pure.
  - `js/gpx.js`: `parseGpx` and `matchTrack` (which network pieces a GPS track follows, and the stretches it runs
    where the network has nothing, which the setup page adds as drawn paths). Pure.
  - `js/area-worker.js` (module worker for the setup widget, compiles off the main thread) and `js/area-store.js` (IndexedDB: the setup
    draft and the `current` area the route builder opens).
  - `setup/index.html`: the area setup page, a thin consumer of the setup widget (top bar; saving stores the area as
    `current` and opens the route builder).
- `data/burnaby-mountain/raw/`: OSM Overpass exports and GPX files, used by the tests.
- `tests/widget.test.mjs`: the route widget's model (params, trailheads, routes, GPX) against a real search, and the
  setup widget's `parseGpx`.
- `tests/router.test.mjs`: Node tests for the route search, on the old hand-curated Burnaby graph
  (`tests/fixtures/burnaby-legacy.json`, frozen; the other tests use it as a reference network too).
- `tests/area-build.test.mjs`, `tests/osm.test.mjs`, `tests/elevation.test.mjs`, `tests/area-package.test.mjs`,
  `tests/gpx.test.mjs`: the area-setup modules.
  `tests/fixtures/synthetic-expected.json` was made by the old Python build (command in the test file).

## Commands

```bash
npm test                                   # tests (Node 20+, no dependencies)
npm run serve                              # http://localhost:8000 (route builder), /setup/ (area setup)
```

CI (`.github/workflows/tests.yml`) runs the tests.

## Rules that matter

- Area edits are keyed by OSM ids (`<wayId>/<nodeKey>`); drawn paths append nodes after the OSM ones, so OSM node
  indices never move. Keep it that way.
- Route search must stay **deterministic for a given seed** (mulberry32): apps that embed the widget store a
  route's `params` (seed included) and rebuild it from them. A change to the search changes what stored params
  produce; note it in the release when it does.
- Distances are metres, elevations metres. Map projection is equirectangular around the first node; SVG Y is
  negated latitude.
- Grades: 1 green, 2 blue, 3 black, 4 double black; ungraded counts as 2. `gd` (descending grade) applies when
  a traversal drops more than 8 m net.
- Segment kinds: `trail` or `connector` (paved/road/sidewalk, penalised by the "Paved sections" option).
- Elevations are approximate (HRDEM LiDAR or terrain tiles, smoothed). Don't present climb as exact.
- Map data is © OpenStreetMap contributors (ODbL). Keep the attribution in the UI and README.
- Keep it static: no build step, no framework, no backend. Libraries only if they earn it (CDN, pinned version).

## Style

Plain JS (ES2020+), small functions, no dependencies. UI copy is short and written for runners. Both light and
dark themes are defined as CSS custom properties at the top of each page; style through those tokens.
