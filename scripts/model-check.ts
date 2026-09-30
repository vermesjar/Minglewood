/**
 * The model check: every model in the catalog against THE MODEL SPEC (src/shared/models.ts, docs/furniture.md).
 *
 *   npx tsx scripts/model-check.ts [key|prefix ...]    the catalog, or some of it (the gate runs it on all of it)
 *   npx tsx scripts/model-check.ts --json [...]         one JSON object on stdout instead of a report
 *   npx tsx scripts/model-check.ts --declared-only [...]  only the declarations (validateModel), not the drawings
 *   npx tsx scripts/model-check.ts --category wall-art    one category (the gate runs the wall art standard this way)
 *   npx tsx scripts/model-check.ts --entries staged.json --sprites <dir> [--json]
 *       candidate entries ({key: ModelSpec}) before they're published: their drawings are looked up in <dir>
 *       first, then public/art/sprites. art/studio.py (build, publish) and the Design Lab run this before
 *       writing anything, and refuse to publish when it fails.
 *
 * JSON: {"ok": bool, "checked": n, "problems": {"<key>": ["…", …]}}. Exit 1 when anything fails.
 *
 * What it checks, per model:
 *   - the declaration (validateModel): identity, footprint and height, rotation and its drawings, base contact,
 *     walkability and layer, seat and use, per-drawing light points, wall rules
 *   - every drawing (and glow mask) exists
 *   - the rotation is honest: a radial model's silhouette is round; a back isn't a copy of its front (unless
 *     sameFromBehind); a full model's sides aren't copies or mirror-copies of each other
 *   - every drawing faces the way it says: drawings on the same screen side (se/ne vs sw/nw) lean the same way,
 *     the others the opposite way (a seat's backrest, a lamp's arm)
 *   - base contact in all four facings, mirrors included (footing.ts, THE FILL RULE): a small model is centred on
 *     its footprint at runtime; a large 'filled' one fills its footprint diamond (or is inset evenly) and ends on
 *     its front corner; a large 'centred' one stands its narrow base on the footprint's centre
 *   - the declared height matches the drawing
 *   - animation hooks: `animated` models have an animation in every drawing but their `still` ones
 *     (src/client/engine/animations.ts), and every animated drawing belongs to an `animated` model
 *   - a seat, or its family, has a seat profile (the seat standard's `seat`)
 *   - wall art meets THE WALL ART STANDARD (models.ts wallFit): drawn at 2:1, so its drawing fits its span without
 *     squeezing, `wall.v` is exactly its drawing's height, and it's clear of the baseboard and the crown moulding
 *   - THE PROJECTION CHECK (scripts/lib/projection.ts): every drawing is in the game's 2:1 isometric projection (its
 *     long near-horizontal edges cluster at ±0.5, not at a flatter or perspective camera's slopes), and a piece's
 *     views agree with each other (the height of its top, its width turned half way round, where a filled base runs).
 *     Round and organic pieces are allowed (ROUND); pieces in PROJECTION_TODO await a redraw and are only reported.
 *
 *   npx tsx scripts/model-check.ts --projection [...]      only the projection check (the gate runs it on everything)
 *   npx tsx scripts/model-check.ts --projection --audit [out.png]
 *       …and a sheet of the pieces it fails (and the reported ones), their detected edges drawn over them: green on the
 *       projection, red off it, blue horizontal (default art/review/projection-audit.png)
 */
import { existsSync, readFileSync } from 'node:fs';
import { baseCentre, fillProblems, isSmall, silhouette } from '../src/client/engine/sprites/footing';
import { hasAnimation } from '../src/client/engine/animations';
import { FACINGS, MIRROR_OF, drawingsOf, footprintFacing, validateModel, wallFit, type ModelSpec } from '../src/shared/models';
import type { Facing } from '../src/shared/world/scene';
import { blank, mirrorImg, readPng, writePng, type Img } from './lib/png';
import { MANIFEST, loadManifest } from './lib/manifest';
import { fmtSlope, MIN_EVIDENCE, overlay, projection, side, type Edge, type Projection } from './lib/projection';
import { row, stack } from './lib/draw';
import { text } from './lib/font';

