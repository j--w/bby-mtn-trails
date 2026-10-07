// What the widgets share: Leaflet loading, the theme tokens and base styles (everything scoped under .tw), map
// layers and small helpers. Hosts restyle both widgets with --tw-accent, --tw-accent-soft, --tw-font, --tw-radius and
// --tw-radius-sm on any ancestor.
import type * as Leaflet from 'leaflet';
import { WidgetError } from './model.js';

const LEAFLET = {
  css: ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='],
  js: ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
};
type LeafletNS = typeof Leaflet;
const page = globalThis as { L?: LeafletNS };
let leaflet: Promise<LeafletNS> | null = null;
export function loadLeaflet(): Promise<LeafletNS> {
  if (page.L?.map) return Promise.resolve(page.L);
  if (leaflet) return leaflet;
  if (!document.querySelector('link[href*="leaflet"]')) {
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET.css[0], integrity: LEAFLET.css[1], crossOrigin: 'anonymous' });
    document.head.appendChild(l);
  }
  return leaflet = new Promise<LeafletNS>((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: LEAFLET.js[0], integrity: LEAFLET.js[1], crossOrigin: 'anonymous' });
    s.onload = () => ok(page.L!); s.onerror = () => { leaflet = null; fail(new WidgetError('map-unavailable', 'The map library couldn’t load.')); };
    document.head.appendChild(s);
  });
}

// Each widget adds its own styles once per page, after the shared ones.
const BASE_CSS = `
.tw{--accent:var(--tw-accent,#2155cc);--accent-soft:var(--tw-accent-soft,#e9effc);--on-accent:#fff;
  --bg:#f5f6f8;--surface:#fff;--surface-hover:#fafbfc;--text:#17202b;--muted:#5d6775;--faint:#8a93a0;
  --border:#dde1e7;--border-strong:#c7cdd5;--grid:#eceff3;--done:#1b7f45;--done-soft:#e5f4ea;--partial:#a85f00;--partial-soft:#fcf0dc;
  --font:var(--tw-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);--radius:var(--tw-radius,10px);--radius-sm:var(--tw-radius-sm,8px);
  color-scheme:light;container-type:inline-size;height:100%;min-height:420px;background:var(--bg);color:var(--text);
  font:15px/1.45 var(--font);-webkit-font-smoothing:antialiased;overflow:hidden;border-radius:inherit}
.tw[data-theme=dark]{--accent:var(--tw-accent,#7aa2ff);--accent-soft:var(--tw-accent-soft,#1d2a47);--on-accent:#0f141b;
  --bg:#0f141b;--surface:#171d26;--surface-hover:#1c2330;--text:#e6eaf0;--muted:#9aa4b2;--faint:#6c7685;
  --border:#2a3240;--border-strong:#3a4454;--grid:#222a36;--done:#5cc98a;--done-soft:#17301f;--partial:#f0a54a;--partial-soft:#3a2a12;color-scheme:dark}
@media (prefers-color-scheme:dark){.tw[data-theme=auto]{--accent:var(--tw-accent,#7aa2ff);--accent-soft:var(--tw-accent-soft,#1d2a47);--on-accent:#0f141b;
  --bg:#0f141b;--surface:#171d26;--surface-hover:#1c2330;--text:#e6eaf0;--muted:#9aa4b2;--faint:#6c7685;
  --border:#2a3240;--border-strong:#3a4454;--grid:#222a36;--done:#5cc98a;--done-soft:#17301f;--partial:#f0a54a;--partial-soft:#3a2a12;color-scheme:dark}}
.tw *,.tw *::before,.tw *::after{box-sizing:border-box}
.tw [hidden]{display:none!important}
.tw button,.tw input,.tw select,.tw textarea{font:inherit;color:inherit}
.tw :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tw p{margin:0}
.tw-grid{height:100%;display:grid;grid-template-columns:340px minmax(0,1fr)}
.tw-panel{background:var(--surface);border-right:1px solid var(--border);overflow:auto;padding:18px 18px 24px;display:flex;flex-direction:column;gap:18px;min-width:0}
.tw-head b{display:block;font-size:18px;line-height:1.25}
.tw-head span{color:var(--muted);font-size:13px}
.tw-title{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tw-mapcol{display:grid;grid-template-rows:minmax(0,1fr) auto;min-width:0;min-height:0}
.tw-mapwrap{position:relative;min-height:0}
.tw-map{position:absolute;inset:0;background:var(--grid)}
.tw-map.leaflet-container{font:inherit}
.tw-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;flex:1 1 auto;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);font-weight:500;cursor:pointer}
.tw-btn:hover{background:var(--surface-hover)}
.tw-btn:disabled{opacity:.6;cursor:default}
.tw-btn.tw-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.tw-seg{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--grid)}
.tw-seg button{flex:1;min-height:36px;padding:6px 10px;border:0;border-radius:7px;background:none;font-size:14px;color:var(--muted);cursor:pointer;white-space:nowrap}
.tw-seg button[aria-pressed=true]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(23,32,43,.12)}
.tw-f{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
.tw input[type=number],.tw select{font-size:16px;font-weight:400;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-sm);min-height:44px;padding:0 12px;width:100%}
.tw-small{font-size:13px;color:var(--muted)}
.tw-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tw-notice{border-radius:var(--radius-sm);padding:10px 12px;font-size:14px;background:var(--partial-soft);color:var(--text);margin-bottom:8px}
.tw-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;max-width:calc(100% - 32px);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:var(--radius-sm);font-size:14px;box-shadow:0 6px 20px rgba(23,32,43,.2)}
.tw-busy{position:absolute;right:12px;bottom:28px;z-index:1000;background:var(--surface);color:var(--text);padding:8px 12px;border-radius:var(--radius-sm);font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(23,32,43,.15)}
.tw-credits{margin-top:auto;font-size:12px;color:var(--faint)}
.tw-credits a{color:inherit}
@container (max-width:720px){
  .tw-grid{display:flex;flex-direction:column;height:100%;overflow:auto}
  .tw-panel{border-right:0;overflow:visible;order:2}
  .tw-mapcol{order:1;height:min(65vh,460px);min-height:300px;flex:none}
}
@media (prefers-reduced-motion:reduce){.tw *{transition:none!important;animation:none!important}}`;
export function addStyles(id: string, css: string) {
  if (!document.getElementById('trails-widget-v1')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'trails-widget-v1', textContent: BASE_CSS }));
  if (id && !document.getElementById(id)) document.head.appendChild(Object.assign(document.createElement('style'), { id, textContent: css }));
}

// Streets and topo tiles with a switcher and a metric scale.
export function baseLayers(L: LeafletNS, map: Leaflet.Map) {
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' });
  osm.addTo(map);
  L.control.layers({ Streets: osm, Topo: topo }, undefined, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
}

export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
export const themeOf = (t?: string) => t === 'light' || t === 'dark' ? t : 'auto';

// Save text as a file.
export function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
