// Bundles src/ into site/ with esbuild: every module keeps its path (site/js/*.js, site/widget/v1/*.js, which
// the pages, the widgets' workers and the tests import), npm imports are resolved, and code shared between
// modules goes into site/chunks/. tsc checks types and writes the .d.ts files first (npm run build).
// --watch rebuilds on change (no type check).
import * as esbuild from 'esbuild';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const entries = readdirSync('src', { recursive: true }).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts')).map(f => 'src/' + f);

// Leaflet's CSS, with its images inlined, for widget/v1/leaflet.ts to inject.
const css = await esbuild.build({ entryPoints: ['node_modules/leaflet/dist/leaflet.css'], bundle: true, minify: true, write: false,
  loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' });

// `import code from 'worker:./x.js'`: bundles x on its own (no shared chunks) and inlines it as a string, so a widget
// starts its worker from a blob and needs no other file at runtime. That keeps it working cross-origin and inside an
// app's own bundle, where the widget's files get renamed and moved.
const inlineWorker = { name: 'inline-worker', setup(b) {
  b.onResolve({ filter: /^worker:/ }, a => {
    const js = path.resolve(a.resolveDir, a.path.slice('worker:'.length)), ts = js.replace(/\.js$/, '.ts');
    return { path: existsSync(ts) ? ts : js, namespace: 'inline-worker' };
  });
  b.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async a => {
    const r = await esbuild.build({ entryPoints: [a.path], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      minify: true, write: false, metafile: true, legalComments: 'none', logLevel: 'warning' });
    return { contents: r.outputFiles[0].text, loader: 'text', watchFiles: Object.keys(r.metafile.inputs).map(f => path.resolve(f)) };
  });
} };

const options = {
  entryPoints: entries, outbase: 'src', outdir: 'site', bundle: true, splitting: true, format: 'esm', platform: 'browser',
  target: 'es2022', minify: true, sourcemap: 'linked', chunkNames: 'chunks/[name]-[hash]', legalComments: 'linked', logLevel: 'warning',
  define: { __LEAFLET_CSS__: JSON.stringify(css.outputFiles[0].text) }, plugins: [inlineWorker],
};
if (process.argv.includes('--watch')) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
