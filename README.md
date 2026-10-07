# Trail Route Builder

Build trail-running loops on any trail network from a **distance and climb target**, or ask for the
**longest loop** with the fewest repeats. You set up the network for your area from OpenStreetMap and
curate it. Routes are drawn on OpenStreetMap tiles with an elevation profile and GPX download. Made for ultramarathon training and sharing runs with a club.

- **Route builder:** `site/index.html`
- **Area setup** (make a network for any trail area from OpenStreetMap): `site/setup/index.html`

## Run it locally

```bash
npm run serve        # then open http://localhost:8000 (needs Python 3)
npm test             # route search tests (Node 20+)
```

The pages load JSON with `fetch`, so open them through a local server, not as `file://`.

## Areas

There's no built-in area. Make one on `/setup/` (pick a box on the map, curate the trails, then download the
area file or open it in the route builder), or open a `.trails.json` someone shared. A file on the web opens with
`?area=<url>`, which is handy for a club link. The route builder reopens the last area you used in that browser.

## Embed the route builder

The route builder is a widget you can put in your own page or app. It draws into one element and lays itself out
there, so give the element a height. Types are in `site/widget/v1/trails-widget.d.ts`.

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
it. Without `onExport` the widget offers a GPX download instead. Restyle it by setting `--tw-accent`,
`--tw-accent-soft`, `--tw-font`, `--tw-radius` and `--tw-radius-sm` on any ancestor.

## Deploy

Go to **Settings → Pages → Source: Deploy from a branch, `gh-pages`, `/ (root)`**. Every push to `main` publishes
`site/` to that branch, and each pull request gets a preview at `pr-preview/pr-<number>/`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Code: MIT.
