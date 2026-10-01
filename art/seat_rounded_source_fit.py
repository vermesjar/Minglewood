"""Isolated source-only symmetric upholstery fit. No body or renderer inputs.

Provisional source part maps supply eroded interior hints, never exact seam truth.
All bounds/radii are generated from role parameters; no asset-key geometry branch.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import TILE, FACINGS, declare, ray, digest, contacts_problems

ROLE={'base':1,'seat':2,'arm':3,'back':4,'leg':5}
PARAMETERS={
    'armOuter':(.10,-.08,.22,.04),'armInner':(.32,.20,.46,.04),
    'armFront':(.00,-.16,.16,.04),'armRear':(.94,.78,1.10,.04),
    'armBottom':(2.,.5,6.,1.),'armTop':(17.,13.,23.,1.),
    'backOuter':(.06,-.08,.22,.04),'backFront':(.78,.62,.90,.04),
    'backRear':(1.0,.91,1.15,.04),'backBottom':(2.,.5,8.,1.),'backTop':(17.,13.,23.,1.),
    'seatFront':(.06,-.10,.24,.04),'seatRear':(.77,.70,.90,.04),'seatBottom':(5.,3.,8.,1.),
    'baseBottom':(2.,.5,4.,.5),
    'legOuter':(.15,.04,.32,.04),'legWidth':(.20,.10,.36,.04),
    'legFront':(.03,-.08,.20,.04),'legRear':(.83,.66,.98,.04),
    'legDepth':(.17,.10,.32,.04),'legTop':(3.,1.,5.,.5)}


def model_from(parameters, original):
    p=parameters;W,D=original['size'];top=original['sits'][0][2]
    if D!=1 or any(abs(s[2]-top)>1e-9 for s in original['sits']):raise ValueError('Uniform single-row support required')
    part=lambda role,u,v,z:dict(part=role,u=u,v=v,z=z)
    parts=[part('base',[p['armInner'],W-p['armInner']],[p['seatFront'],p['backRear']],[p['baseBottom'],p['seatBottom']]),
           part('seat',[p['armInner']-.03,W-p['armInner']+.03],[p['seatFront'],p['seatRear']],[p['seatBottom'],top]),
           part('arm',[p['armOuter'],p['armInner']],[p['armFront'],p['armRear']],[p['armBottom'],p['armTop']]),
           part('arm',[W-p['armInner'],W-p['armOuter']],[p['armFront'],p['armRear']],[p['armBottom'],p['armTop']]),
           part('back',[p['backOuter'],W-p['backOuter']],[p['backFront'],p['backRear']],[p['backBottom'],p['backTop']])]
    for v in [p['legFront'],p['legRear']]:
        for u in [p['legOuter'],W-p['legOuter']-p['legWidth']]:
            parts.append(part('leg',[u,u+p['legWidth']],[v,v+p['legDepth']],[0,p['legTop']]))
    if any(b<=a for q in parts for a,b in [q['u'],q['v'],q['z']]):return None
    return {'size':list(original['size']),'sits':[list(s) for s in original['sits']],'parts':parts}


def vector_front(declaration, origins, directions):
    """Vectorized convex-SDF fitting approximation, verified later by both exact solvers."""
    n=len(origins);front=np.full(n,-np.inf);owner=np.zeros(n,dtype=int)
    for component in declaration['components']:
        bounds=np.array(component['bounds']);r=component['radius'];center=bounds.mean(axis=1);half=(bounds[:,1]-bounds[:,0])/2
        # Isometric rays always have three nonzero components.
        slab=(bounds[None,:,:]-origins[:,:,None])/directions[:,:,None]
        lower=slab.min(axis=2).max(axis=1);upper=slab.max(axis=2).min(axis=1);valid=lower<=upper
        if not valid.any():continue
        if r:
            def distance(t):
                q=np.abs(origins+directions*t[:,None]-center)-(half-r)
                return np.linalg.norm(np.maximum(q,0),axis=1)+np.minimum(q.max(axis=1),0)-r
            left,right=lower.copy(),upper.copy()
            for _ in range(20):
                m1=left+(right-left)/3;m2=right-(right-left)/3;pick=distance(m1)<=distance(m2)
                right=np.where(pick,m2,right);left=np.where(pick,left,m1)
            mid=(left+right)/2;valid &= distance(mid)<=1e-7
            left,right=mid,upper.copy()
            for _ in range(20):
                mid=(left+right)/2;inside=distance(mid)<=0
                left=np.where(inside,mid,left);right=np.where(inside,right,mid)
            hit=(left+right)/2
        else:hit=upper
        change=valid&(hit>front);front[change]=hit[change];owner[change]=ROLE[component['role']]
    return front,owner


def source_targets(inputs, source_maps, model, stride):
    if stride<1:raise ValueError('Positive sampling stride required')
    views=[];receipts={}
    for facing in FACINGS:
        d=json.loads((Path(inputs)/(facing+'.json')).read_text());a=d['sourceArt'];w,h=a['width'],a['height']
        alpha=np.array(a['rgba']).reshape(h,w,4)[:,:,3]>0
        labels=np.zeros((h,w),dtype=int);file=Path(source_maps)/facing/'surface.json'
        if file.exists():
            s=json.loads(file.read_text())
            fingerprint=0x811c9dc5
            for byte in [w,w>>8,h,h>>8,*a['rgba']]:fingerprint=((fingerprint^(byte&255))*16777619)&0xffffffff
            if s.get('width')!=w or s.get('height')!=h or s.get('drawing')!=f'{fingerprint:08x}' or json.loads(s['modelParts'])!=model['parts']:
                raise ValueError('Provisional source topology has stale beauty/part binding')
            raw=np.array(s['labels']).reshape(h,w)
            if np.any((raw>0)!=alpha) or np.any(raw<0) or np.any(raw>len(model['parts'])*3):
                raise ValueError('Provisional topology does not match original alpha/parts')
            for i,p in enumerate(model['parts']):labels[(raw>0)&((raw-1)//3==i)]=ROLE[p['part']]
            # Only interior hints: remove a two-pixel band around all physical-part changes.
            old=labels.copy();padded=np.pad(old,2)
            for dy in range(5):
                for dx in range(5):labels[padded[dy:dy+h,dx:dx+w]!=old]=0
            receipts[facing]={'sourceMapSha256':digest(s),'hintPixels':int((labels>0).sum()),
                             'status':'PROVISIONAL_SOURCE_ONLY_INTERIORS_NOT_VERIFIED_TRUTH'}
        samples=[(x,y) for y in range(0,h,stride) for x in range(0,w,stride)]
        rays=[ray(a['anchor'],model['size'],facing,x+.5,y+.5) for x,y in samples]
        views.append({'facing':facing,'origins':np.array([r[0] for r in rays]),'directions':np.array([r[1] for r in rays]),
                      'alpha':np.array([alpha[y,x] for x,y in samples]),'roles':np.array([labels[y,x] for x,y in samples])})
        receipts.setdefault(facing,{})['beautySha256']=digest(a)
    return views,receipts


def fit(original, views):
    p={name:spec[0] for name,spec in PARAMETERS.items()};cache={};trace=[]
    def loss(parameters):
        key=tuple(parameters.values())
        if key in cache:return cache[key]
        model=model_from(parameters,original)
        if model is None:return 1e6
        declaration=declare(model)
        if contacts_problems(declaration):return 1e6
        score=0.
        for view in views:
            front,roles=vector_front(declaration,view['origins'],view['directions']);hit=np.isfinite(front)
            score+=float(np.mean(hit!=view['alpha']))
            mask=view['roles']>0
            if mask.any():score+=1.5*float(np.mean(roles[mask]!=view['roles'][mask]))
        score/=len(views);cache[key]=score;return score
    score=loss(p);trace.append({'evaluation':0,'loss':score,'parameters':dict(p)})
    for scale in [1.,.5,.25]:
        for sweep in range(2):
            changed=False
            for name,(_,low,high,step) in PARAMETERS.items():
                best,best_score=p,score
                for direction in [-1,1]:
                    value=p[name]+direction*step*scale
                    if not low<=value<=high:continue
                    candidate={**p,name:value};value_score=loss(candidate)
                    if value_score<best_score-1e-9:best,best_score=candidate,value_score
                if best is not p:p,score=best,best_score;changed=True
            trace.append({'evaluation':len(cache),'scale':scale,'sweep':sweep,'loss':score,'parameters':dict(p)})
            print('fit',len(cache),'scale',scale,'loss',score,flush=True)
            if not changed:break
    return model_from(p,original),trace,{'uniqueEvaluations':len(cache),'loss':score,'parameters':p}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--model',required=True);parser.add_argument('--key',required=True)
    parser.add_argument('--inputs',required=True);parser.add_argument('--source-maps',required=True);parser.add_argument('--out',required=True)
    parser.add_argument('--stride',type=int,default=3);args=parser.parse_args()
    original=json.loads(Path(args.model).read_text())[args.key]
    views,receipts=source_targets(args.inputs,args.source_maps,original,args.stride)
    result,trace,stats=fit(original,views);out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    (out/'models.json').write_text(json.dumps({args.key:result},indent=2))
    (out/'fit.json').write_text(json.dumps({'status':'UNREVIEWED_SOURCE_AUTHORED_DIAGNOSTIC','sourceInputs':receipts,
        'originalModelSha256':digest(original),'fitSourceSha256':digest(Path(__file__).read_text()),'stride':args.stride,
        'objective':'bare alpha mismatch plus provisional eroded role interiors; no avatar inputs','stats':stats,'trace':trace},indent=2))
