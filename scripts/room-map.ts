/**
 * Room maps for layout work: every interior as an ASCII floor plan (what stands on each tile), the wall items
 * along both walls, and any overlaps — two standing things on one tile, or wall items sharing a stretch of wall.
 *
 *   npx tsx scripts/room-map.ts [roomId ...]
 */
import { buildInteriors } from '../src/shared/world/interiors';
import { footprint } from '../src/shared/world/scene';
import { WalkGrid } from '../src/shared/world/walkGrid';

const only = process.argv.slice(2);
let problems = 0;
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
  console.log(`\n== ${s.id} (${s.width}×${s.height}, door y=${s.interior?.doorY})`);
  console.log('    ' + [...Array(s.width).keys()].map((x) => String(x % 10)).join(' '));
  for (let y = 0; y < s.height; y++) {
    const row = cell[y].map((c, x) => {
      const standing = c.replace(/\^./g, '');
      if (standing.length > 1) {
        console.log(`  ! ${s.id}: overlap at ${x},${y}: ${c}`);
        problems++;
      }
      return standing[0] ?? (grid.walkable(x, y) ? '.' : '#');
    });
    console.log(String(y).padStart(3) + ' ' + row.join(' '));
  }
  for (const side of ['left', 'right'] as const) {
    const w = walls[side].sort((a, b) => a[0] - b[0]);
    console.log(`  ${side} wall: ` + w.map(([a, b, n]) => `${n}[${a}-${b - 1}]`).join('  '));
    for (let i = 1; i < w.length; i++)
      if (w[i][0] < w[i - 1][1]) {
        console.log(`  ! ${s.id}: ${side} wall overlap ${w[i - 1][2]} / ${w[i][2]}`);
        problems++;
      }
  }
  console.log('  ' + [...key].map(([n, l]) => `${l}=${n}`).join(' '));
}
console.log(problems ? `\n${problems} problem(s)` : '\nno overlaps');