const SPRITES = 'public/art/sprites';
/** Radial models must be round: their silhouette alike its own mirror image. Nature is amorphous. */
const RADIAL_MIN_IOU = 0.45;
/** How strongly two drawings must lean before their directions are compared (fraction of width). */
const LEAN = 0.12;
/** Screen side each facing's front points to: se and ne face right, sw and nw left. */
const SIDE: Record<Facing, 1 | -1> = { se: 1, ne: 1, sw: -1, nw: -1 };

export interface Placed {
  img: Img;
  ax: number;
  ay: number;
  w: number;
  d: number;
  mirrored: boolean;
  file: string;
}

export class Drawings {
  private cache = new Map<string, Img | null>();
  constructor(private readonly dirs: string[]) {}
  path(file: string): string | null {
    for (const d of this.dirs) if (existsSync(`${d}/${file}`)) return `${d}/${file}`;
    return null;
  }
  get(file: string): Img | null {
    if (!this.cache.has(file)) {
      const p = this.path(file);
      this.cache.set(file, p ? readPng(p) : null);
    }
    return this.cache.get(file)!;
  }
}

/** The drawing, anchor and footprint the client uses for a model placed facing `facing` (art.ts). */
export function place(e: ModelSpec, facing: Facing, dr: Drawings): Placed | null {
  // fixed models (buildings) never turn: they stand as drawn
  const [w, d] = e.rotation === 'fixed' ? e.footprint : footprintFacing(e, facing);
  let rec = e.file ? { file: e.file, anchor: e.anchor } : undefined;
  let mirror = false;
  if (e.facings) {
    rec = e.facings[facing];
    if (!rec && e.facings[MIRROR_OF[facing]]) {
      rec = e.facings[MIRROR_OF[facing]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0];
  } else if (e.footprint[0] !== e.footprint[1]) {
    // one drawing of a long piece (drawn as it covers w=width): turned a quarter it's its mirror image
    mirror = w !== e.footprint[0];
  }
  if (!rec) return null;
  const src = dr.get(rec.file);
  if (!src) return null;
  const img = mirror ? mirrorImg(src) : src;
  let ax: number;
  let ay: number;
  if (rec.anchor) {
    [ax, ay] = rec.anchor;
    if (mirror) ax = img.w - ax;
  } else {
    // anchorless fits (art.ts): diamond fills the footprint, stand stands its bottom-centre on it
    const bottom = img.h - (e.pad ?? 0);
    ax = e.fit === 'stand' ? img.w / 2 - (w - d) * 16 : d * 32;
    ay = e.fit === 'stand' ? bottom - (w + d) * 8 : bottom - (w + d) * 16;
  }
  return { img, ax, ay, w, d, mirrored: mirror, file: rec.file };
}

const solid = (m: Img, x: number, y: number) => m.d[(y * m.w + x) * 4 + 3] > 0;

export function mirrorIou(m: Img): number {
  const s = silhouette(m);
  if (!s) return 1;
  let both = 0;
  let any = 0;
  for (let y = s.t; y <= s.b; y++)
    for (let x = s.l; x <= s.r; x++) {
      const a = solid(m, x, y);
      const b = solid(m, s.l + s.r - x, y);
      if (a && b) both++;
      if (a || b) any++;
    }
  return both / Math.max(1, any);
}

/** How far the top quarter of a drawing sits right (+) or left (−) of its centre, as a fraction of its width. */
export function lean(m: Img): number {
  const s = silhouette(m);
  if (!s) return 0;
  const h = s.b - s.t + 1;
  let sx = 0;
  let n = 0;
  let all = 0;
  let nAll = 0;
  for (let y = s.t; y <= s.b; y++)
    for (let x = s.l; x <= s.r; x++)
      if (solid(m, x, y)) {
        all += x;
        nAll++;
        if (y < s.t + Math.max(3, Math.floor(h / 4))) {
          sx += x;
          n++;
        }
      }
  return (sx / n - all / nAll) / (s.r - s.l + 1);
}

function sameImg(a: Img, b: Img, mirrored = false): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  let diff = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const j = (y * a.w + (mirrored ? a.w - 1 - x : x)) * 4;
      for (let k = 0; k < 4; k++) diff += Math.abs(a.d[i + k] - b.d[j + k]);
    }
  return diff / (a.w * a.h * 4) < 1;
}

