/**
 * The character frame: one skeleton per view and pose that every avatar part hangs off. Nothing is
 * positioned any other way — eyes, brows, glasses, hats, hair, collars, sleeves, cups and shoes all read
 * their place from here, so they line up in every facing and pose by construction.
 *
 * Canvas: 88 × 128 px at 2× density (64 px per floor tile); the figure stands centred on x = 45 with its
 * feet on y = 104. Proportions follow the classic social-game figure: a big round head sitting on the
 * shoulders (head skin 22 × 22), a short torso (~19 px), short legs (~16 px) and chunky shoes.
 * The two authored views face screen-right: "front" (3/4 front, facing se) and "back" (3/4 back, facing
 * ne); sw/nw are mirrors.
 */
import { SIT_DROP, type SitStyle } from '@shared/world/seats';
import { NATURAL_LEGS, type SitLegs } from '@shared/world/sitLegs';

export type { SitStyle } from '@shared/world/seats';
export type Pose =
  | 'stand'
  | 'walk1'
  | 'walk2'
  | 'sit'
  | 'sit-stool'
  | 'sit-lounge'
  | 'sit-floor'
  | 'crouch'
  | 'wave'
  | 'work'
  | LifePose;

/**
 * Character life (see WorldView): the passing frames between walk strides, emote gestures (each 1–2 frames),
 * a four-frame dance, and quiet idle moments.
 */
export type LifePose =
  | 'pass1'
  | 'pass2'
  | 'clap1'
  | 'clap2'
  | 'cheer1'
  | 'cheer2'
  | 'thumbs'
  | 'laugh1'
  | 'laugh2'
  | 'heart'
  | 'idea'
  | 'dance1'
  | 'dance2'
  | 'dance3'
  | 'dance4'
  | 'shift'
  | 'phone';

export const LIFE_POSES: LifePose[] = [
  'pass1',
  'pass2',
  'clap1',
  'clap2',
  'cheer1',
  'cheer2',
  'thumbs',
  'laugh1',
  'laugh2',
  'heart',
  'idea',
  'dance1',
  'dance2',
  'dance3',
  'dance4',
  'shift',
  'phone',
];

/** Body bob (+ down) and sway (+ toward screen right) per pose, in frame px. */
const LIFE_DY: Partial<Record<Pose, number>> = { walk1: 1, walk2: 1, cheer2: -2, laugh1: 1, dance2: 1, dance4: 1 };
const LIFE_DX: Partial<Record<Pose, number>> = { dance1: -1, dance3: 1, shift: 1 };

/**
 * How a seat is sat in (the seat standard, see src/shared/world/seats.ts): each is its own sitting pose.
 *   chair  — upright, thighs level, shins hanging down past the seat's front edge ('sit')
 *   stool  — tall and shallow: thighs slope down, shins hang straight to a rung ('sit-stool')
 *   lounge — sofas and armchairs: sunk a pixel deeper, knees up, feet forward ('sit-lounge')
 *   floor  — beanbags: low, legs stretched out forward ('sit-floor')
 */
export const SIT_POSE: Record<SitStyle, Pose> = { chair: 'sit', stool: 'sit-stool', lounge: 'sit-lounge', floor: 'sit-floor' };
export const isSitPose = (p: Pose) => p === 'sit' || p === 'sit-stool' || p === 'sit-lounge' || p === 'sit-floor';

/** How far the upper body drops for each sitting pose (the seat standard's values), and for the crouch. */
const DROP: Partial<Record<Pose, number>> = {
  sit: SIT_DROP.chair,
  'sit-stool': SIT_DROP.stool,
  'sit-lounge': SIT_DROP.lounge,
  'sit-floor': SIT_DROP.floor,
  crouch: 3,
};
/**
 * Body bases: 'a' straight (squarer shoulders), 'b' softer (narrower shoulders, a defined waist). The same
 * head, face anchors and legs; parts conform to whichever torso the frame gives them.
 */
export type Body = 'a' | 'b';
export type View = 'front' | 'back';
export type Pt = [number, number];

export interface Limb {
  a: Pt; // shoulder or hip
  m: Pt; // elbow or knee
  b: Pt; // wrist or ankle
}

