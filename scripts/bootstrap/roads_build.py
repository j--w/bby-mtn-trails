import json, math, heapq
from collections import defaultdict, Counter
D=json.load(open('data6.json')); N=D['nodes']
O=json.load(open('osm2.json'))['elements']; RD=json.load(open('roads.json'))['elements']
E=json.load(open('export_user.json'))['_editor']
R=6371000; lat0=math.radians(N[0][0])
key=lambda la,lo:(round(la,7),round(lo,7))
def xy(la,lo): return (lo*math.pi/180*R*math.cos(lat0), la*math.pi/180*R)
idx={key(n[0],n[1]):i for i,n in enumerate(N)}
# the user's current network (from their export) + extras
netn=set(n for s in E['segs'] for n in s['path'])
extn=set(n for e in D['extras'] for n in e['p'])
NEWN=[]
def nid(k):
    if k not in idx: idx[k]=len(N)+len(NEWN); NEWN.append([k[0],k[1],None])
    return idx[k]
ALL=lambda i: N[i] if i<len(N) else NEWN[i-len(N)]
def P(i): a=ALL(i); return xy(a[0],a[1])
def dist(a,b): return math.dist(P(a),P(b))
# full graph of every way (trails file + roads file)
ways=[]
for src,lst in (('t',O),('r',RD)):
    for w in lst:
        g=[p for p in (w.get('geometry') or []) if p]
        if len(g)<2: continue
        t=w.get('tags',{})
        if t.get('access') in ('private','no') or t.get('foot')=='no': continue
        ways.append({'t':t,'ns':[nid(key(p['lat'],p['lon'])) for p in g],'src':src})
COST={'footway':1.0,'path':1.0,'cycleway':1.05,'steps':1.3,'service':1.15,'residential':1.25,'living_street':1.2,'unclassified':1.3,'tertiary':1.6,'track':1.0,'secondary':3,'primary':4}
G=defaultdict(list)
for wi,w in enumerate(ways):
    c=COST.get(w['t'].get('highway'),2)
    for a,b in zip(w['ns'],w['ns'][1:]):
        d=dist(a,b); G[a].append((b,d*c,d,wi)); G[b].append((a,d*c,d,wi))
# Drummond's Walk trail ways
dw=[w for w in ways if 'rummond' in w['t'].get('name','') and w['src']=='t']
dwnodes=set(n for w in dw for n in w['ns'])
def shortest(srcs, targets, maxd=2500):
    pq=[(0,0,s) for s in srcs]; prev={s:None for s in srcs}; seen=set()
    while pq:
        c,d,u=heapq.heappop(pq)
        if u in seen: continue
        seen.add(u)
        if u in targets and u not in srcs: 
            path=[u]
            while prev[path[-1]] is not None: path.append(prev[path[-1]][0])
            return path[::-1], d
        if d>maxd: continue
        for v,cc,dd,wi in G[u]:
            if v not in seen and (v not in prev or True):
                if v not in prev or prev[v] is None and v not in srcs: prev[v]=(u,wi)
                elif v not in seen: prev[v]=prev.get(v) or (u,wi)
                heapq.heappush(pq,(c+cc,d+dd,v))
    return None, None
# proper dijkstra with prev tracking
def dijk(srcs, targets, maxd=2500, avoid=set()):
    best={s:0 for s in srcs}; prev={}; pq=[(0,0,s) for s in srcs]; done=set()
    while pq:
        c,d,u=heapq.heappop(pq)
        if u in done: continue
        done.add(u)
        if u in targets:
            path=[u]
            while path[-1] in prev: path.append(prev[path[-1]])
            return path[::-1], d
        if d>maxd: continue
        for v,cc,dd,wi in G[u]:
            if v in avoid: continue
            if c+cc < best.get(v,1e18): best[v]=c+cc; prev[v]=u; heapq.heappush(pq,(c+cc,d+dd,v))
    return None,None
anchors=netn
# DW components (by DW ways only)
comp=defaultdict(set); par={}
def find(x):
    while par.setdefault(x,x)!=x: par[x]=par[par[x]]; x=par[x]
    return x
for w in dw:
    for a,b in zip(w['ns'],w['ns'][1:]): par[find(a)]=find(b)
for n in dwnodes: comp[find(n)].add(n)
print('DW components',len(comp),[len(c) for c in comp.values()])
links=[]
for c in comp.values():
    # connect from both geographic ends of the component
    pts=sorted(c,key=lambda n:P(n)[0])
    for ends in (pts[:3], pts[-3:]):
        path,d=dijk(ends, anchors, avoid=set())
        if path: links.append((path,d))
print('links',[round(d) for _,d in links])
# summit roads: road pieces in top zone linking anchors
hub=[int(k) for k,v in E['nodes'].items() if v['type']=='hub']
topn=[n for n in netn if N[n][2]>=250]
print('top network nodes',len(topn))
roadways=[w for w in ways if w['src']=='r' and w['t'].get('highway') in ('residential','unclassified','tertiary','living_street')]
use=Counter(); endp=set()
for w in ways:
    for n in set(w['ns']): use[n]+=1
    endp.add(w['ns'][0]); endp.add(w['ns'][-1])
anch_all=netn|extn|dwnodes
pieces=[]
for w in roadways:
    cur=[w['ns'][0]]
    for n in w['ns'][1:]:
        cur.append(n)
        if n in anch_all or use[n]>=2 or n in endp: pieces.append({'p':cur,'w':w}); cur=[n]
