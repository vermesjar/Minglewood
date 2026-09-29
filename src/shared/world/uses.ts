/**
 * What clicking a thing does: the "use" interactions, assigned by what the thing is (its drawing), so every
 * copy of a jukebox, a potted plant or a pool table behaves the same wherever it stands — including pieces
 * people place themselves later. The server decides the outcome and everyone in the room sees the moment.
 */
import type { SceneDef, SceneObject, UseKind } from './scene';
import { approach } from './interact';
import { WalkGrid } from './walkGrid';

export interface UseDef {
  use: UseKind;
  label: string;
}

/** By sprite (or sprite.variant, which wins). Only things where the moment means something are here. */
export const USE_BY_SPRITE: Record<string, UseDef> = {
  jukebox: { use: 'song', label: 'Put a song on' },
  'arcade-cabinet': { use: 'arcade', label: 'Play a round' },
  'pool-table': { use: 'pool', label: 'Break' },
  'air-hockey': { use: 'hockey', label: 'Take a shot' },
  'claw-machine': { use: 'claw', label: 'Try your luck' },
  'heirloom-piano': { use: 'piano', label: 'Play a few bars' },
  'heirloom-aquarium': { use: 'feed', label: 'Feed the fish' },
  'globe-stand': { use: 'spin', label: 'Spin the globe' },
  'heirloom-globe': { use: 'spin', label: 'Spin the globe' },
  plant: { use: 'water', label: 'Water the plant' },
  fountain: { use: 'wish', label: 'Toss a coin' },
  'clock-grand': { use: 'chime', label: 'Wind the clock' },
  'server-rack': { use: 'reboot', label: 'Turn it off and on again' },
  'rocket-model': { use: 'rocket', label: 'Count down' },
  podium: { use: 'toast', label: 'Raise a toast' },
};

/** Things you can take away and carry (a book off the shelf, a soda from the fridge). */
export const VEND_BY_SPRITE: Record<string, { item: string; label: string }> = {
  'bookshelf.a': { item: 'book', label: 'Borrow a book' },
  'bookshelf.b': { item: 'book', label: 'Borrow a book' },
  'bookshelf.birch': { item: 'book', label: 'Borrow a book' },
  'bookshelf.birch2': { item: 'book', label: 'Borrow a book' },
  fridge: { item: 'soda', label: 'Grab a soda' },
  'water-cooler': { item: 'water', label: 'Get a cup of water' },
  'fruit-bowl': { item: 'apple', label: 'Grab an apple' },
};

/** Boards people leave notes on (see OrgHub.note). */
export const NOTE_SPRITES = new Set(['whiteboard', 'whiteboard-stand']);

/** Sticky-note colours: each person's notes are always the same one, on the board and in its card. */
export const NOTE_COLORS = ['#ffe66b', '#ffb3d9', '#9ee6ff', '#b8f28c', '#ffc98a'];

export function noteColor(memberId: string): string {
  let h = 0;
  for (const ch of memberId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return NOTE_COLORS[Math.abs(h) % NOTE_COLORS.length];
}

export function interactionFor(o: Pick<SceneObject, 'sprite' | 'variant'>): UseDef | undefined {
  return (o.variant ? USE_BY_SPRITE[`${o.sprite}.${o.variant}`] : undefined) ?? USE_BY_SPRITE[o.sprite];
}

function vendFor(o: Pick<SceneObject, 'sprite' | 'variant'>) {
  return (o.variant ? VEND_BY_SPRITE[`${o.sprite}.${o.variant}`] : undefined) ?? VEND_BY_SPRITE[o.sprite];
}

/**
 * Give an object the interaction its kind has, unless it already has one of that sort (hand-placed actions
 * win). Other actions it has (an artifact's story, a sign's text) are kept.
 */
export function withUseActions(o: SceneObject): SceneObject {
  if (o.building) return o;
  const has = new Set(o.actions?.map((a) => a.kind));
  const board = NOTE_SPRITES.has(o.sprite) && !has.has('note');
  // on the walls, only boards: a painting or a window has nothing to do
  const u = o.wall ? undefined : interactionFor(o);
  const v = o.wall ? undefined : vendFor(o);
  const add = [
    ...(board ? [{ kind: 'note' as const, label: 'Leave a note' }] : []),
    ...(u && !has.has('use') ? [{ kind: 'use' as const, use: u.use, label: u.label }] : []),
    ...(v && !has.has('vend') ? [{ kind: 'vend' as const, item: v.item, label: v.label }] : []),
  ];
  if (!add.length) return o;
  // the interaction goes first, so a click does it; an info or artifact action stays for the info stand
  o.actions = [...add, ...(o.actions ?? []).filter((a) => a.kind !== 'activity' || !u)];
  given.add(o);
  return o;
}

/** Objects that got their interaction from the tables above (not hand-placed). */
const given = new WeakSet<SceneObject>();

/**
 * Give a scene's things their interactions, then take them back from any that can't be walked up to (a plant
 * wedged in a corner): an interaction you can never reach is worse than none.
 */
export function giveUses(scene: SceneDef): void {
  scene.objects.forEach(withUseActions);
  const grid = new WalkGrid(scene);
  const from: [number, number] = [scene.spawn.x, scene.spawn.y];
  for (const o of scene.objects) {
    if (!given.has(o)) continue;
    if (!approach(grid, from, o)) o.actions = o.actions?.filter((a) => a.kind !== 'use' && a.kind !== 'vend' && a.kind !== 'note');
  }
}