/** Floor to top of a placed drawing, art px (manifest scale 2). */
export function measuredHeight(p: Placed, small: boolean): number {
  const s = silhouette(p.img);
  if (!s) return 0;
  // where the model meets the floor: its base centre if it's small, else between the footprint's back vertex
  // and its centre (a box's top starts at the back vertex, a round top at the centre)
  const floor = small ? (baseCentre(p.img)?.[1] ?? s.b) : p.ay + 4 * (p.w + p.d);
  return Math.max(0, (floor - s.t) / 2);
}

/* ------------------------------------------------------------------ THE PROJECTION CHECK */

/** Categories the projection check doesn't read: wall art is drawn flat (its own standard), buildings' roofs and
 *  gables run at their own pitches, nature and plants are organic. Radial models are round by declaration. */
const PROJECTION_EXEMPT = new Set(['wall-art', 'building', 'nature', 'plant']);

/**
 * ROUND: pieces whose outline is round or organic, or whose long edges are angled by design, so the tangents of
 * their rims and curves (or their angled parts) run at every slope and say nothing about the camera: a round seat's
 * rim, a bentwood back, a beanbag, a lamp's round shade, a signpost's arrows. Allowed by the projection check; keyed
 * by model or family (the part of the key before the first dot). Check a newcomer on the audit sheet (--projection
 * --audit) before adding it: a boxy piece drawn with the wrong camera isn't round.
 */
export const ROUND: Record<string, string> = {
  'chair.cafe': 'a round cane seat and a bentwood back',
  'chair-bistro': 'a round seat and a bentwood back',
  beanbag: 'a soft blob',
  'table-high': 'a round top on a pedestal',
  lamp: 'a round shade on a pole',
  'lamp-arc': 'a round shade on an arc, on a round base',
  'lamp-post': 'a lantern on a round post',
  'heirloom-dragonlamp': 'a coiled dragon holding a round lantern',
  mailbox: 'a round-topped pillar box',
  scarecrow: 'a straw figure',
  boat: 'a hull that curves end to end',
  easel: 'splayed legs and a canvas leaning back, by design',
  signpost: 'its arrows point every way, by design',
};

/**
 * PROJECTION_TODO: pieces the projection check fails that are waiting for a redraw (docs/furniture.md, "The projection
 * TODO"). Their problems are reported (--projection, the audit sheet, the JSON's warnings) but don't fail the check.
 * Take a piece off this list when it's redrawn.
 */
export const PROJECTION_TODO = new Set<string>([
  'air-hockey',
  'armchair.green',
  'armchair.mustard',
  'armchair.rust',
  'bike-rack',
  'cake-table',
  'chair.wood',
  'clock-grand',
  'couch.purple',
  'espresso',
  'flower-cart',
  'heirloom-piano',
  'heirloom-throne',
  'materials-shelf',
  'parts-rack',
  'picnic',
  'podium',
  'pool-table',
  'register',
  'server-rack',
  'speaker',
  'table-long.light',
  'workbench',
]);

/** The views of a piece may disagree this much: the height of the top (art px, or this share of it)… */
const VIEW_HEIGHT = { px: 6, share: 0.2 };
/** …its width, turned half way round (px, or this share of it)… */
const VIEW_WIDTH = { px: 8, share: 0.12 };
/** …and where a filled piece's base runs, along its footprint at ±0.5 (±this). */
const BASE_SLOPE_TOL = 0.1;

const familyOf = (key: string) => key.split('.')[0];
export const isRound = (key: string) => key in ROUND || familyOf(key) in ROUND;

