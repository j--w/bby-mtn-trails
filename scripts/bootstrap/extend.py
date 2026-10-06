import json, math
from collections import defaultdict, Counter
D=json.load(open('data5.json')); N=D['nodes']; O=json.load(open('osm2.json'))['elements']
R=6371000; lat0=math.radians(N[0][0])
key=lambda lat,lon:(round(lat,7),round(lon,7))
existing={key(n[0],n[1]):i for i,n in enumerate(N)}
netnodes=set(n for s in D['segs'] for n in s['p'])
extnodes=set(n for e in D['extras'] for n in e['p'])
known_pairs=set()
for s in D['segs']+D['extras']:
    for a,b in zip(s['p'],s['p'][1:]): known_pairs.add((min(a,b),max(a,b)))
TRAIL={'path','track','bridleway','steps','cycleway'}
ways=[]
for w in O:
    g=[p for p in (w.get('geometry') or []) if p]
    if len(g)<2: continue
    t=w.get('tags',{})
    if t.get('access') in ('private','no') or t.get('foot')=='no': continue
    hw=t.get('highway'); sidewalk = hw=='footway' and t.get('footway') in ('sidewalk','crossing')
    if not (hw in TRAIL or (hw=='footway' and not sidewalk)): continue
    ways.append({'id':w['id'],'tags':t,'g':g})
# topology
use=Counter(); endp=set()
for w in ways:
    ks=[key(p['lat'],p['lon']) for p in w['g']]
    for k in set(ks): use[k]+=1
    endp.add(ks[0]); endp.add(ks[-1])
NEW=[]; nid=dict(existing)
def node(k,p):
    if k not in nid: nid[k]=len(N)+len(NEW); NEW.append([round(p['lat'],7),round(p['lon'],7),None])
    return nid[k]
def isj(k): return use[k]>=2 or k in endp or (k in existing and (existing[k] in netnodes or existing[k] in extnodes))
pieces=[]
for wi,w in enumerate(ways):
    ks=[key(p['lat'],p['lon']) for p in w['g']]; ns=[node(k,p) for k,p in zip(ks,w['g'])]
    cur=[ns[0]]
    for j in range(1,len(ns)):
        cur.append(ns[j])
        if isj(ks[j]) or j==len(ns)-1: pieces.append({'p':cur,'w':wi}); cur=[ns[j]]
ALL=N+NEW
def known(pc): return all((min(a,b),max(a,b)) in known_pairs for a,b in zip(pc['p'],pc['p'][1:]))
newp=[pc for pc in pieces if not known(pc)]
print('pieces',len(pieces),'new',len(newp))
# contract new pieces; stop at existing network/extra nodes and degree!=2
adj=defaultdict(list)
for i,pc in enumerate(newp): adj[pc['p'][0]].append(i); adj[pc['p'][-1]].append(i)
anchor=netnodes|extnodes
def stop(n): return n in anchor or len(adj[n])!=2 or adj[n][0]==adj[n][1]
used=set(); chains=[]
for i,pc in enumerate(newp):
    if i in used: continue
    chain=[(i,1)]; used.add(i)
    for direction in (1,-1):
        while True:
            ci,cd=chain[-1] if direction==1 else chain[0]; cp=newp[ci]['p']
            endn=(cp[-1] if cd==1 else cp[0]) if direction==1 else (cp[0] if cd==1 else cp[-1])
            if stop(endn): break
            nx=[j for j in adj[endn] if j not in used]
            if not nx: break
            j=nx[0]; used.add(j); jp=newp[j]['p']
            if direction==1: chain.append((j,1 if jp[0]==endn else -1))
            else: chain.insert(0,(j,1 if jp[-1]==endn else -1))
    path=[]; mem=[]
    for ci,cd in chain:
        p=newp[ci]['p'] if cd==1 else newp[ci]['p'][::-1]
        path=p[:] if not path else path+p[1:]; mem.append(ci)
    chains.append({'p':path,'m':mem})
# keep chains connected (through new chains) to anchors
cadj=defaultdict(set)
for i,c in enumerate(chains): cadj[c['p'][0]].add(i); cadj[c['p'][-1]].add(i)
reach=set(); st=[i for i,c in enumerate(chains) if c['p'][0] in anchor or c['p'][-1] in anchor]
while st:
    i=st.pop()
    if i in reach: continue
    reach.add(i)
    for n in (chains[i]['p'][0],chains[i]['p'][-1]):
        if n not in anchor: st.extend(cadj[n]-reach)
