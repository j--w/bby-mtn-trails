// Route builder widget. mount(element, options) puts the route builder (controls, results, map, elevation profile)
// inside one element and lays it out there: side panel when it's wide, stacked when it's narrow.
// Types and docs: below and in model.ts (tsc emits them as trails-widget.d.ts). The panel and profile are Preact
// (htm templates) rendered from the state in mount(); the map is Leaflet, driven directly.
import type * as Leaflet from 'leaflet';
import { render } from 'preact';
import { html } from 'htm/preact';
import type { LatLonEle } from '../../js/types.js';
import { loadLeaflet, addStyles, baseLayers, esc, themeOf, download } from './common.js';
// The search runs in a worker started from this inlined code (see js/router-worker.ts).
import routerWorker from 'worker:../../js/router-worker.js';
import { WidgetError, readArea, trailheads, trailheadList, resolveParams, problem, solverParams, toRoute, fmtTime } from './model.js';
import type { AreaPackage, LoadedArea, Trailhead, TrailheadNode, RouteMode, RouteParams, Route, WorkerRoute } from './model.js';

export { WidgetError, readArea, trailheads };
export type { AreaPackage, Trailhead, RouteMode, PavedPreference, RouteParams, RoutePoint, Route, WidgetErrorCode } from './model.js';
export const version: string = '1.0.0';

// ---------- mounting ----------

export type RouteControl = 'mode' | 'distance' | 'climb' | 'start' | 'paved' | 'lap';

export interface MountOptions {
  /** An area, or the URL of an area file. Without one the widget says there's nothing to route on. */
  area?: AreaPackage | string;
  /** Starting values. Missing ones use the defaults in RouteParams. */
  params?: Partial<RouteParams>;
  /** Controls the runner sees. Default: all. Params behind hidden controls still apply.
   *  A training plan that fixes the target might show just ['start', 'paved', 'lap']. */
  controls?: RouteControl[];
  /** Search as soon as the area is ready. Default false. */
  autoBuild?: boolean;
  /** Parts of the widget. All default true. `results: false` hides the option list and GPX buttons:
   *  build your own from onRoutes and call select(). */
  panels?: { header?: boolean; results?: boolean; profile?: boolean };
  prefs?: {
    /** Seconds per km on flat trail, for estimatedTime. Default 390 (6:30/km). */
    pace?: number;
  };
  /** Default 'auto' (follows the system). Set --tw-accent, --tw-accent-soft, --tw-font, --tw-radius and
   *  --tw-radius-sm on any ancestor to match your app. */
  theme?: 'auto' | 'light' | 'dark';

  /** Routes from each search, best first (empty when nothing fits). */
  onRoutes?(routes: Route[]): void;
  /** The route on the map: the first after a search, then whatever the runner picks. */
  onRoute?(route: Route): void;
  /** Turns the widget's "Download GPX" button into "Use this route" and hands you the route.
   *  Without it the button downloads the GPX. */
  onExport?(route: Route, gpx: string): void;
  /** Problems worth telling the runner about. Without it they go to the console. */
  onError?(error: WidgetError): void;
}

export interface TrailWidget {
  /** Change options in place: a new area, a new target from the plan, other controls. Doesn't search;
   *  call build() after. Options you leave out keep their values. */
  update(options: Partial<MountOptions>): void;
  /** Search with the current params (including what the runner typed). Resolves with the routes, or []
   *  when nothing fits or the params are invalid (onError says which). */
  build(): Promise<Route[]>;
  /** Put this route on the map, as if the runner picked it. */
  select(routeId: string): void;
  readonly routes: readonly Route[];
  /** Null until the area has loaded. */
  readonly params: RouteParams | null;
  readonly area: AreaPackage | null;
  /** Stop the search worker and remove everything the widget added to the element. */
  destroy(): void;
}

// Leaflet as the page has it once loadLeaflet() resolves.
declare const L: typeof Leaflet;