export interface Frame {
  view: View;
  pose: Pose;
  /** Head skin box (x0, y0, x1, y1) and its centre. */
  head: [number, number, number, number];
  hx: number;
  hy: number;
  /** Top of the skull; hair and hats build up from here. */
  crown: Pt;
  /** Where the hairline meets the forehead (front view). */
  hairline: number;
  /** Eye centres: near (left, full width) and far (right, foreshortened). */
  eyeNear: Pt;
  eyeFar: Pt;
  browY: number;
  /** Nose: where its line sits inside the cheek, and where the tip breaks the outline. */
  nose: Pt;
  noseTip: Pt;
  mouth: Pt;
  /** The visible ear (front: near side; back: far side). */
  ear: Pt;
  chin: Pt;
  /** Neck base / collar centre. */
  collar: Pt;
  shoulderY: number;
  waistY: number;
  hipY: number;
  /** Torso outline, shoulders → waist. */
  torso: Pt[];
  armNear: Limb;
  armFar: Limb;
  handNear: Pt;
  handFar: Pt;
  legNear: Limb;
  legFar: Limb;
  /** Heel lifted (the back foot mid-stride). */
  heelNear?: boolean;
  heelFar?: boolean;
  sitting: boolean;
  body: Body;
  /** Where a carried thing is held, and whether it's in front of the body in this view. */
  hold: Pt;
  holdInFront: boolean;
  /** Both hands in front of the chest (a clap, hands on the heart): the far arm is drawn in front of the body. */
  farArmFront?: boolean;
  /** A hand detail on the near hand: a thumb up, a finger raised, a phone. */
  gesture?: 'thumb' | 'finger' | 'phone';
}

const CX = 45;

/** Upper body, identical across poses except for a bob (dy) and a sway (dx). */
function upper(view: View, dy: number, body: Body, dx = 0) {
  const CX = 45 + dx;
  const x0 = CX - 11;
  const y0 = 36 + dy;
  const head: [number, number, number, number] = [x0, y0, x0 + 22, y0 + 22];
  const front = view === 'front';
  const sY = 58 + dy;
  const wY = 76 + dy;
  return {
    head,
    hx: CX,
    hy: y0 + 11,
    crown: [CX, y0] as Pt,
    hairline: y0 + 6,
    // Features sit around the middle of the head (eyes clear of any fringe, the mouth close below them),
    // the way the classic social-game faces are proportioned.
    // close-set and turned toward the way we face (3/4 view): the near eye just left of centre, the far
    // eye a small gap to its right
    eyeNear: [CX - 2, y0 + 11] as Pt,
    eyeFar: [CX + 4, y0 + 11] as Pt,
    browY: y0 + 8,
    nose: [CX + 7, y0 + 12] as Pt,
    noseTip: [CX + 11, y0 + 12] as Pt,
    mouth: [CX + 2, y0 + 16] as Pt,
    ear: (front ? [x0 + 1, y0 + 10] : [x0 + 21, y0 + 10]) as Pt,
    chin: [CX + 2, y0 + 21] as Pt,
    collar: [CX + 1, sY] as Pt,
    shoulderY: sY,
    waistY: wY,
    hipY: wY + 6,
    torso: (body === 'b'
      ? [
          [CX - 6, sY],
          [CX + 7, sY],
          [CX + 9, sY + 3],
          [CX + 7, sY + 11],
          [CX + 8, wY],
          [CX - 7, wY],
          [CX - 6, sY + 11],
          [CX - 8, sY + 3],
        ]
      : [
          [CX - 8, sY],
          [CX + 9, sY],
          [CX + 11, sY + 3],
          [CX + 9, wY],
          [CX - 8, wY],
          [CX - 10, sY + 3],
        ]) as Pt[],
  };
}

/** Seen from behind, a seated figure's thighs are drawn at most this long (tiles): its natural thigh. */
const BACK_REACH = 0.1;

/** The sitting style of a sitting pose. */
const STYLE_OF: Partial<Record<Pose, SitStyle>> = { sit: 'chair', 'sit-stool': 'stool', 'sit-lounge': 'lounge', 'sit-floor': 'floor' };

/**
 * Seated legs from the seat (sitLegs.ts), in this frame's px: the thighs from the hip joints forward to the knees and
 * the shins down to the soles, projected the way the world is (a tile forward is 32 px across and 16 px down from the
 * front, 16 px up from behind; a world px of height is 2 px). Seen from behind the legs run away from us and end at
 * the knee (the seat hides the rest).
 */
