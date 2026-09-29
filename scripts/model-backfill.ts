/**
 * One-off (re-runnable): give every catalog entry the model spec's declarations it doesn't have yet
 * (src/shared/models.ts), from what the catalog already knows — how the rooms and the town use each piece, its
 * drawings (measured), and the audit tables below. Never overwrites a declaration an entry already has, and never
 * touches the seat standard's fields. Writes under studio's ManifestLock.
 *
 *   npx tsx scripts/model-backfill.ts [--dry]
 *   npx tsx scripts/model-backfill.ts --fix-fill [--dry]   also move anchors that break the fill rule (footing.ts)
 *   npx tsx scripts/model-backfill.ts --remeasure [--dry]  re-measure every height (after anchors moved)
 *
 * Per-drawing lights: a model drawn from more than one side needs its lamp's light in each drawing. One found
 * only on the first is carried to the others on the footprint's vertical axis (its height above the floor kept,
 * mirrored about the centre): exact for lamps and lanterns, close enough for a soft pool from a jukebox's front.
 */
import { baseCentre, fillAnchor, fillProblems, footprintCentre, isSmall } from '../src/client/engine/sprites/footing';
import { hasAnimation } from '../src/client/engine/animations';
import { allScenes } from '@shared/world';
import { DECOR_CATALOG } from '@shared/world/decor';
import { COUNTER_TOP, type Facing } from '@shared/world/scene';
import { FACINGS, ROOM_KIND_OF, drawingsOf, type ModelCategory, type ModelSpec, type RoomKind, type Theme } from '@shared/models';
import { loadManifest, withManifestLock } from './lib/manifest';
import { Drawings, measuredHeight, place } from './model-check';

const CATEGORY: Array<[RegExp, ModelCategory]> = [
  [/^building\./, 'building'],
  [/^(tree\/|bush\.|flowerbed\.|reeds|wildflowers\.|garden-bed\.|stump)/, 'nature'],
  [/^(fountain|gazebo|lighthouse|rocket-statue)$/, 'landmark'],
  [/^(armchair|beanbag|bench|chair|couch|heirloom-throne|ottoman|stool)/, 'seating'],
  [/^(table|desk|workbench|buffet|cake-table|cocktail-table|side-table|picnic|umbrella-table)/, 'table'],
  [/^(reception|prize-counter)/, 'counter'],
  [/^(bookshelf|materials-shelf|parts-rack|plan-chest|trophy-case|coat-rack|pastry-case)/, 'storage'],
  [/^(espresso|grinder|register|vending-machine|water-cooler|fridge|server-rack|popcorn-cart|bar-cart|fireplace|speaker|clock-grand)/, 'appliance'],
  [/^(lamp|lantern-floor|heirloom-dragonlamp|garden-lantern)/, 'lighting'],
  [/^(arcade-cabinet|air-hockey|pool-table|claw-machine|jukebox|heirloom-piano)/, 'play'],
  [/^(plant|planter|flower-stand)/, 'plant'],
  [/^blanket\./, 'rug'],
  [/^(bike-rack|mailbox|noticeboard|signpost|flower-cart|boat\.|birdbath|scarecrow|fire-ring|lamp-post)/, 'street'],
];

