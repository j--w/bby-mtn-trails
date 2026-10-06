#!/usr/bin/env python3
"""Build the route builder's area data file from the editor's curated export.

    python3 scripts/build_router_data.py            # Burnaby Mountain defaults

Inputs
  --editor   site/data/<area>-editor.json   editor base data: all nodes, OSM network, extras (append-only!)
  --curated  data/<area>/curated.json        the editor's Export JSON (the user's vetted network in `_editor`)
Output
  --out      site/data/<area>.json           compact graph the route builder loads

Steps: keep the user's segments, join dead ends that nearly touch (< 8 m), fill dead ends with short
unadded OSM pieces (<= 30 m), connect islands through short extras, split at shared nodes, keep the
component that holds the trailheads, then write nodes/segments/trailheads/reference lines.
"""
import argparse, datetime, json, math, heapq, os
from collections import defaultdict
ap=argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('--area', default='burnaby-mountain')
ap.add_argument('--editor'); ap.add_argument('--curated'); ap.add_argument('--out')
ap.add_argument('--version', default=datetime.date.today().isoformat())
args=ap.parse_args()
args.editor=args.editor or f'site/data/{args.area}-editor.json'
args.curated=args.curated or f'data/{args.area}/curated.json'
args.out=args.out or f'site/data/{args.area}.json'
E=json.load(open(args.curated)); S=E['_editor']; D=json.load(open(args.editor)); N=D['nodes']
segs=[dict(s) for s in S['segs']]; lat0=math.radians(N[0][0]); xy=lambda n:(N[n][1]*math.pi/180*6371000*math.cos(lat0), N[n][0]*math.pi/180*6371000)
L=lambda p: sum(math.dist(xy(a),xy(b)) for a,b in zip(p,p[1:]))
th=[int(k) for k,v in S['nodes'].items() if v['type']=='trailhead']
added=set(S.get('added',[]))
def components(segs):
    adj=defaultdict(set)
    for i,s in enumerate(segs): adj[s['path'][0]].add(i); adj[s['path'][-1]].add(i)
    comp={}; c=0
    for i in range(len(segs)):
        if i in comp: continue
        st=[i]
        while st:
            j=st.pop()
            if j in comp: continue
            comp[j]=c
            for n in (segs[j]['path'][0],segs[j]['path'][-1]): st.extend(adj[n])
        c+=1
    return comp, adj
# split segments at interior nodes that are another segment's endpoint
def splitall(segs):
    changed=True
    while changed:
        changed=False; ends=set(n for s in segs for n in (s['path'][0],s['path'][-1]))
        for s in segs:
            for k in range(1,len(s['path'])-1):
                if s['path'][k] in ends:
                    t=dict(s); t['path']=s['path'][k:]; t['id']=s['id']+'b'; s['path']=s['path'][:k+1]; segs.append(t); changed=True; break
            if changed: break
    return segs

# join dead ends that sit within a few metres of another segment (OSM ways that nearly touch)
def snap_dead_ends(segs, tol=8):
    joins=[]
    for _ in range(3):
        deg=defaultdict(int)
        for s in segs: deg[s['path'][0]]+=1; deg[s['path'][-1]]+=1
        made=False
        for s in list(segs):
            for end in (s['path'][0], s['path'][-1]):
                if deg[end]!=1 or end in th: continue
                best=None
                for t2 in segs:
                    if t2 is s: continue
                    for n in t2['path']:
                        d=math.dist(xy(end),xy(n))
                        if d<tol and (best is None or d<best[0]): best=(d,n,t2)
                if best:
                    segs.append({'id':'snap%d'%len(joins),'path':[end,best[1]],'name':'','kind':'connector','grade':None,'gradeDown':None,'oneway':'no'})
                    joins.append((N[end][:2],round(best[0],1))); deg[end]+=1; deg[best[1]]+=1; made=True
        if not made: break
    return joins
snaps=snap_dead_ends(segs)
# close dead ends with a short unadded extra (<=30 m) that leads to another part of the network
def close_with_extras(segs, maxlen=30):
    out=[]; addedset=set(S.get('added',[]))
    for _ in range(3):
        deg=defaultdict(int); netn=set()
        for s in segs:
            deg[s['path'][0]]+=1; deg[s['path'][-1]]+=1; netn.update(s['path'])
        made=False
        for i,e in enumerate(D['extras']):
            if i in addedset or L(e['p'])>maxlen: continue
            a,b=e['p'][0],e['p'][-1]
            if (deg.get(a)==1 and b in netn) or (deg.get(b)==1 and a in netn):
                o=e['osm']; segs.append({'id':'x'+str(i),'path':e['p'][:],'name':o.get('name',''),'kind':'connector' if o.get('conn') or o.get('paved',0)>=0.6 else 'trail','grade':o.get('imba'),'gradeDown':None,'oneway':'no'})
                addedset.add(i); out.append((o.get('name') or o.get('via'),round(L(e['p'])))); made=True
        if not made: break
    return out
