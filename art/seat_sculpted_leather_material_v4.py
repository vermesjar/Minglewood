"""World-space leather material over frozen source-owned geometry; no displacement."""
import argparse,copy,json,math,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from seat_rounded_diagnostic import ray,digest
from seat_sculpted_proportioned_guide import normal
from seat_rounded_reference import interval
from seat_cushion_shell_reference import ray_depth

LIGHT=np.array([-.35,-.50,.85]);LIGHT/=np.linalg.norm(LIGHT)

def coordinates(part,p):
 name=part.get('name','');role=part['role']
 if 'scroll end' in name:
  center=np.array(part['authoringProfile']['center']);delta=p-center
  return p[1],math.atan2(delta[2],delta[0])*2.75
 if 'back crown' in name:
  b=np.array(part['bounds']);center=b.mean(axis=1)
  return p[0],math.atan2(p[2]-center[2],p[1]-center[1])*2.75
 return (p[0],p[2]) if role=='back' else (p[1],p[2])

def tuft(part,p):
 s,t=coordinates(part,p);a=s/7.6+t/7.0;b=s/7.6-t/7.0
 return math.sin(math.pi*a)**2*math.sin(math.pi*b)**2

def material(part,p,n,view,shadow):
 role=part['role'];name=part.get('name','');grain=math.sin(p@np.array([21.17,47.31,17.19]))*math.sin(p@np.array([37.7,13.11,29.73]));color=np.array([106.,111.,51.]);seam=1.;ns=n.copy();trim=0.
 tufted=(('scroll end' in name and abs(n[1])<.45) or ('back crown' in name and abs(n[0])<.45) or (role=='back' and n[1]<-.2))
 if tufted:
  h=tuft(part,p);gradient=np.array([(tuft(part,p+np.eye(3)[i]*.015)-tuft(part,p-np.eye(3)[i]*.015))/.03 for i in range(3)])*.30
  gradient-=n*(gradient@n);ns=n-gradient;ns/=np.linalg.norm(ns);seam=.91+.09*min(1.,h/.12)
  ss,tt=coordinates(part,p);aa=ss/7.6+tt/7.0;bb=ss/7.6-tt/7.0;button=math.exp(-(math.sin(math.pi*aa)**2+math.sin(math.pi*bb)**2)/.10);seam*=1-.80*button
 if role=='seat':
  b=np.array(part['bounds']);d=min(p[0]-b[0,0],b[0,1]-p[0],p[1]-b[1,0],b[1,1]-p[1]);trim=math.exp(-((d-.62)/.10)**2)*max(0.,n[2])
 elif role in ['arm','back'] and 'panel' in name:
  b=np.array(part['bounds']);trim=math.exp(-((p[2]-(b[2,0]+.7))/.12)**2)*.65
 if role=='leg':
  color=np.array([113.,55.,22.]);seam=.9+.1*math.sin(p[2]*8.+math.sin(p[0]*12.));grain*=.4
 diffuse=max(0.,ns@LIGHT);half=LIGHT+view;half/=np.linalg.norm(half);spec=max(0.,ns@half)**10
 intensity=.44+(.68*diffuse+.15*spec)*(1.-.42*shadow)
 if role=='seat':intensity+=.07*max(0.,n[2])
 rgb=color*intensity*seam*(1+.007*grain)+np.array([19.,17.,9.])*spec*(1-shadow*.85)+np.array([12.,11.,6.])*trim
 # Deliberate native pixel palette steps, no screen-coordinate noise or alpha edits.
 return np.clip(np.round(rgb/3)*3,0,255).astype(np.uint8)

def run(source,out):
 source=Path(source);out=Path(out);out.mkdir(parents=True,exist_ok=True);(out/'inputs').mkdir(exist_ok=True)
 decl=json.loads((source/'declaration.json').read_text());report=json.loads((source/'report.json').read_text());panels=[];checks={}
 for f in ['se','sw','ne','nw']:
  data=json.loads((source/'inputs'/f'{f}.json').read_text());art=data['sourceArt'];rows=json.loads((source/f'{f}-identity-depth.json').read_text());visible=[r for r in rows if r['referenceFrontZ'] is not None];points=[];normals=[];views=[]
  for r in visible:
   o,d=ray(art['anchor'],[2,1],f,r['x']+.5,r['y']+.5);d=np.array(d);p=np.array(o)+d*r['referenceFrontZ'];points.append(p);normals.append(normal(decl['components'][r['referencePart']],p,d));views.append(d/np.linalg.norm(d))
  points=np.array(points);normals=np.array(normals);origins=points+normals*.015;directions=np.broadcast_to(LIGHT,origins.shape);shadow=np.zeros(len(points),bool)
  for part in decl['components']:
   if part['kind']=='triangle-mesh':shadow|=ray_depth(np.array(part['vertices']),np.array(part['triangles']),origins,directions)>.02
   else:shadow|=np.array([bool(h and h[1]>.02) for o in origins for h in [interval(part['bounds'],part['radius'],o,LIGHT)]])
  rgba=np.zeros((art['height'],art['width'],4),np.uint8)
  for i,r in enumerate(visible):rgba[r['y'],r['x']]=[*material(decl['components'][r['referencePart']],points[i],normals[i],views[i],shadow[i]),255]
  alpha=np.array(Image.open(source/f'{f}-alpha-guide.png'));assert np.array_equal(rgba[:,:,3],alpha)
  Image.fromarray(rgba).save(out/f'{f}-material.png');art['rgba']=rgba.ravel().tolist();(out/'inputs'/f'{f}.json').write_text(json.dumps(data));shutil.copyfile(source/f'{f}-identity-depth.json',out/f'{f}-identity-depth.json')
  report['views'][f]['beautySha256']=digest(art);checks[f]={'alphaExact':True,'depthSha256':digest(rows),'beautySha256':digest(art),'shadowedPixels':int(shadow.sum())}
  original=Image.open(source/f'{f}-original-style-reference.png');clay=Image.open(source/f'{f}-clay-preview.png');panel=Image.new('RGBA',(art['width']*3,art['height']+12),(38,39,44,255));panel.alpha_composite(original,(0,12));panel.alpha_composite(clay,(art['width'],12));panel.alpha_composite(Image.fromarray(rgba),(art['width']*2,12));ImageDraw.Draw(panel).text((2,1),f.upper()+' original / frozen clay / material',fill='white');panels.append(panel);print(f,checks[f],flush=True)
 report['status']='MATERIAL_ONLY_CANDIDATE_NOT_APPROVAL';report['sourceCodeSha256'][Path(__file__).name]=digest(Path(__file__).read_text());report['material']={'basis':'declared surface shading intent','geometryDisplacement':0,'tufting':'normal/albedo detail only, not deep geometric tufts','piping':'flush albedo stripe, not protruding cord','lightWorld':LIGHT.tolist(),'inputDeclarationSha256':digest(decl),'checks':checks};(out/'report.json').write_text(json.dumps(report,indent=2));shutil.copyfile(source/'declaration.json',out/'declaration.json')
 sheet=Image.new('RGBA',(panels[0].width*2,panels[0].height*2),(38,39,44,255))
 for i,p in enumerate(panels):sheet.alpha_composite(p,((i%2)*p.width,(i//2)*p.height))
 sheet.convert('RGB').save(out/'four-view-material-review-native.png')
 sheet.resize((sheet.width*4,sheet.height*4),Image.Resampling.NEAREST).convert('RGB').save(out/'four-view-material-review.png')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();run(a.source,a.out)