const NAMES: Record<string, string> = {
  'air-hockey': 'Air hockey table',
  'arcade-cabinet': 'Arcade cabinet',
  'bar-cart': 'Bar cart',
  backbar: 'Back bar shelves',
  'bike-rack': 'Bike rack',
  'book-stack': 'Stack of books',
  'bookshelf.a': 'Bookshelf',
  'bookshelf.b': 'Tall bookshelf',
  'bookshelf.birch': 'Birch bookshelf',
  'bookshelf.birch2': 'Birch bookshelf, full',
  'cake-stand': 'Cake stand',
  'cake-table': 'Cake table',
  'chair.cafe': 'Café chair',
  'chair.office': 'Office chair',
  'chair.red': 'Red chair',
  'chair.wood': 'Wooden chair',
  'claw-machine': 'Claw machine',
  'clock-grand': 'Grandfather clock',
  'clock-wall': 'Wall clock',
  'coat-rack': 'Coat rack',
  'cocktail-table': 'Cocktail table',
  cups: 'Cups',
  dashboard: 'Build dashboard',
  desk: 'Desk',
  'desk.light': 'Light desk',
  'desk.wood': 'Wooden desk',
  'dress-form': 'Dress form',
  easel: 'Easel',
  'easel.b': 'Easel with canvas',
  elevator: 'Elevator doors',
  espresso: 'Espresso machine',
  'fire-ring': 'Campfire ring',
  'flower-cart': 'Flower cart',
  'flower-stand': 'Flower stand',
  'frame.customer': 'Framed photo: customer',
  'frame.garage': 'Framed photo: garage',
  'frame.hackathon': 'Framed photo: hackathon',
  'frame.lake': 'Framed painting: lake',
  'frame.lisbon': 'Framed photo: Lisbon',
  'frame.team': 'Framed photo: team',
  'fruit-bowl': 'Fruit bowl',
  'garden-lantern': 'Garden lantern',
  'globe-stand': 'Globe on a stand',
  grinder: 'Coffee grinder',
  'heirloom-aquarium': 'Koi aquarium',
  'heirloom-bell': 'Launch bell',
  'heirloom-dragonlamp': 'Jade dragon lamp',
  'heirloom-globe': 'Crystal globe',
  'heirloom-gold': 'Gold reserve',
  'heirloom-piano': 'Grand piano',
  'heirloom-throne': 'Founders’ throne',
  'heirloom-trophy': 'Keystone trophy',
  jar: 'Biscotti jar',
  kanban: 'Kanban board',
  lamp: 'Floor lamp',
  'lamp-arc': 'Arc lamp',
  'lamp-post': 'Street lamp',
  'lantern-floor': 'Paper floor lantern',
  'lantern-string': 'String of lanterns',
  'logo-wall': 'Logo wall',
  'materials-shelf': 'Materials shelf',
  'menu-board': 'Menu board',
  'mission-patches': 'Mission patches',
  'ottoman.green': 'Green ottoman',
  'paper-bin': 'Paper roll bin',
  'parts-rack': 'Parts rack',
  'pastry-case': 'Pastry case',
  'pennant.mobile': 'Pennant: Mobile',
  'pennant.platform': 'Pennant: Platform',
  picnic: 'Picnic table',
  pinup: 'Pin-up wall',
  'plan-chest': 'Plan chest',
  'plant.a': 'Potted plant',
  'plant.b': 'Tall potted plant',
  'plant.fern': 'Fern',
  'plant.fiddle': 'Fiddle-leaf fig',
  'plant.ivy': 'Ivy',
  'plant.pothos': 'Pothos',
  'plant.snake': 'Snake plant',
  'planter.brass': 'Brass planter',
  'pool-table': 'Pool table',
  'popcorn-cart': 'Popcorn cart',
  'poster.ship': 'Poster: Ship it',
  'print.poster': 'Art print',
  'prize-counter': 'Prize counter',
  reception: 'Reception desk',
  register: 'Cash register',
  'rocket-model': 'Rocket model',
  'rocket-statue': 'Rocket statue',
  'screen.countdown': 'Countdown screen',
  'sculpture.cairn': 'Stone cairn',
  'sculpture.sphere': 'Armillary sphere',
  'server-rack': 'Server rack',
  'side-table.walnut': 'Walnut side table',
  'sign-quiet': 'Quiet sign',
  'star-map': 'Star map',
  stool: 'Stool',
  'stool.drafting': 'Drafting stool',
  'stool.neon': 'Neon stool',
  swatches: 'Colour swatches',
  'table-high.neon': 'Neon high table',
  'table-long': 'Long table',
  'table-long.light': 'Light long table',
  'table-low': 'Coffee table',
  'table-low.side': 'Low side table',
  'table-round': 'Round table',
  'table-side.brass': 'Brass side table',
  'time-capsule': 'Time capsule',
  'trophy-case': 'Trophy case',
  'vending-machine': 'Vending machine',
  'water-cooler': 'Water cooler',
  whiteboard: 'Whiteboard',
  'whiteboard-stand': 'Whiteboard on a stand',
};

