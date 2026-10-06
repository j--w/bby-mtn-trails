# Bootstrap scripts (history)

These one-off scripts produced `site/data/burnaby-mountain-editor.json`, the editor's base data, in an
exploratory session. They are kept for reference and are **not** part of the normal workflow. They expect to
run from a scratch directory with these files copied in under their old names:

| Old name           | File in this repo                                   |
|--------------------|-----------------------------------------------------|
| `exhaustive.gpx`   | `data/burnaby-mountain/raw/exhaustive.gpx`          |
| `osm.json`         | `data/burnaby-mountain/raw/osm-trails-v1.json`      |
| `osm2.json`        | `data/burnaby-mountain/raw/osm-trails.json`         |
| `roads.json`       | `data/burnaby-mountain/raw/osm-roads.json`          |
| `export_user.json` | `data/burnaby-mountain/raw/curated-snapshot-1.json` |

Order: `build_osm.py` → `build_osm2.py` (→ `data5.json`) → `extend.py` (→ `data6.json`) →
`roads_build.py` + `roads_merge.py` (→ `data7.json` = the editor base data).

`build_osm2.py` also computes the OSM tag summaries (name, IMBA grade, surface) and the background map layer.
Turning this into one reproducible `build_area.py` is an open task (see
docs/CONTEXT.md, "Known gaps").

**Never regenerate the editor base data in a way that renumbers existing nodes or extras**: the editor's
saved state and every curated export refer to node indices and extra indices in that file. Only append.
