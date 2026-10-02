"""Bounded source-only lower-apron bevel within the prior wedge envelope."""
import argparse
import json
from pathlib import Path
import numpy as np
from seat_apron_shell_experiment import apron
from seat_cushion_shell_experiment import projected_depth,triangulate_polygon
from seat_rounded_diagnostic import TILE,digest


def run(inputs,intervals,parent,out):
    parent=Path(parent);prior=json.loads((parent/'report.json').read_text());best=prior['best'];_,_,curve=apron(best['bottom'],best['frontBottom'],rear=best['rear']);views=[]
    for f in ['se','sw','ne','nw']:
        art=json.loads((Path(inputs)/(f+'.json')).read_text())['sourceArt'];rows=json.loads((Path(intervals)/(f+'-intervals.json')).read_text());mask=np.zeros((art['height'],art['width']),bool)
        for r in rows:
            if r['provisionalRole']=='base':mask[r['y'],r['x']]=True
        views.append((f,art,mask))
    trials=[];winner=None
    for radius in [0.,.1,.2,.3,.4,.5,.75,1.]:
        if radius:
            corner=curve[3];a=corner+radius*(curve[2]-corner)/np.linalg.norm(curve[2]-corner);b=corner+radius*(curve[0]-corner)/np.linalg.norm(curve[0]-corner)
            t=np.linspace(0,1,17)[:,None];arc=(1-t)**2*a+2*t*(1-t)*corner+t*t*b;p=np.vstack([curve[:3],arc])
        else:p=curve.copy()
        m=len(p);v=np.array([[u*TILE,x,z] for u in [.29,1.71] for x,z in p]);tri=[]
        for i in range(m):
            j=(i+1)%m;tri.extend([[i,j,j+m],[i,j+m,i+m]])
        for offset in [0,m]:tri.extend([[offset+i for i in tr] for tr in triangulate_polygon(p)])
        tri=np.array(tri);stats={};loss=0
        for f,art,mask in views:
            hit=np.isfinite(projected_depth(v,tri,art,[2,1],f));alpha=np.array(art['rgba']).reshape(art['height'],art['width'],4)[:,:,3]>0
            missing=int((mask&~hit).sum());extra=int((hit&~alpha).sum());loss+=missing+extra;stats[f]={'missing':missing,'extra':extra}
        row={'bevelWorldRadius':radius,'sourceLoss':loss,'views':stats};trials.append(row)
        if winner is None or loss<winner[0]['sourceLoss']:winner=(row,v,tri)
    output=Path(out);output.mkdir(parents=True,exist_ok=True)
    (output/'report.json').write_text(json.dumps({'status':'SOURCE_ONLY_SUBSET_BEVEL_NOT_APPROVAL','parentReportSha256':digest(prior),'scriptSha256':digest(Path(__file__).read_text()),'trials':trials,'best':winner[0],'limitations':['Bevel lies within the prior convex apron wedge; this experiment does not independently certify solid-volume clearance.','Prior cushion/source uncertainty unchanged; no runtime candidate replacement.']},indent=2))
    (output/'apron.json').write_text(json.dumps({'vertices':winner[1].tolist(),'triangles':winner[2].tolist()}));print(json.dumps(trials,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','intervals','parent','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.intervals,a.parent,a.out)
