"""Physical linked cushion/apron front clearance, checked against every solid.

Uses continuous source skeleton contracts, never avatar pixels or winner buffers.
The linked front is a shared family parameter, not a coordinate-specific repair.
"""
import argparse
import copy
from pathlib import Path
from seat_rounded_diagnostic import declare,contacts_problems,digest
from seat_rounded_clearance import local_joint,capsule_contact,SHIN_RADIUS
from seat_rounded_correspondence_diagnostic import run


def safe_geometry(model,views):
    result=copy.deepcopy(model);seats=[p for p in result['parts'] if p['part']=='seat']
    fronts={p['v'][0] for p in seats}
    if len(fronts)!=1:raise ValueError('Single-row linked front convention requires common cushion front')
    original_front=next(iter(fronts))
    linked=[i for i,p in enumerate(result['parts']) if p['part'] in ['seat','base'] and abs(p['v'][0]-original_front)<1e-8]
    segments={};contexts=[]
    for facing,data in views.items():
        for c in data['contexts']:
            contexts.append({'id':c['id'],'anatomySha256':digest(c['anatomy'])})
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side]
                A,B=[local_joint(data['sourceArt'],model['size'],facing,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                key=tuple(round(v,9) for point in [A,B] for v in point)
                segments.setdefault(key,{'context':c['id'],'side':side,'A':A,'B':B})
    def findings(front):
        for i in linked:result['parts'][i]['v'][0]=front
        declaration=declare(result);collisions=[];gap=float('inf')
        for segment in segments.values():
            for component in declaration['components']:
                contact=capsule_contact(component,segment['A'],segment['B'],SHIN_RADIUS)
                gap=min(gap,contact['minimumSignedGap'])
                if contact['intersects']:collisions.append({'context':segment['context'],'side':segment['side'],'part':component['part'],**contact})
        return collisions,gap
    low,high=original_front,min(s[1] for s in model['sits'])-.01
    if findings(high)[0]:raise ValueError('Unlinked solid collision or no support-domain front clearance')
    for _ in range(45):
        mid=(low+high)/2
        if findings(mid)[0]:low=mid
        else:high=mid
    chosen=high+1e-5;collisions,gap=findings(chosen)
    if contacts_problems(declare(result)):raise ValueError('Linked front loses fixed support contact')
    return result,{'basis':'source-skeleton-all-solid-capsule-clearance','radius':SHIN_RADIUS,
        'sourceContexts':contexts,'uniqueShinSegments':len(segments),'linkedFrontParts':linked,'originalFront':original_front,
        'safeFront':chosen,'minimumSignedGap':gap,'remainingCollisions':collisions,'contactsUnchanged':result['sits']==model['sits'],
        'limitation':'Includes the shin endpoint/ankle sphere, not an independent ellipsoidal shoe envelope or cloth volume.'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--fitted',required=True)
    p.add_argument('--inputs',required=True);p.add_argument('--source-maps',required=True);p.add_argument('--out',required=True);p.add_argument('--key',required=True)
    a=p.parse_args();run(a.original,a.fitted,a.inputs,a.source_maps,a.out,a.key,
                        geometry_author=safe_geometry,extra_sources=(Path(__file__).name,))
