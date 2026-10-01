import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { motionCandidate, motionRoom } from '../../../../scripts/lib/seat-motion-candidate';
describe('isolated staged motion candidate',()=>{
  it('accepts a new catalog-free key with exact footprint and binds art bytes',()=>{
    const root=mkdtempSync(join(tmpdir(),'motion-candidate-'));mkdirSync(join(root,'sprites'));
    try {
      const models=join(root,'models.json');writeFileSync(models,JSON.stringify({'user-seat':{size:[3,1]}}));
      writeFileSync(join(root,'entries.json'),JSON.stringify({'user-seat':{footprint:[3,1],facings:{se:{file:'front.png'}}}}));
      writeFileSync(join(root,'sprites/front.png'),'original');
      const before=motionCandidate(root,models)!;expect(motionRoom('user-seat',before)).toBe('seatlab-user-seat~3x1');
      expect(motionRoom('user-seat',before,'draft-a')).toBe('seatlab-user-seat~3x1~draft-a');
      writeFileSync(join(root,'sprites/front.png'),'changed');expect(motionCandidate(root,models)!.receipt.sprites['front.png'].sha256).not.toBe(before.receipt.sprites['front.png'].sha256);
      writeFileSync(join(root,'entries.json'),JSON.stringify({'user-seat':{footprint:[1,1],facings:{se:{file:'front.png'}}}}));expect(()=>motionCandidate(root,models)).toThrow('footprint differs');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('does not route traversal outside staged sprites or silently fit an oversized room',()=>{
    const root=mkdtempSync(join(tmpdir(),'motion-candidate-'));mkdirSync(join(root,'sprites'));const models=join(root,'models.json');
    try {
      writeFileSync(models,JSON.stringify({'user-seat':{size:[1,1]}}));
      writeFileSync(join(root,'entries.json'),JSON.stringify({'user-seat':{footprint:[1,1],facings:{se:{file:'../secret.png'}}}}));expect(()=>motionCandidate(root,models)).toThrow('leaves its candidate');
      writeFileSync(models,JSON.stringify({'user-seat':{size:[5,1]}}));expect(()=>motionCandidate(root,models)).toThrow('larger review-room');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
});
