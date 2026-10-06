# Trail Route Builder

Build trail-running loops on Burnaby Mountain from a **distance and climb target**, or ask for the
**longest loop** with the fewest repeats. Routes use a hand-vetted trail network, with turn-by-turn cues,
an elevation profile and GPX download. Made for ultramarathon training and sharing runs with a club.

- **Route builder:** `site/index.html`
- **Trail editor** (curate the network): `site/editor/index.html`

## Run it locally

```bash
npm run serve        # then open http://localhost:8000 (needs Python 3)
npm test             # route search tests (Node 20+)
```

The pages load JSON with `fetch`, so open them through a local server, not as `file://`.

## Update the trail network

1. Open `/editor/`, go to **Export → Load a saved file**, and paste the contents of `data/burnaby-mountain/curated.json`.
2. Make your changes, then **Export → Download JSON** and save over `data/burnaby-mountain/curated.json`.
3. Run `python3 scripts/build_router_data.py`, then commit.

Details: [`docs/CONTEXT.md`](docs/CONTEXT.md).

## Deploy

Push to GitHub, then go to **Settings → Pages → Source: GitHub Actions**. Every push to `main` publishes `site/`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Code: MIT.