xy=lambda n:(ALL[n][1]*math.pi/180*R*math.cos(lat0), ALL[n][0]*math.pi/180*R)
def L(p): return sum(math.dist(xy(a),xy(b)) for a,b in zip(p,p[1:]))
chains=[c for i,c in enumerate(chains) if i in reach and L(c['p'])>15]
print('new extras',len(chains),'km',round(sum(L(c['p']) for c in chains)/1000,2))
# elevation: interpolate along chain from known nodes; unknown chains take nearest known node
knownE={i:n[2] for i,n in enumerate(N)}
kn_xy=[(xy(i),i) for i in netnodes]
for _ in range(3):
    for c in chains:
        p=c['p']; cum=[0]
        for a,b in zip(p,p[1:]): cum.append(cum[-1]+math.dist(xy(a),xy(b)))
        ks=[k for k,n in enumerate(p) if n in knownE]
        if not ks: continue
        for k,n in enumerate(p):
            if n in knownE: continue
            lo=max([j for j in ks if j<k],default=None); hi=min([j for j in ks if j>k],default=None)
            if lo is None: knownE[n]=knownE[p[hi]]
            elif hi is None: knownE[n]=knownE[p[lo]]
            else: f=(cum[k]-cum[lo])/(cum[hi]-cum[lo]) if cum[hi]>cum[lo] else 0; knownE[n]=knownE[p[lo]]+(knownE[p[hi]]-knownE[p[lo]])*f
for c in chains:
    for n in c['p']:
        if n not in knownE:
            q=xy(n); knownE[n]=min(kn_xy,key=lambda t:math.dist(t[0],q))[1]; knownE[n]=N[knownE[n]][2] if isinstance(knownE[n],int) and knownE[n]<len(N) else knownE[n]
# tags
IMBA={'0':1,'1':1,'2':2,'3':3,'4':4}; PAVED={'asphalt','concrete','paved','paving_stones','concrete:plates','sett'}
def tagsum(c):
    acc=defaultdict(Counter); tot=0
    for mi in c['m']:
        pc=newp[mi]; l=L(pc['p']); tot+=l; t=ways[pc['w']]['tags']
        for k in ('name','surface','sac_scale','highway','oneway','informal'):
            if t.get(k): acc[k][t[k]]+=l
        if t.get('mtb:scale:imba') in IMBA: acc['imba'][IMBA[t['mtb:scale:imba']]]+=l
        if t.get('surface') in PAVED: acc['paved'][1]+=l
    o={}
    for k in ('name','surface','sac_scale','highway','oneway','informal'):
        if acc[k]: o[{'sac_scale':'sac'}.get(k,k)]=acc[k].most_common(1)[0][0]
    if acc['imba']: o['imba']=acc['imba'].most_common(1)[0][0]; o['imbaMax']=max(acc['imba'])
    o['paved']=round(acc['paved'][1]/tot,2) if tot else 0; o['cov']=0
    if o.get('informal')=='yes': o['informal']=True
    else: o.pop('informal',None)
    if o.get('oneway') not in ('yes','-1'): o.pop('oneway',None)
    return o
# only keep new nodes that are used
usedNew=sorted(set(n for c in chains for n in c['p'] if n>=len(N)))
remap={n:len(N)+i for i,n in enumerate(usedNew)}
for n in usedNew: NEW[n-len(N)][2]=round(knownE.get(n,0),1)
D['nodes']=N+[NEW[n-len(N)] for n in usedNew]
oldx=len(D['extras'])
for c in chains:
    D['extras'].append({'p':[remap.get(n,n) for n in c['p']],'osm':tagsum(c),'new':1})
# ref layer from new export
ref=[]
for w in O:
    g=[p for p in (w.get('geometry') or []) if p]
    if len(g)<2: continue
    hw=w.get('tags',{}).get('highway')
    ref.append({'c':[[round(p['lon'],6),round(p['lat'],6)] for p in g],'k':'trail' if hw in ('path','track','bridleway','steps') else 'paved','n':'','m':0,'hw':hw})
D['ref']=ref
west=[e for e in D['extras'][oldx:] if min(D['nodes'][n][1] for n in e['p'])< -122.965]
print('extras total',len(D['extras']),'new',len(D['extras'])-oldx,'reaching west of old edge',len(west), Counter(e['osm'].get('name','') for e in west).most_common(10))
json.dump(D,open('data6.json','w'),separators=(',',':'))
import os; print('KB',os.path.getsize('data6.json')//1024)
