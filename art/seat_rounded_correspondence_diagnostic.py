"""Isolated, contact-pinned monotone source correspondence feasibility experiment.

Geometry clearance uses physical capsules, never pixel winners. Warp selection uses
only bare source alpha and provisional eroded part interiors. No runtime outputs.
"""
import argparse
import copy
import json
import math
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import TILE,FACINGS,declare,ray,project,interval,digest,contacts_problems
from seat_rounded_reference import interval as analytic
from seat_rounded_clearance import local_joint,capsule_contact,SHIN_RADIUS
from seat_rounded_source_fit import source_targets,vector_front


def safe_geometry(model,data):
    """Find the rearward front-face limit that clears the declared shin capsules."""
    result=copy.deepcopy(model);part=next(p for p in result['parts'] if p['part']=='seat');source=data['contexts'][0]
    legs=[]
    for side in ['nearLeg','farLeg']:
        leg=source['anatomy'][side]
        legs.append([local_joint(data['sourceArt'],model['size'],data['facing'],leg[j],leg[j+'Height']) for j in ['knee','ankle']])
    def clear(front):
        part['v'][0]=front;declaration=declare(result);seat=next(p for p in declaration['components'] if p['role']=='seat')
        return not any(capsule_contact(seat,A,B,SHIN_RADIUS)['intersects'] for A,B in legs)
    low,high=part['v'][0],min(s[1] for s in model['sits'])-.01
    if not clear(high):raise ValueError('No shin-safe cushion front within fixed contact domain')
    for _ in range(50):
        mid=(low+high)/2
        if clear(mid):high=mid
        else:low=mid
    chosen=high+1e-5;clear(chosen)
    declaration=declare(result)
    if contacts_problems(declaration):raise ValueError('Safe front loses fixed support')
    seat=next(p for p in declaration['components'] if p['role']=='seat')
    return result,{'basis':'declared-source-anatomy-capsule-clearance','radius':SHIN_RADIUS,
        'sourceAnatomySha256':digest(source['anatomy']),'originalFront':next(p['v'][0] for p in model['parts'] if p['part']=='seat'),
        'safeFront':chosen,'contactsUnchanged':result['sits']==model['sits'],
        'shinGaps':[capsule_contact(seat,A,B,SHIN_RADIUS) for A,B in legs]}


def warp(points,anchor,size,facing,contacts,amplitude,span):
    """Smooth monotone normal compression: globally injective, never row min/max."""
    if not(0<=amplitude<=7) or span<=0 or 1-1.5*amplitude/span<.08:
        raise ValueError('Warp exceeds source displacement/Jacobian limits')
    normal=np.array([1. if facing in ['se','nw'] else -1.,2.])/math.sqrt(5)
    direction=1 if facing in ['se','sw'] else -1
    contact=np.array([project(anchor,size,facing,*s) for s in contacts])-.5
    scalars=contact@normal
    if np.ptp(scalars)>1e-8:raise ValueError('Contacts are not on a shared normal-coordinate line')
    t=direction*(np.asarray(points)@normal-scalars[0]);u=np.clip(t/span,0,1)
    smooth=u*u*(3-2*u)
    return np.asarray(points)-direction*amplitude*smooth[:,None]*normal


def count_topology(mask):
    """Four-connected occupied components and enclosed four-connected empty holes."""
    mask=np.asarray(mask,dtype=bool);h,w=mask.shape
    def components(value):
        seen=set();groups=[]
        for y in range(h):
            for x in range(w):
                if bool(mask[y,x])!=value or (x,y) in seen:continue
                queue=[(x,y)];seen.add((x,y));border=False
                for xx,yy in queue:
                    border |= xx in (0,w-1) or yy in (0,h-1)
                    for nx,ny in [(xx-1,yy),(xx+1,yy),(xx,yy-1),(xx,yy+1)]:
                        if 0<=nx<w and 0<=ny<h and (nx,ny) not in seen and bool(mask[ny,nx])==value:
                            seen.add((nx,ny));queue.append((nx,ny))
                groups.append(border)
        return groups
    return {'components':len(components(True)),'holes':sum(not b for b in components(False))}


