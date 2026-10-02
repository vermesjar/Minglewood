"""Editable sculpt export; analytical declaration remains authoritative."""
import argparse,json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import TILE,digest


def rounded_mesh(part,n=16):
 b=np.array(part['bounds']);center=b.mean(axis=1);half=(b[:,1]-b[:,0])/2;r=part['radius'];verts=[];tris=[]
 for axis in range(3):
  others=[i for i in range(3) if i!=axis]
  for sign in [-1,1]:
   offset=len(verts)
   for x in np.linspace(-1,1,n+1):
    for y in np.linspace(-1,1,n+1):
     q=np.zeros(3);q[axis]=sign*half[axis];q[others]=np.array([x,y])*half[others];core=np.clip(q,-half+r,half-r);delta=q-core;p=center+core+delta/np.linalg.norm(delta)*r;verts.append(p)
   for i in range(n):
    for j in range(n):
     a=offset+i*(n+1)+j;c=a+n+2
     for tri in [[a,a+1,c],[a,c,c-1]]:
      A,B,C=[verts[k] for k in tri]
      if np.cross(B-A,C-A)[axis]*sign<0:tri=tri[::-1]
      tris.append(tri)
 return np.array(verts),np.array(tris)


def export(root):
 root=Path(root);decl=json.loads((root/'declaration.json').read_text());lines=['# Coarse sculpt scaffold, not final beauty or approved runtime model','mtllib sculpt.mtl'];offset=1
 for part in decl['components']:
  if part['kind']=='triangle-mesh':v=np.array(part['vertices']);t=np.array(part['triangles'])
  else:v,t=rounded_mesh(part)
  lines+=['o '+part.get('name',part['role']+'_'+str(part['part'])).replace(' ','_'),'usemtl '+part['role']]
  lines+=['v '+' '.join(f'{x:.9f}' for x in p) for p in v];lines+=['f '+' '.join(str(int(x)+offset) for x in tri) for tri in t];offset+=len(v)
 (root/'sculpt.obj').write_text('\n'.join(lines)+'\n');(root/'sculpt.mtl').write_text('\n'.join(f'newmtl {role}\nKd {color}\n' for role,color in [('seat','.42 .47 .13'),('arm','.42 .47 .13'),('back','.42 .47 .13'),('base','.32 .36 .09'),('leg','.38 .19 .07')]))
 contract={'status':'AUTHORING_SCAFFOLD_NOT_APPROVAL','basis':'explicitly-declared-new-intent','worldMetric':{'x':'u*sqrt(384)','y':'v*sqrt(384)','z':'height units'},'size':[2,1],'contacts':decl['contacts'],'contactWorld':[[u*TILE,v*TILE,z] for u,v,z in decl['contacts']],'cameraAuthority':'seat_rounded_diagnostic.ray/project; original per-facing anchors; pixel centers x+.5,y+.5','declarationSha256':digest(decl),'objSha256':digest((root/'sculpt.obj').read_text()),'independentReviewPreserved':'../se-0-0.review.json','limitations':['OBJ rounded surfaces are tessellated approximations; analytical declarations and exact guides remain authoritative until authored mesh is frozen.','Original artwork is style reference, not a depth oracle. Original551 uncertain labels remain unchanged.','Any sculpt changes require fresh independent projection and original-body checks before beauty or runtime acceptance.']}
 (root/'authoring-contract.json').write_text(json.dumps(contract,indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);export(p.parse_args().root)
