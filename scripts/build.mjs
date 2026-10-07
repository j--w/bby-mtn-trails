// Bundles src/ into site/ with esbuild: every module keeps its path (site/js/*.js, site/widget/v1/*.js, which
// the pages, the widgets' workers and the tests import), npm imports are resolved, and code shared between
// modules goes into site/chunks/. tsc checks types and writes the .d.ts files first (npm run build).
// --watch rebuilds on change (no type check).
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

const entries = readdirSync('src', { recursive: true }).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts')).map(f => 'src/' + f);

// Leaflet's CSS, with its images inlined, for widget/v1/leaflet.ts to inject.
const css = await esbuild.build({ entryPoints: ['node_modules/leaflet/dist/leaflet.css'], bundle: true, minify: true, write: false,
  loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' });

const options = {
  entryPoints: entries, outbase: 'src', outdir: 'site', bundle: true, splitting: true, format: 'esm', platform: 'browser',
  target: 'es2022', minify: true, sourcemap: 'linked', chunkNames: 'chunks/[name]-[hash]', legalComments: 'linked', logLevel: 'warning',
  define: { __LEAFLET_CSS__: JSON.stringify(css.outputFiles[0].text) },
};
if (process.argv.includes('--watch')) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
