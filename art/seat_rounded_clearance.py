"""Physical shin clearance for isolated rounded drafts; no pixel-winner objective."""
import argparse
import json
import math
from pathlib import Path
from seat_rounded_diagnostic import TILE, ray, project, sdf, declare, digest
from seat_rounded_reference import interval

SHIN_RADIUS=4.1/(4/math.sqrt(3))
THIGH_RADIUS=4.4/(4/math.sqrt(3))


def local_joint(art,size,facing,screen,z):
    origin,direction=ray(art['anchor'],size,facing,*screen)
    return [o+d*z for o,d in zip(origin,direction)]


def capsule_contact(component,A,B,radius):
    """Exact collision via rounded-box Minkowski expansion, independently analytic."""
    expanded=[[a-radius,b+radius] for a,b in component['bounds']]
    direction=[b-a for a,b in zip(A,B)]
    hit=interval(expanded,component['radius']+radius,A,direction)
    collision=hit is not None and max(0,hit[0])<=min(1,hit[1])
    left,right=0.,1.
    distance=lambda t:sdf(component['bounds'],component['radius'],[a+d*t for a,d in zip(A,direction)])-radius
    for _ in range(70):
        m1=left+(right-left)/3;m2=right-(right-left)/3
        if distance(m1)<=distance(m2):right=m2
        else:left=m1
    t=(left+right)/2
    return {'intersects':bool(collision),'minimumSignedGap':distance(t),'closestCenterParameter':t,
            'collisionParameterInterval':[max(0,hit[0]),min(1,hit[1])] if collision else None}


def diagnose(source, original, fitted):
    data=json.loads(Path(source).read_text());c=data['contexts'][0];a=c['anatomy'];art=data['sourceArt'];facing=data['facing']
    specs={'original':declare(original),'fitted':declare(fitted)};legs={};max_error=0.
    for name in ['nearLeg','farLeg']:
        leg=a[name];joints={joint:local_joint(art,fitted['size'],facing,leg[joint],leg[joint+'Height']) for joint in ['hip','knee','ankle']}
        for joint,point in joints.items():
            q=project(art['anchor'],fitted['size'],facing,point[0]/TILE,point[1]/TILE,point[2])
            max_error=max(max_error,math.dist(q,leg[joint]))
        legs[name]={'worldJoints':joints,'localTileJoints':{k:[v[0]/TILE,v[1]/TILE,v[2]] for k,v in joints.items()}}
    result={'status':'DIAGNOSTIC_PHYSICAL_CONSTRAINT_ONLY','context':c['id'],'shinRadius':SHIN_RADIUS,'thighRadius':THIGH_RADIUS,
            'sourceProjectionMaximumError':max_error,'sourceInputSha256':digest(data),'legs':legs,'models':{}}
    for name,declaration in specs.items():
        seats=[p for p in declaration['components'] if p['role']=='seat'];findings=[]
        for side,leg in legs.items():
            A,B=leg['worldJoints']['knee'],leg['worldJoints']['ankle']
            for seat in seats:findings.append({'leg':side,'part':seat['part'],**capsule_contact(seat,A,B,SHIN_RADIUS)})
        result['models'][name]={'shinSeatContacts':findings,'declarationSha256':digest(declaration)}
    # Explore only rigid forward translation of the original skeleton as a physical
    # feasibility report; never change the fit, source body or declared model contacts.
    declaration=specs['fitted'];seat=next(p for p in declaration['components'] if p['role']=='seat')
    def clear(delta):
        for leg in legs.values():
            A=list(leg['worldJoints']['knee']);B=list(leg['worldJoints']['ankle']);A[1]+=delta*TILE;B[1]+=delta*TILE
            if capsule_contact(seat,A,B,SHIN_RADIUS)['intersects']:return False
        return True
    # Front is decreasing local v. Clearance is monotonic for this front-of-seat test.
    lo,hi=-1.,0.
    for _ in range(50):
        mid=(lo+hi)/2
        if clear(mid):lo=mid
        else:hi=mid
    delta=lo-1e-7;support=fitted['sits'][c['context']['cushion']];contact=[support[0],support[1]+delta,support[2]]
    flat=[seat['bounds'][1][0]/TILE+seat['radius']/TILE,seat['bounds'][1][1]/TILE-seat['radius']/TILE]
    result['physicalFeasibilityOnly']={'minimumForwardTranslationTiles':-delta,'hypotheticalContact':contact,
        'flatTopVInterval':flat,'frontFlatMarginTiles':contact[1]-flat[0],'rearFlatMarginTiles':flat[1]-contact[1],
        'screenContactDisplacement': [a-b for a,b in zip(project(art['anchor'],fitted['size'],facing,*contact),project(art['anchor'],fitted['size'],facing,*support))],
        'applied':False,'limitation':'Flat-top support is not a visual test of perching or backrest contact; no new placement was adopted.'}
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--original-model',required=True)
    p.add_argument('--fitted-model',required=True);p.add_argument('--key',required=True);p.add_argument('--out',required=True);a=p.parse_args()
    result=diagnose(a.source,json.loads(Path(a.original_model).read_text())[a.key],json.loads(Path(a.fitted_model).read_text())[a.key])
    Path(a.out).write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
