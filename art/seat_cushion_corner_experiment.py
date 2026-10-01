"""Two-dimensional cushion shell: shared recessed center/full corner front.

Fixed contact plane, no source warp, source-only coverage objective.
"""
import argparse
import itertools
import json
from pathlib import Path
import numpy as np
from seat_cushion_shell_experiment import profile,triangulate_polygon,projected_depth
from seat_rounded_diagnostic import TILE,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def mesh(front,advance,lip,nu=8,nt=8,quartic=0.):
    vertices=[];triangles=[]
    for left,right in [(.29,.99),(1.01,1.71)]:
        offset=len(vertices);profiles=[]
        for i,u in enumerate(np.linspace(left,right,nu+1)):
            s=2*i/nu-1;f=front+advance*s*s+quartic*s**4;p=profile(f,lip,.05,.45,nt);profiles.append(p);vertices.extend([[u*TILE,v*TILE,z] for v,z in p])
        m=len(profiles[0])
        for i in range(nu):
            for j in range(m):
                a=offset+i*m+j;b=offset+i*m+(j+1)%m;c=b+m;d=a+m;triangles.extend([[a,b,c],[a,c,d]])
        for side in [0,nu]:triangles.extend([[offset+side*m+j for j in tri] for tri in triangulate_polygon(profiles[side])])
    return np.array(vertices),np.array(triangles)


def surface_clearance(front,advance,lip,segments,quartic=0.):
    points=[]
    for left,right in [(.29,.99),(1.01,1.71)]:
        for u in np.linspace(left,right,161):
            s=(u-(left+right)/2)/((right-left)/2);p=profile(front+advance*s*s+quartic*s**4,lip,.05,.45,32);p[:,0]*=TILE
            for A,B in zip(p,np.roll(p,-1,axis=0)):
                for v,z in A+np.linspace(0,1,int(np.ceil(np.linalg.norm(B-A)/.1))+1)[:,None]*(B-A):points.append([u*TILE,v,z])
        # End caps conservatively covered by their whole box, stronger than polygon.
        p=profile(front+advance+quartic,lip,.05,.45,32);lo,hi=p[:,0].min(),p[:,0].max()
        for u in [left,right]:
            points.extend([[u*TILE,v*TILE,z] for v in np.linspace(lo,hi,int(np.ceil((hi-lo)*TILE/.1))+1) for z in np.linspace(3,10.15,73)])
    points=np.array(points);gap=float('inf')
    for A,B in segments:
        A=np.array(A);d=np.array(B)-A;t=np.clip((points-A)@d/(d@d),0,1);gap=min(gap,float(np.min(np.linalg.norm(points-A-t[:,None]*d,axis=1)-SHIN_RADIUS)))
    # Nearest u section + nearest profile-edge sample + cubic chord error.
    # The u derivative includes the changing front position, not just width.
    extrema=[0.,1.]
    if quartic and 0<-advance/(6*quartic)<1:extrema.append(np.sqrt(-advance/(6*quartic)))
    slope=max(abs(2*advance*s+4*quartic*s**3) for s in extrema)/.35
    lateral_lipschitz=np.hypot(1.,slope)
    cover=lateral_lipschitz*(.7*TILE/160)/2+.05+.01
    return {'minimumSampleGap':gap,'coverRadius':float(cover),'lowerSurfaceGap':float(gap-cover)}


def run(inputs,roles,out):
    views=[];segments={};hashes={}
    for f in ['se','sw','ne','nw']:
        d=json.loads((Path(inputs)/(f+'.json')).read_text());a=d['sourceArt'];rows=json.loads((Path(roles)/(f+'-intervals.json')).read_text());mask=np.zeros((a['height'],a['width']),bool)
        for p in rows:
            if p['provisionalRole']=='seat':mask[p['y'],p['x']]=True
        alpha=np.array(a['rgba']).reshape(a['height'],a['width'],4)[:,:,3]>0;views.append((f,a,mask,alpha));hashes[f]={'art':digest(a),'roles':digest(rows),'anatomy':digest([c['anatomy'] for c in d['contexts']])}
        for c in d['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(a,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
    trials=[];best=None
    for front,advance,lip in itertools.product([.27,.30],[-.6,-.9,-1.2],[10.15]):
        quartic=-.2-advance
        clearance=surface_clearance(front,advance,lip,list(segments.values()),quartic);r={'front':front,'cornerAdvance':advance,'quartic':quartic,'lip':lip,'clearance':clearance,'eligible':clearance['lowerSurfaceGap']>=0}
        if r['eligible']:
            v,t=mesh(front,advance,lip,quartic=quartic);stats={};loss=0
            for f,a,mask,alpha in views:
                hit=np.isfinite(projected_depth(v,t,a,[2,1],f));missing=int((mask&~hit).sum());extra=int((~alpha&hit).sum());loss+=missing+extra;stats[f]={'missingSeat':missing,'extraAlpha':extra}
            r.update(sourceLoss=loss,views=stats)
            if best is None or loss<best['sourceLoss']:best=r;print('best',r,flush=True)
        trials.append(r)
    output=Path(out);output.mkdir(parents=True,exist_ok=True)
    if best:
        v,t=mesh(best['front'],best['cornerAdvance'],best['lip'],32,32,best['quartic']);(output/'shell.json').write_text(json.dumps({'vertices':v.tolist(),'triangles':t.tolist()}))
    (output/'report.json').write_text(json.dumps({'status':'PARTIAL_CORNER_SHELL_NOT_APPROVAL','sourceHashes':hashes,'scriptSha256':digest(Path(__file__).read_text()),'best':best,'trials':trials,'contacts':[[.63,.615,10.15],[1.37,.615,10.15]],'limitations':['Provisional source roles and independent physical surface bound do not approve a full seat.','No source correspondence, expected-winner fitting, or runtime change.']},indent=2))
    print('eligible',sum(r['eligible'] for r in trials),len(trials),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','roles','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.roles,a.out)
