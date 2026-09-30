/**
 * THE SEAT CATALOG: every seat in the game, as a spec on the seat framework (src/shared/world/seatSpec.ts). Each is
 * built into its model and drawn by the renderer (seatRender.ts) — at runtime by the client (sprites/art.ts), and
 * by `scripts/seat-build.ts` into public/art/sprites/*.png and the manifest, which the server and the tools read.
 * The gate (scripts/seat-grade.ts) proves the PNGs match the runtime render and grades every seat in every facing.
 *
 * Keys are what the rooms place (interiors.ts, northstarTown.ts): a family and a variant (couch.green). Add a seat
 * by adding a spec here; a new variant of a family reuses the family's kind with its own materials.
 */
import type { Facing } from '../world/scene';
import { buildSeat, type Material, type SeatBuild, type SeatSpec } from '../world/seatSpec';
import { renderSeat, type SeatArt } from './seatRender';

const m = (base: string, kind: Material['kind']): Material => ({ base, kind });

// the house ramps (art/ART_DIRECTION.md)
const OAK = m('#a0683f', 'wood');
const OAK_DARK = m('#7a4a2e', 'wood');
const WALNUT = m('#4a2c20', 'wood');
const BRASS = m('#d99a2b', 'gold');
const GOLD = m('#f2c14e', 'gold');
const IRON = m('#43324a', 'iron');
const CHROME = m('#bdb5c2', 'chrome');
const CHARCOAL = m('#3a3a46', 'plastic');

