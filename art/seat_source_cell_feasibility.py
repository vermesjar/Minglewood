"""Convex-cell exact feasibility for source pixel footprints (no shape fit).

Coordinates s=32(u+v), t=32(u-v), h=-2z make alpha columns integer
slabs. Eliminate h by pairing every lower/upper bound, then clip a 2D
polygon. This distinguishes cell coverage from center-ray coverage.
"""
import argparse
import itertools
import json
import math
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import digest


def clip(poly,a,b,c):
    result=[]
    for P,Q in zip(poly,poly[1:]+poly[:1]):
        p=a*P[0]+b*P[1]+c;q=a*Q[0]+b*Q[1]+c
        if p<=1e-10:result.append(P)
        if (p<0<q) or (q<0<p):
            t=p/(p-q);result.append([P[0]+t*(Q[0]-P[0]),P[1]+t*(Q[1]-P[1])])
    return result


def solve_rectangle(bounds,slabs,planes=()):
    s0,s1,t0,t1=bounds
    if s1<=s0 or t1<=t0:return None
    poly=[[s0,t0],[s1,t0],[s1,t1],[s0,t1]]
    for a,b,c in planes:
        poly=clip(poly,a,b,c)
        if len(poly)<3:return None
    # Each slab: h in [low-a*s-b*t, high-a*s-b*t].
    for lo,_,a,b in slabs:
        for _,hi,c,d in slabs:
            poly=clip(poly,c-a,d-b,lo-hi)
            if len(poly)<3:return None
    area=abs(sum(P[0]*Q[1]-P[1]*Q[0] for P,Q in zip(poly,poly[1:]+poly[:1])))/2
    if area<1e-10:return None
    s=sum(p[0] for p in poly)/len(poly);t=sum(p[1] for p in poly)/len(poly)
    low=max(lo-a*s-b*t for lo,hi,a,b in slabs);high=min(hi-a*s-b*t for lo,hi,a,b in slabs)
    if high-low<1e-10:return None
    return {'s':s,'t':t,'hInterval':[low,high]}


def prepare(data):
    specs={};runs={}
    for f,a in data.items():
        x,y=a['anchor']
        # x = offset + sign*axis; y = yoffset + as*s + at*t + h.
        specs[f]={'se':(x+32,-1,0,y+16,0,.5),'nw':(x-64,1,0,y+32,0,-.5),
                  'ne':(x,1,1,y,.5,0),'sw':(x+32,-1,1,y+48,-.5,0)}[f]
        mask=np.array(a['rgba']).reshape(a['height'],a['width'],4)[:,:,3]>0;runs[f]={}
        for xx in range(a['width']):
            ys=np.flatnonzero(mask[:,xx]);r=[]
            for yy in ys:
                if r and r[-1][1]==yy:r[-1]=(r[-1][0],int(yy+1))
                else:r.append((int(yy),int(yy+1)))
            runs[f][xx]=r
    return specs,runs


def feasible(f,x,y,radius,specs,runs,height_intervals=None,boxes=None):
    offset,sign,axis,yo,aa,bb=specs[f];center=sign*(x+.5-offset);lo=center-radius;hi=center+radius
    # All four canvases constrain s,t to these broad integer domains for 2x1.
    for fixed in range(math.floor(lo),math.ceil(hi)):
        for other in range(-128,192):
            sb,tb=(fixed,other) if axis==0 else (other,fixed)
            choices=[]
            for g,(xo,sg,ax,yoff,a,b) in specs.items():
                col=math.floor(xo+sg*((sb if ax==0 else tb)+.5));rr=runs[g].get(col,[])
                if not rr:break
                choices.append([(l-yoff,h-yoff,a,b) for l,h in rr])
            if len(choices)!=4:continue
            bounds=[sb,sb+1,tb,tb+1];bounds[axis*2]=max(bounds[axis*2],lo);bounds[axis*2+1]=min(bounds[axis*2+1],hi)
            own=(y+.5-radius-yo,y+.5+radius-yo,aa,bb)
            for chosen in itertools.product(*choices):
                for zl,zh in (height_intervals or [(-32,64)]):
                    for box in boxes or [None]:
                        planes=[];slabs=[*chosen,own,(-2*zh,-2*zl,0,0)]
                        if box:
                            u0,u1=box['u'];v0,v1=box['v'];z0,z1=box['z']
                            planes=[(-1,-1,64*u0),(1,1,-64*u1),(-1,1,64*v0),(1,-1,-64*v1)]
                            slabs.append((-2*z1,-2*z0,0,0))
                        point=solve_rectangle(bounds,slabs,planes)
                        if point:return point
    return None


def run(inputs,hull,out,role_envelope=None,source_roles=None):
    data={f:json.loads((Path(inputs)/(f+'.json')).read_text())['sourceArt'] for f in ['se','sw','ne','nw']};specs,runs=prepare(data);output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'POSITIVE_VOLUME_PIXEL_CELL_FEASIBILITY_NOT_SURFACE','sourceHashes':{f:digest(a) for f,a in data.items()},'scriptSha256':digest(Path(__file__).read_text()),'views':{}}
    model=next(iter(json.loads(Path(role_envelope).read_text()).values())) if role_envelope else None
    if model:report['provisionalRoleEnvelopeSha256']=digest(model)
    for f in data:
        conflicts=json.loads((Path(hull)/(f+'-conflicts.json')).read_text());rows=[]
        roles={(p['x'],p['y']):p['provisionalRole'] for p in json.loads((Path(source_roles)/(f+'-intervals.json')).read_text())} if model else {}
        for p in conflicts:
            x,y=p['x'],p['y'];boxes=[p for p in model['parts'] if p['part']==roles[(x,y)]] if model else None
            cell=feasible(f,x,y,.5,specs,runs,boxes=boxes);low=0.;high=.5 if cell else 4.;witness=cell or feasible(f,x,y,high,specs,runs,boxes=boxes)
            if witness:
                for _ in range(8):
                    mid=(low+high)/2;q=feasible(f,x,y,mid,specs,runs,boxes=boxes)
                    if q:high=mid;witness=q
                    else:low=mid
            rows.append({'x':x,'y':y,'provisionalRole':roles.get((x,y)),'originalCellFeasible':bool(cell),'minimumLInfinityOffsetBracket':[low,high] if witness else None,'witness':witness})
        (output/(f+'-cells.json')).write_text(json.dumps(rows,indent=2));report['views'][f]={'centerRayConflicts':len(rows),'originalCellFeasible':sum(p['originalCellFeasible'] for p in rows),'requiresBeyondCell':sum(not p['originalCellFeasible'] for p in rows),'maximumWitnessOffset':max(p['minimumLInfinityOffsetBracket'][1] for p in rows if p['witness'])};print(f,report['views'][f],flush=True)
    report['limitations']=['Positive-volume feasibility avoids counting tangent-only contact as coverage.','Per-pixel witnesses do not imply a continuous shared upholstery surface or permissible deformation.','This alpha-only result does not certify post-lift anatomy clearance.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','hull','out']:p.add_argument('--'+n,required=True)
    p.add_argument('--role-envelope');p.add_argument('--source-roles');a=p.parse_args();run(a.inputs,a.hull,a.out,a.role_envelope,a.source_roles)
