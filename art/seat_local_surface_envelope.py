"""Diagnostic source-owned ray feasibility. Does not select depths or winners.

Subtract exact capsule interiors from component bounding-box ray intervals.
Remaining intervals are necessary local possibilities, not authored surfaces.
"""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import ray,declare,digest
from seat_rounded_reference import interval as box_interval
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def capsule_interval(origin,direction,A,B,radius):
    o=np.asarray(origin,dtype=float);d=np.asarray(direction,dtype=float);a=np.asarray(A,dtype=float);v=np.asarray(B,dtype=float)-a
    vv=float(v@v)
    if vv<=0 or float(d@d)<=0 or radius<=0:raise ValueError('Nondegenerate ray, segment and radius required')
    t0=float((o-a)@v/vv);td=float(d@v/vv)
    cuts=sorted([(k-t0)/td for k in [0,1]]) if abs(td)>1e-14 else []
    cuts=[-math.inf,*cuts,math.inf];hits=[]
    for left,right in zip(cuts,cuts[1:]):
        mid=(left+right)/2 if math.isfinite(left) and math.isfinite(right) else right-1 if math.isfinite(right) else left+1 if math.isfinite(left) else 0
        t=t0+td*mid
        if t<0:q=o-a;w=d
        elif t>1:q=o-a-v;w=d
        else:q=o-a-t0*v;w=d-td*v
        aa=float(w@w);bb=2*float(q@w);cc=float(q@q)-radius*radius
        if aa<1e-24:
            if cc<=0:hits.append((left,right))
            continue
        disc=bb*bb-4*aa*cc
        if disc<0:continue
        root=math.sqrt(max(0,disc));lo=max(left,(-bb-root)/(2*aa));hi=min(right,(-bb+root)/(2*aa))
        if lo<=hi:hits.append((lo,hi))
    return (min(a for a,b in hits),max(b for a,b in hits)) if hits else None


def subtract(intervals,blocked):
    for low,high in blocked:
        new=[]
        for a,b in intervals:
            if high<=a or low>=b:new.append((a,b));continue
            if a<low:new.append((a,low))
            if high<b:new.append((high,b))
        intervals=new
    return intervals


def run(inputs,maps,original,envelope,key,out):
    old=json.loads(Path(original).read_text())[key];model=json.loads(Path(envelope).read_text())[key];components=declare(model)['components']
    output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'LOCAL_POSSIBILITY_NOT_SURFACE_OR_APPROVAL','envelopeSha256':digest(model),'views':{},'scriptSha256':digest(Path(__file__).read_text())}
    for facing in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(facing+'.json')).read_text());art=data['sourceArt'];h,w=art['height'],art['width'];alpha=np.array(art['rgba']).reshape(h,w,4)[:,:,3]>0
        source=facing if facing in ['sw','nw'] else {'se':'sw','ne':'nw'}[facing]
        labels=json.loads((Path(maps)/source/'surface.json').read_text());raw=np.array(labels['labels']).reshape(h,w)
        source_art=json.loads((Path(inputs)/(source+'.json')).read_text())['sourceArt']
        fingerprint=0x811c9dc5
        for byte in [w,w>>8,h,h>>8,*source_art['rgba']]:fingerprint=((fingerprint^(byte&255))*16777619)&0xffffffff
        if labels['drawing']!=f'{fingerprint:08x}' or json.loads(labels['modelParts'])!=old['parts']:raise ValueError('Stale source topology binding')
        if source!=facing:
            other=json.loads((Path(inputs)/(source+'.json')).read_text())['sourceArt']
            if not np.array_equal(np.array(other['rgba']).reshape(h,w,4)[:,::-1],np.array(art['rgba']).reshape(h,w,4)):raise ValueError('Mirror source beauty mismatch')
            raw=raw[:,::-1]
        if np.any((raw>0)!=alpha):raise ValueError('Source ownership/alpha mismatch')
        segments={}
        for context in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=context['anatomy'][side];A,B=[local_joint(art,model['size'],facing,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
        rows=[];counts={'sourceOpaque':int(alpha.sum()),'outsideRoleEnvelope':0,'capsuleExhausted':0,'hasLocalPossibility':0};roles={}
        for y,x in zip(*np.where(alpha)):
            role=old['parts'][(int(raw[y,x])-1)//3]['part'];origin,direction=ray(art['anchor'],model['size'],facing,x+.5,y+.5)
            intervals=[i for p in components if p['role']==role if (i:=box_interval(p['bounds'],0,origin,direction))]
            forbidden=[i for A,B in segments.values() if (i:=capsule_interval(origin,direction,A,B,SHIN_RADIUS))]
            remaining=subtract(intervals,forbidden);reason='outsideRoleEnvelope' if not intervals else 'capsuleExhausted' if not remaining else 'hasLocalPossibility'
            counts[reason]+=1;roles.setdefault(role,{});roles[role][reason]=roles[role].get(reason,0)+1
            rows.append({'x':int(x),'y':int(y),'provisionalRole':role,'status':reason,'possibleHeightIntervals':remaining})
        (output/(facing+'-intervals.json')).write_text(json.dumps(rows))
        report['views'][facing]={'counts':counts,'roles':roles,'beautySha256':digest(art),'sourceTopologySha256':digest(labels),'intervalSha256':digest(rows),'anatomySha256':digest([c['anatomy'] for c in data['contexts']])}
        print(facing,counts,roles,flush=True)
    report['limitations']=['Role ownership is provisional source authoring input, not independently verified truth.','Box envelope feasibility is necessary only: no rounded surface, continuity, normal, support or cross-view depth coherence is established.','Capsules cover shins and ankle endpoints, not shoe or cloth envelopes.','No depths selected; original uncertainties preserved.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','maps','original','envelope','key','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.maps,a.original,a.envelope,a.key,a.out)