/** Large pieces that stand on one base narrower than their footprint (a pot, a post, a pedestal, a trunk). */
const CENTRED_LARGE = /^(plant\.|reeds|birdbath|table-round|lamp-arc|heirloom-dragonlamp|sculpture\.|stump|scarecrow|umbrella-table|wildflowers|tree\/|lamp-post|garden-lantern)/;
/** Used from any side (not from a working face). */
const ANY_FACE = /^(pool-table|air-hockey|heirloom-bell|heirloom-globe|globe-stand|fountain|plant|fire-ring|gazebo|lighthouse|rocket-statue|tree\/|birdbath|heirloom-gold|heirloom-trophy|time-capsule|rocket-model)/;
/** Mirror pieces whose back honestly looks the same as their front (art/rotation.py's audit). */
const SAME_FROM_BEHIND = new Set([
  'book-stack', 'coat-rack', 'cocktail-table', 'flower-stand', 'fruit-bowl', 'globe-stand', 'ottoman.green', 'paper-bin',
  'plant.fern', 'plant.fiddle', 'plant.ivy', 'plant.snake', 'planter.brass', 'plinth', 'stool.drafting', 'table-high.neon',
  'table-side.brass', 'side-table.walnut', 'picnic', 'table-low', 'heirloom-bell', 'balloons', 'balloons.b', 'balloons.c',
]);
/**
 * Animated models whose drawing from some side honestly shows nothing moving (the back of an arcade cabinet, a
 * desk's monitors from behind, a grandfather clock's back). Anything not listed must animate in every drawing
 * (the cake's candles and the air hockey table's lights show from behind too).
 */
const STILL_BACKS = /^(arcade-cabinet|desk|clock-grand|fireplace|vending-machine)/;
/** Strongly themed pieces. */
const THEMED: Array<[RegExp, Theme[]]> = [
  [/neon/, ['neon']],
  [/^(balloons|banner|lantern-string|cake-table|lantern-floor)/, ['festive']],
];
/** Where unused pieces suit, by category. */
const DEFAULT_ROOMS: Partial<Record<ModelCategory, RoomKind[]>> = {
  nature: ['outdoors'],
  street: ['outdoors'],
  landmark: ['outdoors'],
  building: ['outdoors'],
  rug: ['outdoors', 'lounge'],
  play: ['arcade'],
  decor: ['lobby', 'lounge'],
  table: ['cafe', 'lounge'],
};

const GENERIC = new Set(['a', 'b', 'c', 'the']);

