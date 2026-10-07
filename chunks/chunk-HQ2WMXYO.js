import{a as i}from"./chunk-7AU3EHM6.js";var n=globalThis,d=null;function l(){return n.L?.map?Promise.resolve(n.L):d||=import("../widget/v1/leaflet.js").then(t=>(document.querySelector('link[href*="leaflet"]')||p("tw-leaflet",t.css),n.L=t.default),()=>{throw d=null,new i("map-unavailable","The map library couldn\u2019t load.")})}var s=`
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
@media (prefers-reduced-motion:reduce){.tw *{transition:none!important;animation:none!important}}`;function p(t,e){document.getElementById("trails-widget-v1")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"trails-widget-v1",textContent:s})),t&&!document.getElementById(t)&&document.head.appendChild(Object.assign(document.createElement("style"),{id:t,textContent:e}))}function f(t,e){let a=t.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'\xA9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}),r=t.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{maxZoom:17,attribution:'\xA9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM \xB7 style \xA9 <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'});a.addTo(e),t.control.layers({Streets:a,Topo:r},void 0,{position:"topright"}).addTo(e),t.control.scale({imperial:!1}).addTo(e)}var g=t=>String(t).replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]),u=t=>t==="light"||t==="dark"?t:"auto";function m(t,e,a){let r=URL.createObjectURL(new Blob([t],{type:a})),o=Object.assign(document.createElement("a"),{href:r,download:e});document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(r),2e3)}export{l as a,p as b,f as c,g as d,u as e,m as f};
//# sourceMappingURL=chunk-HQ2WMXYO.js.map