/** Why the projection check doesn't read a model, or null when it does. */
export function projectionExempt(key: string, e: ModelSpec): string | null {
  if (e.category && PROJECTION_EXEMPT.has(e.category)) return `category ${e.category}`;
  if (e.rotation === 'radial' || e.rotation === 'flat' || e.rotation === 'fixed') return `rotation ${e.rotation}`;
  if (isRound(key)) return `round: ${ROUND[key] ?? ROUND[familyOf(key)]}`;
  return null;
}

const PROJECTIONS = new Map<string, Projection>();
/** A drawing's projection. A centred piece stands on one narrow base (a star base, a pedestal, a pot): the edges
 *  in the lowest third of its drawing aren't judged, since a star base's legs point every way by design (turned
 *  half way round, a five-star base's legs run at ±0.4). */
function projectionOfFile(path: string, img: Img, base: ModelSpec['base']): Projection {
  const id = `${path}|${base}`;
  if (!PROJECTIONS.has(id)) {
    const s = silhouette(img);
    PROJECTIONS.set(id, projection(img, base === 'centred' && s ? { skipBelow: s.b - (s.b - s.t + 1) / 3 } : {}));
  }
  return PROJECTIONS.get(id)!;
}

/** Where a drawing's base runs: the slopes its silhouette's straight bottom edges in its lowest third cluster at,
 *  falling (+) and rising (−), or null where it has too few. A filled piece's run along its footprint, ±0.5. */
function baseSlopes(img: Img, p: Projection): [number | null, number | null] {
  const s = silhouette(img);
  if (!s) return [null, null];
  const low = s.b - (s.b - s.t + 1) / 3;
  const base = p.edges.filter((e) => !e.ignored && e.group === 'bottom' && (e.y0 + e.y1) / 2 >= low);
  const at = (es: Edge[]) => {
    const sd = side(es);
    return sd.mode !== null && sd.atMode >= MIN_EVIDENCE ? sd.mode : null;
  };
  const neg = at(base.filter((e) => e.slope < 0));
  return [at(base.filter((e) => e.slope > 0)), neg === null ? null : -neg];
}

export interface ProjectionView {
  facing: Facing;
  file: string;
  img: Img;
  proj: Projection;
}

/** The projection check on one model: its problems, and its drawings with their measured edges. */
export function projectionProblems(key: string, e: ModelSpec, dr: Drawings): { problems: string[]; views: ProjectionView[] } {
  const problems: string[] = [];
  const views: ProjectionView[] = [];
  if (projectionExempt(key, e) || !e.rotation) return { problems, views };
  const drawings = drawingsOf(e);
  for (const f of FACINGS) {
    const rec = drawings[f];
    if (!rec || views.some((v) => v.file === rec.file)) continue;
    const img = dr.get(rec.file);
    if (!img) continue;
    const proj = projectionOfFile(dr.path(rec.file)!, img, e.base);
    views.push({ facing: f, file: rec.file, img, proj });
    if (proj.problem) problems.push(`${f} (${rec.file}): ${proj.problem}`);
  }

  // the views agree: one piece, one camera
  const placed = FACINGS.map((f) => ({ f, p: place(e, f, dr) })).filter((v): v is { f: Facing; p: Placed } => !!v.p);
  if (new Set(placed.map((v) => v.p.file)).size > 1) {
    const heights = placed.map(({ f, p }) => ({ f, h: measuredHeight(p, isSmall(p.img, p.w, p.d)) }));
    const hi = heights.reduce((a, b) => (b.h > a.h ? b : a));
    const lo = heights.reduce((a, b) => (b.h < a.h ? b : a));
    if (hi.h - lo.h > Math.max(VIEW_HEIGHT.px, VIEW_HEIGHT.share * hi.h))
      problems.push(
        `its views disagree on its height: ${hi.h.toFixed(1)} art px facing ${hi.f}, ${lo.h.toFixed(1)} facing ${lo.f} ` +
          `(one is drawn at another scale or from another camera)`,
      );
    // its extents: turned half way round, every point of a piece swaps sides about the footprint's centre, so it's
    // exactly as wide (a view drawn at another scale or from another camera isn't)
    const width = (m: Img) => {
      const sl = silhouette(m);
      return sl ? sl.r - sl.l + 1 : 0;
    };
    const widths = new Map(placed.map(({ f, p }) => [f, width(p.img)]));
    for (const [a, b] of [['se', 'nw'], ['sw', 'ne']] as const) {
      const [wa, wb] = [widths.get(a), widths.get(b)];
      if (wa && wb && Math.abs(wa - wb) > Math.max(VIEW_WIDTH.px, VIEW_WIDTH.share * Math.max(wa, wb)))
        problems.push(`it's ${wa} px wide facing ${a} but ${wb} facing ${b}: turned half way round, a piece is as wide`);
    }
    // …and a filled piece's base runs along its footprint in every drawing
    if (e.base === 'filled')
      for (const v of views) {
        const [fall, rise] = baseSlopes(v.img, v.proj);
        const off = [fall, rise].filter((x): x is number => x !== null && Math.abs(Math.abs(x) - 0.5) > BASE_SLOPE_TOL);
        if (off.length)
          problems.push(
            `${v.facing}: its base runs at ${fmtSlope(fall)} / ${fmtSlope(rise)}, not along its footprint ` +
              `(±0.50 ±${BASE_SLOPE_TOL}): it stands turned or is drawn from another camera`,
          );
      }
  }
  return { problems: [...new Set(problems)], views };
}

