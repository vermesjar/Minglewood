"""Verify frozen material registration and compose all original body contexts."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from seat_rounded_visual_diagnostic import render

def run(frozen,material):
 frozen=Path(frozen);material=Path(material);checks={};panels=[];assets=[]
 assert (frozen/'declaration.json').read_bytes()==(material/'declaration.json').read_bytes()
 for f in ['se','sw','ne','nw']:
  src=json.loads((frozen/'inputs'/f'{f}.json').read_text());new=json.loads((material/'inputs'/f'{f}.json').read_text());assert src['contexts']==new['contexts'];a=src['sourceArt'];b=new['sourceArt'];assert {k:v for k,v in a.items() if k!='rgba'}=={k:v for k,v in b.items() if k!='rgba'}
  assert a['rgba'][3::4]==b['rgba'][3::4];assert (frozen/f'{f}-identity-depth.json').read_bytes()==(material/f'{f}-identity-depth.json').read_bytes()
  for suffix in ['clay-preview.png','original-style-reference.png','normal-guide.png','depth-milliunits.png','alpha-guide.png','part-id.png']:
   p=(frozen/f'{f}-{suffix}').resolve();assets.append({'facing':f,'kind':suffix,'absolutePath':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  for c in new['contexts']:
   name=c['id'];old=json.loads((frozen/'body'/f'{name}.json').read_text());actual=json.loads((material/'body'/f'{name}.json').read_text());assert old['points']==actual['points'];out=material/'visual'/name;render(material/'inputs'/f'{f}.json',material/'body'/f'{name}.json',out);im=Image.open(out/'fitted.png');p=Image.new('RGB',(im.width*4,im.height*4+20),(38,39,44));p.paste(im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST),(0,20));ImageDraw.Draw(p).text((3,3),name,fill='white');panels.append(p)
  checks[f]={'sourceAlphaExact':True,'depthAndPartRowsByteExact':True,'originalBodyContextsExact':True,'all8WinnerPointsExact':True}
 width=max(p.width for p in panels);height=max(p.height for p in panels)
 for k,f in enumerate(['se','sw','ne','nw']):
  sheet=Image.new('RGB',(width*4,height*2),(38,39,44))
  for i,p in enumerate(panels[k*8:k*8+8]):sheet.paste(p,((i%4)*width,(i//4)*height))
  sheet.save(material/f'all8-{f}.png')
 (material/'registration-validation.json').write_text(json.dumps({'status':'EXACT_MATERIAL_REGISTRATION_NOT_BEAUTY_APPROVAL','declarationByteExact':True,'checks':checks},indent=2));(material/'frozen-guide-assets.json').write_text(json.dumps(assets,indent=2))
 print('Exact alpha, declaration, depth, part ownership and all32 winner points preserved.')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--frozen',required=True);p.add_argument('--material',required=True);a=p.parse_args();run(a.frozen,a.material)
