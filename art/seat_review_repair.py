"""Source-only bounded repair planning. Expectations remain immutable and never enter repair prompts."""
import hashlib
import json
import math
from pathlib import Path
import seat_surface_repair

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def figure_context(r):
    f=r['figure']
    return {'feet':r['feet'], 'legs':r.get('legs'), 'height':r['height'], 'figure':{
        'width':f['w'],'height':f['h'],'ax':f['ax'],'ay':f['ay'],
        'rgbaSha256':hashlib.sha256(bytes(f['rgba'])).hexdigest(),
        'ownerSha256':hashlib.sha256(bytes(f['owner'])).hexdigest()}}

def repair_pixels(capture, expectations, key, model):
    records=json.loads(Path(capture).read_text(encoding='utf-8'))
    reviews=[]
    for path in expectations:
        path=Path(path)
        for file in sorted(path.rglob('*.json')) if path.is_dir() else [path]:
            value=json.loads(file.read_text(encoding='utf-8'))
            if isinstance(value,dict) and isinstance(value.get('points'),list):reviews.append(value)
    groups={};uncertain=0;conflicts=0
    for r in records:
        if digest(r['model'])!=digest(model):raise ValueError('Capture does not describe the current exact model and labels; recapture before repair')
        matching=[e for e in reviews if e.get('context',{}).get('key')==key and
                  all(e['context'].get(k)==r.get(k) for k in ['facing','cushion','pose','look'])]
        if len(matching)!=1:raise ValueError('Repair requires exactly one immutable independent review per captured context')
        review=matching[0];ctx=review['context']
        if ctx.get('modelSource')!=r['model'].get('compiler',{}).get('source') or ctx.get('figureContext')!=figure_context(r):
            raise ValueError('Original source, anatomy or placement changed; labels cannot be repaired against stale review')
        if review.get('placementProblems'):raise ValueError('Independent placement concerns require geometry/beauty repair, not surface relabeling')
        f=r['figure'];a=r['art'];ox=math.floor(r['feet'][0]+.5)-f['ax'];oy=math.floor(r['feet'][1]+.5)-f['ay']
        domain={(x,y) for y in range(a['h']) for x in range(a['w']) if a['rgba'][(y*a['w']+x)*4+3] and
                0<=x-ox<f['w'] and 0<=y-oy<f['h'] and f['rgba'][((y-oy)*f['w']+x-ox)*4+3]}
        points={(p['x'],p['y']):p for p in review['points']}
        if set(points)!=domain or len(points)!=len(review['points']):raise ValueError('Independent review has missing, duplicate or extraneous overlap pixels')
        for (x,y),point in points.items():
            expected=point['winner']
            if expected=='uncertain':uncertain+=1;continue
            if expected not in ['avatar','furniture']:raise ValueError('Invalid independent winner')
            actual='avatar' if f['actual'][((y-oy)*f['w']+x-ox)*4+3] else 'furniture'
            if expected==actual:continue
            conflicts+=1;facing=r['facing']
            if facing not in model['surfaces']:
                facing={'se':'sw','sw':'se','ne':'nw','nw':'ne'}[facing]
                if facing not in model['surfaces']:raise ValueError('No physical source map for failed facing')
                x=a['w']-1-x
            groups.setdefault(facing,set()).add((x,y))
    return {'conflicts':conflicts,'uncertain':uncertain,'groups':{f:[list(p) for p in sorted(points,key=lambda p:(p[1],p[0]))] for f,points in groups.items()}}

def repair_round(d, draft, capture, expectations):
    """Propose repaired maps atomically; caller must revalidate and recapture every context."""
    d=Path(d);model=draft['furniture']['seatModel']['model']
    plan=repair_pixels(capture,expectations,draft['key'],model)
    if not plan['groups']:return None
    sources={f:json.loads((d/'stage'/'surface-inputs'/f/'input.json').read_text(encoding='utf-8')) for f in ['se','sw','ne','nw']}
    identity=digest({'sources':sources,'surfaces':model['surfaces'],'coordinates':plan['groups']})
    folder=d/'automatic-surface-repairs'/identity;folder.mkdir(parents=True,exist_ok=True)
    (folder/'coordinate-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
    revised=json.loads(json.dumps(model['surfaces']));uncertainties=[]
    for facing,pixels in plan['groups'].items():
        work=folder/facing;work.mkdir(exist_ok=True)
        original=work/'original.json';original.write_text(json.dumps(model['surfaces'][facing]),encoding='utf-8')
        bounds=[min(p[0] for p in pixels),min(p[1] for p in pixels),max(p[0] for p in pixels)+1,max(p[1] for p in pixels)+1]
        # Only source-only exports and failed coordinates cross this boundary. No winner, figure or mask.
        revised[facing]=seat_surface_repair.repair(d/'stage'/'surface-inputs'/facing/'input.json',original,bounds,work,
            pixels=pixels,context_inputs=[d/'stage'/'surface-inputs'/f/'input.json' for f in sources if f!=facing])
        proposal=json.loads((work/'proposal.json').read_text(encoding='utf-8'))
        uncertainties.extend(proposal.get('uncertainties',[]))
    return {'surfaces':revised,'identity':identity,'artifact':folder.relative_to(d).as_posix(),'uncertainties':uncertainties,
            'changed':revised!=model['surfaces'],'conflicts':plan['conflicts']}
