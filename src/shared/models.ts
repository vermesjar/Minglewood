/**
 * THE MODEL SPEC: what every model in the catalog declares. A model is one entry of public/art/manifest.json
 * (key → ModelSpec): a piece of furniture, a prop, a plant, wall art, a building.
 *
 * Who uses it: art/studio.py writes entries (and refuses to publish an incomplete one), the Design Lab drafts
 * them, the client draws and places them (sprites/art.ts, decorate mode), and `npx tsx scripts/model-check.ts`
 * (in scripts/gate.sh) fails any entry that breaks the standard. docs/furniture.md says the same in prose.
 *
 * Units. Drawings are at the manifest's `scale` (2: 64 px per floor tile); points in a drawing (anchor, light,
 * emitters) are drawing px. Heights and surface z are ART px (1×: a floor tile is 32×16), like SceneObject.z.
 */
import type { Facing, ObjectAction } from './world/scene';
import { SEAT_FIELDS, type SeatProfile } from './world/seats';

export const FACINGS: readonly Facing[] = ['se', 'sw', 'ne', 'nw'];
/** A missing facing is drawn as the mirror image of its partner. */
export const MIRROR_OF: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
export const FRONTS: readonly Facing[] = ['se', 'sw'];
export const BACKS: readonly Facing[] = ['ne', 'nw'];

/* ─────────────────────────── identity & catalog ─────────────────────────── */

export const CATEGORIES = [
  'seating', // chairs, stools, couches, benches, beanbags: things you sit on
  'table', // tables, desks, workbenches, buffets
  'counter', // reception desks, prize counters: served across
  'storage', // shelves, cabinets, display cases, racks
  'appliance', // machines: espresso, vending, fridge, water cooler, server rack, fireplace
  'lighting', // lamps and lanterns that light up
  'play', // arcade cabinets, pool and air hockey, the jukebox, the piano
  'plant', // potted plants and planters
  'decor', // ornaments, sculptures, easels, balloons, trophies, things for counters
  'rug', // floor coverings: drawn beneath everything, walked over
  'wall-art', // frames, posters, boards and signs on the wall
  'street', // outdoor furniture: lamp posts, mailboxes, signposts, carts, boats
  'nature', // trees, bushes, flowerbeds, reeds
  'landmark', // one-off town pieces: the fountain, the gazebo, the lighthouse
  'building', // the town's buildings
] as const;
export type ModelCategory = (typeof CATEGORIES)[number];