function humanize(key: string): string {
  const [base, ...variant] = key.replace(/^tree\//, 'tree-').split('.');
  const words = base.replace(/^heirloom-/, '').split('-');
  const v = variant.filter((x) => !GENERIC.has(x)).join(' ');
  const s = `${v ? `${v} ` : ''}${words.join(' ')}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tags(key: string, cat: ModelCategory): string[] {
  const t = new Set(
    key
      .replace(/^tree\//, 'tree.')
      .split(/[./-]/)
      .filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w))
      .map((w) => w.replace(/\d+$/, '')),
  );
  if (key.startsWith('heirloom-')) t.add('heirloom');
  t.add(cat);
  return [...t];
}

interface Use {
  rooms: Set<RoomKind>;
  actions: Set<string>;
  flat: number;
  open: number;
  onSurface: number;
  n: number;
  surfaceZ: number[];
}

function usage(): Map<string, Use> {
  const by = new Map<string, Use>();
  for (const s of allScenes().values()) {
    for (const o of s.objects) {
      const k = o.variant ? `${o.sprite}.${o.variant}` : o.sprite;
      for (const key of new Set([k, o.sprite])) {
        const u = by.get(key) ?? { rooms: new Set(), actions: new Set(), flat: 0, open: 0, onSurface: 0, n: 0, surfaceZ: [] };
        u.n++;
        const kind = ROOM_KIND_OF[s.id];
        if (kind) u.rooms.add(kind);
        for (const a of o.actions ?? []) u.actions.add(a.kind);
        if (o.flat) u.flat++;
        if (o.solid === false) u.open++;
        if (o.z !== undefined) u.onSurface++;
        by.set(key, u);
      }
      // what stands on what: a host's surface is the z of the things resting on it
      if (o.z !== undefined) {
        const host = s.objects.find((p) => p !== o && p.z === undefined && !p.flat && o.x >= p.x && o.x < p.x + (p.w ?? 1) && o.y >= p.y && o.y < p.y + (p.d ?? 1));
        if (host) {
          const hk = host.variant ? `${host.sprite}.${host.variant}` : host.sprite;
          const u = by.get(hk);
          if (u) u.surfaceZ.push(o.z);
        }
      }
    }
  }
  return by;
}

function derive(key: string, e: ModelSpec, use: Map<string, Use>, dr: Drawings, decorNames: Map<string, string>): Partial<ModelSpec> {
  const cat: ModelCategory = e.wall ? 'wall-art' : (CATEGORY.find(([re]) => re.test(key))?.[1] ?? 'decor');
  const u = use.get(key) ?? use.get(key.split('.')[0]);
  const rooms: RoomKind[] = u?.rooms.size ? [...u.rooms] : (DEFAULT_ROOMS[cat] ?? ['lounge']);
  const out: Partial<ModelSpec> = {
    name: NAMES[key] ?? decorNames.get(key) ?? humanize(key),
    category: cat,
    tags: tags(key, cat),
    rooms,
  };
  const themes = THEMED.find(([re]) => re.test(key))?.[1];
  if (themes) out.themes = themes;
  // measured from the drawings
  let h = 0;
  let small = false;
  for (const f of FACINGS) {
    const p = place(e, f, dr);
    if (!p) continue;
    const s = isSmall(p.img, p.w, p.d);
    if (f === 'se') small = s;
    h = Math.max(h, measuredHeight(p, s));
  }
  out.height = e.wall ? e.wall.v[1] - e.wall.v[0] : Math.max(1, Math.round(h));
  if (!e.wall) out.base = small || CENTRED_LARGE.test(key) ? 'centred' : 'filled';
  if (e.rotation === 'mirror' && SAME_FROM_BEHIND.has(key)) out.sameFromBehind = true;
  // how it's walked and layered
  const seat = cat === 'seating';
  out.walk = e.wall || cat === 'rug' || (u && u.n && u.open + u.flat === u.n) ? 'open' : seat ? 'seat' : 'blocked';
  out.layer = e.wall ? 'wall' : cat === 'rug' || (u && u.n && u.flat === u.n) ? 'floor' : u && u.n && u.onSurface === u.n ? 'surface' : 'object';
  if (u?.surfaceZ.length) out.surface = Math.max(...u.surfaceZ);
  // what it offers
  const actions = new Set(u?.actions ?? []);
  if (seat) actions.add('sit');
  actions.delete('exit');
  if (actions.size) out.use = { face: ANY_FACE.test(key) && !seat ? 'any' : 'front', actions: [...actions] as NonNullable<ModelSpec['use']>['actions'] };
  return out;
}

/** Declare the animation hooks the drawings have (animations.ts). */
function animation(key: string, e: ModelSpec, report: string[]) {
  const drawings = drawingsOf(e);
  const distinct = FACINGS.filter((f, i) => drawings[f] && FACINGS.findIndex((g) => drawings[g]?.file === drawings[f]!.file) === i);
  const moving = distinct.filter((f) => hasAnimation(drawings[f]!.file));
  if (!moving.length || e.animated !== undefined) return;
  e.animated = true;
  const still = STILL_BACKS.test(key) ? distinct.filter((f) => !moving.includes(f)) : [];
  if (still.length) e.still = still;
  report.push(`${key}: animated${still.length ? `, still from ${still.join(', ')}` : ''}`);
}

/** Carry a light found only on the first drawing to the others (see the header). */
function lights(e: ModelSpec, dr: Drawings, report: string[], key: string) {
  if (!e.light || !e.facings) return;
  // the entry's light belongs to its first drawing (art.ts: the first facing record, in the order written)
  const drawn = Object.keys(e.facings) as Facing[];
  const first = drawn[0];
  const files = new Set(drawn.map((f) => e.facings![f]!.file));
  if (files.size < 2) return;
  // where the footprint's centre falls in a drawing at runtime: a small piece is centred by its base (art.ts)
  const centre = (f: Facing): [number, number] | null => {
    const p = place(e, f, dr);
    if (!p) return null;
    return isSmall(p.img, p.w, p.d) ? baseCentre(p.img) : footprintCentre(p.ax, p.ay, p.w, p.d);
  };
  const c0 = centre(first);
  if (!c0) return;
  const [cx0, cy0] = c0;
  const dx = e.light.x - cx0;
  const dy = e.light.y - cy0;
  const done = new Set([e.facings[first]!.file]);
  for (const f of drawn) {
    const rec = e.facings[f]!;
    if (done.has(rec.file) || rec.light) continue;
    done.add(rec.file);
    const c = centre(f);
    if (!c) continue;
    const [cx, cy] = c;
    rec.light = { x: Math.round(cx - dx), y: Math.round(cy + dy), ...(e.light.r !== undefined ? { r: e.light.r } : {}) };
    report.push(`${key}: ${f} light ${JSON.stringify(rec.light)}`);
  }
}

function main() {
  const dry = process.argv.includes('--dry');
  const fixFill = process.argv.includes('--fix-fill');
  const remeasure = process.argv.includes('--remeasure');
  const use = usage();
  const dr = new Drawings(['public/art/sprites']);
  const decorNames = new Map(DECOR_CATALOG.map((d) => [d.variant ? `${d.sprite}.${d.variant}` : d.sprite, d.name]));
  const report: string[] = [];
  const apply = (m: ReturnType<typeof loadManifest>) => {
    for (const [key, e] of Object.entries(m.sprites)) {
      const d = derive(key, e, use, dr, decorNames);
      const added: string[] = [];
      for (const [k, v] of Object.entries(d) as Array<[keyof ModelSpec, unknown]>)
        if (e[k] === undefined) {
          (e as unknown as Record<string, unknown>)[k] = v;
          added.push(k);
        }
      if (added.length) report.push(`${key}: +${added.join(', ')}`);
      if (remeasure && !e.wall && d.height !== undefined && d.height !== e.height) {
        report.push(`${key}: height ${e.height} -> ${d.height}`);
        e.height = d.height;
      }
      animation(key, e, report);
      lights(e, dr, report, key);
      if (!fixFill || e.wall || e.rotation === 'fixed' || !e.base) continue;
      // the fill rule: move each drawing's anchor (as drawn, unmirrored; its mirror follows) until it stands right
      const drawings = drawingsOf(e);
      const done = new Set<string>();
      for (const f of FACINGS) {
        const rec = drawings[f];
        if (!rec?.anchor || done.has(rec.file)) continue;
        done.add(rec.file);
        const p = place(e, f, dr);
        if (!p || p.mirrored || isSmall(p.img, p.w, p.d)) continue;
        if (!fillProblems(p.img, p.ax, p.ay, p.w, p.d, e.base).length) continue;
        const a = fillAnchor(p.img, p.ax, p.ay, p.w, p.d, e.base);
        if (!a) {
          report.push(`${key} ${rec.file}: can't be fixed by moving it (${fillProblems(p.img, p.ax, p.ay, p.w, p.d, e.base).join('; ')})`);
          continue;
        }
        report.push(`${key} ${rec.file}: anchor ${JSON.stringify(rec.anchor)} -> ${JSON.stringify(a)} (${fillProblems(p.img, p.ax, p.ay, p.w, p.d, e.base).join('; ')})`);
        if (e.file === rec.file) e.anchor = a;
        for (const g of FACINGS) if (e.facings?.[g]?.file === rec.file) e.facings[g]!.anchor = a;
      }
    }
  };
  if (dry) apply(loadManifest());
  else withManifestLock(apply);
  console.log(report.join('\n'));
  console.log(`${report.length} change(s)${dry ? ' (dry run)' : ''}; counter top is ${COUNTER_TOP}`);
}

main();
