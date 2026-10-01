"""Isolated tied cushion shell fit: source role coverage + hard physical clearance.

No body alpha or winner inputs. Explicit author intent; no runtime output.
"""
import argparse
import json
import itertools
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import TILE,project,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def profile(front,lip,recession,transition,n,bow=0.):
    top=10.15;rear=.71;bottom=3.
    # Cubic controls give horizontal tangents at lip and flat support transition.
    control=np.array([[front,lip],[front+(transition-front)/3,lip],
                      [transition-(transition-front)/3,top],[transition,top]])
    t=np.linspace(0,1,n+1)[:,None]
    curve=(1-t)**3*control[0]+3*(1-t)**2*t*control[1]+3*(1-t)*t*t*control[2]+t**3*control[3]
    corners=np.array([[rear,top],[rear,bottom],[front+recession,bottom]])
    if bow==0:return np.vstack([curve,corners])
    control=np.array([[front+recession,bottom],[front+recession+bow,bottom+(lip-bottom)/3],
                      [front+bow,lip-(lip-bottom)/3],[front,lip]])
    front_curve=(1-t)**3*control[0]+3*(1-t)**2*t*control[1]+3*(1-t)*t*t*control[2]+t**3*control[3]
    return np.vstack([curve,corners,front_curve[1:-1]])


def parameter_profile(parameters,n):
    return profile(*parameters[:4],n,bow=parameters[4] if len(parameters)>4 else 0.)


def triangulate_polygon(points):
    cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
    order=list(range(len(points)));area=sum(cross(a,b) for a,b in zip(points,np.roll(points,-1,axis=0)))
    sign=1 if area>0 else -1;triangles=[]
    while len(order)>3:
        found=False
        for j,index in enumerate(order):
            ids=[order[j-1],index,order[(j+1)%len(order)]];a,b,c=points[ids]
            if sign*cross(b-a,c-b)<=1e-12:continue
            def contained(p):return all(sign*cross(y-x,p-x)>=-1e-12 for x,y in [(a,b),(b,c),(c,a)])
            if any(contained(points[k]) for k in order if k not in ids):continue
            triangles.append(ids);order.pop(j);found=True;break
        if not found:raise ValueError('Non-simple or degenerate profile polygon')
    return triangles+[order]


def shell(parameters,n=16):
    curve=parameter_profile(parameters,n);vertices=[];triangles=[]
    for left,right in [(.29,.99),(1.01,1.71)]:
        offset=len(vertices);m=len(curve)
        for u in [left,right]:vertices.extend([[u*TILE,v*TILE,z] for v,z in curve])
        for i in range(m):
            j=(i+1)%m;triangles.extend([[offset+i,offset+j,offset+m+j],[offset+i,offset+m+j,offset+m+i]])
        for k in [0,m]:
            triangles.extend([[offset+k+i for i in tri] for tri in triangulate_polygon(curve)])
    return np.array(vertices),np.array(triangles)


def projected_depth(vertices,triangles,art,size,facing):
    p=np.array([project(art['anchor'],size,facing,u/TILE,v/TILE,z) for u,v,z in vertices])-.5
    depth=np.full((art['height'],art['width']),-np.inf)
    for ids in triangles:
        a,b,c=p[ids];za,zb,zc=vertices[ids,2]
        low=np.maximum(np.floor(np.min([a,b,c],axis=0)).astype(int),0);high=np.minimum(np.ceil(np.max([a,b,c],axis=0)).astype(int),[art['width']-1,art['height']-1])
        if np.any(high<low):continue
        det=(b-a)[0]*(c-a)[1]-(b-a)[1]*(c-a)[0]
        if abs(det)<1e-12:continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1];q=np.stack([xx-a[0],yy-a[1]],axis=-1)
        s=(q[:,:,0]*(c-a)[1]-q[:,:,1]*(c-a)[0])/det;t=((b-a)[0]*q[:,:,1]-(b-a)[1]*q[:,:,0])/det
        z=za+s*(zb-za)+t*(zc-za);inside=(s>=-1e-9)&(t>=-1e-9)&(s+t<=1+1e-9)
        old=depth[low[1]:high[1]+1,low[0]:high[0]+1];np.maximum(old,np.where(inside,z,-np.inf),out=old)
    return depth


