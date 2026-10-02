"""Diagnostic, explicit curved beanbag authorship. Never a recovery-of-truth claim.

Source silhouettes and part topology constrain a shared smooth bowl/rim solid.
No avatar, mask, semantic winner, or per-asset coordinate override enters fitting.
This module intentionally does not publish or modify runtime data.
"""
from dataclasses import dataclass, asdict, replace
import math
import numpy as np


@dataclass(frozen=True)
class Profile:
    cu: float = .5
    cv: float = .5
    ru: float = .55
    rv: float = .58
    seat: float = 10
    rise: float = 6
    posterior: float = .5
    rim: float = .45
    width: float = .18
    contact_u: float = .5
    contact_v: float = .35
    skirt: float = 3.0


def height(profile, u, v):
    """C1 interior, continuous zero-height outer edge; raised posterior is view-independent."""
    a=(u-profile.cu)/profile.ru
    b=(v-profile.cv)/profile.rv
    radius=np.sqrt(a*a+b*b)
    outer=np.sqrt(np.maximum(0, 1-radius*radius))
    # The well is centered at the authored support contact, not at the exterior mound center.
    well_radius=np.sqrt(((u-profile.contact_u)/profile.ru)**2+((v-profile.contact_v)/profile.rv)**2)
    rim=np.exp(-((well_radius-profile.rim)/profile.width)**2)
    posterior=.5+.5*np.tanh(b*3)
    contact_a=(profile.contact_u-profile.cu)/profile.ru
    contact_b=(profile.contact_v-profile.cv)/profile.rv
    contact_r=math.sqrt(contact_a*contact_a+contact_b*contact_b)
    contact_outer=math.sqrt(max(1e-8,1-contact_r*contact_r))
    contact_rim=math.exp(-(profile.rim/profile.width)**2)
    contact_posterior=.5+.5*math.tanh(contact_b*3)
    base=(profile.seat-profile.skirt)/contact_outer-profile.rise*contact_rim*(1-profile.posterior+profile.posterior*contact_posterior)
    return np.where(radius<=1,profile.skirt+outer*(base+profile.rise*rim*(1-profile.posterior+profile.posterior*posterior)),0)


def rays(view):
    if 'sampleX' in view:
        x=np.asarray(view['sampleX']);y=np.asarray(view['sampleY'])
    else:y,x=np.indices((view['height'],view['width']))
    a=(x+.5-view['anchor'][0])/32
    b=(y+.5-view['anchor'][1])/16
    wx=(a+b)/2;wy=(b-a)/2
    f=view['facing']
    if f=='ne':return wx,wy,1/16,1/16
    if f=='nw':return 1-wy,wx,-1/16,1/16
    if f=='se':return wy,1-wx,1/16,-1/16
    if f=='sw':return 1-wx,1-wy,-1/16,-1/16
    raise ValueError(f)


def intersect(profile, view, step=.4):
    u0,v0,du,dv=rays(view)
    depth=np.full(u0.shape,np.nan)
    for z in np.arange(profile.seat+profile.rise+step, -step/2, -step):
        u=u0+du*z;v=v0+dv*z
        inside=((u-profile.cu)/profile.ru)**2+((v-profile.cv)/profile.rv)**2<=1
        hit=np.isnan(depth)&inside&(z<=height(profile,u,v))&(z>=0)
        depth[hit]=z
    # Recover the actual front crossing rather than quantized march levels.
    valid=np.isfinite(depth)
    low=np.where(valid,depth,0);high=low+step
    for _ in range(12):
        z=(low+high)/2;u=u0+du*z;v=v0+dv*z
        inside=((u-profile.cu)/profile.ru)**2+((v-profile.cv)/profile.rv)**2<=1
        hit=inside&(z<=height(profile,u,v))
        low=np.where(hit,z,low);high=np.where(hit,high,z)
    return np.where(valid,(low+high)/2,np.nan)


def fit(initial, views):
    """Same deterministic silhouette-only coordinate search for every color/profile."""
    masks=[np.array(v['rgba'],dtype=np.uint8).reshape(v['height'],v['width'],4)[:,:,3]>0 for v in views]
    def loss(p):
        total=0
        for v,mask in zip(views,masks):
            depth=intersect(p,v,step=.7);predicted=np.isfinite(depth)
            total+=np.count_nonzero(predicted!=mask)/np.count_nonzero(mask|predicted)
            # Source semantic top faces locate the well and rolled crest without
            # supplying a height or reading any avatar/winner. Other face classes
            # do not constrain cap height (the same part also contains its skirt).
            if 'crestTop' in v:
                u0,v0,du,dv=rays(v)
                radius=np.sqrt(((u0+du*depth-p.contact_u)/p.ru)**2+((v0+dv*depth-p.contact_v)/p.rv)**2)
                cap=np.array(v['crestTop']).reshape(depth.shape)&predicted
                well=np.array(v['wellTop']).reshape(depth.shape)&predicted
                if cap.any():total+=.35*float(np.mean(np.minimum(1,((radius[cap]-p.rim)/p.width)**2)))
                if well.any():total+=.2*float(np.mean(np.maximum(0,radius[well]-p.rim*.6)))
        return total/len(views)
    best=initial;score=loss(best)
    for scale in (1,.5,.25):
        # Keep bilateral symmetry and exact contact height; silhouette cannot move a sitter.
        for name,step in [('cv',.035),('ru',.045),('rv',.045),('rise',1),('rim',.06),('width',.025),('skirt',.75)]:
            for sign in (-1,1):
                value=getattr(best,name)+sign*step*scale
                if value<=0:continue
                candidate=replace(best,**{name:value});score2=loss(candidate)
                if score2<score:best,score=candidate,score2
    return best,score


def sample(profile,view):
    depth=intersect(profile,view,.1)
    u0,v0,du,dv=rays(view);u=u0+du*depth;v=v0+dv*depth
    epsilon=1e-4
    # World metric: one tile=sqrt(384) vertical-pixel units.
    nx=-(height(profile,u+epsilon,v)-height(profile,u-epsilon,v))/(2*epsilon*math.sqrt(384))
    ny=-(height(profile,u,v+epsilon)-height(profile,u,v-epsilon))/(2*epsilon*math.sqrt(384))
    length=np.sqrt(nx*nx+ny*ny+1)
    normals=np.stack([nx/length,ny/length,1/length],axis=-1)
    radial=((u-profile.cu)/profile.ru)**2+((v-profile.cv)/profile.rv)**2
    side=(radial>.9999)&(depth<profile.skirt+.01)
    side_x=(u-profile.cu)/profile.ru**2;side_y=(v-profile.cv)/profile.rv**2
    side_length=np.sqrt(side_x*side_x+side_y*side_y)
    normals[side]=np.stack([side_x[side]/side_length[side],side_y[side]/side_length[side],np.zeros(side.sum())],axis=-1)
    return depth,normals


def serializable(profile):
    return asdict(profile)
