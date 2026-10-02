"""Independent world-ray triangle reference; no projected raster helper imported."""
import numpy as np


def ray_depth(vertices,triangles,origins,directions):
    origins=np.asarray(origins);directions=np.asarray(directions);front=np.full(len(origins),-np.inf)
    for ids in triangles:
        A,B,C=vertices[ids];edge1=B-A;edge2=C-A
        p=np.cross(directions,edge2);det=p@edge1;valid=np.abs(det)>1e-12
        inverse=np.zeros_like(det);inverse[valid]=1/det[valid]
        delta=origins-A;s=np.sum(delta*p,axis=1)*inverse;q=np.cross(delta,edge1)
        t=np.sum(directions*q,axis=1)*inverse;z=(q@edge2)*inverse
        hit=valid&(s>=-1e-9)&(t>=-1e-9)&(s+t<=1+1e-9)
        front=np.maximum(front,np.where(hit,z,-np.inf))
    return front