/** The audit sheet: each piece with a projection problem, its drawings (3×, 2× when large) with their edges. */
export function auditSheet(rows: Array<{ key: string; problems: string[]; views: ProjectionView[]; todo: boolean }>): Img {
  const bg: [number, number, number] = [24, 20, 30];
  const title = blank(1400, 40, bg, 255);
  text(title, 8, 6, 'PROJECTION AUDIT: EDGES GREEN ON 2:1 (+-0.50 +-0.07), RED OFF IT, BLUE HORIZONTAL, GREY NOT JUDGED', [255, 255, 255], 2);
  text(title, 8, 22, `${rows.length} PIECE(S); TODO: REPORTED ONLY, AWAITING A REDRAW (DOCS/FURNITURE.MD)`, [200, 198, 210], 2);
  const blocks: Img[] = [title];
  for (const r of rows) {
    const cells = r.views.map((v) =>
      overlay(v.img, v.proj, v.img.w > 120 ? 2 : 3, [
        `${r.key} ${v.facing}${r.todo ? ' TODO' : ''}`,
        `${fmtSlope(v.proj.pos)} / ${fmtSlope(v.proj.neg)} ${v.proj.problem ? 'OFF' : 'OK'}`,
      ]),
    );
    const lines = r.problems.flatMap((p) => p.match(/.{1,170}(\s|$)/g) ?? [p]);
    const notes = blank(1400, 12 * lines.length + 6, bg, 255);
    lines.forEach((l, i) => text(notes, 4, 3 + i * 12, l.trim(), [255, 190, 120], 2));
    blocks.push(stack([cells.length ? row(cells, bg) : blank(4, 4, bg, 255), notes], bg, 2));
  }
  return stack(blocks, bg, 10);
}

