import json, math, re, pickle
from collections import defaultdict, Counter
d=pickle.load(open('osm_build.pkl','rb')); ways=d['ways']; pieces=d['pieces']; NODES=d['NODES']; lat0=d['lat0']; R=6371000
txt=open('exhaustive.gpx').read()
G=[(float(a),float(b),float(e)) for a,b,e in re.findall(r'lat="([^"]+)" lon="([^"]+)">\s*<ele>([^<]+)',txt)]
def xy(lat,lon): return (lon*math.pi/180*R*math.cos(lat0), lat*math.pi/180*R)
GP=[xy(a,b) for a,b,_ in G]
NX=[xy(a,b) for a,b in NODES]
def addnode(lat,lon):
    NODES.append([lat,lon]); NX.append(xy(lat,lon)); return len(NODES)-1
C=20
def mkgrid(pts_pairs):
    g=defaultdict(list)
    for item,(A,B) in pts_pairs:
        for gx in range(int(min(A[0],B[0])//C)-1,int(max(A[0],B[0])//C)+2):
            for gy in range(int(min(A[1],B[1])//C)-1,int(max(A[1],B[1])//C)+2): g[(gx,gy)].append((item,A,B))
    return g
def nearest(g,px,py):
    best=(1e9,None,0)
    for item,A,B in g.get((int(px//C),int(py//C)),[]):
        dx,dy=B[0]-A[0],B[1]-A[1]; L=dx*dx+dy*dy; t=0 if L==0 else max(0,min(1,((px-A[0])*dx+(py-A[1])*dy)/L))
        dd=math.hypot(px-A[0]-t*dx,py-A[1]-t*dy)
        if dd<best[0]: best=(dd,item,t)
    return best
ggpx=mkgrid([(i,(GP[i],GP[i+1])) for i in range(len(GP)-1)])
inc=[pc for pc in pieces if pc['cov']>=0.6]; exc=[pc for pc in pieces if pc['cov']<0.6]
for pc in inc: pc['src']='osm'
# prune short dead-end stubs (side trails clipped where the GPX passes their mouth)
def plen_(p): return sum(math.hypot(NX[x][0]-NX[y][0],NX[x][1]-NX[y][1]) for x,y in zip(p,p[1:]))
g0=GP[0]
for _ in range(5):
    dg=Counter()
    for pc in inc: dg[pc['p'][0]]+=1; dg[pc['p'][-1]]+=1
    keep=[];moved=0
    for pc in inc:
        a_,b_=pc['p'][0],pc['p'][-1]
        dead = dg[a_]==1 or dg[b_]==1
        nearstart = min(math.hypot(NX[n][0]-g0[0],NX[n][1]-g0[1]) for n in (a_,b_))<30
        if dead and plen_(pc['p'])<25 and not nearstart: exc.append(pc); moved+=1
        else: keep.append(pc)
    inc=keep
    if not moved: break
print('stubs pruned to extras',sum(1 for pc in exc if pc['cov']>=0.6))
# --- GPX-only stretches -> segments
incnodes=set(n for pc in inc for n in pc['p'])
ginc=mkgrid([((pi,k),(NX[a],NX[b])) for pi,pc in enumerate(inc) for k,(a,b) in enumerate(zip(pc['p'],pc['p'][1:]))])
forced=set()
runs=[];cur=[]
for i in range(len(GP)-1):
    m=((GP[i][0]+GP[i+1][0])/2,(GP[i][1]+GP[i+1][1])/2)
    if nearest(ginc,*m)[0]>10:
        if cur and i!=cur[-1]+1: runs.append(cur);cur=[]
        cur.append(i)
if cur: runs.append(cur)
def nearest_inc_node(px,py,maxd=25):
    best=(1e9,None)
    for n in incnodes:
        dd=math.hypot(NX[n][0]-px,NX[n][1]-py)
        if dd<best[0]: best=(dd,n)
    return best[1] if best[0]<maxd else None
gpxsegs=0
for r in runs:
    idx=list(range(r[0],r[-1]+2)); L=sum(math.hypot(GP[i+1][0]-GP[i][0],GP[i+1][1]-GP[i][1]) for i in idx[:-1])
    if L<30: continue
    a=nearest_inc_node(*GP[idx[0]]); b=nearest_inc_node(*GP[idx[-1]])
    path=[a if a is not None else addnode(*G[idx[0]][:2])]
    for i in idx[1:-1]: path.append(addnode(*G[i][:2]))
    path.append(b if b is not None else addnode(*G[idx[-1]][:2]))
    for n in (path[0],path[-1]):
        if n in incnodes: forced.add(n)
    inc.append({'p':path,'w':None,'cov':1,'src':'gpx'}); gpxsegs+=1
print('gpx-only segments',gpxsegs)
# --- contract network
def contract(pcs, keepset):
    adj=defaultdict(list)
    for i,pc in enumerate(pcs): adj[pc['p'][0]].append(i); adj[pc['p'][-1]].append(i)
    def wname(pc): return ways[pc['w']]['tags'].get('name','') if pc['w'] is not None else '#gpx'
    def stop(n):
        if n in keepset or len(adj[n])!=2: return True
        a,b=adj[n]; return a==b or wname(pcs[a])!=wname(pcs[b])
    used=set(); out=[]
    for i,pc in enumerate(pcs):
        if i in used: continue
        # walk back to a stop node
        chain=[(i,1)]; used.add(i)
        # extend forward
        for direction in (1,-1):
            while True:
                ci,cd=chain[-1] if direction==1 else chain[0]
                cp=pcs[ci]['p']
                endn = (cp[-1] if cd==1 else cp[0]) if direction==1 else (cp[0] if cd==1 else cp[-1])
                if stop(endn): break
                nx=[j for j in adj[endn] if j not in used]
                if not nx: break
                j=nx[0]; used.add(j); jp=pcs[j]['p']
                if direction==1: chain.append((j, 1 if jp[0]==endn else -1))
                else: chain.insert(0,(j, 1 if jp[-1]==endn else -1))
        path=[]; members=[]
        for ci,cd in chain:
            p=pcs[ci]['p'] if cd==1 else pcs[ci]['p'][::-1]
            path = p[:] if not path else path+p[1:]
            members.append(ci)
        out.append({'p':path,'m':members})
    return out
netsegs=contract(inc, forced)
# split pieces whose interior hits forced nodes (gpx attach to interior vertex)
fixed=[]
for s in netsegs:
    p=s['p']; cut=[0]+[k for k in range(1,len(p)-1) if p[k] in forced]+[len(p)-1]
    for a,b in zip(cut,cut[1:]): fixed.append({'p':p[a:b+1],'m':s['m']})
netsegs=fixed
netnodes=set(n for s in netsegs for n in s['p'])
endsset=set(n for s in netsegs for n in (s['p'][0],s['p'][-1]))
def L(p): return sum(math.hypot(NX[a][0]-NX[b][0],NX[a][1]-NX[b][1]) for a,b in zip(p,p[1:]))
print('network segments',len(netsegs),'km',round(sum(L(s['p']) for s in netsegs)/1000,2),'junctions',len(endsset))
# --- extras: excluded trailish pieces, contracted, touching network
excT=[pc for pc in exc if ways[pc['w']]['trailish']]
for pc in excT: pc['src']='osm'
keepE=set(n for pc in excT for n in (pc['p'][0],pc['p'][-1]) if n in netnodes)
extras=contract(excT, keepE|endsset)
# keep components connected to network
adjE=defaultdict(set)
for i,e in enumerate(extras): adjE[e['p'][0]].add(i); adjE[e['p'][-1]].add(i)
reach=set(); stack=[i for i,e in enumerate(extras) if e['p'][0] in netnodes or e['p'][-1] in netnodes]
while stack:
    i=stack.pop()
    if i in reach: continue
    reach.add(i)
    for n in (extras[i]['p'][0],extras[i]['p'][-1]):
        if n not in netnodes: stack.extend(adjE[n]-reach)
extras=[e for i,e in enumerate(extras) if i in reach and L(e['p'])>15]
print('extras',len(extras),'km',round(sum(L(e['p']) for e in extras)/1000,2))
# --- elevation from GPX
allnodes=sorted(set(n for s in netsegs+extras for n in s['p']))
ele={}
for n in allnodes:
    dd,i,t=nearest(ggpx,*NX[n])
    if i is not None and dd<15: ele[n]=G[i][2]+(G[i+1][2]-G[i][2])*t
def fill(p):
    known=[k for k,n in enumerate(p) if n in ele]
    if not known:
        for n in p:
            # nearest gpx point, any distance
            best=min(range(len(GP)),key=lambda i:(GP[i][0]-NX[n][0])**2+(GP[i][1]-NX[n][1])**2); ele[n]=G[best][2]
        return True
    cum=[0]
    for a,b in zip(p,p[1:]): cum.append(cum[-1]+math.hypot(NX[a][0]-NX[b][0],NX[a][1]-NX[b][1]))
    approx=False
    for k,n in enumerate(p):
        if n in ele: continue
        lo=max([j for j in known if j<k],default=None); hi=min([j for j in known if j>k],default=None)
        if lo is None: ele[n]=ele[p[hi]]; approx=True
        elif hi is None: ele[n]=ele[p[lo]]; approx=True
        else:
            f=(cum[k]-cum[lo])/(cum[hi]-cum[lo]) if cum[hi]>cum[lo] else 0; ele[n]=ele[p[lo]]+(ele[p[hi]]-ele[p[lo]])*f
    return approx
for s in netsegs: fill(s['p'])
for e in extras: e['approxEle']=fill(e['p']) or True  # extras are off the GPX: rough
# --- tags per segment
IMBA={'0':1,'1':1,'2':2,'3':3,'4':4}; PAVED={'asphalt','concrete','paved','paving_stones','concrete:plates','sett'}
def tagsum(s, pcs):
    by=Counter(); acc=defaultdict(Counter); tot=0
    for mi in s['m']:
        pc=pcs[mi]; l=L(pc['p']); tot+=l
        if pc['w'] is None: acc['src']['gpx']+=l; continue
        t=ways[pc['w']]['tags']
        for k in ('name','surface','sac_scale','highway','oneway','informal','mtb:scale','trail_visibility'):
            if t.get(k): acc[k][t[k]]+=l
        if t.get('mtb:scale:imba') in IMBA: acc['imba'][IMBA[t['mtb:scale:imba']]]+=l
        acc['wayid'][ways[pc['w']]['id']]+=l
        if t.get('surface') in PAVED or t.get('highway')=='service' or t.get('footway') in ('sidewalk','crossing'): acc['paved'][1]+=l
    o={}
    for k in ('name','surface','sac_scale','highway','oneway','informal','mtb:scale','trail_visibility'):
        if acc[k]: o[{'sac_scale':'sac'}.get(k,k)]=acc[k].most_common(1)[0][0]
    if acc['imba']: o['imba']=acc['imba'].most_common(1)[0][0]; o['imbaMax']=max(acc['imba'])
    o['paved']=round(acc['paved'][1]/tot,2) if tot else 0
    o['cov']=1.0
    if o.get('name'): o['nameCov']=1.0
    if acc['src']: o['gpxOnly']=True
    o['ways']=[w for w,_ in acc['wayid'].most_common(5)]
    if o.get('informal')!='yes': o.pop('informal',None)
    else: o['informal']=True
    if o.get('oneway') not in ('yes','-1'): o.pop('oneway',None)
    return o
for s in netsegs: s['osm']=tagsum(s, inc)
for e in extras: e['osm']=tagsum(e, excT)
# --- GPX traversal counts per network segment
gseg=mkgrid([((si,k),(NX[a],NX[b])) for si,s in enumerate(netsegs) for k,(a,b) in enumerate(zip(s['p'],s['p'][1:]))])
runs=[[0,0] for _ in netsegs]; last=None
for i in range(len(GP)-1):
    m=((GP[i][0]+GP[i+1][0])/2,(GP[i][1]+GP[i+1][1])/2)
    dd,item,t=nearest(gseg,*m)
    if item is None or dd>12: last=None; continue
    si,k=item; s=netsegs[si]['p']
    A,B=NX[s[k]],NX[s[k+1]]; v=(B[0]-A[0],B[1]-A[1]); g=(GP[i+1][0]-GP[i][0],GP[i+1][1]-GP[i][1])
    dr=1 if v[0]*g[0]+v[1]*g[1]>=0 else -1
    if last!=(si,dr): runs[si][0 if dr>0 else 1]+=1
    last=(si,dr)
# --- start node & top
startn=min(endsset,key=lambda n:math.hypot(NX[n][0]-GP[0][0],NX[n][1]-GP[0][1]))
# --- remap
used=sorted(set(n for s in netsegs+extras for n in s['p'])); m={k:i for i,k in enumerate(used)}
nodes=[[round(NODES[k][0],7),round(NODES[k][1],7),round(ele[k],1)] for k in used]
out={'nodes':nodes,
 'segs':[{'p':[m[x] for x in s['p']],'f':r[0],'r':r[1],'osm':s['osm']} for s,r in zip(netsegs,runs)],
 'extras':[{'p':[m[x] for x in e['p']],'osm':e['osm']} for e in extras],
 'start':m[startn]}
ends=[m[n] for n in endsset]; out['top']=max(ends,key=lambda n:nodes[n][2])
# ref layer: everything in OSM export not part of network/extras
netways=set(w for s in netsegs+extras for w in s['osm'].get('ways',[]))
O=json.load(open('osm.json'))['elements']
ref=[]
for w in O:
    g=[p for p in (w.get('geometry') or []) if p]
    if len(g)<2: continue
    hw=w.get('tags',{}).get('highway')
    ref.append({'c':[[round(p['lon'],6),round(p['lat'],6)] for p in g],'k':'trail' if hw in ('path','track','bridleway','steps') else 'paved','n':w.get('tags',{}).get('name',''),'m':0,'hw':hw})
out['ref']=ref; out['issues']=[]
# gpx-only checks
for i,s in enumerate(out['segs']):
    if s['osm'].get('gpxOnly'):
        n=s['p'][len(s['p'])//2]; out['issues'].append({'type':'gpx','seg':i,'ll':nodes[n][:2]})
out['meta']={'name':'Exhaustive','km':52.5,'source':'osm'}
print('named',sum(1 for s in out['segs'] if s['osm'].get('name')),'imba',sum(1 for s in out['segs'] if s['osm'].get('imba')),'checks',len(out['issues']))
lens=sorted(L([used[x] for x in s['p']]) for s in out['segs']); print('short<20',sum(1 for l in lens if l<20),'longest',[round(l) for l in lens[-4:]])
json.dump(out,open('data5.json','w'),separators=(',',':'))
import os; print('KB',os.path.getsize('data5.json')//1024)