function seatedLegs(view: View, h: number, S: SitLegs): { near: Limb; far: Limb } {
  const back = view === 'back';
  // seen from behind, the thighs run away from us behind the hips: however deep the seat, only their near part could
  // show past the body, so they're drawn no longer than the figure's own (a longer one pokes out sideways)
  const reach = back ? Math.min(S.reach, BACK_REACH) : S.reach;
  const kx = 32 * reach;
  const ky = (back ? -16 : 16) * reach - 2 * S.rise;
  const leg = (x: number, y: number): Limb => {
    const m: Pt = [x + kx, y + ky];
    if (back) return { a: [x, y], m, b: m };
    // the ankle: the sole `drop` below the knee, `toe` further forward; the shoe is drawn 5 px tall above the sole
    const sx = m[0] + 32 * S.toe;
    const sy = m[1] + 16 * S.toe + 2 * S.drop;
    return { a: [x, y], m, b: [sx, sy - 5] };
  };
  return { near: leg(CX - 4, h), far: leg(CX + 4, h - 1) };
}

/**
 * `carry`: holding something to show (a cup, a soda, popcorn, a plush): one arm is bent with the hand raised in
 * front of the chest (seen from the front) or held out at the side (seen from behind), and doesn't swing.
 * `legs`: how a sitter's legs lie on their seat (sitLegs.ts); a sitting pose without it takes its style's natural
 * legs, and 'legacy' keeps the side-on legs a wheelchair's footrest is drawn for.
 */
