"""Audit the displayed source surface AFTER correspondence against physical capsules.

Only furniture geometry/ray correspondence and original continuous skeletons enter.
No body pixel alpha, expected winner, rendered mask, or final canvas is read.
"""
import argparse
import json
import math
from pathlib import Path
from seat_rounded_diagnostic import ray,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def segment_gap(point,A,B,radius):
    delta=[b-a for a,b in zip(A,B)];length=sum(v*v for v in delta)
    t=max(0.,min(1.,sum((p-a)*d for p,a,d in zip(point,A,delta))/length))
    return math.dist(point,[a+t*d for a,d in zip(A,delta)])-radius


def audit(inputs,geometry,out):
    geometry=Path(geometry);declaration=json.loads((geometry/'declaration.json').read_text());report=json.loads((geometry/'report.json').read_text())
    result={'status':'DIAGNOSTIC_PHYSICAL_SURFACE_AUDIT','declarationSha256':digest(declaration),'views':{},
        'scope':'Sampled displayed furniture surface versus original shin capsules including ankle endpoints; no winner-array objective.',
        'limitations':['Sampling surface vertices is a necessary check, not proof of full continuous-volume clearance.',
                       'Shoe ellipsoids, cloth volumes and contact aesthetics require additional independent checks.']}
    for facing in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(facing+'.json')).read_text());art=data['sourceArt'];segments={}
        for c in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side]
                A,B=[local_joint(art,declaration['size'],facing,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                key=tuple(round(v,9) for p in [A,B] for v in p)
                segments.setdefault(key,{'context':c['id'],'side':side,'A':A,'B':B})
        rows=json.loads((geometry/(facing+'-identity-depth.json')).read_text())
        if digest(rows)!=report['views'][facing]['depthSha256']:raise ValueError('Stale geometric surface')
        collisions=[];minimum=float('inf');max_shift=0.
        for p in rows:
            if not p['opaque'] or p['referenceFrontZ'] is None:continue
            z=p['referenceFrontZ'];origin,direction=ray(art['anchor'],declaration['size'],facing,p['x']+.5,p['y']+.5)
            displayed=[o+d*z for o,d in zip(origin,direction)]
            q=p.get('sourceRayCoordinate',[p['x'],p['y']]);o,d=ray(art['anchor'],declaration['size'],facing,q[0]+.5,q[1]+.5)
            authored=[a+b*z for a,b in zip(o,d)];max_shift=max(max_shift,math.dist(displayed,authored))
            for segment in segments.values():
                gap=segment_gap(displayed,segment['A'],segment['B'],SHIN_RADIUS);minimum=min(minimum,gap)
                if gap < -1e-7:
                    collisions.append({'x':p['x'],'y':p['y'],'part':p['referencePart'],'context':segment['context'],
                        'side':segment['side'],'gap':gap,'displayedPoint':displayed,'originalSolidPoint':authored})
        result['views'][facing]={'uniqueSegments':len(segments),'minimumSampledSignedGap':minimum,
            'maximumWorldSurfaceDisplacement':max_shift,'penetratingSourcePixels':len({(p['x'],p['y']) for p in collisions}),
            'sampledCollisions':collisions}
    Path(out).write_text(json.dumps(result,indent=2))
    print(json.dumps({f:{k:v for k,v in r.items() if k!='sampledCollisions'} for f,r in result['views'].items()},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--geometry',required=True);p.add_argument('--out',required=True)
    a=p.parse_args();audit(a.inputs,a.geometry,a.out)
