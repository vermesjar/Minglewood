/**
 * The character frame: one skeleton per view and pose that every avatar part hangs off. Nothing is
 * positioned any other way — eyes, brows, glasses, hats, hair, collars, sleeves, cups and shoes all read
 * their place from here, so they line up in every facing and pose by construction.
 *
 * Canvas: 88 × 112 px at 2× density (64 px per floor tile); the figure stands centred on x = 45 with its
 * feet on y = 104. Proportions follow the classic social-game figure: a big round head sitting on the
 * shoulders (head skin 22 × 22), a short torso (~19 px), short legs (~16 px) and chunky shoes.
 * The two authored views face screen-right: "front" (3/4 front, facing se) and "back" (3/4 back, facing
 * ne); sw/nw are mirrors.
 */
export type Pose = 'stand' | 'walk1' | 'walk2' | 'sit' | 'wave' | 'work';
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
}

const CX = 45;

/** Upper body, identical across poses except for a vertical shift. */
function upper(view: View, dy: number, body: Body) {
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

/**
 * `carry`: holding something to show (a cup, a soda, popcorn, a plush): one arm is bent with the hand raised in
 * front of the chest (seen from the front) or held out at the side (seen from behind), and doesn't swing.
 */
export function frameFor(view: View, pose: Pose, body: Body = 'a', carry = false): Frame {
  const sitting = pose === 'sit';
  const dy = sitting ? 6 : pose === 'walk1' || pose === 'walk2' ? 1 : 0;
  const U = upper(view, dy, body);
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
  }
  const carrying = carry && (pose === 'stand' || pose === 'walk1' || pose === 'walk2');
  if (carrying && view === 'front') {
    // the near arm: elbow at the waist, forearm forward, hand up in front of the chest
    armNear = { a: [CX - 9, s + 3], m: [CX - 9, s + 11], b: [CX - 3, s + 9] };
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
  } else if (sitting && view === 'back') {
    // seen from behind the thighs run away from us, staying inside the torso's silhouette (a low backrest
    // must hide them), with just the shins and feet showing below
    legNear = { a: [CX - 4, h], m: [CX + 3, h + 1], b: [CX + 5, h + 6] };
    legFar = { a: [CX + 4, h], m: [CX + 9, h], b: [CX + 10, h + 5] };
  } else if (sitting) {
    legNear = { a: [CX - 4, h], m: [CX + 7, h + 3], b: [CX + 8, 98] };
    legFar = { a: [CX + 4, h - 1], m: [CX + 13, h + 2], b: [CX + 14, 97] };
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
  };
}
