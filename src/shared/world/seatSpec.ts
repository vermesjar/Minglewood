/**
 * THE SEAT FRAMEWORK: every seat in the game is built from one of a few KINDS, each a parametric 3D template whose
 * dimensions come from the figure that sits in it (seatFigure.ts), never from a drawing. A seat's spec (its kind, a
 * few measurements and its materials) builds its model — the boxes and cylinders every facing shares — and the same
 * model is what the renderer draws (src/shared/art/seatRender.ts), what the sitting points and legs are read from
 * (seatModels.ts, sitLegs.ts) and what the sitter is composed against, pixel by pixel (seatCompose.ts). Nothing is
 * fitted to art: the art is the model.
 *
 * Units: u and v in tiles (the local frame of seatModels.ts: u across the seat, v from its front edge to its back),
 * z in world px (1 world px = 2 drawing px of rise). The figure the kinds are sized for: standing hip 11 px above the
 * feet, a thigh SEAT_REACH tiles long, shins that reach SHIN_MAX px down.
 *
 * The kinds and what sets them apart (all sizes are the defaults a spec can adjust within its kind's limits):
 *   chair     1×1, cushion at 10, a back of rails or a slab, four legs (or a column on a cross base); sat upright
 *   armchair  1×1, a low soft cushion at 9 between two arms, a thick padded back, a skirted base on feet; lounged in
 *   couch     2×1, the armchair's build with a cushion per tile; lounged in
 *   bench     2×1, a slab (or slats) on end supports, with or without a low back; sat upright
 *   stool     1×1, a round cushion at 10 on a column; sat with the knees dropped
 *   barstool  1×1, a round cushion at 15 with a footring at 5.5 the feet rest on
 *   beanbag   1×1, a soft low body at 4.5 with a rolled back; sat on the floor, legs out
 *   ottoman   1×1, a round tufted pouf at 7.5, nothing behind
 *   throne    1×1, a plinth, a tufted cushion at 10, solid arms and a tall back with a crest
 *
 * How people sit in every kind (the standard): the pelvis SIT_GAP in front of the back's face (or, with no back, a
 * touch behind the cushion's middle), sat forward when the thighs wouldn't reach the front edge from there; the knees
 * KNEE_OUT past the front edge; the shins down to the floor, or to the footrest. One world point per cushion, the
 * same from every side.
 */
import type { RoomKind, Theme } from '../models';
import type { ModelPart, PartKind, SeatModel, SitPoint } from './seatModels';
import type { SitStyle } from './seats';

export type SeatKind = 'chair' | 'armchair' | 'couch' | 'bench' | 'stool' | 'barstool' | 'beanbag' | 'ottoman' | 'throne';
export const SEAT_KINDS: SeatKind[] = ['chair', 'armchair', 'couch', 'bench', 'stool', 'barstool', 'beanbag', 'ottoman', 'throne'];

/** How the figure sits in each kind (the pose and the legs' natural lie: seats.ts, sitLegs.ts). */
export const STYLE_OF_KIND: Record<SeatKind, SitStyle> = {
  chair: 'chair',
  armchair: 'lounge',
  couch: 'lounge',
  bench: 'chair',
  stool: 'stool',
  barstool: 'stool',
  beanbag: 'floor',
  ottoman: 'chair',
  throne: 'chair',
};

/* ------------------------------------------------------------------ the figure's reach (what sizes the kinds) */

/** A sitter's pelvis is this far (tiles) in front of the back's front face: half a torso. */
export const SIT_GAP = 0.1;
/** A thigh, pelvis to knee, when the sitter is placed (tiles); on the floor the legs stretch out further. */
export const SEAT_REACH = 0.4;
export const REACH_OF_STYLE: Record<SitStyle, number> = { chair: 0.4, lounge: 0.42, stool: 0.4, floor: 0.5 };
/** The knees stand this far (tiles) past the seat's front edge, so the shins clear it. */
export const KNEE_OUT = 0.04;
/** A shin, knee to sole (world px), at its longest: a cushion higher than this leaves the feet hanging. */
export const SHIN_MAX = 12;
/** A cushion this deep (tiles) seats someone against the back with their knees just past the front. */
export const CHAIR_DEPTH = SIT_GAP + SEAT_REACH - KNEE_OUT;

