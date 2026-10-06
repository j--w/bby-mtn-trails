import json, math, re
from collections import defaultdict, Counter
O=json.load(open('osm.json'))['elements']
txt=open('exhaustive.gpx').read()
G=[(float(a),float(b),float(e)) for a,b,e in re.findall(r'lat="([^"]+)" lon="([^"]+)">\s*<ele>([^<]+)',txt)]
lat0=math.radians(G[0][0]); R=6371000
def xy(lat,lon): return (lon*math.pi/180*R*math.cos(lat0), lat*math.pi/180*R)
GP=[xy(a,b) for a,b,_ in G]
# GPX segment grid
C=20; gg=defaultdict(list)
for i in range(len(GP)-1):
    (ax,ay),(bx,by)=GP[i],GP[i+1]
    for gx in range(int(min(ax,bx)//C)-1,int(max(ax,bx)//C)+2):
        for gy in range(int(min(ay,by)//C)-1,int(max(ay,by)//C)+2): gg[(gx,gy)].append(i)
def gpx_near(px,py):
    best=(1e9,None,0)
    for i in gg.get((int(px//C),int(py//C)),[]):
        (ax,ay),(bx,by)=GP[i],GP[i+1]; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
        t=0 if L==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L)); dd=math.hypot(px-ax-t*dx,py-ay-t*dy)
        if dd<best[0]: best=(dd,i,t)
    return best
def gpx_dist_far(px,py):  # coarse distance for candidates (up to 300 m)
    k=int(px//C),int(py//C); best=1e9
    for r in range(0,16):
        for gx in range(k[0]-r,k[0]+r+1):
            for gy in range(k[1]-r,k[1]+r+1):
                if max(abs(gx-k[0]),abs(gy-k[1]))!=r: continue
                for i in gg.get((gx,gy),[]): best=min(best,math.hypot(GP[i][0]-px,GP[i][1]-py))
        if best<1e9 and best < r*C: return best
    return best
TRAIL={'path','track','bridleway','steps','cycleway'}
ways=[]
for w in O:
    g=[p for p in (w.get('geometry') or []) if p]
    if len(g)<2: continue
    t=w.get('tags',{})
    if t.get('access') in ('private','no') or t.get('foot')=='no': continue
    pts=[xy(p['lat'],p['lon']) for p in g]
    # coverage by gpx
    tot=on=0; minD=1e9
    for a,b in zip(pts,pts[1:]):
        l=math.hypot(b[0]-a[0],b[1]-a[1]); k=max(1,int(l/6))
        for i in range(k):
            px,py=a[0]+(b[0]-a[0])*i/k,a[1]+(b[1]-a[1])*i/k; tot+=l/k
            d=gpx_near(px,py)[0]
            if d<8: on+=l/k
    hw=t.get('highway')
    sidewalk = hw=='footway' and t.get('footway') in ('sidewalk','crossing')
    trailish = hw in TRAIL or (hw=='footway' and not sidewalk)
    near300 = trailish and min(gpx_dist_far(*pts[j]) for j in range(0,len(pts),max(1,len(pts)//6)))<300
    if on>0 or near300:
        ways.append({'id':w['id'],'tags':t,'g':g,'pts':pts,'cov':on/tot if tot else 0,'trailish':trailish})
print('candidate ways',len(ways),'with coverage',sum(1 for w in ways if w['cov']>0))
# topology by exact coordinate
key=lambda p:(round(p['lat'],7),round(p['lon'],7))
use=Counter(); endp=set()
for w in ways:
    ks=[key(p) for p in w['g']]
    for k in set(ks): use[k]+=1
    endp.add(ks[0]); endp.add(ks[-1])
    # self-intersection/loop repeats
    for k,c in Counter(ks).items():
        if c>1: use[k]+=1
nid={}; NODES=[]
def node(k,p):
    if k not in nid: nid[k]=len(NODES); NODES.append([p['lat'],p['lon']])
    return nid[k]
junction=lambda k: use[k]>=2 or k in endp
# split ways into pieces at junctions; edge-level coverage
pieces=[]  # dict(nodes, way, cov)
for wi,w in enumerate(ways):
    ks=[key(p) for p in w['g']]; ns=[node(k,p) for k,p in zip(ks,w['g'])]
    cur=[ns[0]]
    for j in range(1,len(ns)):
        cur.append(ns[j])
        if junction(ks[j]) or j==len(ns)-1:
            pieces.append({'p':cur,'w':wi}); cur=[ns[j]]
NX=[xy(a,b) for a,b in NODES]
def plen(p): return sum(math.hypot(NX[a][0]-NX[b][0],NX[a][1]-NX[b][1]) for a,b in zip(p,p[1:]))
def cover(p):
    tot=on=0
    for a,b in zip(p,p[1:]):
        (ax,ay),(bx,by)=NX[a],NX[b]; l=math.hypot(bx-ax,by-ay); k=max(1,int(l/5))
        for i in range(k):
            px,py=ax+(bx-ax)*(i+.5)/k,ay+(by-ay)*(i+.5)/k; tot+=l/k
            if gpx_near(px,py)[0]<8: on+=l/k
    return on/tot if tot else 0
for pc in pieces: pc['cov']=cover(pc['p']); pc['len']=plen(pc['p'])
inc=[pc for pc in pieces if pc['cov']>=0.6]
print('pieces',len(pieces),'included',len(inc),'km',round(sum(p['len'] for p in inc)/1000,2))
# how much of the GPX is NOT on included pieces
incgrid=defaultdict(list)
for pi,pc in enumerate(inc):
    for a,b in zip(pc['p'],pc['p'][1:]):
        (ax,ay),(bx,by)=NX[a],NX[b]
        for gx in range(int(min(ax,bx)//C)-1,int(max(ax,bx)//C)+2):
            for gy in range(int(min(ay,by)//C)-1,int(max(ay,by)//C)+2): incgrid[(gx,gy)].append((a,b))
def inc_near(px,py):
    best=1e9
    for a,b in incgrid.get((int(px//C),int(py//C)),[]):
        (ax,ay),(bx,by)=NX[a],NX[b]; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
        t=0 if L==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L)); best=min(best,math.hypot(px-ax-t*dx,py-ay-t*dy))
    return best
off=[]; offlen=0
for i in range(len(GP)-1):
    (ax,ay),(bx,by)=GP[i],GP[i+1]; l=math.hypot(bx-ax,by-ay)
    mx,my=(ax+bx)/2,(ay+by)/2
    if inc_near(mx,my)>10: offlen+=l; off.append(i)
print('GPX length not on included OSM',round(offlen))
import pickle; pickle.dump(dict(ways=ways,pieces=pieces,NODES=NODES,off=off,lat0=lat0),open('osm_build.pkl','wb'))
