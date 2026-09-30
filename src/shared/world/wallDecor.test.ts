import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileArtSource } from '../../server/art';
import { silhouette } from '../art/footing';
import { WALL_CROWN, WALL_PX_PER_TILE, wallFit, type Manifest } from '../models';
import { buildInteriors } from './interiors';
import { getScene } from './index';
import { livedScene } from './lived';
import { MEMORY_SLOTS } from './memory';
import { decorItem, decorObject, decorObjects, placementProblem, registerWallArt, wallCatalog, wallPlacementProblem, withoutDecoration, type Decoration } from './decor';
import { wallBox, wallFitProblems, wallOcclusions } from './wallPieces';

const art = fileArtSource('public/art');
const manifest = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')) as Manifest;
registerWallArt(art.manifest());

const item = (key: string) => decorItem(`wall:${key}`)!;
const hang = (roomId: string, key: string, wall: 'left' | 'right', at: number, id = key): Decoration => ({
  id,
  roomId,
  itemId: `wall:${key}`,
  wall,
  x: wall === 'right' ? at : 0,
  y: wall === 'left' ? at : 0,
  placedBy: 'm',
  placedAt: '',
});

describe('THE WALL ART STANDARD', () => {
  it('every wall piece in the catalog is drawn at 2:1, fits its span, and clears the trim', () => {
    for (const [key, e] of Object.entries(manifest.sprites)) {
      if (!e.wall || !e.file) continue;
      const px = art.pixels(e.file)!;
      expect(wallFit(e.wall, px, e.footprint[0], silhouette(px)).problems, key).toEqual([]);
      expect(e.wall.margin, `${key}: margin is retired`).toBeUndefined();
    }
  });

  it('a squeezed piece or one into the crown is a model-spec error, never drawn smaller', () => {
    const f = wallFit({ v: [28, 57] }, { w: 55, h: 58 }, 1);
    expect(f.problems.join()).toMatch(/grow its span to 2/);
    expect(wallFit({ v: [30, 59] }, { w: 55, h: 58 }, 2).problems.join()).toMatch(/crown/);
    expect(wallFit({ v: [28, 50] }, { w: 55, h: 58 }, 2).problems.join()).toMatch(/v must be \[28, 57\]/);
    // centred on a whole drawing px, one drawing px to one wall-texture px
    const ok = wallFit({ v: [28, 57] }, { w: 55, h: 58 }, 2);
    expect(ok.problems).toEqual([]);
    expect(ok.left).toBe(4);
    expect(ok.v1 - ok.v0).toBe(29);
    expect(ok.vis.v1).toBeLessThanOrEqual(WALL_CROWN);
  });

  it('every wall piece hung in every room fits its span, and nothing standing hides one', () => {
    for (const s of buildInteriors()) {
      expect(wallFitProblems(s, art), s.id).toEqual([]);
      expect(wallOcclusions(s, art), s.id).toEqual([]);
    }
  });

  it("a piece's box is its drawing's opaque pixels, centred in its span, mirrored about it on the left wall", () => {
    const [r] = decorObjects('events', [hang('events', 'menu-board', 'right', 4)]);
    const b = wallBox(r, art)!;
    expect(b.u0).toBeCloseTo(4 + 4 / WALL_PX_PER_TILE);
    expect(b.u1).toBeCloseTo(4 + 59 / WALL_PX_PER_TILE);
    const [l] = decorObjects('events', [hang('events', 'menu-board', 'left', 4)]);
    const lb = wallBox(l, art)!;
    expect(lb.u0).toBeCloseTo(4 + 5 / WALL_PX_PER_TILE);
    expect(lb.u1).toBeCloseTo(4 + 60 / WALL_PX_PER_TILE);
  });
});

