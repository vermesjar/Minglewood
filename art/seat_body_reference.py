"""Independent authored-avatar reference for seating review.

Consumes ONLY original unmasked avatar pixels, original anatomy, source drawing
anchor and exact original painter provenance. It never reads a rendered
furniture mask, expected winner, model depth, or final canvas. The conventions
match the explicitly authored body contract; they are not recovered 3D truth.
"""
import math
from functools import lru_cache
import numpy as np

BODY_REFERENCE_VERSION = 15


def authored_discriminant(a,b,c):
    """Preserve positive arithmetic; tolerate coefficient-roundoff at tangency.

    Original sprite geometry has bounded finite coefficients. A tiny negative
    discriminant within the declared binary64 error allowance is a tangent;
    values below it remain misses. This does not expand a geometric radius.
    """
    disc=b*b-4*a*c
    if disc<0:
        allowance=64*np.finfo(float).eps*(abs(b*b)+abs(4*a*c))
        if math.isfinite(allowance) and disc>=-allowance:return 0.
    return disc


def original_equipment_hit(data, context, x, y, owner, shoe_limb=0):
    """Ray intersection with original shoe equipment/cane painter primitives.

    Equipment is considered only for its final source owner and, for shoes,
    the exact painter-selected limb. No furniture or resolved depth is read.
    """
    look=context['context']['look'];a=context['anatomy'];f=context['figure']
    shoe=look.get('shoes');cane=owner==18 and look.get('mobility')=='mob.cane' and not context['context']['pose'].startswith('sit')
    if not cane and not (owner==7 and shoe_limb in [1,2] and shoe in ['shoes.rainboots','shoes.skates']):return None
    anchor=data['sourceArt']['anchor'];tile=math.sqrt(384);scale=4/math.sqrt(3)
    def point(px,py,z):
        aa=(px-anchor[0])/32;bb=(py-anchor[1])/16+z/8
        return np.array([(aa+bb)*tile/2,(bb-aa)*tile/2,z])
    ray=point(x+.5,y+.5,0);direction=np.array([tile/16,tile/16,1.])
    def roots(q,d):
        A=float(d@d);B=float(2*q@d);C=float(q@q-1);disc=authored_discriminant(A,B,C)
        return [] if disc<0 or A<1e-12 else [(-B-math.sqrt(disc))/(2*A),(-B+math.sqrt(disc))/(2*A)]
    def capsule(A,B,r):
        v=B-A;length=float(np.linalg.norm(v))
        if length<1e-12:return roots((ray-A)/r,direction/r)
        axis=v/length;q=ray-A
        values=[t for t in roots((q-axis*(q@axis))/r,(direction-axis*(direction@axis))/r) if 0<=(q+t*direction)@axis<=length]
        return values+roots((ray-A)/r,direction/r)+roots((ray-B)/r,direction/r)
    feet=context['context']['figureContext']['feet'];ox=math.floor(feet[0]+.5)-f['ax'];oy=math.floor(feet[1]+.5)-f['ay']
    mirrored=data['facing'] in ['sw','nw'];sign=-1 if mirrored else 1
    def local(px,py):return (f['w']-(px-ox) if mirrored else px-ox,py-oy)
    def projected(px,py):return (ox+(f['w']-px if mirrored else px),oy+py)
    values=[]
    if cane:
        if 'handNear' not in a or 'standingFeetRow' not in a:raise ValueError('Original cane hand and feet provenance required')
        hx,hy=local(*a['handNear']);last=a['standingFeetRow']-oy-1
        def cane_point(px,py):
            px,py=projected(math.floor(px+.5)+.5,math.floor(py+.5)+.5)
            return point(px,py,a['hipCenterHeight']+(a['hipRow']-py)/2)
        for A,B in [((hx-1,hy),(hx-1,last)),((hx-1,hy-2),(hx+1,hy-2)),((hx+1,hy-2),(hx+1,hy-1))]:
            values+=capsule(cane_point(*A),cane_point(*B),.5/scale)
    else:
        leg=a['nearLeg' if shoe_limb==1 else 'farLeg']
        if 'heel' not in leg:raise ValueError('Original shoe heel provenance required')
        ax,ay=leg['ankle'];z=leg['ankleHeight'];lift=int(leg['heel'])
        if shoe=='shoes.rainboots':
            values+=capsule(point(ax+sign*.5,ay-lift,z),point(ax+sign*.5,ay-lift-7,z+3.5),3.5/scale)
        else:
            lx,ly=local(ax,ay);x0=lx-3-(0 if data['facing'] in ['se','sw'] else 2)
            for dx in [1,4,7]:
                px,py=projected(math.floor(x0+dx+.5)+.5,math.floor(ly-lift+6+.5)+.5)
                center=point(px,py,z-3.25);radii=np.array([.5/scale,.5/scale,.25])
                values+=roots((ray-center)/radii,direction/radii)
    return max(values) if values else None


