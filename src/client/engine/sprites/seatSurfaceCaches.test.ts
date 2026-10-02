import { describe, expect, it } from 'vitest';
import { drawingPrint, FIG, figAx } from '@shared/world/seatFigure';
import { SEAT_LOOKS, type SeatModel, type SeatSurfaceMap } from '@shared/world/seatModels';
import { renderAvatarLayers } from './avatarQa';
import { seatLayers, sitterMask } from './seatLayers';
import { surfacePartsSignature, type ModelView } from './seatModel';

function fixture() {
  const model:SeatModel={size:[1,1],sits:[[0.5,0.4,10]],parts:[
    {part:'seat',u:[0,1],v:[0,1],z:[8,10]},
    {part:'back',u:[0,1],v:[0.7,0.9],z:[8,40]},
  ]};
  const x=40,y=70,index=y*FIG.w+x;
  const px={w:FIG.w,h:FIG.h,d:new Uint8Array(FIG.w*FIG.h*4)};
  px.d.set([80,120,30,255],index*4);
  const map:SeatSurfaceMap={version:1,width:px.w,height:px.h,drawing:drawingPrint(px.w,px.h,px.d),
    modelParts:surfacePartsSignature(model),labels:new Array<number>(FIG.w*FIG.h).fill(0)};
  map.labels[index]=1;
  model.surfaces={nw:map};
  const view:ModelView={model,style:'chair',facing:'nw',art:{px,ax:0,ay:100}};
  const mask=()=>sitterMask(view,SEAT_LOOKS[0],'nw','sit',[figAx('nw'),FIG.feet],undefined,10);
  expect(renderAvatarLayers(SEAT_LOOKS[0],'nw','sit').px[index*4+3]).toBe(255);
  return {view,map,index,mask};
}

describe('semantic validation through real renderer caches',()=>{
  for(const mutation of ['drawing','geometry','missing-view'] as const) it(`rejects ${mutation} changes after both entry caches are warm`,()=>{
    const {view,mask}=fixture();
    seatLayers(view);mask();
    if(mutation==='drawing') view.art.px.d[40*4+70*FIG.w*4]++;
    else if(mutation==='geometry') view.model.parts[0].z[1]++;
    else view.model.surfaces={};
    expect(()=>seatLayers(view)).toThrow();
    expect(mask).toThrow();
  });
  it('recomputes a valid in-place surface relabel, including the resulting pixel winner',()=>{
    const {view,map,index,mask}=fixture();
    const oldLayers=seatLayers(view),oldMask=mask();
    expect(oldMask[index]).toBe(0);
    map.labels[index]=4; // Same source, now explicitly identified as the foreground back top.
    const nextLayers=seatLayers(view),nextMask=mask();
    expect(nextLayers).not.toBe(oldLayers);
    expect(nextLayers.part[index]).toBe(1);
    expect(nextMask).not.toBe(oldMask);
    expect(nextMask[index]).toBe(1);
    expect(mask()).toBe(nextMask); // Unchanged revisions still reuse the bounded cache.
  });
  it('does not retain a proxy mask after valid semantics are attached to the same view',()=>{
    const {view,map,index,mask}=fixture();
    delete view.model.surfaces;
    const proxy=mask();
    map.labels[index]=4;
    view.model.surfaces={nw:map};
    const semantic=mask();
    expect(semantic).not.toBe(proxy);
    expect(semantic[index]).toBe(1);
  });
});
