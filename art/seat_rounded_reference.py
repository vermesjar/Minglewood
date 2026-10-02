"""Independent analytical rounded-cuboid diagnostic. No producer import or buffers.

Bounds, origins and directions are in one Euclidean world metric. The ray parameter
is height for isometric callers, but the solver accepts general nonzero rays.
"""
import math


def interval(bounds, radius, origin, direction):
    """Exact piecewise-quadratic distance-to-inner-box intersection interval."""
    if len(bounds)!=3 or any(len(b)!=2 for b in bounds) or len(origin)!=3 or len(direction)!=3:
        raise ValueError('Three-dimensional bounds and ray required')
    if not all(math.isfinite(v) for v in [radius,*origin,*direction,*[v for b in bounds for v in b]]):
        raise ValueError('Finite geometry required')
    if radius < 0 or any(b<=a or b-a < 2*radius-1e-12 for a,b in bounds):
        raise ValueError('Invalid rounded bounds/radius')
    if not any(direction):
        raise ValueError('Nonzero ray required')
    lo, hi = -math.inf, math.inf
    for (a,b), o, d in zip(bounds, origin, direction):
        if d == 0:
            if o < a or o > b: return None
        else:
            t1,t2=(a-o)/d,(b-o)/d
            lo,hi=max(lo,min(t1,t2)),min(hi,max(t1,t2))
    if lo > hi: return None
    if radius == 0: return lo,hi
    inner=[(a+radius,b-radius) for a,b in bounds]
    breaks={lo,hi}
    for (a,b),o,d in zip(inner,origin,direction):
        if d:
            breaks.update(t for t in [(a-o)/d,(b-o)/d] if lo<t<hi)
    breaks=sorted(breaks)
    intervals=[]
    if lo == hi:
        distance=sum(max(a-(o+d*lo),0,o+d*lo-b)**2 for (a,b),o,d in zip(inner,origin,direction))
        return (lo,hi) if distance <= radius*radius+1e-12 else None
    for left,right in zip(breaks,breaks[1:]):
        midpoint=(left+right)/2
        A=B=0.;C=-radius*radius
        for (a,b),o,d in zip(inner,origin,direction):
            value=o+d*midpoint
            if a<=value<=b: continue
            offset=o-(a if value<a else b)
            A+=d*d;B+=2*offset*d;C+=offset*offset
        if A == 0:
            if C<=1e-12: intervals.append((left,right))
            continue
        discriminant=B*B-4*A*C
        # Relative tolerance only covers floating-point cancellation, not art padding.
        tolerance=1e-13*max(1.,B*B,abs(4*A*C))
        if discriminant < -tolerance: continue
        root=math.sqrt(max(0.,discriminant))
        lower,upper=(-B-root)/(2*A),(-B+root)/(2*A)
        lower,upper=max(left,lower),min(right,upper)
        if lower<=upper+1e-11: intervals.append((lower,upper))
    return (min(a for a,b in intervals),max(b for a,b in intervals)) if intervals else None


def union_intervals(components, origin, direction):
    """Retain every separated hit interval; no smooth blending across gaps."""
    intervals=[]
    for part in components:
        hit=interval(part['bounds'],part['radius'],origin,direction)
        if hit: intervals.append(hit)
    merged=[]
    for lo,hi in sorted(intervals):
        if merged and lo<=merged[-1][1]+1e-11:
            merged[-1]=(merged[-1][0],max(merged[-1][1],hi))
        else: merged.append((lo,hi))
    return merged