/* ------------------------------------------------------------------ materials */

export type MaterialKind = 'fabric' | 'velvet' | 'leather' | 'vinyl' | 'wood' | 'metal' | 'chrome' | 'plastic' | 'iron' | 'gold';

export interface Material {
  /** The base colour, #rrggbb. */
  base: string;
  kind: MaterialKind;
}

/** The materials a seat is made of: what's sat on, what holds it up, and an optional trim (piping, nailheads). */
export interface Materials {
  fabric: Material;
  frame: Material;
  trim?: Material;
  /** A second fabric (a contrasting back or arms). */
  accent?: Material;
}

/* ------------------------------------------------------------------ the spec */

export type BackStyle = 'rails' | 'slab' | 'slats' | 'padded' | 'wing' | 'ladder' | 'none';
export type ArmStyle = 'none' | 'padded' | 'roll' | 'rail' | 'solid';
export type LegStyle = 'block' | 'turned' | 'tapered' | 'feet' | 'column' | 'cross' | 'ends' | 'iron' | 'skirt' | 'none';
export type Detail = 'tuft' | 'seam' | 'grain' | 'weave' | 'quilt' | 'none';

export interface SeatSpec {
  /** The catalog key (family.variant). */
  key: string;
  name: string;
  kind: SeatKind;
  /** [W, D] tiles; a kind's own if left out (couches and benches are 2×1). */
  size?: [number, number];
  tags?: string[];
  rooms: RoomKind[];
  themes?: Theme[];
  /** The cushion: its top's height (world px), its thickness, and how it's finished. */
  cushion?: Partial<{ z: number; thick: number; depth: number; width: number; detail: Detail; round: boolean }>;
  back?: Partial<{ style: BackStyle; height: number; thick: number; detail: Detail; wings: boolean; crest: boolean }>;
  arms?: Partial<{ style: ArmStyle; height: number; width: number }>;
  legs?: Partial<{ style: LegStyle; height: number }>;
  /** A footrest's top (world px): the shins reach it instead of the floor. */
  rest?: number;
  mat: Materials;
  /** A word from the designer (shown in the review sheets). */
  note?: string;
}

/** A material name a part is drawn with (seatRender.ts looks it up in the spec's materials). */
export type MatName = keyof Materials;

/** What a spec resolves to: the kind's defaults filled in. */
export interface SeatBuild {
  spec: SeatSpec;
  kind: SeatKind;
  size: [number, number];
  style: SitStyle;
  cushion: { z: number; thick: number; depth: number; width: number; detail: Detail; round: boolean };
  back: { style: BackStyle; height: number; thick: number; detail: Detail; wings: boolean; crest: boolean };
  arms: { style: ArmStyle; height: number; width: number };
  legs: { style: LegStyle; height: number };
  rest?: number;
  model: SeatModel;
  /** The cushion top, for the catalog's seat profile. */
  seat: number;
  backrest: boolean;
  hasArms: boolean;
  /** Floor to the top of the tallest part, world px. */
  height: number;
}

interface KindDefaults {
  size: [number, number];
  cushion: SeatBuild['cushion'];
  back: SeatBuild['back'];
  arms: SeatBuild['arms'];
  legs: SeatBuild['legs'];
  rest?: number;
}

const NO_BACK: SeatBuild['back'] = { style: 'none', height: 0, thick: 0, detail: 'none', wings: false, crest: false };
const NO_ARMS: SeatBuild['arms'] = { style: 'none', height: 0, width: 0 };

