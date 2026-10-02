"""Freeze a reviewable compound candidate from isolated same-part geometry.

Does not hide source misses, regenerate beauty, or read current winner arrays.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import declare,ray,digest
from seat_rounded_source_fit import vector_front
from seat_rounded_reference import interval
from seat_cushion_shell_experiment import projected_depth
from seat_cushion_shell_reference import ray_depth


def run(inputs,review,out,cushion='cushion-shell-v4/shell.json'):
    review=Path(review);output=Path(out);output.mkdir(parents=True,exist_ok=True);parts=[];sources={}
    from seat_rounded_diagnostic import TILE
    from seat_foot_geometry_experiment import feet
    v,t,_=feet(dict(inset=.09,width=.22,front=.10,rear=.79,depth=.17,height=5.,taper=.72))
    parts.append({'kind':'triangle-mesh','role':'leg','part':0,'vertices':v.tolist(),'triangles':t.tolist()})
    def box(role,name,u,v,z,r):
        bounds=[[x*TILE for x in u],[x*TILE for x in v],z]
        assert r <= min((b-a)/2 for a,b in bounds)+1e-9
        parts.append({'kind':'rounded-cuboid','part':len(parts),'role':role,'name':name,'bounds':bounds,'radius':r})
    box('seat','left plump cushion',[.285,.99],[.23,.79],[8.1,10.15],1.025)
    box('seat','right plump cushion',[1.01,1.715],[.23,.79],[8.1,10.15],1.025)
    box('base','recessed upholstered plinth',[.27,1.73],[.29,.95],[3.5,8.3],.75)
    for side,u in [('left',[.075,.305]),('right',[1.695,1.925])]:
        box('arm',side+' lower upholstered panel',u,[.10,.94],[4.,12.5],.8)
    for side,u in [('left',[.025,.355]),('right',[1.645,1.975])]:
        box('arm',side+' cylindrical scroll crown',u,[.07,1.01],[11.,16.5],2.75)
    box('back','raised rear upholstered panel',[.18,1.82],[.89,1.01],[4.,13.5],.7)
    box('back','continuous rounded back crown',[.09,1.91],[.79,1.09],[11.5,17.],2.75)
    model={'sits':[[.63,.615,10.15],[1.37,.615,10.15]]}
    declaration={'kind':'isolated-compound-source-geometry','size':[2,1],'contacts':model['sits'],'components':parts,'sourceArtifactSha256':sources}
    report={'status':'UNAPPROVED_REVIEW_CANDIDATE_SOURCE_MISSES_PRESERVED','declarationSha256':digest(declaration),'sourceCodeSha256':{name:digest(Path(__file__).with_name(name).read_text()) for name in ['seat_sculpted_pillow_compile.py','seat_cushion_shell_reference.py','seat_cushion_shell_experiment.py','seat_rounded_reference.py','seat_rounded_source_fit.py','seat_rounded_diagnostic.py']},'views':{}}
    for f in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(f+'.json')).read_text());art=data['sourceArt'];h,w=art['height'],art['width'];q=[ray(art['anchor'],[2,1],f,x+.5,y+.5) for y in range(h) for x in range(w)];origins=np.array([r[0] for r in q]);directions=np.array([r[1] for r in q]);producer=np.full(h*w,-np.inf);reference=producer.copy();owners=np.full(h*w,-1,int);maximum=0.;errors=0
        for part in parts:
            if part['kind']=='triangle-mesh':
                v=np.array(part['vertices']);t=np.array(part['triangles']);a=projected_depth(v,t,art,[2,1],f).ravel();b=ray_depth(v,t,origins,directions)
            else:
                a,_=vector_front({'components':[part]},origins,directions);b=np.array([pair[1] if (pair:=interval(part['bounds'],part['radius'],o,d)) else -np.inf for o,d in q])
            both=np.isfinite(a)&np.isfinite(b);maximum=max(maximum,float(np.max(abs(a[both]-b[both]))) if both.any() else 0);errors+=int((np.isfinite(a)!=np.isfinite(b)).sum())
            producer=np.maximum(producer,a);replace=b>reference;owners[replace]=part['part'];reference=np.maximum(reference,b)
        alpha=np.array(art['rgba']).reshape(h*w,4)[:,3]>0;rows=[]
        for i in range(h*w):rows.append({'x':i%w,'y':i//w,'opaque':bool(alpha[i]),'frontZ':float(producer[i]) if np.isfinite(producer[i]) else None,'referenceFrontZ':float(reference[i]) if np.isfinite(reference[i]) else None,'referencePart':int(owners[i]) if owners[i]>=0 else None})
        report['views'][f]={'beautySha256':digest(art),'depthSha256':digest(rows),'opaque':int(alpha.sum()),'missingOpaque':int((alpha&~np.isfinite(reference)).sum()),'extraAlpha':int((~alpha&np.isfinite(reference)).sum()),'componentHitDisagreements':errors,'maximumRootDifference':maximum};print(f,report['views'][f],flush=True)
        (output/(f+'-identity-depth.json')).write_text(json.dumps(rows))
    (output/'declaration.json').write_text(json.dumps(declaration));(output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','review','out']:p.add_argument('--'+n,required=True)
    p.add_argument('--cushion',default='cushion-shell-v4/shell.json');a=p.parse_args();run(a.inputs,a.review,a.out,a.cushion)