export function frameFor(view: View, pose: Pose, body: Body = 'a', carry = false, legs?: SitLegs | 'legacy'): Frame {
  const sitting = isSitPose(pose);
  const dy = DROP[pose] ?? LIFE_DY[pose] ?? 0;
  const dx = LIFE_DX[pose] ?? 0;
  const U = upper(view, dy, body, dx);
  const s = U.shoulderY;
  // Arms hang straight with hands at the hips; they swing opposite the legs when walking.
  let armNear: Limb = { a: [CX - 9, s + 3], m: [CX - 10, s + 10], b: [CX - 10, s + 17] };
  let armFar: Limb = { a: [CX + 10, s + 3], m: [CX + 11, s + 10], b: [CX + 11, s + 16] };
  if (pose === 'walk1') {
    armNear = { a: [CX - 9, s + 3], m: [CX - 12, s + 10], b: [CX - 13, s + 16] };
    armFar = { a: [CX + 10, s + 3], m: [CX + 12, s + 9], b: [CX + 14, s + 15] };
  } else if (pose === 'walk2') {
    armNear = { a: [CX - 9, s + 3], m: [CX - 8, s + 10], b: [CX - 6, s + 16] };
    armFar = { a: [CX + 10, s + 3], m: [CX + 9, s + 10], b: [CX + 8, s + 16] };
  } else if (pose === 'wave') {
    // raised clear of the head (a hand touching the ear traps a see-through pocket)
    armNear = { a: [CX - 9, s + 2], m: [CX - 16, s - 3], b: [CX - 18, s - 10] };
  } else if (pose === 'work') {
    // both hands forward at counter height (tamping, pouring, wiping down)
    armNear = { a: [CX - 9, s + 3], m: [CX - 7, s + 10], b: [CX - 2, s + 12] };
    armFar = { a: [CX + 10, s + 3], m: [CX + 12, s + 9], b: [CX + 7, s + 11] };
  } else if (sitting) {
    armNear = { a: [CX - 9, s + 3], m: [CX - 9, s + 11], b: [CX - 3, s + 16] };
    armFar = { a: [CX + 10, s + 3], m: [CX + 11, s + 10], b: [CX + 10, s + 15] };
  } else if (pose === 'crouch') {
    // lowering into a seat (or getting up): hands reaching back toward the seat
    armNear = { a: [CX - 9, s + 3], m: [CX - 11, s + 10], b: [CX - 10, s + 16] };
    armFar = { a: [CX + 10, s + 3], m: [CX + 12, s + 10], b: [CX + 11, s + 15] };
  }
  // ---- character life: gestures, dance and idle moments (the body sways by dx, so limbs start from cx)
  const cx = CX + dx;
  const front = view === 'front';
  let farArmFront = false;
  let gesture: Frame['gesture'];
  const arms = (n: [Pt, Pt, Pt], f: [Pt, Pt, Pt]) => {
    armNear = { a: n[0], m: n[1], b: n[2] };
    armFar = { a: f[0], m: f[1], b: f[2] };
  };
  const hangNear: [Pt, Pt, Pt] = [[cx - 9, s + 3], [cx - 10, s + 10], [cx - 10, s + 17]];
  const hangFar: [Pt, Pt, Pt] = [[cx + 10, s + 3], [cx + 11, s + 10], [cx + 11, s + 16]];
  switch (pose) {
    case 'pass1': // between strides: arms at half swing, coming back
      arms([[cx - 9, s + 3], [cx - 11, s + 10], [cx - 11, s + 16]], [[cx + 10, s + 3], [cx + 11, s + 10], [cx + 12, s + 16]]);
      break;
    case 'pass2':
      arms([[cx - 9, s + 3], [cx - 9, s + 10], [cx - 8, s + 16]], [[cx + 10, s + 3], [cx + 10, s + 10], [cx + 10, s + 16]]);
      break;
    case 'clap1': // hands apart in front of the chest, about to meet
    case 'clap2': {
      const gap = pose === 'clap1' ? 5 : 0;
      if (front) {
        farArmFront = true;
        arms([[cx - 9, s + 3], [cx - 11, s + 10], [cx - 2 - gap, s + 8]], [[cx + 10, s + 3], [cx + 13, s + 9], [cx + 3 + gap, s + 8]]);
      } else arms([[cx - 9, s + 3], [cx - 12, s + 9], [cx - 9 + gap / 5, s + 9]], [[cx + 10, s + 3], [cx + 13, s + 9], [cx + 10 - gap / 5, s + 9]]);
      break;
    }
    case 'cheer1': // both arms thrown up
      arms([[cx - 9, s + 2], [cx - 14, s - 4], [cx - 16, s - 12]], [[cx + 10, s + 2], [cx + 15, s - 4], [cx + 17, s - 12]]);
      break;
    case 'cheer2': // …and a hop
      arms([[cx - 9, s + 2], [cx - 13, s - 5], [cx - 15, s - 14]], [[cx + 10, s + 2], [cx + 14, s - 5], [cx + 16, s - 14]]);
      break;
    case 'thumbs': // forearm up in front, thumb raised
      arms([[cx - 9, s + 3], [cx - 14, s + 8], [cx - 14, s + 1]], hangFar);
      gesture = 'thumb';
      break;
    case 'laugh1': // hands on the belly, shoulders shaking
    case 'laugh2': {
      const k = pose === 'laugh1' ? 0 : 1;
      if (front) {
        farArmFront = true;
        arms([[cx - 9, s + 3], [cx - 12 + k, s + 9], [cx - 5, s + 14 - k]], [[cx + 10, s + 3], [cx + 13 - k, s + 9], [cx + 6, s + 14 - k]]);
      } else arms([[cx - 9, s + 3], [cx - 12 + k, s + 9], [cx - 9, s + 14 - k]], [[cx + 10, s + 3], [cx + 13 - k, s + 9], [cx + 10, s + 14 - k]]);
      break;
    }
    case 'heart': // both hands over the heart
      if (front) {
        farArmFront = true;
        arms([[cx - 9, s + 3], [cx - 11, s + 10], [cx - 2, s + 7]], [[cx + 10, s + 3], [cx + 13, s + 10], [cx + 3, s + 7]]);
      } else arms([[cx - 9, s + 3], [cx - 12, s + 10], [cx - 9, s + 9]], [[cx + 10, s + 3], [cx + 13, s + 10], [cx + 10, s + 9]]);
      break;
    case 'idea': // one finger up beside the head
      arms([[cx - 9, s + 2], [cx - 15, s - 2], [cx - 16, s - 13]], hangFar);
      gesture = 'finger';
      break;
    case 'dance1': // sway left: near arm up, far arm swung out low
      arms([[cx - 9, s + 2], [cx - 15, s - 5], [cx - 17, s - 16]], [[cx + 10, s + 3], [cx + 14, s + 8], [cx + 16, s + 12]]);
      break;
    case 'dance2': // bounce: elbows out, hands up in front
      arms([[cx - 9, s + 3], [cx - 14, s + 8], [cx - 8, s + 4]], [[cx + 10, s + 3], [cx + 15, s + 7], [cx + 10, s + 3]]);
      break;
    case 'dance3': // sway right: far arm up, near arm swung out low
      arms([[cx - 9, s + 3], [cx - 13, s + 8], [cx - 15, s + 12]], [[cx + 10, s + 2], [cx + 16, s - 5], [cx + 18, s - 16]]);
      break;
    case 'dance4': // bounce: arms swinging down and out
      arms([[cx - 9, s + 3], [cx - 13, s + 10], [cx - 14, s + 15]], [[cx + 10, s + 3], [cx + 14, s + 10], [cx + 15, s + 14]]);
      break;
    case 'shift': // weight on one leg, arms loose
      arms(hangNear, hangFar);
      break;
    case 'phone': // looking at a phone held at the chest
      arms([[cx - 9, s + 3], [cx - 9, s + 11], [cx - 3, s + 8]], hangFar);
      gesture = 'phone';
      break;
  }
  const carrying = carry && (pose === 'stand' || pose === 'walk1' || pose === 'walk2' || pose === 'pass1' || pose === 'pass2' || sitting);
  if (carrying && view === 'front') {
    // the near arm: elbow at the waist, forearm forward, hand up in front of the chest (above the lap when seated)
    armNear = { a: [CX - 9, s + 3], m: [CX - 9, s + 11], b: [CX - 3, s + 9] };
  } else if (carrying && sitting) {
    // seated, seen from behind: the cup raised by the shoulder, mid-sip — clear of a backrest that hides the
    // hips and lower back (BACK_COVER_UP), so everyone can see what you're holding
    armFar = { a: [CX + 10, s + 3], m: [CX + 13, s + 9], b: [CX + 14, s + 3] };
  } else if (carrying) {
    // from behind the far-side arm is the one in front of the body: held out and up so the item shows
    armFar = { a: [CX + 10, s + 3], m: [CX + 12, s + 10], b: [CX + 15, s + 7] };
  }
  if (body === 'b') {
    // narrower shoulders: the arms hang two pixels further in
    const shift = (l: Limb, d: number): Limb => ({ a: [l.a[0] + d, l.a[1]], m: [l.m[0] + d, l.m[1]], b: [l.b[0] + d, l.b[1]] });
    armNear = shift(armNear, 2);
    armFar = shift(armFar, -2);
  }
  const hand = (l: Limb, dx = 0): Pt => [l.b[0] + dx, l.b[1] + 2];
  // Legs: short, straight; a stride when walking; thighs forward when sitting.
  const h = U.hipY;
  let legNear: Limb = { a: [CX - 4, h], m: [CX - 4, h + 9], b: [CX - 4, 99] };
  let legFar: Limb = { a: [CX + 4, h], m: [CX + 4, h + 9], b: [CX + 4, 99] };
  let heelNear = false;
  let heelFar = false;
  if (pose === 'walk1') {
    legNear = { a: [CX - 4, h], m: [CX - 2, h + 9], b: [CX + 1, 99] };
    legFar = { a: [CX + 4, h], m: [CX + 2, h + 9], b: [CX - 1, 97] };
    heelFar = true;
  } else if (pose === 'walk2') {
    legNear = { a: [CX - 4, h], m: [CX - 6, h + 9], b: [CX - 8, 97] };
    legFar = { a: [CX + 4, h], m: [CX + 6, h + 9], b: [CX + 8, 99] };
    heelNear = true;
  } else if (sitting && legs !== 'legacy') {
    const S = legs ?? NATURAL_LEGS[STYLE_OF[pose] ?? 'chair'];
    ({ near: legNear, far: legFar } = seatedLegs(view, h, S));
  } else if (sitting && view === 'back') {
    // seen from behind the thighs run straight out, away from us along the seat: up the screen at the floor's 2:1,
    // the torso hiding their near end and the far one showing past it; the shins drop beyond the seat's front edge,
    // out of sight, so a leg ends at the knee (m = b). A sofa sinks you and brings the knees up; a beanbag's legs
    // stretch out further. (Carter: "I want to see the legs straight out"; hanging straight down, or none, read
    // as someone standing.)
    const reach = pose === 'sit-floor' ? 16 : pose === 'sit-lounge' ? 13 : 12;
    const up = pose === 'sit-lounge' ? 1 : 0;
    const knee = (x: number, y: number): Pt => [x + reach, y - reach / 2 - up];
    legNear = { a: [CX - 4, h], m: knee(CX - 4, h), b: knee(CX - 4, h) };
    legFar = { a: [CX + 4, h - 1], m: knee(CX + 4, h - 1), b: knee(CX + 4, h - 1) };
  } else if (pose === 'sit-stool') {
    // tall and shallow: thighs slope down off the seat, shins hang straight down to the rung
    legNear = { a: [CX - 4, h], m: [CX + 4, h + 4], b: [CX + 4, h + 12] };
    legFar = { a: [CX + 4, h - 1], m: [CX + 10, h + 3], b: [CX + 10, h + 11] };
  } else if (pose === 'sit-lounge') {
    // sunk into a sofa: knees up level with the hips, shins angled forward, feet out in front
    legNear = { a: [CX - 4, h], m: [CX + 8, h + 1], b: [CX + 10, h + 9] };
    legFar = { a: [CX + 4, h - 1], m: [CX + 14, h], b: [CX + 16, h + 8] };
  } else if (pose === 'sit-floor') {
    // low in a beanbag: legs stretched out forward, feet resting on the floor ahead
    legNear = { a: [CX - 4, h], m: [CX + 6, h + 2], b: [CX + 13, h + 4] };
    legFar = { a: [CX + 4, h - 1], m: [CX + 12, h + 1], b: [CX + 18, h + 3] };
  } else if (sitting) {
    // a chair: thighs level to the seat's front edge, shins hanging down past it
    legNear = { a: [CX - 4, h], m: [CX + 7, h + 2], b: [CX + 8, h + 10] };
    legFar = { a: [CX + 4, h - 1], m: [CX + 13, h + 1], b: [CX + 14, h + 9] };
  } else if (pose === 'crouch') {
    // halfway down: knees bent forward over the feet
    legNear = { a: [CX - 4, h], m: [CX + 1, h + 7], b: [CX - 2, 99] };
    legFar = { a: [CX + 4, h], m: [CX + 8, h + 6], b: [CX + 5, 99] };
  } else if (pose === 'pass1') {
    // passing: feet close together, the trailing foot just lifting
    legNear = { a: [CX - 4, h], m: [CX - 3, h + 9], b: [CX - 2, 99] };
    legFar = { a: [CX + 4, h], m: [CX + 3, h + 9], b: [CX + 2, 98] };
    heelFar = true;
  } else if (pose === 'pass2') {
    legNear = { a: [CX - 4, h], m: [CX - 5, h + 9], b: [CX - 5, 98] };
    legFar = { a: [CX + 4, h], m: [CX + 5, h + 9], b: [CX + 5, 99] };
    heelNear = true;
  } else if (pose === 'cheer2') {
    // off the ground: knees soft, both feet up
    legNear = { a: [cx - 4, h], m: [cx - 3, h + 8], b: [cx - 4, 97] };
    legFar = { a: [cx + 4, h], m: [cx + 5, h + 8], b: [cx + 4, 96] };
  } else if (pose === 'dance1' || pose === 'shift') {
    // hips over to one side: the near leg carries the weight, the far knee bends
    legNear = { a: [cx - 4, h], m: [CX - 4, h + 9], b: [CX - 4, 99] };
    legFar = { a: [cx + 4, h], m: [CX + 6, h + 8], b: [CX + 4, 98] };
    heelFar = true;
  } else if (pose === 'dance3') {
    legNear = { a: [cx - 4, h], m: [CX - 6, h + 8], b: [CX - 4, 98] };
    legFar = { a: [cx + 4, h], m: [CX + 4, h + 9], b: [CX + 4, 99] };
    heelNear = true;
  } else if (pose === 'dance2' || pose === 'dance4' || pose === 'laugh1') {
    // a little bounce: knees give
    legNear = { a: [cx - 4, h], m: [CX - 5, h + 8], b: [CX - 4, 99] };
    legFar = { a: [cx + 4, h], m: [CX + 5, h + 8], b: [CX + 4, 99] };
  } else if (dx) {
    legNear = { a: [cx - 4, h], m: [cx - 4, h + 9], b: [CX - 4, 99] };
    legFar = { a: [cx + 4, h], m: [cx + 4, h + 9], b: [CX + 4, 99] };
  }
  const holdLimb = carrying ? (view === 'front' ? armNear : armFar) : pose === 'wave' ? armFar : armNear;
  return {
    view,
    pose,
    body,
    hold: hand(holdLimb),
    holdInFront: carrying || view === 'front',
    ...U,
    armNear,
    armFar,
    handNear: hand(armNear),
    handFar: hand(armFar),
    legNear,
    legFar,
    heelNear,
    heelFar,
    sitting,
    farArmFront: farArmFront || undefined,
    gesture,
  };
}
