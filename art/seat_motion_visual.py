"""Independent review of every recorded movement state; no inferred aesthetic approval."""
import base64,io,json,time,argparse
from pathlib import Path
from PIL import Image,ImageDraw
from seat_visual_review import sha,proof,checked,schema
SCOPE='Every recorded changed state in all four facings and four outfits: approach, contact, every cushion change and exit; body continuity, believable movement, comfortable seat depth, support contact and arm/back ordering. Numerical exterior and settled checks do not approve transition appearance.'


def prepare(result_path,bundle_path,contract_path,output=None):
    result_path,bundle_path,contract_path=map(Path,(result_path,bundle_path,contract_path));output=Path(output or bundle_path.parent/'motion-visual-review');output.mkdir(parents=True,exist_ok=True)
    result=json.loads(result_path.read_text());bundle=json.loads(bundle_path.read_text());contract=json.loads(contract_path.read_text())
    if result.get('state')!='INVARIANTS_PASSED_VISUAL_PENDING':raise ValueError('Complete motion invariants are required before visual review')
    for name,digest in result['bindings'].items():
        if sha(name)!=digest:raise ValueError('Motion input changed: '+name)
    artifacts=[checked(p,result_path.parent) for p in result['artifacts']]
    checker=next(p for p in artifacts if p.name=='motion-independent-check.json');verdict=json.loads(checker.read_text())
    if not verdict.get('invariantsPassed') or not verdict.get('requiredComplete') or verdict.get('problems'):raise ValueError('Complete motion checker rejected capture')
    contexts=[]
    for film_path in sorted(p for p in artifacts if p.name.endswith('-film.json')):
        film=json.loads(film_path.read_text());ident=f"{film['facing']}-L{film['reviewLook']}"
        if film['key']!=contract['key'] or film['rendererSources']!=bundle['rendererSources']:raise ValueError('Motion capture belongs to different source/runtime')
        art_path=output/f'{ident}-art.png';art_path.write_bytes(base64.b64decode(film['art']['png'].split(',',1)[1]))
        frames=[];pages=[]
        for i,frame in enumerate(film['frames']):
            raw=base64.b64decode(frame['png'].split(',',1)[1]);path=output/f'{ident}-{i:04}.png';path.write_bytes(raw);frames.append(proof(path,output))
        for start in range(0,len(frames),8):
            images=[Image.open(checked(p,output)).convert('RGBA') for p in frames[start:start+8]];w=max(p.width for p in images);h=max(p.height for p in images)
            page=Image.new('RGBA',(w*8,h*6+60),'#e9e7ed');draw=ImageDraw.Draw(page)
            for j,img in enumerate(images):
                row,col=divmod(j,4);x=col*w*2;y=row*(h*3+30);draw.text((x,y),f"{start+j}: {film['frames'][start+j]['state']['phase']}",fill='black');page.alpha_composite(img,(x,y+20));page.alpha_composite(img.resize((img.width*2,img.height*2),Image.Resampling.NEAREST),(x,y+20+h))
            # Native pages retain every exact pixel; individual frame files supply arbitrary magnification.
            path=output/f'{ident}-page-{start//8}.png';page.save(path);pages.append({'start':start,'count':len(images),'image':proof(path,output)})
        contexts.append({'id':ident,'film':proof(film_path,output),'art':proof(art_path,output),'frames':frames,'pages':pages,'risks':[]})
    if {c['id'] for c in contexts}!={f'{f}-L{l}' for f in ['se','sw','ne','nw'] for l in range(4)} or len(contexts)!=16:raise ValueError('Motion visual review requires exactly16 films')
    manifest={'version':1,'kind':'seat-motion-visual-review','scope':SCOPE,'key':contract['key'],'mechanicsDigest':contract['mechanicsDigest'],'result':proof(result_path,output),'bundle':proof(bundle_path,output),'contract':proof(contract_path,output),'checker':proof(checker,output),'generator':proof(Path(__file__),output),'contexts':contexts}
    path=output/'manifest.json';path.write_text(json.dumps(manifest,indent=2));return path


