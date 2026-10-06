import json, math, pickle
from collections import defaultdict, Counter
exec(open('roads_build.py').read().split('# Drummond')[0])   # rebuild graph helpers (ways, G, nid, P...)
T=pickle.load(open('roads_tmp.pkl','rb'))
# rebuild the same node ids: roads_build is deterministic, so NEWN indices match
assert len(NEWN)==len(T['NEWN'])
known=set()
for s in D['segs']+D['extras']:
    for a,b in zip(s['p'],s['p'][1:]): known.add((min(a,b),max(a,b)))
for s in E['segs']:
    for a,b in zip(s['path'],s['path'][1:]): known.add((min(a,b),max(a,b)))
edgeinfo={}
for w in ways:
    for a,b in zip(w['ns'],w['ns'][1:]):
        k=(min(a,b),max(a,b))
        if k not in edgeinfo: edgeinfo[k]=w['t']
DE=set()
for ns in T['dw']:
    for a,b in zip(ns,ns[1:]):
        k=(min(a,b),max(a,b))
        if k not in known: DE.add(k)
CE=set()
for seq in [p for p,_ in T['links']]+[r['p'] for r in T['roads']]:
    for a,b in zip(seq,seq[1:]):
        k=(min(a,b),max(a,b))
        if k not in known and k not in DE: CE.add(k)
print('DW edges',len(DE),'connector edges',len(CE))
typ={k:'trail' for k in DE}; typ.update({k:'conn' for k in CE})
adj=defaultdict(list)
for k in typ: adj[k[0]].append(k); adj[k[1]].append(k)
anchors=set(n for s in E['segs'] for n in s['path'])|set(n for e in D['extras'] for n in e['p'])
def nm(k): return edgeinfo.get(k,{}).get('name','')
def stop(n):
    if n in anchors or len(adj[n])!=2: return True
    a,b=adj[n]; return typ[a]!=typ[b] or nm(a)!=nm(b)
used=set(); chains=[]
for k0 in typ:
    if k0 in used: continue
    used.add(k0); path=[k0[0],k0[1]]
    for side in (1,-1):
        while True:
            end=path[-1] if side==1 else path[0]
            if stop(end): break
            nx=[k for k in adj[end] if k not in used]
            if not nx: break
            k=nx[0]; used.add(k); o=k[1] if k[0]==end else k[0]
            if side==1: path.append(o)
            else: path.insert(0,o)
    chains.append({'p':path,'t':typ[k0]})
def plen(p): return sum(dist(a,b) for a,b in zip(p,p[1:]))
chains=[c for c in chains if plen(c['p'])>5]
print('chains',Counter(c['t'] for c in chains), 'km', {t:round(sum(plen(c['p']) for c in chains if c['t']==t)/1000,2) for t in ('trail','conn')})
# elevation
ele={i:N[i][2] for i in range(len(N))}
for _ in range(6):
    for c in chains:
        p=c['p']; cum=[0]
        for a,b in zip(p,p[1:]): cum.append(cum[-1]+dist(a,b))
        ks=[j for j,n in enumerate(p) if ele.get(n) is not None]
        if not ks: continue
        for j,n in enumerate(p):
            if ele.get(n) is not None: continue
            lo=max([x for x in ks if x<j],default=None); hi=min([x for x in ks if x>j],default=None)
            if lo is None or hi is None: continue
            f=(cum[j]-cum[lo])/(cum[hi]-cum[lo]) if cum[hi]>cum[lo] else 0; ele[n]=ele[p[lo]]+(ele[p[hi]]-ele[p[lo]])*f
    for c in chains:
        p=c['p']; ks=[j for j,n in enumerate(p) if ele.get(n) is not None]
        if ks:
            for j,n in enumerate(p):
                if ele.get(n) is None: ele[n]=ele[p[min(ks,key=lambda x:abs(x-j))]]
missing=[n for c in chains for n in c['p'] if ele.get(n) is None]
netpts=[(P(i),i) for i in anchors]
for n in missing:
    q=P(n); ele[n]=N[min(netpts,key=lambda t:math.dist(t[0],q))[1]][2]
# append
newids=sorted(set(n for c in chains for n in c['p'] if n>=len(N))); remap={n:len(N)+i for i,n in enumerate(newids)}
L0=len(N)
newrows=[[NEWN[n-L0][0],NEWN[n-L0][1],round(ele[n],1)] for n in newids]
D['nodes'].extend(newrows)
PAVED={'asphalt','concrete','paved','paving_stones','concrete:plates','sett'}
added=0
for c in chains:
    ks=[(min(a,b),max(a,b)) for a,b in zip(c['p'],c['p'][1:])]
    names=Counter(); hws=Counter(); surf=Counter(); tot=0
    for k in ks:
        l=dist(*k); tot+=l; t=edgeinfo.get(k,{})
        if t.get('name'): names[t['name']]+=l
        hws[t.get('highway','')+('/'+t['footway'] if t.get('footway') else '')]+=l
        if t.get('surface'): surf[t['surface']]+=l
    o={'cov':0,'highway':hws.most_common(1)[0][0].split('/')[0]}
    if names: o['name']=names.most_common(1)[0][0]
    if surf: o['surface']=surf.most_common(1)[0][0]
    if c['t']=='conn':
        o['conn']=1; o['paved']=1
        o['via']=', '.join(sorted(set(h.replace('footway/sidewalk','sidewalk').replace('footway/crossing','crosswalk') for h in hws)))
    else:
        o['paved']=1 if surf and surf.most_common(1)[0][0] in PAVED else 0
    D['extras'].append({'p':[remap.get(n,n) for n in c['p']],'osm':o,'new':1}); added+=1
# ref: add roads for map context
for w in RD:
    g=[p for p in (w.get('geometry') or []) if p]
    if len(g)>=2: D['ref'].append({'c':[[round(p['lon'],6),round(p['lat'],6)] for p in g],'k':'road','n':'','m':0,'hw':w['tags'].get('highway')})
print('added extras',added,'total extras',len(D['extras']),'nodes',len(D['nodes']))
json.dump(D,open('data7.json','w'),separators=(',',':'))
import os; print('KB',os.path.getsize('data7.json')//1024)
