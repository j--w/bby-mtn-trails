# Trail Route Builder

Generates trail-running loops on a hand-vetted trail network (starting with Burnaby Mountain, BC) from a
distance and climb target, or as "longest loop" options, and exports GPX. Built for ultramarathon training and a
local running club. Static site, no server. Background and design decisions: `docs/CONTEXT.md`. Read it before
changing the routing or the data pipeline.

## Layout

- `site/` is the deployed static site (GitHub Pages serves this folder).
  - `index.html`: route builder UI (one ES module inline script; Leaflet 1.9.4 from cdnjs with OSM/OpenTopoMap tiles for the
    map, hand-drawn SVG elevation profile). Grades still drive routing data but are not shown or chosen in the UI;
    new routes allow every vetted trail (maxg 4), and loaded route codes keep their own maxg/late.
  - `js/router-core.js`: route search. Pure functions, no DOM. `buildGraph`, `solve` (target mode),
    `solveLongest` (longest-loop mode). Shared by the page, the worker and the tests.
  - `js/router-worker.js`: Web Worker wrapper (`importScripts('router-core.js')`).
  - `js/area-build.js`: JS port of `build_router_data.py` (`buildRouterData`), same output for the same input.
    ES module, pure. Groundwork for setting up new areas in the browser.
  - `js/osm.js`: Overpass query/fetch (with fallback server), parsing to a shared-node network, trail/road
    layers, junction splitting and the first-pass draft (`draftNetwork`).
  - `js/elevation.js`: elevations from HRDEM LiDAR (geotiff.js range reads, EPSG:3979) with AWS Terrain Tiles
    as fallback, and `smoothAlongSegments` so DEM noise doesn't inflate climb.
  - `js/area-package.js`: area packages (`.trails.json`: OSM snapshot, the user's edits keyed by OSM ids, compiled
    routing graph). `compileArea`, `suggestConnectors`, `makePackage`, `readPackage`. Pure.
  - `js/gpx.js`: `parseGpx` and `matchTrack` (which network pieces a GPS track follows, and the stretches it runs
    where the network has nothing, which the setup page adds as drawn paths). Pure.
  - `js/area-worker.js` (module worker, compiles off the main thread) and `js/area-store.js` (IndexedDB: the setup
    draft and the `current` area the route builder opens with `?area=local`).
  - `setup/index.html`: area setup. Pick a rectangle, load OSM trails and elevations, curate (trails, trailheads,
    split, join, drawn paths OSM lacks, GPX tracks, connector suggestions), then download the area file or open it in the route builder. The route
    builder also takes `?area=<url of a .trails.json>`.
  - `editor/index.html`: trail network editor (add/remove/grade segments, mark trailheads, export JSON).
  - `data/burnaby-mountain.json`: compact routing graph the route builder loads. **Generated; don't hand-edit.**
  - `data/burnaby-mountain-editor.json`: editor base data (all nodes, OSM network, optional "extras").
- `data/burnaby-mountain/curated.json`: the user's vetted network (editor Export). Source of truth for routing.
- `data/burnaby-mountain/raw/`: OSM Overpass exports and the GPX files the network came from.
- `scripts/build_router_data.py`: curated.json + editor base data → `site/data/<area>.json`.
- `scripts/bootstrap/`: one-off history scripts that made the editor base data. Not part of the normal flow.
- `tests/router.test.mjs`: Node tests for the route search against the real data.
- `tests/area-build.test.mjs`, `tests/osm.test.mjs`, `tests/elevation.test.mjs`, `tests/area-package.test.mjs`,
  `tests/gpx.test.mjs`: the area-setup modules.
  `tests/fixtures/synthetic-expected.json` is made by the Python build; regenerate it the same way if the
  Python build changes (command in the test file).

## Commands

```bash
npm test                                   # route search tests (Node 20+, no dependencies)
python3 scripts/build_router_data.py       # rebuild site/data/burnaby-mountain.json from curated.json
npm run serve                              # http://localhost:8000 (route builder), /editor/ (editor)
```

CI (`.github/workflows/tests.yml`) runs the tests and fails if `site/data/burnaby-mountain.json` doesn't match a
rebuild from `curated.json`. After changing `curated.json` or the build script, rebuild and commit the output.

## Rules that matter

- **Node and extra indices are append-only.** `curated.json` and the editor's saved browser state refer to node
  indices and `extras` indices in `burnaby-mountain-editor.json`. Never reorder or regenerate them; only append.
- Route search must stay **deterministic for a given seed** (mulberry32): route codes shared with the club
  rebuild routes from (params, seed). A change to the search changes what old codes produce. Bump the code format
  or note it in the release if that matters.
- Distances are metres, elevations metres. Map projection is equirectangular around the first node; SVG Y is
  negated latitude.
- Grades: 1 green, 2 blue, 3 black, 4 double black; ungraded counts as 2. `gd` (descending grade) applies when
  a traversal drops more than 8 m net.
- Segment kinds: `trail` or `connector` (paved/road/sidewalk, penalised by the "Paved sections" option).
- Elevations are approximate (from the Strava GPX; OSM extras are interpolated). Don't present climb as exact.
- Map data is © OpenStreetMap contributors (ODbL). Keep the attribution in the UI and README.
- Keep it static: no build step, no framework, no backend. Libraries only if they earn it (CDN, pinned version).

## Style

Plain JS (ES2020+), small functions, no dependencies. UI copy is short and written for runners. Both light and
dark themes are defined as CSS custom properties at the top of each page; style through those tokens.
