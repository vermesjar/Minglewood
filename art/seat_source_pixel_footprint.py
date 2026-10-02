"""Test original pixel-cell coverage before introducing any source warp.

Offset rays remain INSIDE their original source pixel. The retained heights
also clear original-center lifted shin capsules. No furniture depth selected.
"""
import argparse
import json
import itertools
from pathlib import Path
import numpy as np
from seat_source_visual_hull import alpha_intervals,intersect
from seat_local_surface_envelope import capsule_interval,subtract
from seat_rounded_diagnostic import ray,project,TILE,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def run(inputs,hull,out):
    all_data={f:json.loads((Path(inputs)/(f+'.json')).read_text()) for f in ['se','sw','ne','nw']};arts={f:d['sourceArt'] for f,d in all_data.items()};masks={f:np.array(a['rgba']).reshape(a['height'],a['width'],4)[:,:,3]>0 for f,a in arts.items()}
    output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'PIXEL_FOOTPRINT_WITNESS_NOT_CONTINUOUS_SURFACE','views':{},'scriptSha256':digest(Path(__file__).read_text())}
    for f,art in arts.items():
        conflicts=json.loads((Path(hull)/(f+'-conflicts.json')).read_text());segments={};rows=[]
        for c in all_data[f]['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
        for r in conflicts:
            x,y=r['x'],r['y'];o,d=ray(art['anchor'],[2,1],f,x+.5,y+.5);blocked=[h for A,B in segments.values() if (h:=capsule_interval(o,d,A,B,SHIN_RADIUS))];witness=None
            for radius in [.125,.25,.375,.499]:
                for dx,dy in [(radius,0),(-radius,0),(0,radius),(0,-radius),*itertools.product([-radius,radius],repeat=2)]:
                    o,d=map(np.array,ray(art['anchor'],[2,1],f,x+.5+dx,y+.5+dy));possible=[(-32.,64.)]
                    for g,other in arts.items():
                        if g==f:continue
                        a=np.array(project(other['anchor'],[2,1],g,o[0]/TILE,o[1]/TILE,0));p=o+d;b=np.array(project(other['anchor'],[2,1],g,p[0]/TILE,p[1]/TILE,1))-a
                        possible=intersect(possible,alpha_intervals(a,b,masks[g],-32,64))
                        if not possible:break
                    possible=subtract(possible,blocked)
                    if possible:witness={'dx':dx,'dy':dy,'maxAxisDisplacement':radius,'euclideanDisplacement':float(np.hypot(dx,dy)),'heightIntervalsClearingLiftedOriginalCenter':possible};break
                if witness:break
            rows.append({'x':x,'y':y,'witness':witness})
        (output/(f+'-witnesses.json')).write_text(json.dumps(rows,indent=2));found=[r['witness'] for r in rows if r['witness']]
        report['views'][f]={'centerConflicts':len(rows),'withinOriginalPixelWitnesses':len(found),'remainingWithoutWitness':len(rows)-len(found),'maximumTestedWitnessAxisDisplacement':max((r['maxAxisDisplacement'] for r in found),default=0),'maximumTestedEuclideanDisplacement':max((r['euclideanDisplacement'] for r in found),default=0),'sourceSha256':digest(art),'anatomySha256':digest([c['anatomy'] for c in all_data[f]['contexts']])};print(f,report['views'][f],flush=True)
    report['limitations']=['Discrete offset search yields upper bounds on needed offsets, not exact minimum displacement.','Witnesses are inside original pixel footprints; do not call this an artwork warp or literal silhouette impossibility.','Original-center lifted capsule constraints are retained, but no continuous surface, shared sampling rule, contact or Jacobian certificate is established.','No depths chosen and original independent uncertainty remains unchanged.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','hull','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.hull,a.out)
