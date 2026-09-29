/**
 * Stoops: nobody stands inside a building's front. Each building's drawing reaches out over the tiles in front
 * of its two visible faces (steps, column plinths, planters, a parked bike). Any tile there whose ground
 * diamond the drawing covers must not be walkable, except the door tile and the tile in front of it.
 *
 *   npx tsx scripts/town-stoops.ts            report; exits 1 if a covered front tile is walkable
 *   npx tsx scripts/town-stoops.ts --list     print the blocker list for northstarTown.ts (STOOP_BLOCKS)
 */
import { readFileSync } from 'node:fs';
import { getScene, TOWN_ID } from '@shared/world';
import { WalkGrid } from '@shared/world/walkGrid';
import { resolve } from './furniture-review';

const scene = getScene(TOWN_ID)!;
const grid = new WalkGrid(scene);
const manifest = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')).sprites;
const list = process.argv.includes('--list');
const bad: string[] = [];
const blocks: Record<string, Array<[number, number]>> = {};
for (const o of scene.objects) {
  if (!o.building) continue;
  const key = o.variant && manifest[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite;
  const e = manifest[key];
  if (!e) continue;
  const p = resolve(e, 'se', 'public/art/sprites');
  if (!p) continue;
  const w = o.w ?? 1;
  const d = o.d ?? 1;
  const opaque = (x: number, y: number) => {
    const X = Math.round(x);
    const Y = Math.round(y);
    return X >= 0 && Y >= 0 && X < p.img.w && Y < p.img.h && p.img.d[(Y * p.img.w + X) * 4 + 3] > 0;
  };
  // sprite px of a ground point (i, j) in footprint tiles, 64 px per tile
  const P = (i: number, j: number): [number, number] => [p.ax + (i - j) * 32, p.ay + (i + j) * 16];
  const cover = (i: number, j: number) => {
    let n = 0;
    let hit = 0;
    for (let u = 0.1; u < 0.95; u += 0.8 / 6)
      for (let v = 0.1; v < 0.95; v += 0.8 / 6) {
        if (u + v < 1) continue; // the lower half of the diamond, toward the camera
        n++;
        if (opaque(...P(i + u, j + v))) hit++;
      }
    return hit / n;
  };
  const door = o.door;
  const doorPath = new Set<string>();
  if (door) {
    doorPath.add(`${door.x},${door.y}`);
    // the tile the door opens onto (away from the building)
    const out = door.y >= o.y + d ? [door.x, door.y + 1] : [door.x + 1, door.y];
    doorPath.add(`${out[0]},${out[1]}`);
  }
  const front: Array<[number, number]> = [];
  for (let i = -1; i <= w + 1; i++) for (const j of [d, d + 1]) front.push([i, j]);
  for (let j = -1; j < d; j++) for (const i of [w, w + 1]) front.push([i, j]);
  blocks[o.id] = [];
  for (const [i, j] of front) {
    const x = o.x + i;
    const y = o.y + j;
    if (cover(i, j) < 0.35 || doorPath.has(`${x},${y}`)) continue;
    blocks[o.id].push([x, y]);
    if (grid.walkable(x, y)) bad.push(`${o.id}: (${x},${y}) is walkable but ${o.label ?? o.id}'s drawing stands on it (${Math.round(cover(i, j) * 100)}% of the tile)`);
  }
}
if (list) {
  for (const [id, t] of Object.entries(blocks)) console.log(`  '${id}': [${t.map(([x, y]) => `[${x}, ${y}]`).join(', ')}],`);
} else {
  for (const b of bad) console.log('  ! ' + b);
  console.log(bad.length ? `${bad.length} walkable tile(s) under building fronts` : 'building fronts: nothing walkable under them');
  process.exit(bad.length ? 1 : 0);
}
