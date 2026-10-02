"""Independent AI seat review. Only beauty and original unmasked anatomy enter the prompt.

A complete response is a judgment, not proof of correctness. Exact runtime verification
is separate; uncertainty and bad placement block publication rather than being guessed away.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import time
from pathlib import Path
from PIL import Image, ImageDraw
import studio
from seat_surfaces import annotated_source, image_url, inside, MODEL, INPUT_USD, OUTPUT_USD

VERSION = 7

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def schema():
    point = {'type':'array','items':{'type':'number'},'minItems':2,'maxItems':2}
    region = {'type':'object','additionalProperties':False,'properties':{
        'winner':{'type':'string','enum':['avatar','furniture','uncertain']},
        'boundary':{'type':'array','items':point,'minItems':3}, 'reason':{'type':'string'}},
        'required':['winner','boundary','reason']}
    role = {'type':'string','enum':['support','back','near-arm','far-arm','base-frame','other','uncertain']}
    region['properties']['sourceRole']=role
    region['required'].append('sourceRole')
    pixel = {'type':'object','additionalProperties':False,'properties':{'x':{'type':'integer'},'y':{'type':'integer'},'winner':{'type':'string','enum':['avatar','furniture','uncertain']},'reason':{'type':'string'}},'required':['x','y','winner','reason']}
    pixel['properties']['sourceRole']=role
    pixel['required'].append('sourceRole')
    strings = {'type':'array','items':{'type':'string'}}
    context = {'type':'object','additionalProperties':False,'properties':{
        'id':{'type':'string'},'pixels':{'type':'array','items':pixel},'regions':{'type':'array','items':region},
        'uncertainties':strings,'placementProblems':strings,
        'intentionalBoundaryPixels':{'type':'array','items':{'type':'array','items':{'type':'integer'},'minItems':2,'maxItems':2}}},
        'required':['id','regions','pixels','uncertainties','placementProblems','intentionalBoundaryPixels']}
    return {'type':'object','additionalProperties':False,'properties':{'contexts':{'type':'array','items':context}},'required':['contexts']}

def domain(data, context):
    a, f = data['sourceArt'], context['figure']
    feet = context['context']['figureContext']['feet']
    ox, oy = math.floor(feet[0]+.5)-f['ax'], math.floor(feet[1]+.5)-f['ay']
    result = []
    for y in range(f['h']):
        for x in range(f['w']):
            X,Y=x+ox,y+oy
            if f['rgba'][(y*f['w']+x)*4+3] and 0<=X<a['width'] and 0<=Y<a['height'] and a['rgba'][(Y*a['width']+X)*4+3]:
                result.append((X,Y))
    if 'reviewPixels' in context:
        requested={tuple(p) for p in context['reviewPixels']}
        if not requested.issubset(set(result)):raise ValueError('Refinement requested pixels outside original overlap')
        return [p for p in result if p in requested]
    return result

def rasterize(data, proposal, provenance):
    rows = proposal.get('contexts', [])
    by_id = {r['id']:r for r in rows}
    if len(rows)!=len(by_id) or set(by_id)!={c['id'] for c in data['contexts']}:
        raise ValueError('Independent review must contain every context exactly once')
    reviews = []
    for c in data['contexts']:
        p=by_id[c['id']]; points=[]
        for r in p['regions']:
            if r.get('sourceRole') not in ['support','back','near-arm','far-arm','base-frame','other','uncertain'] or r['winner'] not in ['avatar','furniture','uncertain'] or len(r['boundary'])<3 or any(len(v)!=2 or any(not isinstance(n,(int,float)) or not math.isfinite(n) for n in v) for v in r['boundary']):
                raise ValueError('Invalid independent polygon')
        overrides={}
        overlap=set(domain(data,c))
        for pixel in p.get('pixels',[]):
            loc=(pixel['x'],pixel['y'])
            if pixel.get('sourceRole') not in ['support','back','near-arm','far-arm','base-frame','other','uncertain'] or loc not in overlap or loc in overrides or pixel['winner'] not in ['avatar','furniture','uncertain']:raise ValueError('Invalid or duplicate pixel override')
            overrides[loc]=pixel
        if c.get('reviewPixels') is not None and (set(overrides)!=overlap or p['regions']):
            raise ValueError('Refinement requires exactly one explicit judgment per requested pixel and no polygons')
        intentional=p.get('intentionalBoundaryPixels',[])
        if any(len(loc)!=2 or any(not isinstance(v,int) for v in loc) for loc in intentional):raise ValueError('Intentional boundary coordinates must be integer pixels')
        intentional_set={tuple(loc) for loc in intentional}
        if len(intentional_set)!=len(intentional) or any(loc not in overrides or overrides[loc]['sourceRole']!='back' for loc in intentional_set):
            raise ValueError('Intentional boundary convention requires unique explicit back-surface pixel judgments')
        for x,y in sorted(overlap,key=lambda p:(p[1],p[0])):
            winner, reason, source_role = 'uncertain','No independently classified region','uncertain'
            for r in p['regions']:
                if inside(x+.5,y+.5,r['boundary']):winner,reason,source_role=r['winner'],r['reason'],r.get('sourceRole','unrecorded')
            if (x,y) in overrides:
                override=overrides[(x,y)];winner,reason,source_role=override['winner'],override['reason'],override.get('sourceRole','unrecorded')
            if source_role=='uncertain':winner='uncertain'
            points.append({'x':x,'y':y,'winner':winner,'reason':reason,'sourceRole':source_role,
                'source':'intentional-boundary-convention' if (x,y) in intentional_set else 'independent-ai-source-and-anatomy'})
        unresolved=sum(p['winner']=='uncertain' for p in points)
        reviews.append({'context':c['context'],'case':c['case'],'points':points,
            'uncertainties':p['uncertainties']+p['placementProblems'],
            'placementProblems':p['placementProblems'],'reviewStatus':'INDEPENDENT_AI_REVIEW',
            'coverage':{'overlaps':len(points),'labeled':len(points)-unresolved,'uncertain':unresolved},
            'provenance':{**provenance,**({'intentionalBoundaryConvention':{'version':1,'pixels':intentional,'basis':'Authoring intent: continuous shared one-pixel outline of touching foreground back and far arm belongs to back; not recovered ground truth.'}} if intentional else {})}})
    return reviews

def anatomy_hints(data, context):
    """Independent orthographic ray/capsule intersections of original avatar bones only.

    These are body bounds, never a furniture comparison or expected winner.
    The metric and analytic cylinder/sphere solver are independent of sitterMask.
    """
    anatomy=context.get('anatomy')
    if not anatomy:return {}
    anchor=data['sourceArt']['anchor'];tile=math.sqrt(384);scale=4/math.sqrt(3)
    ray=[tile/16,tile/16,1]
    def point(x,y,z):
        a=(x-anchor[0])/32;b=(y-anchor[1])/16+z/8
        return [(a+b)*tile/2,(b-a)*tile/2,z]
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def sub(a,b):return [x-y for x,y in zip(a,b)]
    def add(a,b,t):return [x+t*y for x,y in zip(a,b)]
    def roots(a,b,c):
        d=b*b-4*a*c
        return [] if d<0 or abs(a)<1e-12 else [(-b-math.sqrt(d))/(2*a),(-b+math.sqrt(d))/(2*a)]
    def capsule(origin,A,B,radius):
        delta=sub(B,A);length=math.sqrt(dot(delta,delta))
        if length<1e-10:return []
        axis=[v/length for v in delta];offset=sub(origin,A)
        rd=add(ray,axis,-dot(ray,axis));od=add(offset,axis,-dot(offset,axis))
        hits=[t for t in roots(dot(rd,rd),2*dot(rd,od),dot(od,od)-radius*radius)
              if 0<=dot(add(offset,ray,t),axis)<=length]
        for end in (A,B):
            delta=sub(origin,end)
            hits.extend(roots(dot(ray,ray),2*dot(ray,delta),dot(delta,delta)-radius*radius))
        return hits
    segments=[]
    for side in ['nearLeg','farLeg']:
        leg=anatomy[side]
        for a,b,radius in [('hip','knee',4.4),('knee','ankle',4.1)]:
            segments.append((side+' '+a+'-'+b,point(*leg[a],leg[a+'Height']),point(*leg[b],leg[b+'Height']),radius/scale))
    result={}
    for x,y in domain(data,context):
        origin=point(x+.5,y+.5,0);hits=[]
        for name,A,B,radius in segments:
            values=capsule(origin,A,B,radius)
            if values:hits.append({'segment':name,'frontZ':round(max(values),2),'rearZ':round(min(values),2)})
        if hits:result[(x,y)]=hits
    return result


def closeup(image, bounds):
    x0,y0,x1,y1=bounds;scale=28;pad=32
    canvas=Image.new('RGB',((x1-x0)*scale+pad*2,(y1-y0)*scale+pad*2),(240,238,243))
    crop=image.crop(bounds).resize(((x1-x0)*scale,(y1-y0)*scale),Image.Resampling.NEAREST)
    canvas.paste(crop,(pad,pad),crop)
    d=ImageDraw.Draw(canvas)
    for x in range(x0,x1+1):
        X=pad+(x-x0)*scale;d.line((X,pad,X,canvas.height-pad),fill=(130,130,140))
        if x<x1:d.text((X+4,8),str(x),fill=(10,10,20))
    for y in range(y0,y1+1):
        Y=pad+(y-y0)*scale;d.line((pad,Y,canvas.width-pad,Y),fill=(130,130,140))
        if y<y1:d.text((3,Y+6),str(y),fill=(10,10,20))
    return canvas


def content(data):
    a=data['sourceArt']; source,grid=annotated_source(a)
    prompt='''First independently identify the VISIBLE PHYSICAL FURNITURE SURFACE at each overlap from bare beauty art: supporting cushion/pan, outside back, near/far arm, or base/frame. Trace the flat seating well from its exposed interior to its seam/shadow boundary; a rear-facing sprite still has visible inner support. Facing labels alone do not decide occlusion. Do not merge an exposed flat cushion with the enclosing back shell just because they share upholstery color. Give sourceRole for every region and pixel override before making its body-depth judgment. If surface identity is unclear, sourceRole and winner must be uncertain. Then independently judge the physically correct winner at EVERY overlapping source pixel of each seated avatar and this furniture. You have ONLY original furniture art and ORIGINAL UNMASKED figures, never the current renderer output or its masks. Do not infer correctness from the avatar-over-art composite: it merely locates unmasked anatomy. Seated pelvis/thighs rest above the support cushion; continuous hanging shins should remain in front of the seat front when anatomically appropriate. Backrest and near arm may hide torso/limbs where the physical foreground surface actually crosses them; far arms are behind the occupant. Follow the visible furniture structure and this facing, not a universal furniture-wins rule. Judge continuous anatomy, support, arm/back edges and hollow regions closely. Report impossible seating placement or insufficient evidence rather than repairing it in your labels.
Return ordered polygons in ORIGINAL FURNITURE image coordinates, pixel (x,y) occupies [x,x+1)     [y,y+1), classified by center. Later polygons override earlier. Cover precisely all listed overlap pixels (polygons outside overlap are ignored). Use exact integer pixel overrides for diagonal one-pixel edges instead of approximating them with a broad polygon. Use uncertain for genuinely ambiguous pixels; give reasons. Other bare source views show the same object's construction to resolve whether a rim is actual arm/back or flat support. They are beauty art only, no inferred geometry. Every context is mandatory and must be reviewed independently, including different clothing. Never output a proposed fix or a pass/fail label. Source alone then its coordinate grid are shown first.'''
    if any('reviewPixels' in c for c in data['contexts']):
        prompt+=' This is a focused boundary inspection. For EVERY listed overlap pixel return one explicit integer pixels entry with sourceRole, winner and reason of at most eight words. regions MUST be empty. Do not interpolate diagonal seams; inspect pixel centers against source seams. No previous labels are provided.'
    result=[{'type':'input_text','text':prompt},{'type':'input_image','image_url':image_url(source),'detail':'high'},
            {'type':'input_image','image_url':image_url(grid),'detail':'high'}]
    result.append({'type':'input_text','text':'Establish the full object topology from ALL four whole-object beauty views before interpreting the closeup. A diagonal strip can be the thick top of an inner back cushion rather than a far arm. Trace its connection across facings; do not decide from a dark cropped ROI alone. Missing views or unresolved construction require uncertainty.'})
    result.append({'type':'input_text','text':'Explicit authoring convention, not measurement: ONLY when source views establish a foreground back physically TOUCHING a far arm, the continuous shared ONE-PIXEL outline belongs to the foreground back. This defines intent for an otherwise ambiguous junction. It excludes isolated caps, far-arm interiors, mere dark colors, gaps, and unrelated uncertainty. If used, list every exact coordinate in intentionalBoundaryPixels and give an explicit pixels entry with sourceRole back and a reason identifying shared-outline authoring intent. Use an empty list otherwise. Body winner still requires independent anatomical depth judgment; this convention never grants automatic furniture wins or approval.'})
    for facing,other in data.get('sourceViews',{}).items():
        if other and facing!=data['facing']:
            _,other_grid=annotated_source(other)
            result.extend([{'type':'input_text','text':'Same furniture, bare source view '+facing}, {'type':'input_image','image_url':image_url(other_grid),'detail':'high'}])
    for c in data['contexts']:
        f=c['figure']; feet=c['context']['figureContext']['feet']
        original=Image.frombytes('RGBA',(f['w'],f['h']),bytes(f['rgba']))
        composite=source.copy(); composite.alpha_composite(original,(math.floor(feet[0]+.5)-f['ax'],math.floor(feet[1]+.5)-f['ay']))
        overlap=domain(data,c)
        bounds=(max(0,min(x for x,y in overlap)-2),max(0,min(y for x,y in overlap)-2),min(a['width'],max(x for x,y in overlap)+3),min(a['height'],max(y for x,y in overlap)+3))
        mapped=closeup(composite,bounds)
        hints=anatomy_hints(data,c)
        ox,oy=math.floor(feet[0]+.5)-f['ax'],math.floor(feet[1]+.5)-f['ay']
        sparse=[{'x':x,'y':y,'owner':data['ownerNames'].get(str(f['owner'][(y-oy)*f['w']+x-ox]),'unknown'),
                 **({'bodyRayBounds':hints[(x,y)]} if (x,y) in hints else {})} for x,y in overlap]
        # No modelSource, model parts, current mask or surface identities enter this payload.
        descriptor={'id':c['id'],'facing':data['facing'],'feet':feet,'figureAnchor':[f['ax'],f['ay']],
                    'opaqueOverlap':sparse,'anatomy':c.get('anatomy'),'figureSize':[f['w'],f['h']],
                    'physicalNotes':'Hip contact is the underside of the solid pelvis, not the shin. Rounded pants corners can be owned by leg strokes while remaining inside this pelvis volume. Body ray bounds are conservative independent capsule geometry, not a furniture comparison. Uphold contiguous hip support above flat cushions; distinguish raised back/arms using visible construction.'}
        result.extend([{'type':'input_text','text':json.dumps(descriptor)},
          {'type':'input_image','image_url':image_url(original.resize((f['w']*8,f['h']*8),Image.Resampling.NEAREST)),'detail':'high'},
          {'type':'input_image','image_url':image_url(closeup(source,bounds)),'detail':'high'},
          {'type':'input_image','image_url':image_url(mapped),'detail':'high'}])
    return result

def refinement_input(data, reviews):
    """Choose difficult pixels only from independent role boundaries and uncertainty.

    No previous winner or role label is sent to the second model call.
    """
    refined=copy.deepcopy(data)
    for context,review in zip(refined['contexts'],reviews):
        points={(p['x'],p['y']):p for p in review['points']}; selected=set()
        for (x,y),point in points.items():
            neighbors=[points.get((x+dx,y+dy)) for dx in [-1,0,1] for dy in [-1,0,1] if dx or dy]
            boundary=point['winner']=='uncertain' or any(p is None or p.get('sourceRole')!=point.get('sourceRole') for p in neighbors)
            if boundary:
                for dx in [-1,0,1]:
                    for dy in [-1,0,1]:
                        if (x+dx,y+dy) in points:selected.add((x+dx,y+dy))
        context['reviewPixels']=[list(p) for p in sorted(selected,key=lambda p:(p[1],p[0]))]
    return refined


def propose(path: Path, out: Path, attempts=2):
    data=json.loads(path.read_text(encoding='utf-8'))
    producer_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    identity=digest({'version':VERSION,'producerSha256':producer_hash,'input':data})
    folder=out/identity; folder.mkdir(parents=True,exist_ok=True)
    # Each look/cushion gets its own inspectable context. Exact boundary answers
    # must not compete for an 18k-token budget with three other bodies.
    if len(data['contexts'])>1:
        combined=folder/'expectations';combined.mkdir(exist_ok=True)
        for context in data['contexts']:
            single={**data,'contexts':[context]}
            input_path=folder/(context['id']+'.input.json')
            input_path.write_text(json.dumps(single),encoding='utf-8')
            generated=propose(input_path,folder/'contexts',attempts)
            source=generated/(context['id']+'.json')
            (combined/source.name).write_bytes(source.read_bytes())
        return combined
    (folder/'input.json').write_text(json.dumps(data),encoding='utf-8')
    if all(not domain(data,c) for c in data['contexts']):
        expectation_dir=folder/'expectations';expectation_dir.mkdir(exist_ok=True)
        for c in data['contexts']:
            result={'context':c['context'],'case':c['case'],'points':[], 'uncertainties':[],
                    'coverage':{'overlaps':0,'labeled':0,'uncertain':0},
                    'provenance':{'kind':'exact-empty-overlap-domain','inputSha256':digest(data),'producerSha256':producer_hash}}
            (expectation_dir/(c['id']+'.json')).write_text(json.dumps(result),encoding='utf-8')
        return expectation_dir
    payload=None; reviews=[]; prior_reviews=None
    for attempt in range(min(2,max(1,attempts))):
        target=folder/f'attempt-{attempt+1}';target.mkdir(exist_ok=True)
        request_data=refinement_input(data,prior_reviews) if attempt and prior_reviews else data
        (target/'input.json').write_text(json.dumps(request_data),encoding='utf-8')
        proposal_path=target/'proposal.json'
        if proposal_path.exists():
            proposal=json.loads(proposal_path.read_text(encoding='utf-8'))
        else:
            if (target/'response.json').exists():
                response=json.loads((target/'response.json').read_text(encoding='utf-8'))
            else:
                if studio.spent()+1.5>studio.cap():raise RuntimeError('Insufficient remaining budget for independent review')
                payload=content(request_data)
                (target/'prompt.json').write_text(json.dumps(payload),encoding='utf-8')
                start=time.time()
                response=studio.post(f'{studio.API}/responses',json={'model':MODEL,'store':False,
                    'reasoning':{'effort':'medium'},'max_output_tokens':18000,
                    'input':[{'role':'user','content':payload}],
                    'text':{'format':{'type':'json_schema','name':'independent_seat_review','strict':True,'schema':schema()}}})
                (target/'response.json').write_text(json.dumps(response),encoding='utf-8')
                usage=response.get('usage') or {};usd=(usage.get('input_tokens',0)*INPUT_USD+usage.get('output_tokens',0)*OUTPUT_USD)/1e6
                studio.log('seat-independent-review',argparse.Namespace(model=MODEL,quality='vision',size=data['facing'],count=1),{**usage,'usd':usd},time.time()-start,data['key'])
            if response.get('status')!='completed':
                if attempt+1<attempts:continue
                raise RuntimeError(f"Incomplete independent response: {response.get('status')}")
            proposal=json.loads(''.join(c.get('text','') for o in response.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text'))
            proposal_path.write_text(json.dumps(proposal),encoding='utf-8')
        provenance={'kind':'independent-ai','model':MODEL,'producerVersion':VERSION,'producerSha256':producer_hash,'inputSha256':digest(data),'requestInputSha256':digest(request_data),'cacheKey':identity,
                    'proposalSha256':digest(proposal),'responseSha256':hashlib.sha256((target/'response.json').read_bytes()).hexdigest() if (target/'response.json').exists() else None,'artifact':str(target)}
        try:
            reviews=rasterize(request_data,proposal,provenance)
        except (ValueError, KeyError, TypeError) as error:
            (target/'invalid.txt').write_text(str(error),encoding='utf-8')
            if attempt+1<min(2,max(1,attempts)):continue
            raise
        if prior_reviews:
            for old,new in zip(prior_reviews,reviews):
                before={(p['x'],p['y']):p['winner'] for p in old['points']}
                conflicts=0
                for point in new['points']:
                    previous=before.get((point['x'],point['y']))
                    if previous in ['avatar','furniture'] and point['winner'] in ['avatar','furniture'] and previous!=point['winner']:
                        point.update(winner='uncertain',reason='Independent source-only attempts disagree')
                        conflicts+=1
                if any('reviewPixels' in c for c in request_data['contexts']):
                    updated={(p['x'],p['y']):p for p in new['points']}
                    new['points']=[updated.get((p['x'],p['y']),p) for p in old['points']]
                    new['priorProvenance']=old['provenance']
                    new['uncertainties']+=old.get('placementProblems',[])
                    new['coverage']={'overlaps':len(new['points']),'uncertain':sum(p['winner']=='uncertain' for p in new['points'])}
                    new['coverage']['labeled']=len(new['points'])-new['coverage']['uncertain']
                if conflicts:
                    new['uncertainties'].append(f'{conflicts} conflicting independent pixel judgments')
                    new['coverage']['uncertain']=sum(p['winner']=='uncertain' for p in new['points'])
                    new['coverage']['labeled']=len(new['points'])-new['coverage']['uncertain']
        prior_reviews=reviews
        if all(not r['uncertainties'] and not r['coverage']['uncertain'] for r in reviews):break
    if not reviews:raise RuntimeError('Independent review produced no usable complete contexts')
    expectation_dir=folder/'expectations';expectation_dir.mkdir(exist_ok=True)
    for c,r in zip(data['contexts'],reviews):(expectation_dir/f"{c['id']}.json").write_text(json.dumps(r),encoding='utf-8')
    return expectation_dir

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--attempts',type=int,choices=[1,2],default=2)
    args=p.parse_args();print(propose(args.input,args.out,args.attempts))
