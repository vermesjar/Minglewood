"""Isolated source-only rounded-parts experiment; never runtime maps or approval.

Producer intersections minimize a convex signed distance then bisect its roots.
The separate reference module uses piecewise analytical quadratics instead.
No paid calls, renderer masks, proposed winner buffers, or catalog writes.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

TILE = math.sqrt(384)
FACINGS = ('se','sw','ne','nw')
VERSION = 1


def sdf(bounds, radius, point):
    q=[abs(p-(a+b)/2)-((b-a)/2-radius) for (a,b),p in zip(bounds,point)]
    return math.sqrt(sum(max(v,0)**2 for v in q))+min(max(q),0)-radius


def interval(bounds, radius, origin, direction):
    if len(bounds)!=3 or any(len(b)!=2 for b in bounds) or len(origin)!=3 or len(direction)!=3:
        raise ValueError('Three-dimensional bounds and ray required')
    if not any(direction) or not all(math.isfinite(v) for v in [radius,*origin,*direction,*[v for b in bounds for v in b]]):
        raise ValueError('Finite nonzero ray and bounds required')
    if radius<0 or any(b<=a or radius>(b-a)/2+1e-12 for a,b in bounds):
        raise ValueError('Invalid rounded bounds/radius')
    lower,upper=-math.inf,math.inf
    for (a,b),o,d in zip(bounds,origin,direction):
        if not d:
            if not a<=o<=b:return None
        else:
            pair=sorted(((a-o)/d,(b-o)/d))
            lower=max(lower,pair[0]);upper=min(upper,pair[1])
    if lower>upper:return None
    if radius==0:return lower,upper
    value=lambda t:sdf(bounds,radius,[o+d*t for o,d in zip(origin,direction)])
    left,right=lower,upper
    # Convex along a line; unlike fixed-step marching this cannot skip a thin solid.
    for _ in range(72):
        m1=left+(right-left)/3;m2=right-(right-left)/3
        if value(m1)<=value(m2):right=m2
        else:left=m1
    mid=(left+right)/2;minimum=value(mid)
    if minimum>1e-10:return None
    if minimum>0:return mid,mid
    left,right=lower,mid
    for _ in range(55):
        center=(left+right)/2
        if value(center)>0:left=center
        else:right=center
    low=(left+right)/2
    left,right=mid,upper
    for _ in range(55):
        center=(left+right)/2
        if value(center)<=0:left=center
        else:right=center
    return low,(left+right)/2


def ray(anchor, size, facing, px, py):
    a=(px-anchor[0])/32;b=(py-anchor[1])/16
    wx,wy=(a+b)/2,(b-a)/2;W,D=size
    if facing=='se':u,v,du,dv=wy,D-wx,1/16,-1/16
    elif facing=='sw':u,v,du,dv=W-wx,D-wy,-1/16,-1/16
    elif facing=='ne':u,v,du,dv=wx,wy,1/16,1/16
    elif facing=='nw':u,v,du,dv=W-wy,wx,-1/16,1/16
    else:raise ValueError('Unknown facing')
    return (u*TILE,v*TILE,0.),(du*TILE,dv*TILE,1.)


def project(anchor,size,facing,u,v,z):
    W,D=size
    if facing=='se':x,y=D-v,u
    elif facing=='sw':x,y=W-u,D-v
    elif facing=='ne':x,y=u,v
    elif facing=='nw':x,y=v,W-u
    else:raise ValueError('Unknown facing')
    return anchor[0]+32*(x-y),anchor[1]+16*(x+y)-2*z


def declare(model, radius_fraction=.5):
    """One global diagnostic policy: no per-key, per-view, or pixel adjustment."""
    if not 0<=radius_fraction<=1:raise ValueError('Radius fraction must be in [0,1]')
    components=[]
    for i,p in enumerate(model['parts']):
        bounds=[[v*TILE for v in p['u']],[v*TILE for v in p['v']],list(p['z'])]
        radius=radius_fraction*min((b-a)/2 for a,b in bounds) if p['part'] in ('seat','arm','back','wrap') else 0.
        components.append({'part':i,'role':p['part'],'bounds':bounds,'radius':radius})
    return {'version':VERSION,'kind':'rounded-parts-diagnostic','basis':'declared-intent',
            'worldMetric':{'tileLength':TILE,'heightScale':1},'policy':{'radiusFraction':radius_fraction},
            'size':model['size'],'contacts':model['sits'],'components':components}


def contacts_problems(declaration):
    problems=[]
    for index,(u,v,z) in enumerate(declaration['contacts']):
        x,y=u*TILE,v*TILE
        seats=[p for p in declaration['components'] if p['role']=='seat' and abs(p['bounds'][2][1]-z)<1e-9 and
               p['bounds'][0][0]+p['radius']<x<p['bounds'][0][1]-p['radius'] and
               p['bounds'][1][0]+p['radius']<y<p['bounds'][1][1]-p['radius']]
        if not seats:problems.append({'contact':index,'problem':'Contact lacks fixed flat-top support with positive margin'})
        for p in declaration['components']:
            if p['role']=='seat':continue
            hit=interval(p['bounds'],p['radius'],(x,y,0),(0,0,1))
            if hit and hit[1]>z+1e-8:
                problems.append({'contact':index,'part':p['part'],'problem':'Higher component blocks vertical support access'})
    return problems


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def run(model_path, inputs, output, key):
    from seat_rounded_reference import interval as analytic
    model=json.loads(Path(model_path).read_text())[key]
    declaration=declare(model);output=Path(output);output.mkdir(parents=True,exist_ok=True)
    report={'status':'DIAGNOSTIC_ONLY_NOT_APPROVAL','version':VERSION,'key':key,'modelSha256':digest(model),
            'declarationSha256':digest(declaration),'contactProblems':contacts_problems(declaration),'views':{},
            'sourceCodeSha256':{name:digest(Path(__file__).with_name(name).read_text()) for name in
                               ['seat_rounded_diagnostic.py','seat_rounded_reference.py']},
            'limitations':['Identity correspondence only; fixed existing bounds; no source fitting or runtime integration.',
                          'Radius fraction is a global experiment, not source-established or visually approved geometry.',
                          'Silhouette mismatch or reference parity cannot resolve the prior beauty-only uncertainty.']}
    depths={}
    for facing in FACINGS:
        data=json.loads((Path(inputs)/(facing+'.json')).read_text());a=data['sourceArt'];w,h=a['width'],a['height']
        rows=[];opaque=covered=extra=missing=disagree=0;max_error=0.
        for y in range(h):
            for x in range(w):
                op=bool(a['rgba'][(y*w+x)*4+3]);opaque+=op
                origin,direction=ray(a['anchor'],model['size'],facing,x+.5,y+.5)
                ph=[];rh=[]
                for p in declaration['components']:
                    hit=interval(p['bounds'],p['radius'],origin,direction)
                    ref=analytic(p['bounds'],p['radius'],origin,direction)
                    if hit:ph.append((hit[1],p['part']))
                    if ref:rh.append((ref[1],p['part']))
                    if (hit is None)!=(ref is None):disagree+=1
                    elif hit:
                        error=max(abs(hit[j]-ref[j]) for j in (0,1));max_error=max(max_error,error)
                        if error>1e-5:disagree+=1
                front=max(ph,default=(None,None));reference=max(rh,default=(None,None))
                covered+=bool(op and ph);missing+=bool(op and not ph);extra+=bool(not op and ph)
                rows.append({'x':x,'y':y,'opaque':op,'frontZ':front[0],'part':front[1],
                             'referenceFrontZ':reference[0],'referencePart':reference[1]})
        depths[facing]=rows
        report['views'][facing]={'beautySha256':digest(a),'opaque':opaque,'coveredOpaque':covered,'missingOpaque':missing,
                                'extraHitsWithinSourceCanvas':extra,'componentIntersectionDisagreements':disagree,'maximumRootError':max_error,
                                'depthSha256':digest(rows)}
        (output/(facing+'-identity-depth.json')).write_text(json.dumps(rows,allow_nan=False))
        print(facing,report['views'][facing],flush=True)
    (output/'declaration.json').write_text(json.dumps(declaration,indent=2))
    (output/'report.json').write_text(json.dumps(report,indent=2))
    return report,depths


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--model',required=True);parser.add_argument('--inputs',required=True)
    parser.add_argument('--out',required=True);parser.add_argument('--key',required=True);args=parser.parse_args()
    run(args.model,args.inputs,args.out,args.key)
