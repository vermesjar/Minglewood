/**
 * Room maps for layout work: every interior as an ASCII floor plan (what stands on each tile), the wall items
 * along both walls, and what's wrong with the layout:
 *   - overlaps: two standing things on one tile, or wall items sharing a stretch of wall;
 *   - occlusion: a tall floor piece (or an NPC at a work spot) standing in front of wall signage or art from
 *     the camera's view — its silhouette rises above the wall piece's bottom edge. Sprites are resolved the
 *     way the client resolves them (art.ts: facings, mirroring, small pieces centred on their footprint) and
 *     read per pixel column, so a thin lamp pole beside a frame doesn't count, but its shade in front does.
 *     The memory-wall slots (where future artifacts will hang) are checked too. The rule is shared with decorate
 *     mode and the server (src/shared/world/wallPieces.ts), so a team can't hang something where this would fail.
 *   - squeezes: wall art hung in a span too narrow for its drawing at 2:1 (THE WALL ART STANDARD, models.ts).
 *   - crowding: an occupied seat whose sitter would cover the face and body of someone sitting just behind
 *     them in the same screen column (see crowdedSeats).
 *   - spacing: a seat with something right in front of it (the seat spacing rule, src/shared/world/seats.ts,
 *     shared with decorate mode): a coffee table goes a tile from a couch; only a chair or a stool pulls up to
 *     a desk, a table or a counter.
 *
 *   npx tsx scripts/room-map.ts [roomId ...] [--quiet]     (exits 1 if anything is wrong)
 */
import { existsSync, readFileSync } from 'node:fs';
import { buildInteriors } from '../src/shared/world/interiors';
import { isSeat, footprint, type SceneDef, type SceneObject } from '../src/shared/world/scene';
import { seatSpots, spacingProblems } from '../src/shared/world/seats';
import { WalkGrid } from '../src/shared/world/walkGrid';
// the occlusion rule and the wall art standard are shared with decorate mode and the server (one rule, one answer)
import { wallFitProblems, wallOcclusions } from '../src/shared/world/wallPieces';
import { fileArtSource } from '../src/server/art';

/** The art as the client resolves it (facings, mirroring, small pieces centred on their footprint): from disk. */
const ART = fileArtSource('public/art');

function occlusions(s: SceneDef): string[] {
  return wallOcclusions(s, ART);
}

/* ------------------------------------------------------------------ sitters crowding each other */
/**
 * Two occupied seats whose sitters land in the same screen column, the nearer one close enough in depth that
 * its figure covers the farther sitter's face and body (an armchair tucked behind a sofa cushion). Only a
 * sitter who faces the camera (se / sw) can be crowded this way: rows of backs (an audience, the near side of
 * a desk pod) overlap naturally. Figures are the kit's seated silhouette in world px from the sitter's anchor:
 * about 22 px wide, 34 px tall, lifted by the seat's height.
 */
function crowdedSeats(s: SceneDef): string[] {
  const manifest = existsSync('public/art/manifest.json') ? JSON.parse(readFileSync('public/art/manifest.json', 'utf8')).sprites : {};
  const seatH = (o: SceneObject): number => {
    const e = (o.variant && manifest[`${o.sprite}.${o.variant}`]) || manifest[o.sprite];
    return typeof e?.seat === 'number' ? e.seat - 6.5 : 4;
  };
  const spots = s.objects.filter(isSeat).flatMap((o) => seatSpots(o, s).map((sp) => ({ o, sp, lift: seatH(o) })));
  const out: string[] = [];
  for (const a of spots)
    for (const b of spots) {
      if (a === b || a.o === b.o) continue;
      if (a.sp.facing !== 'se' && a.sp.facing !== 'sw') continue;
      // b in front of a (greater depth)
      const da = a.sp.x + a.sp.y;
      const db = b.sp.x + b.sp.y;
      if (db <= da || db - da > 3) continue;
      const ax = (a.sp.x - a.sp.y) * 16;
      const bx = (b.sp.x - b.sp.y) * 16;
      if (Math.abs(ax - bx) >= 12) continue;
      const ay = (da + 1) * 8 - a.lift;
      const by = (db + 1) * 8 - b.lift;
      // b's figure top (by - 34) above a's seat line (ay) by more than a few px: it covers a's torso and face
      const cover = ay - (by - 34);
      if (cover > 6) out.push(`${s.id}: sitter on ${b.o.id} (${b.sp.x},${b.sp.y}) covers the sitter facing out on ${a.o.id} (${a.sp.x},${a.sp.y}) by ${Math.round(cover)}px`);
    }
  return out;
}