describe('the Wall category', () => {
  it('holds every piece of wall art in the catalog, and windows', () => {
    const ids = new Set(wallCatalog().map((d) => d.id));
    for (const [key, e] of Object.entries(manifest.sprites)) if (e.category === 'wall-art') expect(ids.has(`wall:${key}`), key).toBe(true);
    expect(ids.has('wall:window')).toBe(true);
    for (const key of ['menu-board', 'frame.lake', 'poster.ship', 'clock-wall', 'whiteboard', 'kanban', 'pinup', 'moodboard', 'bulletin', 'swatches', 'star-map', 'mission-patches', 'pennant.mobile', 'sign-quiet', 'logo-wall', 'banner', 'lantern-string'])
      expect(ids.has(`wall:${key}`), key).toBe(true);
  });

  it('turns a hung piece into a wall object like an authored one, and old floor saves still load', () => {
    const [frame, window, lamp] = decorObjects('events', [
      hang('events', 'frame.lake', 'right', 4, 'a'),
      { ...hang('events', 'window', 'left', 8, 'b'), itemId: 'wall:window' },
      { id: 'c', roomId: 'events', itemId: 'lamp', x: 6, y: 6, placedBy: 'm', placedAt: '' },
    ]);
    expect(frame).toMatchObject({ id: 'decor-a', sprite: 'frame', variant: 'lake', wall: 'right', x: 4, y: 0 });
    expect(window).toMatchObject({ sprite: 'window', wall: 'left', x: 0, y: 8, d: 2 });
    expect(lamp.wall).toBeUndefined();
    // a wall piece saved without its wall (or a floor piece with one) is ignored, not misplaced
    expect(decorObject({ ...hang('events', 'frame.lake', 'right', 4), wall: undefined })).toBeNull();
    expect(decorObject({ id: 'x', roomId: 'events', itemId: 'lamp', x: 4, y: 0, wall: 'right', placedBy: '', placedAt: '' })).toBeNull();
  });
});

describe('hanging things on the walls', () => {
  const events = getScene('events')!;

  it('hangs on free wall, on either wall', () => {
    expect(wallPlacementProblem(events, item('poster.ship'), 'right', 0, art)).toBeNull();
    expect(wallPlacementProblem(events, item('poster.ship'), 'left', 8, art)).toBeNull();
    expect(wallPlacementProblem(events, decorItem('wall:window-small')!, 'left', 2, art)).toBeNull();
  });

  it('never over another wall piece, the door, or a memory-wall slot, and never off the wall', () => {
    expect(wallPlacementProblem(events, item('poster.ship'), 'right', 6, art)).toMatch(/hangs there/); // the banner
    expect(wallPlacementProblem(events, item('poster.ship'), 'left', events.interior!.doorY, art)).toMatch(/door/);
    const slot = MEMORY_SLOTS.events[0];
    expect(wallPlacementProblem(events, item('poster.ship'), slot.wall, slot.at, art)).toMatch(/memory wall/);
    expect(wallPlacementProblem(events, item('menu-board'), 'right', events.width - 1, art)).toMatch(/off the wall/);
    expect(wallPlacementProblem(events, item('poster.ship'), 'right', -1, art)).toMatch(/off the wall/);
    // …nor over a team's own piece
    const hung = livedScene(events, [], [hang('events', 'poster.ship', 'right', 0)]);
    expect(wallPlacementProblem(hung, item('clock-wall'), 'right', 0, art)).toMatch(/hangs there/);
    // moving that piece, it doesn't collide with itself
    expect(wallPlacementProblem(withoutDecoration(hung, 'poster.ship'), item('clock-wall'), 'right', 0, art)).toBeNull();
  });

  it('never behind tall furniture (the rule room-map checks the rooms with)', () => {
    const focus = getScene('focus')!;
    expect(wallPlacementProblem(focus, item('frame.lake'), 'right', 1, art)).toMatch(/bookshelf in front would hide it/);
    expect(wallPlacementProblem(focus, item('frame.lake'), 'right', 11, art)).toBeNull();
  });

  it('and a floor piece is never placed where it would hide something on the wall', () => {
    const hung = livedScene(events, [], [hang('events', 'poster.ship', 'right', 0)]);
    const lamp = decorObject({ id: 'l', roomId: 'events', itemId: 'lamp', x: 0, y: 0, placedBy: '', placedAt: '' })!;
    expect(placementProblem(events, 0, 0, new Set(), lamp, art)).toBeNull();
    expect(placementProblem(hung, 0, 0, new Set(), lamp, art)).toMatch(/hide the poster/i);
  });
});