# contract road pieces into chains stopping at anchors
adj=defaultdict(list)
for i,pc in enumerate(pieces): adj[pc['p'][0]].append(i); adj[pc['p'][-1]].append(i)
def stop(n): return n in anch_all or len(adj[n])!=2
usedp=set(); chains=[]
for i in range(len(pieces)):
    if i in usedp: continue
    ch=[(i,1)]; usedp.add(i)
    for direction in (1,-1):
        while True:
            ci,cd=ch[-1] if direction==1 else ch[0]; cp=pieces[ci]['p']
            endn=(cp[-1] if cd==1 else cp[0]) if direction==1 else (cp[0] if cd==1 else cp[-1])
            if stop(endn): break
            nx=[j for j in adj[endn] if j not in usedp]
            if not nx: break
            j=nx[0]; usedp.add(j); jp=pieces[j]['p']
            if direction==1: ch.append((j,1 if jp[0]==endn else -1))
            else: ch.insert(0,(j,1 if jp[-1]==endn else -1))
    path=[]; names=Counter()
    for ci,cd in ch:
        p=pieces[ci]['p'] if cd==1 else pieces[ci]['p'][::-1]; path=p[:] if not path else path+p[1:]
        names[pieces[ci]['w']['t'].get('name','')]+=1
    chains.append({'p':path,'name':names.most_common(1)[0][0],'hw':pieces[ch[0][0]]['w']['t'].get('highway')})
def plen(p): return sum(dist(a,b) for a,b in zip(p,p[1:]))
topxy=[P(n) for n in topn]
def neartop(n): q=P(n); return min(math.dist(q,t) for t in topxy)<60
summit=[c for c in chains if c['p'][0] in netn and c['p'][-1] in netn and c['p'][0]!=c['p'][-1]
        and plen(c['p'])<1500 and sum(1 for n in c['p'] if neartop(n))>=0.5*len(c['p'])]
print('summit road links',len(summit),round(sum(plen(c['p']) for c in summit)),Counter(c['name'] for c in summit))
pickle_out={'links':links,'summit':summit,'dw':[w['ns'] for w in dw],'NEWN':NEWN,'nlen':len(N)}
import pickle; pickle.dump(pickle_out,open('roads_tmp.pkl','wb'))
for path,d in links:
    hw=Counter()
    for a,b in zip(path,path[1:]):
        for v,cc,dd,wi in G[a]:
            if v==b: hw[ways[wi]['t'].get('highway')+':'+(ways[wi]['t'].get('name') or ways[wi]['t'].get('footway') or '')]+=dd; break
    print(round(d), [(k,round(v)) for k,v in hw.most_common(5)])
tz=[c for c in chains if sum(1 for n in c['p'] if neartop(n))>=0.5*len(c['p'])]
print('top-zone road chains',len(tz), Counter((c['p'][0] in netn)+(c['p'][-1] in netn) for c in tz))
print(Counter(c['name'] for c in tz).most_common(20))
hubn=hub[0]; hp=P(hubn)
area=[c for c in chains if sum(1 for n in c['p'] if math.dist(P(n),hp)<900)>=0.5*len(c['p']) and plen(c['p'])>40]
print('roads within 900 m of summit hub',len(area),Counter(c['name'] for c in area).most_common(20))
def attach(n):
    if n in netn: return []
    path,d=dijk([n], netn, maxd=150)
    return path if path else None
sumlinks=[]
for c in area:
    a=attach(c['p'][0]); b=attach(c['p'][-1])
    if a is None or b is None: continue
    full=(a[::-1] if a else [])  # from network to chain start
    p=c['p']
    seq=(a[::-1][:-1] if a else [])+p+(b[1:] if b else [])
    sumlinks.append({'p':seq,'name':c['name'],'hw':c['hw']})
print('summit road options',len(sumlinks),round(sum(plen(s['p']) for s in sumlinks)),Counter(s['name'] for s in sumlinks))
pickle.dump({'links':links,'summit':sumlinks,'dw':[w['ns'] for w in dw],'NEWN':NEWN,'nlen':len(N)},open('roads_tmp.pkl','wb'))
allopts=[]; seen=set()
for c in chains:
    if plen(c['p'])<30 or plen(c['p'])>1500: continue
    a=attach(c['p'][0]); b=attach(c['p'][-1])
    if a is None or b is None: continue
    seq=(a[::-1][:-1] if a else [])+c['p']+(b[1:] if b else [])
    if seq[0]==seq[-1]: continue
    k=(min(seq[0],seq[-1]),max(seq[0],seq[-1]),round(plen(seq)))
    if k in seen: continue
    seen.add(k); allopts.append({'p':seq,'name':c['name'],'hw':c['hw']})
print('road link options anywhere',len(allopts),round(sum(plen(s['p']) for s in allopts)), Counter(s['name'] for s in allopts).most_common(30))
mx=[(s['name'],round(max(N[n][2] for n in s['p'] if n<len(N) and n in netn) if any(n in netn for n in s['p']) else 0)) for s in allopts]
print(sorted(mx,key=lambda x:-x[1])[:30])
pickle.dump({'links':links,'roads':allopts,'dw':[w['ns'] for w in dw],'NEWN':NEWN,'nlen':len(N)},open('roads_tmp.pkl','wb'))