/** Kinds of room a model suits (the decorate palette offers it there first). */
export const ROOM_KINDS = ['lobby', 'office', 'cafe', 'lab', 'hall', 'lounge', 'arcade', 'studio', 'outdoors'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** The rooms that exist, by kind. */
export const ROOM_KIND_OF: Record<string, RoomKind> = {
  hq: 'lobby',
  eng: 'office',
  cafe: 'cafe',
  launch: 'lab',
  events: 'hall',
  focus: 'lounge',
  arcade: 'arcade',
  design: 'studio',
  town: 'outdoors',
};

/** A room's mood (InteriorTheme.ambient). A model that lists themes suits only those; none = any. */
export const THEMES = ['warm', 'bright', 'dim', 'neon', 'festive'] as const;
export type Theme = (typeof THEMES)[number];

/* ─────────────────────────── drawings ─────────────────────────── */

/**
 * How a model turns (docs/furniture.md). Every model turns four ways and works from each:
 *   radial  one drawing, true from every side (round or amorphous)
 *   mirror  a front (se|sw) and a back (ne|nw); the other two sides are their mirror images. Only for models
 *           left-right symmetric about the way they face.
 *   full    four drawings: anything handed (a piano, a cart's wheel at one end, sign arrows)
 *   flat    wall art: one drawing, never mirrored (text and logos read the right way on either wall)
 *   fixed   buildings and landmarks that are part of the map and never turn
 */
export const ROTATIONS = ['radial', 'mirror', 'full', 'flat', 'fixed'] as const;
export type Rotation = (typeof ROTATIONS)[number];

export type EmitterKind = 'smoke' | 'spray' | 'blink' | 'beam';
export interface LightPoint {
  x: number;
  y: number;
  /** Radius of the pool of light, drawing px (default 40). */
  r?: number;
}
export interface Emitter {
  kind: EmitterKind;
  x: number;
  y: number;
}

/** One drawing of a model, and the points in it (drawing px). */
export interface Drawing {
  file: string;
  /** The footprint's back vertex (tile x0,y0 at floor level) in this drawing. */
  anchor?: [number, number];
  /** This drawing's lamp, night glow mask and emitters. A model with more than one real drawing puts them on
   *  each drawing (they're in a different place from each side); mirrored sides reflect them. */
  light?: LightPoint;
  glow?: string;
  emitters?: Emitter[];
}

/**
 * Base contact, the furniture standard's footing rule:
 *   centred  a SMALL model (well narrower than its footprint: a lamp, an espresso machine, an ornament) stands
 *            with its base centred on the footprint's centre, whatever its drawing's anchor says (art.ts)
 *   filled   a model that fills its footprint: its base reaches the diamond's corners and never spills past them
 */
export type BaseContact = 'centred' | 'filled';

/* ─────────────────────────── size ─────────────────────────── */

/**
 * Height classes, from `height` (art px). Tall and towering models hide people standing behind them.
 *   flat < 4 (rugs) · low < 20 (under a counter top: stools, coffee tables, beanbags) · mid < 40 (chairs, desks,
 *   counters: up to a person's shoulder) · tall < 72 (shelves, lamps, vending machines: taller than a person) ·
 *   towering ≥ 72 (trees, grand clocks, buildings)
 */
export type HeightClass = 'flat' | 'low' | 'mid' | 'tall' | 'towering';
export function heightClass(h: number): HeightClass {
  return h < 4 ? 'flat' : h < 20 ? 'low' : h < 40 ? 'mid' : h < 72 ? 'tall' : 'towering';
}

/* ─────────────────────────── use ─────────────────────────── */

/**
 * Walkability:
 *   blocked  nobody walks through it
 *   seat     blocked, but its tiles are where people sit (the path ends on them)
 *   open     walked over (rugs) or not on the floor at all (wall art)
 */
export type Walk = 'blocked' | 'seat' | 'open';

/**
 * Z / occlusion class, how it's layered:
 *   floor    drawn beneath everything (rugs, mats, blankets)
 *   object   stands on the floor, depth-sorted with people by its footprint
 *   surface  stands on another model's `surface` (an espresso machine on a counter): placed with that z and
 *            drawn right after it; never on the bare floor
 *   wall     painted into the wall
 */
export type Layer = 'floor' | 'object' | 'surface' | 'wall';

export type ActionKind = ObjectAction['kind'];

/**
 * How a model is used: what clicking it does and where people stand to do it.
 *   face 'front'  used from the tiles in front of its working face (the way it faces): an espresso machine, a
 *                 bookshelf, a seat, anything on a wall
 *   face 'any'    used from any side (a bell, a globe, a pool table, a plant)
 * `actions` are the kinds of ObjectAction it offers (the objects that place it carry the actions themselves).
 */
export interface UseSpec {
  face: 'front' | 'any';
  actions: ActionKind[];
}

/**
 * Wall art: where it hangs. Its SIZE is never declared: it comes from its drawing (THE WALL ART STANDARD below).
 */
export interface WallSpec {
  /**
   * Wall units (art px) above the floor, bottom to top. The bottom is where it hangs; the top is always the bottom
   * plus half the drawing's height (the standard: model-check fails anything else).
   */
  v: [number, number];
  /**
   * Retired: wall art is centred in its span (the standard). Old entries may still carry one; it's ignored, and
   * the model check asks for it to be removed.
   */
  margin?: number;
  /** Which walls it may hang on (default both). Either way it reads the right way round: never mirrored. */
  walls?: Array<'left' | 'right'>;
  /** It carries lettering or a logo. */
  text?: boolean;
  /** It stands on the floor, through the baseboard, like a door (a lift): its bottom is 0. */
  floor?: boolean;
}

/* ─────────────────────────── THE WALL ART STANDARD ─────────────────────────── */

/**
 * Wall art is drawn at exactly 2:1 against the wall: one drawing px is half a wall unit each way. Along the wall
 * that's 32 drawing px per tile (the wall shows 16 art px per tile), up it 2 drawing px per wall unit (art px). The
 * wall texture has exactly that density (interior.ts), so a drawing lands on it pixel for pixel, never resampled:
 * nearest-neighbour squeezing drops whole pixel columns (the café's menu board lost its right frame that way).
 *
 * The rules (wallFit, checked for every model by scripts/model-check.ts and for every placed piece by room-map
 * and decorate-mode placement):
 *   - its size is its drawing's: w/32 tiles wide, h/2 wall units tall (`wall.v` records bottom and top; the top
 *     must be bottom + h/2)
 *   - it's centred in its span (a whole number of drawing px from each end) and inside it
 *   - what shows of it (its opaque pixels) stays clear of the baseboard (≥ WALL_BASEBOARD, unless it stands on the
 *     floor: `wall.floor`) and of the crown moulding (≤ WALL_CROWN)
 *   - its bottom lands on a whole drawing px (a multiple of half a unit)
 *   - a drawing that doesn't fit its span is a model-spec error: the span (footprint[0]) grows. Never a squeeze.
 */
export const WALL_PX_PER_TILE = 32;
export const WALL_PX_PER_UNIT = 2;
/** The room's wall height (ground.ts WALL_H), wall units. */
export const WALL_HEIGHT = 62;
/** The top of the baseboard, wall units. */
export const WALL_BASEBOARD = 4.5;
/** The bottom of the crown moulding (WALL_HEIGHT − 4), wall units. */
export const WALL_CROWN = 58;
/** Drawing px kept clear at each end of its span (none: a string of lanterns may run its whole span). */
export const WALL_EDGE_PX = 0;

/** Where a wall drawing lands in its span, by the standard, and what (if anything) breaks it. */
export interface WallFit {
  /** Drawing px from the span's start to the drawing's left edge (a whole number: it's centred in its span). */
  left: number;
  /** The drawing's size, drawing px. */
  w: number;
  h: number;
  /** Wall units above the floor, bottom and top of the drawing (top = bottom + h/2). */
  v0: number;
  v1: number;
  /**
   * What of it shows (its opaque pixels' bounds; the whole drawing when they aren't known): drawing px from the
   * span's start, and wall units above the floor. The trim and anything standing in front are judged by these.
   */
  vis: { l: number; r: number; v0: number; v1: number };
  problems: string[];
}

/** The fewest tiles a drawing `w` px wide fits in, by the standard. */
export function wallSpanFor(w: number): number {
  return Math.max(1, Math.ceil((w + 2 * WALL_EDGE_PX) / WALL_PX_PER_TILE));
}

/**
 * How a `w`×`h` drawing hangs in a `span`-tile stretch of wall (THE WALL ART STANDARD). `bbox` is the drawing's
 * opaque bounds (footing.ts silhouette: inclusive px), so transparent padding never counts against the trim.
 */
export function wallFit(
  spec: Pick<WallSpec, 'v' | 'floor'>,
  size: { w: number; h: number },
  span: number,
  bbox?: { l: number; r: number; t: number; b: number } | null,
): WallFit {
  const { w, h } = size;
  const U = WALL_PX_PER_UNIT;
  const room = span * WALL_PX_PER_TILE;
  const left = Math.floor((room - w) / 2);
  const v0 = spec.floor ? 0 : spec.v[0];
  const v1 = v0 + h / U;
  const b = bbox ?? { l: 0, r: w - 1, t: 0, b: h - 1 };
  const vis = { l: left + b.l, r: left + b.r + 1, v0: v1 - (b.b + 1) / U, v1: v1 - b.t / U };
  const problems: string[] = [];
  if (w + 2 * WALL_EDGE_PX > room)
    problems.push(`its drawing is ${w} px wide, more than its ${span}-tile span holds at 2:1 (${room - 2 * WALL_EDGE_PX} px): grow its span to ${wallSpanFor(w)}, never squeeze it`);
  if (Math.abs(spec.v[1] - spec.v[0] - h / U) > 1e-6)
    problems.push(`wall.v [${spec.v.join(', ')}] is ${spec.v[1] - spec.v[0]} units tall but its drawing is ${h} px (${h / U} units at 2:1): v must be [${v0}, ${v1}]`);
  if (spec.floor && spec.v[0] !== 0) problems.push(`it stands on the floor (wall.floor): wall.v starts at 0`);
  if (!spec.floor && vis.v0 < WALL_BASEBOARD) problems.push(`it shows down to ${vis.v0}, on the baseboard (below ${WALL_BASEBOARD}): hang it higher (or declare wall.floor)`);
  if (vis.v1 > WALL_CROWN) problems.push(`it shows up to ${vis.v1}, into the crown moulding (above ${WALL_CROWN}): hang it lower`);
  if (Math.abs(v0 * U - Math.round(v0 * U)) > 1e-6) problems.push(`its bottom (${v0}) isn't on a whole drawing px (a multiple of 0.5)`);
  return { left, w, h, v0, v1, vis, problems };
}

/* ─────────────────────────── the spec ─────────────────────────── */

/**
 * The seat section is the seat standard's own SeatProfile (src/shared/world/seats.ts: seat, sitStyle, backrest,
 * arms), written by scripts/seat-build.ts from the seat's spec (src/shared/art/seatCatalog.ts). A colour variant without its own borrows its
 * family's.
 */
export interface ModelSpec extends Partial<SeatProfile> {
  // identity & catalog
  /** What people call it: "Mustard armchair". */
  name: string;
  category: ModelCategory;
  /** Words to find it by: material, colour, style ("walnut", "neon", "heirloom"). At least one. */
  tags: string[];
  /** The kinds of room it suits (at least one). */
  rooms: RoomKind[];
  /** Moods it's limited to; absent = suits any. */
  themes?: Theme[];

  // size
  /**
   * [width, depth] in tiles: width across its front, depth front to back. Facing sw or ne it covers w=width,
   * d=depth; facing se or nw, w=depth, d=width (see footprintFacing).
   */
  footprint: [number, number];
  /** Floor to its top, art px. */
  height: number;

  // drawings
  rotation: Rotation;
  /** One drawing (radial, flat, fixed; and a mirror model that looks the same from behind)… */
  file?: string;
  anchor?: [number, number];
  /** …or one per drawn facing; a missing facing is the mirror of its partner (se↔sw, ne↔nw). */
  facings?: Partial<Record<Facing, Drawing>>;
  /** How the drawing sits on its footprint without an anchor (studio's construction guide gives anchors). */
  fit?: 'anchor' | 'diamond' | 'stand';
  pad?: number;
  /** Base contact (not for wall art). */
  base?: BaseContact;
  /** A mirror model whose back honestly looks the same as its front (a round side table): one image for both. */
  sameFromBehind?: boolean;

  // use
  walk: Walk;
  layer: Layer;
  /** Things can stand on it at this z (art px): a counter's top is 20.5 (COUNTER_TOP). */
  surface?: number;
  use?: UseSpec;

  // light & life (on the entry: its first drawing's; per drawing on `facings` records)
  light?: LightPoint;
  glow?: string;
  emitters?: Emitter[];
  /**
   * Animation hooks (src/client/engine/animations.ts, keyed by drawing file, in that drawing's px, mirrored with
   * it): an animated model has an animation in every drawing except its `still` ones (the back of an arcade
   * cabinet shows no screen).
   */
  animated?: boolean;
  still?: Facing[];

  // wall
  wall?: WallSpec;

  // bookkeeping written by the pipeline
  note?: string;
  lift?: number;
}

export interface Manifest {
  scale: number;
  sprites: Record<string, ModelSpec>;
}

/** Every field a ModelSpec may have (anything else is a typo). */
export const SPEC_FIELDS: ReadonlySet<string> = new Set([
  'name', 'category', 'tags', 'rooms', 'themes', 'footprint', 'height', 'rotation', 'file', 'anchor', 'facings', 'fit',
  'pad', 'base', 'sameFromBehind', 'walk', 'layer', 'surface', 'use', 'light', 'glow', 'emitters', 'animated', 'still',
  'wall', 'note', 'lift', ...SEAT_FIELDS,
]);
const DRAWING_FIELDS = new Set(['file', 'anchor', 'light', 'glow', 'emitters']);

/* ─────────────────────────── helpers ─────────────────────────── */

/** The tiles a model covers facing `facing`: [w, d] (x extent, y extent). */
export function footprintFacing(spec: Pick<ModelSpec, 'footprint'>, facing: Facing): [number, number] {
  const [width, depth] = spec.footprint;
  return facing === 'sw' || facing === 'ne' ? [width, depth] : [depth, width];
}

/** The drawings a rotation needs, as a sentence. */
export function drawingsNeeded(r: Rotation): string {
  return {
    radial: 'one drawing',
    mirror: 'a front (se or sw) and a back (ne or nw) drawing',
    full: 'four drawings (se, sw, ne, nw)',
    flat: 'one wall drawing',
    fixed: 'one drawing',
  }[r];
}

/** The model's drawings: facing → drawing (one-drawing models answer under 'se'). */
export function drawingsOf(spec: Pick<ModelSpec, 'file' | 'anchor' | 'facings'>): Partial<Record<Facing, Drawing>> {
  if (spec.facings) return spec.facings;
  return spec.file ? { se: { file: spec.file, anchor: spec.anchor } } : {};
}

/** The key a scene object's art comes from (sprite, or sprite.variant). */
export const modelKey = (o: { sprite: string; variant?: string }) => (o.variant ? `${o.sprite}.${o.variant}` : o.sprite);

const KEY_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?(\.[a-z0-9][a-z0-9-]*)*$/;

/* ─────────────────────────── the validator ─────────────────────────── */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isNum);

