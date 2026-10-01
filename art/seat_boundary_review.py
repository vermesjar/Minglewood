"""Render a blinded paired review from exact final game-canvas captures.

Never reads candidate model files, source option specifications, or the private
random option mapping. It creates evidence, not a preference or publication.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw


def records(directory, key):
    path=directory/(key+'.json')
    rows=json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(rows,list) or not rows:raise ValueError('Expected completed nonempty capture array')
    receipt=json.loads((directory/'capture-receipt.json').read_text(encoding='utf-8'))
    actual_hash=hashlib.sha256(path.read_bytes()).hexdigest()
    if receipt.get('unchanged') is not True or receipt.get('captures',{}).get(path.name)!=actual_hash:
        raise ValueError('Incomplete, stale or altered capture receipt')
    frames={(r['facing'],r['reviewLook']):r['finalCanvas'] for r in rows if r.get('finalCanvas')}
    result={}
    for r in rows:
        identity=(r['facing'],r['cushion'],r['reviewLook'])
        if identity in result:raise ValueError('Duplicate capture context')
        canvas=frames.get((r['facing'],r['reviewLook']))
        if not canvas or not canvas.get('passed'):raise ValueError('Final canvas did not match independent compositing')
        result[identity]={**r,'_reviewCanvas':canvas}
    return result,{'capture':str(path.resolve()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'receiptSha256':hashlib.sha256((directory/'capture-receipt.json').read_bytes()).hexdigest(),'receipt':receipt}


def make_review(a_dir,b_dir,key,out):
    a,ap=records(a_dir,key);b,bp=records(b_dir,key)
    if set(a)!=set(b):raise ValueError('Paired capture context domains differ')
    if ap['receipt'].get('rendererSources')!=bp['receipt'].get('rendererSources'):
        raise ValueError('Paired trials used different renderer sources')
    out.mkdir(parents=True,exist_ok=True)
    summary=[]
    for identity in sorted(a):
        first,second=a[identity],b[identity]
        # A meaningful blind trial changes surface ownership only. Do not let
        # different avatar anatomy, placement, source art or crop bias a vote.
        for field in ['facing','cushion','pose','look','legs','feet','height','canvasPlacement','canvasSize','art']:
            if first[field]!=second[field]:raise ValueError(f'Paired source/context mismatch: {identity} {field}')
        for field in ['w','h','ax','ay','rgba','owner']:
            if first['figure'][field]!=second['figure'][field]:raise ValueError(f'Paired original figure mismatch: {identity} {field}')
        ca,cb=first['_reviewCanvas'],second['_reviewCanvas']
        if ca['rect']!=cb['rect']:raise ValueError('Paired final canvas crops differ')
        rect=ca['rect'];w,h=rect['width'],rect['height']
        imgs=[Image.frombytes('RGBA',(w,h),bytes(c['actual'])) for c in [ca,cb]]
        diffs=sum(ca['actual'][i:i+4]!=cb['actual'][i:i+4] for i in range(0,w*h*4,4))
        face,cushion,look=identity
        stem=f'{face}-cushion{cushion}-look{look}'
        # The final frame contains all cushions. Retain per-context provenance;
        # render each unique facing/outfit frame once to keep the review usable.
        if cushion==min(k[1] for k in a if k[0]==face and k[2]==look):
            for scale,label in [(1,'native'),(3,'enlarged')]:
                gap,header=16,24
                sheet=Image.new('RGBA',(w*scale*2+gap,h*scale+header),(33,30,39,255))
                draw=ImageDraw.Draw(sheet)
                for index,img in enumerate(imgs):
                    x=index*(w*scale+gap)
                    draw.text((x+4,4),f"{'A' if index==0 else 'B'} | {face} | look {look} | exact canvas {scale}x",fill='white')
                    sheet.paste(img.resize((w*scale,h*scale),Image.Resampling.NEAREST),(x,header))
                sheet.save(out/f'{face}-look{look}-{label}.png')
        summary.append({'facing':face,'cushion':cushion,'look':look,'finalCanvasPixelDifferences':diffs,
            'native':f'{face}-look{look}-native.png','enlarged':f'{face}-look{look}-enlarged.png'})
    manifest={'status':'BLIND_REVIEW_REQUIRED','scope':'Exact final game canvas, native and nearest-neighbor 3x. No private option mapping read. No preference or approval assigned.',
        'A':ap,'B':bp,'contexts':summary}
    (out/'review-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    return {'contexts':len(summary),'uniqueFrames':len({(s['facing'],s['look']) for s in summary}),'out':str(out)}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--a',type=Path,required=True);parser.add_argument('--b',type=Path,required=True)
    parser.add_argument('--key',required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(make_review(args.a,args.b,args.key,args.out)))
