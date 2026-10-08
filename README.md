# Trail Route Builder

Build trail-running loops on any trail network from a **distance and climb target**, or ask for the
**longest loop** with the fewest repeats. You set up the network for your area from OpenStreetMap and
curate it. Routes are drawn on OpenStreetMap tiles with an elevation profile and GPX download. Made for ultramarathon training and sharing runs with a club.

- **Route builder:** `site/index.html`
- **Area setup** (make a network for any trail area from OpenStreetMap): `site/setup/index.html`
- **Widgets** for embedding both in another app: `site/widget/v1/`

## Run it locally

```bash
npm install
npm run serve        # build, then open http://localhost:8000 (needs Python 3)
npm run watch        # rebuild as you edit src/
npm test             # build, then the tests (Node 20+)
```

The code is TypeScript in `src/`; `npm run build` type checks it and bundles it with esbuild into `site/` next to the HTML. The pages
load JSON with `fetch`, so open them through a local server, not as `file://`.

## Areas

There's no built-in area. Make one on `/setup/` (pick a box on the map, curate the trails, then download the
area file or open it in the route builder), or open a `.trails.json` someone shared. A file on the web opens with
`?area=<url>`, which is handy for a club link. The route builder reopens the last area you used in that browser.

## Embed the widgets

There are two widgets you can put in your own page or app: the route builder (`trails-widget.js`) and area setup
(`setup-widget.js`). They're separate so a page that only builds routes doesn't load setup. Each draws into one
element and lays itself out there, so give the element a height. Types are in `trails-widget.d.ts` next to it
(generated from `src/widget/v1/`).

```html
<div id="routes" style="height: 640px"></div>
<script type="module">
  import { mount } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/trails-widget.js';

  const widget = mount(document.getElementById('routes'), {
    area: 'https://example.org/my-area.trails.json',       // or a parsed area file
    params: { distance: 18000, climb: 700, lap: 9000 },    // metres; lap = back through the start every ~9 km
    controls: ['start', 'paved', 'lap'],                   // what the runner can change (default: everything)
    autoBuild: true,
    onExport(route, gpx) { /* save route.params, or the GPX */ },
  });

  // later: widget.update({ params: { distance: 25000 } }); await widget.build();
</script>
```

The same area and `params` (seed included) always give the same route, so store `route.params` and rebuild from
it. Without `onExport` the widget offers a GPX download instead.

Area setup works the same way (types in `setup-widget.d.ts`). Your app can pass the runner's GPS
tracks, which show which trails they use and what OpenStreetMap is missing, and gets the finished area back:

```js
import { mountSetup } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/setup-widget.js';

mountSetup(document.getElementById('setup'), {
  view: { center: [45.55, -122.75], zoom: 13 },            // where to start picking an area
  tracks: runs.map(r => ({ name: r.name, points: r.latlng })),   // e.g. Strava latlng streams
  onCoverage: c => c && console.log(`${c.gaps.length} stretches OpenStreetMap doesn't have`),
  onAreaSaved: area => saveToAccount(area),                // then mount the route builder with { area }
  overpass: ['https://overpass.example.org/api/interpreter'], // optional: your own Overpass server(s), tried in order
});
```

Without `onAreaSaved` the setup widget offers a download of the area file. Without `overpass` it uses the public
Overpass servers, which can be slow or refuse big boxes when busy; your own server must allow cross-origin requests.
If the page already has Leaflet (`window.L`), both widgets use it instead of their bundled copy. Restyle either widget by setting
`--tw-accent`, `--tw-accent-soft`, `--tw-font`, `--tw-radius` and `--tw-radius-sm` on any ancestor.

### Install in an app

Apps with a bundler can install the widgets from this repo instead of loading them from the site. npm builds them
on install (`prepare`), so pin a commit or tag to get the same build every time:

```bash
npm install github:j--w/trail-run-auto-router#<commit or tag>
```

```ts
import { mount, readArea, type Route } from 'trail-route-builder';   // the route builder (trails-widget.js)
import { mountSetup } from 'trail-route-builder/setup';               // area setup (setup-widget.js)
```

Types come with it. The workers are inlined into the widgets, so they need no extra files or bundler settings.

## Deploy

Go to **Settings → Pages → Source: Deploy from a branch, `gh-pages`, `/ (root)`**. Every push to `main` publishes
`site/` to that branch, and each pull request gets a preview at `pr-preview/pr-<number>/`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Code: MIT.
