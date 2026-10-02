"""Numerical invariants for explicitly authored sprite-to-solid correspondence."""
import numpy as np


def audit_correspondence(x,y,opaque,contact):
    x=np.asarray(x,dtype=float);y=np.asarray(y,dtype=float);opaque=np.asarray(opaque,dtype=bool)
    if x.shape!=y.shape or x.shape!=opaque.shape or x.ndim!=2 or min(x.shape)<2:
        raise ValueError('Correspondence dimensions must match a two-dimensional source mask')
    if not np.isfinite(x).all() or not np.isfinite(y).all():raise ValueError('Correspondence must be finite, including derivative neighbors')
    yy,xx=np.indices(x.shape);dx=np.gradient(x,axis=1);dy=np.gradient(y,axis=0)
    j=np.stack([np.stack([dx,np.gradient(x,axis=0)],axis=-1),np.stack([np.gradient(y,axis=1),dy],axis=-1)],axis=-2)
    singular=np.linalg.svd(j[opaque],compute_uv=False);det=np.linalg.det(j[opaque])
    cx,cy=contact;ix,iy=int(np.floor(cx)),int(np.floor(cy));fx,fy=cx-ix,cy-iy
    if not(0<=ix<x.shape[1]-1 and 0<=iy<x.shape[0]-1):raise ValueError('Authored contact lies outside correspondence grid')
    def interpolate(a):return float(a[iy,ix]*(1-fx)*(1-fy)+a[iy,ix+1]*fx*(1-fy)+a[iy+1,ix]*(1-fx)*fy+a[iy+1,ix+1]*fx*fy)
    target=[interpolate(x),interpolate(y)];error=float(np.linalg.norm(np.array(target)-contact))
    report={'maxDisplacement':float(np.hypot(x-xx,y-yy)[opaque].max()),'minJacobian':float(det.min()),'maxJacobian':float(det.max()),
            'minSingularValue':float(singular.min()),'maxSingularValue':float(singular.max()),'contactSource':list(contact),'discreteContactTarget':target,'discreteContactError':error,
            'boundsPolicy':{'maxSourcePixels':7,'minJacobian':.08,'maxStretch':3,'maxContactPixels':.05},'problems':[]}
    if report['maxDisplacement']>7:report['problems'].append('Source correspondence exceeds seven source pixels')
    if report['minJacobian']<.08:report['problems'].append('Correspondence folds or collapses')
    if report['maxSingularValue']>3:report['problems'].append('Correspondence stretch exceeds threefold')
    if error>.05:report['problems'].append('Discrete contact drift exceeds .05 source pixel')
    return report


def author_correspondence(profile, view):
    """Fit a bounded sprite-view correspondence; leave invalid outputs explicit.

    Uses only source alpha and an already-authored common solid. The returned
    audit must pass before compiling any map. No avatar or mask is accepted.
    """
    from seat_curved_authoring import intersect, sample
    p = profile
    w, h = view['width'], view['height']
    art = np.asarray(view['rgba'], dtype=np.uint8).reshape(h, w, 4)
    opaque = art[:, :, 3] > 0
    if not opaque.any():
        raise ValueError('Cannot author an empty source silhouette')
    facing = view['facing']
    u, v = p.contact_u, p.contact_v
    if facing == 'ne': wx, wy = u, v
    elif facing == 'nw': wx, wy = v, 1-u
    elif facing == 'se': wx, wy = 1-v, u
    elif facing == 'sw': wx, wy = 1-u, 1-v
    else: raise ValueError('Unknown source facing')
    def project_contact(_profile, _facing, anchor):
        return anchor[0]+32*(wx-wy)-.5, anchor[1]+16*(wx+wy)-2*p.seat-.5
    cx,cy=project_contact(p,facing,view['anchor'])
    yy,xx=np.indices((h,w));coords=np.argwhere(opaque);top,bottom=float(coords[:,0].min()),float(coords[:,0].max())
    gy,gx=np.mgrid[-10:h+10,-10:w+10]
    geo=intersect(p,{**view,'sampleX':gx,'sampleY':gy});valid=np.argwhere(np.isfinite(geo))
    target_top=max(top,float(gy[valid[:,0],valid[:,1]].min())+.5);target_bottom=min(bottom,float(gy[valid[:,0],valid[:,1]].max())-.5)
    smooth=lambda t:np.clip(t,0,1)**2*(3-2*np.clip(t,0,1))
    mapped_y=yy.astype(float)
    above=yy<cy
    mapped_y+=np.where(above,(target_top-top)*smooth((cy-yy)/max(.1,cy-top)),(target_bottom-bottom)*smooth((yy-cy)/max(.1,bottom-cy)))
    # Sample the common solid at exactly these mapped rows to find safe
    # interior boundaries. No nearest depth or neighboring pixel is copied.
    scan_x=np.arange(-10,w+10,.2);sx=np.broadcast_to(scan_x,(h,len(scan_x)));sy=np.broadcast_to(mapped_y[:,0,None],sx.shape)
    scanned=intersect(p,{**view,'sampleX':sx,'sampleY':sy},.2)
    mapped_x=xx.astype(float);row_errors=[]
    for y in range(h):
        source_x=np.where(opaque[y])[0]
        if not len(source_x):continue
        target_x=scan_x[np.isfinite(scanned[y])]
        if not len(target_x):row_errors.append(y);continue
        left,right=float(source_x.min())-.5,float(source_x.max())+.5
        tl,tr=max(left,float(target_x.min()+.35)),min(right,float(target_x.max()-.35))
        # If contact column is outside a silhouette row, pin the row's
        # midpoint instead; the actual contact row still pins contact.
        pivot=float(np.clip(cx,left+.1,right-.1)) if right>left else left
        target_pivot=float(np.clip(pivot,tl,tr))
        if right==left:mapped_x[y,:]=target_pivot;continue
        if not (left<cx<right and tl<cx<tr):
            mapped_x[y]=tl+(xx[y]-left)*(tr-tl)/(right-left)
            continue
        # Piecewise affine horizontal mapping stays strictly monotone.
        mapped_x[y]=np.where(xx[y]<=pivot,tl+(xx[y]-left)*(target_pivot-tl)/max(.1,pivot-left),target_pivot+(xx[y]-pivot)*(tr-target_pivot)/max(.1,right-pivot))
    z,normals=sample(p,{**view,'sampleX':mapped_x,'sampleY':mapped_y})
    finite=np.isfinite(z)&opaque;displacement=np.hypot(mapped_x-xx,mapped_y-yy)
    dx=np.gradient(mapped_x,axis=1);dy=np.gradient(mapped_y,axis=0);cross1=np.gradient(mapped_x,axis=0);cross2=np.gradient(mapped_y,axis=1)
    jacobian=dx*dy-cross1*cross2
    # Bounds are explicit diagnostic policy, not approval of a fit.
    audit=audit_correspondence(mapped_x,mapped_y,opaque,(cx,cy))
    failures=audit['problems']
    if row_errors:failures.append('Unmapped source silhouette rows')
    if np.any(opaque&~finite):failures.append('Opaque pixels still have no authored surface')
    return {"depth":z,"referenceNormals":normals,"sourceToCurve":np.stack([mapped_x,mapped_y],axis=-1),"audit":audit}