def conservative_clearance(parameters,segments,spacing=.10):
    # Piecewise-linear profile surface; grid-cell diagonal bounds distance to sample.
    curve=parameter_profile(parameters,32);curve[:,0]*=TILE;minimum=float('inf');bound=0.;points=[]
    for left,right in [(.29*TILE,.99*TILE),(1.01*TILE,1.71*TILE)]:
        us=np.linspace(left,right,int(np.ceil((right-left)/spacing))+1)
        for A,B in zip(curve,np.roll(curve,-1,axis=0)):
            count=int(np.ceil(np.linalg.norm(B-A)/spacing))+1
            strip=A+np.linspace(0,1,count)[:,None]*(B-A)
            points.extend([[u,v,z] for u in us for v,z in strip])
        vs=np.linspace(curve[:,0].min(),curve[:,0].max(),int(np.ceil(np.ptp(curve[:,0])/spacing))+1)
        zs=np.linspace(3,10.15,int(np.ceil(7.15/spacing))+1)
        vv,zz=np.meshgrid(vs,zs);inside=np.zeros(vv.shape,bool)
        for A,B in zip(curve,np.roll(curve,-1,axis=0)):
            if abs(A[1]-B[1])<1e-12:continue
            inside^=((A[1]>zz)!=(B[1]>zz))&(vv<(B[0]-A[0])*(zz-A[1])/(B[1]-A[1])+A[0])
        points.extend([[u,v,z] for u in [left,right] for v,z in zip(vv[inside],zz[inside])])
    points=np.array(points)
    for A,B in segments:
        A=np.array(A);d=np.array(B)-A;t=np.clip((points-A)@d/(d@d),0,1)
        minimum=min(minimum,float(np.min(np.linalg.norm(points-A-t[:,None]*d,axis=1)-SHIN_RADIUS)))
    # Grid diagonal covers surface; .01 bounds curve chord error for n=32.
    bound=np.sqrt(2)*spacing+.01
    return {'minimumSampleGap':minimum,'surfaceCoverRadiusBound':bound,'certifiedLowerGap':minimum-bound}


def run(inputs,intervals,out):
    views=[];segments={};hashes={}
    for f in ['se','sw','ne','nw']:
        d=json.loads((Path(inputs)/(f+'.json')).read_text());art=d['sourceArt'];rows=json.loads((Path(intervals)/(f+'-intervals.json')).read_text())
        mask=np.zeros((art['height'],art['width']),bool)
        for r in rows:
            if r['provisionalRole']=='seat':mask[r['y'],r['x']]=True
        views.append((f,art,mask));hashes[f]={'sourceArt':digest(art),'provisionalRoleIntervals':digest(rows),'anatomy':digest([c['anatomy'] for c in d['contexts']])}
        for c in d['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
    trials=[];best=None
    for params in itertools.product([.16,.21,.26],[5.5,7.5,9.5],[.05,.15],[.45],[-.15,0.,.15]):
        clearance=conservative_clearance(params,list(segments.values()));row={'parameters':params,'clearance':clearance}
        if clearance['certifiedLowerGap']<0:row['eligible']=False;trials.append(row);continue
        vertices,triangles=shell(params);loss=0;stats={}
        for f,art,mask in views:
            z=projected_depth(vertices,triangles,art,[2,1],f);hit=np.isfinite(z)
            # Other parts may occlude shell; constrain only seat-owned pixels plus transparency.
            alpha=np.array(art['rgba']).reshape(art['height'],art['width'],4)[:,:,3]>0
            missing=int((mask&~hit).sum());extra=int((~alpha&hit).sum());loss+=missing+extra
            stats[f]={'missingCushionPixels':missing,'outsideSourceAlpha':extra}
        row.update(eligible=True,sourceLoss=loss,views=stats);trials.append(row)
        if best is None or loss<best['sourceLoss']:best=row;print('best',best,flush=True)
    output=Path(out);output.mkdir(parents=True,exist_ok=True)
    result={'status':'ISOLATED_CUSHION_PARTIAL_EXPERIMENT','sourceHashes':hashes,'scriptSha256':digest(Path(__file__).read_text()),'trials':trials,'best':best,
            'fixedContacts':[[.63,.615,10.15],[1.37,.615,10.15]],'limitations':['Cushion only; no accepted full chair geometry.','Source ownership remains provisional.','Contact horizontal tangency is exact; no garment or shoe volume included.','Requires independent ray solver, continuous patch error verification and visual review before any acceptance.']}
    if best:
        vertices,triangles=shell(best['parameters'],32)
        (output/'shell.json').write_text(json.dumps({'parameters':best['parameters'],'vertices':vertices.tolist(),'triangles':triangles.tolist()}))
        for f,art,mask in views:
            z=projected_depth(vertices,triangles,art,[2,1],f)
            (output/(f+'-cushion-depth.json')).write_text(json.dumps([[None if not np.isfinite(v) else float(v) for v in row] for row in z]))
    (output/'report.json').write_text(json.dumps(result,indent=2))
    print('eligible',sum(r['eligible'] for r in trials),'/',len(trials),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','intervals','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.intervals,a.out)
