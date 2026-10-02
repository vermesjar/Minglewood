"""Exact capsule checks for all rounded parts and conservative foot boxes."""
import argparse,json
from pathlib import Path
import numpy as np
from seat_rounded_diagnostic import TILE,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS,capsule_contact
from seat_rounded_reference import interval

def run(root):
 root=Path(root);decl=json.loads((root/'declaration.json').read_text());segments={};hashes={}
 for facing in ['se','sw','ne','nw']:
  data=json.loads((root/'inputs'/f'{facing}.json').read_text());hashes[facing]=digest([c['anatomy'] for c in data['contexts']])
  for c in data['contexts']:
   for side in ['nearLeg','farLeg']:
    leg=c['anatomy'][side];A,B=[local_joint(data['sourceArt'],[2,1],facing,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,8) for q in [A,B] for v in q)]=(A,B)
 rows=[]
 for p in decl['components']:
  if p['kind']=='rounded-cuboid':boxes=[p]
  elif p['kind']=='triangle-mesh':
   v=np.array(p['vertices']);boxes=[{'bounds':np.stack([v.min(axis=0),v.max(axis=0)],axis=1).tolist(),'radius':0}]
  else:raise ValueError('Unknown shape requires explicit physical audit')
  rows.append({'part':p['part'],'name':p.get('name',p['role']),'minimumCapsuleGap':min(capsule_contact(b,A,B,SHIN_RADIUS)['minimumSignedGap'] for b in boxes for A,B in segments.values()),'intersects':any(capsule_contact(b,A,B,SHIN_RADIUS)['intersects'] for b in boxes for A,B in segments.values())})
 contacts=[]
 for u,v,z in decl['contacts']:
  hits=[h[1] for p in decl['components'] if p['role']=='seat' and (h:=interval(p['bounds'],p['radius'],[u*TILE,v*TILE,0],[0,0,1]))]
  contacts.append({'contact':[u,v,z],'actualTop':max(hits),'heightError':max(hits)-z})
 receipt={'status':'PHYSICAL_PROXY_AUDIT_NOT_APPROVAL','declarationSha256':digest(decl),'anatomyHashes':hashes,'shinRadius':SHIN_RADIUS,'uniqueSegments':len(segments),'parts':rows,'supportContacts':contacts,'limitations':['Original shin and ankle capsule proxy only; not a shoe, cloth, thigh, hip, torso, or comfort approval.','Rounded-solid collision checks exact; lathed part AABBs conservative.']}
 (root/'physical-audit.json').write_text(json.dumps(receipt,indent=2));print('minimum gap',min(r['minimumCapsuleGap'] for r in rows),'collisions',sum(r['intersects'] for r in rows),'contacts',contacts)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);run(p.parse_args().root)
