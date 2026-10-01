"""Frozen geometry versus bare-source alpha and provisional part interiors."""
import argparse
from collections import Counter,deque
import json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import digest,FACINGS


def metrics(inputs,maps,original,geometry,out,key):
    original=json.loads(Path(original).read_text())[key];geometry=Path(geometry)
    declaration=json.loads((geometry/'declaration.json').read_text());data={f:json.loads((Path(inputs)/(f+'.json')).read_text())['sourceArt'] for f in FACINGS}
    results={'status':'SOURCE_DIAGNOSTIC_NOT_APPROVAL','geometrySha256':digest(declaration),'views':{}}
    opposite={'se':'sw','sw':'se','ne':'nw','nw':'ne'}
    for facing,a in data.items():
        w,h=a['width'],a['height'];rgba=np.array(a['rgba']).reshape(h,w,4);alpha=rgba[:,:,3]>0
        source_face=facing;file=Path(maps)/facing/'surface.json';mirrored=False
        if not file.exists():
            source_face=opposite[facing];file=Path(maps)/source_face/'surface.json'
            if data[source_face]['rgba']!=rgba[:,::-1,:].reshape(-1).tolist():raise ValueError('No exact beauty mirror for source-only role transport')
            mirrored=True
        s=json.loads(file.read_text());labels=np.array(s['labels']).reshape(h,w)
        if mirrored:labels=labels[:,::-1]
        roles=np.empty((h,w),dtype=object);roles[:]=None
        for i,p in enumerate(original['parts']):roles[(labels>0)&((labels-1)//3==i)]=p['part']
        confident=roles.copy();padded=np.pad(roles,2,constant_values=None)
        for dy in range(5):
            for dx in range(5):confident[padded[dy:dy+h,dx:dx+w]!=roles]=None
        # Distance to original transparent background including beyond canvas borders.
        distance=np.full((h,w),10**6,dtype=int);queue=deque()
        for y in range(h):
            for x in range(w):
                if not alpha[y,x]:distance[y,x]=0;queue.append((x,y))
                elif x in (0,w-1) or y in (0,h-1):distance[y,x]=1;queue.append((x,y))
        while queue:
            x,y=queue.popleft()
            for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if 0<=nx<w and 0<=ny<h and distance[ny,nx]>distance[y,x]+1:
                    distance[ny,nx]=distance[y,x]+1;queue.append((nx,ny))
        rows=json.loads((geometry/(facing+'-identity-depth.json')).read_text());missing=Counter();conflicts=[];hints=0
        for r in rows:
            x,y=r['x'],r['y']
            if alpha[y,x] and r['referenceFrontZ'] is None:missing[int(distance[y,x])]+=1
            expected=confident[y,x]
            if expected is not None:
                hints+=1;part=r['referencePart'];actual=declaration['components'][part]['role'] if part is not None else None
                if actual!=expected:conflicts.append({'x':x,'y':y,'sourceRoleHint':expected,'geometryRole':actual})
        results['views'][facing]={'sourceMapView':source_face,'exactMirrorVerified':mirrored,'sourceMapSha256':digest(s),
            'provisionalInteriorPixels':hints,'interiorRoleConflictCount':len(conflicts),'interiorRoleConflicts':conflicts,
            'missingByDistanceToOriginalAlphaBoundary':dict(sorted(missing.items()))}
    Path(out).write_text(json.dumps(results,indent=2))
    print(json.dumps({f:{k:v for k,v in r.items() if k!='interiorRoleConflicts'} for f,r in results['views'].items()},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--maps',required=True);p.add_argument('--original',required=True)
    p.add_argument('--geometry',required=True);p.add_argument('--out',required=True);p.add_argument('--key',required=True);a=p.parse_args()
    metrics(a.inputs,a.maps,a.original,a.geometry,a.out,a.key)
