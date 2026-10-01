"""Shared lathed scroll ends and turned feet: explicit source-author geometry."""
import numpy as np
from seat_rounded_diagnostic import TILE


def lathe(profile,axis,center,segments=48):
    if profile[0][1]!=0 or profile[-1][1]!=0:raise ValueError('Closed profile requires pole endpoints')
    if axis not in (0,1,2) or segments<8 or any(r<0 for _,r in profile):raise ValueError('Invalid lathe')
    radial=[i for i in range(3) if i!=axis];vertices=[];rings=[];triangles=[]
    for height,radius in profile:
        ring=[]
        for theta in ([0.] if radius==0 else np.linspace(0,2*np.pi,segments,endpoint=False)):
            p=np.array(center,dtype=float);p[axis]+=height;p[radial[0]]+=radius*np.cos(theta);p[radial[1]]+=radius*np.sin(theta);ring.append(len(vertices));vertices.append(p)
        rings.append(ring)
    for left,right in zip(rings,rings[1:]):
        if len(left)==len(right)==1:raise ValueError('Consecutive poles')
        for j in range(segments):
            k=(j+1)%segments
            if len(left)==1:triangles.append([left[0],right[j],right[k]])
            elif len(right)==1:triangles.append([left[j],right[0],left[k]])
            else:triangles.extend([[left[j],right[j],right[k]],[left[j],right[k],left[k]]])
    v=np.array(vertices);t=np.array(triangles)
    if np.sum(np.einsum('ij,ij->i',v[t[:,0]],np.cross(v[t[:,1]],v[t[:,2]])))<0:t=t[:,::-1]
    return v,t


def sculpt_meshes(segments=48):
    parts=[]
    profile=[(0,0),(0,.9),(.3,1.25),(.7,1.55),(1.2,1.65),(1.7,1.55),(2.1,1.25),(2.6,1.05),(3.1,1.3),(4.5,1.5),(4.5,0)]
    for u in [.195,1.805]:
        for vv in [.185,.875]:
            v,t=lathe(profile,2,[u*TILE,vv*TILE,0],segments);parts.append(dict(kind='triangle-mesh',role='leg',name=f'turned walnut foot {u} {vv}',vertices=v.tolist(),triangles=t.tolist(),authoringProfile={'axis':2,'profile':profile,'center':[u*TILE,vv*TILE,0]}))
    # Recessed center, rolled lip and circular crown are one closed surface.
    profile=[(.13*TILE,0),(.13*TILE,1.3),(.10*TILE,1.6),(.08*TILE,2.1),(.085*TILE,2.4),(.11*TILE,2.7),(.15*TILE,2.75),(.94*TILE,2.75),(1.*TILE,2.3),(1.01*TILE,0)]
    for u in [.19,1.81]:
        v,t=lathe(profile,1,[u*TILE,0,13.75],segments);parts.append(dict(kind='triangle-mesh',role='arm',name=f'rolled recessed scroll end {u}',vertices=v.tolist(),triangles=t.tolist(),authoringProfile={'axis':1,'profile':profile,'center':[u*TILE,0,13.75]}))
    return parts
