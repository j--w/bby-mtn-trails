// Area setup widget. mountSetup(element, options) puts area setup (pick a box, load OpenStreetMap trails and
// elevations, curate, save) inside one element. The finished area goes to onAreaSaved, or downloads as a file.
// The public types below (with their docs) are the v1 contract; tsc emits them as setup-widget.d.ts.
import type * as Leaflet from 'leaflet';
import { loadLeaflet, addStyles, baseLayers, esc, themeOf, download } from './common.js';
import { WidgetError, readArea } from './model.js';
import type { AreaPackage } from './model.js';
import type { LatLonEle } from '../../js/types.js';
import type { BBox, PieceState, RawNetwork } from '../../js/osm.js';
import type { DrawnPath, DrawnPoint, Edits, Suggestion } from '../../js/area-package.js';
import type { GpxTrack as Track, TrackMatch } from '../../js/gpx.js';
import type { AreaWorkerResponse, WorkerPiece as Piece } from '../../js/area-worker.js';
import { fetchOsm, parseOsm, bboxKm2, nodeIndex } from '../../js/osm.js';
import { sampleElevations, hrdemSource, terrariumSource, smoothAlongSegments, SMOOTHING, HRDEM_ATTRIBUTION, TERRARIUM_ATTRIBUTION } from '../../js/elevation.js';
import { makePackage, readPackage, emptyEdits, keyOf, withDrawn } from '../../js/area-package.js';
import { parseGpx as parseGpxRaw, matchTrack } from '../../js/gpx.js';
import { loadArea, saveArea } from '../../js/area-store.js';

export { WidgetError, readArea };
export type { AreaPackage };
export const version: string = '1.0.0';

/** A GPS track, e.g. a Strava activity's latlng (and altitude) streams. */
export interface GpsTrack {
  name?: string;
  /** [lat, lon] or [lat, lon, ele] */
  points: ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;
}

/** What the tracks show about the area being set up. */
export interface Coverage {
  /** Metres of mapped path (trail, road or sidewalk) the tracks run along. */
  followed: number;
  /** Of that, metres not in the area's network yet (the runner can add them in one tap). */
  missing: number;
  /** Metres of track where OpenStreetMap has no path at all. */
  offMap: number;
  /** The longer of those stretches, which the runner can add as drawn paths. */
  gaps: Array<{ points: Array<[lat: number, lon: number]>; length: number }>;
}

export interface SetupOptions {
  /** An area (or the URL of an area file) to keep editing. Without one, the runner starts by picking a box. */
  area?: AreaPackage | string;
  /** Where the map starts when picking a box, e.g. near the runner's home. Default: the whole world. */
  view?: { center: [lat: number, lon: number]; zoom?: number };
  /** The runner's tracks to check against the area: shown on the map, with their trails and the bits
   *  OpenStreetMap is missing offered to add. Not saved in the area. */
  tracks?: GpsTrack[];
  /** Let the runner load GPX files in the widget too. Default true. */
  gpxFiles?: boolean;
  /** Keep a draft in this browser (IndexedDB) so a half-finished area survives a reload, and offer to continue
   *  it. Default true. */
  draft?: boolean;
  /** `header: false` hides the title. Default true. */
  panels?: { header?: boolean };
  /** Default 'auto' (follows the system). The same --tw-* CSS variables as the route builder apply. */
  theme?: 'auto' | 'light' | 'dark';
  /** Text of the save button. Default 'Save area'. */
  saveLabel?: string;

  /** The runner saved the area: store it, or hand it to the route builder's update({ area }). The button waits
   *  while a returned promise runs; a rejection's message is shown. Without this, saving downloads the file. */
  onAreaSaved?(area: AreaPackage): void | Promise<void>;
  /** Coverage whenever the tracks or the network change; null when there are no tracks. */
  onCoverage?(coverage: Coverage | null): void;
  /** Problems worth telling the runner about. Without it they go to the console. */
  onError?(error: WidgetError): void;
}

export interface SetupWidget {
  /** Change options in place: new tracks from your app, another area to edit, other callbacks.
   *  Options you leave out keep their values. */
  update(options: Partial<SetupOptions>): void;
  /** The area as it stands, or null until it has a trailhead on a routable trail. */
  readonly area: AreaPackage | null;
  /** Stop the worker and remove everything the widget added to the element. */
  destroy(): void;
}

/* ---------- internal shapes ---------- */
// what the worker sends back when a compile worked
type Compiled = Exclude<AreaWorkerResponse, { error: string }>;
// the draft kept in IndexedDB: the loaded area, then the latest edits under 'draft-edits'
interface Draft { bbox: BBox; raw: RawNetwork; ele: SetupState['ele']; osmTimestamp: string | null; edits: Edits; name: string }
interface DrawPt { node: number | null; ll: Leaflet.LatLng; ele?: number | null }
type Tool = 'select' | 'trailhead' | 'split' | 'join' | 'draw';
type Step = 'area' | 'trails' | 'save';
// a tap near a piece: segment k of its path, t along it, node the nearer end
interface Hit { d: number; piece: Piece; k: number; t: number; node: number }
interface SetupState {
  step: Step; bbox: BBox | null; raw: RawNetwork | null; view: RawNetwork | null; keyIdx: Map<string, number> | null; focus: string | null;
  drawPts: DrawPt[]; hostTracks: Track[]; fileTracks: Track[]; match: TrackMatch | null; edits: Edits; name: string;
  ele: { sources: Record<string, number>; missing: number } | null; osmTimestamp: string | null; res: Compiled | null; pieces: Piece[];
  tool: Tool; undo: string[]; joinFrom: number | null; corners: Leaflet.LatLng[]; picking: boolean;
}
type Layers = Record<'box' | 'draw' | 'hover' | 'piece' | 'extra' | 'poi' | 'th' | 'track', Leaflet.LayerGroup>;

/** GPX text to tracks, one per track segment or route. Handy when your app has files rather than streams. */
export function parseGpx(text: string): GpsTrack[] {
  return (parseGpxRaw(text)).map(t => ({ name: t.name, points: t.pts.map(([lat, lon, ele]): GpsTrack['points'][number] => ele == null ? [lat, lon] : [lat, lon, ele]) }));
}
const toInternal = (tracks?: GpsTrack[]): Track[] => (tracks || []).filter(t => t?.points?.length > 1)
  .map(t => ({ name: t.name || '', pts: t.points.map((p): LatLonEle => [+p[0], +p[1], p[2] == null ? null : +p[2]]) }));

const WARN_KM2 = 30, MAX_KM2 = 120;
// Tiles are light in both themes, so overlays use fixed light-theme colours.
const MC = { in: '#2155cc', auto: '#a85f00', cut: '#c2410c', off: '#8a93a0', road: '#b0b8c4', sugg: '#7b3fb4', track: '#d6336c', ink: '#17202b' };
// one set of sources per page, so the LiDAR file headers are read once
const ELE_SOURCES = [hrdemSource(), terrariumSource()];
// Compiling runs in a module worker made from a blob, so it works when this module comes from another site.
const AREA_WORKER = new URL('../../js/area-worker.js', import.meta.url).href;

