"""Automatic source-pixel surface proposal. Beauty pixels are never modified.

Uses vision + structured geometry, not the old proxy's inferred per-pixel labels.
Proposals remain UNREVIEWED until independent semantic and game-canvas verification.
API schema: https://developers.openai.com/api/docs/guides/structured-outputs
Vision input: https://developers.openai.com/api/docs/guides/images-vision
"""
from __future__ import annotations
import argparse
import base64
import io
import copy
import hashlib
import itertools
import json
import math
import time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import studio

MODEL = "gpt-6-astra"
SURFACE_PRODUCER_VERSION = 11
# Standard short-context rates, official model page, checked 2026-09-30.
INPUT_USD, OUTPUT_USD = 10, 50

# Intentional semantic art direction, not a claim that ambiguous source pixels
# reveal a uniquely recoverable original 3D surface. Applies to future assets.
SHARED_CONTOUR_AUTHORING_RULE = """SEMANTIC AUTHORING CONVENTION: At a positively identified touching junction between a foreground back/back-cushion and an opposite/far arm, an ambiguous shared one-pixel outline belongs to the foreground back, continuing that back's contour through the junction. This intentionally authors ownership where beauty pixels alone are ambiguous; state that convention in reasoning/provenance. This does NOT apply to isolated far-arm caps or interiors, detached outlines, supporting seat/well pixels, or pixels selected merely because they are dark. Establish physical contact and contour continuity from the source views first. Do not dilate masks or add a runtime override.
RECEIVER-SHADOW AUTHORING CONVENTION: A cast shadow inherits the physical surface receiving the shadow, not the raised rail/frame/arm that casts it. Establish the receiving side from an uninterrupted raised contour plus continuous receiving-material region in the complete source views; darkness or color similarity alone is insufficient. A material-tinted mixed boundary shade outside that established raised contour may be intentionally authored as receiving-surface shadow when that reading preserves both the contour and material continuity. Record the affected source coordinates/region, this convention, and the positive continuity evidence in your reasoning. This is explicit authored ownership where original artist intent cannot be uniquely recovered, not a claim of certain reconstruction. Preserve actual rail/frame pixels, isolated raised contours, and material discontinuities as their own physical parts; do not move the contour to expose an avatar. If the receiving side or uninterrupted raised contour cannot be established, retain uncertainty. No avatar positions, masks, expected winners, runtime color heuristics, mask dilation, or asset-specific offsets may determine this decision."""


OWNERSHIP_CONVENTIONS = ('shared-contour', 'receiver-shadow')
OWNERSHIP_CONVENTION_VERSION = 1
OWNERSHIP_PROMPT = '''For every region/pixel, record basis observed, declared-intent, or unresolved; record reason as positive physical evidence. observed and unresolved use convention="". declared-intent requires convention shared-contour or receiver-shadow and evidence satisfying that supplied rule. Declaration is authored intent, never recovered certainty or approval. Unsupported rounded tangent divisions remain unresolved. Put ALL remaining unknowns in uncertainties; nonempty uncertainties or unresolved records block surface generation. Do not rename an unknown as intent to complete coverage.'''


def ownership_properties():
    return {'basis': {'type': 'string', 'enum': ['observed', 'declared-intent', 'unresolved']},
            'convention': {'type': 'string', 'enum': ['', *OWNERSHIP_CONVENTIONS]}}


def validate_ownership(proposal, field='regions'):
    """New authorship fails closed; historical stored maps are not reinterpreted."""
    if not isinstance(proposal, dict) or not isinstance(proposal.get(field), list):
        raise ValueError('Explicit ownership records required')
    uncertainties = proposal.get('uncertainties')
    if not isinstance(uncertainties, list) or any(not isinstance(s, str) for s in uncertainties):
        raise ValueError('Explicit ownership uncertainties list required')
    if uncertainties:
        raise ValueError('Unresolved source ownership: ' + '; '.join(uncertainties))
    for record in proposal[field]:
        if not isinstance(record, dict):
            raise ValueError('Malformed ownership record')
        basis, convention = record.get('basis'), record.get('convention')
        if basis == 'unresolved':
            raise ValueError('Unresolved source ownership region/pixel: ' + str(record.get('reason', '')))
        if basis not in ('observed', 'declared-intent') or not isinstance(record.get('reason'), str) or not record['reason'].strip():
            raise ValueError('Explicit ownership basis and positive evidence required')
        if (basis == 'observed' and convention != '') or (basis == 'declared-intent' and convention not in OWNERSHIP_CONVENTIONS):
            raise ValueError('Ownership declaration requires a supported convention; observed is not declared intent')