/** The kinds' defaults (the framework's own measurements; see the header). */
export const KIND_DEFAULTS: Record<SeatKind, KindDefaults> = {
  chair: {
    size: [1, 1],
    cushion: { z: 10, thick: 2.5, depth: CHAIR_DEPTH, width: 0.62, detail: 'none', round: false },
    back: { style: 'rails', height: 12, thick: 0.08, detail: 'none', wings: false, crest: false },
    arms: NO_ARMS,
    legs: { style: 'block', height: 8 },
  },
  armchair: {
    size: [1, 1],
    cushion: { z: 9, thick: 3, depth: 0.5, width: 0.68, detail: 'none', round: true },
    back: { style: 'padded', height: 13, thick: 0.24, detail: 'none', wings: false, crest: false },
    arms: { style: 'padded', height: 6, width: 0.16 },
    legs: { style: 'skirt', height: 6 },
  },
  couch: {
    size: [2, 1],
    cushion: { z: 9, thick: 3, depth: 0.5, width: 0.84, detail: 'seam', round: true },
    back: { style: 'padded', height: 13, thick: 0.24, detail: 'none', wings: false, crest: false },
    arms: { style: 'padded', height: 6, width: 0.16 },
    legs: { style: 'skirt', height: 6 },
  },
  bench: {
    size: [2, 1],
    cushion: { z: 9.5, thick: 2, depth: 0.42, width: 1.84, detail: 'grain', round: false },
    back: NO_BACK,
    arms: NO_ARMS,
    legs: { style: 'ends', height: 8 },
  },
  stool: {
    size: [1, 1],
    cushion: { z: 10, thick: 2, depth: 0.56, width: 0.56, detail: 'none', round: true },
    back: NO_BACK,
    arms: NO_ARMS,
    legs: { style: 'column', height: 8 },
  },
  barstool: {
    size: [1, 1],
    cushion: { z: 15, thick: 2, depth: 0.56, width: 0.56, detail: 'none', round: true },
    back: NO_BACK,
    arms: NO_ARMS,
    legs: { style: 'column', height: 13 },
    rest: 5.5,
  },
  beanbag: {
    size: [1, 1],
    cushion: { z: 4.5, thick: 4.5, depth: 0.88, width: 0.88, detail: 'quilt', round: true },
    back: { style: 'padded', height: 6.5, thick: 0.3, detail: 'quilt', wings: false, crest: false },
    arms: NO_ARMS,
    legs: { style: 'none', height: 0 },
  },
  ottoman: {
    size: [1, 1],
    cushion: { z: 7.5, thick: 6, depth: 0.68, width: 0.68, detail: 'tuft', round: true },
    back: NO_BACK,
    arms: NO_ARMS,
    legs: { style: 'feet', height: 1.5 },
  },
  throne: {
    size: [1, 1],
    cushion: { z: 10, thick: 2, depth: CHAIR_DEPTH, width: 0.6, detail: 'tuft', round: false },
    back: { style: 'slab', height: 16, thick: 0.15, detail: 'tuft', wings: false, crest: true },
    arms: { style: 'solid', height: 6, width: 0.12 },
    legs: { style: 'block', height: 8 },
  },
};

/* ------------------------------------------------------------------ building the model */

type Span = [number, number];
type Shape = 'box' | 'cyl' | 'ring' | 'soft';

interface PartOpts {
  shape?: Shape;
  mat?: MatName;
  detail?: Detail;
  /** A ring's inner radius as a fraction of its outer (shape 'ring'). */
  hole?: number;
}

/** A model part as the framework writes it: the box, plus how the renderer should draw it. */
export interface BuiltPart extends ModelPart {
  shape: Shape;
  mat: MatName;
  detail: Detail;
  hole?: number;
  /** What it is, for the review sheets ("near arm", "top rail"). */
  label: string;
}

const r2 = (n: number) => Math.round(n * 200) / 200;
const r20 = (n: number) => Math.round(n * 20) / 20;

class Builder {
  parts: BuiltPart[] = [];
  add(part: PartKind, label: string, u: Span, v: Span, z: Span, o: PartOpts = {}) {
    this.parts.push({
      part,
      u: [r2(u[0]), r2(u[1])],
      v: [r2(v[0]), r2(v[1])],
      z: [r20(z[0]), r20(z[1])],
      shape: o.shape ?? 'box',
      mat: o.mat ?? 'frame',
      detail: o.detail ?? 'none',
      ...(o.hole !== undefined ? { hole: o.hole } : {}),
      label,
    });
  }
}

