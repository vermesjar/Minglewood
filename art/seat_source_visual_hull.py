"""Exact interval screen for shared-world original four-view alpha consistency.

Original opaque pixels are half-open unit squares. Sample-center source rays
must remain inside every view's opaque footprint at some shared world height.
No role map, body anatomy, generated mesh, or winner array is used.
"""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import ray,project,TILE,digest


def alpha_intervals(a,b,alpha,low,high):
    """p(z)=a+b*z intersects exact union of opaque unit squares."""
    cuts=[low,high]
    for axis in [0,1]:
        if abs(b[axis])<1e-12:continue
        p,q=sorted([a[axis]+b[axis]*low,a[axis]+b[axis]*high])
        for k in range(math.ceil(p),math.floor(q)+1):
            z=(k-a[axis])/b[axis]
            if low<z<high:cuts.append(z)
    cuts=sorted(set(cuts));result=[];h,w=alpha.shape
    for left,right in zip(cuts,cuts[1:]):
        z=(left+right)/2;x,y=np.floor(a+b*z).astype(int)
        if 0<=x<w and 0<=y<h and alpha[y,x]:
            if result and abs(result[-1][1]-left)<1e-9:result[-1]=(result[-1][0],right)
            else:result.append((left,right))
    return result


def intersect(A,B):
    return [(max(a,c),min(b,d)) for a,b in A for c,d in B if max(a,c)<min(b,d)-1e-9]


def run(inputs,out,lower=-32.,upper=64.):
    data={f:json.loads((Path(inputs)/(f+'.json')).read_text())['sourceArt'] for f in ['se','sw','ne','nw']}
    masks={f:np.array(a['rgba']).reshape(a['height'],a['width'],4)[:,:,3]>0 for f,a in data.items()}
    output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'ORIGINAL_ALPHA_NECESSARY_CONSTRAINT_ONLY','heightDomain':[lower,upper],'sourceSha256':{f:digest(a) for f,a in data.items()},'scriptSha256':digest(Path(__file__).read_text()),'views':{}}
    for f,art in data.items():
        rows=[];conflicts=[]
        for y,x in zip(*np.where(masks[f])):
            origin,direction=ray(art['anchor'],[2,1],f,x+.5,y+.5);origin=np.array(origin);direction=np.array(direction);possible=[(lower,upper)];constraints={}
            for g,other in data.items():
                if f==g:continue
                a=np.array(project(other['anchor'],[2,1],g,origin[0]/TILE,origin[1]/TILE,0))
                p=origin+direction;b=np.array(project(other['anchor'],[2,1],g,p[0]/TILE,p[1]/TILE,p[2]))-a
                intervals=alpha_intervals(a,b,masks[g],lower,upper);constraints[g]=intervals;possible=intersect(possible,intervals)
            row={'x':int(x),'y':int(y),'sharedHeightIntervals':possible};rows.append(row)
            if not possible:conflicts.append({**row,'perOtherViewIntervals':constraints})
        (output/(f+'-intervals.json')).write_text(json.dumps(rows))
        (output/(f+'-conflicts.json')).write_text(json.dumps(conflicts,indent=2))
        report['views'][f]={'opaque':len(rows),'noSharedWorldPoint':len(conflicts),'possible':len(rows)-len(conflicts),'intervalSha256':digest(rows)}
        print(f,report['views'][f],flush=True)
    report['limitations']=['Identity source projection with existing anchors and 2x1 world size only.','Exact pixel footprint convention is authored; absence of a solution under it does not forbid bounded source correspondence.','A visual hull is only a necessary silhouette constraint, not interior component ownership, physical support or visual approval.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--out',required=True);a=p.parse_args();run(a.inputs,a.out)
