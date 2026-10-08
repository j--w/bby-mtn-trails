// Route search core. Pure functions over a graph; no DOM.
// Loaded in the browser by the route builder widget's worker and by the tests in Node.
import FlatQueue from 'flatqueue';
import { eqScale } from './types.js';
import type { RouterData, LatLonEle, SegKind, Oneway } from './types.js';

/** A graph edge: one segment between junctions a and b. */
export interface Edge { a: number; b: number; len: number; up: number; dn: number; g: number | null; gd: number | null; k: SegKind; o: Oneway; n?: string; p?: number[] }
/** Travelling edge e from junction `from` to `to` (dir 1 along the segment, -1 against it). */
export interface Turn { e: number; dir: 1 | -1; from: number; to: number }
export interface Graph { edges: Edge[]; adj: Turn[][]; inc: Turn[][] }
export interface FullGraph extends Graph { jnodes: number[]; J: (node: number) => number }
/** A route as steps of [edge, dir]; bounds are the step indices where each lap starts. */
export type Step = [number, 1 | -1];
export interface RouteStats { dist: number; gain: number; loss: number; rep: number; paved: number; uturn: number }
export interface RawRoute { steps: Step[]; bounds: number[]; s: RouteStats; laps: number; label?: string; desc?: string }
/** Target-mode search params: D metres, E metres of climb, lap km (0 = none), pavedW the paved penalty. */
export interface SolveParams { start: number; D: number; E: number; maxg: number; late: number; lap: number; pavedW: number; seed: number; hAll?: Float64Array; hLate?: Float64Array }
export interface LongestParams { start: number; maxg: number }
interface Weights { climb: number; rep: number; uturn: number; paved: number; noise: number }