def ownership_metadata(data, proposal, field='regions'):
    # Original source and declaration only; no sitter or runtime mask enters this binding.
    source = {k: data.get(k) for k in ['key', 'facing', 'width', 'height', 'rgba', 'anchor', 'drawing',
              'mechanicsDigest', 'modelParts', 'parts', 'projectedParts', 'sourceViews']}
    source['modelSize'] = data.get('model', {}).get('size')
    return {'version': 1, 'producerVersion': SURFACE_PRODUCER_VERSION,
            'conventionVersion': OWNERSHIP_CONVENTION_VERSION,
            'status': 'UNREVIEWED_SOURCE_OWNERSHIP',
            'sourceSha256': hashlib.sha256(json.dumps(source, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'uncertainties': copy.deepcopy(proposal['uncertainties']),
            field: copy.deepcopy(proposal[field]),
            'physicalPartAssignments': copy.deepcopy(proposal.get('physicalPartAssignments', []))}


def bind_ownership_labels(surface):
    surface['ownership']['labelsSha256'] = hashlib.sha256(
        json.dumps(surface['labels'], separators=(',', ':')).encode()).hexdigest()
    return surface


def validate_surface_ownership(data, surface, proposal=None):
    """Validate new generation/cache reuse only; not a legacy model load gate."""
    ownership = surface.get('ownership')
    if not isinstance(ownership, dict) or ownership.get('version') != 1:
        raise ValueError('Generated surface lacks source ownership record')
    expected = ownership_metadata(data, {'regions': [], 'uncertainties': []})['sourceSha256']
    if ownership.get('sourceSha256') != expected:
        raise ValueError('Stale ownership source binding')
    label_hash = hashlib.sha256(json.dumps(surface['labels'], separators=(',', ':')).encode()).hexdigest()
    if ownership.get('labelsSha256') != label_hash:
        raise ValueError('Stale ownership label binding')
    current = ownership
    while isinstance(current, dict):
        if current.get('version') != 1 or current.get('status') != 'UNREVIEWED_SOURCE_OWNERSHIP':
            raise ValueError('Generated surface contains unrecorded historical ownership')
        if current.get('producerVersion') != SURFACE_PRODUCER_VERSION or current.get('conventionVersion') != OWNERSHIP_CONVENTION_VERSION:
            raise ValueError('Stale ownership producer/convention version')
        field = 'pixels' if 'pixels' in current else 'regions'
        if not isinstance(current.get(field), list) or not current[field]:
            raise ValueError('Generated surface lacks explicit ownership records')
        validate_ownership(current, field)
        if 'previousOwnership' not in current:
            break
        current = current['previousOwnership']
        if not isinstance(current, dict):
            raise ValueError('Malformed previous ownership record')
    if proposal is not None:
        validate_ownership(proposal)
        if current.get('regions') != proposal['regions'] or current.get('physicalPartAssignments') != proposal.get('physicalPartAssignments', []):
            raise ValueError('Cached proposal disagrees with bound ownership records')


def schema():
    point = {"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2}
    region = {"type":"object","additionalProperties":False,"properties":{
        "part":{"type":"integer"},"face":{"type":"integer","enum":[0,1,2]},
        "boundary":{"type":"array","items":point,"minItems":3},
        "reason":{"type":"string"}, **ownership_properties()},"required":["part","face","boundary","reason","basis","convention"]}
    return {"type":"object","additionalProperties":False,"properties":{
        "regions":{"type":"array","items":region},"uncertainties":{"type":"array","items":{"type":"string"}}},
        "required":["regions","uncertainties"]}

def annotated_source(data):
    """Coordinate visualisation only; source RGBA and runtime art are untouched."""
    w,h=data['width'],data['height']
    source=Image.frombytes('RGBA',(w,h),bytes(data['rgba']))
    scale,pad=12,30
    canvas=Image.new('RGB',(w*scale+pad*2,h*scale+pad*2),(240,238,243))
    large=source.resize((w*scale,h*scale),Image.Resampling.NEAREST)
    canvas.paste(large,(pad,pad),large)
    draw=ImageDraw.Draw(canvas)
    for x in range(w+1):
        draw.line((pad+x*scale,pad,pad+x*scale,pad+h*scale),fill=(120,120,130),width=1)
        if x%4==0:draw.text((pad+x*scale,pad-16),str(x),fill=(15,15,20))
    for y in range(h+1):
        draw.line((pad,pad+y*scale,pad+w*scale,pad+y*scale),fill=(120,120,130),width=1)
        if y%4==0:draw.text((2,pad+y*scale),str(y),fill=(15,15,20))
    return source,canvas

def image_url(image):
    b=io.BytesIO();image.save(b,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()

def source_view_context(data):
    """Only beauty images from other facings; never masks or proposed identities."""
    views=data.get('sourceViews',{})
    if not isinstance(views,dict):raise ValueError('sourceViews must be a facing-to-beauty mapping')
    content=[]
    for facing,view in sorted(views.items()):
        if facing not in ['ne','nw','se','sw'] or not isinstance(view,dict):
            raise ValueError('Invalid source-view facing or beauty record')
        w,h=view.get('width'),view.get('height');rgba=view.get('rgba')
        if type(w) is not int or type(h) is not int or min(w,h)<=0 or not isinstance(rgba,list) or len(rgba)!=w*h*4 or any(type(c) is not int or not 0<=c<=255 for c in rgba):
            raise ValueError('Invalid source-view beauty dimensions or RGBA')
        if facing==data['facing']:
            if w!=data['width'] or h!=data['height'] or rgba!=data['rgba']:
                raise ValueError('Primary-facing context differs from the classified beauty source')
            continue
        content.extend([{'type':'input_text','text':f"Additional unannotated beauty view of the same furniture: facing {facing}, dimensions {w}x{h}, anchor {view.get('anchor')}, drawing fingerprint {view.get('drawingFingerprint',view.get('drawing'))}. Coordinates and physical indices in the requested output still refer ONLY to the primary facing."},
            {'type':'input_image','image_url':image_url(Image.frombytes('RGBA',(w,h),bytes(rgba))),'detail':'high'}])
    return content


def inside(x,y,poly):
    result=False
    for (ax,ay),(bx,by) in zip(poly,poly[1:]+poly[:1]):
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:result=not result
    return result

def physical_assignments(data,labels,proposal):
    """Bind proposal groups to geometry, rejecting ambiguity instead of certifying a guess.

    This is only a proposal identity check. A unique assignment is not evidence that
    a painted boundary is correct; independent full-overlap review remains required.
    """
    w=data['width']; identities=[]; diagnostics=[]
    proposal['physicalPartAssignments']=identities
    proposal['physicalAssignmentDiagnostics']=diagnostics
    groups_to_bind=[(kind,{i for i,p in enumerate(data['parts']) if p.get('part')==kind},kind) for kind in ['arm','leg']]
    wraps=[(i,p) for i,p in enumerate(data['parts']) if p.get('part')=='wrap']
    if wraps:
        size=data.get('model',{}).get('size')
        if not isinstance(size,list) or len(size)!=2 or not isinstance(size[0],(int,float)) or not math.isfinite(size[0]) or size[0]<=0:
            raise ValueError('Missing model size for physical wrap identity; proposal requires review')
        mid=size[0]/2
        side_wraps=set()
        for i,p in wraps:
            u=p.get('u')
            if not isinstance(u,list) or len(u)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in u) or u[0]>u[1]:
                raise ValueError('Invalid physical wrap interval; proposal requires review')
            if u[1]<=mid or u[0]>=mid:side_wraps.add(i)
        groups_to_bind.append(('side-wrap',side_wraps,'wrap'))
    for kind,indices,source_kind in groups_to_bind:
        if not indices:continue
        candidates=[p for p in data.get('projectedParts',[]) if p.get('kind')==source_kind and p.get('index') in indices]
        if len(candidates)!=len(indices) or {p.get('index') for p in candidates}!=indices:
            raise ValueError(f'Missing or inconsistent projected {kind} legend; proposal requires review')
        for p in candidates:
            center=p.get('center')
            if not isinstance(center,list) or len(center)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in center):
                raise ValueError(f'Invalid projected {kind} center; proposal requires review')
        groups=[]; component_checks=[]
        for p in candidates:
            pixels=[i for i,c in enumerate(labels) if c and (c-1)//3==p['index']]
            if not pixels:continue
            # Two substantial disconnected arm silhouettes under one identity are
            # a likely merged near/far proposal. Never silently map both to one arm.
            # Occlusion can legitimately split a part: that case requires review.
            if kind in ['arm','side-wrap']:
                remaining=set(pixels); components=[]
                while remaining:
                    queue=[remaining.pop()]; component=[]
                    while queue:
                        i=queue.pop();component.append(i);x,y=i%w,i//w
                        for dx,dy in [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)]:
                            X,Y=x+dx,y+dy;j=Y*w+X
                            if 0<=X<w and 0<=Y<data['height'] and j in remaining:remaining.remove(j);queue.append(j)
                    components.append(component)
                significant=[c for c in components if len(c)>=max(2,len(pixels)*.1)]
                if len(significant)>1:
                    assignments=[]
                    for component in significant:
                        cx=sum(i%w+.5 for i in component)/len(component);cy=sum(i//w+.5 for i in component)/len(component)
                        ranked_components=sorted(((cx-q['center'][0])**2+(cy-q['center'][1])**2,q['index']) for q in candidates)
                        best_cost,best_part=ranked_components[0];runner_cost=ranked_components[1][0] if len(ranked_components)>1 else None
                        clear=runner_cost is None or runner_cost-best_cost>max(1e-6,.05*runner_cost)
                        assignments.append({'center':[cx,cy],'pixels':len(component),'part':best_part,'bestCost':best_cost,
                          'runnerUpCost':runner_cost,'clear':clear})
                    component_checks.append({'proposalPart':p['index'],'components':assignments})
                    # A wooden back/slat may split the SAME physical arm. This
                    # is admissible only if every fragment independently and
                    # confidently resolves to that same side. A merged near+far
                    # proposal still cannot collapse both arms into one part.
                    if not all(a['clear'] for a in assignments) or len({a['part'] for a in assignments})!=1:
                        diagnostics.append({'kind':kind,'componentChecks':component_checks,'rejected':f'merged or ambiguous disconnected {kind}'})
                        raise ValueError(f'Merged or occluded {kind} group {p["index"]}: disconnected substantial regions require review')
            groups.append((p['index'],sum(i%w+.5 for i in pixels)/len(pixels),sum(i//w+.5 for i in pixels)/len(pixels)))
        if not groups:continue
        if len(candidates)>8:raise ValueError(f'Too many {kind} parts for unambiguous exhaustive matching')
        def cost(assignment):
            return sum((x-p['center'][0])**2+(y-p['center'][1])**2 for (_,x,y),p in zip(groups,assignment))
        ranked=sorted((cost(a),tuple(p['index'] for p in a),a) for a in itertools.permutations(candidates,len(groups)))
        best,_,chosen=ranked[0];runner=ranked[1][0] if len(ranked)>1 else None
        margin=runner-best if runner is not None else None
        diagnostics.append({'kind':kind,'componentChecks':component_checks,'groups':[{'part':i,'center':[x,y]} for i,x,y in groups],
          'bestCost':best,'runnerUpCost':runner,'margin':margin,'relativeMargin':margin/max(1,runner) if runner is not None else None,
          'assignment':[{'from':g[0],'to':p['index']} for g,p in zip(groups,chosen)]})
        if runner is not None and margin<=max(1e-6,.05*runner):
            raise ValueError(f'Ambiguous projected {kind} identity assignment; proposal requires review (cost margin {margin:g})')
        remap={g[0]:p['index'] for g,p in zip(groups,chosen)}
        identities.extend({'from':old,'to':new,'kind':kind} for old,new in remap.items() if old!=new)
        labels=[1+remap[(c-1)//3]*3+(c-1)%3 if c and (c-1)//3 in remap else c for c in labels]
    return labels

def rasterize(data,proposal,allow_incomplete=False):
    validate_ownership(proposal)
    w,h=data['width'],data['height'];labels=[0]*(w*h)
    for region in proposal['regions']:
        part,face=region['part'],region['face']
        if not 0<=part<len(data['parts']) or face not in [0,1,2]:raise ValueError('Invalid part/face')
        for y in range(h):
            for x in range(w):
                if data['rgba'][(y*w+x)*4+3] and inside(x+.5,y+.5,region['boundary']):labels[y*w+x]=1+part*3+face
    missing=[(i%w,i//w) for i,c in enumerate(labels) if not c and data['rgba'][i*4+3]]
    if missing and not allow_incomplete:raise ValueError(f'{len(missing)} opaque pixels unclassified, first: {missing[:20]}')
    # Vision names the painted parts; physical left/right indices come from
    # their projection in THIS view. Local-u ordering reverses on rotation.
    # Solve the one-to-one correspondence rather than asking vision to infer
    # local coordinate handedness from a list of 3D bounds.
    labels=physical_assignments(data,labels,proposal)
    return bind_ownership_labels({'version':1,'width':w,'height':h,'drawing':data['drawing'],'modelParts':data['modelParts'],'labels':labels,
            'ownership': ownership_metadata(data, proposal)})

def complete_proposal(data, proposal, path):
    """One bounded source-only retry for sparse polygon coverage gaps.

    Missing pixels never inherit their neighbors' identities. The retry must
    explicitly classify each one, leaving all previously proposed pixels intact.
    This completes a proposal, not its independent verification.
    """
    surface=rasterize(data,proposal,allow_incomplete=True)
    missing=[(i%data['width'],i//data['width']) for i,c in enumerate(surface['labels'])
             if not c and data['rgba'][i*4+3]]
    if not missing:return surface
    if len(missing)>64:raise ValueError(f'{len(missing)} opaque pixels unclassified; exceeds bounded sparse repair')
    from seat_surface_repair import repair
    out=path.parent/'coverage-repair'
    out.mkdir(parents=True,exist_ok=True)
    staged=out/'incomplete-surface.json'
    staged.write_text(json.dumps(surface),encoding='utf-8')
    (out/'missing-pixels.json').write_text(json.dumps(missing),encoding='utf-8')
    bounds=[min(x for x,y in missing),min(y for x,y in missing),
            max(x for x,y in missing)+1,max(y for x,y in missing)+1]
    revised=repair(path,staged,bounds,out,context=8,pixels=missing)
    proposal['coverageRepair']={'pixels':missing,'proposal':str(out/'proposal.json'),'status':'UNREVIEWED'}
    return revised

def propose(path, reasoning_effort='high'):
    data=json.loads(path.read_text(encoding='utf-8'));out=path.parent
    source,grid=annotated_source(data);grid.save(out/'coordinates.png')
    prompt=f'''Identify the exact visible physical surface of every opaque pixel in this isometric furniture sprite.
Output ordered polygon regions in ORIGINAL drawing coordinates, x rightward, y downward; first pixel occupies [0,1)x[0,1).
The first image is the unmodified source, second is a 12x numbered grid. Ignore the grid as artwork.
Drawing is {data['width']} by {data['height']}; facing {data['facing']}; original anchor {data['anchor']}.
Model parts are indexed here: {json.dumps(data['parts'])}
Projected physical-part center positions and near/far roles for THIS facing: {json.dumps(data.get('projectedParts',[]))}
The projected legend controls physical indices. Local u=0 is NOT always screen-left or near! Preserve the face axis when referring to the same physical part.
Assign actual painted surfaces, NOT the silhouettes of the approximate boxes. A back box can project over a visibly exposed cushion: that pixel is SEAT TOP, not back.
Likewise a solid outside back panel is BACK even if a proxy ray might call it arm or cushion. Inner versus outer geometry matters.
An arm is only the actual painted arm rail or arm panel, never nearby upholstery merely because a box overlaps it. Side wraps are physical near/far sides of a soft seat, distinct from the central back wrap. Keep the opposite rim behind the cavity distinct from the near shoulder and central back crest; do not merge their physical indices just because the upholstery is continuous.
Near/far SIDE WRAP identifies its physical side, not a universal visibility rule. A side wrap can extend from the front bank into the posterior rolled rim; preserve that continuous physical identity without assuming every pixel is in front of or behind a future sitter. Rounded top/vertical transitions may be genuinely ambiguous: record that instead of inventing precise box-face depth from shading.
Local u runs across the seat, v from front to back; face0=top, face1=side normal u, face2=side normal v.
Use the matching indexed physical part. Seat/cushion top uses seat face0. Curved back cap uses back face0; vertical back face2.
Cover every opaque source pixel. You may start with a broad polygon for the dominant base/back and overlay precise visible seat/arms/legs; later regions win.
Transparent pixels are ignored automatically. Curves need enough vertices to follow each pixel staircase at the original resolution.
Do not classify clothes or sitters: there are none. Do not move geometry or edit the art. Report ambiguities candidly in uncertainties.
{SHARED_CONTOUR_AUTHORING_RULE}
{OWNERSHIP_PROMPT}
Return JSON using the schema.'''
    view_content=source_view_context(data)
    if view_content:
        prompt+='\nAdditional images show the same furniture from other facings, with no annotations or sitter masks. Use all views to distinguish raised back cushions, supporting seats, near/far arms or wraps, and continuous outer contours. Classify primary-facing coordinates only; never copy screen coordinates from another view.'
    content=[{'type':'input_text','text':prompt},
      {'type':'input_image','image_url':image_url(source),'detail':'high'},
      {'type':'input_image','image_url':image_url(grid),'detail':'high'}]+view_content
    (out/'prompt.txt').write_text(prompt,encoding='utf-8')
    # Reserve a conservative maximum before a paid call; never raise the existing art budget.
    if studio.spent()+1.5>studio.cap():raise RuntimeError('Insufficient remaining art budget for surface annotation')
    start=time.time()
    response=studio.post(f'{studio.API}/responses',json={'model':MODEL,'store':False,
        'reasoning':{'effort':reasoning_effort},'max_output_tokens':18000,
        'input':[{'role':'user','content':content}],
        'text':{'format':{'type':'json_schema','name':'seat_surfaces','strict':True,'schema':schema()}}})
    (out/'response.json').write_text(json.dumps(response),encoding='utf-8')
    usage=response.get('usage') or {};usd=(usage.get('input_tokens',0)*INPUT_USD+usage.get('output_tokens',0)*OUTPUT_USD)/1e6
    studio.log('seat-surfaces',argparse.Namespace(model=MODEL,quality='vision',size=f"{data['width']}x{data['height']}",count=1),
        {**usage,'usd':usd},time.time()-start,f"surfaces/{data['key']}/{data['facing']}")
    if response.get('status')!='completed':raise RuntimeError(f"Incomplete response: {response.get('status')}")
    text=''.join(c.get('text','') for o in response.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text')
    proposal=json.loads(text)
    try:surface=complete_proposal(data,proposal,path)
    finally:(out/'proposal.json').write_text(json.dumps(proposal,indent=2),encoding='utf-8')
    (out/'surface.json').write_text(json.dumps(surface),encoding='utf-8')
    print(json.dumps({'surface':str(out/'surface.json'),'usd':usd,'uncertainties':proposal['uncertainties'],'status':'UNREVIEWED'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path)
    parser.add_argument('--rasterize-only',action='store_true')
    parser.add_argument('--repair-coverage',action='store_true',help='Resume a saved proposal; one paid sparse source-only coverage retry if needed.')
    parser.add_argument('--reasoning-effort',choices=['medium','high'],default='high',
        help='Bounded retry option for annotation calls that exhaust reasoning tokens.')
    args=parser.parse_args()
    if args.rasterize_only or args.repair_coverage:
        data=json.loads(args.input.read_text(encoding='utf-8'));directory=args.input.parent
        proposal=json.loads((directory/'proposal.json').read_text(encoding='utf-8'))
        try:surface=complete_proposal(data,proposal,args.input) if args.repair_coverage else rasterize(data,proposal)
        finally:(directory/'proposal.json').write_text(json.dumps(proposal,indent=2),encoding='utf-8')
        (directory/'surface.json').write_text(json.dumps(surface),encoding='utf-8')
        print(json.dumps({'surface':str(directory/'surface.json'),'physicalPartAssignments':proposal['physicalPartAssignments']}))
    else:propose(args.input,args.reasoning_effort)
