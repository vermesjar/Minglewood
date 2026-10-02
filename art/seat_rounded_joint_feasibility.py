"""Isolated finite-family feasibility screen, never a winner-array fit.

Source silhouette/interior loss ranks ONLY physically eligible samples. Clearance
is tested on the displayed lifted surface, not the pre-correspondence solid.
This finite sampled search is a rejection screen, not a proof of acceptance.
"""
import argparse
import copy
import json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import declare, ray, digest, contacts_problems
from seat_rounded_source_fit import source_targets, vector_front
from seat_rounded_correspondence_diagnostic import warp
from seat_rounded_clearance import local_joint, SHIN_RADIUS


def minimum_capsule_gap(points, segments):
    minimum=float('inf')
    for A,B in segments:
        A=np.asarray(A);delta=np.asarray(B)-A
        t=np.clip((points-A)@delta/(delta@delta),0,1)
        minimum=min(minimum,float(np.min(np.linalg.norm(points-A-t[:,None]*delta,axis=1)-SHIN_RADIUS)))
    return minimum


def run(original,fitted,inputs,maps,key,out):
    original=json.loads(Path(original).read_text())[key];fitted=json.loads(Path(fitted).read_text())[key]
    views,receipts=source_targets(inputs,maps,original,2);prepared=[]
    for view in views:
        f=view['facing'];data=json.loads((Path(inputs)/(f+'.json')).read_text());art=data['sourceArt'];segments={}
        for context in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=context['anatomy'][side]
                A,B=[local_joint(art,fitted['size'],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
        points=np.array([(x,y) for y in range(0,art['height'],2) for x in range(0,art['width'],2)])
        prepared.append((view,art,points,list(segments.values())))
        receipts[f]['continuousAnatomySha256']=digest([c['anatomy'] for c in data['contexts']])
    trials=[]
    for front in [.21,.30,.40,.50]:
        model=copy.deepcopy(fitted)
        for part in model['parts']:
            if part['part'] in ['seat','base']:part['v'][0]=front
        declaration=declare(model);problems=contacts_problems(declaration)
        for amplitude in [0.,2.,4.,6.]:
            row={'front':front,'amplitude':amplitude,'span':20.,'contactProblems':problems,'views':{}}
            loss=0.;gap=float('inf')
            for view,art,points,segments in prepared:
                f=view['facing'];mapped=warp(points,art['anchor'],model['size'],f,model['sits'],amplitude,20.)
                rays=[ray(art['anchor'],model['size'],f,x+.5,y+.5) for x,y in mapped]
                z,roles=vector_front(declaration,np.array([r[0] for r in rays]),np.array([r[1] for r in rays]))
                hit=np.isfinite(z);covered=hit&view['alpha'];hint=view['roles']>0
                loss+=float(np.mean(hit!=view['alpha']))+1.5*float(np.mean(roles[hint]!=view['roles'][hint])) if hint.any() else float(np.mean(hit!=view['alpha']))
                displayed=view['origins'][covered]+view['directions'][covered]*z[covered,None]
                g=minimum_capsule_gap(displayed,segments);gap=min(gap,g)
                row['views'][f]={'minimumSampledGap':g,'missingOpaqueSamples':int((view['alpha']&~hit).sum()),'extraSamples':int((~view['alpha']&hit).sum())}
            row.update(sourceLoss=loss/4,minimumSampledGap=gap,eligibleSampledScreen=not problems and gap>=1e-4)
            trials.append(row);print(front,amplitude,row['sourceLoss'],gap,row['eligibleSampledScreen'],flush=True)
    eligible=[r for r in trials if r['eligibleSampledScreen']]
    result={'status':'FINITE_SAMPLED_DIAGNOSTIC_NOT_APPROVAL','sourceInputs':receipts,'fittedModelSha256':digest(fitted),
            'scriptSha256':digest(Path(__file__).read_text()),'trials':trials,'bestSampledEligible':min(eligible,key=lambda r:r['sourceLoss']) if eligible else None,
            'limitations':['Stride-two surface sampling and approximate producer roots can reject, not certify clearance.',
            'Finite fixed family cannot prove impossibility of other authored geometry or correspondence.',
            'Unresolved original independent source labels remain unchanged; no publication or candidate replacement.',
            'Eligible samples still require independent exact roots, full continuous surface/capsule clearance, full alpha and source-interior coverage, and separate visual review.']}
    Path(out).write_text(json.dumps(result,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['original','fitted','inputs','maps','key','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.original,a.fitted,a.inputs,a.maps,a.key,a.out)