const CONTROLS: RouteControl[] = ['mode', 'distance', 'climb', 'start', 'paved', 'lap'];
const LAPS = [0, 8000, 10000, 12000, 15000];
const PAVED_LABELS: Record<string, string> = { fine: 'Don’t mind', avoid: 'Avoid', 'avoid-strongly': 'Avoid strongly' };
// Tiles are light in both themes, so map overlays use fixed light-theme colours.
const MC = { ink: '#17202b', net: '#4d5f78', laps: ['#2155cc', '#a85f00', '#7b3fb4', '#1b7f45'] };

/* ---------- styles ---------- */
const CSS = `
.tw-grid.tw-nopanel{grid-template-columns:minmax(0,1fr)}
.tw-profile{border-top:1px solid var(--border);background:var(--surface);padding:8px 12px 6px;position:relative}
.tw-profile svg{width:100%;height:110px;display:block;touch-action:none}
.tw-tip{position:absolute;top:6px;right:12px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.tw-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tw-full{grid-column:1/-1}
.tw-unit{position:relative}
.tw-unit input{padding-right:40px;font-variant-numeric:tabular-nums}
.tw-unit span{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px;font-weight:400;pointer-events:none}
.tw-more{border-top:1px solid var(--border);padding-top:10px}
.tw-more summary{cursor:pointer;font-size:14px;font-weight:600;color:var(--accent);list-style:none}
.tw-more summary::-webkit-details-marker{display:none}
.tw-more summary::before{content:"+ "}
.tw-more[open] summary::before{content:"− "}
.tw-more .tw-form{margin-top:12px}
.tw-opts{display:grid;gap:8px}
.tw-opt{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:4px 12px;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);width:100%;cursor:pointer}
.tw-opt:hover{background:var(--surface-hover)}
.tw-opt[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.tw-letter{grid-row:span 2;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:14px}
.tw-nums{font-weight:600;font-variant-numeric:tabular-nums}
.tw-time{font-size:14px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.tw-sub{grid-column:2/4;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:13px;color:var(--muted)}
.tw-chip{display:inline-flex;align-items:center;white-space:nowrap;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600}
.tw-chip.ok{background:var(--done-soft);color:var(--done)}
.tw-chip.off{background:var(--partial-soft);color:var(--partial)}
.tw-fit{position:absolute;left:54px;top:10px;z-index:1000;min-height:34px;padding:0 12px;flex:none;font-size:14px;box-shadow:0 1px 4px rgba(23,32,43,.2)}
.tw-arrow{width:0;height:0;border-left:9px solid #17202b;border-top:5px solid transparent;border-bottom:5px solid transparent;filter:drop-shadow(0 0 1px #fff)}
.tw .leaflet-tooltip.tw-startlab{font-weight:700;font-size:12px;padding:2px 6px}`;