def run(original, fitted, inputs, source_maps, output,key,geometry_author=None,extra_sources=()):
    original=json.loads(Path(original).read_text())[key];fitted=json.loads(Path(fitted).read_text())[key]
    data={f:json.loads((Path(inputs)/(f+'.json')).read_text()) for f in FACINGS}
    safe,clearance=geometry_author(fitted,data) if geometry_author else safe_geometry(fitted,data['se']);declaration=declare(safe)
    views,receipts=source_targets(inputs,source_maps,original,3)
    source=[]
    for view in views:
        a=data[view['facing']]['sourceArt'];points=np.array([(x,y) for y in range(0,a['height'],3) for x in range(0,a['width'],3)])
        source.append((view,a,points))
    trials=[]
    for amplitude in [0.,2.,4.,5.,6.,7.]:
        for span in ([20.] if amplitude==0 else [12.,16.,20.,24.,28.,32.]):
            if 1-1.5*amplitude/span<.08:continue
            loss=0.
            for view,a,points in source:
                f=view['facing'];mapped=warp(points,a['anchor'],safe['size'],f,safe['sits'],amplitude,span)
                rays=[ray(a['anchor'],safe['size'],f,x+.5,y+.5) for x,y in mapped]
                z,roles=vector_front(declaration,np.array([q[0] for q in rays]),np.array([q[1] for q in rays]))
                loss+=float(np.mean(np.isfinite(z)!=view['alpha']));hint=view['roles']>0
                if hint.any():loss+=1.5*float(np.mean(roles[hint]!=view['roles'][hint]))
            trials.append({'amplitude':amplitude,'span':span,'loss':loss/4})
    best=min(trials,key=lambda r:r['loss']);out=Path(output);out.mkdir(parents=True,exist_ok=True)
    print('chosen source-only warp',best,flush=True)
    (out/'models.json').write_text(json.dumps({key:safe},indent=2));(out/'declaration.json').write_text(json.dumps(declaration,indent=2))
    report={'status':'DIAGNOSTIC_ONLY_NOT_APPROVAL','declarationSha256':digest(declaration),'modelSha256':digest(safe),
        'clearance':clearance,'contactProblems':contacts_problems(declaration),'sourceInputs':receipts,'warpTrials':trials,
        'warp':{**best,'basis':'explicit-source-projection-intent','minimumAnalyticJacobian':1-1.5*best['amplitude']/best['span'],
                'maxAnalyticStretch':1.,'globalInjectivity':'Strictly monotone normal coordinate; orthogonal coordinate unchanged'},
        'sourceCodeSha256':{n:digest(Path(__file__).with_name(n).read_text()) for n in
            ['seat_rounded_diagnostic.py','seat_rounded_reference.py','seat_rounded_correspondence_diagnostic.py','seat_rounded_clearance.py','seat_rounded_source_fit.py',*extra_sources]},'views':{}}
    for facing in FACINGS:
        a=data[facing]['sourceArt'];w,h=a['width'],a['height'];points=np.array([(x,y) for y in range(h) for x in range(w)])
        mapped=warp(points,a['anchor'],safe['size'],facing,safe['sits'],best['amplitude'],best['span'])
        contacts=np.array([project(a['anchor'],safe['size'],facing,*s) for s in safe['sits']])-.5
        moved=warp(contacts,a['anchor'],safe['size'],facing,safe['sits'],best['amplitude'],best['span'])
        alpha=np.array(a['rgba']).reshape(h,w,4)[:,:,3]>0;rows=[];coverage=np.zeros((h,w),dtype=bool);errors=0;maximum=0.
        for index,(x,y) in enumerate(points):
            origin,direction=ray(a['anchor'],safe['size'],facing,*(mapped[index]+.5));producer=[];reference=[]
            for p in declaration['components']:
                A=interval(p['bounds'],p['radius'],origin,direction);B=analytic(p['bounds'],p['radius'],origin,direction)
                if A:producer.append((A[1],p['part']))
                if B:reference.append((B[1],p['part']))
                if (A is None)!=(B is None):errors+=1
                elif A:
                    error=max(abs(A[j]-B[j]) for j in (0,1));maximum=max(maximum,error);errors+=error>1e-5
            front=max(producer,default=(None,None));ref=max(reference,default=(None,None));coverage[y,x]=bool(reference)
            rows.append({'x':int(x),'y':int(y),'opaque':bool(alpha[y,x]),'frontZ':front[0],'part':front[1],
                         'referenceFrontZ':ref[0],'referencePart':ref[1],'sourceRayCoordinate':mapped[index].tolist()})
        stat={'beautySha256':digest(a),'depthSha256':digest(rows),'opaque':int(alpha.sum()),'coveredOpaque':int((alpha&coverage).sum()),
            'missingOpaque':int((alpha&~coverage).sum()),'extraHitsWithinSourceCanvas':int((~alpha&coverage).sum()),
            'componentIntersectionDisagreements':int(errors),'maximumRootError':maximum,'contactDrift':float(np.max(np.linalg.norm(moved-contacts,axis=1))),
            'sourceAlphaTopology':count_topology(alpha),'mappedSolidAlphaTopology':count_topology(coverage),
            'maxDisplacement':float(np.max(np.linalg.norm(mapped-points,axis=1)))}
        report['views'][facing]=stat
        # Retain reader-compatible artifact name; this is explicitly a warped ray field.
        (out/(facing+'-identity-depth.json')).write_text(json.dumps(rows,allow_nan=False));print(facing,stat,flush=True)
    (out/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--fitted',required=True)
    p.add_argument('--inputs',required=True);p.add_argument('--source-maps',required=True);p.add_argument('--out',required=True);p.add_argument('--key',required=True)
    a=p.parse_args();run(a.original,a.fitted,a.inputs,a.source_maps,a.out,a.key)
