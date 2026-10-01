"""Compose frozen analytical diagnostics from original pixels, not runtime masks."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image,ImageDraw


def render(source_path,body_path,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    data=json.loads(Path(source_path).read_text());review=json.loads(Path(body_path).read_text())
    c=next(c for c in data['contexts'] if c['id']==review['context']);a=data['sourceArt'];f=c['figure']
    source=Image.frombytes('RGBA',(a['width'],a['height']),bytes(a['rgba']))
    body=Image.frombytes('RGBA',(f['w'],f['h']),bytes(f['rgba']));feet=c['context']['figureContext']['feet']
    ox,oy=math.floor(feet[0]+.5)-f['ax'],math.floor(feet[1]+.5)-f['ay'];pad=max(0,-(body.getbbox()[1]+oy)+4)
    background=Image.new('RGBA',(a['width'],a['height']+pad),(38,39,44,255));background.alpha_composite(source,(0,pad))
    original=background.copy();original.alpha_composite(body,(ox,oy+pad));fitted=background.copy()
    points={(p['x'],p['y']):p for p in review['points']}
    for fy in range(f['h']):
        for fx in range(f['w']):
            pixel=body.getpixel((fx,fy));x,y=fx+ox,fy+oy
            if not pixel[3] or not(0<=x<fitted.width and 0<=y+pad<fitted.height):continue
            point=points.get((x,y));winner=point['winner'] if point else 'avatar'
            if winner=='avatar':fitted.putpixel((x,y+pad),pixel)
            elif winner=='unresolved':fitted.putpixel((x,y+pad),(255,0,190,255))
    flagged=original.copy();wc={(q['x'],q['y']) for q in review['priorIndependentComparison']['winnerConflicts']}
    rc={(q['x'],q['y']) for q in review['priorIndependentComparison']['roleConflicts']}
    for x,y in wc|rc:flagged.putpixel((x,y+pad),(255,140,0,255) if (x,y) in wc&rc else (255,40,40,255) if (x,y) in wc else (255,230,0,255))
    panels=[('Original beauty',background),('Original UNMASKED body',original),('Frozen fitted depth; magenta unresolved',fitted),('Red winner; yellow role; orange both',flagged)]
    sheet=Image.new('RGB',(background.width*6*4,background.height*6+30),(38,39,44))
    for index,(title,im) in enumerate(panels):
        im.save(out/(['source','unmasked','fitted','flagged'][index]+'.png'))
        sheet.paste(im.resize((im.width*6,im.height*6),Image.Resampling.NEAREST),(index*im.width*6,30))
        ImageDraw.Draw(sheet).text((index*im.width*6+5,9),title,fill='white')
    sheet.save(out/(c['id']+'-sheet.png'))
    crop_points=wc|rc or {(p['x'],p['y']) for p in review['points'] if p['winner']=='unresolved'} or {(0,0),(a['width']-1,a['height']-1)}
    bounds=[min(x for x,y in crop_points)-2,min(y for x,y in crop_points)-2,max(x for x,y in crop_points)+3,max(y for x,y in crop_points)+3]
    for name,im in [('unmasked',original),('fitted',fitted),('flagged',flagged),('source',background)]:
        x0,y0,x1,y1=bounds;crop=im.crop((x0,y0+pad,x1,y1+pad));scale=22
        grid=Image.new('RGB',(crop.width*scale+35,crop.height*scale+30),(235,235,235));grid.paste(crop.resize((crop.width*scale,crop.height*scale),Image.Resampling.NEAREST),(35,30));draw=ImageDraw.Draw(grid)
        for x in range(x0,x1+1):
            X=35+(x-x0)*scale;draw.line((X,30,X,grid.height),fill='#808080');draw.text((X,5),str(x),fill='black')
        for y in range(y0,y1+1):
            Y=30+(y-y0)*scale;draw.line((35,Y,grid.width,Y),fill='#808080');draw.text((3,Y),str(y),fill='black')
        grid.save(out/(name+'-conflict-grid.png'))
    (out/'coordinates.json').write_text(json.dumps({'context':c['id'],'sourceTopPadding':pad,'bodyOffset':[ox,oy],'crop':bounds,
        'winnerConflicts':sorted(wc),'roleConflicts':sorted(rc),'unresolvedConvention':'Magenta means no declared surface; never an approved winner.'},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--body',required=True);p.add_argument('--out',required=True);a=p.parse_args()
    render(a.source,a.body,a.out)