print('closed dead ends with short pieces', close_with_extras(segs))
print('snapped dead ends',snaps)
auto=[]
for rnd in range(10):
    segs=splitall(segs) if 'splitall' in globals() else segs
    comp,adj=components(segs)
    main=comp[next(iter(adj[th[0]]))]
    mainnodes=set(n for j,s in enumerate(segs) if comp[j]==main for n in s['path'])
    islands=sorted(set(v for v in comp.values() if v!=main))
    if not islands: break
    G=defaultdict(list)
    for j,s in enumerate(segs):
        for a,b in zip(s['path'],s['path'][1:]): d=math.dist(xy(a),xy(b)); G[a].append((b,d,None)); G[b].append((a,d,None))
    for i,e in enumerate(D['extras']):
        if i in added: continue
        for a,b in zip(e['p'],e['p'][1:]): d=math.dist(xy(a),xy(b)); G[a].append((b,d,i)); G[b].append((a,d,i))
    progress=False
    for c in islands:
        src=set(n for j,s in enumerate(segs) if comp[j]==c for n in s['path'])
        pq=[(0,0,n) for n in src]; prev={n:None for n in src}; done=set(); hit=None
        while pq:
            cost,d,u=heapq.heappop(pq)
            if u in done: continue
            done.add(u)
            if u in mainnodes: hit=u; break
            for v,dd,tag in G[u]:
                if v in done: continue
                ec = dd*(1 if tag is None else 3)
                if v not in prev or True:
                    heapq.heappush(pq,(cost+ec,d+dd,v)); 
                    if v not in prev: prev[v]=(u,tag)
        if hit is None: continue
        need=[]; u=hit
        while prev[u]: pu,tag=prev[u]; (tag is not None and tag not in need and need.append(tag)); u=pu
        extlen=sum(L(D['extras'][i]['p']) for i in need)
        if extlen<=80 and need:
            for i in need:
                e=D['extras'][i]; o=e['osm']
                segs.append({'id':'x'+str(i),'path':e['p'][:],'name':o.get('name',''),'kind':'connector' if o.get('paved',0)>=0.6 or o.get('conn') else 'trail','grade':o.get('imba'),'gradeDown':None,'oneway':'no'})
                added.add(i); auto.append((i,o.get('name') or o.get('via'),round(L(e['p']))))
            progress=True; break
    if not progress: break
segs=splitall(segs)
comp,adj=components(segs); main=comp[next(iter(adj[th[0]]))]
keep=[s for j,s in enumerate(segs) if comp[j]==main]; drop=[s for j,s in enumerate(segs) if comp[j]!=main]
print('auto-added',auto)
print('kept',len(keep),round(sum(L(s['path']) for s in keep)/1000,2),'km; dropped',len(drop),round(sum(L(s['path']) for s in drop)),'m',[s['name'] or '-' for s in drop])
# router data
used=sorted(set(n for s in keep for n in s['path'])); m={k:i for i,k in enumerate(used)}
out_segs=[{'p':[m[x] for x in s['path']],'n':s['name'] or '','k':s['kind'],'g':s['grade'],'gd':s.get('gradeDown'),'o':s.get('oneway','no')} for s in keep]
ths=[{'node':m[t],'name':S['nodes'][str(t)]['name']} for t in sorted(th,key=lambda t:N[t][2])]
nodes=[[round(N[k][0],6),round(N[k][1],6),round(N[k][2],1)] for k in used]
lats=[n[0] for n in nodes]; lons=[n[1] for n in nodes]; pad=0.004
bb=(min(lats)-pad,max(lats)+pad,min(lons)-pad*1.5,max(lons)+pad*1.5)
ref=[]
for w in D['ref']:
    if any(bb[2]<=x<=bb[3] and bb[0]<=y<=bb[1] for x,y in w['c']): ref.append({'c':[[round(x,5),round(y,5)] for x,y in w['c']],'k':w['k']})
json.dump({'nodes':nodes,'segs':out_segs,'th':ths,'ref':ref,'version':args.version},open(args.out,'w'),separators=(',',':'))
print('wrote',args.out,os.path.getsize(args.out)//1024,'KB,',len(out_segs),'segments')
