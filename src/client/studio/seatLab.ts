/**
 * Seat calibration for a draft: the seat standard's fit (seatCheck.ts), run on the draft's own drawings exactly
 * as scripts/seat-fit.ts runs it on the catalog. One pixel — the centre of the first cushion's top face in the
 * front drawing as the game resolves it facing se — gives the seat height and hip depth; the back views' hip
 * depth is fitted; then every facing is composed with a sitter on every cushion and checked.
 *
 * Pure (pixels in, profile and findings out): the Design Lab runs it live as you click, and
 * scripts/lab-seat.ts runs it on the staged drawings before a publish.
 */
import type { Facing } from '@shared/world/scene';
import type { SeatProfile } from '@shared/world/seats';
import { centredAnchor, type Pixels } from '../engine/sprites/footing';
import { mirrorLine, type SeatArt } from '../engine/sprites/seatFit';
import { checkSeatView, fitBackDepth, profileFromPoint, seatPlacement, type SeatView } from '../engine/sprites/seatCheck';

export const SEAT_FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };

/** A drawing and its anchor (the footprint's back vertex), as it will be published. */
export interface Drawing {
  px: Pixels;
  anchor: [number, number];
}
/** A seat's drawings: one per drawn facing, or a single one ('one'). */
export type Drawings = Partial<Record<Facing | 'one', Drawing>>;

/** What the Lab stores: the clicked cushion centre, and whether the whole seat wraps its sitter from behind. */
export interface SeatCalibration {
  cushion: [number, number];
  /** Seen from behind, all of the seat covers its sitter (a beanbag; a sofa all one colour). */
  cover: boolean;
}

export function mirrorPixels(p: Pixels): Pixels {
  const d = new Uint8ClampedArray(p.d.length);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const s = (y * p.w + x) * 4;
      const t = (y * p.w + (p.w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) d[t + k] = p.d[s + k];
    }
  return { w: p.w, h: p.h, d };
}

/**
 * The drawing the game uses for a seat facing `f` (art.ts; seat-fit.ts seatArt): its own, else its partner's
 * mirrored, else the one drawing (mirrored when a long piece turns); a small seat is centred on its footprint.
 */
export function seatArt(drawings: Drawings, footprint: readonly [number, number], f: Facing): { art: SeatArt; mirrored: boolean; drawn: Facing } | null {
  const { w, d } = seatPlacement(footprint, f);
  let rec = drawings.one;
  let mirror = !!rec && footprint[0] !== footprint[1] && w === footprint[1] && d === footprint[0];
  let drawn = f;
  if (!rec) {
    rec = drawings[f];
    if (!rec && drawings[MIRROR[f]]) {
      rec = drawings[MIRROR[f]];
      mirror = true;
      drawn = MIRROR[f];
    }
    if (!rec) {
      const first = SEAT_FACINGS.find((g) => drawings[g]);
      if (!first) return null;
      rec = drawings[first];
    }
  }
  const px = mirror ? mirrorPixels(rec!.px) : rec!.px;
  const c = centredAnchor(px, w, d, 2);
  const [x, ay] = c ?? rec!.anchor;
  // mirroring swaps the footprint's axes; its back vertex stays the top vertex, reflected
  const ax = !c && mirror ? px.w - x : x;
  return { art: { px, ax, ay }, mirrored: mirror, drawn };
}

export interface SeatFit {
  profile: SeatProfile;
  views: Array<{ facing: Facing; problems: string[]; cell: Pixels }>;
}

/** Calibrate and check: the profile the catalog entry gets, and each facing composed with its sitters. */
export function fitSeat(
  drawings: Drawings,
  footprint: readonly [number, number],
  style: Pick<SeatProfile, 'sitStyle' | 'backrest'>,
  cal: SeatCalibration,
): SeatFit | null {
  const front = seatArt(drawings, footprint, 'se');
  if (!front) return null;
  const { seat, seatDepth } = profileFromPoint(front.art, 'se', cal.cushion);
  // "all of it covers": a backrest line across the top of each drawn back view (seat-fit.ts ALL)
  const backs = [...new Set((['ne', 'nw'] as const).map((f) => seatArt(drawings, footprint, f)?.drawn).filter((f): f is 'ne' | 'nw' => f === 'ne' || f === 'nw'))];
  const backLine = cal.cover && backs.length ? (Object.fromEntries(backs.map((f) => [f, [[0, 0], [999, 0]]])) as SeatProfile['backLine']) : undefined;
  const profile: SeatProfile = { seat, seatDepth, backDepth: seatDepth, sitStyle: style.sitStyle, backrest: style.backrest, ...(backLine ? { backLine } : {}) };
  const view = (f: Facing): SeatView => {
    const r = seatArt(drawings, footprint, f)!;
    const drawnLine = profile.backLine?.[r.drawn as 'ne' | 'nw'];
    return { art: r.art, facing: f, footprint, line: drawnLine && r.mirrored ? mirrorLine(drawnLine, r.art.px.w) : drawnLine };
  };
  profile.backDepth = fitBackDepth([view('ne'), view('nw')], profile);
  const views = SEAT_FACINGS.map((f) => {
    const r = checkSeatView(view(f), profile, { size: 150 });
    return { facing: f, problems: r.problems, cell: r.cell };
  });
  return { profile, views };
}