function mulberry32(a: number){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
let G: Graph = { edges: [], adj: [], inc: [] };
export function setGraph(g: Graph){ G=g; }

// Build the routing graph from an area data file ({nodes:[[lat,lon,ele]], segs:[{p,n,k,g,gd,o}], th}).
// Junction ids (J) are dense indices over segment end nodes; edges keep their full node path in p.
export function buildGraph(DATA: RouterData): FullGraph {
  const N=DATA.nodes, R=6371000, lat0=N[0][0]*Math.PI/180;
  const X=N.map(n=>n[1]*Math.PI/180*R*Math.cos(lat0)), Y=N.map(n=>-n[0]*Math.PI/180*R);
  const d2=(a: number,b: number)=>Math.hypot(X[a]-X[b],Y[a]-Y[b]);
  const jid=new Map<number, number>(), jnodes: number[]=[];
  const J=(n: number): number=>{ if(!jid.has(n)){ jid.set(n,jnodes.length); jnodes.push(n);} return jid.get(n)!; };
  const edges: Edge[]=DATA.segs.map(s=>{
    let len=0,up=0,dn=0;
    for(let i=1;i<s.p.length;i++){ len+=d2(s.p[i-1],s.p[i]); const dz=(N[s.p[i]][2] ?? 0)-(N[s.p[i-1]][2] ?? 0); if(dz>0) up+=dz; else dn-=dz; }
    return {a:J(s.p[0]), b:J(s.p[s.p.length-1]), len, up, dn, g:s.g, gd:s.gd, k:s.k, o:s.o, n:s.n, p:s.p};
  });
  const adj: Turn[][]=jnodes.map(()=>[]), inc: Turn[][]=jnodes.map(()=>[]);
  edges.forEach((e,i)=>{
    const f: Turn={e:i,dir:1,from:e.a,to:e.b}, r: Turn={e:i,dir:-1,from:e.b,to:e.a};
    adj[e.a].push(f); adj[e.b].push(r); inc[e.b].push(f); inc[e.a].push(r);
  });
  return {edges, adj, inc, jnodes, J};
}
// The slimmed graph the worker needs (no geometry).
export function workerGraph({edges, adj, inc}: Graph): Graph {
  return {edges:edges.map(e=>({a:e.a,b:e.b,len:e.len,up:e.up,dn:e.dn,g:e.g,gd:e.gd,k:e.k,o:e.o})), adj, inc};
}
// A route's path for display: nodes with distance along the route and lap number, and where each lap starts.
export function routeGeometry(r: { steps: Step[]; bounds: number[] }, edges: Edge[], nodes: LatLonEle[]){
  const [kx,ky]=eqScale(nodes);
  const d2=(a: number,b: number)=>Math.hypot((nodes[a][1]-nodes[b][1])*kx, (nodes[a][0]-nodes[b][0])*ky);
  const pts: Array<{ n: number; cum: number; lap: number }>=[], lapAt=new Set(r.bounds), cuts: number[]=[]; let cum=0;
  r.steps.forEach(([e,dir],i)=>{
    if(lapAt.has(i)) cuts.push(cum);
    const p = dir>0 ? edges[e].p! : edges[e].p!.slice().reverse();
    p.forEach((n,j)=>{ if(pts.length && j===0) return; if(pts.length) cum+=d2(pts[pts.length-1].n,n); pts.push({n,cum,lap:cuts.length-1}); });
  });
  return {pts, cuts};
}
// Trail km reachable from a junction (the "% of trails" a longest loop covers).
export function reachableKm(start: number, maxg: number, edges: Edge[], adj: Turn[][]){
  const seen=new Set([start]), st=[start], es=new Set<number>();
  while(st.length){ const u=st.pop()!; for(const t of adj[u]){ const e=edges[t.e]; if((e.g||2)>maxg) continue; es.add(t.e); if(!seen.has(t.to)){ seen.add(t.to); st.push(t.to); } } }
  let L=0; for(const i of es) L+=edges[i].len; return L/1000;
}
const UNK = 2;
function effGrade(ed: Edge, dir: number){
  const up = dir>0?ed.up:ed.dn, dn = dir>0?ed.dn:ed.up;
  const base = ed.g || UNK;
  if(dn - up > 8 && ed.gd) return Math.max(base, ed.gd);
  return base;
}
function allowed(t: Turn, limit: number){
  const ed=G.edges[t.e];
  if(ed.o==='forward' && t.dir<0) return false;
  if(ed.o==='reverse' && t.dir>0) return false;
  return effGrade(ed,t.dir) <= limit;
}
function homeDist(start: number, limit: number){
  const n=G.adj.length, d=new Float64Array(n).fill(Infinity); d[start]=0;
  const done=new Uint8Array(n), q=new FlatQueue<number>(); q.push(start,0);
  while(q.length){
    const u=q.pop()!; if(done[u]) continue; done[u]=1;
    for(const t of G.inc[u]){ if(!allowed(t,limit)) continue; const nd=d[u]+G.edges[t.e].len; if(nd<d[t.from]){ d[t.from]=nd; q.push(t.from,nd); } }
  }
  return d;
}
function pathHome(from: number, start: number, limit: number, used: Map<number, number>, pavedW: number): Turn[] | null {
  const n=G.adj.length, d=new Float64Array(n).fill(Infinity), prev: Array<Turn | null>=new Array(n).fill(null), done=new Uint8Array(n);
  d[from]=0; const q=new FlatQueue<number>(); q.push(from,0);
  while(q.length){
    const u=q.pop()!; if(done[u]) continue; if(u===start) break; done[u]=1;
    for(const t of G.adj[u]){ if(!allowed(t,limit)) continue; const ed=G.edges[t.e];
      const c=ed.len*(1+1.2*(used.get(t.e)||0)+(ed.k==='connector'?pavedW*0.4:0));
      if(d[u]+c<d[t.to]){ d[t.to]=d[u]+c; prev[t.to]=t; q.push(t.to,d[t.to]); } }
  }
  if(d[start]===Infinity) return null;
  const out: Turn[]=[]; let v=start; while(v!==from){ const t=prev[v]!; out.push(t); v=t.from; }
  return out.reverse();
}
function walk(p: SolveParams, lapD: number, lapE: number, used: Map<number, number>, rng: () => number, w: Weights, offset: number): Turn[] | null {
  let node=p.start, dist=0, gain=0, last=-1; const steps: Turn[]=[];
  const local=new Map(used);
  for(let guard=0; guard<3000; guard++){
    const late = p.late>0 && (offset+dist) > p.D*2/3;
    const limit = late ? Math.min(p.maxg,p.late) : p.maxg;
    const h = (late ? p.hLate : p.hAll)!;
    const R = lapD - dist;
    if(R <= h[node]*1.02 + 120) break;
    const need = Math.max(0, lapE-gain) / Math.max(R, 300);
    const cands: Array<[Turn, number]>=[]; let maxS=-Infinity;
    for(const t of G.adj[node]){
      if(!allowed(t,limit)) continue;
      const ed=G.edges[t.e];
      if(dist + ed.len + h[t.to] > lapD*1.03) continue;
      const vert=(ed.up+ed.dn)/2/Math.max(ed.len,1);
      let s = -w.climb*Math.abs(vert-need)*25;
      const u=local.get(t.e)||0;
      s -= w.rep*u;
      if(t.e===last) s -= w.uturn;
      if(ed.k==='connector') s -= p.pavedW*w.paved;
      s += (rng()-0.5)*w.noise;
      cands.push([t,s]); if(s>maxS) maxS=s;
    }
    if(!cands.length) break;
    let tot=0; for(const c of cands){ c[1]=Math.exp(c[1]-maxS); tot+=c[1]; }
    let r=rng()*tot, pick=cands[0][0];
    for(const c of cands){ r-=c[1]; if(r<=0){ pick=c[0]; break; } }
    const ed=G.edges[pick.e];
    steps.push(pick); local.set(pick.e,(local.get(pick.e)||0)+1);
    dist+=ed.len; gain+= pick.dir>0?ed.up:ed.dn; last=pick.e; node=pick.to;
  }
  const late = p.late>0 && (offset+dist) > p.D*2/3;
  const home = node===p.start ? [] : (pathHome(node, p.start, late?Math.min(p.maxg,p.late):p.maxg, local, p.pavedW) || pathHome(node,p.start,4,local,p.pavedW));
  if(!home) return null;
  for(const t of home){ steps.push(t); local.set(t.e,(local.get(t.e)||0)+1); }
  return steps;
}
function stats(steps: Array<{ e: number; dir: number }>): RouteStats {
  let dist=0,gain=0,loss=0,rep=0,paved=0,uturn=0; const seen=new Map(); let last=-1;
  for(const t of steps){ const ed=G.edges[t.e]; dist+=ed.len; gain+=t.dir>0?ed.up:ed.dn; loss+=t.dir>0?ed.dn:ed.up;
    if(seen.has(t.e)) rep+=ed.len; seen.set(t.e,1); if(ed.k==='connector') paved+=ed.len; if(t.e===last && ed.len>30) uturn++; last=t.e; }
  return {dist,gain,loss,rep,paved,uturn};
}
function cost(s: RouteStats, p: { D: number; E: number; pavedW: number }){
  return 3*Math.abs(s.dist-p.D)/p.D + 2.5*Math.abs(s.gain-p.E)/Math.max(p.E,150) + 1.2*s.rep/s.dist + 0.6*p.pavedW*s.paved/s.dist + 0.12*s.uturn;
}
// ---- longest loop: Euler circuits on an even-degree version of the network ----
export function solveLongest(p: LongestParams): RawRoute[] {
  const ok = (i: number) => { const ed=G.edges[i]; return !ed.o || ed.o==='no' ? (ed.g||UNK)<=p.maxg : false; };
  // component of allowed edges reachable from start
  const n=G.adj.length; const inComp=new Uint8Array(G.edges.length); const seenN=new Uint8Array(n); const st=[p.start]; seenN[p.start]=1;
  while(st.length){ const u=st.pop()!; for(const t of G.adj[u]){ if(!ok(t.e)) continue; inComp[t.e]=1; if(!seenN[t.to]){ seenN[t.to]=1; st.push(t.to); } } }
  const base: number[]=[]; for(let i=0;i<G.edges.length;i++) if(inComp[i]) base.push(i);
  if(!base.length) return [];
  const out: Array<{ steps: Step[]; s: RouteStats; label: string; desc: string }>=[];
  // A: no repeats. B: drop dead-end spurs, then cover. C: cover everything.
  const spurless = pruneSpurs(base, p.start);
  const cover = (es: number[]) => { const J=tJoin(es); return eulerRoute(es.concat(J), p.start); };
  const C = cover(base); if(C) out.push({...C, label:'Every trail', desc:'Covers every trail at this difficulty with the fewest repeats.'});
  const B = spurless.length && spurless.length<base.length ? cover(spurless) : null;
  if(B) out.push({...B, label:'Skip dead ends', desc:'Every trail except out-and-back spurs, fewest repeats.'});
  const A = noRepeat(base, p.start); if(A) out.push({...A, label:'No repeats', desc: A.s.rep>0 ? 'The longest loop found that never runs a trail twice, plus the short way in and out from this start.' : 'The longest loop found that never runs a trail twice.'});
  out.sort((a,b)=>a.s.rep/a.s.dist - b.s.rep/b.s.dist);
  return out.map(r=>({steps:r.steps, bounds:[0], s:r.s, laps:1, label:r.label, desc:r.desc}));
  function degOf(es: number[]){ const d=new Map<number, number>(); for(const i of es){ const e=G.edges[i]; d.set(e.a,(d.get(e.a)||0)+1); d.set(e.b,(d.get(e.b)||0)+1); } return d; }
  function pruneSpurs(es: number[], keep: number){
    let cur=es.slice();
    for(;;){ const d=degOf(cur); const nxt=cur.filter(i=>{ const e=G.edges[i]; return !((d.get(e.a)===1&&e.a!==keep)||(d.get(e.b)===1&&e.b!==keep)); }); if(nxt.length===cur.length) return cur; cur=nxt; }
  }
  function sp(es: number[]){ // adjacency for a subset
    const A=new Map<number, Array<[number, number]>>(); for(const i of es){ const e=G.edges[i]; if(!A.has(e.a)) A.set(e.a,[]); if(!A.has(e.b)) A.set(e.b,[]); A.get(e.a)!.push([i,e.b]); A.get(e.b)!.push([i,e.a]); } return A;
  }
  function dijkstra(A: Map<number, Array<[number, number]>>, src: number){
    const d=new Map([[src,0]]), prev=new Map<number, [number, number]>(), done=new Set<number>(), q=new FlatQueue<number>(); q.push(src,0);
    while(q.length){ const u=q.pop()!; if(done.has(u)) continue; done.add(u); const b=d.get(u)!;
      for(const [i,v] of A.get(u)!){ const nd=b+G.edges[i].len; if(nd<(d.get(v)??Infinity)){ d.set(v,nd); prev.set(v,[i,u]); q.push(v,nd); } } }
    return {d,prev};
  }
  function tJoin(es: number[]): number[] { // min-ish T-join: match odd vertices by shortest paths, greedy then 2-opt
    const A=sp(es), d=degOf(es); const odd=[...d.keys()].filter(k=>d.get(k)!%2);
    if(!odd.length) return [];
    const D=new Map<number, ReturnType<typeof dijkstra>>(); for(const o of odd) D.set(o, dijkstra(A,o));
    const dist=(a: number,b: number)=>D.get(a)!.d.get(b)??Infinity;
    const pairs: Array<[number, number, number]>=[]; for(let i=0;i<odd.length;i++) for(let j=i+1;j<odd.length;j++) pairs.push([dist(odd[i],odd[j]),odd[i],odd[j]]);
    pairs.sort((x,y)=>x[0]-y[0]); const used=new Set<number>(), M: Array<[number, number]>=[];
    for(const [w,a,b] of pairs){ if(used.has(a)||used.has(b)) continue; used.add(a); used.add(b); M.push([a,b]); }
    for(let improved=true, it=0; improved && it<50; it++){ improved=false;
      for(let i=0;i<M.length;i++) for(let j=i+1;j<M.length;j++){
        const [a,b]=M[i],[c,e]=M[j]; const now=dist(a,b)+dist(c,e);
        if(dist(a,c)+dist(b,e) < now-1e-6){ M[i]=[a,c]; M[j]=[b,e]; improved=true; }
        else if(dist(a,e)+dist(b,c) < now-1e-6){ M[i]=[a,e]; M[j]=[b,c]; improved=true; } } }
    const par=new Map<number, number>();
    for(const [a,b] of M){ const {prev}=D.get(a)!; let v=b; while(v!==a){ const [i,u]=prev.get(v)!; par.set(i,(par.get(i)||0)^1); v=u; } }
    return [...par].filter(([i,x])=>x).map(([i])=>i);
  }
  function eulerRoute(es: number[], start: number): { steps: Step[]; s: RouteStats } | null {
    const A=new Map<number, number[]>(); es.forEach((i,k)=>{ const e=G.edges[i]; if(!A.has(e.a)) A.set(e.a,[]); if(!A.has(e.b)) A.set(e.b,[]); A.get(e.a)!.push(k); A.get(e.b)!.push(k); });
    if(!A.has(start)) return null;
    const usedK=new Uint8Array(es.length), ptr=new Map<number, number>(); const stack: Array<[number, Step | null]>=[[start,null]], circ: Array<[number, Step | null]>=[];
    while(stack.length){
      const [v]=stack[stack.length-1]; const lst=A.get(v)!; let p0=ptr.get(v)||0;
      while(p0<lst.length && usedK[lst[p0]]) p0++; ptr.set(v,p0);
      if(p0===lst.length){ circ.push(stack.pop()!); continue; }
      const k=lst[p0]; usedK[k]=1; const e=G.edges[es[k]]; const to=e.a===v?e.b:e.a;
      stack.push([to,[es[k], e.a===v?1:-1]]);
    }
    const steps=circ.reverse().map(x=>x[1]).filter((x): x is Step => !!x);
    const s=stats(steps.map(([e,dir])=>({e,dir}))); return {steps, s};
  }
  function noRepeat(es: number[], start: number): { steps: Step[]; s: RouteStats } | null {
    const J=new Set(tJoin(es)); let keep=es.filter(i=>!J.has(i));
    // keep the component that holds the start; reach it by an out-and-back if needed
    const A=sp(keep); const comps: Array<{ nodes: Set<number>; edges: number[]; len: number }>=[]; const seen=new Set<number>();
    for(const k of A.keys()){ if(seen.has(k)) continue; const c: number[]=[]; const q=[k]; seen.add(k); let len=0; const ce=new Set<number>();
      while(q.length){ const u=q.pop()!; c.push(u); for(const [i,v] of A.get(u)!){ if(!ce.has(i)){ ce.add(i); len+=G.edges[i].len; } if(!seen.has(v)){ seen.add(v); q.push(v); } } }
      comps.push({nodes:new Set(c), edges:[...ce], len}); }
    comps.sort((a,b)=>b.len-a.len);
    let own=comps.find(c=>c.nodes.has(start)); let target=comps[0]; if(!target) return null;
    if(own && own.len>=target.len*0.6) target=own;
    let lead: number[]=[];
    if(!target.nodes.has(start)){
      const {d,prev}=dijkstra(sp(es), start); let best: number | null=null,bd=Infinity; for(const v of target.nodes){ const x=d.get(v); if(x!==undefined&&x<bd){bd=x;best=v;} }
      if(best===null) return null; let v: number=best; while(v!==start){ const [i,u]=prev.get(v)!; lead.push(i); v=u; }
      lead.reverse(); const entry=best;
      const leadSet=new Set(lead); const rest=es.filter(i=>!leadSet.has(i)); const r=eulerRoute(anneal(grow(target.edges, rest, entry), rest, entry), entry); if(!r) return null; // start sits outside the main loop
      // walk in, loop, walk out the same way
      const inSteps: Step[]=[]; let cur=start; for(const i of lead){ const e=G.edges[i]; inSteps.push([i, e.a===cur?1:-1]); cur=e.a===cur?e.b:e.a; }
      const outSteps=inSteps.slice().reverse().map(([i,dr]): Step=>[i,dr>0?-1:1]);
      const steps=inSteps.concat(r.steps, outSteps); return {steps, s:stats(steps.map(([e,dir])=>({e,dir})))};
    }
    return eulerRoute(anneal(grow(target.edges, es, start), es, start), start);
  }
  // Improve an even, connected loop by toggling whole cycles of the network in and out (simulated annealing,
  // fixed seed). grow() only swaps one path at a time and stalls on networks with many short links; this
  // can give up some trail to reach a longer loop. Works on chains: runs of trail between branch points.
  function anneal(cur: number[], all: number[], root: number): number[] {
    const core=pruneSpurs(all, root), deg=degOf(core);
    const branch=(n: number)=>n===root || deg.get(n)!==2;
    const A=sp(core), chainOf=new Map<number, number>(), chains: Array<{ es: number[]; a: number; b: number; len: number }>=[];
    for(const i of core){ if(chainOf.has(i)) continue;
      // walk both ways from edge i to branch points
      const e=G.edges[i], es=[i]; const ends: number[]=[];
      for(const [from,to] of [[e.b,e.a],[e.a,e.b]]){ let prevE=i, v=to;
        while(!branch(v)){ const nx=A.get(v)!.find(([j])=>j!==prevE); if(!nx||nx[0]===i) break; es.push(nx[0]); prevE=nx[0]; v=nx[1]; }
        ends.push(v); }
      const c={es, a:ends[0], b:ends[1], len:es.reduce((s,j)=>s+G.edges[j].len,0)};
      for(const j of es) chainOf.set(j, chains.length); chains.push(c);
    }
    const inS=new Uint8Array(chains.length); let curLen=0;
    for(const i of cur){ const c=chainOf.get(i); if(c===undefined) return cur; if(!inS[c]){ inS[c]=1; curLen+=chains[c].len; } }
    if(cur.some(i=>!chains[chainOf.get(i)!].es.every(j=>cur.includes(j)))) return cur;
    // fundamental cycles of a BFS tree over branch points
    const CA=new Map<number, Array<[number, number]>>(); chains.forEach((c,k)=>{ for(const [x,y] of [[c.a,c.b],[c.b,c.a]]){ if(!CA.has(x)) CA.set(x,[]); CA.get(x)!.push([k,y]); } });
    if(!CA.has(root)) return cur;
    const par=new Map<number, [number, number] | null>([[root,null]]), dep=new Map([[root,0]]), q=[root], tree=new Uint8Array(chains.length);
    for(let k=0;k<q.length;k++){ const u=q[k]; for(const [c,v] of CA.get(u)!) if(!par.has(v)){ par.set(v,[c,u]); dep.set(v,dep.get(u)!+1); tree[c]=1; q.push(v); } }
    const cycles: number[][]=[];
    // chains in parts of the network the root can't reach have no cycle through it
    chains.forEach((c,k)=>{ if(tree[k] || !par.has(c.a) || !par.has(c.b)) return; const cy=[k]; let a=c.a, b=c.b;
      while(a!==b){ if(dep.get(a)!>=dep.get(b)!){ cy.push(par.get(a)![0]); a=par.get(a)![1]; } else { cy.push(par.get(b)![0]); b=par.get(b)![1]; } }
      cycles.push(cy); });
    if(!cycles.length) return cur;
    const whole=(S: Uint8Array)=>{ let n=0; for(let k=0;k<S.length;k++) n+=S[k]; if(!n) return false; const seen=new Set([root]), st=[root]; let got=0; const hit=new Uint8Array(S.length);
      while(st.length){ const u=st.pop()!; for(const [c,v] of CA.get(u)||[]){ if(!S[c]) continue; if(!hit[c]){ hit[c]=1; got++; } if(!seen.has(v)){ seen.add(v); st.push(v); } } } return got===n; };
    const rng=mulberry32(4271), N=40000, T0=3000;
    let S=inS.slice(), best=inS.slice(), bestLen=curLen, len=curLen;
    for(let it=0; it<N; it++){
      const T=T0*(1-it/N)+1, nx=S.slice(); let L=len;
      for(let j=rng()<0.7?1:2; j>0; j--) for(const c of cycles[Math.floor(rng()*cycles.length)]){ L+=nx[c]?-chains[c].len:chains[c].len; nx[c]^=1; }
      if(L<len && Math.exp((L-len)/T)<rng()) continue;
      if(!whole(nx)) continue;
      S=nx; len=L; if(len>bestLen+1e-6){ bestLen=len; best=S.slice(); }
    }
    if(bestLen<=curLen+1e-6) return cur;
    const out: number[]=[]; best.forEach((x,k)=>{ if(x) out.push(...chains[k].es); }); return out;
  }
  // grow an even, connected edge set: swap a shorter in-set path for a longer unused path between the same points
  function grow(cur: number[], all: number[], start: number): number[] {
    const rng=mulberry32(9173); const S=new Set(cur); const allSet=new Set(all);
    const A=sp(all);
    const inS=()=>{ const s=new Set<number>(); for(const i of S){ s.add(G.edges[i].a); s.add(G.edges[i].b); } return s; };
    const connected=(set: Set<number>)=>{ const Aa=sp([...set]); if(!Aa.has(start)) return false; const seen=new Set([start]), q=[start], es=new Set<number>();
      while(q.length){ const u=q.pop()!; for(const [i,v] of Aa.get(u)!){ es.add(i); if(!seen.has(v)){ seen.add(v); q.push(v); } } } return es.size===set.size; };
    for(let tries=0; tries<1500; tries++){
      const nodes=[...inS()]; const u=nodes[Math.floor(rng()*nodes.length)];
      // random simple path over unused edges from u until it hits the loop again
      const path: number[]=[]; const vis=new Set([u]); let v=u, len=0, end: number | null=null;
      for(let k=0;k<40;k++){
        const opts=(A.get(v)||[]).filter(([i,w])=>!S.has(i) && !path.includes(i) && (!vis.has(w) || (w===u && path.length>=2)));
        if(!opts.length) break;
        const [i,w]=opts[Math.floor(rng()*opts.length)]; path.push(i); len+=G.edges[i].len; v=w;
        if(w===u || nodes.includes(w)){ end=w; break; } vis.add(w);
      }
      if(end===null || !path.length) continue;
      const Q: number[]=[]; let qlen=0;
      if(end!==u){ const sub=sp([...S]); const {d,prev}=dijkstra(sub,u); if(!d.has(end)) continue; let x: number=end; while(x!==u){ const [i,y]=prev.get(x)!; Q.push(i); x=y; } qlen=d.get(end)!; }
      if(len <= qlen + 1) continue;
      const nxt=new Set(S); for(const i of Q) nxt.delete(i); for(const i of path) nxt.add(i);
      if(Q.length && !connected(nxt)) continue;
      S.clear(); for(const i of nxt) S.add(i);
    }
    return [...S];
  }
}
export function solve(p: SolveParams): RawRoute[] {
  p.hAll = homeDist(p.start, p.maxg);
  p.hLate = p.late>0 ? homeDist(p.start, Math.min(p.maxg,p.late)) : p.hAll;
  for(let i=0;i<p.hLate.length;i++) if(!isFinite(p.hLate[i])) p.hLate[i]=p.hAll[i];
  const rng = mulberry32(p.seed);
  const laps = p.lap>0 ? Math.max(1, Math.round(p.D/1000/p.lap)) : 1;
  const lapD = p.D/laps, lapE = p.E/laps;
  interface Cand { steps: Turn[]; bounds?: number[]; c: number; s?: RouteStats; set?: Set<number> }
  const pool: Cand[]=[];
  const FULL = laps>1 ? 14 : 1, PER = laps>1 ? Math.round(2400/laps/14) : 2600;
  for(let f=0; f<FULL; f++){
    const used=new Map<number, number>(); let all: Turn[]=[]; const bounds: number[]=[]; let ok=true;
    for(let L=0; L<laps; L++){
      let best: Turn[] | null=null, bestC=Infinity;
      for(let k=0;k<PER;k++){
        const w: Weights={climb:0.6+rng()*2.4, rep:1+rng()*3, uturn:4+rng()*4, paved:1+rng()*2, noise:0.5+rng()*2.5};
        const steps=walk(p, lapD, lapE, used, rng, w, L*lapD); if(!steps||!steps.length) continue;
        const s=stats(steps); const reuse=steps.reduce((a,t)=>a+((used.get(t.e)||0)>0?G.edges[t.e].len:0),0);
        const c=cost({...s,rep:s.rep+reuse},{...p,D:lapD,E:lapE});
        if(laps===1) pool.push({steps,c});
        if(c<bestC){bestC=c;best=steps;}
      }
      if(!best){ ok=false; break; }
      if(laps>1){ bounds.push(all.length); all=all.concat(best); for(const t of best) used.set(t.e,(used.get(t.e)||0)+1); }
    }
    if(laps>1 && ok) pool.push({steps:all, bounds, c:0});
  }
  for(const r of pool){ r.s=stats(r.steps); r.c=cost(r.s,p); r.set=new Set(r.steps.map(t=>t.e)); }
  pool.sort((a,b)=>a.c-b.c);
  const picks: Cand[]=[];
  for(const r of pool){
    if(picks.length>=3) break;
    if(picks.every(q=>{ let inter=0; for(const e of r.set!) if(q.set!.has(e)) inter++; return inter/(r.set!.size+q.set!.size-inter) < 0.75; })) picks.push(r);
  }
  return picks.map(r=>({steps:r.steps.map((t): Step=>[t.e,t.dir]), bounds:r.bounds||[0], s:r.s!, laps}));
}