def review(manifest_path,output,allow_paid=False,provider=None):
    from seat_surfaces import MODEL,INPUT_USD,OUTPUT_USD
    import studio
    manifest_path,output=Path(manifest_path),Path(output);m=json.loads(manifest_path.read_text());identity=sha(manifest_path);target=output/identity;target.mkdir(parents=True,exist_ok=True)
    content=[{'type':'input_text','text':f'Manifest SHA256 {identity}. Scope: {SCOPE}. Judge every frame in order, not just endpoints. Reject penetration, popping/disconnected limbs, hovering, implausible contact or perched-forward seating. Every film needs its own explicit reason. If any transition cannot be assessed, return unresolved, never assume pass. Pages show every original captured frame; inspect all of them. Risks is empty because this is whole-film visual review, not a topology detector.'}]
    for c in m['contexts']:
        content.append({'type':'input_text','text':json.dumps({'id':c['id'],'frames':len(c['frames'])})})
        for page in c['pages']:content.append({'type':'input_image','image_url':'data:image/png;base64,'+base64.b64encode(checked(page['image'],manifest_path.parent).read_bytes()).decode(),'detail':'high'})
    payload={'model':MODEL,'store':False,'metadata':{'seat_motion_manifest':identity},'reasoning':{'effort':'medium'},'max_output_tokens':16000,'input':[{'role':'user','content':content}],'text':{'format':{'type':'json_schema','name':'seat_motion_quality','strict':True,'schema':schema()}}}
    request=target/'request.json';response_path=target/'response.json'
    if request.exists() and json.loads(request.read_text())!=payload:raise ValueError('Motion request cache differs')
    request.write_text(json.dumps(payload))
    if response_path.exists():response=json.loads(response_path.read_text())
    elif provider is not None:response=provider(payload);response_path.write_text(json.dumps(response))
    else:
        if not allow_paid:raise RuntimeError('Motion visual request prepared; paid review disabled')
        # Conservative preflight scales with actual image count and maximum completion;
        # a large full-film review must not use the old fixed small-call reservation.
        image_count=sum(c.get('type')=='input_image' for c in content)
        text_bytes=sum(len(c.get('text','').encode()) for c in content)
        reserved=((image_count*16384+text_bytes)*INPUT_USD+payload['max_output_tokens']*OUTPUT_USD)/1e6
        if studio.spent()+reserved>studio.cap():raise RuntimeError(f'Insufficient remaining visual review budget for complete evidence (reserved ${reserved:.2f})')
        start=time.time();response=studio.post(f'{studio.API}/responses',json=payload);response_path.write_text(json.dumps(response));usage=response.get('usage') or {};usd=(usage.get('input_tokens',0)*INPUT_USD+usage.get('output_tokens',0)*OUTPUT_USD)/1e6;studio.log('seat-motion-visual',argparse.Namespace(model=MODEL,quality='vision',size='all-frames',count=1),{**usage,'usd':usd},time.time()-start,m['key'])
    if response.get('status')!='completed' or response.get('metadata',{}).get('seat_motion_manifest')!=identity:raise ValueError('Motion provider response is incomplete or belongs to different images')
    raw=json.loads(''.join(c.get('text','') for o in response.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text'))
    d={'version':1,'manifestSha256':identity,'scope':SCOPE,'contexts':raw['contexts'],'provenance':{'kind':'independent-vision','reviewer':MODEL,'request':proof(request,output),'response':proof(response_path,output)}};path=output/'decision.json';path.write_text(json.dumps(d,indent=2));return path


def validate(manifest_path,decision_path):
    # Use the identical common publication verifier, including every frame and source binding.
    import subprocess
    if Path(decision_path).resolve()!=Path(manifest_path).parent.joinpath('decision.json').resolve():return ['Motion decision must be the exact manifest-folder decision artifact']
    root=Path(__file__).resolve().parent.parent;m=json.loads(Path(manifest_path).read_text());folder=Path(manifest_path).parent
    command=['node','--no-maglev','--import','tsx','scripts/seat-motion-verify.ts',str(checked(m['bundle'],folder)),str(checked(m['contract'],folder)),str(folder)]
    result=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8')
    try:return json.loads(result.stdout)['problems']
    except Exception:return ['Motion evidence verification failed: '+result.stderr[-2000:]]
