"""Compare isolated analytical rounded solids to original bodies, never v1 masks."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
from seat_body_reference import body_depths
from seat_rounded_diagnostic import digest, FACINGS


def run(inputs, geometry, output, prior_review=None):
    geometry,output=Path(geometry),Path(output);output.mkdir(parents=True,exist_ok=True)
    report=json.loads((geometry/'report.json').read_text());declaration=json.loads((geometry/'declaration.json').read_text())
    if digest(declaration)!=report['declarationSha256']:raise ValueError('Stale diagnostic declaration')
    for name,expected in report['sourceCodeSha256'].items():
        if digest(Path(__file__).with_name(name).read_text())!=expected:raise ValueError('Stale diagnostic geometry implementation')
    prior={}
    if prior_review:
        rows=json.loads(Path(prior_review).read_text())
        for row in rows:
            ctx=row['context'];prior[(ctx['facing'],ctx['cushion'],json.dumps(ctx['look'],sort_keys=True))]=row
    summary={'status':'DIAGNOSTIC_ONLY_NOT_APPROVAL','geometryDeclarationSha256':digest(declaration),
             'contexts':[],'limitations':['Numerical expectations for a global radius experiment, not current renderer correctness.',
                 'Previous beauty-only judgments remain unchanged; comparisons are diagnostics and never fitting inputs.']}
    for facing in FACINGS:
        data=json.loads((Path(inputs)/(facing+'.json')).read_text());a=data['sourceArt'];w=a['width'];h=a['height']
        if digest(a)!=report['views'][facing]['beautySha256']:raise ValueError('Stale original beauty')
        depth=json.loads((geometry/(facing+'-identity-depth.json')).read_text())
        if digest(depth)!=report['views'][facing]['depthSha256']:raise ValueError('Stale analytical depth artifact')
        for c in data['contexts']:
            body=body_depths(data,c);f=c['figure'];feet=c['context']['figureContext']['feet']
            ox,oy=math.floor(feet[0]+.5)-f['ax'],math.floor(feet[1]+.5)-f['ay'];points=[]
            ctx=c['context'];earlier=prior.get((facing,ctx['cushion'],json.dumps(ctx['look'],sort_keys=True)))
            old={(q['x'],q['y']):q for q in earlier['points']} if earlier else {}
            conflicts=[];role_conflicts=[]
            for fy in range(f['h']):
                for fx in range(f['w']):
                    x,y=fx+ox,fy+oy
                    if not f['rgba'][(fy*f['w']+fx)*4+3] or not(0<=x<w and 0<=y<h) or not a['rgba'][(y*w+x)*4+3]:continue
                    furniture=depth[y*w+x]['referenceFrontZ'];zb=float(body['frontZ'][fy,fx])
                    winner='unresolved' if furniture is None or not math.isfinite(zb) else 'furniture' if furniture>zb else 'avatar'
                    part=depth[y*w+x]['referencePart'];role=declaration['components'][part]['role'] if part is not None else None
                    point={'x':x,'y':y,'winner':winner,'bodyFrontZ':zb if math.isfinite(zb) else None,
                           'surfaceFrontZ':furniture,'part':part,'role':role};points.append(point)
                    q=old.get((x,y))
                    if q and q['winner']!='uncertain' and winner!='unresolved' and winner!=q['winner']:
                        conflicts.append({'x':x,'y':y,'prior':q['winner'],'diagnostic':winner})
                    expected={'support':'seat','near-arm':'arm','far-arm':'arm','back':'back','base-frame':'base'}
                    if q and q['sourceRole'] in expected and role and role!=expected[q['sourceRole']]:
                        role_conflicts.append({'x':x,'y':y,'prior':q['sourceRole'],'diagnostic':role})
            counts=Counter(q['winner'] for q in points)
            result={'context':c['id'],'inputSha256':digest(c),'overlaps':len(points),'winners':dict(counts),
                    'priorIndependentComparison': {'available':bool(earlier),'winnerConflicts':conflicts,'roleConflicts':role_conflicts,
                                                   'priorUncertainPreserved':sum(q['winner']=='uncertain' for q in old.values())}}
            (output/(c['id']+'.json')).write_text(json.dumps({**result,'points':points},allow_nan=False))
            summary['contexts'].append({**result,'priorIndependentComparison':{
                'available':bool(earlier),'winnerConflicts':len(conflicts),'roleConflicts':len(role_conflicts),
                'priorUncertainPreserved':sum(q['winner']=='uncertain' for q in old.values())}})
            print(c['id'],dict(counts),'prior winner conflicts',len(conflicts),flush=True)
    summary['sourceCodeSha256']={name:digest(Path(__file__).with_name(name).read_text()) for name in
        ['seat_rounded_diagnostic.py','seat_rounded_reference.py','seat_rounded_body_diagnostic.py','seat_body_reference.py']}
    (output/'summary.json').write_text(json.dumps(summary,indent=2))
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--geometry',required=True)
    p.add_argument('--out',required=True);p.add_argument('--prior-review');a=p.parse_args()
    run(a.inputs,a.geometry,a.out,a.prior_review)
