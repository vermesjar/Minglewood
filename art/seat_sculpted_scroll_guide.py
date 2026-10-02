"""Export a complete geometry-first recreation guide; never publish artwork.

Original beauty is a style reference. NEW alpha, role, depth and normal guides
come from one shared geometry and fixed original contacts in all four cameras.
"""
import argparse
import copy
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from seat_cushion_shell_experiment import shell
from seat_sculpted_scroll_compile import run as compile_geometry
from seat_rounded_diagnostic import ray,digest

COLORS={'seat':(68,146,210),'base':(142,95,175),'leg':(125,77,46),'arm':(230,143,62),'back':(70,156,108)}


def normal(part,point,direction):
    if part['kind']=='rounded-cuboid':
        b=np.array(part['bounds']);center=b.mean(axis=1);half=(b[:,1]-b[:,0])/2-part['radius'];n=point-center-np.clip(point-center,-half,half)
    else:
        v=np.array(part['vertices']);t=np.array(part['triangles']);A=v[t[:,0]];e1=v[t[:,1]]-A;e2=v[t[:,2]]-A;nn=np.cross(e1,e2);length=np.linalg.norm(nn,axis=1);delta=point-A
        d00=np.sum(e1*e1,axis=1);d01=np.sum(e1*e2,axis=1);d11=np.sum(e2*e2,axis=1);d20=np.sum(delta*e1,axis=1);d21=np.sum(delta*e2,axis=1);den=d00*d11-d01*d01;safe=np.abs(den)>1e-15
        u=np.divide(d11*d20-d01*d21,den,out=np.zeros_like(den),where=safe);w=np.divide(d00*d21-d01*d20,den,out=np.zeros_like(den),where=safe)
        inside=safe&(u>=-1e-7)&(w>=-1e-7)&(u+w<=1+1e-7)&(np.abs(np.sum(delta*nn,axis=1))<1e-6*np.maximum(length,1e-12));ids=np.flatnonzero(inside)
        if not len(ids):raise ValueError('Reference point lacks a matching triangle normal')
        n=nn[ids[0]]
    n=n/np.linalg.norm(n)
    return n if n@direction>=0 else -n


def run(inputs,review,out):
    review=Path(review);output=Path(out);output.mkdir(parents=True,exist_ok=True)
    # Classic unnotched cushion. Contact plane stays exactly z10.15.
    v,t=shell((.27,9.5,.05,.45),32);(output/'shell.json').write_text(json.dumps({'vertices':v.tolist(),'triangles':t.tolist()}))
    relative=(output/'shell.json').resolve().relative_to(review.resolve()).as_posix();compile_geometry(inputs,review,output,relative)
    report=json.loads((output/'report.json').read_text());decl=json.loads((output/'declaration.json').read_text());guide_inputs=output/'inputs';guide_inputs.mkdir(exist_ok=True);panels=[]
    for f in ['se','sw','ne','nw']:
        original=json.loads((Path(inputs)/(f+'.json')).read_text());data=copy.deepcopy(original);art=data['sourceArt'];w,h=art['width'],art['height'];rows=json.loads((output/(f+'-identity-depth.json')).read_text());rgba=np.zeros((h,w,4),np.uint8);normals=rgba.copy();partids=np.zeros((h,w),np.uint8);depth=np.zeros((h,w),np.uint16)
        reference=Image.frombytes('RGBA',(w,h),bytes(art['rgba']));reference.save(output/(f+'-original-style-reference.png'))
        for p in rows:
            x,y=p['x'],p['y'];z=p['referenceFrontZ'];p['opaque']=z is not None
            if z is None:continue
            part=decl['components'][p['referencePart']];rgba[y,x]=[*COLORS[part['role']],255];partids[y,x]=p['referencePart']+1;depth[y,x]=round(z*1000)
            o,d=ray(art['anchor'],[2,1],f,x+.5,y+.5);n=normal(part,np.array(o)+np.array(d)*z,np.array(d));normals[y,x]=[*np.round((n+1)*127.5).astype(np.uint8),255]
        Image.fromarray(rgba).save(output/(f+'-role-guide.png'));Image.fromarray(normals).save(output/(f+'-normal-guide.png'));Image.fromarray(partids).save(output/(f+'-part-id.png'));Image.fromarray(depth).save(output/(f+'-depth-milliunits.png'));Image.fromarray(rgba[:,:,3]).save(output/(f+'-alpha-guide.png'))
        art['rgba']=rgba.ravel().tolist();(guide_inputs/(f+'.json')).write_text(json.dumps(data));(output/(f+'-identity-depth.json')).write_text(json.dumps(rows))
        old=report['views'][f];report['views'][f]={**old,'originalBeautySha256':old['beautySha256'],'originalAlphaComparison':{'missing':old['missingOpaque'],'extra':old['extraAlpha']},'beautySha256':digest(art),'depthSha256':digest(rows),'opaque':int((rgba[:,:,3]>0).sum()),'missingOpaque':0,'extraAlpha':0}
        panel=Image.new('RGBA',(w*3,h+16),(38,39,44,255));panel.alpha_composite(reference,(0,16));panel.alpha_composite(Image.fromarray(rgba),(w,16));panel.alpha_composite(Image.fromarray(normals),(2*w,16));draw=ImageDraw.Draw(panel);draw.text((2,2),f.upper()+' reference / roles / normals',fill='white');panels.append(panel)
    sheet=Image.new('RGBA',(panels[0].width*2,panels[0].height*2),(38,39,44,255))
    for i,panel in enumerate(panels):sheet.alpha_composite(panel,((i%2)*panel.width,(i//2)*panel.height))
    sheet.resize((sheet.width*3,sheet.height*3),Image.Resampling.NEAREST).convert('RGB').save(output/'four-view-recreation-guide.png')
    report['status']='GEOMETRY_FIRST_GUIDE_NOT_FINISHED_BEAUTY_NOT_APPROVAL';report['sourceCodeSha256'][Path(__file__).name]=digest(Path(__file__).read_text());report['contactsPreserved']=decl['contacts'];report['limitations']=['Role colors are technical guides, not a proposed beauty replacement.','Original independent beauty-only uncertainty is preserved and does not approve regenerated art.','New painting must retain guide alpha/depth registration or regenerate geometry evidence; no silent artwork warping.'];(output/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for n in ['inputs','review','out']:p.add_argument('--'+n,required=True)
    a=p.parse_args();run(a.inputs,a.review,a.out)
