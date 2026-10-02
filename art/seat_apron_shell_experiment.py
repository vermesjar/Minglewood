"""Source-owned apron wedge experiment joined to frozen cushion underside."""
import argparse
import json
import itertools
from pathlib import Path
import numpy as np
from seat_cushion_shell_experiment import projected_depth,triangulate_polygon
from seat_rounded_diagnostic import TILE,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def apron(bottom,front_bottom,front_top=.26,rear=.945):
    curve=np.array([[front_top*TILE,3.],[rear*TILE,3.],[rear*TILE,bottom],[front_bottom*TILE,bottom]])
    vertices=np.array([[u*TILE,v,z] for u in [.29,1.71] for v,z in curve]);triangles=[]
    for i in range(4):
        j=(i+1)%4;triangles.extend([[i,j,j+4],[i,j+4,i+4]])
    for offset in [0,4]:triangles.extend([[offset+i for i in tri] for tri in triangulate_polygon(curve)])
    return vertices,np.array(triangles),curve


def clearance(curve,segments):
    spacing=.1;points=[];us=np.linspace(.29*TILE,1.71*TILE,281)
    for A,B in zip(curve,np.roll(curve,-1,axis=0)):
        edge=A+np.linspace(0,1,int(np.ceil(np.linalg.norm(B-A)/spacing))+1)[:,None]*(B-A)
        points.extend([[u,v,z] for u in us for v,z in edge])
    for z in np.linspace(curve[2,1],3.,31):
        t=(z-curve[2,1])/(3-curve[2,1]);front=curve[3,0]*(1-t)+curve[0,0]*t
        for u in [us[0],us[-1]]:points.extend([[u,v,z] for v in np.linspace(front,curve[1,0],200)])
    points=np.array(points);gap=float('inf')
    for A,B in segments:
        A=np.array(A);d=np.array(B)-A;t=np.clip((points-A)@d/(d@d),0,1)
        gap=min(gap,float(np.min(np.linalg.norm(points-A-t[:,None]*d,axis=1)-SHIN_RADIUS)))
    return gap-np.sqrt(2)*spacing


def run(inputs,intervals,out):
    views=[];segments={};hashes={}
    for f in ['se','sw','ne','nw']:
        d=json.loads((Path(inputs)/(f+'.json')).read_text());art=d['sourceArt'];rows=json.loads((Path(intervals)/(f+'-intervals.json')).read_text());mask=np.zeros((art['height'],art['width']),bool)
        for r in rows:
            if r['provisionalRole']=='base':mask[r['y'],r['x']]=True
        views.append((f,art,mask));hashes[f]={'beauty':digest(art),'roles':digest(rows),'anatomy':digest([c['anatomy'] for c in d['contexts']])}
        for c in d['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
    trials=[];best=None
    for bottom,front,rear in itertools.product([.4,.5,.6],[.04,.045,.05,.055,.06],[.75]):
        v,t,curve=apron(bottom,front,rear=rear);gap=clearance(curve,list(segments.values()));row={'bottom':bottom,'frontBottom':front,'frontTop':.26,'rear':rear,'minimumBoundedSurfaceGap':float(gap),'eligible':bool(gap>=0)}
        if gap>=0:
            loss=0;stats={}
            for f,art,mask in views:
                z=projected_depth(v,t,art,[2,1],f);hit=np.isfinite(z);alpha=np.array(art['rgba']).reshape(art['height'],art['width'],4)[:,:,3]>0
                missing=int((mask&~hit).sum());extra=int((~alpha&hit).sum());loss+=missing+extra;stats[f]={'missingApronPixels':missing,'outsideAlpha':extra}
            row.update(sourceLoss=loss,views=stats)
            if best is None or loss<best['sourceLoss']:best=row;print('best',best,flush=True)
        trials.append(row)
    output=Path(out);output.mkdir(parents=True,exist_ok=True)
    if best:
        v,t,curve=apron(best['bottom'],best['frontBottom'],rear=best['rear']);(output/'apron.json').write_text(json.dumps({'vertices':v.tolist(),'triangles':t.tolist()}))
    (output/'report.json').write_text(json.dumps({'status':'PARTIAL_APRON_EXPERIMENT_NOT_APPROVAL','sourceHashes':hashes,'scriptSha256':digest(Path(__file__).read_text()),'trials':trials,'best':best,'join':'Top z3 covers frozen cushion underside v.26 through .71, u.29 through1.71.','limitations':['Source roles provisional; continuous shin surface screen excludes shoes/cloth and volume-containment proof.','Separate cushion remains source-incomplete; this cannot approve a complete seat.']},indent=2))
    print('eligible',sum(r['eligible'] for r in trials),len(trials))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','intervals','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.intervals,a.out)
