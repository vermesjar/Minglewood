"""Intersect original multi-view source hull with continuous anatomy constraints."""
import argparse
import json
from pathlib import Path
from seat_rounded_diagnostic import ray,digest
from seat_local_surface_envelope import capsule_interval,subtract
from seat_rounded_clearance import local_joint,SHIN_RADIUS


def run(inputs,hull,out):
    root=Path(hull);prior=json.loads((root/'report.json').read_text());output=Path(out);output.mkdir(parents=True,exist_ok=True);report={'status':'NECESSARY_CONSTRAINT_DIAGNOSTIC_NOT_APPROVAL','hullReportSha256':digest(prior),'views':{}}
    for facing in ['se','sw','ne','nw']:
        data=json.loads((Path(inputs)/(facing+'.json')).read_text());art=data['sourceArt'];rows=json.loads((root/(facing+'-intervals.json')).read_text())
        if digest(rows)!=prior['views'][facing]['intervalSha256'] or digest(art)!=prior['sourceSha256'][facing]:raise ValueError('Stale source hull')
        segments={}
        for c in data['contexts']:
            for side in ['nearLeg','farLeg']:
                leg=c['anatomy'][side];A,B=[local_joint(art,[2,1],facing,leg[j],leg[j+'Height']) for j in ['knee','ankle']]
                segments[tuple(round(v,9) for p in [A,B] for v in p)]={'A':A,'B':B,'context':c['id'],'side':side}
        result=[];blocked=[]
        for p in rows:
            origin,direction=ray(art['anchor'],[2,1],facing,p['x']+.5,p['y']+.5);possible=p['sharedHeightIntervals'];hits=[]
            for s in segments.values():
                hit=capsule_interval(origin,direction,s['A'],s['B'],SHIN_RADIUS)
                if hit:hits.append(hit)
            remaining=subtract(possible,hits);row={**p,'capsuleClearHeightIntervals':remaining};result.append(row)
            if possible and not remaining:blocked.append({**row,'forbiddenIntervals':hits})
        (output/(facing+'-intervals.json')).write_text(json.dumps(result));(output/(facing+'-physically-blocked.json')).write_text(json.dumps(blocked,indent=2))
        report['views'][facing]={'sourceHullMisses':sum(not p['sharedHeightIntervals'] for p in rows),'capsuleExhaustedHullRays':len(blocked),'remainingPossible':sum(bool(p['capsuleClearHeightIntervals']) for p in result),'anatomySha256':digest([c['anatomy'] for c in data['contexts']])};print(facing,report['views'][facing],flush=True)
    report['limitations']=['Original identity camera/pixel-footprint convention and source shin/ankle capsules only.','No selected furniture depths or inferred winner arrays.','Necessary per-ray screen does not establish a continuous physical surface or approved source role.']
    (output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','hull','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.hull,a.out)
