# Trail Route Builder

Build trail-running loops on Burnaby Mountain from a **distance and climb target**, or ask for the
**longest loop** with the fewest repeats. Routes use a hand-vetted trail network, drawn on OpenStreetMap tiles with
an elevation profile and GPX download. Made for ultramarathon training and sharing runs with a club.

- **Route builder:** `site/index.html`
- **Area setup** (make a network for any trail area from OpenStreetMap): `site/setup/index.html`

## Run it locally

```bash
npm run serve        # then open http://localhost:8000 (needs Python 3)
npm test             # route search tests (Node 20+)
```

The pages load JSON with `fetch`, so open them through a local server, not as `file://`.

## Update the trail network

1. Open `/setup/` and press **Edit Burnaby Mountain**.
2. Make your changes, then **Download area file** and save it over `site/data/burnaby-mountain.trails.json`.
3. Run `npm test`, then commit.

## Deploy

Go to **Settings → Pages → Source: Deploy from a branch, `gh-pages`, `/ (root)`**. Every push to `main` publishes
`site/` to that branch, and each pull request gets a preview at `pr-preview/pr-<number>/`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Code: MIT.