def original_lower_garment(context):
    """Thin cloth face from original painter vertices, never runtime body depth.

    Points and mask use mirrored, continuous figure-local coordinates. Source
    waist/hip/knee anchors supply world height; a drawing-pixel drop is half a
    world unit. The quarter-unit relief places cloth above its supporting body.
    """
    f=context['figure'];source=f.get('lowerGarment')
    if source is None:return {}
    if source.get('version')!=1:raise ValueError('Original lower-garment provenance v1 required')
    a=context['anatomy'];anchors={
        'hip':a['hipCenterHeight'],
        'waist':a['hipCenterHeight']+(a['hipRow']-a['waistRow']+1)/2,
        'nearKnee':a['nearLeg']['kneeHeight'],
        'farKnee':a['farLeg']['kneeHeight'],
    }
    vertices=[]
    for v in source.get('vertices',[]):
        point=v.get('point',[]);drop=v.get('drop');anchor=v.get('anchor')
        if len(point)!=2 or anchor not in anchors or not all(isinstance(n,(int,float)) and math.isfinite(n) for n in [*point,drop]):
            raise ValueError('Invalid original lower-garment vertex')
        vertices.append([*point,anchors[anchor]-drop/2])
    if len(vertices)<3:raise ValueError('Original lower-garment face needs vertices')
    triangles=[]
    for ids in source.get('triangles',[]):
        if len(ids)!=3 or any(type(i) is not int or not 0<=i<len(vertices) for i in ids) or len(set(ids))!=3:
            raise ValueError('Invalid original lower-garment triangle')
        points=np.asarray([vertices[i] for i in ids],dtype=float)
        matrix=np.vstack([points[:,:2].T,np.ones(3)])
        if abs(np.linalg.det(matrix))<1e-10:raise ValueError('Degenerate original lower-garment triangle')
        triangles.append((np.linalg.inv(matrix),points[:,2]))
    if not triangles:raise ValueError('Original lower-garment face needs triangles')
    mask=np.asarray(source.get('mask',[]))
    if mask.size!=f['h']*f['w'] or not np.isin(mask,[0,1]).all():raise ValueError('Invalid original lower-garment mask')
    mask=mask.reshape(f['h'],f['w']);owners=np.asarray(f['owner']).reshape(mask.shape)
    alpha=np.asarray(f['rgba']).reshape(f['h'],f['w'],4)[:,:,3]
    # The painter records its domain before later torso, shoe and arm overdraw.
    # Only still-visible, opaque leg ownership belongs to this cloth surface.
    mask=(mask!=0)&(owners==6)&(alpha!=0)
    result={}
    for y,x in zip(*np.where(mask)):
        heights=[]
        for inverse,z in triangles:
            weights=inverse@np.array([x+.5,y+.5,1.])
            if np.min(weights)>=-1e-8 and np.max(weights)<=1+1e-8:heights.append(float(weights@z)+.25)
        if not heights:raise ValueError(f'Original lower-garment paint outside authored face at {x},{y}')
        result[(int(x),int(y))]=max(heights)
    return result

