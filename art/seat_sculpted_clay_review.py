"""Clay-only visual review from declared normals and frozen body depth decisions."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from seat_rounded_visual_diagnostic import render

def run(root):
 root=Path(root);decl=json.loads((root/'declaration.json').read_text());panels=[];beauty=[]
 for facing in ['se','sw','ne','nw']:
  data=json.loads((root/'inputs'/f'{facing}.json').read_text());a=data['sourceArt'];normals=np.array(Image.open(root/f'{facing}-normal-guide.png'))[:,:,:3]/127.5-1;ids=np.array(Image.open(root/f'{facing}-part-id.png'));light=np.array([-.3,-.5,.8]);light/=np.linalg.norm(light);shade=.4+.6*np.maximum(0,normals@light);col=np.zeros((a['height'],a['width'],4),np.uint8)
  for pid in np.unique(ids):
   if not pid:continue
   color=[133,79,36] if decl['components'][pid-1]['role']=='leg' else [128,142,42];mask=ids==pid;col[mask,:3]=np.clip(np.array(color)*shade[mask,None],0,255);col[mask,3]=255
  Image.fromarray(col).save(root/f'{facing}-clay-preview.png');a['rgba']=col.ravel().tolist();(root/f'{facing}-clay-input.json').write_text(json.dumps(data))
  original=Image.open(root/f'{facing}-original-style-reference.png');p=Image.new('RGBA',(a['width']*2,a['height']+12),(38,39,44,255));p.alpha_composite(original,(0,12));p.alpha_composite(Image.fromarray(col),(a['width'],12));ImageDraw.Draw(p).text((2,1),facing.upper()+' original / sculpt clay',fill='white');beauty.append(p)
  for context in data['contexts']:
   name=context['id'];out=root/'visual'/name;render(root/f'{facing}-clay-input.json',root/'body'/f'{name}.json',out);im=Image.open(out/'fitted.png');panel=Image.new('RGB',(a['width']*4,im.height*4+20),(38,39,44));panel.paste(im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST),(0,20));ImageDraw.Draw(panel).text((3,3),name,fill='white');panels.append(panel)
 width=max(p.width for p in panels);height=max(p.height for p in panels)
 for k,f in enumerate(['se','sw','ne','nw']):
  sheet=Image.new('RGB',(width*4,height*2),(38,39,44))
  for i,p in enumerate(panels[k*8:k*8+8]):sheet.paste(p,((i%4)*width,(i//4)*height))
  sheet.save(root/f'all8-{f}.png')
 sheet=Image.new('RGBA',(beauty[0].width*2,beauty[0].height*2),(38,39,44,255))
 for i,p in enumerate(beauty):sheet.alpha_composite(p,((i%2)*p.width,(i//2)*p.height))
 sheet.resize((sheet.width*4,sheet.height*4),Image.Resampling.NEAREST).convert('RGB').save(root/'four-view-original-versus-clay.png')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);run(p.parse_args().root)
