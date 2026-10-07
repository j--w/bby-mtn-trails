import { loadLeaflet, addStyles, baseLayers, esc, themeOf, download } from './common.js';
import { WidgetError, readArea, trailheads, trailheadList, resolveParams, problem, solverParams, toRoute, fmtTime } from './model.js';
export { WidgetError, readArea, trailheads };
export const version = '1.0.0';
const CONTROLS = ['mode', 'distance', 'climb', 'start', 'paved', 'lap'];
const LAPS = [0, 8000, 10000, 12000, 15000];
const PAVED_LABELS = { fine: 'Don’t mind', avoid: 'Avoid', 'avoid-strongly': 'Avoid strongly' };
// Tiles are light in both themes, so map overlays use fixed light-theme colours.
const MC = { ink: '#17202b', net: '#4d5f78', laps: ['#2155cc', '#a85f00', '#7b3fb4', '#1b7f45'] };
const NS = 'http://www.w3.org/2000/svg';
/* ---------- the router worker and styles ---------- */
// The search runs in a worker made from a blob, so it works when this module is loaded from another site
// (a worker script itself must be same-origin; the module it imports need not be, given CORS).
const CORE = new URL('../../js/router-core.js', import.meta.url).href;
const WORKER = `import { buildGraph, setGraph, workerGraph, solve, solveLongest, reachableKm, routeGeometry } from ${JSON.stringify(CORE)};
let graph = null, nodes = null;
onmessage = e => {
  const m = e.data;
  if (m.type === 'area') {
    nodes = m.data.nodes; graph = buildGraph(m.data); setGraph(workerGraph(graph));
    postMessage({ type: 'ready', id: m.id, km: graph.edges.reduce((a, x) => a + x.len, 0) / 1000, starts: m.data.th.map(t => graph.J(t.node)) });
  } else if (m.type === 'search') {
    try {
      const p = m.params, res = p.mode === 'longest' ? solveLongest(p) : solve(p);
      postMessage({ type: 'routes', id: m.id, reach: p.mode === 'longest' ? reachableKm(p.start, p.maxg, graph.edges, graph.adj) : 0,
        routes: res.map(r => ({ label: r.label || '', desc: r.desc || '', s: r.s, laps: r.laps || 1, geom: routeGeometry(r, graph.edges, nodes) })) });
    } catch (err) { postMessage({ type: 'routes', id: m.id, error: String(err && err.message || err) }); }
  }
};`;
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
const fmtKm = (m) => (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
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
export function mount(element, options = {}) {
    if (!(element instanceof HTMLElement))
        throw new TypeError('mount() needs an element to draw into.');
    addStyles('trails-widget-v1-routes', CSS);
    let opts = { ...options };
    const root = document.createElement('div');
    root.className = 'tw';
    root.innerHTML = `<div class="tw-grid">
    <div class="tw-panel">
      <div class="tw-head"><b></b><span></span></div>
      <form class="tw-form" novalidate></form>
      <div class="tw-results"></div>
      <div class="tw-take"></div>
      <p class="tw-credits"></p>
    </div>
    <div class="tw-mapcol">
      <div class="tw-mapwrap"><div class="tw-map" role="region" aria-label="Route map"></div>
        <button type="button" class="tw-btn tw-fit">Fit route</button>
        <div class="tw-busy" hidden>Building routes…</div><div class="tw-toast" role="status" hidden></div></div>
      <div class="tw-profile"><svg aria-label="Elevation profile"></svg><div class="tw-tip"></div></div>
    </div></div>`;
    element.appendChild(root);
    // Everything q() looks up is in the markup above.
    const q = (s) => root.querySelector(s);
    const form = q('.tw-form'), prof = q('.tw-profile svg');
    // state
    let area = null, nodes = [], TH = [], starts = [], netKm = 0, params = null;
    let raws = [], routes = [], sel = 0, reach = 0, note = '', destroyed = false;
    let map = null, layers = null;
    let hoverMk = null, hoverPt = null;
    // Worker messages are the protocol in WORKER above.
    let reqId = 0;
    const waiting = new Map();
    let ready = Promise.resolve();
    const worker = (() => {
        const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
        return Object.assign(new Worker(url, { type: 'module' }), { _url: url });
    })();
    worker.onmessage = e => {
        const m = e.data, done = waiting.get(m.id);
        waiting.delete(m.id);
        done?.(m);
    };
    worker.onerror = e => { e.preventDefault?.(); for (const d of waiting.values())
        d(null); waiting.clear(); };
    const ask = (msg) => new Promise(ok => { const id = ++reqId; waiting.set(id, ok); worker.postMessage({ ...msg, id }); });
    const fail = (err) => { if (opts.onError)
        opts.onError(err);
    else
        console.warn('[trails-widget]', err.message); };
    const fire = (name, ...a) => { try {
        opts[name]?.(...a);
    }
    catch (err) {
        console.error(err);
    } };
    let toastT;
    const toast = (m) => { const t = q('.tw-toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); };
    /* ----- area ----- */
    async function setArea(a) {
        if (a == null) {
            area = null;
            showNotice('No area to route on yet.');
            return;
        }
        let pkg;
        try {
            if (typeof a === 'string') {
                const res = await fetch(a).catch(() => null);
                if (!res?.ok)
                    throw new WidgetError('area-unreadable', 'That area file couldn’t be loaded.');
                pkg = readArea(await res.text());
            }
            else
                pkg = a.data ? a : readArea(a);
        }
        catch (err) {
            area = null;
            showNotice(err.message);
            fail(err instanceof WidgetError ? err : new WidgetError('area-unreadable', err.message));
            return;
        }
        if (destroyed)
            return;
        area = pkg;
        nodes = area.data.nodes;
        TH = trailheadList(area);
        const r = await ask({ type: 'area', data: area.data });
        if (!r || destroyed)
            return;
        netKm = r.km;
        starts = r.starts;
        params = resolveParams(TH, opts.params, params || undefined);
        raws = [];
        routes = [];
        sel = 0;
        q('.tw-head b').textContent = area.name || 'Trail routes';
        q('.tw-head span').textContent = `${netKm.toFixed(0)} km of trail · ${TH.length} trailhead${TH.length === 1 ? '' : 's'}`;
        q('.tw-credits').innerHTML = `Elevations are approximate. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.` +
            (area.attribution?.length > 1 ? ' ' + esc(area.attribution.slice(1).join('. ')) + '.' : '');
        renderForm();
        renderResults();
        await mapReady;
        drawNetwork();
        fitRoute();
    }
    /* ----- controls ----- */
    const shown = () => new Set(opts.controls ? opts.controls.filter(c => CONTROLS.includes(c)) : CONTROLS);
    function renderForm() {
        if (!area) {
            form.innerHTML = '';
            return;
        }
        const c = shown(), all = c.size === CONTROLS.length, longest = params.mode === 'longest';
        const lapOpts = LAPS.includes(params.lap) ? LAPS : [...LAPS, params.lap].sort((a, b) => a - b);
        const field = {
            mode: `<div class="tw-seg tw-full" role="group" aria-label="What to build"><button type="button" data-mode="target" aria-pressed="${!longest}">Hit a target</button><button type="button" data-mode="longest" aria-pressed="${longest}">Longest loop</button></div>`,
            start: `<label class="tw-f tw-full">Start<select data-k="start">${TH.map(t => `<option value="${esc(t.id)}"${t.id === params.start ? ' selected' : ''}>${esc(t.name)} · ${t.ele} m</option>`).join('')}</select></label>`,
            distance: longest ? '' : `<label class="tw-f">Distance<div class="tw-unit"><input type="number" data-k="distance" min="3" max="80" step="0.5" value="${params.distance / 1000}"><span>km</span></div></label>`,
            climb: longest ? '' : `<label class="tw-f">Climb<div class="tw-unit"><input type="number" data-k="climb" min="0" max="5000" step="50" value="${params.climb}"><span>m</span></div></label>`,
            lap: longest ? '' : `<label class="tw-f">Back at start every<select data-k="lap">${lapOpts.map(v => `<option value="${v}"${v === params.lap ? ' selected' : ''}>${v ? `~${v / 1000} km` : 'Don’t need to'}</option>`).join('')}</select></label>`,
            paved: longest ? '' : `<label class="tw-f">Paved sections<select data-k="paved">${Object.entries(PAVED_LABELS).map(([v, l]) => `<option value="${v}"${v === params.paved ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`,
        };
        const pick = ks => ks.filter(k => c.has(k)).map(k => field[k]).join('');
        const extra = pick(['lap', 'paved']);
        form.innerHTML = pick(['mode', 'start']) +
            (longest ? `<p class="tw-small tw-full">The longest loops from this start, from no repeated trail up to covering every trail with as few repeats as possible.</p>` : '') +
            pick(['distance', 'climb']) +
            (!longest && c.has('distance') && c.has('climb') ? `<p class="tw-small tw-full" data-ratio></p>` : '') +
            (all && extra ? `<details class="tw-more tw-full"><summary>More options</summary><div class="tw-form">${extra}</div></details>` : extra) +
            `<div class="tw-row tw-full"><button type="submit" class="tw-btn tw-primary" data-go>Build routes</button>${longest ? '' : '<button type="button" class="tw-btn" data-shuffle>New variations</button>'}</div>`;
        form.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { readForm(); params.mode = b.dataset.mode; renderForm(); });
        form.querySelector('[data-shuffle]')?.addEventListener('click', () => { readForm(); params.seed = Math.floor(Math.random() * 90000) + 10000; build(); });
        form.querySelectorAll('[data-k=distance],[data-k=climb]').forEach(i => i.addEventListener('input', ratio));
        ratio();
    }
    function ratio() {
        const r = form.querySelector('[data-ratio]');
        if (!r)
            return;
        const D = +form.querySelector('[data-k=distance]').value, E = +form.querySelector('[data-k=climb]').value;
        r.textContent = D > 0 ? `${Math.round(E / D)} m of climb per km` : '';
    }
    function readForm() {
        form.querySelectorAll('[data-k]').forEach(el => {
            const k = el.dataset.k, v = el.value;
            params[k] = k === 'distance' ? +v * 1000 : k === 'climb' || k === 'lap' ? +v : v;
        });
    }
    form.addEventListener('submit', e => { e.preventDefault(); build(); });
    /* ----- search ----- */
    async function build() {
        await ready;
        if (!area || destroyed)
            return [];
        readForm();
        const bad = problem(params);
        if (bad) {
            toast(bad);
            fail(new WidgetError('invalid-params', bad));
            return [];
        }
        const p = { ...params }, ti = TH.findIndex(t => t.id === p.start);
        busy(true);
        const r = await ask({ type: 'search', params: solverParams(p, starts[ti]) });
        if (destroyed)
            return [];
        if (!r || r.error) {
            if (r?.id === reqId || !r) {
                busy(false);
                toast('Something went wrong building routes. Try other settings.');
            }
            fail(new WidgetError('search-failed', r?.error || 'The route search stopped.'));
            return [];
        }
        const latest = r.id === reqId;
        const found = r.routes.map((x, i) => toRoute(x, i, { area: area, nodes, params: p, start: publicTh(TH[ti]), pace: opts.prefs?.pace }));
        if (!latest)
            return found;
        busy(false);
        raws = r.routes;
        routes = found;
        reach = r.reach;
        sel = 0;
        note = noteFor(p);
        renderResults();
        renderAll();
        fitRoute();
        fire('onRoutes', routes);
        if (!routes.length)
            fail(new WidgetError('no-route', 'No loop fits these settings from this start.'));
        else
            fire('onRoute', routes[0]);
        return found;
    }
    const publicTh = ({ node, ...t }) => t;
    function busy(on) { q('.tw-busy').hidden = !on; const go = form.querySelector('[data-go]'); if (go)
        go.disabled = on; }
    function noteFor(p) {
        if (!routes.length)
            return 'No loop fits these settings from this start. Try a shorter distance or another start.';
        if (p.mode === 'longest')
            return '';
        const g = routes[0].climb;
        if (g < p.climb * 0.85)
            return `The closest is ${Math.round(g)} m of climb. ${p.distance / 1000} km isn’t enough to reach ${p.climb} m without lots of repeats. Try a longer distance.`;
        if (g > p.climb * 1.2)
            return `Hard to keep this flat: the closest is ${Math.round(g)} m of climb.`;
        return '';
    }
    /* ----- results ----- */
    const panelOn = (k) => opts.panels?.[k] !== false;
    function chip(what, val, target, tol, unit) {
        const off = val - target, ok = Math.abs(off) <= tol;
        return `<span class="tw-chip ${ok ? 'ok' : 'off'}">${ok ? what + ' on target' : (off > 0 ? '+' : '') + Math.round(off) + ' ' + unit + ' ' + what.toLowerCase()}</span>`;
    }
    function renderResults() {
        const el = q('.tw-results');
        if (!panelOn('results') || (!routes.length && !note)) {
            el.innerHTML = '';
            renderTake();
            return;
        }
        if (!routes.length) {
            el.innerHTML = `<div class="tw-notice">${esc(note)}</div>`;
            renderTake();
            return;
        }
        const p = routes[0].params, longest = p.mode === 'longest';
        el.innerHTML = `<h2 class="tw-title">${longest ? 'Longest loops' : 'Options'}</h2>${note ? `<div class="tw-notice">${esc(note)}</div>` : ''}<div class="tw-opts">${routes.map((r, i) => `
      <button type="button" class="tw-opt" data-i="${i}" aria-pressed="${i === sel}">
        <span class="tw-letter">${'ABC'[i]}</span>
        <span class="tw-nums">${longest ? esc(r.label) + ' · ' + fmtKm(r.distance) : fmtKm(r.distance) + ' · ↑' + Math.round(r.climb) + ' m'}</span>
        <span class="tw-time">~${fmtTime(r.estimatedTime)}</span>
        <span class="tw-sub">${longest
            ? `↑${Math.round(r.climb)} m · ${Math.round(Math.min(100, (r.distance - r.repeated) / 1000 / reach * 100))}% of trails · ${Math.round(r.repeated / r.distance * 100)}% repeated`
            : `${chip('Distance', r.distance / 1000, p.distance / 1000, p.distance / 1000 * 0.05, 'km')} ${chip('Climb', r.climb, p.climb, Math.max(40, p.climb * 0.08), 'm')} ${Math.round(r.repeated / r.distance * 100)}% repeated${r.paved > 200 ? ` · ${fmtKm(r.paved)} paved` : ''}${r.laps > 1 ? ` · ${r.laps} laps` : ''}`}</span>
      </button>`).join('')}</div>
      <p class="tw-small" style="margin-top:8px">Time assumes ${paceText()}/km plus 4 s per metre of climb.</p>`;
        el.querySelectorAll('.tw-opt').forEach(b => b.onclick = () => choose(+b.dataset.i, true));
        renderTake();
    }
    const paceText = () => { const s = opts.prefs?.pace || 390; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
    function renderTake() {
        const el = q('.tw-take'), r = routes[sel];
        if (!r || !panelOn('results')) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = `<h2 class="tw-title">Take it with you</h2><div class="tw-row"><button type="button" class="tw-btn tw-primary" data-dl>${opts.onExport ? 'Use this route' : 'Download GPX'}</button><button type="button" class="tw-btn" data-copy>Copy GPX</button></div>`;
        el.querySelector('[data-dl]').onclick = () => {
            const gpx = r.gpx();
            if (opts.onExport)
                return fire('onExport', r, gpx);
            download(gpx, `${(area.name + ' ' + r.label).replace(/[^\w .-]/g, '')}.gpx`, 'application/gpx+xml');
        };
        el.querySelector('[data-copy]').onclick = async () => {
            try {
                await navigator.clipboard.writeText(r.gpx());
                toast('GPX copied.');
            }
            catch {
                toast('Copying isn’t allowed here. Use Download instead.');
            }
        };
    }
    function choose(i, fit) {
        sel = i;
        q('.tw-results').querySelectorAll('.tw-opt').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.i === sel)));
        renderTake();
        renderAll();
        if (fit)
            fitRoute();
        fire('onRoute', routes[sel]);
    }
    function showNotice(text) { note = text; routes = []; raws = []; form.innerHTML = ''; renderResults(); renderAll(); }
    /* ----- map ----- */
    const mapReady = loadLeaflet().then(L => {
        if (destroyed)
            return;
        map = L.map(q('.tw-map'), { zoomSnap: 0.25, preferCanvas: true });
        baseLayers(L, map);
        layers = { net: L.layerGroup().addTo(map), th: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map) };
        map.setView([20, 0], 2);
    }, err => fail(err));
    const LL = (n) => [nodes[n][0], nodes[n][1]];
    function drawNetwork() {
        if (!map || !layers || !area)
            return;
        layers.net.clearLayers();
        layers.th.clearLayers();
        for (const s of area.data.segs)
            L.polyline(s.p.map(LL), { color: MC.net, weight: 2, opacity: .55, interactive: false }).addTo(layers.net);
        for (const t of TH)
            L.circleMarker(t.at, { radius: 4, color: MC.ink, weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(esc(t.name)).addTo(layers.th);
    }
    function renderMap() {
        if (!map || !layers)
            return;
        layers.route.clearLayers();
        hoverMk = null;
        const r = raws[sel];
        if (!r)
            return;
        const pts = r.geom.pts, runs = [];
        let cur = { lap: pts[0].lap, ll: [LL(pts[0].n)] };
        for (let i = 1; i < pts.length; i++) {
            cur.ll.push(LL(pts[i].n));
            if (pts[i].lap !== cur.lap) {
                runs.push(cur);
                cur = { lap: pts[i].lap, ll: [LL(pts[i].n)] };
            }
        }
        runs.push(cur);
        for (const run of runs)
            L.polyline(run.ll, { color: '#fff', weight: 8, opacity: .9, interactive: false }).addTo(layers.route);
        for (const run of runs)
            L.polyline(run.ll, { color: MC.laps[Math.max(0, run.lap) % 4], weight: 4.5, opacity: .95, interactive: false }).addTo(layers.route);
        const cos0 = Math.cos(nodes[0][0] * Math.PI / 180);
        let nextAt = 400; // direction arrows every ~800 m
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].cum < nextAt)
                continue;
            nextAt += 800;
            const a = nodes[pts[i - 1].n], b = nodes[pts[i].n], ang = Math.atan2(-(b[0] - a[0]), (b[1] - a[1]) * cos0) * 180 / Math.PI;
            L.marker(LL(pts[i].n), { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [10, 10], html: `<div class="tw-arrow" style="transform:rotate(${ang.toFixed(0)}deg)"></div>` }) }).addTo(layers.route);
        }
        L.circleMarker(routes[sel].start.at, { radius: 7, color: '#fff', weight: 2.5, fillColor: MC.ink, fillOpacity: 1, interactive: false })
            .bindTooltip('Start / finish', { permanent: true, direction: 'right', offset: [8, 0], className: 'tw-startlab' }).addTo(layers.route);
    }
    function setHover(i) {
        const r = raws[sel];
        if (i == null || !r || !map || !layers) {
            hoverMk?.remove();
            hoverMk = null;
            return;
        }
        const ll = LL(r.geom.pts[i].n);
        if (!hoverMk)
            hoverMk = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: MC.laps[0], fillOpacity: 1, interactive: false }).addTo(layers.route);
        else
            hoverMk.setLatLng(ll);
    }
    function fitRoute() {
        if (!map || !area)
            return;
        const r = raws[sel];
        const b = r ? L.latLngBounds(r.geom.pts.map(p => LL(p.n))) : L.latLngBounds(nodes.map((n) => [n[0], n[1]]));
        map.fitBounds(b, { padding: [30, 30] });
    }
    q('.tw-fit').onclick = fitRoute;
    /* ----- elevation profile ----- */
    const sv = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs)
        e.setAttribute(k, String(attrs[k])); parent?.appendChild(e); return e; };
    function renderProfile() {
        prof.textContent = '';
        const r = raws[sel];
        const W = prof.getBoundingClientRect().width || 600, H = 110;
        prof.setAttribute('viewBox', `0 0 ${W} ${H}`);
        if (!r)
            return;
        const pts = r.geom.pts, total = pts[pts.length - 1].cum, es = pts.map(p => nodes[p.n][2] ?? 0);
        const lo = Math.min(...es), hi = Math.max(...es), pl = 44, pr = 8, pt = 10, pb = 20;
        const xs = d => pl + d / total * (W - pl - pr), ys = e => H - pb - (e - lo) / Math.max(1, hi - lo) * (H - pt - pb);
        const lbl = { 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--font)' };
        for (const v of [lo, hi]) {
            sv('line', { x1: pl, x2: W - pr, y1: ys(v), y2: ys(v), stroke: 'var(--grid)' }, prof);
            sv('text', { x: pl - 6, y: ys(v) + 4, 'text-anchor': 'end', ...lbl }, prof).textContent = Math.round(v) + ' m';
        }
        const step = total > 30000 ? 10000 : total > 12000 ? 5000 : 2000;
        for (let d = 0; d <= total; d += step)
            sv('text', { x: xs(d), y: H - 5, 'text-anchor': d === 0 ? 'start' : 'middle', ...lbl }, prof).textContent = (d / 1000) + ' km';
        const line = pts.map((p, i) => xs(p.cum).toFixed(1) + ',' + ys(es[i]).toFixed(1)).join(' ');
        sv('polygon', { points: `${pl},${H - pb} ${line} ${W - pr},${H - pb}`, fill: 'var(--accent-soft)' }, prof);
        sv('polyline', { points: line, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, prof);
        for (const c of r.geom.cuts.slice(1))
            sv('line', { x1: xs(c), x2: xs(c), y1: pt, y2: H - pb, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, prof);
        if (hoverPt != null) {
            const p = pts[hoverPt];
            sv('line', { x1: xs(p.cum), x2: xs(p.cum), y1: pt, y2: H - pb, stroke: 'var(--text)', 'stroke-width': 1 }, prof);
            sv('circle', { cx: xs(p.cum), cy: ys(es[hoverPt]), r: 3.5, fill: 'var(--accent)' }, prof);
        }
        prof._xs = { pl, pr, W, total };
    }
    prof.addEventListener('pointermove', e => {
        const r = raws[sel];
        if (!r || !prof._xs)
            return;
        const b = prof.getBoundingClientRect(), { pl, pr, W, total } = prof._xs;
        const d = Math.max(0, Math.min(total, ((e.clientX - b.left) / b.width * W - pl) / (W - pl - pr) * total));
        const pts = r.geom.pts;
        let lo = 0, hi = pts.length - 1;
        while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (pts[m].cum < d)
                lo = m;
            else
                hi = m;
        }
        hoverPt = hi;
        q('.tw-tip').textContent = `${(pts[hi].cum / 1000).toFixed(2)} km · ${Math.round(nodes[pts[hi].n][2] ?? 0)} m`;
        setHover(hi);
        renderProfile();
    });
    prof.addEventListener('pointerleave', () => { hoverPt = null; q('.tw-tip').textContent = ''; setHover(null); renderProfile(); });
    function renderAll() { hoverPt = null; renderMap(); renderProfile(); }
    function applyLayout() {
        root.dataset.theme = themeOf(opts.theme);
        q('.tw-profile').hidden = !panelOn('profile');
        q('.tw-head').hidden = opts.panels?.header === false;
        const panelEmpty = !panelOn('results') && opts.controls?.length === 0 && opts.panels?.header === false;
        q('.tw-panel').hidden = panelEmpty;
        q('.tw-grid').classList.toggle('tw-nopanel', panelEmpty);
    }
    let resizeT;
    const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { map?.invalidateSize(); renderProfile(); }, 100); });
    ro.observe(root);
    applyLayout();
    ready = setArea(opts.area);
    if (opts.autoBuild)
        ready.then(() => area && build());
    return {
        update(next = {}) {
            const areaChanged = 'area' in next && next.area !== opts.area;
            opts = { ...opts, ...next, panels: { ...opts.panels, ...next.panels } };
            applyLayout();
            if (areaChanged) {
                ready = setArea(opts.area);
                return;
            }
            if (area && next.params) {
                readForm();
                params = resolveParams(TH, next.params, params || undefined);
            }
            if (area && (next.params || next.controls))
                renderForm();
            if (next.panels || next.prefs)
                renderResults();
        },
        build,
        select(id) {
            const i = routes.findIndex(r => r.id === id);
            if (i < 0)
                throw new WidgetError('no-route', `No route with id ${id}.`);
            choose(i, true);
        },
        get routes() { return routes.slice(); },
        get params() { return params ? { ...params } : null; },
        get area() { return area; },
        destroy() {
            destroyed = true;
            ro.disconnect();
            clearTimeout(toastT);
            clearTimeout(resizeT);
            worker.terminate();
            URL.revokeObjectURL(worker._url);
            for (const d of waiting.values())
                d(null);
            waiting.clear();
            map?.remove();
            root.remove();
        },
    };
}