def original_limb_envelopes(data,context,x,y,owner,shoe_limb=0):
    """Additional explicitly authored skeletal solids, not a flat hip billboard."""
    a=context['anatomy'];anchor=data['sourceArt']['anchor'];tile=math.sqrt(384);scale=4/math.sqrt(3)
    def point(p,z):
        aa=(p[0]-anchor[0])/32;bb=(p[1]-anchor[1])/16+z/8
        return np.array([(aa+bb)*tile/2,(bb-aa)*tile/2,z])
    origin=point([x+.5,y+.5],0);direction=np.array([tile/16,tile/16,1.])
    def roots(A,B,C):
        disc=authored_discriminant(A,B,C)
        return [] if disc<0 or abs(A)<1e-12 else [(-B-math.sqrt(disc))/(2*A),(-B+math.sqrt(disc))/(2*A)]
    def capsule(A,B,radius):
        delta=B-A;length=np.linalg.norm(delta)
        if length<1e-8:return []
        axis=delta/length;offset=origin-A;rd=direction-axis*np.dot(direction,axis);od=offset-axis*np.dot(offset,axis)
        values=[t for t in roots(np.dot(rd,rd),2*np.dot(rd,od),np.dot(od,od)-radius**2) if 0<=np.dot(offset+t*direction,axis)<=length]
        for end in [A,B]:
            offset=origin-end;values.extend(roots(np.dot(direction,direction),2*np.dot(direction,offset),np.dot(offset,offset)-radius**2))
        return values
    values=[]
    if owner in [6,19]:
        for name in ['nearLeg','farLeg']:
            leg=a[name]
            for start,end,r in [('hip','knee',4.4),('knee','ankle',4.1)]:
                values+=capsule(point(leg[start],leg[start+'Height']),point(leg[end],leg[end+'Height']),r/scale)
    if owner in [4,8,16,19]:
        for name in ['nearArm','farArm']:
            arm=a[name]
            z=lambda p:a['hipCenterHeight']+(a['hipRow']-p[1])/2
            for start,end in [('shoulder','elbow'),('elbow','wrist')]:
                values+=capsule(point(arm[start],z(arm[start])),point(arm[end],z(arm[end])),4.4/scale)
    if owner in [8,19]:
        top=min(p[1] for p in a['torso']);bottom=a['waistRow'];cx=a['hipCenter'][0]
        top_z=a['hipCenterHeight']+(a['hipRow']-top)/2
        lower_z=a['hipCenterHeight']+(a['hipRow']-bottom)/2
        values += [z for z in capsule(point([cx,top+3],top_z-1.5),point([cx,bottom-2],lower_z+1),9.5/scale) if z>=a['hipCenterHeight']-1.5]
    if owner in [7,19]:
        # Low shoe solid: flat sole below the ankle, broad toe inferred from
        # original drawShoes construction. High boots remain unmodeled above it.
        front=data['facing'] in ['se','sw'];mirror=data['facing'] in ['sw','nw']
        toe=(1.5 if front else -.5)*(-1 if mirror else 1)
        for name in ['nearLeg','farLeg']:
            leg=a[name];ankle=leg['ankle'];center=point([ankle[0]+toe,ankle[1]+2.5],leg['ankleHeight']-1.25)
            radii=np.array([5.5/scale,5.5/scale,1.75]);q=(origin-center)/radii;d=direction/radii
            values+=roots(np.dot(d,d),2*np.dot(q,d),np.dot(q,q)-1)
        if owner==7 and shoe_limb:
            # The shoe encloses its own ankle. Original drawShoes provenance
            # selects that ankle even when two projected feet cross; neither
            # nearest-screen distance nor furniture pixels choose it.
            leg=a['nearLeg' if shoe_limb==1 else 'farLeg']
            values+=capsule(point(leg['knee'],leg['kneeHeight']),
                            point(leg['ankle'],leg['ankleHeight']),4.1/scale)
    return max(values) if values else None

def pelvis_hit(data,context,x,y):
    a=context['anatomy'];cx,cy=a['hipCenter'];cx+=.5 if data['facing'] in ['se','ne'] else -.5;z=a['hipCenterHeight']
    # Original kit rounded pelvis projects across the two hip joints. This
    # authored oblate ellipsoid has underside at the source-defined hip contact.
    anchor=data['sourceArt']['anchor'];tile=math.sqrt(384)
    def point(x,y,z):
        aa=(x-anchor[0])/32;bb=(y-anchor[1])/16+z/8
        return np.array([(aa+bb)*tile/2,(bb-aa)*tile/2,z])
    center=point(cx,cy,z);origin=point(x+.5,y+.5,0);direction=np.array([tile/16,tile/16,1.])
    radius=9.5/(4/math.sqrt(3))
    radii=np.array([radius,radius,1.5])
    q=(origin-center)/radii;d=direction/radii
    A=np.dot(d,d);B=2*np.dot(q,d);C=np.dot(q,q)-1;disc=authored_discriminant(A,B,C)
    hits=[] if disc<0 else [float((-B+math.sqrt(disc))/(2*A))]
    # The original pants extend from the round underside to the waist, not
    # just a 3px-high oblate ball at the hip. Join a vertical elliptical waist
    # cylinder to that cap. Its lower end remains exactly at the seated contact.
    top=z+(a['hipRow']-a['waistRow']+1)/2
    q=(origin-center)[:2]/radius;d=direction[:2]/radius
    A=np.dot(d,d);B=2*np.dot(q,d);C=np.dot(q,q)-1;disc=authored_discriminant(A,B,C)
    if disc>=0:
        for t in [(-B-math.sqrt(disc))/(2*A),(-B+math.sqrt(disc))/(2*A)]:
            if z<=t<=top:hits.append(float(t))
    p=origin+direction*top
    if np.dot((p-center)[:2],(p-center)[:2])<=radius*radius:hits.append(top)
    return max(hits) if hits else None