const CSS = `
.tws-stack{display:flex;flex-direction:column;gap:12px}
.tws-steps{display:flex;gap:6px;font-size:13px;font-weight:600;color:var(--faint)}
.tws-steps span[aria-current=step]{color:var(--accent)}
.tw-btn.tw-quiet{border-color:transparent;color:var(--accent);flex:0 1 auto;background:none}
.tw-btn.tw-sm{min-height:34px;padding:0 10px;font-size:14px;flex:none}
label.tw-btn{cursor:pointer}
.tws input[type=text]{font-size:16px;font-weight:400;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-sm);min-height:44px;padding:0 12px;width:100%}
.tws input.tws-inline{min-height:34px;font-size:14px}
.tws-check{display:flex;gap:8px;align-items:center;font-size:14px;cursor:pointer}
.tw-notice.tws-ok{background:var(--done-soft)}
.tws-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.tws-stat{background:var(--grid);border-radius:var(--radius-sm);padding:8px 10px}
.tws-stat b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
.tws-stat span{font-size:12px;color:var(--muted)}
.tws-list{display:flex;flex-direction:column;gap:6px}
.tws-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px}
.tws-item.tws-focus{border-color:var(--accent);background:var(--accent-soft)}
.tws-what{font-size:14px}
.tws-what small{display:block;color:var(--muted);font-size:12px}
.tws-legend{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;font-size:13px;color:var(--muted);align-items:center}
.tws-sw{width:22px;height:0;border-top:4px solid}
.tws .tw-busy{left:50%;right:auto;top:16px;bottom:auto;transform:translateX(-50%);font-size:14px;padding:10px 14px}
.tws-hint{position:absolute;left:54px;top:10px;right:60px;z-index:1000;pointer-events:none}
.tws-hint span{display:inline-block;background:var(--surface);color:var(--text);padding:6px 10px;border-radius:var(--radius-sm);font-size:13px;box-shadow:0 1px 4px rgba(23,32,43,.2)}
.tws .tw-map.tws-picking,.tws .tw-map.tws-cross{cursor:crosshair}
.tws .tw-map.tws-hit{cursor:pointer}
.tws .leaflet-tooltip.tws-thlab{font-weight:700;font-size:12px;padding:2px 6px}`;

const PANEL = `
<div class="tw-head"><b>Set up an area</b><span>Pick the trails you run, then build routes on them.</span></div>
<div class="tws-steps" aria-label="Steps"><span data-el="st-area">1 Area</span>·<span data-el="st-trails">2 Trails</span>·<span data-el="st-save">3 Save</span></div>

<section data-el="p-area" class="tws-stack">
  <p class="tw-small">Move the map to the trails you want, then mark the area. Keep it to the trail network and a little road around it.</p>
  <div class="tw-row"><button type="button" class="tw-btn" data-el="draw">Mark two corners</button><button type="button" class="tw-btn" data-el="useview">Use this view</button></div>
  <p class="tw-small" data-el="areainfo"></p>
  <div class="tw-notice" data-el="areawarn" hidden></div>
  <button type="button" class="tw-btn tw-primary" data-el="loadbtn" disabled>Load trails</button>
  <div class="tw-row">
    <button type="button" class="tw-btn tw-quiet" data-el="resume" hidden></button>
    <label class="tw-btn tw-quiet">Open an area file<input type="file" data-el="openfile" accept=".json,application/json" hidden></label>
  </div>
</section>

<section data-el="p-trails" class="tws-stack" hidden>
  <div class="tws-stats">
    <div class="tws-stat"><b data-el="s-km">0</b><span>km routable</span></div>
    <div class="tws-stat"><b data-el="s-th">0</b><span>trailheads</span></div>
    <div class="tws-stat"><b data-el="s-sug">0</b><span>suggestions</span></div>
  </div>
  <div class="tw-seg" role="group" aria-label="Tool">
    <button type="button" data-tool="select" aria-pressed="true">Trails</button>
    <button type="button" data-tool="trailhead" aria-pressed="false">Trailhead</button>
    <button type="button" data-tool="split" aria-pressed="false">Split</button>
    <button type="button" data-tool="join" aria-pressed="false">Join</button>
    <button type="button" data-tool="draw" aria-pressed="false">Draw</button>
  </div>
  <p class="tw-small" data-el="toolhelp"></p>
  <div class="tw-row" data-el="drawbar" hidden><button type="button" class="tw-btn tw-sm tw-primary" data-el="drawdone" disabled>Finish path</button><button type="button" class="tw-btn tw-sm" data-el="drawback" disabled>Remove last point</button><button type="button" class="tw-btn tw-sm tw-quiet" data-el="drawcancel">Cancel</button></div>
  <div class="tw-notice" data-el="thwarn" hidden>Add at least one trailhead: pick the Trailhead tool and tap where runs start, or tap a P on the map.</div>
  <div>
    <h2 class="tw-title">Trailheads</h2>
    <div class="tws-list" data-el="thlist"></div>
  </div>
  <div data-el="drawnwrap" hidden>
    <h2 class="tw-title">Drawn paths</h2>
    <div class="tws-list" data-el="drawnlist"></div>
  </div>
  <div data-el="gpxwrap">
    <h2 class="tw-title">GPS tracks</h2>
    <p class="tw-small" style="margin-bottom:6px" data-el="gpxhelp"></p>
    <div class="tws-list" data-el="gpxres"></div>
    <div class="tw-row" style="margin-top:6px" data-el="gpxbtns"><label class="tw-btn tw-sm">Load GPX<input type="file" data-el="gpxfile" accept=".gpx,application/gpx+xml" multiple hidden></label><button type="button" class="tw-btn tw-sm tw-quiet" data-el="gpxclear" hidden>Remove tracks</button></div>
  </div>
  <div>
    <h2 class="tw-title">Suggested connectors</h2>
    <p class="tw-small" style="margin-bottom:6px">Short road or path links that join trails up. Add the ones you'd run.</p>
    <div class="tws-list" data-el="sugglist"></div>
  </div>
  <label class="tws-check"><input type="checkbox" data-el="showsugg" checked> Show suggestions on the map (tap one to add it)</label>
  <label class="tws-check"><input type="checkbox" data-el="showroads"> Show roads and sidewalks</label>
  <div class="tws-legend">
    <span class="tws-sw" style="border-color:${MC.in}"></span><span>Routable trails</span>
    <span class="tws-sw" style="border-color:${MC.auto};border-top-style:dashed"></span><span>Added to close a gap</span>
    <span class="tws-sw" style="border-color:${MC.cut};border-top-style:dotted"></span><span>Chosen, but not joined to a trailhead</span>
    <span class="tws-sw" style="border-color:${MC.off};border-top-width:2px"></span><span>Not used (tap to add)</span>
    <span class="tws-sw" style="border-color:${MC.sugg}"></span><span>Suggested connector</span>
    <span class="tws-sw" style="border-color:${MC.track};border-top-width:2px"></span><span>GPS track (dashed: missing from OpenStreetMap)</span>
  </div>
  <div class="tw-row"><button type="button" class="tw-btn" data-el="undo" disabled>Undo</button><button type="button" class="tw-btn" data-el="back1">Change area</button></div>
  <button type="button" class="tw-btn tw-primary" data-el="tosave">Next: save</button>
</section>

<section data-el="p-save" class="tws-stack" hidden>
  <label class="tw-f">Area name<input type="text" data-el="name" maxlength="60" placeholder="e.g. Forest Park trails"></label>
  <p class="tw-small" data-el="savesum"></p>
  <div class="tw-notice" data-el="savewarn" hidden></div>
  <button type="button" class="tw-btn tw-primary" data-el="save" hidden></button>
  <button type="button" class="tw-btn" data-el="download">Download area file</button>
  <p class="tw-small">The area file holds your trails, edits and the OpenStreetMap snapshot. Open it here later to keep editing, or share it.</p>
  <button type="button" class="tw-btn tw-quiet" data-el="back2">Back to trails</button>
</section>

<p class="tw-credits">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL).</p>`;