/* ------------------------------------------------------------------ report */
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const only = args.filter((a) => !a.startsWith('--'));
let problems = 0;
const say = (line: string) => {
  if (!quiet) console.log(line);
};
for (const s of buildInteriors()) {
  if (only.length && !only.includes(s.id)) continue;
  const cell: string[][] = Array.from({ length: s.height }, () => Array.from({ length: s.width }, () => ''));
  const key = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@$%&*+=?';
  const grid = new WalkGrid(s);
  const walls: Record<'left' | 'right', Array<[number, number, string]>> = { left: [], right: [] };
  for (const o of s.objects) {
    if (o.wall) {
      const at = o.wall === 'right' ? o.x : o.y;
      const len = o.wall === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
      walls[o.wall].push([at, at + len, `${o.sprite}${o.variant ? '.' + o.variant : ''}`]);
      continue;
    }
    if (o.flat) continue;
    const name = `${o.sprite}${o.variant ? '.' + o.variant : ''}`;
    if (!key.has(name)) key.set(name, letters[key.size % letters.length]);
    const f = footprint(o);
    for (let y = f.y0; y < f.y1; y++)
      for (let x = f.x0; x < f.x1; x++) {
        if (y < 0 || x < 0 || y >= s.height || x >= s.width) {
          console.log(`  ! ${s.id}: ${o.id} off the floor at ${x},${y}`);
          problems++;
          continue;
        }
        cell[y][x] += (o.z ? '^' : '') + key.get(name)!;
      }
  }
  say(`\n== ${s.id} (${s.width}×${s.height}, door y=${s.interior?.doorY})`);
  say('    ' + [...Array(s.width).keys()].map((x) => String(x % 10)).join(' '));
  for (let y = 0; y < s.height; y++) {
    const row = cell[y].map((c, x) => {
      const standing = c.replace(/\^./g, '');
      if (standing.length > 1) {
        console.log(`  ! ${s.id}: overlap at ${x},${y}: ${c}`);
        problems++;
      }
      return standing[0] ?? (grid.walkable(x, y) ? '.' : '#');
    });
    say(String(y).padStart(3) + ' ' + row.join(' '));
  }
  for (const side of ['left', 'right'] as const) {
    const w = walls[side].sort((a, b) => a[0] - b[0]);
    say(`  ${side} wall: ` + w.map(([a, b, n]) => `${n}[${a}-${b - 1}]`).join('  '));
    for (let i = 1; i < w.length; i++)
      if (w[i][0] < w[i - 1][1]) {
        console.log(`  ! ${s.id}: ${side} wall overlap ${w[i - 1][2]} / ${w[i][2]}`);
        problems++;
      }
  }
  say('  ' + [...key].map(([n, l]) => `${l}=${n}`).join(' '));
  for (const line of [...occlusions(s), ...wallFitProblems(s, ART)]) {
    console.log(`  ! ${line}`);
    problems++;
  }
  for (const line of crowdedSeats(s)) {
    console.log(`  ! ${line}`);
    problems++;
  }
  // the seat spacing rule (shared with decorate mode: src/shared/world/seats.ts)
  for (const line of spacingProblems(s)) {
    console.log(`  ! ${s.id}: ${line}`);
    problems++;
  }
}
console.log(problems ? `\n${problems} problem(s)` : '\nno overlaps, nothing hides the walls');
process.exit(problems ? 1 : 0);
