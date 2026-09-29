/**
 * Town seats get room: every bench (any seat) in town has a clear row of ground in front of its working face,
 * and no other drawing — a lamp post, a flower cart, a tree, a signpost — overlaps its drawing, in front of it
 * or behind it (a building behind a seat is its backdrop; chairs drawn up to a table face the table). A seat
 * you can't read at a glance is one nobody sits on.
 *
 *   npx tsx scripts/town-seats.ts            report; exits 1 if any seat is crowded
 */
import { readFileSync } from 'node:fs';
import { getScene, TOWN_ID } from '@shared/world';
import { footprint, isSeat, type SceneObject } from '@shared/world/scene';
import { WalkGrid } from '@shared/world/walkGrid';
import { resolve, type Placed } from './furniture-review';

const scene = getScene(TOWN_ID)!;
const grid = new WalkGrid(scene);
const manifest = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')).sprites;
/** Opaque pixels two drawings may share before it reads as crowding (a leaf tip, an antialiased edge). */
const TOLERANCE = 12;

const placed = new Map<string, Placed | null>();
function drawing(o: SceneObject): Placed | null {
  if (placed.has(o.id)) return placed.get(o.id)!;
  const key = o.variant && manifest[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite;
  const e = manifest[key];
  const p = e ? resolve(e, o.facing ?? 'se', 'public/art/sprites') : null;
  placed.set(o.id, p);
  return p;
}
/** A drawing's box in world sprite px (64 px per tile): its anchor is the footprint's top corner. */
function box(o: SceneObject, p: Placed) {
  const x = (o.x - o.y) * 32 - p.ax;
  const y = (o.x + o.y) * 16 - p.ay - (o.z ?? 0) * 2;
  return { x, y, r: x + p.img.w, b: y + p.img.h };
}
const opaque = (p: Placed, x: number, y: number) => x >= 0 && y >= 0 && x < p.img.w && y < p.img.h && p.img.d[(y * p.img.w + x) * 4 + 3] > 40;

/** The row of tiles directly in front of a seat's working face. */
function front(o: SceneObject): Array<[number, number]> {
  const f = footprint(o);
  const out: Array<[number, number]> = [];
  const face = o.facing ?? 'se';
  if (face === 'se') for (let y = f.y0; y < f.y1; y++) out.push([f.x1, y]);
  if (face === 'nw') for (let y = f.y0; y < f.y1; y++) out.push([f.x0 - 1, y]);
  if (face === 'sw') for (let x = f.x0; x < f.x1; x++) out.push([x, f.y1]);
  if (face === 'ne') for (let x = f.x0; x < f.x1; x++) out.push([x, f.y0 - 1]);
  return out;
}

/** What stands on a tile (besides `self`). */
const at = (x: number, y: number, self: SceneObject) =>
  scene.objects.find((o) => o !== self && !o.eventDecor && o.sprite !== 'blocker' && x >= o.x && y >= o.y && x < o.x + (o.w ?? 1) && y < o.y + (o.d ?? 1));
const others = scene.objects.filter((o) => o.sprite !== 'blocker' && !o.wall && !o.flat);
const bad: string[] = [];
let n = 0;
for (const s of scene.objects.filter(isSeat)) {
  n++;
  const sp = drawing(s);
  if (!sp) {
    bad.push(`${s.id} (${s.sprite}): no drawing to check`);
    continue;
  }
  // a chair drawn up to a table: the table is its working face (and the table and the other chairs round it
  // are meant to touch it)
  const table = front(s)
    .map(([x, y]) => at(x, y, s))
    .find((o) => o && /table/.test(o.sprite));
  const party = new Set<SceneObject>(table ? [table, ...scene.objects.filter((o) => isSeat(o) && front(o).some(([x, y]) => at(x, y, o) === table))] : []);
  if (!table)
    for (const [x, y] of front(s)) {
      const on = at(x, y, s);
      if (on) bad.push(`${s.id} at ${s.x},${s.y} (${s.facing}): ${on.id} (${on.sprite}) stands in front of it at ${x},${y}`);
      else if (!grid.walkable(x, y)) bad.push(`${s.id} at ${s.x},${s.y} (${s.facing}): the tile in front, ${x},${y}, can't be stood on`);
    }
  const a = box(s, sp);
  const depth = (o: SceneObject) => o.x + o.y + ((o.w ?? 1) + (o.d ?? 1)) / 2;
  for (const o of others) {
    if (o === s || o.eventDecor || party.has(o)) continue;
    // a building behind a seat is its backdrop (a bench against a wall); one in front of it hides it
    if (o.building && depth(o) < depth(s)) continue;
    const op = drawing(o);
    if (!op) continue;
    const b = box(o, op);
    const l = Math.max(a.x, b.x);
    const t = Math.max(a.y, b.y);
    const r = Math.min(a.r, b.r);
    const bt = Math.min(a.b, b.b);
    if (l >= r || t >= bt) continue;
    let hit = 0;
    for (let y = t; y < bt; y++) for (let x = l; x < r; x++) if (opaque(sp, x - a.x, y - a.y) && opaque(op, x - b.x, y - b.y)) hit++;
    if (hit > TOLERANCE) bad.push(`${s.id} at ${s.x},${s.y} (${s.facing}): ${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''} at ${o.x},${o.y}) overlaps its drawing (${hit} px)`);
  }
}
for (const b of bad) console.log('  !', b);
console.log(`${n} town seats checked, ${bad.length} crowded (clear ground in front, no drawing overlapping)`);
process.exit(bad.length ? 1 : 0);
