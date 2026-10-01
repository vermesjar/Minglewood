import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { readModels, modelView } from '../../../../scripts/lib/models';
import type { Sprites } from '../../../../scripts/lib/seats';
import { FIG, figAx } from '@shared/world/seatFigure';
import { sitterMask } from './seatLayers';
import { renderAvatarLayers } from './avatarQa';
import type { Facing } from '@shared/world/scene';
import type { AvatarLoadout } from '@shared/domain/types';
import type { SitLegs } from '@shared/world/sitLegs';
import type { Pose } from './avatarFrame';

interface Case { case:string; key:string; facing:Facing; pose:Pose; look:AvatarLoadout; legs:SitLegs; feet:[number,number]; height:number }
interface Point {case:string;x:number;y:number;winner:'avatar'|'furniture';source:string;reason:string}
const cases:Case[]=JSON.parse(readFileSync('tests/fixtures/seating-pixel-cases.json','utf8'));
const {points}:{points:Point[]}=JSON.parse(readFileSync('tests/fixtures/seating-expected-pixels.json','utf8'));
const catalog=loadManifest().sprites as unknown as Sprites, models=readModels();

describe('independently reviewed in-game pixels',()=>{
  for(const point of points) it(`${point.case} (${point.x},${point.y}): ${point.reason}`,()=>{
    const c=cases.find(c=>c.case===point.case)!;
    expect(c,'capture context is required').toBeDefined();
    const v=modelView(catalog,c.key,c.facing,models[c.key]);
    expect(v.model.compiler?.source,'changed art/declaration needs another visual review').toBe(point.source);
    const x=point.x-Math.round(c.feet[0])+figAx(c.facing),y=point.y-Math.round(c.feet[1])+FIG.feet,i=y*FIG.w+x;
    const figure=renderAvatarLayers(c.look,c.facing,c.pose,c.legs);
    expect(figure.px[i*4+3],'the expected avatar pixel must exist').toBeGreaterThan(0);
    expect(v.art.px.d[(point.y*v.art.px.w+point.x)*4+3],'the expected furniture pixel must exist').toBeGreaterThan(0);
    const mask=sitterMask(v,c.look,c.facing,c.pose,c.feet,c.legs,c.height);
    expect(mask[i]? 'furniture':'avatar').toBe(point.winner);
  });
});
