"""Tied tapered feet, source-only fit with exact conservative capsule gate."""
import argparse
import json
from pathlib import Path
import numpy as np
from seat_cushion_shell_experiment import projected_depth
from seat_rounded_diagnostic import TILE,digest
from seat_rounded_clearance import local_joint,capsule_contact,SHIN_RADIUS

PARAMS={'inset':(.08,-.08,.28,.04),'width':(.32,.12,.48,.04),'front':(.08,-.2,.3,.04),
        'rear':(.79,.65,1.,.04),'depth':(.19,.1,.4,.04),'height':(3.,3.,5.,.5),'taper':(.8,.5,1.2,.1)}


def feet(p):
    vertices=[];triangles=[];boxes=[]
    for u in [p['inset'],2-p['inset']-p['width']]:
        for v in [p['front'],p['rear']]:
            offset=len(vertices);cx=u+p['width']/2;cy=v+p['depth']/2
            for z,scale in [(0,p['taper']),(p['height'],1.)]:
                vertices.extend([[(cx+dx*p['width']*scale/2)*TILE,(cy+dy*p['depth']*scale/2)*TILE,z] for dx,dy in [(-1,-1),(1,-1),(1,1),(-1,1)]])
            for quad in [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]:
                a,b,c,d=quad;triangles.extend([[offset+a,offset+b,offset+c],[offset+a,offset+c,offset+d]])
            subset=np.array(vertices[offset:]);boxes.append({'bounds':np.stack([subset.min(axis=0),subset.max(axis=0)],axis=1).tolist(),'radius':0})
    return np.array(vertices),np.array(triangles),boxes


def run(inputs,roles,out):
    views=[];segments={};hashes={}
    for f in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(f+'.json')).read_text());art=data['sourceArt'];rows=json.loads((Path(roles)/(f+'-intervals.json')).read_text());mask=np.zeros((art['height'],art['width']),bool)
        for r in rows:
            if r['provisionalRole']=='leg':mask[r['y'],r['x']]=True
        alpha=np.array(art['rgba']).reshape(art['height'],art['width'],4)[:,:,3]>0;views.append((f,art,mask,alpha));hashes[f]={'beauty':digest(art),'roles':digest(rows),'anatomy':digest([c['anatomy'] for c in data['contexts']])}
        for c in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,9) for point in [A,B] for v in point)]=(A,B)
    trials=[];cache={}
    def evaluate(p):
        key=tuple(p.values())
        if key in cache:return cache[key]
        v,t,boxes=feet(p);gap=float('inf')
        for box in boxes:
            for A,B in segments.values():
                check=capsule_contact(box,A,B,SHIN_RADIUS);gap=min(gap,check['minimumSignedGap'])
                if check['intersects']:cache[key]=(1e6,None);return cache[key]
        stats={};loss=0
        for f,art,mask,alpha in views:
            hit=np.isfinite(projected_depth(v,t,art,[2,1],f));missing=int((mask&~hit).sum());extra=int((~alpha&hit).sum());loss+=missing+extra
            stats[f]={'rolePixels':int(mask.sum()),'missing':missing,'outsideAlpha':extra}
        row={'parameters':dict(p),'sourceLoss':loss,'minimumConservativeCapsuleGap':gap,'views':stats};trials.append(row);cache[key]=(loss,row);return cache[key]
    p={k:v[0] for k,v in PARAMS.items()};score,row=evaluate(p)
    for scale in [1.,.5,.25]:
        for _ in range(2):
            for name,(_,low,high,step) in PARAMS.items():
                best=p;bestscore=score
                for sign in [-1,1]:
                    candidate={**p,name:p[name]+sign*step*scale}
                    if not low<=candidate[name]<=high:continue
                    s,r=evaluate(candidate)
                    if s<bestscore:best,bestscore=candidate,s
                p,score=best,bestscore
        print('scale',scale,'score',score,p,flush=True)
    score,best=evaluate(p);output=Path(out);output.mkdir(parents=True,exist_ok=True);v,t,boxes=feet(p)
    (output/'feet.json').write_text(json.dumps({'vertices':v.tolist(),'triangles':t.tolist(),'parameters':p}))
    (output/'report.json').write_text(json.dumps({'status':'ISOLATED_SAME_ROLE_FOOT_GEOMETRY_NOT_APPROVAL','sourceHashes':hashes,'scriptSha256':digest(Path(__file__).read_text()),'best':best,'trials':trials,'limitations':['Source leg ownership provisional; fit uses identical front/rear foot shape and mirrored placements.','AABB capsule clearance is conservative; shoe and cloth not included.','Cushion and arm coverage remain separate unresolved tasks.']},indent=2))
    print(json.dumps(best,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','roles','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.roles,a.out)