const fmtKm = (m: number) => (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';


/* ---------- mount ---------- */
/**
 * Trail route builder widget, v1 (trails-widget.js: a plain ES module, no build step for your page).
 *
 *   import { mount } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/trails-widget.js';
 *   const widget = mount(document.querySelector('#routes'), { area: 'https://example.org/my-area.trails.json' });
 *
 * The widget draws into the element you give it and lays itself out there (side panel when wide, stacked when
 * narrow), so give the element a height. Everything here stays backward compatible within v1.
 * Area setup is a separate widget (setup-widget.js) so pages that only build routes stay light.
 * Units: distances and climb in metres, times in seconds, coordinates [lat, lon] (WGS84).
 */
export function mount(element: HTMLElement, options: MountOptions = {}): TrailWidget {
  if (!(element instanceof HTMLElement)) throw new TypeError('mount() needs an element to draw into.');
  addStyles('trails-widget-v1-routes', CSS);
  let opts: MountOptions = { ...options };
  const root = document.createElement('div');
  root.className = 'tw';
  element.appendChild(root);

  // state (paint() renders the panel and profile from it)
  let area: LoadedArea | null = null, nodes: LatLonEle[] = [], TH: TrailheadNode[] = [], starts: number[] = [], netKm = 0, params: RouteParams | null = null;
  let raws: WorkerRoute[] = [], routes: Route[] = [], sel = 0, reach = 0, note = '', destroyed = false;
  // what the runner has typed in the number fields, kept as text so a half-typed value isn't rewritten
  let fields = { distance: '', climb: '' };
  let busyOn = false, toastMsg = '', tip = '', hoverPt: number | null = null;
  let map: Leaflet.Map | null = null, layers: { net: Leaflet.LayerGroup; th: Leaflet.LayerGroup; route: Leaflet.LayerGroup } | null = null;
  let hoverMk: Leaflet.CircleMarker | null = null;
  // Worker messages are the protocol in js/router-worker.ts.
  let reqId = 0; const waiting = new Map<number, (m: any) => void>();
  let ready: Promise<unknown> = Promise.resolve();

  const worker = (() => {
    const url = URL.createObjectURL(new Blob([routerWorker], { type: 'text/javascript' }));
    return Object.assign(new Worker(url, { type: 'module' }), { _url: url });
  })();
  worker.onmessage = e => {
    const m = e.data, done = waiting.get(m.id); waiting.delete(m.id);
    done?.(m);
  };
  worker.onerror = e => { e.preventDefault?.(); for (const d of waiting.values()) d(null); waiting.clear(); };
  const ask = (msg: object) => new Promise<any>(ok => { const id = ++reqId; waiting.set(id, ok); worker.postMessage({ ...msg, id }); });

  const fail = (err: WidgetError) => { if (opts.onError) opts.onError(err); else console.warn('[trails-widget]', err.message); };
  type Hook = 'onRoutes' | 'onRoute' | 'onExport';
  const fire = <K extends Hook>(name: K, ...a: Parameters<NonNullable<MountOptions[K]>>) => { try { (opts[name] as ((...x: unknown[]) => void) | undefined)?.(...a); } catch (err) { console.error(err); } };
  let toastT: ReturnType<typeof setTimeout> | undefined;
  const toast = (m: string) => { toastMsg = m; paint(); clearTimeout(toastT); toastT = setTimeout(() => { toastMsg = ''; paint(); }, 2800); };

  /* ----- area ----- */
  async function setArea(a: AreaPackage | string | undefined) {
    if (a == null) { area = null; showNotice('No area to route on yet.'); return; }
    let pkg: LoadedArea;
    try {
      if (typeof a === 'string') {
        const res = await fetch(a).catch(() => null);
        if (!res?.ok) throw new WidgetError('area-unreadable', 'That area file couldn’t be loaded.');
        pkg = readArea(await res.text()) as LoadedArea;
      } else pkg = (a as LoadedArea).data ? a as LoadedArea : readArea(a) as LoadedArea;
    } catch (err) { area = null; showNotice((err as Error).message); fail(err instanceof WidgetError ? err : new WidgetError('area-unreadable', (err as Error).message)); return; }
    if (destroyed) return;
    area = pkg; nodes = area.data.nodes; TH = trailheadList(area);
    const r = await ask({ type: 'area', data: area.data });
    if (!r || destroyed) return;
    netKm = r.km; starts = r.starts;
    params = resolveParams(TH, opts.params, params || undefined); syncFields();
    raws = []; routes = []; sel = 0;
    paint();
    await mapReady; drawNetwork(); fitRoute();
  }

  /* ----- controls ----- */
  const shown = () => new Set(opts.controls ? opts.controls.filter(c => CONTROLS.includes(c)) : CONTROLS);
  const typing = () => { const c = shown(); return params!.mode !== 'longest' && (c.has('distance') || c.has('climb')); };
  function syncFields() { fields = { distance: String(params!.distance / 1000), climb: String(params!.climb) }; }
  // the number fields into params (the selects write params as they change)
  function readForm() {
    if (!params || !typing()) return;
    const c = shown();
    if (c.has('distance')) params.distance = +fields.distance * 1000;
    if (c.has('climb')) params.climb = +fields.climb;
  }
  const setParam = (k: 'start' | 'paved' | 'lap', v: string) => { (params as unknown as Record<string, string | number>)[k] = k === 'lap' ? +v : v; };
  function Controls() {
    if (!area || !params) return null;
    const p = params, c = shown(), all = c.size === CONTROLS.length, longest = p.mode === 'longest';
    const lapOpts = LAPS.includes(p.lap) ? LAPS : [...LAPS, p.lap].sort((a, b) => a - b);
    const num = (k: 'distance' | 'climb', label: string, unit: string, min: number, max: number, step: number) => html`
      <label class="tw-f">${label}<div class="tw-unit"><input type="number" data-k=${k} min=${min} max=${max} step=${step} value=${fields[k]}
        onInput=${(e: Event) => { fields[k] = (e.currentTarget as HTMLInputElement).value; paint(); }} /><span>${unit}</span></div></label>`;
    const select = (k: 'start' | 'paved' | 'lap', label: string, value: string | number, opts: Array<[string | number, string]>, full = false) => html`
      <label class=${'tw-f' + (full ? ' tw-full' : '')}>${label}<select data-k=${k} value=${String(value)} onChange=${(e: Event) => setParam(k, (e.currentTarget as HTMLSelectElement).value)}>
        ${opts.map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}</select></label>`;
    const field: Record<RouteControl, unknown> = {
      mode: html`<div class="tw-seg tw-full" role="group" aria-label="What to build">
        ${(['target', 'longest'] as RouteMode[]).map(m => html`<button type="button" data-mode=${m} aria-pressed=${String(p.mode === m)}
          onClick=${() => { readForm(); p.mode = m; paint(); }}>${m === 'target' ? 'Hit a target' : 'Longest loop'}</button>`)}</div>`,
      start: select('start', 'Start', p.start, TH.map(t => [t.id, `${t.name} · ${t.ele} m`]), true),
      distance: longest ? null : num('distance', 'Distance', 'km', 3, 80, 0.5),
      climb: longest ? null : num('climb', 'Climb', 'm', 0, 5000, 50),
      lap: longest ? null : select('lap', 'Back at start every', p.lap, lapOpts.map(v => [v, v ? `~${v / 1000} km` : 'Don’t need to'])),
      paved: longest ? null : select('paved', 'Paved sections', p.paved, Object.entries(PAVED_LABELS)),
    };
    const pick = (ks: RouteControl[]) => ks.filter(k => c.has(k) && field[k]).map(k => field[k]);
    const extra = pick(['lap', 'paved']), D = +fields.distance, E = +fields.climb;
    return html`
      ${pick(['mode', 'start'])}
      ${longest && html`<p class="tw-small tw-full">The longest loops from this start, from no repeated trail up to covering every trail with as few repeats as possible.</p>`}
      ${pick(['distance', 'climb'])}
      ${!longest && c.has('distance') && c.has('climb') && html`<p class="tw-small tw-full" data-ratio>${D > 0 ? `${Math.round(E / D)} m of climb per km` : ''}</p>`}
      ${all && extra.length ? html`<details class="tw-more tw-full"><summary>More options</summary><div class="tw-form">${extra}</div></details>` : extra}
      <div class="tw-row tw-full"><button type="submit" class="tw-btn tw-primary" data-go disabled=${busyOn}>Build routes</button>
        ${!longest && html`<button type="button" class="tw-btn" data-shuffle onClick=${() => { readForm(); p.seed = Math.floor(Math.random() * 90000) + 10000; build(); }}>New variations</button>`}</div>`;
  }

  /* ----- search ----- */
  async function build() {
    await ready;
    if (!area || destroyed) return [];
    readForm();
    const bad = problem(params!);
    if (bad) { toast(bad); fail(new WidgetError('invalid-params', bad)); return []; }
    const p = { ...params! }, ti = TH.findIndex(t => t.id === p.start);
    busy(true);
    const r = await ask({ type: 'search', params: solverParams(p, starts[ti]) });
    if (destroyed) return [];
    if (!r || r.error) {
      if (r?.id === reqId || !r) { busy(false); toast('Something went wrong building routes. Try other settings.'); }
      fail(new WidgetError('search-failed', r?.error || 'The route search stopped.'));
      return [];
    }
    const latest = r.id === reqId;
    const found = r.routes.map((x, i) => toRoute(x, i, { area: area!, nodes, params: p, start: publicTh(TH[ti]), pace: opts.prefs?.pace }));
    if (!latest) return found;
    raws = r.routes; routes = found; reach = r.reach; sel = 0;
    note = noteFor(p);
    busy(false); renderAll(); fitRoute();
    fire('onRoutes', routes);
    if (!routes.length) fail(new WidgetError('no-route', 'No loop fits these settings from this start.'));
    else fire('onRoute', routes[0]);
    return found;
  }
  const publicTh = ({ node, ...t }: TrailheadNode): Trailhead => t;
  function busy(on: boolean) { busyOn = on; paint(); }
  function noteFor(p: RouteParams) {
    if (!routes.length) return 'No loop fits these settings from this start. Try a shorter distance or another start.';
    if (p.mode === 'longest') return '';
    const g = routes[0].climb;
    if (g < p.climb * 0.85) return `The closest is ${Math.round(g)} m of climb. ${p.distance / 1000} km isn’t enough to reach ${p.climb} m without lots of repeats. Try a longer distance.`;
    if (g > p.climb * 1.2) return `Hard to keep this flat: the closest is ${Math.round(g)} m of climb.`;
    return '';
  }

  /* ----- results ----- */
  const panelOn = (k: 'header' | 'results' | 'profile') => opts.panels?.[k] !== false;
  function chip(what: string, val: number, target: number, tol: number, unit: string) {
    const off = val - target, ok = Math.abs(off) <= tol;
    return html`<span class=${'tw-chip ' + (ok ? 'ok' : 'off')}>${ok ? what + ' on target' : (off > 0 ? '+' : '') + Math.round(off) + ' ' + unit + ' ' + what.toLowerCase()}</span>`;
  }
  const pct = (a: number, b: number) => Math.round(a / b * 100);
  function Results() {
    if (!panelOn('results') || (!routes.length && !note)) return null;
    if (!routes.length) return html`<div class="tw-notice">${note}</div>`;
    const p = routes[0].params, longest = p.mode === 'longest';
    return html`<h2 class="tw-title">${longest ? 'Longest loops' : 'Options'}</h2>${note && html`<div class="tw-notice">${note}</div>`}
      <div class="tw-opts">${routes.map((r, i) => html`
        <button type="button" class="tw-opt" data-i=${i} aria-pressed=${String(i === sel)} onClick=${() => choose(i, true)}>
          <span class="tw-letter">${'ABC'[i]}</span>
          <span class="tw-nums">${longest ? r.label + ' · ' + fmtKm(r.distance) : fmtKm(r.distance) + ' · ↑' + Math.round(r.climb) + ' m'}</span>
          <span class="tw-time">~${fmtTime(r.estimatedTime)}</span>
          <span class="tw-sub">${longest
            ? `↑${Math.round(r.climb)} m · ${Math.round(Math.min(100, (r.distance - r.repeated) / 1000 / reach * 100))}% of trails · ${pct(r.repeated, r.distance)}% repeated`
            : html`${chip('Distance', r.distance / 1000, p.distance / 1000, p.distance / 1000 * 0.05, 'km')} ${chip('Climb', r.climb, p.climb, Math.max(40, p.climb * 0.08), 'm')} ${pct(r.repeated, r.distance)}% repeated${r.paved > 200 ? ` · ${fmtKm(r.paved)} paved` : ''}${r.laps > 1 ? ` · ${r.laps} laps` : ''}`}</span>
        </button>`)}</div>
      <p class="tw-small" style="margin-top:8px">Time assumes ${paceText()}/km plus 4 s per metre of climb.</p>`;
  }
  const paceText = () => { const s = opts.prefs?.pace || 390; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
  function Take() {
    const r = routes[sel];
    if (!r || !panelOn('results')) return null;
    const dl = () => {
      const gpx = r.gpx();
      if (opts.onExport) return fire('onExport', r, gpx);
      download(gpx, `${(area!.name + ' ' + r.label).replace(/[^\w .-]/g, '')}.gpx`, 'application/gpx+xml');
    };
    const copy = async () => { try { await navigator.clipboard.writeText(r.gpx()); toast('GPX copied.'); } catch { toast('Copying isn’t allowed here. Use Download instead.'); } };
    return html`<h2 class="tw-title">Take it with you</h2><div class="tw-row"><button type="button" class="tw-btn tw-primary" data-dl onClick=${dl}>${opts.onExport ? 'Use this route' : 'Download GPX'}</button><button type="button" class="tw-btn" data-copy onClick=${copy}>Copy GPX</button></div>`;
  }
  function choose(i: number, fit: boolean) {
    sel = i;
    renderAll(); if (fit) fitRoute();
    fire('onRoute', routes[sel]);
  }
  function showNotice(text: string) { note = text; routes = []; raws = []; renderAll(); }

  /* ----- map ----- */
  const LL = (n: number): [number, number] => [nodes[n][0], nodes[n][1]];
  function drawNetwork() {
    if (!map || !layers || !area) return;
    layers.net.clearLayers(); layers.th.clearLayers();
    for (const s of area.data.segs) L.polyline(s.p.map(LL), { color: MC.net, weight: 2, opacity: .55, interactive: false }).addTo(layers.net);
    for (const t of TH) L.circleMarker(t.at, { radius: 4, color: MC.ink, weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(esc(t.name)).addTo(layers.th);
  }
  function renderMap() {
    if (!map || !layers) return;
    layers.route.clearLayers(); hoverMk = null;
    const r = raws[sel]; if (!r) return;
    const pts = r.geom.pts, runs: { lap: number; ll: [number, number][] }[] = []; let cur = { lap: pts[0].lap, ll: [LL(pts[0].n)] };
    for (let i = 1; i < pts.length; i++) { cur.ll.push(LL(pts[i].n)); if (pts[i].lap !== cur.lap) { runs.push(cur); cur = { lap: pts[i].lap, ll: [LL(pts[i].n)] }; } }
    runs.push(cur);
    for (const run of runs) L.polyline(run.ll, { color: '#fff', weight: 8, opacity: .9, interactive: false }).addTo(layers.route);
    for (const run of runs) L.polyline(run.ll, { color: MC.laps[Math.max(0, run.lap) % 4], weight: 4.5, opacity: .95, interactive: false }).addTo(layers.route);
    const cos0 = Math.cos(nodes[0][0] * Math.PI / 180);
    let nextAt = 400;   // direction arrows every ~800 m
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].cum < nextAt) continue; nextAt += 800;
      const a = nodes[pts[i - 1].n], b = nodes[pts[i].n], ang = Math.atan2(-(b[0] - a[0]), (b[1] - a[1]) * cos0) * 180 / Math.PI;
      L.marker(LL(pts[i].n), { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [10, 10], html: `<div class="tw-arrow" style="transform:rotate(${ang.toFixed(0)}deg)"></div>` }) }).addTo(layers.route);
    }
    L.circleMarker(routes[sel].start.at, { radius: 7, color: '#fff', weight: 2.5, fillColor: MC.ink, fillOpacity: 1, interactive: false })
      .bindTooltip('Start / finish', { permanent: true, direction: 'right', offset: [8, 0], className: 'tw-startlab' }).addTo(layers.route);
  }
  function setHover(i: number | null) {
    const r = raws[sel];
    if (i == null || !r || !map || !layers) { hoverMk?.remove(); hoverMk = null; return; }
    const ll = LL(r.geom.pts[i].n);
    if (!hoverMk) hoverMk = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: MC.laps[0], fillOpacity: 1, interactive: false }).addTo(layers.route);
    else hoverMk.setLatLng(ll);
  }
  function fitRoute() {
    if (!map || !area) return;
    const r = raws[sel];
    const b = r ? L.latLngBounds(r.geom.pts.map(p => LL(p.n))) : L.latLngBounds(nodes.map((n): [number, number] => [n[0], n[1]]));
    map.fitBounds(b, { padding: [30, 30] });
  }

  /* ----- elevation profile ----- */
  let profEl: SVGSVGElement | null = null, profX: { pl: number; pr: number; W: number; total: number } | null = null;
  function Profile() {
    const W = profEl?.getBoundingClientRect().width || 600, H = 110, r = raws[sel];
    profX = null;
    if (!r) return html`<svg aria-label="Elevation profile" viewBox=${`0 0 ${W} ${H}`} ref=${(e: SVGSVGElement | null) => { profEl = e; }}></svg>`;
    const pts = r.geom.pts, total = pts[pts.length - 1].cum, es = pts.map(p => nodes[p.n][2] ?? 0);
    const lo = Math.min(...es), hi = Math.max(...es), pl = 44, pr = 8, pt = 10, pb = 20;
    const xs = (d: number) => pl + d / total * (W - pl - pr), ys = (e: number) => H - pb - (e - lo) / Math.max(1, hi - lo) * (H - pt - pb);
    const lbl = { 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--font)' };
    const step = total > 30000 ? 10000 : total > 12000 ? 5000 : 2000, ticks: number[] = [];
    for (let d = 0; d <= total; d += step) ticks.push(d);
    const line = pts.map((p, i) => xs(p.cum).toFixed(1) + ',' + ys(es[i]).toFixed(1)).join(' ');
    profX = { pl, pr, W, total };
    const h = hoverPt != null ? pts[hoverPt] : null;
    return html`<svg aria-label="Elevation profile" viewBox=${`0 0 ${W} ${H}`} ref=${(e: SVGSVGElement | null) => { profEl = e; }} onPointerMove=${hoverProfile} onPointerLeave=${leaveProfile}>
      ${[lo, hi].map(v => html`<line x1=${pl} x2=${W - pr} y1=${ys(v)} y2=${ys(v)} stroke="var(--grid)" /><text x=${pl - 6} y=${ys(v) + 4} text-anchor="end" ...${lbl}>${Math.round(v) + ' m'}</text>`)}
      ${ticks.map(d => html`<text x=${xs(d)} y=${H - 5} text-anchor=${d === 0 ? 'start' : 'middle'} ...${lbl}>${(d / 1000) + ' km'}</text>`)}
      <polygon points=${`${pl},${H - pb} ${line} ${W - pr},${H - pb}`} fill="var(--accent-soft)" />
      <polyline points=${line} fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" />
      ${r.geom.cuts.slice(1).map(c => html`<line x1=${xs(c)} x2=${xs(c)} y1=${pt} y2=${H - pb} stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1" />`)}
      ${h && html`<line x1=${xs(h.cum)} x2=${xs(h.cum)} y1=${pt} y2=${H - pb} stroke="var(--text)" stroke-width="1" /><circle cx=${xs(h.cum)} cy=${ys(es[hoverPt!])} r="3.5" fill="var(--accent)" />`}
    </svg>`;
  }
  function hoverProfile(e: PointerEvent) {
    const r = raws[sel]; if (!r || !profX || !profEl) return;
    const b = profEl.getBoundingClientRect(), { pl, pr, W, total } = profX;
    const d = Math.max(0, Math.min(total, ((e.clientX - b.left) / b.width * W - pl) / (W - pl - pr) * total));
    const pts = r.geom.pts; let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].cum < d) lo = m; else hi = m; }
    hoverPt = hi; tip = `${(pts[hi].cum / 1000).toFixed(2)} km · ${Math.round(nodes[pts[hi].n][2] ?? 0)} m`;
    setHover(hi); paint();
  }
  function leaveProfile() { hoverPt = null; tip = ''; setHover(null); paint(); }

  /* ----- the whole widget ----- */
  function App() {
    const panelEmpty = !panelOn('results') && opts.controls?.length === 0 && opts.panels?.header === false;
    return html`<div class=${'tw-grid' + (panelEmpty ? ' tw-nopanel' : '')}>
      <div class="tw-panel" hidden=${panelEmpty}>
        <div class="tw-head" hidden=${opts.panels?.header === false}>${area && html`<b>${area.name || 'Trail routes'}</b><span>${netKm.toFixed(0)} km of trail · ${TH.length} trailhead${TH.length === 1 ? '' : 's'}</span>`}</div>
        <form class="tw-form" novalidate onSubmit=${(e: Event) => { e.preventDefault(); build(); }}><${Controls} /></form>
        <div class="tw-results"><${Results} /></div>
        <div class="tw-take"><${Take} /></div>
        <p class="tw-credits">${area && html`Elevations are approximate. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.${area.attribution?.length > 1 ? ' ' + area.attribution.slice(1).join('. ') + '.' : ''}`}</p>
      </div>
      <div class="tw-mapcol">
        <div class="tw-mapwrap"><div class="tw-map" role="region" aria-label="Route map"></div>
          <button type="button" class="tw-btn tw-fit" onClick=${fitRoute}>Fit route</button>
          <div class="tw-busy" hidden=${!busyOn}>Building routes…</div><div class="tw-toast" role="status" hidden=${!toastMsg}>${toastMsg}</div></div>
        <div class="tw-profile" hidden=${!panelOn('profile')}><${Profile} /><div class="tw-tip">${tip}</div></div>
      </div></div>`;
  }
  function paint() { if (!destroyed) render(html`<${App} />`, root); }
  function renderAll() { hoverPt = null; tip = ''; renderMap(); paint(); }
  function applyLayout() { root.dataset.theme = themeOf(opts.theme); paint(); }

  paint();
  const mapReady = loadLeaflet().then(L => {
    if (destroyed) return;
    map = L.map(root.querySelector<HTMLElement>('.tw-map')!, { zoomSnap: 0.25, preferCanvas: true });
    baseLayers(L, map);
    layers = { net: L.layerGroup().addTo(map), th: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map) };
    map.setView([20, 0], 2);
  }, err => fail(err));
  let resizeT: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { map?.invalidateSize(); paint(); }, 100); });
  ro.observe(root);

  applyLayout();
  ready = setArea(opts.area);
  if (opts.autoBuild) ready.then(() => area && build());

  return {
    update(next: Partial<MountOptions> = {}) {
      const areaChanged = 'area' in next && next.area !== opts.area;
      opts = { ...opts, ...next, panels: { ...opts.panels, ...next.panels } };
      if (areaChanged) { applyLayout(); ready = setArea(opts.area); return; }
      if (area && next.params) { readForm(); params = resolveParams(TH, next.params, params || undefined); syncFields(); }
      applyLayout();
    },
    build,
    select(id: string) {
      const i = routes.findIndex(r => r.id === id);
      if (i < 0) throw new WidgetError('no-route', `No route with id ${id}.`);
      choose(i, true);
    },
    get routes() { return routes.slice(); },
    get params() { return params ? { ...params } : null; },
    get area() { return area; },
    destroy() {
      destroyed = true; ro.disconnect(); clearTimeout(toastT); clearTimeout(resizeT);
      worker.terminate(); URL.revokeObjectURL(worker._url);
      for (const d of waiting.values()) d(null); waiting.clear();
      map?.remove(); render(null, root); root.remove();
    },
  };
}