export const SEAT_SPECS: SeatSpec[] = [
  /* ---- armchairs */
  {
    key: 'armchair.green',
    name: 'Green wingback',
    kind: 'armchair',
    rooms: ['lounge'],
    tags: ['armchair', 'green', 'wingback', 'leather'],
    back: { style: 'wing', height: 14, detail: 'tuft' },
    arms: { style: 'roll', height: 6 },
    mat: { fabric: m('#24594a', 'leather'), frame: WALNUT, accent: m('#204f42', 'leather'), trim: BRASS },
    note: 'a deep green Chesterfield wingback: tufted back, rolled arms, turned walnut feet',
  },
  {
    key: 'armchair.mustard',
    name: 'Mustard armchair',
    kind: 'armchair',
    rooms: ['lobby', 'cafe', 'office', 'studio'],
    tags: ['armchair', 'mustard', 'yellow', 'club'],
    back: { style: 'padded', height: 12 },
    arms: { style: 'roll', height: 6 },
    mat: { fabric: m('#e0b03f', 'fabric'), frame: OAK_DARK, accent: m('#d4a437', 'fabric') },
    note: 'a mustard club chair with rolled arms on oak feet',
  },
  {
    key: 'armchair.rust',
    name: 'Rust wingback',
    kind: 'armchair',
    rooms: ['lounge'],
    tags: ['armchair', 'rust', 'wingback', 'leather'],
    back: { style: 'wing', height: 14, detail: 'tuft' },
    arms: { style: 'roll', height: 6 },
    mat: { fabric: m('#c56a3f', 'leather'), frame: WALNUT, accent: m('#b45f38', 'leather'), trim: BRASS },
    note: 'a rust leather wingback with a tufted back and brass nailheads',
  },
  /* ---- beanbags */
  ...(
    [
      ['cyan', '#3ec7e0', ['office', 'lab', 'arcade']],
      ['orange', '#ff8a3d', ['office', 'lab']],
      ['pink', '#e27ca7', ['arcade']],
      ['purple', '#8b62c9', ['office', 'arcade']],
    ] as Array<[string, string, SeatSpec['rooms']]>
  ).map<SeatSpec>(([v, hex, rooms]) => ({
    key: `beanbag.${v}`,
    name: `${v[0].toUpperCase()}${v.slice(1)} beanbag`,
    kind: 'beanbag',
    rooms,
    tags: ['beanbag', v, 'vinyl'],
    mat: { fabric: m(hex, 'vinyl'), frame: m(hex, 'vinyl') },
  })),
  /* ---- benches */
  {
    key: 'bench',
    name: 'Park bench',
    kind: 'bench',
    rooms: ['outdoors', 'lobby', 'lab'],
    tags: ['bench', 'park', 'oak', 'iron'],
    back: { style: 'slats', height: 11 },
    legs: { style: 'iron' },
    mat: { fabric: m('#c98f5a', 'wood'), frame: IRON, accent: m('#c98f5a', 'wood') },
    note: 'oak slats on cast-iron ends, a two-board back',
  },
  {
    key: 'bench-garden.teal',
    name: 'Teal garden bench',
    kind: 'bench',
    rooms: ['outdoors', 'lounge'],
    tags: ['bench', 'garden', 'teal', 'painted'],
    back: { style: 'slats', height: 11 },
    legs: { style: 'ends' },
    mat: { fabric: m('#5fb3a8', 'wood'), frame: m('#4e9a90', 'wood'), accent: m('#5fb3a8', 'wood') },
    note: 'a painted teal garden bench, boards on plank ends',
  },
  {
    key: 'bench.navy',
    name: 'Navy bench',
    kind: 'bench',
    rooms: ['lobby', 'lab'],
    tags: ['bench', 'navy', 'velvet', 'brass'],
    cushion: { z: 9.5, thick: 3, detail: 'tuft' },
    legs: { style: 'tapered' },
    mat: { fabric: m('#2b3f77', 'velvet'), frame: BRASS },
    note: 'a tufted navy velvet bench on tapered brass legs',
  },
  /* ---- chairs */
  {
    key: 'chair-bistro.sage',
    name: 'Sage bistro chair',
    kind: 'chair',
    rooms: ['cafe', 'lounge'],
    tags: ['chair', 'bistro', 'sage', 'cane'],
    cushion: { detail: 'weave' },
    back: { style: 'ladder', height: 12 },
    legs: { style: 'turned' },
    mat: { fabric: m('#e4d3b5', 'wood'), frame: m('#7aa578', 'wood') },
    note: 'a sage-painted bentwood bistro chair with a cane seat',
  },
  {
    key: 'chair.cafe',
    name: 'Café chair',
    kind: 'chair',
    rooms: ['outdoors', 'cafe', 'hall'],
    tags: ['chair', 'cafe', 'bentwood', 'oak', 'cane'],
    cushion: { detail: 'weave' },
    back: { style: 'ladder', height: 12 },
    legs: { style: 'turned' },
    mat: { fabric: m('#e4d3b5', 'wood'), frame: OAK },
    note: 'an oak bentwood café chair with a cane seat',
  },
  {
    key: 'chair.office',
    name: 'Office chair',
    kind: 'chair',
    rooms: ['lobby', 'office', 'lab', 'studio'],
    tags: ['chair', 'office', 'desk', 'mesh'],
    back: { style: 'slab', height: 13, thick: 0.08 },
    arms: { style: 'rail', height: 6, width: 0.1 },
    legs: { style: 'cross' },
    mat: { fabric: m('#5b5fc7', 'fabric'), frame: CHARCOAL, accent: m('#454556', 'fabric') },
    note: 'a charcoal mesh task chair on a caster base, a blue seat',
  },
  {
    key: 'chair.red',
    name: 'Red banquet chair',
    kind: 'chair',
    rooms: ['hall'],
    tags: ['chair', 'red', 'velvet', 'gold', 'banquet'],
    cushion: { thick: 2.5 },
    back: { style: 'slab', height: 12, thick: 0.1 },
    legs: { style: 'tapered' },
    mat: { fabric: m('#c6412f', 'velvet'), frame: BRASS, accent: m('#c6412f', 'velvet') },
    note: 'a red velvet banquet chair on a gold frame',
  },
  {
    key: 'chair.wood',
    name: "Captain's chair",
    kind: 'chair',
    rooms: ['lounge'],
    tags: ['chair', 'wood', 'oak', 'leather', 'captain'],
    back: { style: 'rails', height: 12 },
    arms: { style: 'rail', height: 6, width: 0.08 },
    legs: { style: 'turned' },
    mat: { fabric: m('#3f9a6b', 'leather'), frame: OAK_DARK },
    note: "an oak captain's chair with a green leather seat",
  },
  /* ---- couches */
  {
    key: 'couch.blue',
    name: 'Navy sofa',
    kind: 'couch',
    rooms: ['lobby', 'office', 'lab'],
    tags: ['couch', 'sofa', 'navy', 'blue', 'velvet'],
    back: { style: 'padded', height: 12, thick: 0.2 },
    arms: { style: 'padded', height: 6, width: 0.14 },
    legs: { style: 'skirt' },
    mat: { fabric: m('#2f4f8f', 'velvet'), frame: WALNUT, accent: m('#2a4780', 'velvet') },
    note: 'a navy velvet mid-century sofa on walnut feet',
  },
  {
    key: 'couch.green',
    name: 'Green Chesterfield',
    kind: 'couch',
    rooms: ['cafe', 'office', 'studio'],
    tags: ['couch', 'sofa', 'green', 'leather', 'chesterfield'],
    back: { style: 'padded', height: 13, detail: 'tuft' },
    arms: { style: 'roll', height: 6 },
    legs: { style: 'skirt' },
    mat: { fabric: m('#24594a', 'leather'), frame: WALNUT, accent: m('#204f42', 'leather'), trim: BRASS },
    note: 'a green leather Chesterfield: tufted back, rolled arms',
  },
  {
    key: 'couch.purple',
    name: 'Purple loveseat',
    kind: 'couch',
    rooms: ['arcade'],
    tags: ['couch', 'loveseat', 'purple', 'satin', 'neon'],
    themes: ['neon', 'dim'],
    back: { style: 'padded', height: 12, thick: 0.2 },
    arms: { style: 'roll', height: 6 },
    legs: { style: 'skirt' },
    mat: { fabric: m('#8b3fc4', 'vinyl'), frame: CHROME, accent: m('#7c36b3', 'vinyl'), trim: m('#e05ad8', 'plastic') },
    note: 'a glossy purple loveseat with rolled arms on chrome feet',
  },
  /* ---- the throne */
  {
    key: 'heirloom-throne',
    name: "The Founders' Throne",
    kind: 'throne',
    rooms: ['lobby'],
    tags: ['throne', 'heirloom', 'gold', 'velvet'],
    mat: { fabric: m('#2f5f8f', 'velvet'), frame: BRASS, trim: GOLD },
    note: 'a gold throne with a tufted blue velvet seat and back and a sunburst crest',
  },
  /* ---- ottoman */
  {
    key: 'ottoman.green',
    name: 'Green pouf',
    kind: 'ottoman',
    rooms: ['lounge'],
    tags: ['ottoman', 'pouf', 'green', 'velvet'],
    mat: { fabric: m('#2f6d55', 'velvet'), frame: WALNUT },
    note: 'a round tufted green velvet pouf on turned feet',
  },
  /* ---- stools */
  {
    key: 'stool',
    name: 'Bar stool',
    kind: 'barstool',
    rooms: ['cafe', 'lab', 'arcade', 'studio'],
    tags: ['stool', 'bar', 'oak', 'iron'],
    cushion: { detail: 'grain' },
    mat: { fabric: OAK, frame: IRON },
    note: 'an oak-topped bar stool on an iron column with a footring',
  },
  {
    key: 'stool.drafting',
    name: 'Drafting stool',
    kind: 'barstool',
    rooms: ['studio'],
    tags: ['stool', 'drafting', 'yellow', 'chrome'],
    cushion: { z: 13, thick: 2.5 },
    legs: { height: 10.5 },
    rest: 4,
    mat: { fabric: m('#e0b03f', 'vinyl'), frame: CHROME },
    note: 'a yellow vinyl drafting stool on a chrome gas lift',
  },
  {
    key: 'stool.neon',
    name: 'Diner stool',
    kind: 'barstool',
    rooms: ['arcade'],
    tags: ['stool', 'diner', 'pink', 'chrome', 'neon'],
    themes: ['neon', 'dim'],
    cushion: { thick: 3 },
    mat: { fabric: m('#e8407a', 'vinyl'), frame: CHROME },
    note: 'a pink vinyl diner stool on a chrome pedestal',
  },
];

const byKey = new Map(SEAT_SPECS.map((s) => [s.key, s]));
export const seatSpecOf = (key: string): SeatSpec | undefined => byKey.get(key);
export const isCatalogSeat = (key: string) => byKey.has(key);

const builds = new Map<string, SeatBuild>();
/** A catalog seat built (memoised: the build is pure). */
export function seatBuildOf(key: string): SeatBuild | undefined {
  const had = builds.get(key);
  if (had) return had;
  const spec = byKey.get(key);
  if (!spec) return undefined;
  const b = buildSeat(spec);
  builds.set(key, b);
  return b;
}

const arts = new Map<string, SeatArt>();
/** A catalog seat drawn in a facing (memoised: the render is pure and deterministic). */
export function seatArtOf(key: string, facing: Facing): SeatArt | undefined {
  const k = `${key}|${facing}`;
  const had = arts.get(k);
  if (had) return had;
  const b = seatBuildOf(key);
  if (!b) return undefined;
  const art = renderSeat(b.model, b.spec.mat, facing);
  arts.set(k, art);
  return art;
}

/** Forget every built seat and drawing (the tools rebuild after editing specs). */
export function resetSeatCache() {
  builds.clear();
  arts.clear();
}