/** A spec with its kind's defaults filled in (a spec may only change what its kind allows: the lists above). */
export function resolveSpec(spec: SeatSpec): Omit<SeatBuild, 'model' | 'seat' | 'backrest' | 'hasArms' | 'height'> {
  const d = KIND_DEFAULTS[spec.kind];
  const size = spec.size ?? d.size;
  return {
    spec,
    kind: spec.kind,
    size: [size[0], size[1]],
    style: STYLE_OF_KIND[spec.kind],
    cushion: { ...d.cushion, ...spec.cushion },
    back: { ...d.back, ...spec.back },
    arms: { ...d.arms, ...spec.arms },
    legs: { ...d.legs, ...spec.legs },
    ...(spec.rest !== undefined ? { rest: spec.rest } : d.rest !== undefined ? { rest: d.rest } : {}),
  };
}

/** The 3D model a spec builds: its parts, its sitting points and its footrest. */
export function buildSeat(spec: SeatSpec): SeatBuild {
  const r = resolveSpec(spec);
  const [W, D] = r.size;
  const B = new Builder();
  const c = r.cushion;
  const zc = c.z;
  const zs = zc - c.thick; // the cushion's underside
  const legsStyle = r.legs.style;
  const armW = r.arms.style === 'none' ? 0 : r.arms.width;
  // the cushion(s): centred across, and in depth so the back stands at the tile's rear
  const backThick = r.back.style === 'none' ? 0 : r.back.thick;
  // the piece sits centred in its tile's depth (the fill rule: a piece's sides reach alike toward its footprint's
  // corners), the cushion and back together leaving the same margin front and back; a beanbag fills its tile
  const rearMargin = r.kind === 'beanbag' ? 0.06 : Math.max(0.04, (D - c.depth - backThick) / 2);
  const vBackFace = D - rearMargin - backThick; // the back's front face
  // the cushion runs from the back's face forward; a beanbag's body fills the tile and its roll sits on its rear
  const vFront = r.back.style === 'none' || r.kind === 'beanbag' ? (D - c.depth) / 2 : vBackFace - c.depth;
  const cushions: Array<{ u0: number; u1: number }> = [];
  const inner0 = armW ? armW : (W - c.width) / 2;
  const inner1 = armW ? W - armW : W - inner0;
  const n = W; // one cushion per tile across
  const each = (inner1 - inner0) / n;
  for (let i = 0; i < n; i++) cushions.push({ u0: inner0 + i * each, u1: inner0 + (i + 1) * each });
  const vBack = vFront + c.depth;
  const round = c.round && (r.kind === 'stool' || r.kind === 'barstool' || r.kind === 'ottoman' || r.kind === 'beanbag');

  /* ---- what holds the cushion up */
  const uL = cushions[0].u0;
  const uR = cushions[n - 1].u1;
  switch (legsStyle) {
    case 'block':
    case 'turned':
    case 'tapered': {
      const s = legsStyle === 'block' ? 0.09 : 0.08;
      const in_ = 0.01;
      const shape: Shape = legsStyle === 'turned' ? 'cyl' : 'box';
      for (const [lu, lv, name] of [
        [uL + in_, vFront + in_, 'front left leg'],
        [uR - s - in_, vFront + in_, 'front right leg'],
        [uL + in_, vBack - s - in_, 'back left leg'],
        [uR - s - in_, vBack - s - in_, 'back right leg'],
      ] as Array<[number, number, string]>)
        B.add('leg', name, [lu, lu + s], [lv, lv + s], [0, zs], { shape, mat: 'frame' });
      // stretchers between the front legs and along the sides (a chair's rungs)
      if (r.kind === 'chair' && zs >= 6) {
        B.add('base', 'front stretcher', [uL + in_ + s, uR - s - in_], [vFront + in_ + 0.01, vFront + in_ + s - 0.01], [zs * 0.4, zs * 0.4 + 0.8], { mat: 'frame' });
        B.add('base', 'left stretcher', [uL + in_ + 0.01, uL + in_ + s - 0.01], [vFront + in_ + s, vBack - s - in_], [zs * 0.4, zs * 0.4 + 0.8], { mat: 'frame' });
        B.add('base', 'right stretcher', [uR - s - in_ + 0.01, uR - in_ - 0.01], [vFront + in_ + s, vBack - s - in_], [zs * 0.4, zs * 0.4 + 0.8], { mat: 'frame' });
      }
      break;
    }
    case 'ends': {
      const t = 0.1;
      B.add('leg', 'left end', [uL + 0.06, uL + 0.06 + t], [vFront + 0.04, vBack - 0.04], [0, zs], { mat: 'frame' });
      B.add('leg', 'right end', [uR - 0.06 - t, uR - 0.06], [vFront + 0.04, vBack - 0.04], [0, zs], { mat: 'frame' });
      if (W > 1) B.add('base', 'stretcher', [uL + 0.06 + t, uR - 0.06 - t], [(vFront + vBack) / 2 - 0.03, (vFront + vBack) / 2 + 0.03], [Math.max(1.5, zs * 0.3), Math.max(1.5, zs * 0.3) + 1], { mat: 'frame' });
      break;
    }
    case 'iron': {
      // cast-iron bench ends: a foot plate, an upright and a scrolled top
      const t = 0.09;
      for (const [u0, name] of [
        [uL + 0.02, 'left iron end'],
        [uR - 0.02 - t, 'right iron end'],
      ] as Array<[number, string]>) {
        B.add('leg', `${name} foot`, [u0, u0 + t], [vFront - 0.06, vBack + 0.06], [0, 1], { mat: 'frame' });
        B.add('leg', `${name} upright`, [u0, u0 + t], [vFront + 0.1, vFront + 0.1 + t], [1, zs], { mat: 'frame' });
        B.add('leg', `${name} rear upright`, [u0, u0 + t], [vBack - 0.1 - t, vBack - 0.1], [1, zs], { mat: 'frame' });
        B.add('base', `${name} rail`, [u0, u0 + t], [vFront + 0.1, vBack - 0.1], [zs * 0.45, zs * 0.45 + 0.8], { mat: 'frame' });
      }
      break;
    }
    case 'column': {
      const cu = (uL + uR) / 2;
      const cv = (vFront + vBack) / 2;
      const rr = 0.07;
      B.add('base', 'base plate', [cu - 0.22, cu + 0.22], [cv - 0.22, cv + 0.22], [0, 1.5], { shape: 'cyl', mat: 'frame' });
      B.add('leg', 'column', [cu - rr, cu + rr], [cv - rr, cv + rr], [1, zs], { shape: 'cyl', mat: 'frame' });
      if (r.rest !== undefined) B.add('rest', 'footring', [cu - 0.33, cu + 0.33], [cv - 0.33, cv + 0.33], [r.rest - 1.5, r.rest], { shape: 'ring', hole: 0.8, mat: 'frame' });
      break;
    }
    case 'cross': {
      // an office chair: a gas-lift column on a four-arm base with casters
      const cu = (uL + uR) / 2;
      const cv = (vFront + vBack) / 2;
      B.add('base', 'base hub', [cu - 0.08, cu + 0.08], [cv - 0.08, cv + 0.08], [0.5, 2], { shape: 'cyl', mat: 'frame' });
      B.add('base', 'base arm across', [cu - 0.34, cu + 0.34], [cv - 0.04, cv + 0.04], [0.5, 1.5], { mat: 'frame' });
      B.add('base', 'base arm along', [cu - 0.04, cu + 0.04], [cv - 0.34, cv + 0.34], [0.5, 1.5], { mat: 'frame' });
      for (const [du, dv, name] of [
        [-0.34, 0, 'left caster'],
        [0.34, 0, 'right caster'],
        [0, -0.34, 'front caster'],
        [0, 0.34, 'back caster'],
      ] as Array<[number, number, string]>)
        B.add('base', name, [cu + du - 0.04, cu + du + 0.04], [cv + dv - 0.04, cv + dv + 0.04], [0, 1], { shape: 'cyl', mat: 'frame' });
      B.add('leg', 'gas lift', [cu - 0.05, cu + 0.05], [cv - 0.05, cv + 0.05], [1.5, zs], { shape: 'cyl', mat: 'frame' });
      break;
    }
    case 'skirt': {
      // a skirted base on four short feet, under the cushion and out to the arms
      const feet = 1.5;
      B.add('base', 'base', [0.03, W - 0.03], [vFront - 0.02, D - 0.02], [feet, zs], { mat: 'accent' });
      const fr = 0.04;
      for (const [fu, fv, name] of [
        [0.1, vFront + 0.04, 'front left foot'],
        [W - 0.1, vFront + 0.04, 'front right foot'],
        [0.1, D - 0.08, 'back left foot'],
        [W - 0.1, D - 0.08, 'back right foot'],
      ] as Array<[number, number, string]>)
        B.add('leg', name, [fu - fr, fu + fr], [fv - fr, fv + fr], [0, feet], { shape: 'cyl', mat: 'frame' });
      break;
    }
    case 'feet': {
      const fr = 0.04;
      const cu = (uL + uR) / 2;
      const cv = (vFront + vBack) / 2;
      const rad = (uR - uL) / 2 - 0.06;
      for (const [a, name] of [
        [Math.PI * 0.25, 'front foot'],
        [Math.PI * 0.75, 'left foot'],
        [Math.PI * 1.25, 'back foot'],
        [Math.PI * 1.75, 'right foot'],
      ] as Array<[number, string]>) {
        const fu = cu + Math.cos(a) * rad;
        const fv = cv + Math.sin(a) * rad;
        B.add('leg', name, [fu - fr, fu + fr], [fv - fr, fv + fr], [0, zs], { shape: 'cyl', mat: 'frame' });
      }
      break;
    }
    case 'none':
      break;
  }

  /* ---- the cushion(s) */
  cushions.forEach((cu, i) => {
    const label = n > 1 ? `cushion ${i + 1}` : 'cushion';
    B.add('seat', label, [cu.u0, cu.u1], [vFront, vBack], [zs, zc], { shape: round ? 'cyl' : c.round ? 'soft' : 'box', mat: 'fabric', detail: c.detail });
  });
  if (r.kind === 'throne') B.add('base', 'plinth', [0.02, W - 0.02], [0.02, D - 0.02], [0, 2], { mat: 'frame' });
  if (r.kind === 'throne') B.add('base', 'seat box', [uL - 0.02, uR + 0.02], [vFront - 0.02, vBack], [2, zs], { mat: 'frame' });

  /* ---- the back */
  const bk = r.back;
  const zTop = zc + bk.height;
  const backU: Span = r.kind === 'armchair' || r.kind === 'couch' ? [0.03, W - 0.03] : [uL - 0.02, uR + 0.02];
  switch (bk.style) {
    case 'rails': {
      const p = 0.08;
      const postZ0 = zs;
      B.add('back', 'left post', [uL - 0.01, uL - 0.01 + p], [vBackFace, vBackFace + bk.thick], [postZ0, zTop], { mat: 'frame' });
      B.add('back', 'right post', [uR + 0.01 - p, uR + 0.01], [vBackFace, vBackFace + bk.thick], [postZ0, zTop], { mat: 'frame' });
      B.add('back', 'top rail', [uL - 0.01 + p, uR + 0.01 - p], [vBackFace, vBackFace + bk.thick], [zTop - 3, zTop], { mat: 'frame' });
      B.add('back', 'mid rail', [uL - 0.01 + p, uR + 0.01 - p], [vBackFace, vBackFace + bk.thick], [zc + bk.height * 0.42, zc + bk.height * 0.42 + 1.5], { mat: 'frame' });
      break;
    }
    case 'ladder': {
      const p = 0.08;
      B.add('back', 'left post', [uL - 0.01, uL - 0.01 + p], [vBackFace, vBackFace + bk.thick], [zs, zTop], { mat: 'frame' });
      B.add('back', 'right post', [uR + 0.01 - p, uR + 0.01], [vBackFace, vBackFace + bk.thick], [zs, zTop], { mat: 'frame' });
      for (let k = 0; k < 3; k++) {
        const z0 = zc + 2 + ((bk.height - 3) * k) / 2.5;
        B.add('back', `rung ${k + 1}`, [uL - 0.01 + p, uR + 0.01 - p], [vBackFace, vBackFace + bk.thick], [z0, z0 + 1.5], { mat: 'frame' });
      }
      break;
    }
    case 'slats': {
      // a bench back: two posts and two boards
      const p = 0.08;
      B.add('back', 'left post', [uL + 0.06, uL + 0.06 + p], [vBackFace, vBackFace + bk.thick], [zs, zTop], { mat: 'frame' });
      B.add('back', 'right post', [uR - 0.06 - p, uR - 0.06], [vBackFace, vBackFace + bk.thick], [zs, zTop], { mat: 'frame' });
      if (W > 1) B.add('back', 'mid post', [W / 2 - p / 2, W / 2 + p / 2], [vBackFace, vBackFace + bk.thick], [zs, zTop], { mat: 'frame' });
      B.add('back', 'upper board', [uL + 0.06 + p, uR - 0.06 - p], [vBackFace, vBackFace + bk.thick], [zTop - 3, zTop], { mat: 'accent', detail: 'grain' });
      B.add('back', 'lower board', [uL + 0.06 + p, uR - 0.06 - p], [vBackFace, vBackFace + bk.thick], [zc + 3, zc + 6], { mat: 'accent', detail: 'grain' });
      break;
    }
    case 'slab': {
      B.add('back', 'back', backU, [vBackFace, vBackFace + bk.thick], [r.kind === 'throne' ? 2 : zc + 2, zTop], { mat: r.kind === 'throne' ? 'fabric' : 'accent', detail: bk.detail });
      if (r.kind === 'chair') B.add('back', 'lumbar post', [(uL + uR) / 2 - 0.05, (uL + uR) / 2 + 0.05], [vBackFace + 0.01, vBackFace + bk.thick], [zs, zc + 2], { mat: 'frame' });
      if (bk.crest) {
        B.add('other', 'crest', [W / 2 - 0.2, W / 2 + 0.2], [vBackFace + 0.02, vBackFace + bk.thick - 0.02], [zTop, zTop + 3], { mat: 'trim' });
        B.add('other', 'left finial', [backU[0], backU[0] + 0.08], [vBackFace + 0.02, vBackFace + bk.thick - 0.02], [zTop, zTop + 1.5], { mat: 'trim' });
        B.add('other', 'right finial', [backU[1] - 0.08, backU[1]], [vBackFace + 0.02, vBackFace + bk.thick - 0.02], [zTop, zTop + 1.5], { mat: 'trim' });
      }
      break;
    }
    case 'padded':
    case 'wing': {
      const z0 = legsStyle === 'skirt' ? 1.5 : zs;
      // a beanbag's rolled back: a bolster lying across its rear, round so it stands evenly on the tile
      if (r.kind === 'beanbag') B.add('wrap', 'back roll', [0.12, W - 0.12], [vBackFace, D - 0.02], [0, zTop], { shape: 'cyl', mat: 'fabric', detail: 'none' });
      else B.add('back', 'back', backU, [vBackFace, vBackFace + bk.thick], [z0, zTop], { shape: 'soft', mat: 'fabric', detail: bk.detail });
      if (bk.style === 'wing' || bk.wings) {
        const ww = 0.12;
        const wz0 = zc + r.arms.height;
        B.add('back', 'left wing', [backU[0], backU[0] + ww], [vBackFace - 0.2, vBackFace], [wz0, zTop], { shape: 'soft', mat: 'fabric' });
        B.add('back', 'right wing', [backU[1] - ww, backU[1]], [vBackFace - 0.2, vBackFace], [wz0, zTop], { shape: 'soft', mat: 'fabric' });
      }
      break;
    }
    case 'none':
      break;
  }

  /* ---- the arms */
  const ar = r.arms;
  if (ar.style !== 'none') {
    const zA = zc + ar.height;
    const vA0 = vFront + (ar.style === 'rail' ? 0.02 : 0);
    const vA1 = bk.style === 'none' ? vBack : vBackFace + backThick;
    const z0 = legsStyle === 'skirt' ? 1.5 : r.kind === 'throne' ? 2 : zs;
    if (ar.style === 'rail') {
      const p = 0.06;
      B.add('arm', 'left arm post', [uL - 0.02, uL - 0.02 + p], [vA0, vA0 + p], [zc, zA - 1], { mat: 'frame' });
      B.add('arm', 'right arm post', [uR + 0.02 - p, uR + 0.02], [vA0, vA0 + p], [zc, zA - 1], { mat: 'frame' });
      B.add('arm', 'left arm', [uL - 0.04, uL - 0.04 + ar.width], [vA0, vA1], [zA - 1, zA], { mat: 'frame' });
      B.add('arm', 'right arm', [uR + 0.04 - ar.width, uR + 0.04], [vA0, vA1], [zA - 1, zA], { mat: 'frame' });
    } else {
      const shape: Shape = ar.style === 'solid' ? 'box' : 'soft';
      const mat: MatName = ar.style === 'solid' ? 'frame' : 'fabric';
      B.add('arm', 'left arm', [uL - ar.width, uL], [vA0, vA1], [z0, zA], { shape, mat });
      B.add('arm', 'right arm', [uR, uR + ar.width], [vA0, vA1], [z0, zA], { shape, mat });
      if (ar.style === 'roll') {
        B.add('arm', 'left arm roll', [uL - ar.width - 0.02, uL + 0.02], [vA0, vA0 + 0.16], [zA - 1, zA + 2], { shape: 'cyl', mat });
        B.add('arm', 'right arm roll', [uR - 0.02, uR + ar.width + 0.02], [vA0, vA0 + 0.16], [zA - 1, zA + 2], { shape: 'cyl', mat });
      }
    }
  }

  /* ---- where people sit: one point per cushion, by the standard */
  const sits: SitPoint[] = cushions.map((cu) => {
    const u = r2((cu.u0 + cu.u1) / 2);
    let v: number;
    if (bk.style === 'none') v = (vFront + vBack) / 2 + 0.05;
    else v = vBackFace - SIT_GAP;
    // sat forward when the thighs wouldn't reach the front from there
    v = Math.min(v, vFront - KNEE_OUT + REACH_OF_STYLE[r.style]);
    return [u, r2(v), r20(zc)];
  });

  const parts = B.parts;
  const height = Math.max(...parts.map((p) => p.z[1]));
  const model: SeatModel = {
    size: [W, D],
    parts,
    sits,
    ...(r.rest !== undefined ? { rest: r20(r.rest) } : {}),
  };
  return { ...r, model, seat: r20(zc), backrest: bk.style !== 'none', hasArms: ar.style !== 'none', height: r20(height) };
}

