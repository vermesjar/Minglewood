import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {SEAT_LOOKS} from '@shared/world/seatModels';
import {NATURAL_LEGS,type SitLegs} from '@shared/world/sitLegs';
import {SIT_POSE_OF} from '@shared/world/seats';
import {renderAvatarLayers} from './avatarQa';
import {avatarSurfaceDepth} from './avatarSurfaceDepth';
import {garmentHeight,garmentTriangles} from './avatarGarmentDepth';
import type {Pose} from './avatarFrame';
const observed=JSON.parse(readFileSync('tests/fixtures/seating-skirt-observed.json','utf8'));

describe('original lower-garment authored coverage',()=>{
 it('covers skirt, long skirt, dress and coats across standing, walking and every seated style without changing original pixels',()=>{
  const variants=[{bottom:'bottom.skirt'},{bottom:'bottom.longskirt'},{top:'top.dress'},{top:'top.raincoat'},{top:'top.labcoat'}];
  const poses:Array<[Pose,SitLegs|undefined]>=[['stand',undefined],['walk1',undefined],['crouch',undefined],...Object.entries(SIT_POSE_OF).map(([style,pose])=>[pose,NATURAL_LEGS[style as keyof typeof NATURAL_LEGS]] as [Pose,SitLegs])];
  let checked=0;
  for(const variant of variants)for(const shoes of ['shoes.slippers','shoes.boots','shoes.sneakers'])for(const [pose,legs] of poses){
   const look={...SEAT_LOOKS[0],...variant,shoes,pet:'pet.none'};
   for(const [a,b]of [['se','sw'],['ne','nw']] as const){
    const figure=renderAvatarLayers(look,a,pose as Pose,legs),before=Array.from(figure.px),depth=avatarSurfaceDepth(look,a,pose as Pose,legs),mirror=avatarSurfaceDepth(look,b,pose as Pose,legs);
    expect(figure.lowerGarment).toBeDefined();
    for(let i=0;i<figure.owner.length;i++)if(figure.owner[i]===6&&figure.lowerGarment!.mask[i]){
     expect(Number.isFinite(depth.z[i]),`${JSON.stringify(variant)} ${shoes} ${a} ${pose} ${i%88},${Math.floor(i/88)}`).toBe(true);
     const mirrored=Math.floor(i/88)*88+87-i%88;
     expect(mirror.z[mirrored]).toBeCloseTo(depth.z[i],8);checked++;
    }
    expect(Array.from(renderAvatarLayers(look,a,pose as Pose,legs).px)).toEqual(before);
   }
  }
  expect(checked).toBeGreaterThan(10000);
 });
 it('provides the missing rear skirt pixel from the exact observed outfit, with no furniture input',()=>{
  const look=observed.look;
  const legs={reach:.23,rise:2.5,drop:11,toe:.12,hang:3.15};
  const fig=renderAvatarLayers(look,'ne','sit-floor',legs),depth=avatarSurfaceDepth(look,'ne','sit-floor',legs),i=92*88+36;
  expect(fig.owner[i]).toBe(6);expect(fig.lowerGarment!.mask[i]).toBe(1);
  expect(depth.method[i]).toBe(10);expect(Number.isFinite(depth.z[i])).toBe(true);
  for(let j=0;j<fig.owner.length;j++)if(fig.px[j*4+3])expect(Number.isFinite(depth.z[j])).toBe(true);
 });
 it('preserves the actual original painter bytes recorded before the real-room failure',()=>{
  const source=observed.source,fig=renderAvatarLayers(observed.look,source.facing,source.pose,source.legs);
  const hash=(bytes:Uint8Array|Uint8ClampedArray)=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(fig.px)).toBe(source.rgbaSha256);expect(hash(fig.owner)).toBe(source.ownerSha256);
 });
 it('covers authored rainboot shafts, skate wheels and cane through walking, crouching and seated transitions',()=>{
  const poses:Array<[Pose,SitLegs|undefined]>=[['stand',undefined],['walk1',undefined],['walk2',undefined],['crouch',undefined],...Object.entries(SIT_POSE_OF).map(([style,pose])=>[pose,NATURAL_LEGS[style as keyof typeof NATURAL_LEGS]] as [Pose,SitLegs])];
  for(const variant of [{shoes:'shoes.rainboots'},{shoes:'shoes.skates'},{mobility:'mob.cane'}])for(const look0 of SEAT_LOOKS)for(const [pose,legs]of poses)for(const facing of ['se','sw','ne','nw'] as const){
   const look={...look0,...variant,pet:'pet.none'},fig=renderAvatarLayers(look,facing,pose,legs),depth=avatarSurfaceDepth(look,facing,pose,legs);
   for(let i=0;i<fig.owner.length;i++)if(fig.px[i*4+3])expect(Number.isFinite(depth.z[i]),`${JSON.stringify(variant)} ${facing} ${pose} ${i%88},${Math.floor(i/88)} owner${fig.owner[i]}`).toBe(true);
  }
 });
 it('does not invent cloth outside the original polygon or fill a concave cutout',()=>{
  const polygon:[number,number][]=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]];
  const cloth={version:1 as const,vertices:polygon.map(point=>({point,anchor:'hip' as const,drop:0})),triangles:garmentTriangles(polygon),mask:new Uint8Array()};
  const anchors={waist:0,hip:0,nearKnee:0,farKnee:0};
  expect(garmentHeight(cloth,.5,3,anchors)).toBe(.25);
  expect(garmentHeight(cloth,3,3,anchors)).toBeNaN();
  expect(garmentHeight(cloth,-.5,0,anchors)).toBeNaN();
 });
});