export function checkModel(
  key: string,
  e: ModelSpec,
  dr: Drawings,
  family: Record<string, ModelSpec>,
  declaredOnly = false,
  warnings?: string[],
): string[] {
  const out = validateModel(key, e);
  if (declaredOnly) return out;
  const drawings = drawingsOf(e);
  const drawn = FACINGS.filter((f) => drawings[f]);
  const files = [...new Set(drawn.map((f) => drawings[f]!.file))];
  for (const f of files) if (!dr.get(f)) out.push(`drawing ${f} is missing`);
  for (const g of [e.glow, ...drawn.map((f) => drawings[f]!.glow)]) if (g && !dr.path(g)) out.push(`glow mask ${g} is missing`);
  if (out.some((o) => o.includes('is missing')) || !e.rotation) return out;
  const img = (f: Facing) => dr.get(drawings[f]!.file)!;

  // the rotation is honest
  if (e.rotation === 'radial' && e.category !== 'nature' && files.length) {
    const iou = mirrorIou(dr.get(files[0])!);
    if (iou < RADIAL_MIN_IOU) out.push(`declared radial but its silhouette isn't round (mirror IoU ${iou.toFixed(2)} < ${RADIAL_MIN_IOU})`);
  }
  if (e.rotation === 'mirror' && !e.sameFromBehind) {
    const fr = drawn.find((f) => f === 'se' || f === 'sw');
    const bk = drawn.find((f) => f === 'ne' || f === 'nw');
    if (fr && bk && drawings[fr]!.file !== drawings[bk]!.file && sameImg(img(fr), img(bk)))
      out.push(`its back drawing is a copy of its front: draw the back, or declare sameFromBehind`);
  }
  if (e.rotation === 'full' && drawn.length === 4)
    for (const [a, b] of [['se', 'sw'], ['ne', 'nw']] as const)
      if (sameImg(img(a), img(b)) || sameImg(img(a), img(b), true)) out.push(`${a} and ${b} are the same drawing (mirrored or not): a 'full' model has both sides drawn`);

  // every drawing faces the way it says (a square model's lean is its tall side; a long one's is its footprint's
  // diagonal, whichever way it faces; a model that looks the same from behind leans alike by construction)
  const distinct = drawn.filter((f, i) => drawn.findIndex((g) => drawings[g]!.file === drawings[f]!.file) === i);
  const leanable = e.footprint[0] === e.footprint[1] && !e.sameFromBehind ? distinct.length : 0;
  for (let i = 0; i < leanable; i++)
    for (let j = i + 1; j < distinct.length; j++) {
      const [a, b] = [distinct[i], distinct[j]];
      const la = lean(img(a));
      const lb = lean(img(b));
      if (Math.abs(la) < LEAN || Math.abs(lb) < LEAN) continue;
      const alike = SIDE[a] === SIDE[b];
      if (alike !== (la < 0 === lb < 0))
        out.push(`${a} and ${b} lean ${alike ? 'opposite ways' : 'the same way'} (${la.toFixed(2)} / ${lb.toFixed(2)}): one of them faces the wrong way`);
    }

  // the wall art standard: drawn at 2:1, its size its drawing's, centred in its span, clear of the trim
  if (e.rotation === 'flat' && e.wall && e.file && Array.isArray(e.footprint)) {
    const d = dr.get(e.file)!;
    out.push(...wallFit(e.wall, d, e.footprint[0], silhouette(d)).problems);
  }

  // base contact and height, in all four facings
  if (e.rotation !== 'flat') {
    let tallest = 0;
    const wrongBase = new Set<string>();
    for (const f of FACINGS) {
      const p = place(e, f, dr);
      if (!p) continue;
      const small = isSmall(p.img, p.w, p.d);
      tallest = Math.max(tallest, measuredHeight(p, small));
      if (e.rotation === 'fixed') continue; // buildings answer to scripts/town-stoops.ts
      // small pieces are centred on their footprint at runtime (art.ts); large ones stand by their anchor and
      // must meet the fill rule (footing.ts)
      if (small && e.base === 'filled') wrongBase.add(`${f}: declared filled but it's small for its footprint (declare 'centred', or give it a smaller footprint)`);
      if (!small && (e.base === 'filled' || e.base === 'centred'))
        for (const pr of fillProblems(p.img, p.ax, p.ay, p.w, p.d, e.base)) wrongBase.add(`${f}${p.mirrored ? ' (mirrored)' : ''}: ${pr}`);
    }
    out.push(...wrongBase);
    if (typeof e.height === 'number' && tallest > 0 && Math.abs(e.height - tallest) > Math.max(6, tallest * 0.25))
      out.push(`declared height ${e.height} but the drawing stands ${tallest.toFixed(0)} art px`);
  }

  // animation hooks
  const animated = distinct.filter((f) => hasAnimation(drawings[f]!.file));
  const still = new Set(e.still ?? []);
  if (!e.animated && animated.length) out.push(`${animated.map((f) => drawings[f]!.file).join(', ')} animate: declare animated`);
  if (e.animated) {
    const missing = distinct.filter((f) => !still.has(f) && !hasAnimation(drawings[f]!.file));
    if (missing.length)
      out.push(`animated, but ${missing.map((f) => drawings[f]!.file).join(', ')} has no animation (animations.ts), or list it in still`);
    for (const f of still) if (animated.includes(f)) out.push(`${f} is listed as still but animates`);
  }

  // seats sit
  if (e.walk === 'seat') {
    const base = key.split('.')[0];
    const profiled = e.seat !== undefined || Object.entries(family).some(([k, s]) => (k === base || k.startsWith(`${base}.`)) && s.seat !== undefined);
    if (!profiled) out.push('a seat without a seat profile (seat height: scripts/seat-fit.ts)');
  }

  // the projection check: drawn in 2:1 isometric, and its views agree
  const proj = projectionProblems(key, e, dr).problems;
  if (PROJECTION_TODO.has(key)) warnings?.push(...proj.map((p) => `${p} [PROJECTION_TODO: awaiting a redraw]`));
  else out.push(...proj);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const declaredOnly = args.includes('--declared-only');
  const projectionOnly = args.includes('--projection');
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const entriesFile = opt('--entries');
  const spritesDir = opt('--sprites');
  const category = opt('--category');
  const auditArg = opt('--audit');
  const audit = args.includes('--audit') ? (auditArg?.endsWith('.png') ? auditArg : 'art/review/projection-audit.png') : null;
  const only = args.filter(
    (a, i) => !a.startsWith('--') && !['--entries', '--sprites', '--category'].includes(args[i - 1]) && a !== audit,
  );
  const manifest = loadManifest(MANIFEST);
  const staged = entriesFile ? (JSON.parse(readFileSync(entriesFile, 'utf8')) as Record<string, ModelSpec>) : null;
  const family = { ...manifest.sprites, ...(staged ?? {}) };
  const dr = new Drawings(spritesDir ? [spritesDir, SPRITES] : [SPRITES]);
  const keys = Object.keys(staged ?? manifest.sprites).filter(
    (k) => (!only.length || only.some((o) => k === o || k.startsWith(o))) && (!category || family[k]?.category === category),
  );
  const problems: Record<string, string[]> = {};
  const warnings: Record<string, string[]> = {};
  const audited: Parameters<typeof auditSheet>[0] = [];
  for (const key of keys.sort()) {
    const warn: string[] = [];
    let p: string[];
    if (projectionOnly) {
      const pr = projectionProblems(key, family[key], dr);
      if (pr.problems.length && audit) audited.push({ key, problems: pr.problems, views: pr.views, todo: PROJECTION_TODO.has(key) });
      if (PROJECTION_TODO.has(key)) {
        warn.push(...pr.problems.map((x) => `${x} [PROJECTION_TODO: awaiting a redraw]`));
        p = [];
      } else p = pr.problems;
    } else p = checkModel(key, family[key], dr, family, declaredOnly, warn);
    if (p.length) problems[key] = p;
    if (warn.length) warnings[key] = warn;
  }
  if (audit) {
    writePng(audit, auditSheet(audited));
    if (!json) console.log(`projection audit: ${audited.length} piece(s) -> ${audit}`);
  }
  const bad = Object.keys(problems).length;
  const what = projectionOnly ? 'breaking the projection check (scripts/lib/projection.ts, docs/furniture.md)' : 'breaking the model spec (src/shared/models.ts, docs/furniture.md)';
  if (json) console.log(JSON.stringify({ ok: !bad, checked: keys.length, problems, warnings }));
  else {
    for (const [k, ps] of Object.entries(problems)) for (const p of ps) console.log(`  ! ${k}: ${p}`);
    for (const [k, ps] of Object.entries(warnings)) for (const p of ps) console.log(`  ~ ${k}: ${p}`);
    console.log(`${keys.length} model(s) checked, ${bad} ${what}${Object.keys(warnings).length ? `, ${Object.keys(warnings).length} reported (PROJECTION_TODO)` : ''}`);
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1]?.includes('model-check')) main();
