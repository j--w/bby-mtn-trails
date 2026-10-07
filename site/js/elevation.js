// Elevations for a new area: Canada's HRDEM LiDAR where it exists, AWS Terrain Tiles everywhere else,
// plus the climb counting that keeps noisy elevations from inflating climb. No DOM; the browser defaults
// (image decoding, geotiff.js) are only touched when a source is used without its loader option.

// ---- AWS Terrain Tiles (Terrarium PNG, ~5-30 m depending on area). Free, no key, CORS open.
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_ATTRIBUTION = 'Elevation: AWS Terrain Tiles (Mapzen, USGS, NRCan and others)';

export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

// Fractional tile coordinates of a point at zoom z (Web Mercator).
export function tileXY(lat, lon, z) {
  const n = 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

// Browser tile loader: PNG -> RGBA pixels.
async function loadImagePixels(url, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: cx.getImageData(0, 0, bmp.width, bmp.height).data };
}

// loadTile(url) -> {width, height, data: RGBA}. Bilinear between pixel centres.
export function terrariumSource({ zoom = 15, url = TERRARIUM_URL, loadTile = loadImagePixels } = {}) {
  return {
    name: 'terrain-tiles',
    async sample(points) {
      const groups = new Map();
      points.forEach(([lat, lon], i) => {
        const [x, y] = tileXY(lat, lon, zoom), key = `${Math.floor(x)}/${Math.floor(y)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push([i, x, y]);
      });
      const out = new Array(points.length).fill(null);
      await Promise.all([...groups].map(async ([key, pts]) => {
        const [tx, ty] = key.split('/').map(Number);
        let img;
        try { img = await loadTile(url.replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty)); } catch { return; }
        const at = (px, py) => {
          px = Math.max(0, Math.min(img.width - 1, px)); py = Math.max(0, Math.min(img.height - 1, py));
          const o = (py * img.width + px) * 4;
          return decodeTerrarium(img.data[o], img.data[o + 1], img.data[o + 2]);
        };
        for (const [i, x, y] of pts) {
          const fx = (x - tx) * img.width - 0.5, fy = (y - ty) * img.height - 0.5;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
          out[i] = at(x0, y0) * (1 - dx) * (1 - dy) + at(x0 + 1, y0) * dx * (1 - dy) + at(x0, y0 + 1) * (1 - dx) * dy + at(x0 + 1, y0 + 1) * dx * dy;
        }
      }));
      return out;
    },
  };
}

// ---- CanElevation HRDEM mosaic (LiDAR, 1 m, overviews from 2 m). Cloud-optimized GeoTIFFs in EPSG:3979,
// one file per 500 km grid square; geotiff.js reads only the blocks it needs over HTTP range requests.
export const HRDEM_BASE = 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/';
export const HRDEM_ATTRIBUTION = 'Elevation: HRDEM, Natural Resources Canada (Open Government Licence – Canada)';
export const GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm';

// EPSG:3979 (NAD83(CSRS) / Canada Atlas Lambert): Lambert conformal conic, GRS80. Ignores the ~1 m
// WGS84/NAD83(CSRS) datum difference, which is below the resolution we read at.
const A = 6378137, F = 1 / 298.257222101, E = Math.sqrt(2 * F - F * F), RAD = Math.PI / 180;
const lccM = p => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
const lccT = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = 49 * RAD, P2 = 77 * RAD, P0 = 49 * RAD, L0 = -95 * RAD;
const LN = (Math.log(lccM(P1)) - Math.log(lccM(P2))) / (Math.log(lccT(P1)) - Math.log(lccT(P2)));
const LF = lccM(P1) / (LN * lccT(P1) ** LN), RHO0 = A * LF * lccT(P0) ** LN;
export function toCanadaLambert(lat, lon) {
  const rho = A * LF * lccT(lat * RAD) ** LN, th = LN * (lon * RAD - L0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}
// File for a projected point: grid squares of 500 km, ids `<col>_<row>`.
export const hrdemTileId = (x, y) => `${Math.floor((x + 3000000) / 500000)}_${Math.floor((y + 1500000) / 500000)}`;

// geotiff: the geotiff.js module (loaded from GEOTIFF_URL by default). resolution: metres per pixel to read
// at (2 m = the first overview; 1 m = full resolution, four times the download).
export function hrdemSource({ geotiff, resolution = 2, base = HRDEM_BASE } = {}) {
  const files = new Map();
  const open = id => {
    if (!files.has(id)) files.set(id, (async () => {
      const lib = geotiff || await import(GEOTIFF_URL);
      const tiff = await lib.fromUrl(`${base}${id}-mosaic-1m-dtm.tif`);
      const count = await tiff.getImageCount(), full = await tiff.getImage(0);
      let img = full;
      for (let k = 1; k < count; k++) {
        const im = await tiff.getImage(k);
        if (full.getWidth() / im.getWidth() <= resolution + 1e-9) img = im; else break;
      }
      const [x0, , , y1] = full.getBoundingBox(), sx = (full.getWidth() / img.getWidth()) * full.getResolution()[0];
      const noData = full.getGDALNoData();
      return { img, x0, y1, px: sx, noData };
    })().catch(() => null));
    return files.get(id);
  };
  return {
    name: 'hrdem',
    async sample(points) {
      const out = new Array(points.length).fill(null);
      const byFile = new Map();
      points.forEach(([lat, lon], i) => {
        const [x, y] = toCanadaLambert(lat, lon), id = hrdemTileId(x, y);
        if (!byFile.has(id)) byFile.set(id, []);
        byFile.get(id).push([i, x, y]);
      });
      for (const [id, pts] of byFile) {
        const f = await open(id);
        if (!f) continue;
        // read in 512-pixel blocks (the files' internal tiling) so memory stays small on big areas
        const blocks = new Map();
        for (const [i, x, y] of pts) {
          const c = (x - f.x0) / f.px - 0.5, r = (f.y1 - y) / f.px - 0.5, key = `${Math.floor(c / 512)}/${Math.floor(r / 512)}`;
          if (!blocks.has(key)) blocks.set(key, []);
          blocks.get(key).push([i, c, r]);
        }
        for (const [key, bp] of blocks) {
          const [bc, br] = key.split('/').map(Number), c0 = bc * 512 - 1, r0 = br * 512 - 1, w = 514;
          const win = [Math.max(0, c0), Math.max(0, r0), Math.min(f.img.getWidth(), c0 + w), Math.min(f.img.getHeight(), r0 + w)];
          const [band] = await f.img.readRasters({ window: win, samples: [0] });
          const ww = win[2] - win[0], wh = win[3] - win[1];
          const at = (c, r) => {
            const v = band[Math.max(0, Math.min(wh - 1, r - win[1])) * ww + Math.max(0, Math.min(ww - 1, c - win[0]))];
            return v === f.noData || v < -1000 || Number.isNaN(v) ? null : v;
          };
          for (const [i, c, r] of bp) {
            const cx = Math.floor(c), ry = Math.floor(r), dx = c - cx, dy = r - ry;
            const v = [at(cx, ry), at(cx + 1, ry), at(cx, ry + 1), at(cx + 1, ry + 1)];
            if (v.some(z => z === null)) { out[i] = v.find(z => z !== null) ?? null; continue; }
            out[i] = v[0] * (1 - dx) * (1 - dy) + v[1] * dx * (1 - dy) + v[2] * (1 - dx) * dy + v[3] * dx * dy;
          }
        }
      }
      return out;
    },
  };
}

// Try each source in order; later sources fill points the earlier ones couldn't (outside LiDAR coverage).
// Returns {ele: [m|null], source: [name|null]}.
export async function sampleElevations(points, sources) {
  const ele = new Array(points.length).fill(null), source = new Array(points.length).fill(null);
  for (const src of sources) {
    const todo = [];
    ele.forEach((v, i) => { if (v === null) todo.push(i); });
    if (!todo.length) break;
    const got = await src.sample(todo.map(i => points[i]));
    got.forEach((v, k) => { if (v !== null && Number.isFinite(v)) { ele[todo[k]] = Math.round(v * 10) / 10; source[todo[k]] = src.name; } });
  }
  return { ele, source };
}

// Smooth elevations along each segment of routing data ({nodes:[[lat, lon, ele]], segs:[{p}]}), keeping
// junctions fixed. A triangular window of `window` metres each side. The router sums every rise between
// nodes, so DEM noise adds up to extra climb; on Burnaby (GPX total 2067 m) LiDAR reads 2307 m raw and
// 2210 m at 30 m, terrain tiles 2513 m raw and 2244 m at 50 m.
export const SMOOTHING = { hrdem: 30, 'terrain-tiles': 50 };
export function smoothAlongSegments(data, window = 30) {
  const N = data.nodes, out = N.map(n => n[2]);
  const lat0 = N[0][0] * Math.PI / 180, kx = Math.PI / 180 * 6371000 * Math.cos(lat0), ky = Math.PI / 180 * 6371000;
  for (const s of data.segs) {
    const p = s.p, d = [0];
    for (let k = 1; k < p.length; k++) d.push(d[k - 1] + Math.hypot((N[p[k]][1] - N[p[k - 1]][1]) * kx, (N[p[k]][0] - N[p[k - 1]][0]) * ky));
    for (let k = 1; k < p.length - 1; k++) {
      let sw = 0, se = 0;
      for (let j = 0; j < p.length; j++) {
        const w = window - Math.abs(d[j] - d[k]);
        if (w > 0 && N[p[j]][2] != null) { sw += w; se += w * N[p[j]][2]; }
      }
      if (sw > 0) out[p[k]] = Math.round(se / sw * 10) / 10;
    }
  }
  return { ...data, nodes: N.map((n, i) => [n[0], n[1], out[i]]) };
}
