/**
 * The model check: every model in the catalog against THE MODEL SPEC (src/shared/models.ts, docs/furniture.md).
 *
 *   npx tsx scripts/model-check.ts [key|prefix ...]    the catalog, or some of it (the gate runs it on all of it)
 *   npx tsx scripts/model-check.ts --json [...]         one JSON object on stdout instead of a report
 *   npx tsx scripts/model-check.ts --declared-only [...]  only the declarations (validateModel), not the drawings
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
 */
import { existsSync, readFileSync } from 'node:fs';
import { baseCentre, fillProblems, isSmall, silhouette } from '../src/client/engine/sprites/footing';
import { hasAnimation } from '../src/client/engine/animations';
import { FACINGS, MIRROR_OF, drawingsOf, footprintFacing, validateModel, type ModelSpec } from '../src/shared/models';
import type { Facing } from '../src/shared/world/scene';
import { mirrorImg, readPng, type Img } from './lib/png';
import { MANIFEST, loadManifest } from './lib/manifest';

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

export function checkModel(key: string, e: ModelSpec, dr: Drawings, family: Record<string, ModelSpec>, declaredOnly = false): string[] {
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
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const declaredOnly = args.includes('--declared-only');
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const entriesFile = opt('--entries');
  const spritesDir = opt('--sprites');
  const only = args.filter((a, i) => !a.startsWith('--') && !['--entries', '--sprites'].includes(args[i - 1]));
  const manifest = loadManifest(MANIFEST);
  const staged = entriesFile ? (JSON.parse(readFileSync(entriesFile, 'utf8')) as Record<string, ModelSpec>) : null;
  const family = { ...manifest.sprites, ...(staged ?? {}) };
  const dr = new Drawings(spritesDir ? [spritesDir, SPRITES] : [SPRITES]);
  const keys = Object.keys(staged ?? manifest.sprites).filter((k) => !only.length || only.some((o) => k === o || k.startsWith(o)));
  const problems: Record<string, string[]> = {};
  for (const key of keys.sort()) {
    const p = checkModel(key, family[key], dr, family, declaredOnly);
    if (p.length) problems[key] = p;
  }
  const bad = Object.keys(problems).length;
  if (json) console.log(JSON.stringify({ ok: !bad, checked: keys.length, problems }));
  else {
    for (const [k, ps] of Object.entries(problems)) for (const p of ps) console.log(`  ! ${k}: ${p}`);
    console.log(`${keys.length} model(s) checked, ${bad} breaking the model spec (src/shared/models.ts, docs/furniture.md)`);
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1]?.includes('model-check')) main();