/* ---------- mount ---------- */
/**
 * Area setup in `element`. Runners pick a box on the map, load the OpenStreetMap trails and elevations there,
 * choose their trails and trailheads, then save. The area that comes out is what the route builder
 * (trails-widget.js) takes. It lives in its own module because it's much heavier than the route builder, so a
 * page that only builds routes never loads it. Give the element a height. Everything here stays backward
 * compatible within v1. Units: metres, coordinates [lat, lon] (WGS84).
 *
 * ```js
 * import { mountSetup } from 'https://j--w.github.io/bby-mtn-trails/widget/v1/setup-widget.js';
 * const setup = mountSetup(document.querySelector('#setup'), { onAreaSaved: area => saveToAccount(area) });
 * ```
 */
export function mountSetup(element: HTMLElement, options: SetupOptions = {}): SetupWidget {
  if (!(element instanceof HTMLElement)) throw new TypeError('mountSetup() needs an element to draw into.');
  addStyles('trails-widget-v1-setup', CSS);
  let opts: SetupOptions = { ...options };
  const root = document.createElement('div');
  root.className = 'tw tws';
  root.innerHTML = `<div class="tw-grid"><div class="tw-panel">${PANEL}</div>
    <div class="tw-mapcol"><div class="tw-mapwrap"><div class="tw-map" role="region" aria-label="Map"></div>
      <div class="tws-hint" hidden><span></span></div><div class="tw-busy" hidden></div><div class="tw-toast" role="status" hidden></div></div></div></div>`;
  element.appendChild(root);
  // everything these look up is in the markup above
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const $ = (k: string) => q(`[data-el="${k}"]`);
  const $in = (k: string) => $(k) as HTMLInputElement, $btn = (k: string) => $(k) as HTMLButtonElement;
  const mapEl = q('.tw-map');
  let destroyed = false, toastT: number | undefined, draftT: number | undefined, compileT: number | undefined;

  const fail = (err: WidgetError) => { if (opts.onError) opts.onError(err); else console.warn('[trails-widget]', err.message); };
  type Callbacks = Required<Pick<SetupOptions, 'onAreaSaved' | 'onCoverage' | 'onError'>>;
  const fire = <K extends keyof Callbacks>(name: K, ...a: Parameters<Callbacks[K]>) => {
    try { return (opts[name] as ((...a: Parameters<Callbacks[K]>) => unknown) | undefined)?.(...a); } catch (err) { console.error(err); }
  };
  function toast(m: string) { const t = q('.tw-toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
  function busy(m: string) { const b = q('.tw-busy'); b.hidden = !m; b.textContent = m || ''; }
  function hint(m: string) { const h = q('.tws-hint'); h.hidden = !m; h.firstElementChild!.textContent = m || ''; }
  const useDraft = () => opts.draft !== false;

  // raw: the OSM network as loaded; view: raw plus drawn paths (what piece paths and node keys refer to)
  // tracks: the host's (opts.tracks) then the runner's GPX files
  const S: SetupState = { step: 'area', bbox: null, raw: null, view: null, keyIdx: null, focus: null, drawPts: [], hostTracks: toInternal(opts.tracks), fileTracks: [],
    match: null, edits: emptyEdits(), name: '', ele: null, osmTimestamp: null, res: null, pieces: [], tool: 'select', undo: [], joinFrom: null, corners: [], picking: false };
  const tracks = () => [...S.hostTracks, ...S.fileTracks];

  /* ----- compile in a worker ----- */
  const workerUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(AREA_WORKER)};`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl, { type: 'module' });
  let reqId = 0, needPieces = true;
  worker.onmessage = (e: MessageEvent<Compiled>) => {
    const m = e.data;
    if (m.id !== reqId || destroyed) return;
    busy('');
    if ('error' in m) { toast('Something went wrong building the network: ' + m.error); return; }
    if (m.pieces) { S.pieces = m.pieces; drawPieces(); matchTracks(); }
    S.res = m;
    render();
  };
  worker.onerror = e => { e.preventDefault?.(); busy(''); toast('The network builder stopped. Reload to try again.'); };
  function compile(withPieces = false) {
    needPieces ||= withPieces;
    clearTimeout(compileT);
    S.view = withDrawn(S.raw!, S.edits.drawn); S.keyIdx = nodeIndex(S.view);
    compileT = setTimeout(() => { worker.postMessage({ id: ++reqId, edits: S.edits, withPieces: needPieces }); needPieces = false; }, 80);
  }

  /* ----- everything below needs the map ----- */
  let L: typeof Leaflet | null = null, map: Leaflet.Map | null = null, layers: Layers | null = null;
  // Past step 1 (an area is picked, which needs the map) and in map events, the map is up.
  const M = () => ({ L: L!, map: map!, layers: layers! });
  const lines = new Map<string, Leaflet.Polyline>();   // piece id -> polyline
  const ready = loadLeaflet().then((lib: typeof Leaflet) => {
    if (destroyed) return;
    L = lib;
    const m = map = lib.map(mapEl, { zoomSnap: 0.25, preferCanvas: true, renderer: lib.canvas({ tolerance: 4 }) });
    baseLayers(lib, m);
    const v = opts.view;
    m.setView(v?.center || [20, 0], v?.zoom ?? (v?.center ? 13 : 2));
    layers = Object.fromEntries(['box', 'draw', 'hover', 'piece', 'extra', 'poi', 'th', 'track'].map(k => [k, lib.layerGroup().addTo(m)])) as Layers;
    bindMap();
  }, err => { fail(err); });

  const LL = (i: number): [number, number] => [S.view!.nodes[i][0], S.view!.nodes[i][1]];
  const fmtKm = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
  function setStep(step: Step) {
    S.step = step;
    for (const s of ['area', 'trails', 'save'] as const) { $('p-' + s).hidden = s !== step; if (s === step) $('st-' + s).setAttribute('aria-current', 'step'); else $('st-' + s).removeAttribute('aria-current'); }
    layers?.box.eachLayer(l => (l as Leaflet.Path).setStyle?.({ opacity: step === 'area' ? 1 : 0.35, fillOpacity: step === 'area' ? 0.06 : 0 }));
    if (step !== 'area') stopPicking();
    mapEl.classList.toggle('tws-cross', step === 'trails' && S.tool !== 'select');
    if (step === 'trails') setTool(S.tool);
    else hint('');
  }

  /* ----- step 1: area ----- */
  function setBox(b: BBox) {
    const { L, layers } = M();
    const bbox = S.bbox = b.map(v => Math.round(v * 1e5) / 1e5) as BBox;
    layers.box.clearLayers();
    L.rectangle([[b[0], b[1]], [b[2], b[3]]], { color: MC.in, weight: 2, fillOpacity: 0.06, interactive: false }).addTo(layers.box);
    const km2 = bboxKm2(bbox);
    $('areainfo').textContent = `${km2.toFixed(1)} km² selected`;
    $('areawarn').hidden = km2 <= WARN_KM2;
    $('areawarn').textContent = km2 > MAX_KM2 ? `That's too big to load (over ${MAX_KM2} km²). Mark a smaller area.` : 'That\'s a big area. It works, but loading and editing will be slower.';
    $btn('loadbtn').disabled = km2 > MAX_KM2;
  }
  function stopPicking() { S.picking = false; S.corners = []; mapEl.classList.remove('tws-picking'); if (S.step === 'area') hint(''); }
  $('draw').onclick = () => { if (!map) return; S.picking = true; S.corners = []; mapEl.classList.add('tws-picking'); hint('Tap one corner of the area, then the opposite corner.'); };
  $('useview').onclick = () => {
    if (!map) return;
    const b = map.getBounds().pad(-0.04);
    setBox([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]); stopPicking();
  };
  $('loadbtn').onclick = () => loadTrails().catch(err => { busy(''); toast(err.message); $btn('loadbtn').disabled = false; });

  async function loadTrails() {
    $btn('loadbtn').disabled = true;
    busy('Loading trails from OpenStreetMap…');
    const json = await fetchOsm(S.bbox!);
    const raw = parseOsm(json);
    if (!raw.ways.some(w => w.layer === 'trail')) throw new Error('No trails in OpenStreetMap here. Try a different area.');
    busy(`Reading elevations for ${raw.nodes.length.toLocaleString()} points…`);
    const { ele, source } = await sampleElevations(raw.nodes.map(n => [n[0], n[1]]), ELE_SOURCES);
    if (destroyed) return;
    const missing = fillElevations(raw, ele);
    const sources: Record<string, number> = {};
    source.forEach(s => { if (s) sources[s] = (sources[s] || 0) + 1; });
    S.ele = { sources, missing };
    S.osmTimestamp = json.osm3s?.timestamp_osm_base || null;
    S.edits = emptyEdits(); S.undo = [];
    S.name = '';
    startEditing(raw);
    busy('');
    if (missing) toast(`No elevation for ${missing} points; they use their neighbours' height.`);
    if (useDraft()) await saveArea('draft', { bbox: S.bbox, raw, ele: S.ele, osmTimestamp: S.osmTimestamp, edits: S.edits, name: S.name });
  }
  // Points no source covered take the height of a neighbour along their way.
  function fillElevations(raw: RawNetwork, ele: Array<number | null>) {
    raw.nodes.forEach((n, i) => n[2] = ele[i]);
    const missing = ele.filter(v => v === null).length;
    for (let pass = 0; pass < 50 && raw.nodes.some(n => n[2] === null); pass++)
      for (const w of raw.ways) for (let k = 0; k < w.path.length; k++) {
        const n = raw.nodes[w.path[k]];
        if (n[2] !== null) continue;
        const nb = [w.path[k - 1], w.path[k + 1]].filter(j => j !== undefined && raw.nodes[j][2] !== null);
        if (nb.length) n[2] = nb.reduce((s, j) => s + raw.nodes[j][2]!, 0) / nb.length;
      }
    raw.nodes.forEach(n => { if (n[2] === null) n[2] = 0; });
    return missing;
  }
  function startEditing(raw: RawNetwork) {
    S.raw = raw; S.view = withDrawn(raw, S.edits.drawn); S.keyIdx = nodeIndex(S.view); S.focus = null; S.drawPts = []; S.pieces = []; S.res = null;
    worker.postMessage({ raw });
    drawPois();
    setStep('trails');
    busy('Building the network…');
    compile(true);
    const b = S.bbox!; M().map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20] });
  }

  /* ----- step 2: drawing ----- */
  function drawPieces() {
    const { L, layers } = M();
    layers.piece.clearLayers(); lines.clear();
    for (const p of S.pieces) lines.set(p.id, L.polyline(p.path.map(LL), { interactive: false }).addTo(layers.piece));
    buildPickGrid();
  }
  function styleFor(p: Piece, state: PieceState | undefined): Leaflet.PathOptions {
    const showRoads = $in('showroads').checked;
    if (state === 'in') return { color: MC.in, weight: 3.5, opacity: 0.95, dashArray: undefined };
    if (state === 'auto') return { color: MC.auto, weight: 3.5, opacity: 0.95, dashArray: '6 5' };
    if (state === 'cut') return { color: MC.cut, weight: 3, opacity: 0.9, dashArray: '2 5' };
    if (p.layer === 'road') return { color: MC.road, weight: 2, opacity: showRoads ? 0.9 : 0, dashArray: undefined };
    return { color: MC.off, weight: 2, opacity: 0.8, dashArray: undefined };
  }
  function render() {
    const r = S.res; if (!r || !map) return;
    const { L, layers } = M();
    for (const p of S.pieces) lines.get(p.id)?.setStyle(styleFor(p, r.states[p.id]));
    layers.extra.clearLayers();
    if ($in('showsugg').checked) for (const s of r.suggestions) for (const id of s.pieces) {
      const p = S.pieces.find(x => x.id === id), on = s.id === S.focus;
      if (p) L.polyline(p.path.map(LL), { color: MC.sugg, weight: on ? 9 : 6, opacity: on ? 0.9 : 0.5, interactive: false }).addTo(layers.extra);
    }
    for (const [a, b] of [...r.joins, ...r.snaps]) L.polyline([LL(a), LL(b)], { color: MC.ink, weight: 2, dashArray: '2 4', interactive: false }).addTo(layers.extra);
    if (S.joinFrom != null) L.circleMarker(LL(S.joinFrom), { radius: 7, color: MC.ink, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(layers.extra);
    drawTrailheads();
    const onNet = new Set<number | undefined>(r.provisional ? [] : r.trailheads.map(t => t.node));
    const thOk = S.edits.trailheads.filter(t => onNet.has(S.keyIdx!.get(String(t.node)))).length;
    $('s-km').textContent = fmtKm(r.keptM);
    $('s-th').textContent = String(thOk);
    $('s-sug').textContent = String(r.suggestions.length);
    $('thwarn').hidden = thOk > 0;
    renderThList(onNet);
    renderSuggestions();
    renderDrawn();
    renderGpx();
    $btn('undo').disabled = !S.undo.length;
    if (S.step === 'save') renderSave();
  }
  function drawTrailheads() {
    const { L, layers } = M();
    layers.th.clearLayers();
    S.edits.trailheads.forEach((t, i) => {
      const n = S.keyIdx!.get(String(t.node)); if (n === undefined) return;
      L.circleMarker(LL(n), { radius: 7, color: '#fff', weight: 2.5, fillColor: MC.ink, fillOpacity: 1, interactive: false })
        .bindTooltip(esc(t.name || `Trailhead ${i + 1}`), { permanent: true, direction: 'right', offset: [8, 0], className: 'tws-thlab' }).addTo(layers.th);
    });
  }
  function drawPois() {
    const { L, layers } = M();
    layers.poi.clearLayers();
    for (const p of S.raw!.pois!.filter(x => x.kind === 'parking' || x.kind === 'trailhead')) {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', iconSize: [18, 18], html: `<div style="width:18px;height:18px;border-radius:4px;background:${MC.in};color:#fff;font:700 12px/18px system-ui;text-align:center">${p.kind === 'parking' ? 'P' : 'T'}</div>` }), title: (p.name || (p.kind === 'parking' ? 'Parking' : 'Trailhead')) + ': tap to make this a trailhead' })
        .on('click', () => addTrailheadNear(L.latLng(p.lat, p.lon), p.name || '')).addTo(layers.poi);
    }
  }
  function renderThList(onNet: Set<number | undefined>) {
    const el = $('thlist');
    if (!S.edits.trailheads.length) { el.innerHTML = '<p class="tw-small">None yet.</p>'; return; }
    el.innerHTML = S.edits.trailheads.map((t, i) => `<div class="tws-item"><input class="tws-inline" type="text" data-th="${i}" value="${esc(t.name)}" placeholder="Trailhead ${i + 1}" aria-label="Trailhead name">
      <button type="button" class="tw-btn tw-quiet tw-sm" data-thdel="${i}" aria-label="Remove trailhead">Remove</button>${onNet.has(S.keyIdx!.get(String(t.node))) ? '' : '<small class="tw-small" style="grid-column:1/-1">Not on a routable trail</small>'}</div>`).join('');
    el.querySelectorAll<HTMLInputElement>('[data-th]').forEach(inp => inp.onchange = () => { edit(e => { e.trailheads[+inp.dataset.th!].name = inp.value.trim(); }); });
    el.querySelectorAll<HTMLElement>('[data-thdel]').forEach(b => b.onclick = () => edit(e => { e.trailheads.splice(+b.dataset.thdel!, 1); }));
  }
  function renderSuggestions() {
    const el = $('sugglist'), all = S.res!.suggestions, fi = all.findIndex(x => x.id === S.focus);
    const list = all.slice(0, 8).map((x, i): [Suggestion, number] => [x, i]);
    if (fi >= 8) list.push([all[fi], fi]);
    if (!list.length) { el.innerHTML = '<p class="tw-small">Nothing to suggest.</p>'; return; }
    el.innerHTML = list.map(([s, i]) => `<div class="tws-item${s.id === S.focus ? ' tws-focus' : ''}"><span class="tws-what">${s.kind === 'island' ? `Join ${fmtKm(s.joins)} km of trail` : 'Link a dead end'}<small>${Math.round(s.m)} m of ${esc(describe(s))}</small></span>
      <span class="tw-row"><button type="button" class="tw-btn tw-quiet tw-sm" data-show="${i}">Show</button><button type="button" class="tw-btn tw-sm" data-add="${i}">Add</button><button type="button" class="tw-btn tw-quiet tw-sm" data-no="${i}" aria-label="Dismiss">No</button></span></div>`).join('');
    el.querySelectorAll<HTMLElement>('[data-show]').forEach(b => b.onclick = () => { const s = all[+b.dataset.show!]; S.focus = s.id; showSuggestion(s); render(); });
    el.querySelectorAll<HTMLElement>('[data-add]').forEach(b => b.onclick = () => addSuggestion(+b.dataset.add!));
    el.querySelectorAll<HTMLElement>('[data-no]').forEach(b => b.onclick = () => { const i = +b.dataset.no!; edit(e => { e.dismissed.push(all[i].id); }); });
  }
  function showSuggestion(s: Suggestion) {
    const { L, map } = M();
    map.fitBounds(L.latLngBounds(s.pieces.flatMap(id => S.pieces.find(p => p.id === id)?.path.map(LL) || [])).pad(2), { maxZoom: 16 });
  }
  // add every piece of suggestion i
  function addSuggestion(i: number) {
    const s = S.res!.suggestions[i]; if (!s) return;
    edit(e => { for (const id of s.pieces) e.pieces[id] = true; });
  }
  function renderDrawn() {
    const d = S.edits.drawn;
    $('drawnwrap').hidden = !d.length;
    $('drawnlist').innerHTML = d.map((p, i) => `<div class="tws-item"><input class="tws-inline" type="text" data-dname="${i}" value="${esc(p.name)}" placeholder="Drawn path ${i + 1}" aria-label="Path name">
      <span class="tw-row"><button type="button" class="tw-btn tw-quiet tw-sm" data-dshow="${i}">Show</button><button type="button" class="tw-btn tw-quiet tw-sm" data-ddel="${i}">Remove</button></span></div>`).join('');
    const pathOf = (i: number) => S.pieces.filter(p => p.way === d[i].id).flatMap(p => p.path.map(LL));
    $('drawnlist').querySelectorAll<HTMLInputElement>('[data-dname]').forEach(inp => inp.onchange = () => edit(e => { e.drawn[+inp.dataset.dname!].name = inp.value.trim(); }, { pieces: true }));
    $('drawnlist').querySelectorAll<HTMLElement>('[data-dshow]').forEach(b => b.onclick = () => { const { L, map } = M(), ll = pathOf(+b.dataset.dshow!); if (ll.length) map.fitBounds(L.latLngBounds(ll).pad(1.5), { maxZoom: 17 }); });
    $('drawnlist').querySelectorAll<HTMLElement>('[data-ddel]').forEach(b => b.onclick = () => edit(e => { e.drawn.splice(+b.dataset.ddel!, 1); }, { pieces: true }));
  }
  $('showsugg').onchange = () => render();
  $('showroads').onchange = () => render();
  function describe(s: Suggestion) {
    const kinds = new Set(s.pieces.map(id => S.pieces.find(p => p.id === id)?.hw));
    const names = [...new Set(s.pieces.map(id => S.pieces.find(p => p.id === id)?.name).filter(Boolean))];
    const k = kinds.has('footway') && kinds.size === 1 ? 'path or sidewalk' : [...kinds].some(h => h && /residential|service|tertiary|unclassified|living_street/.test(h)) ? 'road' : 'path';
    return k + (names.length ? ` (${names.slice(0, 2).join(', ')})` : '');
  }

  /* ----- step 2: editing ----- */
  function edit(fn: (e: Edits) => void, { pieces = false } = {}) {
    S.undo.push(JSON.stringify(S.edits));
    if (S.undo.length > 100) S.undo.shift();
    fn(S.edits);
    compile(pieces);
    saveDraft();
  }
  $('undo').onclick = () => { if (!S.undo.length) return; S.edits = JSON.parse(S.undo.pop()!); compile(true); saveDraft(); };
  function saveDraft() { if (!useDraft()) return; clearTimeout(draftT); draftT = setTimeout(() => saveArea('draft-edits', { edits: S.edits, name: S.name }), 400); }

  const HELP: Record<Tool, string> = {
    select: 'Tap a trail to add it or take it out. Grey lines are paths not in your network yet.',
    trailhead: 'Tap where runs start (or a P on the map). Name them in the list.',
    split: 'Tap a point on a trail to cut it there, so you can keep only part of it.',
    join: 'Tap two points to link them with a short straight connector, where OpenStreetMap leaves a gap.',
    draw: 'Tap along a path OpenStreetMap is missing. Start and end on a trail so it joins up, then tap the last point again or Finish.',
  };
  function setTool(t: Tool) {
    S.tool = t; S.joinFrom = null; S.drawPts = []; drawSketch();
    $('drawbar').hidden = t !== 'draw';
    mapEl.classList.toggle('tws-cross', S.step === 'trails' && t !== 'select');
    if (t === 'draw') map?.doubleClickZoom.disable(); else map?.doubleClickZoom.enable();
    root.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('toolhelp').textContent = HELP[t];
    hint(t === 'select' ? '' : HELP[t]);
    if (S.res) render();
  }
  root.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool as Tool));

  // grid of piece segments in degrees for hit testing taps
  let grid = new Map<string, Array<[number, number]>>(); const GC = 0.002;
  function buildPickGrid() {
    grid = new Map();
    S.pieces.forEach((p, pi) => { for (let k = 1; k < p.path.length; k++) {
      const [a, b] = [S.view!.nodes[p.path[k - 1]], S.view!.nodes[p.path[k]]];
      for (let x = Math.floor(Math.min(a[1], b[1]) / GC); x <= Math.floor(Math.max(a[1], b[1]) / GC); x++)
        for (let y = Math.floor(Math.min(a[0], b[0]) / GC); y <= Math.floor(Math.max(a[0], b[0]) / GC); y++) {
          const key = x + ',' + y; if (!grid.has(key)) grid.set(key, []); grid.get(key)!.push([pi, k]);
        }
    } });
  }
  // nearest visible piece to a tap, within `px` screen pixels: {piece, k (segment index), t, node (nearest path node)}
  function pick(latlng: Leaflet.LatLng, px = 14, filter: (p: Piece) => boolean = () => true): Hit | null {
    const { map } = M();
    const P = map.latLngToContainerPoint(latlng), x0 = Math.floor(latlng.lng / GC), y0 = Math.floor(latlng.lat / GC);
    let best: Omit<Hit, 'node'> & { node?: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [pi, k] of grid.get((x0 + dx) + ',' + (y0 + dy)) || []) {
      const p = S.pieces[pi]; if (!filter(p)) continue;
      const A = map.latLngToContainerPoint(LL(p.path[k - 1])), B = map.latLngToContainerPoint(LL(p.path[k]));
      const vx = B.x - A.x, vy = B.y - A.y, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((P.x - A.x) * vx + (P.y - A.y) * vy) / L2)) : 0;
      const d = Math.hypot(P.x - A.x - t * vx, P.y - A.y - t * vy);
      if (d <= px && (!best || d < best.d)) best = { d, piece: p, k, t };
    }
    if (best) best.node = best.t < 0.5 ? best.piece.path[best.k - 1] : best.piece.path[best.k];
    return best as Hit | null;
  }
  const suggestionOf = (id: string) => $in('showsugg').checked ? S.res?.suggestions.findIndex(s => s.pieces.includes(id)) ?? -1 : -1;
  const inSuggestion = (id: string) => suggestionOf(id) >= 0;
  const visible = (p: Piece) => { const st = S.res?.states[p.id]; return st !== 'off' || p.layer !== 'road' || $in('showroads').checked || inSuggestion(p.id); };
  const onNetwork = (p: Piece) => S.res?.states[p.id] !== 'off';

  function addTrailheadNear(latlng: Leaflet.LatLng, name: string) {
    const hit = pick(latlng, 40, onNetwork);
    if (!hit) { toast('Tap closer to a trail you\'ve chosen (blue).'); return; }
    const key = keyOf(S.view!, hit.node);
    if (S.edits.trailheads.some(t => String(t.node) === key)) { toast('There\'s already a trailhead there.'); return; }
    edit(e => e.trailheads.push({ node: key, name }));
  }

  /* ----- map events ----- */
  // The map shows a pointer over anything a tap would act on, a crosshair for the point tools.
  let hoverLL: Leaflet.LatLng | null = null, hoverRaf = 0, dragging = false;
  function bindMap() {
    const { map, layers } = M();
    map.on('click', e => {
      if (S.step === 'area' && S.picking) {
        S.corners.push(e.latlng);
        if (S.corners.length === 2) { const [a, b] = S.corners; setBox([Math.min(a.lat, b.lat), Math.min(a.lng, b.lng), Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)]); stopPicking(); }
        else hint('Now tap the opposite corner.');
        return;
      }
      if (S.step !== 'trails' || !S.res) return;
      if (S.tool === 'select') {
        const hit = pick(e.latlng, 14, visible); if (!hit) return;
        const st = S.res.states[hit.piece.id], si = st === 'off' ? suggestionOf(hit.piece.id) : -1;
        if (si >= 0) { addSuggestion(si); return; }
        edit(ed => { ed.pieces[hit.piece.id] = !(st === 'in' || st === 'cut'); });
      } else if (S.tool === 'trailhead') addTrailheadNear(e.latlng, '');
      else if (S.tool === 'split') {
        const hit = pick(e.latlng, 14, visible); if (!hit) return;
        const p = hit.piece, n = hit.node, k = p.path.indexOf(n);
        if (k <= 0 || k >= p.path.length - 1) { toast('That\'s already the end of a trail. Tap further along it.'); return; }
        const included = S.res.states[p.id] !== 'off';
        edit(ed => { ed.splits.push(keyOf(S.view!, n)); ed.pieces[p.id] = included; ed.pieces[`${p.way}/${keyOf(S.view!, n)}`] = included; }, { pieces: true });
      } else if (S.tool === 'join') {
        const hit = pick(e.latlng, 24, visible); if (!hit) return;
        if (S.joinFrom == null) { S.joinFrom = hit.node; render(); hint('Now tap the point to join it to.'); return; }
        const a = S.joinFrom, b = hit.node; S.joinFrom = null; hint(HELP.join);
        if (a === b) { render(); return; }
        edit(ed => { ed.joins.push([keyOf(S.view!, a), keyOf(S.view!, b)]); });
      } else if (S.tool === 'draw') {
        const pt = snapAt(e.latlng), last = S.drawPts[S.drawPts.length - 1];
        if (last && map.latLngToContainerPoint(last.ll).distanceTo(map.latLngToContainerPoint(pt.ll)) < 12) { if (S.drawPts.length > 1) finishDraw(); return; }
        S.drawPts.push(pt); drawSketch();
      }
    });
    map.on('dragstart', () => { dragging = true; mapEl.classList.remove('tws-hit'); });
    map.on('dragend', () => { dragging = false; });
    map.on('mousemove', e => { hoverLL = e.latlng; if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHover); });
    map.on('mouseout', () => { hoverLL = null; mapEl.classList.remove('tws-hit'); layers.hover.clearLayers(); });
  }
  function updateHover() {
    hoverRaf = 0; if (!map) return;
    const { L, layers } = M();
    layers.hover.clearLayers();
    if (dragging || !hoverLL || S.step !== 'trails' || !S.res) { mapEl.classList.remove('tws-hit'); return; }
    if (S.tool === 'draw') {
      const pt = snapAt(hoverLL), last = S.drawPts[S.drawPts.length - 1];
      if (last) L.polyline([last.ll, pt.ll], { color: MC.ink, weight: 2, dashArray: '4 6', interactive: false }).addTo(layers.hover);
      if (pt.node != null) L.circleMarker(pt.ll, { radius: 7, color: MC.in, weight: 2.5, fill: false, interactive: false }).addTo(layers.hover);
      mapEl.classList.remove('tws-hit');
      return;
    }
    const hit = S.tool === 'trailhead' ? pick(hoverLL, 40, onNetwork) : pick(hoverLL, S.tool === 'join' ? 24 : 14, visible);
    mapEl.classList.toggle('tws-hit', !!hit);
    if (hit && S.tool !== 'select') L.circleMarker(LL(hit.node), { radius: 6, color: MC.ink, weight: 2, fill: false, interactive: false }).addTo(layers.hover);
    if (hit && S.tool === 'join' && S.joinFrom != null) L.polyline([LL(S.joinFrom), LL(hit.node)], { color: MC.ink, weight: 2, dashArray: '2 4', interactive: false }).addTo(layers.hover);
  }

  /* ----- draw: paths OpenStreetMap doesn't have ----- */
  // a tap within 16 px of a trail node snaps to it (so the drawn path joins the network); otherwise a free point
  function snapAt(latlng: Leaflet.LatLng): DrawPt {
    const { L, map } = M();
    const hit = pick(latlng, 16, visible);
    if (hit && map.latLngToContainerPoint(LL(hit.node)).distanceTo(map.latLngToContainerPoint(latlng)) <= 16) return { node: hit.node, ll: L.latLng(LL(hit.node)) };
    return { node: null, ll: latlng };
  }
  function drawSketch() {
    if (!map) return;
    const { L, layers } = M();
    layers.draw.clearLayers();
    const pts = S.drawPts;
    if (pts.length > 1) L.polyline(pts.map(p => p.ll), { color: MC.ink, weight: 3, interactive: false }).addTo(layers.draw);
    pts.forEach(p => L.circleMarker(p.ll, { radius: 5, color: '#fff', weight: 2, fillColor: p.node != null ? MC.in : MC.ink, fillOpacity: 1, interactive: false }).addTo(layers.draw));
    $btn('drawdone').disabled = pts.length < 2;
    $btn('drawback').disabled = !pts.length;
  }
  const DRAW_STEP = 20;   // metres between points on a drawn path, so its climb comes from the elevation data
  // [{node, ll}] -> a drawn-path entry: straight legs densified, new points given elevations
  async function drawnEntry(pts: DrawPt[], id: string, name = '') {
    const { L } = M();
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1].ll, b = pts[k].ll, n = Math.ceil(a.distanceTo(b) / DRAW_STEP);
      for (let j = 1; j < n; j++) out.push({ node: null, ll: L.latLng(a.lat + (b.lat - a.lat) * j / n, a.lng + (b.lng - a.lng) * j / n) });
      out.push(pts[k]);
    }
    const free = out.filter(p => p.node == null);
    let ele: Array<number | null> = free.map(() => null);
    try { ele = (await sampleElevations(free.map(p => [p.ll.lat, p.ll.lng]), ELE_SOURCES)).ele; } catch { /* filled below */ }
    free.forEach((p, i) => { p.ele = ele[i]; });
    out.forEach(p => { if (p.node != null) p.ele = S.view!.nodes[p.node][2]; });
    // anything no source covered: interpolate along the path
    out.forEach((p, i) => {
      if (p.ele != null) return;
      let a = i - 1, b = i + 1;
      while (a >= 0 && out[a].ele == null) a--;
      while (b < out.length && out[b].ele == null) b++;
      p.ele = a >= 0 && b < out.length ? out[a].ele! + (out[b].ele! - out[a].ele!) * (i - a) / (b - a) : (a >= 0 ? out[a].ele : b < out.length ? out[b].ele : 0);
    });
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    return { id, name, pts: out.map((p): DrawnPoint => p.node != null ? keyOf(S.view!, p.node) : [r6(p.ll.lat), r6(p.ll.lng), Math.round(p.ele! * 10) / 10]) };
  }
  const nextDrawnId = (k = 0) => 'd' + (Math.max(0, ...S.edits.drawn.map(d => +d.id.slice(1) || 0)) + 1 + k);
  async function finishDraw() {
    const pts = S.drawPts; if (pts.length < 2) return;
    S.drawPts = []; drawSketch(); M().layers.hover.clearLayers();
    busy('Reading elevations…');
    const entry = await drawnEntry(pts, nextDrawnId());
    busy('');
    if (destroyed) return;
    edit(e => e.drawn.push(entry), { pieces: true });
    if (pts[0].node == null || pts[pts.length - 1].node == null) toast('Drawn. An end that isn’t on a trail is a dead end.');
  }
  $('drawdone').onclick = finishDraw;
  const drawBack = () => { S.drawPts.pop(); drawSketch(); };
  const drawCancel = () => { S.drawPts = []; drawSketch(); layers?.hover.clearLayers(); };
  $('drawback').onclick = drawBack;
  $('drawcancel').onclick = drawCancel;
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as Element;
    if (S.tool !== 'draw' || S.step !== 'trails' || target.matches?.('input, textarea, select')) return;
    if (target !== document.body && !root.contains(target)) return;
    if (e.key === 'Enter') finishDraw();
    else if (e.key === 'Escape') drawCancel();
    else if (e.key === 'Backspace') { e.preventDefault(); drawBack(); }
  };
  document.addEventListener('keydown', onKey);

  /* ----- GPS tracks ----- */
  // A track picks out the pieces it runs along and the stretches OpenStreetMap doesn't have; nothing is added
  // until the runner says so.
  function matchTracks() {
    if (!map) return;
    const { L, layers } = M();
    layers.track.clearLayers();
    const all = tracks();
    S.match = all.length && S.pieces.length ? matchTrack({ nodes: S.view!.nodes, pieces: S.pieces, tracks: all, bbox: S.bbox }) : null;
    $('gpxclear').hidden = !S.fileTracks.length;
    for (const t of all) L.polyline(t.pts.map((p): [number, number] => [p[0], p[1]]), { color: MC.track, weight: 2.5, opacity: 0.8, interactive: false }).addTo(layers.track);
    for (const g of S.match?.gaps || []) L.polyline(g.pts.map((p): [number, number] => [p.lat, p.lon]), { color: MC.track, weight: 6, opacity: 0.7, dashArray: '8 6', interactive: false }).addTo(layers.track);
  }
  function trackCounts() {
    const st: Record<string, PieceState | undefined> = S.res?.states || {}, f = S.match?.followed || [], sum = (a: TrackMatch['followed']) => a.reduce((s, x) => s + x.len, 0);
    const offTrail = f.filter(x => x.layer === 'trail' && st[x.id] === 'off'), offRoad = f.filter(x => x.layer === 'road' && st[x.id] === 'off');
    return { all: sum(f), offTrail, offRoad, trailM: sum(offTrail), roadM: sum(offRoad) };
  }
  let lastCoverage = 'null';
  function renderGpx() {
    const el = $('gpxres'), files = opts.gpxFiles !== false;
    $('gpxbtns').hidden = !files;
    $('gpxwrap').hidden = !files && !S.hostTracks.length;
    $('gpxhelp').textContent = files ? 'Load GPX files of your runs to add the trails you use and the bits OpenStreetMap is missing. Tracks aren\'t saved in the area file.'
      : 'Your runs, to add the trails you use and the bits OpenStreetMap is missing.';
    reportCoverage();
    if (!S.match) { el.innerHTML = ''; return; }
    const c = trackCounts(), gaps = S.match.gaps, gapM = gaps.reduce((s, g) => s + g.m, 0);
    const row = (what, sub, btns) => `<div class="tws-item"><span class="tws-what">${what}<small>${sub}</small></span><span class="tw-row">${btns}</span></div>`;
    el.innerHTML =
      row(`Follows ${fmtKm(c.all)} km of paths`, c.trailM ? `${fmtKm(c.trailM)} km of trail isn't in your network yet` : 'All of its trail is in your network', c.trailM ? '<button type="button" class="tw-btn tw-sm" data-gpx="trail">Add</button>' : '') +
      (c.roadM ? row(`${fmtKm(c.roadM)} km of road or sidewalk`, 'Your track uses it, but it isn\'t in your network', '<button type="button" class="tw-btn tw-sm" data-gpx="road">Add</button>') : '') +
      (gaps.length ? row(`${gaps.length} stretch${gaps.length > 1 ? 'es' : ''} OpenStreetMap doesn't have`, `${Math.round(gapM)} m, dashed on the map`, '<button type="button" class="tw-btn tw-quiet tw-sm" data-gpx="show">Show</button><button type="button" class="tw-btn tw-sm" data-gpx="gaps">Add</button>') : '');
    const add = (list: TrackMatch['followed']) => edit(e => { for (const x of list) e.pieces[x.id] = true; });
    const act: Record<string, () => void> = { trail: () => add(c.offTrail), road: () => add(c.offRoad), gaps: addTrackGaps,
      show: () => { const { L, map } = M(); map.fitBounds(L.latLngBounds(gaps.flatMap(g => g.pts.map((p): [number, number] => [p.lat, p.lon]))).pad(0.3), { maxZoom: 17 }); } };
    el.querySelectorAll<HTMLElement>('[data-gpx]').forEach(b => b.onclick = act[b.dataset.gpx!]);
  }
  // onCoverage: what the tracks show about this area, sent when it changes
  function reportCoverage() {
    if (!opts.onCoverage) return;
    let cov: Coverage | null = null;
    if (S.match && S.res) {
      const c = trackCounts();
      cov = { followed: Math.round(c.all), missing: Math.round(c.trailM + c.roadM), offMap: Math.round(S.match.offM),
        gaps: S.match.gaps.map(g => ({ points: g.pts.map((p): [number, number] => [p.lat, p.lon]), length: Math.round(g.m) })) };
    }
    const key = JSON.stringify(cov);
    if (key === lastCoverage) return;
    lastCoverage = key;
    fire('onCoverage', cov);
  }
  async function addTrackGaps() {
    const gaps = S.match?.gaps || []; if (!gaps.length) return;
    const { L } = M();
    busy('Reading elevations…');
    const entries: DrawnPath[] = [];
    for (const [k, g] of gaps.entries()) entries.push(await drawnEntry(g.pts.map(p => ({ node: p.node, ll: L.latLng(p.lat, p.lon) })), nextDrawnId(k)));
    busy('');
    if (destroyed) return;
    edit(e => e.drawn.push(...entries), { pieces: true });
  }
  function tracksOutside(list: Track[]) {
    const b = S.bbox; if (!b || !list.length) return false;
    return !list.flatMap(t => t.pts).some(p => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);
  }
  $('gpxfile').onchange = async () => {
    const inp = $in('gpxfile'), files = [...inp.files!]; inp.value = '';
    const added: Track[] = [];
    for (const f of files) { try { added.push(...parseGpxRaw(await f.text())); } catch { /* reported below */ } }
    if (!added.length) { toast('No track found in that file.'); return; }
    S.fileTracks.push(...added);
    matchTracks(); render();
    if (tracksOutside(added)) toast('That track is outside this area.');
  };
  $('gpxclear').onclick = () => { S.fileTracks = []; matchTracks(); render(); };

  $('back1').onclick = () => setStep('area');
  $('tosave').onclick = () => { setStep('save'); renderSave(); };

  /* ----- step 3: save ----- */
  function dominantSource() { const s = S.ele?.sources || {}; return (s.hrdem || 0) >= (s['terrain-tiles'] || 0) ? 'hrdem' : 'terrain-tiles'; }
  const routable = () => { const r = S.res; return !!(r && !r.provisional && r.data?.th?.length); };
  function renderSave() {
    const r = S.res, ok = routable(), nth = r?.data?.th?.length || 0;
    if (document.activeElement !== $('name')) $in('name').value = S.name;
    const src = dominantSource();
    $('savesum').textContent = r ? `${fmtKm(r.keptM)} km of trail, ${nth} trailhead${nth === 1 ? '' : 's'}. Elevations from ${src === 'hrdem' ? 'LiDAR (HRDEM)' : 'terrain tiles'}; climb is approximate.` : '';
    $('savewarn').hidden = ok;
    $('savewarn').textContent = 'Add a trailhead on a routable trail before saving.';
    $('save').hidden = !opts.onAreaSaved;
    $('save').textContent = opts.saveLabel || 'Save area';
    $('download').classList.toggle('tw-primary', !opts.onAreaSaved);
    $btn('save').disabled = $btn('download').disabled = !ok;
  }
  $('name').oninput = () => { S.name = $in('name').value.trim(); saveDraft(); };
  function buildPackage() {
    const src = dominantSource(), win = SMOOTHING[src];
    const data = smoothAlongSegments(S.res!.data!, win);   // routable() before any save
    const attribution = [S.ele?.sources?.hrdem ? HRDEM_ATTRIBUTION : null, S.ele?.sources?.['terrain-tiles'] ? TERRARIUM_ATTRIBUTION : null].filter((a): a is string => !!a);
    return makePackage({ name: S.name || 'My trails', bbox: S.bbox!, raw: S.raw!, edits: S.edits, compiled: { data },
      elevation: { sources: S.ele?.sources, smoothing: win, attribution }, osmTimestamp: S.osmTimestamp });
  }
  $('download').onclick = () => {
    const pkg = buildPackage(), name = (pkg.name.replace(/[^\w -]/g, '').trim() || 'area').replace(/\s+/g, '-').toLowerCase();
    download(JSON.stringify(pkg), name + '.trails.json', 'application/json');
  };
  $('save').onclick = async () => {
    const b = $btn('save'); b.disabled = true;
    try { await opts.onAreaSaved?.(buildPackage()); } catch (err) { toast((err as Error)?.message || 'Saving didn’t work.'); }
    finally { if (!destroyed) b.disabled = !routable(); }
  };
  $('back2').onclick = () => setStep('trails');

  /* ----- open an area, or resume the draft ----- */
  $('openfile').onchange = async () => {
    const inp = $in('openfile'), f = inp.files![0]; inp.value = '';
    if (!f) return;
    try { await openPackage(JSON.parse(await f.text())); } catch (err) { toast((err as Error).message || 'That file couldn\'t be read.'); }
  };
  async function openPackage(json: unknown) {
    await ready; if (!map || destroyed) return;
    const pkg = readPackageLoose(json);
    S.bbox = pkg.bbox; setBox(pkg.bbox); S.edits = pkg.edits; S.name = pkg.name || ''; S.undo = [];
    S.ele = { sources: pkg.elevation?.sources || {}, missing: 0 }; S.osmTimestamp = pkg.osmTimestamp;
    startEditing(pkg.osm);
    if (useDraft()) await saveArea('draft', { bbox: S.bbox, raw: pkg.osm, ele: S.ele, osmTimestamp: S.osmTimestamp, edits: S.edits, name: S.name });
  }
  // an area still being set up may have no trailhead yet; only the route builder needs one
  function readPackageLoose(json: any) {   // parsed JSON from a file or the host
    let pkg;
    try { pkg = readPackage(json); } catch (err) {
      if (json?.format === 'trail-area' && json.osm) return { ...json, edits: { ...emptyEdits(), ...json.edits } };
      throw new WidgetError('area-unreadable', (err as Error).message);
    }
    if (!pkg.osm) throw new WidgetError('area-unreadable', 'This area file has no OpenStreetMap snapshot, so it can’t be edited.');
    return pkg;
  }
  async function openArea(a: AreaPackage | string) {
    try {
      let json: unknown = a;
      if (typeof a === 'string') {
        const res = await fetch(a).catch(() => null);
        if (!res?.ok) throw new WidgetError('area-unreadable', 'That area file couldn’t be loaded.');
        json = JSON.parse(await res.text());
      }
      await openPackage(json);
    } catch (err) {
      const e = err instanceof WidgetError ? err : new WidgetError('area-unreadable', (err as Error).message);
      toast(e.message); fail(e);
    }
  }
  async function offerResume() {
    if (!useDraft()) return;
    const draft = await loadArea<Draft>('draft');
    if (!draft?.raw || destroyed) return;
    const later = await loadArea<Pick<Draft, 'edits' | 'name'>>('draft-edits');
    const name = later?.name || draft.name;
    $('resume').hidden = false;
    $('resume').textContent = `Continue ${name || 'your last area'}`;
    $('resume').onclick = async () => {
      await ready; if (!map) return;
      S.bbox = draft.bbox; setBox(draft.bbox); S.ele = draft.ele; S.osmTimestamp = draft.osmTimestamp;
      S.edits = { ...emptyEdits(), ...(later?.edits || draft.edits) }; S.name = name || ''; S.undo = [];
      startEditing(draft.raw);
    };
  }

  function applyLayout() {
    root.dataset.theme = themeOf(opts.theme);
    q('.tw-head').hidden = opts.panels?.header === false;
    if (S.res) render(); else renderGpx();
    if (S.step === 'save') renderSave();
  }
  let resizeT: number | undefined;
  const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => map?.invalidateSize(), 100); });
  ro.observe(root);

  applyLayout();
  setStep('area');
  offerResume();
  if (opts.area) openArea(opts.area);

  return {
    update(next: Partial<SetupOptions> = {}) {
      const areaChanged = 'area' in next && next.area !== opts.area && next.area != null;
      opts = { ...opts, ...next, panels: { ...opts.panels, ...next.panels } };
      if ('tracks' in next) { S.hostTracks = toInternal(next.tracks); matchTracks(); }
      applyLayout();
      if (areaChanged) openArea(opts.area!);
    },
    get area() { return routable() ? buildPackage() : null; },
    destroy() {
      destroyed = true; ro.disconnect(); clearTimeout(toastT); clearTimeout(resizeT); clearTimeout(compileT); clearTimeout(draftT);
      cancelAnimationFrame(hoverRaf);
      document.removeEventListener('keydown', onKey);
      worker.terminate(); URL.revokeObjectURL(workerUrl);
      map?.remove(); root.remove();
    },
  };
}