/** The framework's own checks on a build (before any pixel is drawn): what's wrong with it, or nothing. */
export function buildProblems(b: SeatBuild): string[] {
  const out: string[] = [];
  const { model } = b;
  const cushionZ = b.cushion.z;
  if (cushionZ + 1.5 > SHIN_MAX + (b.rest ?? 0)) out.push(`cushion at ${cushionZ}: the shins (${SHIN_MAX}) can't reach the ${b.rest !== undefined ? 'footrest' : 'floor'}`);
  if (b.back.style !== 'none' && b.back.height > 17) out.push(`back ${b.back.height} above the cushion rises past the sitter's ears (17): they'd vanish from behind`);
  if (b.back.style !== 'none' && b.back.height < 4) out.push(`back ${b.back.height} above the cushion is lower than the sitter's hips`);
  if (b.arms.style !== 'none' && (b.arms.height < 3 || b.arms.height > 9)) out.push(`arms ${b.arms.height} above the cushion: forearms rest between 3 and 9`);
  model.sits.forEach(([u, v], i) => {
    const seat = model.parts.find((p) => p.part === 'seat' && u >= p.u[0] && u <= p.u[1] && v >= p.v[0] && v <= p.v[1]);
    if (!seat) out.push(`cushion ${i}: the sitting point (${u}, ${v}) isn't over a seat block`);
    else {
      const frac = (v - seat.v[0]) / (seat.v[1] - seat.v[0]);
      if (frac < 0.35 || frac > 0.85) out.push(`cushion ${i}: the pelvis sits ${Math.round(frac * 100)}% into the cushion's depth (35–85%)`);
    }
  });
  for (const p of model.parts) if (p.z[0] < 0) out.push(`${(p as BuiltPart).label}: below the floor`);
  return out;
}
