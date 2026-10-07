# Trail Route Builder

Generates trail-running loops on a hand-curated trail network (any area; first built for Burnaby Mountain, BC) from a
distance and climb target, or as "longest loop" options, and exports GPX. Built for ultramarathon training and a
local running club. Static site, no server. Areas are set up in the browser from OpenStreetMap
(`site/setup/`) and saved as area files (`.trails.json`); there is no built-in area.

## Layout

- `site/` is the deployed static site (GitHub Pages serves it from the `gh-pages` branch; `pages.yml` publishes main
  there and `preview.yml` puts each PR at `pr-preview/pr-<number>/`).
  - `index.html`: route builder UI. Opens `?area=<url of a .trails.json>`, else the last area opened in this browser
    (IndexedDB `current`), else a start screen (open an area file / set one up) (one ES module inline script; Leaflet 1.9.4 from cdnjs with OSM/OpenTopoMap tiles for the
    map, hand-drawn SVG elevation profile). Grades still drive routing data but are not shown or chosen in the UI;
    new routes allow every vetted trail (maxg 4), and loaded route codes keep their own maxg/late.
  - `js/router-core.js`: route search. Pure functions, no DOM. `buildGraph`, `solve` (target mode),
    `solveLongest` (longest-loop mode). Shared by the page, the worker and the tests.
  - `js/router-worker.js`: Web Worker wrapper (`importScripts('router-core.js')`).
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
  - `js/area-worker.js` (module worker, compiles off the main thread) and `js/area-store.js` (IndexedDB: the setup
    draft and the `current` area the route builder opens).
  - `setup/index.html`: area setup. Pick a rectangle, load OSM trails and elevations, curate (trails, trailheads,
    split, join, drawn paths OSM lacks, GPX tracks, connector suggestions), then download the area file or open it in the route builder.
- `data/burnaby-mountain/raw/`: OSM Overpass exports and GPX files, used by the tests.
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
- Route search must stay **deterministic for a given seed** (mulberry32): route codes shared with the club
  rebuild routes from (params, seed). A change to the search changes what old codes produce. Bump the code format
  or note it in the release if that matters.
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
