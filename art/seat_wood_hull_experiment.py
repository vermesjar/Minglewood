"""Isolated common-world wood solid from four original source footprints.

No per-view depth cards or body winners. Cubes are retained only if their
centers satisfy all source alphas, at least one provisional wood region,
and their entire bounds clear continuous original shin capsules.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from seat_rounded_diagnostic import TILE,project,digest
from seat_rounded_clearance import local_joint,capsule_contact,SHIN_RADIUS
from seat_cushion_shell_experiment import projected_depth
from seat_cushion_shell_reference import ray_depth


def run(inputs,roles,out):
    views=[];segments={};hashes={}
    for f in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(f+'.json')).read_text());art=data['sourceArt'];rows=json.loads((Path(roles)/(f+'-intervals.json')).read_text());wood=np.zeros((art['height'],art['width']),bool)
        for r in rows:
            if r['provisionalRole']=='leg':wood[r['y'],r['x']]=True
        alpha=np.array(art['rgba']).reshape(art['height'],art['width'],4)[:,:,3]>0;views.append((f,art,alpha,wood));hashes[f]={'art':digest(art),'roles':digest(rows),'anatomy':digest([c['anatomy'] for c in data['contexts']])}
        for c in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
    step=1/32;dz=.5;indices=np.array([(i,j,k) for i in range(72) for j in range(48) for k in range(10)])
    points=np.column_stack([-.125+(indices[:,0]+.5)*step,-.25+(indices[:,1]+.5)*step,(indices[:,2]+.5)*dz]);valid=np.ones(len(points),bool);owned=np.zeros(len(points),bool)
    for f,art,alpha,wood in views:
        pix=np.floor(np.array([project(art['anchor'],[2,1],f,*p) for p in points])).astype(int);x,y=pix.T;inside=(x>=0)&(x<art['width'])&(y>=0)&(y<art['height']);a=np.zeros(len(points),bool);w=a.copy();a[inside]=alpha[y[inside],x[inside]];w[inside]=wood[y[inside],x[inside]];valid&=a;owned|=w
    cells={};rejected=0;minimum=float('inf')
    for idx,p in zip(indices[valid&owned],points[valid&owned]):
        u,v,z=p;box={'bounds':[[(u-step/2)*TILE,(u+step/2)*TILE],[(v-step/2)*TILE,(v+step/2)*TILE],[z-dz/2,z+dz/2]],'radius':0.};clear=True;gap=float('inf')
        for A,B in segments.values():
            hit=capsule_contact(box,A,B,SHIN_RADIUS);gap=min(gap,hit['minimumSignedGap'])
            if hit['intersects']:clear=False;break
        if clear:cells[tuple(idx)]=box;minimum=min(minimum,gap)
        else:rejected+=1
    groups=[];remaining=set(cells)
    while remaining:
        seed=remaining.pop();queue=[seed]
        for p in queue:
            for d in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
                q=tuple(a+b for a,b in zip(p,d))
                if q in remaining:remaining.remove(q);queue.append(q)
        groups.append(queue)
    # Preserve all groups for diagnosis; do not silently erase unsupported fragments.
    vertices=[];triangles=[]
    corners=[(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)]
    faces=[((0,0,-1),[0,3,2,1]),((0,0,1),[4,5,6,7]),((0,-1,0),[0,1,5,4]),((1,0,0),[1,2,6,5]),((0,1,0),[2,3,7,6]),((-1,0,0),[3,0,4,7])]
    for idx,box in cells.items():
        offset=len(vertices);vertices.extend([[box['bounds'][axis][c[axis]] for axis in range(3)] for c in corners])
        for d,quad in faces:
            if tuple(a+b for a,b in zip(idx,d)) in cells:continue
            a,b,c,e=quad;triangles.extend([[offset+a,offset+b,offset+c],[offset+a,offset+c,offset+e]])
    vertices=np.array(vertices);triangles=np.array(triangles);output=Path(out);output.mkdir(parents=True,exist_ok=True)
    report={'status':'ISOLATED_SOURCE_WOOD_SOLID_NOT_APPROVAL','sourceHashes':hashes,'scriptSha256':digest(Path(__file__).read_text()),'grid':[step,step,dz],'keptCells':len(cells),'capsuleRejectedCells':rejected,'minimumWholeCellCapsuleGap':minimum,'componentCellCounts':sorted([len(g) for g in groups],reverse=True),'views':{}}
    for f,art,alpha,wood in views:
        z=projected_depth(vertices,triangles,art,[2,1],f);hit=np.isfinite(z);missing=wood&~hit;extra=hit&~alpha
        report['views'][f]={'woodPixels':int(wood.sum()),'missingWood':int(missing.sum()),'extraAlpha':int(extra.sum())}
        im=Image.frombytes('RGBA',(art['width'],art['height']),bytes(art['rgba']))
        for y,x in zip(*np.where(missing)):im.putpixel((int(x),int(y)),(255,0,160,255))
        for y,x in zip(*np.where(extra)):im.putpixel((int(x),int(y)),(255,190,0,255))
        im.resize((im.width*6,im.height*6),Image.Resampling.NEAREST).save(output/(f+'-coverage.png'))
        (output/(f+'-depth.json')).write_text(json.dumps([[None if not np.isfinite(v) else float(v) for v in row] for row in z]))
    (output/'mesh.json').write_text(json.dumps({'vertices':vertices.tolist(),'triangles':triangles.tolist()}));(output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','roles','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.roles,a.out)