def body_depths(data, context):
    """Return world front heights/methods in original figure pixel order.

    Transparent pixels remain NaN. Any unresolved opaque pixel is counted; a
    caller MUST NOT approve an overlap using such a pixel. Reject historical
    anatomy exports instead of silently changing their coordinate convention.
    """
    if context.get('anatomy',{}).get('version') != 2:
        raise ValueError('Continuous-coordinate anatomy v2 required; re-export original source')
    if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in data['sourceArt']['anchor']):
        raise ValueError('Explicit finite source anchor required')
    c=context;f=c['figure'];facing=data['facing']
    figure=np.asarray(f['rgba'],dtype=np.uint8).reshape(f['h'],f['w'],4)
    owner=np.asarray(f['owner']).reshape(f['h'],f['w'])
    if f.get('sourceMetadataVersion')!=2 or any(k not in f for k in ['sealed','shoeLimb','bodyPocket']):
        raise ValueError('Exact original painter provenance v2 required; re-export original source')
    sealed=np.asarray(f['sealed']).reshape(f['h'],f['w'])
    shoe_limb=np.asarray(f['shoeLimb']).reshape(f['h'],f['w'])
    body_pocket=np.asarray(f['bodyPocket']).reshape(f['h'],f['w'])
    if not np.isin(sealed,[0,1]).all() or np.any(sealed & (figure[:,:,3]==0)):
        raise ValueError('Invalid original sealed-pocket provenance')
    if not np.isin(body_pocket,[0,1]).all() or np.any(body_pocket & (figure[:,:,3]==0)):
        raise ValueError('Invalid original body-pocket provenance')
    if not np.isin(shoe_limb,[0,1,2]).all() or np.any((shoe_limb!=0)&((owner!=7)|(figure[:,:,3]==0))):
        raise ValueError('Invalid original shoe-limb provenance')
    filled=(sealed!=0)|(body_pocket!=0)
    lower_garment=original_lower_garment(c)
    feet=c['context']['figureContext']['feet']
    ox=math.floor(feet[0]+.5)-f['ax'];oy=math.floor(feet[1]+.5)-f['ay']
    @lru_cache(maxsize=None)
    def body_at(fx,fy):
        x=fx+ox;y=fy+oy
        own=int(owner[fy,fx]);body=None;a=c['anatomy'];hx,hy=a['hipCenter']
        # Owner alone is insufficient: leg paint also owns the
        # rounded bottom corners of the original solid pelvis.
        dx=max(abs(x-hx)-7,0);dy=max(y-(a['pelvisBottomRow']-2),a['waistRow']+1-y,0)
        x0=hx-(10 if facing in ['sw','nw'] else 9);x1=hx+(9 if facing in ['sw','nw'] else 10)
        y0=a['waistRow']-1;y1=a['pelvisBottomRow'];px=x+.5;py=y+.5
        dx=max(x0+2-px,0,px-(x1-2));dy=max(y0+2-py,0,py-(y1-2))
        in_hips=x0<=px<x1 and y0<=py<y1 and dx*dx+dy*dy<=4
        adjacent_pelvis=own==19 and any(0<=xx<f['w'] and 0<=yy<f['h'] and owner[yy,xx]==20 for xx,yy in [(fx-1,fy),(fx+1,fy),(fx,fy-1),(fx,fy+1)])
        if own==20 or adjacent_pelvis or (own in [6,19] and in_hips):body=pelvis_hit(data,c,x,y)
        additional=original_limb_envelopes(data,c,x,y,own,int(shoe_limb[fy,fx]))
        if additional is not None:body=additional if body is None else max(body,additional)
        # A raster pixel covers an area, not only its center ray.
        # Test its corners and edge centers against the SAME
        # source anatomical solids; outlines include one extra
        # source pixel of stroke, explicitly authored here.
        if body is None:
            span=1.5 if own==19 else .5
            candidates=[]
            for dx,dy in [(-span,-span),(0,-span),(span,-span),(-span,0),(span,0),(-span,span),(0,span),(span,span)]:
                zc=pelvis_hit(data,c,x+dx,y+dy) if own==20 or adjacent_pelvis or (own in [6,19] and in_hips) else None
                ze=original_limb_envelopes(data,c,x+dx,y+dy,own,int(shoe_limb[fy,fx]))
                candidates.extend(z for z in [zc,ze] if z is not None)
            if candidates:body=max(candidates)
        body_method='analytic-solid-or-pixel-footprint'
        if body is None and own in [7,18]:
            # Equipment fills only unresolved source-owned paint. Existing
            # anatomical/shoe depths remain unchanged wherever already valid.
            center=original_equipment_hit(data,c,x,y,own,int(shoe_limb[fy,fx])) if own==18 else None
            equipment=[] if center is None else [center]
            if center is None:
                for dx in [-.5,0,.5]:
                    for dy in [-.5,0,.5]:
                        hit=original_equipment_hit(data,c,x+dx,y+dy,own,int(shoe_limb[fy,fx]))
                        if hit is not None:equipment.append(hit)
            if equipment:body=max(equipment);body_method='original-equipment-solid'
        if (fx,fy) in lower_garment:
            cloth=lower_garment[(fx,fy)]
            if body is None or cloth>body:
                body=cloth;body_method='original-lower-garment-face'
        # Hair and held items are explicitly authored thin sprite
        # reliefs attached behind/in front of the body. This is
        # layering intent, not recovered volumetric geometry.
        if body is None and own in [3,5,9,10,11,12,13,14,15]:
            body=a['hipCenterHeight']+(a['hipRow']-(y+.5))/2+(-1.5 if own==3 else 1.5)
            body_method='authored-accessory-relief'
        # Clothing can extend beyond its skeletal skin solids.
        # Bind its edge to the same source primitive within a
        # strict two-pixel correspondence, plus pixel footprint.
        if body is None and own in [8,19]:
            candidates=[]
            for dx,dy in [(-2.5,0),(2.5,0),(0,-2.5),(0,2.5),(-1.75,-1.75),(1.75,-1.75),(-1.75,1.75),(1.75,1.75)]:
                ze=original_limb_envelopes(data,c,x+dx,y+dy,own)
                if ze is not None:candidates.append(ze)
            if candidates:body=max(candidates);body_method='bounded-clothing-correspondence'
        if body is None and own==8 and abs(x+.5-hx)<=16 and min(p[1] for p in a['torso'])-2<=y<=a['hipRow']+3:
            body=a['hipCenterHeight']+(a['hipRow']-(y+.5))/2+1.25
            body_method='authored-garment-relief'
        return body,body_method
    @lru_cache(maxsize=None)
    def painted_gradient(x,y):
        # A stroke extends the particular painted surface that generated it.
        # Work only inside the donor's connected original paint, not another
        # leg of the same owner across an outline or transparent gap.
        component={(x,y)};queue=[(x,y)];samples=[];heights=[]
        while queue:
            px,py=queue.pop()
            value,_=body_at(px,py)
            if value is not None:
                samples.append([px-x,py-y,1.]);heights.append(value)
            for nx,ny in [(px-1,py),(px+1,py),(px,py-1),(px,py+1)]:
                if not (0<=nx<f['w'] and 0<=ny<f['h'] and abs(nx-x)<=2 and abs(ny-y)<=2):continue
                if (nx,ny) in component or owner[ny,nx]!=owner[y,x] or not figure[ny,nx,3] or filled[ny,nx]:continue
                component.add((nx,ny));queue.append((nx,ny))
        if filled[y,x] or len(samples)<3:return (0.,0.)
        design=np.asarray(samples);values=np.asarray(heights)
        coefficients,_,rank,_=np.linalg.lstsq(design,values,rcond=None)
        # One source pixel of vertical rise is half a world-height unit.
        # Do not extrapolate an ambiguous depth discontinuity as a flat face.
        if rank<3 or np.max(np.abs(design@coefficients-values))>.5:return (0.,0.)
        return (float(coefficients[0]),float(coefficients[1]))
    source_depth={}
    def stroke_at(fx,fy):
        if (fx,fy) in source_depth:return source_depth[(fx,fy)]
        body,method=body_at(fx,fy)
        if owner[fy,fx]==19:
            values=[] if body is None else [body]
            for nx,ny in [(fx-1,fy),(fx+1,fy),(fx,fy-1),(fx,fy+1)]:
                if 0<=nx<f['w'] and 0<=ny<f['h'] and figure[ny,nx,3] and owner[ny,nx] not in [0,19]:
                    zc,_=body_at(nx,ny)
                    if zc is not None:
                        gx,gy=painted_gradient(nx,ny)
                        values.append(zc+gx*(fx-nx)+gy*(fy-ny))
            if values:body=max(values);method='source-outline-gradient'
        source_depth[(fx,fy)]=(body,method)
        return body,method
    pocket_depth={};seen=set()
    for sy,sx in zip(*np.where(filled)):
        if (sx,sy) in seen:continue
        todo=[(int(sx),int(sy))];cells=[];seen.add((sx,sy))
        while todo:
            x,y=todo.pop();cells.append((x,y))
            for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                nx,ny=q
                if 0<=nx<f['w'] and 0<=ny<f['h'] and filled[ny,nx] and q not in seen:seen.add(q);todo.append(q)
        if len(cells)>20:raise ValueError('Unexpected original filled pocket size')
        index={p:i for i,p in enumerate(cells)};matrix=np.zeros((len(cells),len(cells)));rhs=np.zeros(len(cells))
        for i,(x,y) in enumerate(cells):
            for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                nx,ny=q
                if not (0<=nx<f['w'] and 0<=ny<f['h']):continue
                matrix[i,i]+=1
                if q in index:matrix[i,index[q]]-=1
                else:
                    zc,_=stroke_at(nx,ny)
                    if not figure[ny,nx,3] or zc is None:raise ValueError(f'Unknown original sealed pocket boundary at {nx},{ny}')
                    rhs[i]+=zc
        solution=np.linalg.solve(matrix,rhs)
        pocket_depth.update({p:float(solution[i]) for p,i in index.items()})
    depth=np.full((f['h'],f['w']),np.nan);methods=np.full((f['h'],f['w']),'transparent',dtype=object)
    for y,x in zip(*np.where(figure[:,:,3]>0)):
        z,method=stroke_at(int(x),int(y))
        if (x,y) in pocket_depth:
            z=pocket_depth[(x,y)]
            method='original-body-pocket-harmonic-surface' if body_pocket[y,x] else 'original-sealed-pocket-harmonic-surface'
        if z is not None:depth[y,x]=z
        methods[y,x]=method if z is not None else 'unresolved'
    # An internal original stroke is already opaque and enclosed by the body.
    # Author a continuous local surface across it, rather than selecting an
    # unrelated bone ray that can punch an isolated furniture dot into the body.
    # The domain is original artwork only; it cannot depend on an occlusion mask.
    solid=figure[:,:,3]>0
    internal=np.zeros_like(solid)
    internal[1:-1,1:-1]=(owner[1:-1,1:-1]==19)&solid[:-2,1:-1]&solid[2:,1:-1]&solid[1:-1,:-2]&solid[1:-1,2:]
    visited=set()
    for sy,sx in zip(*np.where(internal)):
        if (sx,sy) in visited:continue
        cells=[];queue=[(int(sx),int(sy))];visited.add((sx,sy))
        while queue:
            x,y=queue.pop();cells.append((x,y))
            for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                nx,ny=q
                if internal[ny,nx] and q not in visited:visited.add(q);queue.append(q)
        if len(cells)>256:raise ValueError('Original internal stroke exceeds the reviewed body contract')
        index={p:i for i,p in enumerate(cells)}
        matrix=np.eye(len(cells))*4;rhs=np.zeros(len(cells))
        for i,(x,y) in enumerate(cells):
            for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                nx,ny=q
                if q in index:matrix[i,index[q]]-=1
                elif math.isfinite(depth[ny,nx]):rhs[i]+=depth[ny,nx]
                else:raise ValueError('Unresolved original internal-stroke boundary')
        solution=np.linalg.solve(matrix,rhs)
        for (x,y),i in index.items():depth[y,x]=solution[i];methods[y,x]='original-internal-stroke-harmonic-surface'
    return {'frontZ':depth,'methods':methods,'unresolved':int(np.count_nonzero((figure[:,:,3]>0)&~np.isfinite(depth))),
            'version':BODY_REFERENCE_VERSION}
