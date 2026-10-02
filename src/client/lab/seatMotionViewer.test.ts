import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { seatMotionFrames } from '../../../scripts/lib/seat-motion-viewer';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(patch: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'seat-motion-viewer-')); roots.push(root);
  mkdirSync(join(root, 'motion'));
  const frame = { png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', crop: { x: 12, y: 30, width: 1, height: 1 },
    state: { phase: 'seated-1', pose: 'sit', onSeat: true, seat: { id: 'seat', facing: 'se' } }, renderedFrame: 18 };
  const film = JSON.stringify({ facing: 'se', reviewLook: 0, frames: [frame], ...patch });
  const artifact = { path: 'chair-se-L0-film.json', sha256: createHash('sha256').update(film).digest('hex') };
  writeFileSync(join(root, 'motion', artifact.path), film);
  writeFileSync(join(root, 'motion/result.json'), JSON.stringify({ state: 'FAILED', artifacts: [artifact] }));
  return { root, frame, artifact };
}
describe('saved Studio movement pixels', () => {
  it('returns original failed-recording pixels and frame metadata without approving them', () => {
    const { root, frame } = fixture(), value = seatMotionFrames(root, 'motion/result.json', 'se', 0);
    expect(value.frames[0]).toEqual({ png: frame.png, rect: frame.crop, phase: 'seated-1', pose: 'sit', cushion: 1, renderedFrame: 18 });
    expect(value).not.toHaveProperty('accepted');
  });
  it('rejects changed bytes and mismatched contexts', () => {
    const { root, artifact } = fixture(); writeFileSync(join(root, 'motion', artifact.path), '{}');
    expect(() => seatMotionFrames(root, 'motion/result.json', 'se', 0)).toThrow('bytes have changed');
    const other = fixture({ facing: 'nw' });
    expect(() => seatMotionFrames(other.root, 'motion/result.json', 'se', 0)).toThrow('context does not match');
  });
  it('rejects evidence outside the draft and invalid selections', () => {
    const { root } = fixture(), outside = fixture();
    expect(() => seatMotionFrames(root, join(outside.root, 'motion/result.json'), 'se', 0)).toThrow('outside this draft');
    expect(() => seatMotionFrames(root, 'motion/result.json', 'se', 4)).toThrow('Unknown movement');
  });
  it('rejects duplicate films instead of choosing one silently', () => {
    const { root, artifact } = fixture();
    writeFileSync(join(root, 'motion/result.json'), JSON.stringify({ artifacts: [artifact, artifact] }));
    expect(() => seatMotionFrames(root, 'motion/result.json', 'se', 0)).toThrow('one recorded movement film');
  });
});
