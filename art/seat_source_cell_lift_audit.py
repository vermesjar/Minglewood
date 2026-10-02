"""Check local alpha witnesses on both authored and displayed world locations."""
import argparse
import json
from pathlib import Path
from seat_rounded_diagnostic import ray,TILE,digest
from seat_rounded_clearance import local_joint,SHIN_RADIUS
from seat_local_surface_envelope import capsule_interval,subtract


def run(inputs,cells,out):
    output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'LOCAL_WITNESS_PHYSICAL_AUDIT_NOT_CONTINUOUS_SURFACE','views':{}}
    for f in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(f+'.json')).read_text());art=data['sourceArt'];rows=json.loads((Path(cells)/(f+'-cells.json')).read_text());segments={};result=[]
        for c in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],f,leg[j],leg[j+'Height']) for j in ['knee','ankle']];segments[tuple(round(v,9) for p in [A,B] for v in p)]=(A,B)
        for p in rows:
            witness=p['witness']
            if not witness:result.append({**p,'bothClearHeightIntervals':[]});continue
            o,d=ray(art['anchor'],[2,1],f,p['x']+.5,p['y']+.5);s,t=witness['s'],witness['t'];q=((s+t)/64*TILE,(s-t)/64*TILE,0);h0,h1=witness['hInterval'];possible=[(-h1/2,-h0/2)];blocked=[]
            for A,B in segments.values():
                for origin,direction in [(o,d),(q,(0,0,1))]:
                    hit=capsule_interval(origin,direction,A,B,SHIN_RADIUS)
                    if hit:blocked.append(hit)
            result.append({**p,'bothClearHeightIntervals':subtract(possible,blocked)})
        (output/(f+'-audited.json')).write_text(json.dumps(result,indent=2));report['views'][f]={'witnesses':len(result),'withBothOriginalAndLiftedClearance':sum(bool(p['bothClearHeightIntervals']) for p in result),'noClearHeightAtThisWitness':sum(not p['bothClearHeightIntervals'] for p in result),'cellsSha256':digest(rows),'anatomySha256':digest([c['anatomy'] for c in data['contexts']])};print(f,report['views'][f],flush=True)
    report['limitations']=['Existence of an interval is not a chosen depth or continuous surface.','Only shin/ankle capsule geometry, no shoe, cloth or contact proof.','No global continuity, folds, source ownership or connected-component preservation established.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','cells','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.cells,a.out)
