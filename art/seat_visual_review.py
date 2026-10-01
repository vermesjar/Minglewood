"""Separate aesthetic gate for authored seating. Numerical parity never grants approval."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import math
import time
from pathlib import Path
from PIL import Image, ImageDraw

VERSION = 1
SCOPE = 'Every direction, cushion and review outfit: original beauty, body silhouette, support contact, comfortable seat depth and backrest/cushion proportions, body scale, arm/back ordering and pixel topology. Settled views only; no motion approval.'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def proof(path, root):
    import os
    path = Path(path).resolve()
    return {'path': os.path.relpath(path, root).replace('\\', '/'), 'sha256': sha(path)}


def checked(p, root):
    path = (Path(root) / p['path']).resolve()
    if sha(path) != p['sha256']:
        raise ValueError(f'Evidence changed: {p["path"]}')
    return path


def components(points):
    remaining = set(points)
    while remaining:
        seed = remaining.pop(); queue = [seed]; group = {seed}
        while queue:
            x, y = queue.pop()
            for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if q in remaining:
                    remaining.remove(q); group.add(q); queue.append(q)
        yield group


def topology_risks(original, visible, contact=None):
    """Flags are review questions, never proof that an occlusion is wrong."""
    original, visible = set(original), set(visible); risks = []
    hidden = original-visible
    for group in components(hidden):
        boundary = {(x+dx,y+dy) for x,y in group for dx,dy in [(-1,0),(1,0),(0,-1),(0,1)]}-group
        if len(group) <= 12 and boundary and boundary <= visible:
            risks.append({'kind':'enclosed-furniture-pixels','pixels':sorted(group),'question':'Furniture appears inside an otherwise continuous original body. Is this a real open gap or a clipping hole?'})
    for original_group in components(original):
        fragments = list(components(original_group & visible))
        if len(fragments) > 1:
            largest = sorted(fragments, key=lambda g:(-len(g),sorted(g)))[0]
            for fragment in fragments:
                if fragment != largest and len(fragment) <= 24:
                    risks.append({'kind':'new-disconnected-body-fragment','pixels':sorted(fragment),'question':'Occlusion detached these original body pixels. Is the visible limb/outline still coherent?'})
    if contact is None:
        risks.append({'kind':'support-contact-unmeasured','pixels':[], 'question':'No independent contact anchor was supplied. Inspect that the body rests on the cushion without hovering or penetration.'})
    else:
        x,y=contact
        nearby={(xx,yy) for xx in range(math.floor(x)-2,math.ceil(x)+3) for yy in range(math.floor(y)-2,math.ceil(y)+3)}
        if not nearby & visible or not nearby & hidden:
            risks.append({'kind':'support-contact-transition-unconfirmed','pixels':[[round(x),round(y)]], 'question':'The small contact neighborhood does not contain both visible body and occluded support. Check for hovering, a gap, or a valid fully exposed cushion.'})
    risks.sort(key=lambda r:(r['kind'],r['pixels']))
    for i,risk in enumerate(risks): risk['id']=f'risk-{i}'
    return risks


def prepare(bundle_path, contract_path, output, body_files, source_inputs=()):
    bundle_path,contract_path,output=Path(bundle_path),Path(contract_path),Path(output)
    output.mkdir(parents=True,exist_ok=True);root=bundle_path.parent
    bundle=json.loads(bundle_path.read_text());contract=json.loads(contract_path.read_text())
    if bundle.get('version')!=1 or bundle['contract']['sha256']!=sha(contract_path): raise ValueError('Numerical bundle/contract mismatch')
    if not body_files: raise ValueError('Exact independent body/reference generator bindings are required')
    all_paths=[bundle_path,contract_path,*map(Path,body_files),*map(Path,source_inputs),Path(__file__)]
    expectations=[]
    for p in bundle['expectations']:
        path=checked(p,root);all_paths.append(path);expectations.append(json.loads(path.read_text()))
    records=[]
    for p in bundle['captures']:
        path=checked(p,root);receipt=checked(p['receipt'],root);all_paths.extend([path,receipt]);records.extend(json.loads(path.read_text()))
    required={(f,l,c) for f in ['se','sw','ne','nw'] for l in range(4) for c in range(len(contract['sits']))}
    actual=[(r['facing'],r['reviewLook'],r['cushion']) for r in records]
    if set(actual)!=required or len(actual)!=len(required): raise ValueError('Visual review requires every exact direction/outfit/cushion once')
    anatomy=[]
    for p in source_inputs: anatomy.extend(json.loads(Path(p).read_text()).get('contexts',[]))
    contexts=[]
    for r in records:
        identity=(r['facing'],r['reviewLook'],r['cushion']);ident='%s-L%s-C%s'%identity
        matches=[e for e in expectations if e['context']['facing']==r['facing'] and e['context']['cushion']==r['cushion'] and e['context']['look']==r['look']]
        if len(matches)!=1: raise ValueError('Missing or duplicate independent context')
        e=matches[0]
        if e.get('uncertainties') or any(p['winner'] not in ['avatar','furniture'] for p in e['points']):raise ValueError('Numerical overlap uncertainty must be resolved before visual review')
        art,fig=r['art'],r['figure'];ox=math.floor(r['feet'][0]+.5)-fig['ax'];oy=math.floor(r['feet'][1]+.5)-fig['ay']
        beauty=Image.frombytes('RGBA',(art['w'],art['h']),bytes(art['rgba']));avatar=Image.frombytes('RGBA',(fig['w'],fig['h']),bytes(fig['rgba']))
        labels={(p['x'],p['y']):p['winner'] for p in e['points']}
        original={(x+ox,y+oy) for y in range(fig['h']) for x in range(fig['w']) if fig['rgba'][(y*fig['w']+x)*4+3]}
        visible={p for p in original if labels.get(p)!='furniture'}
        anatomy_matches=[c for c in anatomy if c['context']==e['context']]
        if len(anatomy_matches)!=1 or not anatomy_matches[0].get('anatomy',{}).get('hipContact'):
            raise ValueError('Exact original anatomy and support contact are required for every visual context')
        a=anatomy_matches[0]
        risks=topology_risks(original,visible,a['anatomy']['hipContact'])
        left=min(0,ox)-3;top=min(0,oy)-3;right=max(art['w'],ox+fig['w'])+3;bottom=max(art['h'],oy+fig['h'])+3
        source=Image.new('RGBA',(right-left,bottom-top),'#e9e7ed');source.alpha_composite(beauty,(-left,-top))
        unmasked=source.copy();unmasked.alpha_composite(avatar,(ox-left,oy-top));independent=source.copy()
        for x,y in visible: independent.putpixel((x-left,y-top),avatar.getpixel((x-ox,y-oy)))
        width,height=source.size;sheet=Image.new('RGB',(width*9, height*4+36),'#e9e7ed');draw=ImageDraw.Draw(sheet)
        for i,(name,img) in enumerate([('Original beauty',source),('Original body',unmasked),('Independent composition',independent)]):
            draw.text((i*width*3+3,2),name,fill='black');sheet.paste(img,(i*width*3,20));sheet.paste(img.resize((width*3,height*3),Image.Resampling.NEAREST),(i*width*3,30+height))
        sheet_path=output/f'{ident}.png';sheet.save(sheet_path)
        independent_path=output/f'{ident}-independent.png';independent.save(independent_path)
        crops=[]
        for risk in risks:
            if not risk['pixels']:continue
            xs,ys=zip(*risk['pixels']);bounds=(max(0,min(xs)-left-5),max(0,min(ys)-top-5),min(width,max(xs)-left+6),min(height,max(ys)-top+6))
            crop=independent.crop(bounds).resize(((bounds[2]-bounds[0])*12,(bounds[3]-bounds[1])*12),Image.Resampling.NEAREST);mark=ImageDraw.Draw(crop)
            for x,y in risk['pixels']:
                X=(x-left-bounds[0])*12;Y=(y-top-bounds[1])*12;mark.rectangle((X,Y,X+11,Y+11),outline='#ff3838',width=1)
            crop_path=output/f'{ident}-{risk["id"]}.png';crop.save(crop_path);risk['crop']=proof(crop_path,output);crops.append(crop_path)
        frame=next((q.get('finalCanvas') for q in records if q['facing']==r['facing'] and q['reviewLook']==r['reviewLook'] and q.get('finalCanvas')),None)
        if not frame:raise ValueError('Actual final-canvas evidence is missing')
        frame_path=output/f'{r["facing"]}-L{r["reviewLook"]}-actual.png'
        Image.frombytes('RGBA',(frame['rect']['width'],frame['rect']['height']),bytes(frame['actual'])).save(frame_path)
        all_paths.extend([sheet_path,independent_path,frame_path,*crops])
        contexts.append({'id':ident,'facing':r['facing'],'look':r['reviewLook'],'cushion':r['cushion'],'sourceContext':e['context'],'sheet':proof(sheet_path,output),'independentComposite':proof(independent_path,output),'actualCanvas':proof(frame_path,output),'risks':risks})
    manifest={'version':VERSION,'kind':'authored-seat-visual-review','scope':SCOPE,'key':contract['key'],'mechanicsDigest':contract['mechanicsDigest'],'surfaceDigests':contract['surfaceDigests'],
              'bundle':proof(bundle_path,output),'contract':proof(contract_path,output),'rendererSources':bundle['rendererSources'],
              'sourceInputs':[proof(Path(p),output) for p in source_inputs],'bindings':[proof(p,output) for p in dict.fromkeys(Path(p).resolve() for p in all_paths)],'contexts':contexts}
    path=output/'manifest.json';path.write_text(json.dumps(manifest,indent=2));return path


def validate(manifest_path, decision_path):
    try:
        manifest_path,decision_path=Path(manifest_path),Path(decision_path);m=json.loads(manifest_path.read_text());d=json.loads(decision_path.read_text())
        if m.get('version')!=VERSION or d.get('version')!=VERSION or d.get('manifestSha256')!=sha(manifest_path) or d.get('scope')!=SCOPE:raise ValueError('Visual evidence scope or binding is stale')
        for p in m['bindings']:checked(p,manifest_path.parent)
        if d.get('provenance',{}).get('kind') not in ['independent-vision','independent-human','independent-agent'] or not d['provenance'].get('reviewer'):raise ValueError('Independent visual reviewer identity is missing')
        local_contexts=[]
        if d['provenance']['kind']=='independent-vision':
            request=json.loads(checked(d['provenance']['request'],decision_path.parent).read_text())
            response=json.loads(checked(d['provenance']['response'],decision_path.parent).read_text())
            verify_request(m,sha(manifest_path),request,response,manifest_path.parent)
            if response.get('status')!='completed':raise ValueError('Visual provider response was incomplete')
            raw=json.loads(''.join(c.get('text','') for o in response.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text'))
            if raw.get('contexts')!=d.get('contexts'):raise ValueError('Visual decision differs from independent response')
        elif len(d['provenance'].get('reviews',[]))<2:raise ValueError('Two independent local visual reviews are required')
        else:
            reviewers=[]
            for p in d['provenance']['reviews']:
                local=json.loads(checked(p,decision_path.parent).read_text());reviewers.append(local.get('reviewer'))
                if local.get('manifestSha256')!=sha(manifest_path) or local.get('scope')!=SCOPE:raise ValueError('Local visual review does not approve this exact scope/context decision')
                local_contexts.append(local.get('contexts',[]))
            if any(not r for r in reviewers) or len(set(reviewers))!=len(reviewers):raise ValueError('Local visual reviewers must be distinct')
        problems=[]
        for contexts in [d['contexts'],*local_contexts]:
            ids=[c['id'] for c in contexts]
            if len(ids)!=len(set(ids)) or set(ids)!={c['id'] for c in m['contexts']}:raise ValueError('Visual context coverage is incomplete')
            for c in m['contexts']:
                v=next(v for v in contexts if v['id']==c['id']);risks={r['id'] for r in c['risks']};answers=v.get('risks',[])
                if v.get('verdict')!='pass' or v.get('issues') or v.get('uncertainties') or not v.get('reason'):problems.append(c['id']+': visual quality is not approved')
                if len(answers)!=len(risks) or len({a['id'] for a in answers})!=len(answers) or {a['id'] for a in answers}!=risks or any(a.get('verdict')!='acceptable' or not a.get('reason') for a in answers):problems.append(c['id']+': unresolved visual topology/contact risk')
        return problems
    except (OSError,ValueError,KeyError,TypeError) as error:return [str(error)]


def verify_request(m, identity, request, response, folder):
    if request.get('metadata',{}).get('seat_visual_manifest')!=identity or response.get('metadata',{}).get('seat_visual_manifest')!=identity:
        raise ValueError('Visual provider request/response belongs to another manifest')
    content=request.get('input',[{}])[0].get('content',[])
    if not content or identity not in content[0].get('text','') or SCOPE not in content[0].get('text',''):
        raise ValueError('Visual provider scope is not bound to this manifest')
    descriptions=[json.loads(c['text']) for c in content[1:] if c.get('type')=='input_text']
    if descriptions!=[{k:c[k] for k in ['id','facing','look','cushion','risks']} for c in m['contexts']]:
        raise ValueError('Visual provider context descriptions differ from exact evidence')
    expected=[]
    for c in m['contexts']:
        for p in [c['sheet'],c['actualCanvas'],*[r['crop'] for r in c['risks'] if r.get('crop')]]:
            expected.append('data:image/png;base64,'+base64.b64encode(checked(p,folder).read_bytes()).decode())
    if [c.get('image_url') for c in content if c.get('type')=='input_image']!=expected:
        raise ValueError('Visual provider request images differ from the exact bound evidence')


def schema():
    strings={'type':'array','items':{'type':'string'}}
    risk={'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'verdict':{'type':'string','enum':['acceptable','reject','unresolved']},'reason':{'type':'string'}},'required':['id','verdict','reason']}
    context={'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'verdict':{'type':'string','enum':['pass','fail','unresolved']},'reason':{'type':'string'},'issues':strings,'uncertainties':strings,'risks':{'type':'array','items':risk}},'required':['id','verdict','reason','issues','uncertainties','risks']}
    return {'type':'object','additionalProperties':False,'properties':{'contexts':{'type':'array','items':context}},'required':['contexts']}


def review(manifest_path, output, allow_paid=False, provider=None):
    """One bounded independent call. Mock provider supported; no automatic paid retries."""
    from seat_surfaces import MODEL,INPUT_USD,OUTPUT_USD
    import studio
    manifest_path,output=Path(manifest_path),Path(output);output.mkdir(parents=True,exist_ok=True);m=json.loads(manifest_path.read_text())
    for p in m['bindings']:checked(p,manifest_path.parent)
    identity=sha(manifest_path);target=output/identity;target.mkdir(exist_ok=True);response_path=target/'response.json';request_path=target/'request.json'
    content=[{'type':'input_text','text':f'Manifest SHA256: {identity}. Independently judge these authored seating composites. Scope: {SCOPE}. Numerical agreement is not quality approval. Original beauty and unmasked body are references. Reject clipping pinholes, detached limbs, floating contact, bad arms/back ordering, or unresolved visual risks. Explicitly assess comfortable seating depth and body scale against the entire usable cushion and backrest: reject a butt perched too far forward at the cushion edge or an excessive gap to the backrest even when every pixel comparison passes. The user rejected a previously numerically perfect red chair for sitting WAY TOO FAR FORWARD; treat that as a negative placement example, never as approved calibration. A topology flag is a question, not automatically a defect; explicitly explain every risk. Inspect every full composite and actual canvas. Return each context exactly once; never infer pass merely from an empty flag list.'}]
    for c in m['contexts']:
        content.append({'type':'input_text','text':json.dumps({k:c[k] for k in ['id','facing','look','cushion','risks']})})
        for p in [c['sheet'],c['actualCanvas'],*[r['crop'] for r in c['risks'] if r.get('crop')]]:
            content.append({'type':'input_image','image_url':'data:image/png;base64,'+base64.b64encode(checked(p,manifest_path.parent).read_bytes()).decode(),'detail':'high'})
    payload={'model':MODEL,'store':False,'metadata':{'seat_visual_manifest':identity},'reasoning':{'effort':'medium'},'max_output_tokens':16000,'input':[{'role':'user','content':content}],'text':{'format':{'type':'json_schema','name':'seat_visual_quality','strict':True,'schema':schema()}}}
    if request_path.exists() and json.loads(request_path.read_text())!=payload:raise RuntimeError('Cached visual request differs from current exact request')
    request_path.write_text(json.dumps(payload))
    if response_path.exists():response=json.loads(response_path.read_text())
    elif provider is not None:response=provider(payload);response_path.write_text(json.dumps(response))
    else:
        if not allow_paid:raise RuntimeError('Visual request prepared; paid review is disabled for this call')
        # Conservative preflight scales with actual image count and maximum completion;
        # a large full-film review must not use the old fixed small-call reservation.
        image_count=sum(c.get('type')=='input_image' for c in content)
        text_bytes=sum(len(c.get('text','').encode()) for c in content)
        reserved=((image_count*16384+text_bytes)*INPUT_USD+payload['max_output_tokens']*OUTPUT_USD)/1e6
        if studio.spent()+reserved>studio.cap():raise RuntimeError(f'Insufficient remaining visual review budget for complete evidence (reserved ${reserved:.2f})')
        start=time.time();response=studio.post(f'{studio.API}/responses',json=payload);response_path.write_text(json.dumps(response))
        usage=response.get('usage') or {};usd=(usage.get('input_tokens',0)*INPUT_USD+usage.get('output_tokens',0)*OUTPUT_USD)/1e6
        studio.log('seat-visual-review',argparse.Namespace(model=MODEL,quality='vision',size='all-contexts',count=1),{**usage,'usd':usd},time.time()-start,m['key'])
    if response.get('status')!='completed':raise RuntimeError('Incomplete visual review response; no approval')
    verify_request(m,identity,payload,response,manifest_path.parent)
    proposal=json.loads(''.join(c.get('text','') for o in response.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text'))
    decision={'version':VERSION,'manifestSha256':identity,'scope':SCOPE,'contexts':proposal['contexts'],'provenance':{'kind':'independent-vision','reviewer':MODEL,'request':proof(request_path,output),'response':proof(response_path,output),'reviewedAt':time.time()}}
    path=output/'decision.json';path.write_text(json.dumps(decision,indent=2));return path
