import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { canonical, sha256 } from '../../../scripts/lib/seat-verification';
import { wardrobeRequestFromVerifiedEvidence } from '../../../scripts/lib/seat-wardrobe-verification';

const dir = mkdtempSync(join(tmpdir(), 'minglewood-wardrobe-inputs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('derives requirements from every exact source film and capture, refusing modified source proofs', () => {
  const motion = join(dir, 'motion-visual-review'); mkdirSync(motion);
  const legs = { reach: .3, rise: 1, drop: 10, toe: .1, hang: 0 };
  const model = { parts: [], sits: [[.5, .5, 10]] };
  const save = (name: string, value: unknown, base = dir) => {
    const path = join(dir, name), bytes = JSON.stringify(value);
    writeFileSync(path, bytes); return { path: relative(base, path), sha256: sha256(bytes) };
  };
  const capture = save('capture.json', [{ model, pose: 'sit', facing: 'ne', legs }]);
  const contexts = ['se', 'sw', 'ne', 'nw'].flatMap(facing => [0, 1, 2, 3].map(look => ({
    id: `${facing}-L${look}`, film: save(`${facing}-${look}.json`, { model, frames: [
      { state: { pose: 'sit', facing, legs: { ...legs, rise: 1 + look / 1000 }, poseRace: false } },
      { state: { pose: 'walk1', facing, poseRace: false } },
    ] }, motion),
  })));
  const bundle = join(dir, 'bundle.json'), contract = join(dir, 'contract.json');
  writeFileSync(bundle, JSON.stringify({ captures: [capture] }));
  writeFileSync(contract, '{}');
  writeFileSync(join(motion, 'manifest.json'), JSON.stringify({ contexts }));
  const request = wardrobeRequestFromVerifiedEvidence(bundle, contract);
  expect(Object.keys(request.bindings).filter(k => k.startsWith('film-'))).toHaveLength(16);
  expect(request.contexts.filter(c => c.pose === 'sit' && c.legs?.rise === 1.003)).toHaveLength(4);
  expect(request.contexts.filter(c => c.pose === 'walk1')).toHaveLength(4);
  const before = canonical(request);
  writeFileSync(contract, '{"changed":true}');
  expect(canonical(wardrobeRequestFromVerifiedEvidence(bundle, contract))).not.toBe(before);
  const path = join(dir, 'nw-3.json'), film = JSON.parse(readFileSync(path, 'utf8'));
  film.frames[0].state.legs.rise = 99; writeFileSync(path, JSON.stringify(film));
  expect(() => wardrobeRequestFromVerifiedEvidence(bundle, contract)).toThrow('artifact changed');
});
