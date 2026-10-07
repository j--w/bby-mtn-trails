// Elevation tests: tile maths, the Canada Lambert projection, source fallback and smoothing. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerrarium, tileXY, terrariumSource, toCanadaLambert, hrdemTileId, hrdemSource, sampleElevations, smoothAlongSegments } from '../site/js/elevation.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('terrarium decoding and tile coordinates', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(129, 44, 128), 300.5);
  const [x, y] = tileXY(49.278, -122.92, 15);
  close(x, 5195.5484, 1e-3); close(y, 11214.5777, 1e-3);   // from the Web Mercator formula in Python
});

test('terrarium source reads and interpolates the right pixels', async () => {
  // a tile whose elevation rises 1 m per pixel to the east: R,G encode 300 + column
  const loadTile = async url => {
    assert.match(url, /terrarium\/15\/5195\/11214\.png$/);
    const w = 256, data = new Uint8ClampedArray(w * w * 4);
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) { const v = 32768 + 300 + c, o = (r * w + c) * 4; data[o] = v >> 8; data[o + 1] = v & 255; }
    return { width: w, height: w, data };
  };
  const [ele] = await terrariumSource({ loadTile }).sample([[49.278, -122.92]]);
  const px = (5195.5484 - 5195) * 256 - 0.5;   // fractional pixel column
  close(ele, 300 + px, 0.05);
});

test('Canada Atlas Lambert matches pyproj (EPSG:4326 -> 3979) within 2 m', () => {
  for (const [lat, lon, x, y] of [[49.278, -122.92, -1964846.903, 469195.926], [60.5, -135.2, -2006111.632, 1914349.596], [45.4, -75.7, 1511128.106, -172193.982]]) {
    const [px, py] = toCanadaLambert(lat, lon);
    close(px, x, 2, 'x'); close(py, y, 2, 'y');
  }
  assert.equal(hrdemTileId(...toCanadaLambert(49.278, -122.92)), '2_3');   // the file that covers Burnaby
});

test('HRDEM source reads the 4 m overview of the right file', async () => {
  // fake geotiff.js: a 1 m full image and 2, 4, 8 m overviews; elevation = 100 + column of the image read
  const opened = [];
  const image = (w, res) => ({
    getWidth: () => w, getHeight: () => w, getResolution: () => [res, -res], getGDALNoData: () => -32767,
    getBoundingBox: () => [-2000000, 0, -1500000, 500000],
    readRasters: async ({ window: [c0, r0, c1, r1] }) => {
      const a = new Float32Array((c1 - c0) * (r1 - r0));
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) a[(r - r0) * (c1 - c0) + c - c0] = 100 + c;
      return [a];
    },
  });
  const geotiff = { fromUrl: async url => { opened.push(url); return { getImageCount: async () => 4, getImage: async k => image(500000 / 2 ** k, 2 ** k) }; } };
  const src = hrdemSource({ geotiff });
  const pts = [[49.278, -122.92], [49.279, -122.921]];
  const ele = await src.sample(pts);
  assert.deepEqual(opened, ['https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/2_3-mosaic-1m-dtm.tif']);
  const [x] = toCanadaLambert(...pts[0]);
  close(ele[0], 100 + ((x + 2000000) / 4 - 0.5), 0.01);
});

test('later sources fill what earlier ones miss', async () => {
  const lidar = { name: 'hrdem', sample: async p => p.map(([lat]) => lat > 49.5 ? null : 10) };
  const tiles = { name: 'terrain-tiles', sample: async p => p.map(() => 20) };
  const r = await sampleElevations([[49.2, -123], [49.8, -123]], [lidar, tiles]);
  assert.deepEqual(r, { ele: [10, 20], source: ['hrdem', 'terrain-tiles'] });
});

test('smoothing along segments trims noise but keeps junctions and net change', () => {
  // 200 m segment rising 20 m with ±1.5 m noise every 5 m
  const nodes = [], p = [];
  for (let i = 0; i <= 40; i++) { nodes.push([49.28 + i * 5 / 111195, -122.92, 300 + i * 0.5 + (i % 2 ? 1.5 : -1.5) * (i % 40 ? 1 : 0)]); p.push(i); }
  const up = ns => p.slice(1).reduce((s, k, i) => s + Math.max(0, ns[k][2] - ns[p[i]][2]), 0);
  const sm = smoothAlongSegments({ nodes, segs: [{ p }] }, 30);
  assert.ok(up(nodes) > 50);
  close(up(sm.nodes), 20, 2.5);
  assert.equal(sm.nodes[0][2], nodes[0][2]);
  assert.equal(sm.nodes[40][2], nodes[40][2]);
});