/**
 * What's wrong with one model's declaration (empty = fine). Pure: no files. The drawings themselves (present,
 * turned the right way, standing on their footprint) are checked by scripts/model-check.ts.
 */
export function validateModel(key: string, spec: Partial<ModelSpec>): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(m);
  if (!KEY_RE.test(key)) bad(`key "${key}" isn't lowercase words joined by - (variants after a dot)`);
  for (const f of Object.keys(spec)) if (!SPEC_FIELDS.has(f)) bad(`unknown field "${f}"`);

  // identity
  if (typeof spec.name !== 'string' || !spec.name.trim()) bad('no name');
  if (!CATEGORIES.includes(spec.category as ModelCategory)) bad(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!Array.isArray(spec.tags) || !spec.tags.length || !spec.tags.every((t) => typeof t === 'string' && /^[a-z0-9-]+$/.test(t)))
    bad('tags: at least one lowercase word');
  if (!Array.isArray(spec.rooms) || !spec.rooms.length || !spec.rooms.every((r) => ROOM_KINDS.includes(r)))
    bad(`rooms: at least one of ${ROOM_KINDS.join(', ')}`);
  if (spec.themes !== undefined && (!Array.isArray(spec.themes) || !spec.themes.every((t) => THEMES.includes(t))))
    bad(`themes: some of ${THEMES.join(', ')} (or leave out for any)`);

  // size
  const fp = spec.footprint;
  if (!Array.isArray(fp) || fp.length !== 2 || !fp.every((n) => Number.isInteger(n) && n >= 1)) bad('footprint must be [width, depth] in whole tiles');
  if (!isNum(spec.height) || spec.height <= 0) bad('no height (art px, floor to top)');

  // drawings
  const rot = spec.rotation;
  if (!ROTATIONS.includes(rot as Rotation)) {
    bad(`rotation must be one of ${ROTATIONS.join(', ')}`);
    return out;
  }
  const facings = spec.facings ?? {};
  const drawn = FACINGS.filter((f) => facings[f]);
  if (spec.file && spec.facings) bad('has both a single `file` and `facings`');
  if (!spec.file && !drawn.length) bad('no drawing');
  for (const f of drawn) {
    const d = facings[f]!;
    if (typeof d.file !== 'string') bad(`${f}: drawing has no file`);
    for (const k of Object.keys(d)) if (!DRAWING_FIELDS.has(k)) bad(`${f}: unknown drawing field "${k}"`);
    if (d.anchor !== undefined && !isPt(d.anchor)) bad(`${f}: anchor must be [x, y]`);
  }
  if (spec.anchor !== undefined && !isPt(spec.anchor)) bad('anchor must be [x, y]');
  const fronts = drawn.filter((f) => FRONTS.includes(f));
  const backs = drawn.filter((f) => BACKS.includes(f));
  const oneDrawing = !!spec.file || new Set(drawn.map((f) => facings[f]!.file)).size === 1;
  switch (rot) {
    case 'radial':
    case 'fixed':
      if (!oneDrawing) bad(`${rot} models have one drawing`);
      break;
    case 'flat':
      if (!spec.file || spec.facings) bad('wall art is one drawing (`file`), never per-facing');
      if (!spec.wall) bad("rotation 'flat' is for wall art: it needs `wall`");
      break;
    case 'mirror':
      if (spec.file) {
        // a single drawing serves as front and back only for a model that looks the same from behind
        if (!spec.sameFromBehind) bad(`'mirror' needs ${drawingsNeeded('mirror')}; it has one drawing`);
      } else if (!fronts.length || !backs.length) bad(`'mirror' needs ${drawingsNeeded('mirror')}; it has ${drawn.join('+') || 'none'}`);
      else if (!spec.sameFromBehind && facings[fronts[0]]!.file === facings[backs[0]]!.file)
        bad('its back is the same file as its front: draw the back, or declare sameFromBehind');
      break;
    case 'full': {
      const missing = FACINGS.filter((f) => !facings[f]);
      if (missing.length) bad(`'full' needs ${drawingsNeeded('full')}; missing ${missing.join(', ')}`);
      else if (new Set(FACINGS.map((f) => facings[f]!.file)).size < 4) bad("'full' models have four different drawings");
      break;
    }
  }
  if (spec.sameFromBehind && rot !== 'mirror') bad('sameFromBehind is only for mirror models');
  if ((spec.category === 'wall-art') !== (rot === 'flat')) bad("wall art is category 'wall-art' with rotation 'flat'");
  if (spec.category === 'building' && rot !== 'fixed') bad("buildings have rotation 'fixed'");
  const wallArt = rot === 'flat';
  if (!wallArt && rot !== 'fixed' && spec.base !== 'centred' && spec.base !== 'filled') bad("base must be 'centred' or 'filled'");
  if (wallArt && spec.base !== undefined) bad('wall art has no base');

  // use
  if (!['blocked', 'seat', 'open'].includes(spec.walk as string)) bad("walk must be 'blocked', 'seat' or 'open'");
  if (!['floor', 'object', 'surface', 'wall'].includes(spec.layer as string)) bad("layer must be 'floor', 'object', 'surface' or 'wall'");
  if (wallArt !== (spec.layer === 'wall')) bad("wall art (rotation 'flat') and only wall art has layer 'wall'");
  if (spec.layer === 'wall' && spec.walk !== 'open') bad("wall art doesn't block the floor: walk 'open'");
  if (spec.layer === 'floor' && spec.walk !== 'open') bad("a floor-layer model is walked over: walk 'open'");
  if (spec.surface !== undefined && (!isNum(spec.surface) || spec.surface <= 0)) bad('surface is the z things stand at (art px)');
  if (isNum(spec.surface) && isNum(spec.height) && spec.surface > spec.height + 2) bad(`surface z ${spec.surface} is above its top (${spec.height})`);
  const seatish = spec.walk === 'seat' || spec.category === 'seating';
  if (seatish && spec.walk !== 'seat') bad("seating has walk 'seat'");
  if (spec.walk === 'seat' && spec.category !== 'seating') bad("walk 'seat' is for seating");
  if (spec.seat !== undefined && !seatish) bad('has a seat height but is not seating');
  if (spec.use !== undefined) {
    const u = spec.use;
    if (!u || (u.face !== 'front' && u.face !== 'any')) bad("use.face must be 'front' or 'any'");
    if (!Array.isArray(u?.actions) || !u.actions.length) bad('use.actions: the kinds of action it offers');
    if (spec.walk === 'seat' && !u?.actions?.includes('sit')) bad("a seat's use includes 'sit'");
  } else if (spec.walk === 'seat') bad("a seat needs use: { face: 'front', actions: ['sit'] }");

  // light & life
  const pts = (d: { light?: unknown; emitters?: unknown }, where: string) => {
    if (d.light !== undefined) {
      const l = d.light as LightPoint;
      if (!l || !isNum(l.x) || !isNum(l.y) || (l.r !== undefined && !isNum(l.r))) bad(`${where}light must be {x, y, r?}`);
    }
    if (d.emitters !== undefined && (!Array.isArray(d.emitters) || !d.emitters.every((e: Emitter) => e && isNum(e.x) && isNum(e.y) && ['smoke', 'spray', 'blink', 'beam'].includes(e.kind))))
      bad(`${where}emitters must be [{kind, x, y}]`);
  };
  pts(spec, '');
  for (const f of drawn) pts(facings[f]!, `${f}: `);
  // a lamp drawn from more than one side has its light in each of its drawings (the entry's own applies to a
  // one-drawing model; with several, which drawing it was authored on isn't recorded, so each carries its own)
  const distinct = [...new Set(drawn.map((f) => facings[f]!.file))];
  if (distinct.length > 1) {
    for (const k of ['light', 'glow', 'emitters'] as const) {
      if (spec[k] === undefined && !drawn.some((f) => facings[f]![k] !== undefined)) continue;
      const missing = distinct.filter((file) => !drawn.some((f) => facings[f]!.file === file && facings[f]![k] !== undefined));
      if (missing.length) bad(`${k} must be on each drawing: add it to ${drawn.filter((f) => missing.includes(facings[f]!.file)).join(', ')}`);
    }
  }

  // wall
  if (spec.wall !== undefined) {
    const w = spec.wall;
    if (!isPt(w.v) || w.v[0] >= w.v[1]) bad('wall.v must be [bottom, top] art px above the floor');
    if (w.walls !== undefined && (!Array.isArray(w.walls) || !w.walls.length || !w.walls.every((x) => x === 'left' || x === 'right'))) bad("wall.walls: 'left' and/or 'right'");
    // the wall art standard, as far as the declaration goes (its drawing is checked by scripts/model-check.ts)
    if (w.margin !== undefined) bad('wall.margin is retired: wall art is centred in its span at 2:1 (the wall art standard); remove it');
    if (w.floor !== undefined && typeof w.floor !== 'boolean') bad('wall.floor is true or absent');
    if (Array.isArray(fp) && fp[1] !== 1) bad('wall art is one tile deep: footprint [span, 1]');
  }
  return out;
}
