// Town QA probe: lists objects whose sprite has no finished art (they fall back to low-res procedural
// drawing), and shallow-water tiles for ducks.
import { readFileSync } from 'node:fs';
import { getScene, TOWN_ID } from '@shared/world';
const s = getScene(TOWN_ID)!;
const manifest = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')).sprites as Record<string, unknown>;
const missing = new Map<string, number>();
for (const o of s.objects) {
  if (o.eventDecor || o.sprite === 'blocker') continue;
  const key = o.variant && manifest[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite;
  if (!manifest[key]) missing.set(`${o.sprite}${o.variant ? '.' + o.variant : ''}`, (missing.get(key) ?? 0) + 1);
}
console.log('objects:', s.objects.length, '| without art:', missing.size ? [...missing.keys()].join(', ') : 'none');
const T = (x: number, y: number) => s.tiles[y]?.[x] ?? ' ';
const water = (c: string) => c === 'w' || c === 'W';
const spots: string[] = [];
for (let y = 0; y < s.height; y++)
  for (let x = 0; x < s.width; x++) {
    if (!water(T(x, y))) continue;
    let d = 99;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (!water(T(x + dx, y + dy)) && T(x + dx, y + dy) !== ' ') d = Math.min(d, Math.hypot(dx, dy));
    if (d >= 2 && d <= 3 && (x + y) % 7 === 0) spots.push(`(${x},${y})`);
  }
console.log('duck water:', spots.slice(0, 24).join(' '));
// Every object's footprint sits on the terrain it belongs on (boats on water, everything else on land).
const bad: string[] = [];
for (const o of s.objects) {
  for (let y = o.y; y < o.y + (o.d ?? 1); y++)
    for (let x = o.x; x < o.x + (o.w ?? 1); x++) {
      const onWater = water(T(x, y));
      if ((o.sprite === 'boat') !== onWater) bad.push(`${o.id} ${o.sprite} at ${x},${y} on '${T(x, y)}'`);
    }
}
console.log('misplaced tiles:', bad.length ? bad.slice(0, 12).join('; ') : 'none');
