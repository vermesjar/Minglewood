/**
 * Living furniture: small per-object animations, declared per drawing and anchored to points in the
 * drawing's own pixels (so they follow mirrored rotations and the furniture standard's centring).
 *
 * Each piece gets only what it would really do — steam from the espresso machine's wand, koi in the
 * aquarium, flames in the fireplace, LEDs on the server rack — and nothing is loud: slow, sparse, small.
 * Particle effects (steam, flames, bubbles, notes) go through Effects; the rest is drawn right after the
 * object in depth order, clipped to its glass or screen.
 */
import type { SceneDef, SceneObject, UseKind } from '@shared/world/scene';
import type { BoardNote, MomentKind } from '@shared/protocol';
import { noteColor } from '@shared/world/uses';
import { wallArt } from './sprites/art';
import { TABLES, TableGame, label } from './tabletop';
import { WATERWORKS, Waterworks, type WaterLight } from './waterworks';
import type { Effects } from './effects';
import type { Sprite } from './sprites/painter';
import { worldTimeNow } from './weather';

type P = [number, number];
type Quad = [P, P, P, P];

export type AnimSpec =
  /** Wisps rising from a point every so often. */
  | { kind: 'steam'; at: P; every: number }
  /** A puff when a drink is made (triggered, see `trigger`). */
  | { kind: 'brew'; at: P[] }
  /** Koi swimming behind glass (quad: top-left, top-right, bottom-right, bottom-left). */
  | { kind: 'fish'; glass: Quad; n: number }
  /** Bubbles rising behind glass. */
  | { kind: 'bubbles'; glass: Quad; every: number }
  | { kind: 'flames'; at: P; spread: number; rate: number }
  /** Little lights winking on and off. */
  | { kind: 'blink'; at: P[]; colors: string[] }
  /**
   * A soft pulsing glow (lanterns, neon); several colours cycle slowly. `dusk`: a lantern on a building, faint by
   * day and full from dusk (the lit windows' own glow comes from the drawing's night glow).
   */
  | { kind: 'glow'; at: P; r: number; color: string; speed: number; cycle?: string[]; dusk?: boolean }
  /** Marquee bulbs in a row (any path, in order): every third one dims in turn, chasing along (r: bulb radius). */
  | { kind: 'marquee'; at: P[]; r: number; off: string; rate: number }
  /** Music notes drifting up. */
  | { kind: 'notes'; at: P; every: number }
  /** Marquee lights chasing along a line. */
  | { kind: 'chase'; from: P; to: P; n: number; colors: string[] }
  /** A screen in attract mode: a rolling scanline and a breathing brightness. */
  | { kind: 'screen'; quad: Quad }
  /** A pendulum swinging in its window (the painted one is covered with the window's colour first). */
  | { kind: 'pendulum'; pivot: P; len: number; bob: number; clear: Quad; amp: number }
  /** A clock face showing the real time (the painted hands are covered with the face's colour first). */
  | { kind: 'clockface'; at: P; rx: number; ry: number; paper: string }
  /** Light rippling through water behind glass. */
  | { kind: 'shimmer'; glass: Quad }
  /** Lines of code scrolling on a monitor. */
  | { kind: 'code'; quad: Quad; colors: string[] }
  /** Little candle flames flickering. */
  | { kind: 'candles'; at: P[] }
  /** The whole piece bobs gently (balloons). */
  | { kind: 'bob'; amp: number; period: number }
  /** Rung (the launch bell): the piece shakes and rings spread from a point. */
  | { kind: 'ring'; at: P }
  /** An LED strip along a rail: a soft highlight travelling along it. */
  | { kind: 'strip'; from: P; to: P; color: string; speed: number }
  /** Kernels popping behind the glass of a popcorn cart. */
  | { kind: 'popcorn'; glass: Quad; rate: number }
  /** Part of the drawing (a hanging lantern, a claw) sways by a pixel on a slow sine: [x0, y0, x1, y1]. */
  | { kind: 'regionSway'; rect: [number, number, number, number]; amp: number; period: number }
  /** The top of the drawing (leaves) stirs in a breeze from a nearby window. */
  | { kind: 'bandSway'; top: number; period: number }
  /**
   * A flag waving: the columns of the cloth ([x0, y0, x1, y1], the pole outside it) ride a wave travelling out
   * from the pole (at x `poleX`, the cloth `len` px long), each lifted or dropped a pixel, more towards the free
   * end. A cloth caught on something is given as several boxes of the one flag.
   */
  | { kind: 'flag'; rect: [number, number, number, number]; poleX: number; len: number; amp: number; period: number }
  /** Smoke puffing from a chimney pot's mouth. */
  | { kind: 'smoke'; at: P; every: number }
  /** Now and then part of the drawing hops or pecks by (dx, dy) for a beat (a bird on a bird bath, a crow). */
  | { kind: 'nod'; rect: [number, number, number, number]; dx: number; dy: number; every: number };

/** Wall things (painted into the room's wall): where they are is worked out per scene, see loadWalls. */
export type WallSpec =
  /** A countdown ring whose segments light one by one, and a dot flying along the trajectory arc. */
  | { kind: 'countdown'; ring: P; r: number; arc: [P, P, P] }
  /** Paper lanterns glowing softly, each on its own breath. */
  | { kind: 'lanterns'; at: P[]; r: number }
  /** A neon sign: a steady buzz, and now and then one letter dips for a couple of frames. */
  | { kind: 'neon'; letters: number }
  /** A clock on the wall showing the real time (its painted hands covered with the face's colour first). */
  | { kind: 'clock'; at: P; rx: number; ry: number; paper: string }
  /** Little lights on a wall piece winking on and off (status lights, stars, a call button). */
  | { kind: 'blink'; at: P[]; colors: string[]; slow?: boolean };

const ARCADE_SW: AnimSpec[] = [
  { kind: 'screen', quad: [[13, 25], [32, 31], [32, 48], [13, 43]] },
  { kind: 'blink', at: [[14, 50], [19, 52], [24, 54]], colors: ['#ff5b6e', '#5bd2ff', '#ffe66b'] },
  { kind: 'glow', at: [24, 9], r: 12, color: '255,150,230', speed: 1.1 },
];
const DESK_SW: AnimSpec[] = [
  { kind: 'code', quad: [[28, 4], [47, 11], [47, 29], [28, 22]], colors: ['#7ee0a8', '#8ab8ff', '#e0c07e'] },
  { kind: 'code', quad: [[53, 13], [77, 22], [77, 39], [53, 30]], colors: ['#8ab8ff', '#7ee0a8', '#ff9fd0'] },
];
const ARCADE_NE: AnimSpec[] = [];
const NEON_RIM: AnimSpec[] = [
  { kind: 'strip', from: [1, 18.5], to: [8, 23], color: '112,199,236', speed: 0.5 },
  { kind: 'strip', from: [8, 23.5], to: [29, 23.5], color: '112,199,236', speed: 0.5 },
  { kind: 'strip', from: [29, 23], to: [36, 18.5], color: '112,199,236', speed: 0.5 },
];

/** Specs by drawing file (sw/se drawings are the fronts; ne/nw the backs). */
const BY_FILE: Record<string, AnimSpec[]> = {
  'espresso.sw.png': [
    { kind: 'steam', at: [37, 30], every: 3.2 },
    { kind: 'brew', at: [[10, 31], [37, 30]] },
  ],
  'espresso.ne.png': [
    { kind: 'steam', at: [20, 6], every: 3.6 },
    { kind: 'brew', at: [[20, 6]] },
  ],
  // the four-rotation standard's new sides (docs/furniture.md): every drawing of an animated piece animates
  'espresso.se.png': [
    { kind: 'steam', at: [37, 23], every: 3.2 },
    { kind: 'brew', at: [[26, 31], [37, 23]] },
  ],
  'espresso.nw.png': [
    { kind: 'steam', at: [20, 5], every: 3.6 },
    { kind: 'brew', at: [[20, 5]] },
  ],
  // the house machine (the Design Lab's steampunk one): the dome's finial breathes steam, a puff at the spout
  'steampunk-coffee-machine.sw.png': [
    { kind: 'steam', at: [37, 1], every: 3.4 },
    { kind: 'brew', at: [[22, 60], [37, 1]] },
  ],
  'steampunk-coffee-machine.se.png': [
    { kind: 'steam', at: [27, 1], every: 3.4 },
    { kind: 'brew', at: [[44, 60], [27, 1]] },
  ],
  'steampunk-coffee-machine.ne.png': [
    { kind: 'steam', at: [32, 2], every: 3.8 },
    { kind: 'brew', at: [[32, 2]] },
  ],
  'steampunk-coffee-machine.nw.png': [
    { kind: 'steam', at: [30, 2], every: 3.8 },
    { kind: 'brew', at: [[30, 2]] },
  ],
  'heirloom-aquarium.sw.png': [
    { kind: 'shimmer', glass: [[10, 19], [64, 34], [64, 60], [10, 45]] },
    { kind: 'fish', glass: [[10, 19], [64, 34], [64, 60], [10, 45]], n: 3 },
    { kind: 'bubbles', glass: [[10, 19], [64, 34], [64, 60], [10, 45]], every: 0.9 },
  ],
  'heirloom-aquarium.ne.png': [
    { kind: 'shimmer', glass: [[10, 23], [66, 39], [66, 66], [10, 51]] },
    { kind: 'fish', glass: [[10, 23], [66, 39], [66, 66], [10, 51]], n: 3 },
    { kind: 'bubbles', glass: [[10, 23], [66, 39], [66, 66], [10, 51]], every: 0.9 },
  ],
  'fireplace.sw.png': [{ kind: 'flames', at: [30, 60], spread: 7, rate: 10 }],
  // town meadows: the campfire crackles, the garden lanterns breathe
  'fire-ring.png': [{ kind: 'flames', at: [34, 27], spread: 8, rate: 9 }],
  'garden-lantern.png': [{ kind: 'glow', at: [13, 17], r: 7, color: '255,200,130', speed: 0.8 }],
  'heirloom-dragonlamp.se.png': [{ kind: 'glow', at: [40, 37], r: 9, color: '255,214,140', speed: 1.3 }],
  'heirloom-dragonlamp.nw.png': [{ kind: 'glow', at: [10, 27], r: 9, color: '255,214,140', speed: 1.3 }],
  'heirloom-dragonlamp.sw.png': [{ kind: 'glow', at: [17, 39], r: 9, color: '255,214,140', speed: 1.3 }],
  'heirloom-dragonlamp.ne.png': [{ kind: 'glow', at: [29, 22], r: 8, color: '255,214,140', speed: 1.3 }],
  'server-rack.sw.png': [
    { kind: 'blink', at: [[6, 31], [6, 37], [6, 44], [7, 51], [7, 57], [7, 62], [7, 67], [19, 78], [20, 84]], colors: ['#6bff8e', '#6bff8e', '#ffb347'] },
  ],
  'server-rack.ne.png': [{ kind: 'blink', at: [[33, 42], [33, 47], [33, 53], [34, 58], [34, 63]], colors: ['#6bff8e', '#ffb347'] }],
  'jukebox.sw.png': [
    { kind: 'glow', at: [19, 26], r: 12, color: '255,110,210', speed: 0.8, cycle: ['255,110,210', '110,220,255', '180,130,255'] },
    { kind: 'notes', at: [19, 4], every: 2.4 },
  ],
  'jukebox.ne.png': [{ kind: 'glow', at: [46, 30], r: 8, color: '255,110,210', speed: 0.8, cycle: ['255,110,210', '110,220,255', '180,130,255'] }],
  'clock-grand.se.png': [
    { kind: 'pendulum', pivot: [22, 52], len: 31, bob: 3, clear: [[17, 52], [27, 52], [27, 90], [17, 90]], amp: 0.14 },
    { kind: 'clockface', at: [24, 34], rx: 3.5, ry: 5, paper: 'rgb(237,214,181)' },
  ],
  'desk.sw.png': DESK_SW,
  'desk.light.sw.png': DESK_SW,
  'desk.wood.sw.png': DESK_SW,
  'cake-table.sw.png': [{ kind: 'candles', at: [[21, 2], [24, 1], [27, 2]] }],
  'cake-table.ne.png': [{ kind: 'candles', at: [[19, 3], [24, 2], [27, 3]] }],
  'balloons.se.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.nw.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.b.se.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.b.nw.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.c.se.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'balloons.c.nw.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'balloons.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.b.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.c.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'heirloom-bell.png': [{ kind: 'ring', at: [22, 26] }],
  'air-hockey.sw.png': [
    { kind: 'strip', from: [9, 26], to: [48, 48], color: '90,230,255', speed: 0.35 },
    { kind: 'strip', from: [86, 41], to: [70, 50], color: '90,230,255', speed: 0.5 },
    { kind: 'strip', from: [40, 4], to: [58, 13], color: '255,110,210', speed: 0.45 },
    { kind: 'strip', from: [63, 15], to: [86, 26], color: '255,110,210', speed: 0.4 },
  ],
  'air-hockey.ne.png': [
    { kind: 'strip', from: [10, 28], to: [49, 48], color: '90,230,255', speed: 0.35 },
    { kind: 'strip', from: [87, 44], to: [70, 53], color: '90,230,255', speed: 0.5 },
    { kind: 'strip', from: [43, 5], to: [62, 14], color: '255,110,210', speed: 0.45 },
    { kind: 'strip', from: [66, 18], to: [88, 29], color: '255,110,210', speed: 0.4 },
  ],
  'popcorn-cart.se.png': [
    { kind: 'popcorn', glass: [[8, 12], [33, 10], [33, 32], [8, 34]], rate: 5 },
    { kind: 'glow', at: [20, 22], r: 12, color: '255,220,140', speed: 0.9 },
  ],
  'popcorn-cart.ne.png': [
    { kind: 'popcorn', glass: [[9, 17], [37, 16], [37, 30], [9, 33]], rate: 5 },
    { kind: 'glow', at: [22, 24], r: 12, color: '255,220,140', speed: 0.9 },
  ],
  'vending-machine.sw.png': [
    { kind: 'glow', at: [15, 38], r: 18, color: '130,165,255', speed: 0.5 },
    { kind: 'blink', at: [[31, 70]], colors: ['#ff8ad8'] },
  ],
  'vending-machine.se.png': [
    { kind: 'glow', at: [27, 44], r: 18, color: '130,165,255', speed: 0.5 },
    { kind: 'blink', at: [[44, 60]], colors: ['#ff8ad8'] },
  ],
  'lantern-floor.se.png': [
    { kind: 'regionSway', rect: [7, 6, 30, 40], amp: 1, period: 5.5 },
    { kind: 'glow', at: [18, 15], r: 12, color: '255,190,140', speed: 0.7 },
  ],
  'lantern-floor.sw.png': [
    { kind: 'regionSway', rect: [0, 11, 22, 42], amp: 1, period: 5.5 },
    { kind: 'glow', at: [10, 21], r: 12, color: '255,190,140', speed: 0.7 },
  ],
  'lantern-floor.ne.png': [
    { kind: 'regionSway', rect: [3, 5, 22, 32], amp: 1, period: 5.5 },
    { kind: 'glow', at: [12, 13], r: 10, color: '255,190,140', speed: 0.7 },
  ],
  'lantern-floor.nw.png': [
    { kind: 'regionSway', rect: [0, 6, 21, 36], amp: 1, period: 5.5 },
    { kind: 'glow', at: [10, 15], r: 12, color: '255,190,140', speed: 0.7 },
  ],
  'claw-machine.sw.png': [
    { kind: 'chase', from: [7, 12], to: [44, 13], n: 9, colors: ['#ffe66b', '#ff6bd5'] },
    { kind: 'regionSway', rect: [18, 24, 30, 38], amp: 1, period: 3.2 },
  ],
  'claw-machine.ne.png': [{ kind: 'chase', from: [3, 11], to: [40, 11], n: 9, colors: ['#ffe66b', '#ff6bd5'] }],
  'arcade-cabinet.sw.png': ARCADE_SW,
  'arcade-cabinet.ne.png': ARCADE_NE,

  // the town's props (docs/ambient-life.md). Boxes are [x0, y0, x1, y1) in the drawing's pixels.
  // the rowboats ride the lake's swell
  'boat.red.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'boat.yellow.png': [{ kind: 'bob', amp: 1, period: 3.9 }],
  // the cattails and the left iris stir; the stems in the mud stay
  'reeds.png': [{ kind: 'bandSway', top: 0.4, period: 4.5 }],
  // the brown bird on the rim dips its beak to drink now and then (its water moves: waterworks.ts)
  'birdbath.png': [{ kind: 'nod', rect: [32, 0, 42, 6], dx: 0, dy: 1, every: 4 }],
  // the café umbrellas' canopies lift in the breeze over their poles
  'umbrella-table.red.png': [{ kind: 'regionSway', rect: [0, 0, 112, 72], amp: 1, period: 6 }],
  'umbrella-table.teal.png': [{ kind: 'regionSway', rect: [0, 0, 112, 72], amp: 1, period: 6.6 }],
  // the crow on the scarecrow's arm hops now and then (it's drawn diagonally between hat, coat and straw, so
  // it's lifted in the strips it's clear in, all together)
  'scarecrow.se.png': [
    [41, 8, 52, 14],
    [38, 14, 48, 19],
    [36, 19, 45, 20],
    [36, 20, 44, 21],
    [36, 21, 38, 22],
  ].map((rect): AnimSpec => ({ kind: 'nod', rect: rect as [number, number, number, number], dx: 0, dy: -1, every: 7 })),
  'scarecrow.nw.png': [
    [41, 6, 53, 14],
    [42, 14, 54, 18],
    [46, 18, 55, 19],
    [48, 19, 55, 20],
    [50, 20, 56, 21],
    [51, 21, 56, 23],
    [52, 23, 56, 24],
    [53, 24, 56, 25],
    [54, 25, 56, 26],
  ].map((rect): AnimSpec => ({ kind: 'nod', rect: rect as [number, number, number, number], dx: 0, dy: -1, every: 7 })),
  // the town's buildings (docs/ambient-life.md)
  // HQ: the flag on the roof waves (its cloth in two boxes round the pole's collar), the facade clock keeps the
  // world's time, the portico lantern glows from dusk
  'building.hq.png': [
    { kind: 'flag', rect: [291, 21, 347, 93], poleX: 290, len: 102, amp: 1, period: 1.6 },
    { kind: 'flag', rect: [347, 21, 393, 109], poleX: 290, len: 102, amp: 1, period: 1.6 },
    { kind: 'clockface', at: [194.5, 302.5], rx: 14, ry: 17, paper: 'rgb(251,245,219)' },
    { kind: 'glow', at: [192, 563], r: 8, color: '255,214,140', speed: 1, dusk: true },
  ],
  // the arcade: its marquee bulbs chase round the arch and along the canopy, the neon hums, the parapet's tubes
  // carry light, the pennant on the star pole flutters, the wall lanterns glow from dusk
  'building.arcade.png': [
    { kind: 'marquee', at: [[55.5, 161.5], [66.5, 165.5], [77.5, 166.5], [85.5, 155.5], [98.5, 157.5], [109.5, 159.5], [110.5, 147.5], [114.5, 138.5], [122.5, 132.5], [133.5, 130.5], [145.5, 131.5], [156.5, 137.5], [166.5, 145.5], [173.5, 157.5], [178.5, 167.5], [179.5, 178.5], [178.5, 188.5], [190.5, 190.5], [202.5, 195.5], [212.5, 207.5], [219.5, 221.5], [228.5, 232.5], [240.5, 238.5], [246.5, 252.5], [246.5, 264.5], [246.5, 277.5], [245.5, 290.5], [232.5, 284.5], [220.5, 278.5], [208.5, 273.5], [195.5, 267.5], [183.5, 262.5], [171.5, 257.5], [160.5, 251.5], [148.5, 246.5], [137.5, 241.5], [125.5, 236.5], [114.5, 231.5], [102.5, 226.5], [91.5, 220.5], [79.5, 215.5], [68.5, 210.5], [56.5, 205.5], [44.5, 200.5], [44.5, 188.5], [44.5, 176.5], [44.5, 164.5]], r: 2, off: '#8e98a0', rate: 5 },
    { kind: 'marquee', at: [[23.5, 234.5], [35.5, 241.5], [54.5, 244.5], [64.5, 244.5], [64.5, 250.5], [80.5, 251.5], [83.5, 260.5], [97.5, 260.5], [102.5, 269.5], [117.5, 268.5], [122.5, 278.5], [138.5, 278.5], [143.5, 288.5], [160.5, 288.5], [165.5, 298.5], [180.5, 298.5], [185.5, 308.5], [201.5, 307.5], [206.5, 318.5], [233.5, 332.5], [242.5, 337.5], [252.5, 343.5]], r: 2, off: '#8e98a0', rate: 5 },
    { kind: 'glow', at: [248, 324], r: 16, color: '238,73,165', speed: 1.2 },
    { kind: 'glow', at: [365, 247], r: 20, color: '238,73,165', speed: 0.9 },
    { kind: 'strip', from: [293, 273], to: [437, 211], color: '255,150,215', speed: 0.35 },
    { kind: 'strip', from: [293, 282], to: [437, 220], color: '153,229,240', speed: 0.3 },
    { kind: 'glow', at: [78, 304], r: 10, color: '255,214,120', speed: 1, dusk: true },
    { kind: 'glow', at: [222, 366], r: 10, color: '255,214,120', speed: 1.1, dusk: true },
    { kind: 'flag', rect: [219, 46, 253, 83], poleX: 212, len: 41, amp: 1, period: 1.4 },
  ],
  // Lantern Hall: its seventeen paper lanterns under the eaves breathe, each on its own beat, and glow from dusk
  'building.events.png': [
    { kind: 'glow', at: [16, 194], r: 12, color: '255,110,70', speed: 0.80, dusk: true },
    { kind: 'glow', at: [44, 213], r: 12, color: '255,200,90', speed: 0.92, dusk: true },
    { kind: 'glow', at: [77, 225], r: 12, color: '130,220,210', speed: 1.04, dusk: true },
    { kind: 'glow', at: [122, 201], r: 12, color: '255,200,90', speed: 1.16, dusk: true },
    { kind: 'glow', at: [158, 196], r: 13, color: '255,150,180', speed: 1.28, dusk: true },
    { kind: 'glow', at: [206, 153], r: 8, color: '150,195,245', speed: 0.80, dusk: true },
    { kind: 'glow', at: [256, 243], r: 13, color: '130,220,210', speed: 0.92, dusk: true },
    { kind: 'glow', at: [278, 276], r: 13, color: '255,110,70', speed: 1.04, dusk: true },
    { kind: 'glow', at: [304, 310], r: 12, color: '255,200,90', speed: 1.16, dusk: true },
    { kind: 'glow', at: [334, 342], r: 13, color: '255,110,70', speed: 1.28, dusk: true },
    { kind: 'glow', at: [366, 364], r: 12, color: '130,220,210', speed: 0.80, dusk: true },
    { kind: 'glow', at: [396, 360], r: 13, color: '255,200,90', speed: 0.92, dusk: true },
    { kind: 'glow', at: [434, 349], r: 11, color: '255,200,90', speed: 1.04, dusk: true },
    { kind: 'glow', at: [472, 329], r: 12, color: '255,150,180', speed: 1.16, dusk: true },
    { kind: 'glow', at: [505, 309], r: 12, color: '130,220,210', speed: 1.28, dusk: true },
    { kind: 'glow', at: [549, 288], r: 11, color: '255,200,90', speed: 0.80, dusk: true },
    { kind: 'glow', at: [582, 264], r: 12, color: '255,110,70', speed: 0.92, dusk: true },
  ],
  // the café: the little glass lanterns under its eaves and its two wall sconces
  'building.cafe.png': [
    { kind: 'glow', at: [74.5, 161.5], r: 6, color: '255,214,150', speed: 0.80, dusk: true },
    { kind: 'glow', at: [110.5, 134.5], r: 6, color: '255,214,150', speed: 0.95, dusk: true },
    { kind: 'glow', at: [151.5, 109.5], r: 6, color: '255,214,150', speed: 1.10, dusk: true },
    { kind: 'glow', at: [219.5, 198.5], r: 6, color: '255,214,150', speed: 1.25, dusk: true },
    { kind: 'glow', at: [250.5, 240.5], r: 6, color: '255,214,150', speed: 0.80, dusk: true },
    { kind: 'glow', at: [319.5, 280.5], r: 6, color: '255,214,150', speed: 0.95, dusk: true },
    { kind: 'glow', at: [360.5, 263.5], r: 6, color: '255,214,150', speed: 1.10, dusk: true },
    { kind: 'glow', at: [400.5, 247.5], r: 6, color: '255,214,150', speed: 1.25, dusk: true },
    { kind: 'glow', at: [444.5, 231.5], r: 6, color: '255,214,150', speed: 0.80, dusk: true },
    { kind: 'glow', at: [116, 323], r: 7, color: '255,214,140', speed: 0.9, dusk: true },
    { kind: 'glow', at: [182, 351], r: 7, color: '255,214,140', speed: 1.05, dusk: true },
  ],
  // the Quiet Grove: the porch lantern and the one by the door
  'building.focus.png': [
    { kind: 'glow', at: [411, 276], r: 9, color: '255,210,140', speed: 0.8, dusk: true },
    { kind: 'glow', at: [263, 329], r: 8, color: '255,210,140', speed: 0.95, dusk: true },
  ],
  // the Design Loft's chimney smokes like the others (its drawing marks no emitter)
  'building.design.png': [{ kind: 'smoke', at: [78.5, 57], every: 0.45 }],
  // the lighthouse's weathervane turns a little in the wind (its beam: effects.ts)
  'lighthouse.png': [{ kind: 'regionSway', rect: [30, 0, 48, 11], amp: 1, period: 4 }],
  // the bandstand's string bulbs twinkle
  'gazebo.png': [{ kind: 'blink', at: [[5.5, 111.5], [31.5, 130.5], [70.5, 137.5], [95.5, 140.5], [121.5, 138.5], [160.5, 130.5], [186.5, 111.5]], colors: ['#fff4c0', '#f8d973'] }],

  // rooms (docs/ambient-life.md)
  // Lantern Hall's cocktail tables: the candle in each hurricane glass
  'cocktail-table.se.png': [{ kind: 'candles', at: [[20.5, 15]] }],
  'cocktail-table.nw.png': [{ kind: 'candles', at: [[20.5, 15]] }],
  // the arcade's prize counter: the ticket display and the lit glass edges (from behind, its neon rails)
  'prize-counter.sw.png': [
    { kind: 'screen', quad: [[23, 10], [31, 13], [31, 16], [23, 13]] },
    { kind: 'strip', from: [8, 22], to: [69, 49], color: '137,217,246', speed: 0.35 },
    { kind: 'strip', from: [6, 54], to: [69, 82], color: '137,217,246', speed: 0.45 },
  ],
  'prize-counter.ne.png': [
    { kind: 'strip', from: [6, 12], to: [68, 41], color: '255,110,200', speed: 0.35 },
    { kind: 'strip', from: [6, 46], to: [68, 75], color: '255,110,200', speed: 0.45 },
  ],
  // the arcade's high table: light running round its neon rim
  'table-high.neon.se.png': NEON_RIM,
  'table-high.neon.nw.png': NEON_RIM,
  // the Launch Lab workbench: the 3D printer's head works back and forth, the soldering iron smokes a little
  'workbench.sw.png': [
    { kind: 'regionSway', rect: [19, 16, 26, 21], amp: 1, period: 3 },
    { kind: 'steam', at: [58.5, 33], every: 4 },
  ],
  'workbench.ne.png': [{ kind: 'steam', at: [43.5, 20], every: 4 }],
  // the water cooler: now and then a bubble rises through the jug
  'water-cooler.sw.png': [{ kind: 'bubbles', glass: [[5, 10], [25, 10], [25, 28], [5, 28]], every: 6 }],
  'water-cooler.se.png': [{ kind: 'bubbles', glass: [[5, 10], [26, 10], [26, 27], [5, 27]], every: 6 }],
  'water-cooler.nw.png': [{ kind: 'bubbles', glass: [[6, 10], [27, 10], [27, 27], [6, 27]], every: 6 }],
  'water-cooler.ne.png': [{ kind: 'bubbles', glass: [[5, 10], [27, 10], [27, 27], [5, 27]], every: 6 }],
  // HQ's time capsule: a soft light behind its porthole
  'time-capsule.png': [{ kind: 'glow', at: [17.5, 30], r: 9, color: '150,200,255', speed: 0.7 }],
  'time-capsule.ne.png': [{ kind: 'glow', at: [24.5, 33.5], r: 6, color: '150,200,255', speed: 0.7 }],
  // the Quiet Grove's side tables: the tea steams
  'side-table.walnut.se.png': [{ kind: 'steam', at: [15.5, 27], every: 3.6 }],
  'side-table.walnut.nw.png': [{ kind: 'steam', at: [15.5, 27], every: 3.6 }],
  // the model rocket: its porthole lit, the stars on its space-window decal twinkling (both ride it on liftoff)
  'rocket-model.se.png': [
    { kind: 'glow', at: [23.5, 32], r: 4, color: '150,190,255', speed: 0.6 },
    { kind: 'blink', at: [[16.5, 45.5], [13.5, 47.5], [14.5, 49.5]], colors: ['#eef2ff'] },
  ],
  'rocket-model.nw.png': [{ kind: 'glow', at: [20.5, 53], r: 4, color: '150,190,255', speed: 0.6 }],
};
for (const c of ['cyan', 'gold', 'lime', 'orange', 'pink']) {
  BY_FILE[`arcade-cabinet.${c}.sw.png`] = ARCADE_SW;
  BY_FILE[`arcade-cabinet.${c}.ne.png`] = ARCADE_NE;
}

/** Whether a drawing has life of its own: idle animations, or water that moves on it (waterworks.ts). */
export function hasAnimation(file: string | undefined): boolean {
  return !!file && (!!BY_FILE[file]?.length || !!WATERWORKS[file]);
}

interface Fish {
  u: number;
  v: number;
  dir: number;
  speed: number;
  phase: number;
  color: string;
  patch: string;
}

interface Live {
  obj: SceneObject;
  sprite: Sprite;
  dx: number;
  dy: number;
  specs: AnimSpec[];
  /** Drawing px → world px. */
  at: (p: P) => [number, number];
  clock: number[];
  fish: Fish[];
  seed: number;
  /** Colour sampled from the drawing, for pendulum windows. */
  fill?: string;
  /** When it was last rung (this.t seconds). */
  rungAt?: number;
  /** Popcorn in the air (drawing px). */
  kernels: Array<{ x: number; y: number; vx: number; vy: number; floor: number }>;
  /** The drawing's opaque bounds (canvas px). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** When each kind of moment last happened here (this.t), and what it said (a score, a song). */
  moments: Partial<Record<MomentKind, { at: number; detail?: string }>>;
  /** A pool or air-hockey table's game, played on its own drawing (tabletop.ts). */
  table?: TableGame;
  /** Water that moves on its drawing: a fountain's streams, pools and lily pads (waterworks.ts). */
  water?: Waterworks;
  /** Where its moments happen on the drawing (MOMENT_SPOTS). */
  spot?: Spots;
  /** The drawing darkened (a server rack switched off), made when first needed. */
  dark?: HTMLCanvasElement;
  /** Things to do a little later in a moment (the splash after the coin, the sparkle when the globe stops). */
  pending: Array<{ at: number; fn: () => void }>;
}

const KOI: Array<[string, string]> = [
  ['#ff7a2f', '#fff4e6'],
  ['#fff4e6', '#ff5a36'],
  ['#ffb03b', '#2a1f2d'],
];

export class ObjectAnimations {
  private live = new Map<string, Live>();
  private t = 0;

  constructor(
    private readonly effects: Effects,
    private readonly isOn: (id: string) => boolean,
  ) {}

  /** Pick up every object in the scene that has something to do. */
  load(statics: Array<{ obj: SceneObject; sprite: Sprite; dx: number; dy: number }>, scene?: SceneDef) {
    this.live.clear();
    for (const st of statics) {
      let specs = st.sprite.file ? BY_FILE[st.sprite.file] : undefined;
      // a potted plant by a window stirs in the breeze coming in
      if (scene && st.obj.sprite === 'plant' && nearWindow(scene, st.obj)) specs = [...(specs ?? []), { kind: 'bandSway', top: 0.42, period: 4.5 }];
      const usable = !!st.obj.actions?.some((a) => a.kind === 'use' || a.kind === 'note') || (!!st.sprite.file && !!MOMENT_SPOTS[st.sprite.file]);
      const water = st.sprite.file ? WATERWORKS[st.sprite.file] : undefined;
      if (!specs?.length && !usable && !water) continue;
      specs ??= [];
      const k = st.sprite.scale ?? 1;
      const w = st.sprite.canvas.width;
      const at = (p: P): [number, number] => [st.dx + (st.sprite.mirrored ? w - p[0] : p[0]) / k, st.dy + p[1] / k];
      const seed = (st.obj.x * 31 + st.obj.y * 17) % 97;
      const live: Live = {
        obj: st.obj,
        sprite: st.sprite,
        dx: st.dx,
        dy: st.dy,
        specs,
        at,
        clock: specs.map((_, i) => (seed * 0.37 + i) % 3),
        fish: [],
        seed,
        kernels: [],
        box: maskBox(st.sprite),
        moments: {},
        pending: [],
      };
      const table = st.sprite.file ? TABLES[st.sprite.file] : undefined;
      if (table) live.table = new TableGame(st.sprite, table, this.effects);
      if (water) live.water = waterOf(st.sprite, st.obj.id, water);
      live.spot = st.sprite.file ? MOMENT_SPOTS[st.sprite.file] : undefined;
      for (const s of specs) {
        if (s.kind === 'fish')
          for (let i = 0; i < s.n; i++) {
            const [color, patch] = KOI[(seed + i) % KOI.length];
            live.fish.push({ u: 0.15 + ((seed * 7 + i * 29) % 70) / 100, v: 0.3 + ((i * 23 + seed) % 45) / 100, dir: i % 2 ? 1 : -1, speed: 0.05 + (i % 3) * 0.018, phase: i * 1.7, color, patch });
          }
        if (s.kind === 'pendulum') live.fill = sampleColor(st.sprite, s.clear);
      }
      this.live.set(st.obj.id, live);
    }
  }

  /**
   * A one-off moment on an object: 'brew' (an espresso machine pulling a shot), 'ring' (the bell), or a thing
   * being used (uses.ts: the jukebox, the claw, a plant being watered…).
   */
  trigger(objectId: string, what: MomentKind, detail?: string) {
    const l = this.live.get(objectId);
    if (!l) return;
    l.moments[what] = { at: this.t, detail };
    if (what === 'ring') {
      l.rungAt = this.t;
      return;
    }
    if (what !== 'brew') {
      this.startUse(l, what);
      return;
    }
    // a cup filled at the cooler: the jug glugs
    const jug = l.spot?.jug;
    if (jug) {
      const [x, y] = l.at(jug);
      for (let i = 0; i < 7; i++)
        this.later(l, i * 0.14, () =>
          this.effects.add({ x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 2, vy: -9 - Math.random() * 4, max: 1.1, size: 0.9 + Math.random() * 0.6, color: 'rgba(225,245,255,0.9)', gravity: 0, kind: 'circle' }),
        );
    }
    for (const s of l.specs) {
      // a scoop from the popcorn cart: a flurry of kernels
      if (s.kind === 'popcorn')
        for (let i = 0; i < 10; i++) {
          const u = 0.15 + Math.random() * 0.7;
          const [x, y] = lerp2(lerp2(s.glass[3], s.glass[2], u), lerp2(s.glass[0], s.glass[1], u), 0.35);
          l.kernels.push({ x, y, vx: (Math.random() - 0.5) * 18, vy: -30 - Math.random() * 20, floor: y });
        }
      if (s.kind !== 'brew' || what !== 'brew') continue;
      for (const p of s.at) {
        const [x, y] = l.at(p);
        for (let i = 0; i < 14; i++)
          this.effects.add({ x: x + (Math.random() - 0.5) * 3, y: y - Math.random() * 2, vx: (Math.random() - 0.5) * 7, vy: -9 - Math.random() * 9, max: 1.4 + Math.random() * 0.9, size: 1.4 + Math.random() * 1.2, color: 'rgba(255,255,255,0.7)', gravity: -2 });
      }
    }
  }

  /** The light the world is in (WorldView, every frame): sunlight for glints on water, the lamps at night. */
  private light: { sun: number; lamps: WaterLight[] } = { sun: 1, lamps: [] };

  setLight(sun: number, lamps: WaterLight[]) {
    this.light = { sun, lamps };
  }

  update(dt: number, reducedMotion: boolean) {
    this.t += dt;
    if (reducedMotion) return;
    for (const l of this.live.values()) {
      const on = this.isOn(l.obj.id);
      this.updateUse(l, dt);
      l.water?.update(dt, this.light.sun, this.effects.night);
      l.specs.forEach((s, i) => {
        l.clock[i] += dt;
        if (s.kind === 'steam' && l.clock[i] > s.every) {
          l.clock[i] = -Math.random() * s.every * 0.5;
          const [x, y] = l.at(s.at);
          for (let k = 0; k < 3; k++)
            this.effects.add({ x: x + (Math.random() - 0.5) * 1.5, y: y - k * 1.2, vx: (Math.random() - 0.5) * 2, vy: -5 - Math.random() * 3, max: 1.6 + Math.random() * 0.6, size: 1 + Math.random() * 0.6, color: 'rgba(255,255,255,0.45)', gravity: -0.5 });
        }
        // chimney smoke: a soft puff now and then, drifting up and off with the breeze (as effects.ts's chimneys)
        if (s.kind === 'smoke' && l.clock[i] > s.every) {
          l.clock[i] = -Math.random() * s.every * 0.3;
          const [x, y] = l.at(s.at);
          this.effects.add({ x, y, vx: 4 + Math.random() * 4, vy: -8 - Math.random() * 4, max: 3.5, size: 3 + Math.random() * 2, color: 'rgba(240,236,230,0.55)', gravity: -1 });
        }
        if (s.kind === 'flames' && on) {
          l.clock[i] += dt * s.rate;
          while (l.clock[i] > 1) {
            l.clock[i] -= 1;
            const [x, y] = l.at(s.at);
            this.effects.add({ x: x + (Math.random() - 0.5) * s.spread, y, vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 6, max: 0.55 + Math.random() * 0.3, size: 1, color: Math.random() > 0.5 ? '#ffb347' : '#ffd23f', gravity: -4, kind: 'square' });
          }
        }
        if (s.kind === 'bubbles' && l.clock[i] > s.every) {
          l.clock[i] = -Math.random() * s.every;
          const g = s.glass;
          const u = 0.15 + Math.random() * 0.7;
          const bottom = lerp2(lerp2(g[3], g[2], u), lerp2(g[0], g[1], u), 0.08);
          const top = lerp2(lerp2(g[3], g[2], u), lerp2(g[0], g[1], u), 0.9);
          const [x, y] = l.at(bottom);
          const [, ty] = l.at(top);
          const rise = (y - ty) / 2.2;
          this.effects.add({ x, y, vx: 0, vy: -rise, max: 2.1, size: 0.6, color: 'rgba(225,245,255,0.8)', gravity: 0 });
        }
        if (s.kind === 'notes' && on && l.clock[i] > s.every) {
          l.clock[i] = -Math.random();
          const [x, y] = l.at(s.at);
          this.effects.add({ x, y, vx: (Math.random() - 0.3) * 4, vy: -7, max: 2.2, size: 2, color: Math.random() > 0.5 ? '#ff8ad8' : '#8ae2ff', gravity: 0, kind: 'note' });
        }
      });
      for (const s of l.specs) {
        if (s.kind !== 'popcorn' || !on) continue;
        if (Math.random() < s.rate * dt) {
          const u = 0.15 + Math.random() * 0.7;
          const [x, y] = lerp2(lerp2(s.glass[3], s.glass[2], u), lerp2(s.glass[0], s.glass[1], u), 0.35);
          l.kernels.push({ x, y, vx: (Math.random() - 0.5) * 14, vy: -26 - Math.random() * 18, floor: y });
        }
      }
      for (const k of l.kernels) {
        k.vy += 90 * dt;
        k.x += k.vx * dt;
        k.y += k.vy * dt;
      }
      l.kernels = l.kernels.filter((k) => k.y <= k.floor || k.vy < 0);
      for (const f of l.fish) {
        f.u += f.dir * f.speed * dt;
        if (f.u > 0.88 || f.u < 0.12) {
          f.dir = -f.dir;
          f.u = Math.max(0.12, Math.min(0.88, f.u));
        }
        f.v += Math.sin(this.t * 0.7 + f.phase) * 0.02 * dt;
        // fed: they come up to the surface for the flakes
        if (this.age(l, 'feed') < 6) f.v += (0.22 - f.v) * Math.min(1, dt * 1.6);
        f.v = Math.max(0.2, Math.min(0.8, f.v));
      }
    }
  }

  /**
   * Draw an object's drawing itself when part of it moves (a swaying lantern, a claw, leaves by a window):
   * the still parts are drawn as they are and the moving part shifted by whole pixels. Returns false when
   * the object has nothing like that, so the caller draws it normally.
   */
  drawSprite(c: CanvasRenderingContext2D, objectId: string, x: number, y: number, reducedMotion: boolean): boolean {
    const l = this.live.get(objectId);
    if (!l || reducedMotion) return false;
    const sp = l.sprite;
    const k = sp.scale ?? 1;
    const W = sp.canvas.width;
    const H = sp.canvas.height;
    const x0 = x - sp.ax / k;
    const y0 = y - sp.ay / k;
    const part = (sx: number, sy: number, sw: number, sh: number, dx = 0, dy = 0) => {
      if (sw > 0 && sh > 0) c.drawImage(sp.canvas, sx, sy, sw, sh, x0 + (sx + dx) / k, y0 + (sy + dy) / k, sw / k, sh / k);
    };
    // a game on the table: the pieces lifted off it (drawn over it in drawFor)
    if (l.table?.drawBase(c, x0, y0, this.t)) return true;
    // switched off: the whole rack goes dark for a moment
    if (this.age(l, 'reboot') < 0.6) {
      c.drawImage(sp.canvas, x0, y0, W / k, H / k);
      c.drawImage(darkOf(l), x0, y0, W / k, H / k);
      return true;
    }
    // the model rocket lifts off its pad (the flame between them is drawn in drawFor) and settles back
    const cut = l.spot?.liftoff?.cut;
    const h = this.hop(l);
    if (cut !== undefined && h > 0) {
      part(0, cut, W, H - cut);
      part(0, 0, W, cut, 0, -h * k);
      return true;
    }
    // watered: the leaves shiver for a moment
    const wa = this.age(l, 'water');
    if (wa < 1.2) {
      const d = Math.floor(wa * 10) % 2 ? 1 : -1;
      const cut = Math.round(l.box.y0 + (l.box.y1 - l.box.y0) * 0.45);
      part(0, 0, W, cut, d);
      part(0, cut, W, H - cut);
      return true;
    }
    for (const s of l.specs) {
      // the claw: down into the prizes, a pause to grab, back up
      const cl = this.age(l, 'claw');
      if (s.kind === 'regionSway' && cl < 1.9) {
        const drop = cl < 0.8 ? cl / 0.8 : cl < 1.1 ? 1 : 1 - (cl - 1.1) / 0.8;
        const [ax0, ry0, ax1, ry1] = s.rect;
        const [rx0, rx1] = sp.mirrored ? [W - ax1, W - ax0] : [ax0, ax1];
        part(0, 0, W, ry0);
        part(0, ry0, rx0, ry1 - ry0);
        part(rx1, ry0, W - rx1, ry1 - ry0);
        part(0, ry1, W, H - ry1);
        const dy = Math.round(drop * 8);
        // the gap the claw leaves: its top row (the cable, the glass behind) stretched down to it
        if (dy > 0) c.drawImage(sp.canvas, rx0, ry0, rx1 - rx0, 1, x0 + rx0 / k, y0 + ry0 / k, (rx1 - rx0) / k, (dy + 1) / k);
        part(rx0, ry0, rx1 - rx0, ry1 - ry0, 0, dy);
        return true;
      }
      if (s.kind === 'bandSway') {
        const v = Math.sin((this.t / s.period) * Math.PI * 2 + l.seed) + 0.4 * Math.sin(this.t * 1.7 + l.seed * 2);
        const d = v > 0.8 ? 1 : v < -0.8 ? -1 : 0;
        if (!d) continue;
        const cut = Math.round(H * s.top);
        part(0, 0, W, cut, d);
        part(0, cut, W, H - cut);
        return true;
      }
    }
    // the parts that move now (a swaying sign, a waving flag's columns, a pecking bird), in canvas px; the rest
    // of the drawing is drawn around them as it is, and each moved part over it
    const moves = this.moves(l);
    if (!moves.length) return false;
    const holes = moves.map((m) => m.r);
    const ys = [...new Set([0, H, ...holes.flatMap((r) => [r[1], r[3]])])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ys.length; i++) {
      const [ya, yb] = [ys[i], ys[i + 1]];
      const cuts = holes.filter((r) => r[1] <= ya && r[3] >= yb).sort((a, b) => a[0] - b[0]);
      let xa = 0;
      for (const r of cuts) {
        part(xa, ya, r[0] - xa, yb - ya);
        xa = Math.max(xa, r[2]);
      }
      part(xa, ya, W - xa, yb - ya);
    }
    for (const m of moves) {
      const [rx0, ry0, rx1, ry1] = m.r;
      // what a moved part uncovers is filled from just beside it (the wall or sky it hangs against), so no
      // see-through slit opens behind it
      if (m.dx > 0 && rx0 > 0) for (let i = 0; i < m.dx; i++) part(rx0 - 1, ry0, 1, ry1 - ry0, i + 1);
      if (m.dx < 0 && rx1 < W) for (let i = 0; i < -m.dx; i++) part(rx1, ry0, 1, ry1 - ry0, -i - 1);
      if (m.dy > 0 && ry0 > 0) for (let i = 0; i < m.dy; i++) part(rx0, ry0 - 1, rx1 - rx0, 1, 0, i + 1);
      if (m.dy < 0 && ry1 < H) for (let i = 0; i < -m.dy; i++) part(rx0, ry1, rx1 - rx0, 1, 0, -i - 1);
      part(rx0, ry0, rx1 - rx0, ry1 - ry0, m.dx, m.dy);
    }
    return true;
  }

  /**
   * Where an object's moving parts are this frame: boxes of its canvas (x0, y0, x1, y1, half-open, mirrored with
   * the drawing) and how far each is shifted, only those shifted at all. A flag is a box per run of columns.
   */
  private moves(l: Live): Array<{ r: [number, number, number, number]; dx: number; dy: number }> {
    const sp = l.sprite;
    const W = sp.canvas.width;
    const flip = sp.mirrored ? -1 : 1;
    const box = (r: [number, number, number, number]): [number, number, number, number] => (sp.mirrored ? [W - r[2], r[1], W - r[0], r[3]] : [...r]);
    const out: Array<{ r: [number, number, number, number]; dx: number; dy: number }> = [];
    for (const s of l.specs) {
      if (s.kind === 'regionSway') {
        const v = Math.sin((this.t / s.period) * Math.PI * 2 + l.seed);
        const d = (v > 0.55 ? 1 : v < -0.55 ? -1 : 0) * s.amp * flip;
        if (d) out.push({ r: box(s.rect), dx: d, dy: 0 });
      } else if (s.kind === 'nod') {
        // a quick double dip every so often, each piece on its own beat
        const ph = (this.t + l.seed * 0.61) % s.every;
        if (ph < 0.16 || (ph > 0.3 && ph < 0.46)) out.push({ r: box(s.rect), dx: s.dx * flip, dy: s.dy });
      } else if (s.kind === 'flag') {
        // columns out from the pole ride a travelling wave, the free end most; neighbours alike share a box
        const [x0, y0, x1, y1] = s.rect;
        let run: { a: number; dy: number } | null = null;
        const flush = (end: number) => {
          if (run && run.dy) out.push({ r: box([run.a, y0, end, y1]), dx: 0, dy: run.dy });
        };
        for (let x = x0; x < x1; x++) {
          const d = Math.min(1, Math.abs(x - s.poleX) / s.len);
          const v = Math.sin((this.t / s.period) * Math.PI * 2 - d * Math.PI * 2 + l.seed) * (0.35 + 0.65 * d);
          const dy = (v > 0.4 ? 1 : v < -0.4 ? -1 : 0) * s.amp;
          if (run && run.dy === dy) continue;
          flush(x);
          run = { a: x, dy };
        }
        flush(x1);
      }
    }
    return out;
  }

  /** Find the scene's animated wall things (painted into the walls) and where their drawings land. */
  loadWalls(scene: SceneDef) {
    this.walls = [];
    this.boards = [];
    for (const o of scene.objects) {
      if (!o.wall) continue;
      const key = o.variant ? `${o.sprite}.${o.variant}` : o.sprite;
      const spec = WALL_SPECS[key] ?? WALL_SPECS[o.sprite];
      const board = o.actions?.some((a) => a.kind === 'note') && wallArt(o);
      if (!spec && !board) continue;
      const face = o.wall;
      const u0 = face === 'right' ? o.x : o.y;
      const span = face === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
      const onWall = (u: number, v: number): [number, number] => (face === 'right' ? [u * 16, u * 8 - v] : [-u * 16, u * 8 - v]);
      const art = wallArt(o);
      // things on the left wall are drawn mirrored about their span there, so they read the right way round
      // (interior.ts): their drawings' x runs the other way along the wall
      const along = (f: number) => (face === 'left' ? 1 - f : f);
      let at: (p: P) => [number, number];
      if (art) {
        // hung by the wall art standard (art.ts wallArt): `margin` tiles in from its span's start, `width` tiles
        // wide, mirrored about the span's middle on the left wall
        const { margin: m, width } = art;
        const [v0, v1] = art.v;
        const x0 = face === 'left' ? u0 + span - m : u0 + m;
        at = ([ix, iy]) => onWall(x0 + (face === 'left' ? -1 : 1) * (ix / art.img.width) * width, v1 - (iy / art.img.height) * (v1 - v0));
      } else {
        // procedural signs: (u across the span 0…1, v art px up from the floor)
        at = ([u, v]) => onWall(u0 + along(u) * span, v);
      }
      if (board) {
        // sticky notes go along the top of the board, clear of what's drawn on it
        const W = board.img.width;
        const H = board.img.height;
        const slot = (i: number): Quad => {
          const x = W * (0.09 + i * 0.14);
          const y = H * 0.07;
          return [at([x, y]), at([x + W * 0.1, y]), at([x + W * 0.1, y + H * 0.13]), at([x, y + H * 0.13])];
        };
        this.boards.push({ id: o.id, slot });
      }
      if (spec) this.walls.push({ obj: o, spec, at, seed: (o.x * 13 + o.y * 7) % 23, span });
    }
  }

  /** Boards on the walls that people pin notes to, and where each note goes (world px). */
  private boards: Array<{ id: string; slot: (i: number) => Quad }> = [];
  /** The colours of the notes on each board, and when one was last pinned (this.t). */
  private notes = new Map<string, { colors: string[]; pinnedAt: number }>();

  private pinned = new Set<string>();

  /**
   * The notes on the boards in the room (from the server), drawn as sticky notes on each board. `pop`: a new
   * one was just pinned (not a room being walked into), so it pops on.
   */
  setNotes(notes: BoardNote[], pop = false) {
    const next = new Map<string, { colors: string[]; pinnedAt: number }>();
    for (const n of notes) {
      const cur = next.get(n.objectId) ?? { colors: [], pinnedAt: this.notes.get(n.objectId)?.pinnedAt ?? -Infinity };
      cur.colors.push(noteColor(n.by));
      if (pop && !this.pinned.has(n.id)) cur.pinnedAt = this.t;
      next.set(n.objectId, cur);
    }
    this.pinned = new Set(notes.map((n) => n.id));
    this.notes = next;
  }

  /** Sticky notes on a board, the newest popping on when it's just been pinned. */
  private drawNotes(c: CanvasRenderingContext2D, id: string, slot: (i: number) => Quad) {
    const on = this.notes.get(id);
    if (!on) return;
    on.colors.forEach((color, i) => {
      let q = slot(i);
      const age = this.t - on.pinnedAt;
      if (i === on.colors.length - 1 && age < 0.35) {
        const k = 0.4 + 0.6 * ease(age / 0.35) + Math.sin((age / 0.35) * Math.PI) * 0.25;
        const cx = (q[0][0] + q[2][0]) / 2;
        const cy = (q[0][1] + q[2][1]) / 2;
        q = q.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]) as Quad;
      }
      c.fillStyle = 'rgba(42,31,45,0.55)';
      c.beginPath();
      q.forEach(([x, y], j) => (j ? c.lineTo(x + 0.5, y + 0.5) : c.moveTo(x + 0.5, y + 0.5)));
      c.fill();
      c.fillStyle = color;
      c.beginPath();
      q.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.fill();
      // a line of writing
      c.strokeStyle = 'rgba(42,31,45,0.45)';
      c.lineWidth = 0.5;
      c.beginPath();
      const a = lerp2(q[0], q[3], 0.45);
      const b = lerp2(q[1], q[2], 0.45);
      c.moveTo(...lerp2(a, b, 0.15));
      c.lineTo(...lerp2(a, b, 0.8));
      c.stroke();
    });
  }

  /** Draw the wall things' life; called after the room's shell, before anything stands in front of it. */
  drawWalls(c: CanvasRenderingContext2D, reducedMotion: boolean) {
    const t = reducedMotion ? 0 : this.t;
    for (const b of this.boards) this.drawNotes(c, b.id, b.slot);
    for (const w of this.walls) {
      const s = w.spec;
      if (s.kind === 'lanterns') {
        c.save();
        c.globalCompositeOperation = 'lighter';
        s.at.forEach((p, i) => {
          const [x, y] = w.at(p);
          const a = 0.2 + 0.09 * Math.sin(t * 0.9 + i * 1.7 + w.seed) + 0.04 * Math.sin(t * 2.3 + i);
          const g = c.createRadialGradient(x, y, 0, x, y, s.r);
          g.addColorStop(0, `rgba(255,200,130,${a})`);
          g.addColorStop(1, 'rgba(255,200,130,0)');
          c.fillStyle = g;
          c.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
        });
        c.restore();
      } else if (s.kind === 'countdown') {
        // the ring: twelve segments lighting one by one around the dial, then a beat, then again
        const [cx, cy] = w.at(s.ring);
        const lit = Math.floor((t * 2) % 16);
        for (let i = 0; i < 12; i++) {
          if (i >= lit) break;
          const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const [ex, ey] = w.at([s.ring[0] + Math.cos(a) * s.r, s.ring[1] + Math.sin(a) * s.r]);
          c.fillStyle = i === lit - 1 ? '#fff4c0' : 'rgba(255,170,80,0.9)';
          c.fillRect(ex - 0.25, ey - 0.25, 0.75, 0.75);
        }
        if (lit >= 12) {
          c.fillStyle = `rgba(255,236,170,${0.25 + 0.25 * Math.sin(t * 12)})`;
          c.beginPath();
          c.arc(cx, cy, 1.4, 0, Math.PI * 2);
          c.fill();
        }
        // a dot flying along the trajectory
        const k = (t * 0.25 + w.seed * 0.1) % 1;
        const [a, m, b] = s.arc;
        const q = (1 - k) * (1 - k);
        const px = q * a[0] + 2 * (1 - k) * k * m[0] + k * k * b[0];
        const py = q * a[1] + 2 * (1 - k) * k * m[1] + k * k * b[1];
        const [dx, dy] = w.at([px, py]);
        c.fillStyle = '#ffe9a8';
        c.fillRect(dx - 0.5, dy - 0.5, 1, 1);
      } else if (s.kind === 'clock') {
        // the real time on the wall: the face (sheared onto the wall like the drawing) painted over, then hands
        const face: P[] = [];
        for (let a = 0; a < 16; a++) face.push(w.at([s.at[0] + Math.cos((a / 16) * Math.PI * 2) * s.rx, s.at[1] + Math.sin((a / 16) * Math.PI * 2) * s.ry]));
        c.fillStyle = s.paper;
        c.beginPath();
        face.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
        c.fill();
        const now = worldTimeNow();
        const [cx, cy] = w.at(s.at);
        const px = wallPixel(w.at);
        const hand = (turn: number, len: number, width: number) => {
          const a = turn * Math.PI * 2;
          const [hx, hy] = w.at([s.at[0] + Math.sin(a) * s.rx * len, s.at[1] - Math.cos(a) * s.ry * len]);
          c.strokeStyle = '#2a1f2d';
          c.lineWidth = px * width;
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(hx, hy);
          c.stroke();
        };
        hand(((now.hours % 12) + now.minutes / 60) / 12, 0.55, 1);
        hand(now.minutes / 60, 0.9, 0.8);
      } else if (s.kind === 'blink') {
        // each light on its own slow beat, on a little over half the time
        const px = wallPixel(w.at);
        s.at.forEach((p, i) => {
          const period = (s.slow ? 2.4 : 1.1) + ((w.seed + i * 13) % 7) * (s.slow ? 0.6 : 0.35);
          if (((t + i * 0.37 + w.seed) % period) / period > 0.62) return;
          const [x, y] = w.at(p);
          c.fillStyle = s.colors[i % s.colors.length];
          c.fillRect(x - px / 2, y - px / 2, px, px);
        });
      } else if (s.kind === 'neon') {
        // a steady buzz of pink light; every ~8 s one letter stutters for two frames
        const [cx, cy] = w.at([0.5, 35]);
        c.save();
        c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, 26);
        g.addColorStop(0, `rgba(255,95,209,${0.12 + 0.03 * Math.sin(t * 7)})`);
        g.addColorStop(1, 'rgba(255,95,209,0)');
        c.fillStyle = g;
        c.fillRect(cx - 26, cy - 26, 52, 52);
        c.restore();
        const cycle = t % 8;
        if (!reducedMotion && cycle > 7.85) {
          const i = Math.floor(t / 8 + w.seed) % s.letters;
          const lw = 0.56 / w.span; // one letter, as a fraction of the sign's span
          const u = 0.5 + (i - (s.letters - 1) / 2) * lw;
          const [lx, ly] = w.at([u - lw / 2, 42]);
          const [rx, ry] = w.at([u + lw / 2, 29]);
          c.fillStyle = 'rgba(40,20,60,0.6)';
          c.beginPath();
          c.moveTo(lx, ly);
          c.lineTo(rx, ly + (ry - ly) - (42 - 29));
          c.lineTo(rx, ry);
          c.lineTo(lx, ry - (ry - ly) + (42 - 29));
          c.closePath();
          c.fill();
        }
      }
    }
  }

  private walls: Array<{ obj: SceneObject; spec: WallSpec; at: (p: P) => [number, number]; seed: number; span: number }> = [];

  /** How far to nudge an object's whole drawing this frame (world px): balloons bob, a rung bell shakes. */
  offset(objectId: string, reducedMotion: boolean): [number, number] {
    const l = this.live.get(objectId);
    if (!l || reducedMotion) return [0, 0];
    let dx = 0;
    let dy = 0;
    for (const s of l.specs) {
      if (s.kind === 'bob') dy += Math.round(Math.sin((this.t / s.period) * Math.PI * 2 + l.seed) * s.amp * 2) / 2;
      if (s.kind === 'ring' && l.rungAt !== undefined) {
        const age = this.t - l.rungAt;
        if (age < 1.4) dx += Math.round(Math.sin(age * 28) * (1.4 - age) * 1.2);
      }
    }
    return [dx, dy];
  }

  /**
   * Draw an object's inline animations; called right after the object itself is drawn (`hovered`: it was drawn
   * lit up for the pointer, so water repainted over it is lit up the same).
   */
  drawFor(c: CanvasRenderingContext2D, objectId: string, reducedMotion: boolean, hovered = false) {
    const l = this.live.get(objectId);
    if (!l) return;
    if (l.water && !reducedMotion) l.water.draw(c, l.dx, l.dy, hovered);
    const on = this.isOn(l.obj.id);
    const t = reducedMotion ? 0 : this.t;
    const k = l.sprite.scale ?? 1;
    const px = 1 / k; // one drawing pixel, in world px
    for (const s of l.specs) {
      switch (s.kind) {
        case 'fish': {
          c.save();
          clipQuad(c, s.glass.map(l.at) as Quad);
          for (const f of l.fish) {
            const p = l.at(lerp2(lerp2(s.glass[0], s.glass[3], f.v), lerp2(s.glass[1], s.glass[2], f.v), f.u));
            const wig = Math.round(Math.sin(t * 4 + f.phase));
            const dir = (l.sprite.mirrored ? -1 : 1) * f.dir;
            c.fillStyle = f.color;
            c.fillRect(p[0] - 2 * px, p[1] - px + wig * 0.25 * px, 5 * px, 2 * px);
            c.fillStyle = f.patch;
            c.fillRect(p[0] + (dir > 0 ? 0 : -px), p[1] - px, 2 * px, px);
            c.fillStyle = f.color;
            c.fillRect(p[0] + (dir > 0 ? -3 : 3) * px, p[1] - px + (wig > 0 ? 0 : px), px, px); // tail flick
          }
          c.restore();
          break;
        }
        case 'blink': {
          // rebooted: dark, then all amber while it starts up, then green again light by light
          const rb = this.age(l, 'reboot');
          s.at.forEach((p, i) => {
            const period = 1.1 + ((l.seed + i * 13) % 7) * 0.35;
            let lit = ((t + i * 0.37) % period) / period < 0.62;
            let color = s.colors[i % s.colors.length];
            if (rb < 0.6) lit = false;
            else if (rb < 1.6) {
              lit = true;
              color = '#ffb347';
            } else if (rb < 2.8) {
              lit = i < ((rb - 1.6) / 1.2) * s.at.length + 1;
              color = '#6bff8e';
            }
            if (!lit) return;
            const [x, y] = this.onPiece(l, p);
            const d = rb < 2.8 ? px * 2 : px;
            c.fillStyle = color;
            c.fillRect(x - d / 2, y - d / 2, d, d);
          });
          break;
        }
        case 'glow': {
          // a song on: the jukebox's lights pump to the beat
          const song = this.age(l, 'song') < SONG_S;
          if (!on && !song) break;
          const [x, y] = this.onPiece(l, s.at);
          const color = s.cycle ? mixCycle(s.cycle, t * (song ? 0.6 : 0.12) + l.seed * 0.1) : s.color;
          let a = song ? 0.3 + 0.28 * Math.abs(Math.sin(t * Math.PI * 2.1)) : 0.16 + 0.1 * Math.sin(t * s.speed + l.seed + s.at[0] * 0.37) + 0.04 * Math.sin(t * 3.1 * s.speed + s.at[1]);
          // a lantern on a building: faint by day (after dark it glows on the glow layer, drawGlow)
          if (s.dusk) a *= 0.45 * (1 - this.effects.night);
          const r = s.r * px * (song ? 1.8 : 1);
          const g = c.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(${color},${a})`);
          g.addColorStop(1, `rgba(${color},0)`);
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = g;
          c.fillRect(x - r, y - r, r * 2, r * 2);
          c.restore();
          break;
        }
        case 'chase': {
          // a game on: the marquee lights race and flash, bigger
          const play = this.age(l, 'claw') < CLAW_S + 0.6;
          const d = play ? px * 2 : px;
          for (let i = 0; i < s.n; i++) {
            const lit = play ? Math.floor(t * 12) % 2 === i % 2 : Math.floor(t * 4) % 3 === i % 3;
            const [x, y] = l.at(lerp2(s.from, s.to, i / (s.n - 1)));
            c.fillStyle = lit ? s.colors[0] : s.colors[1];
            c.globalAlpha = lit ? 1 : 0.55;
            c.fillRect(x - d / 2, y - d / 2, d, d);
          }
          c.globalAlpha = 1;
          break;
        }
        case 'screen': {
          c.save();
          const q = s.quad.map(l.at) as Quad;
          clipQuad(c, q);
          const top = Math.min(...q.map((p) => p[1]));
          const bottom = Math.max(...q.map((p) => p[1]));
          const left = Math.min(...q.map((p) => p[0]));
          const right = Math.max(...q.map((p) => p[0]));
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = `rgba(120,200,255,${0.05 + 0.04 * Math.sin(t * 1.7 + l.seed)})`;
          c.fillRect(left, top, right - left, bottom - top);
          const band = top + ((t * 9 + l.seed) % (bottom - top + 6)) - 3;
          c.fillStyle = 'rgba(255,255,255,0.13)';
          c.fillRect(left, band, right - left, px * 2);
          // a game being played: flashes and little invaders marching
          const ga = this.age(l, 'arcade');
          if (ga < 2.2) {
            c.fillStyle = `rgba(255,255,255,${Math.floor(ga * 8) % 2 ? 0.28 : 0.08})`;
            c.fillRect(left, top, right - left, bottom - top);
            for (let i = 0; i < 6; i++) {
              const ix = left + ((i * 0.17 + ga * 0.35) % 1) * (right - left);
              const iy = top + (0.2 + (i % 3) * 0.2 + ga * 0.12) * (bottom - top);
              c.fillStyle = i % 2 ? '#7cff9a' : '#ff6bd5';
              c.fillRect(ix, iy, px * 2, px);
            }
          }
          c.restore();
          break;
        }
        case 'pendulum': {
          const q = s.clear.map(l.at) as Quad;
          c.save();
          clipQuad(c, q);
          c.fillStyle = l.fill ?? '#3a2618';
          c.fillRect(Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), 40, 60);
          const [ox, oy] = l.at(s.pivot);
          const ang = Math.sin(t * 2.4) * s.amp;
          const len = s.len * px;
          const bx = ox + Math.sin(ang) * len * (l.sprite.mirrored ? -1 : 1);
          const by = oy + Math.cos(ang) * len;
          c.strokeStyle = '#c9a24a';
          c.lineWidth = px;
          c.beginPath();
          c.moveTo(ox, oy);
          c.lineTo(bx, by);
          c.stroke();
          c.fillStyle = '#e8c46a';
          c.beginPath();
          c.arc(bx, by, s.bob * px, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#fff2c0';
          c.fillRect(bx - px, by - px * 1.5, px, px);
          c.restore();
          break;
        }
        case 'clockface': {
          // the real time, on a face whose painted hands are covered first; face and hands in whole pixels
          const [cx, cy] = s.at;
          const dot = (ix: number, iy: number) => {
            const [x, y] = l.at([ix + 0.5, iy + 0.5]);
            c.fillRect(x - px / 2, y - px / 2, px, px);
          };
          c.fillStyle = s.paper;
          for (let iy = Math.floor(cy - s.ry); iy <= Math.ceil(cy + s.ry); iy++) {
            const dy = (iy + 0.5 - cy) / s.ry;
            if (Math.abs(dy) > 1) continue;
            const hw = s.rx * Math.sqrt(1 - dy * dy);
            for (let ix = Math.ceil(cx - hw - 0.5); ix <= Math.floor(cx + hw - 0.5); ix++) dot(ix, iy);
          }
          const now = worldTimeNow(); // the world clock, the same for everyone
          const mins = now.minutes;
          const hours = (now.hours % 12) + mins / 60;
          // (a mirrored drawing's pixels run the other way: the hands are turned back so it still reads clockwise)
          const flip = l.sprite.mirrored ? -1 : 1;
          const hub: P = [Math.floor(cx), Math.floor(cy)];
          const hand = (turn: number, len: number, thick: boolean) => {
            const a = turn * Math.PI * 2;
            const tip: P = [Math.round(cx - 0.5 + Math.sin(a) * s.rx * len * flip), Math.round(cy - 0.5 - Math.cos(a) * s.ry * len)];
            c.fillStyle = '#2a1f2d';
            for (const [ix, iy] of pixelLine(hub, tip)) {
              dot(ix, iy);
              // a big face's hour hand is two pixels wide
              if (thick) dot(ix + (Math.abs(Math.cos(a)) > 0.7 ? 1 : 0), iy + (Math.abs(Math.cos(a)) > 0.7 ? 0 : 1));
            }
          };
          hand(hours / 12, 0.55, s.rx >= 8);
          hand(mins / 60, 0.85, false);
          c.fillStyle = '#b8872e';
          dot(...hub);
          break;
        }
        case 'marquee': {
          c.globalAlpha = 0.85;
          this.drawMarquee(c, l, s, t, px);
          c.globalAlpha = 1;
          break;
        }
        case 'shimmer': {
          c.save();
          const q = s.glass.map(l.at) as Quad;
          clipQuad(c, q);
          c.globalCompositeOperation = 'lighter';
          const left = Math.min(...q.map((p) => p[0]));
          const right = Math.max(...q.map((p) => p[0]));
          const top = Math.min(...q.map((p) => p[1]));
          const bottom = Math.max(...q.map((p) => p[1]));
          for (let i = 0; i < 3; i++) {
            const phase = (t * 0.18 + i / 3 + l.seed * 0.01) % 1;
            const x = left + phase * (right - left + 20) - 10;
            const g = c.createLinearGradient(x - 6, top, x + 6, bottom);
            g.addColorStop(0, 'rgba(200,245,255,0)');
            g.addColorStop(0.5, 'rgba(200,245,255,0.09)');
            g.addColorStop(1, 'rgba(200,245,255,0)');
            c.fillStyle = g;
            c.fillRect(left, top, right - left, bottom - top);
          }
          c.restore();
          break;
        }
        case 'code': {
          c.save();
          const q = s.quad.map(l.at) as Quad;
          clipQuad(c, q);
          const rows = 7;
          const scroll = Math.floor(t / 1.5 + l.seed);
          for (let r = 0; r < rows; r++) {
            const line = scroll + r;
            const indent = ((line * 7) % 3) * 0.12;
            const len = 0.25 + (((line * 13) % 7) / 7) * 0.55;
            const v = (r + 0.6) / (rows + 0.4);
            const a = l.at(lerp2(lerp2(s.quad[0], s.quad[3], v), lerp2(s.quad[1], s.quad[2], v), 0.08 + indent));
            const b = l.at(lerp2(lerp2(s.quad[0], s.quad[3], v), lerp2(s.quad[1], s.quad[2], v), Math.min(0.94, 0.08 + indent + len)));
            c.strokeStyle = s.colors[line % s.colors.length];
            c.globalAlpha = 0.55;
            c.lineWidth = px;
            c.beginPath();
            c.moveTo(a[0], a[1]);
            c.lineTo(b[0], b[1]);
            c.stroke();
          }
          c.restore();
          break;
        }
        case 'candles': {
          s.at.forEach((p, i) => {
            const [x, y] = l.at(p);
            const flick = Math.floor(t * 9 + i * 3) % 3;
            c.fillStyle = flick === 0 ? '#ffe28a' : '#ffb347';
            const h = flick === 2 ? 2.5 : 2;
            c.fillRect(x - px / 2, y - px * h, px, px * h);
          });
          break;
        }
        case 'strip': {
          // the strip glows faintly all along, with a brighter bead of light travelling its length
          const [ax, ay] = l.at(s.from);
          const [bx, by] = l.at(s.to);
          const k = (t * s.speed + l.seed * 0.13) % 1;
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.strokeStyle = `rgba(${s.color},${0.1 + 0.05 * Math.sin(t * 1.3 + l.seed)})`;
          c.lineWidth = px * 2;
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(bx, by);
          c.stroke();
          const g = c.createRadialGradient(ax + (bx - ax) * k, ay + (by - ay) * k, 0, ax + (bx - ax) * k, ay + (by - ay) * k, px * 7);
          g.addColorStop(0, `rgba(${s.color},0.55)`);
          g.addColorStop(1, `rgba(${s.color},0)`);
          c.fillStyle = g;
          c.fillRect(ax + (bx - ax) * k - px * 7, ay + (by - ay) * k - px * 7, px * 14, px * 14);
          c.restore();
          break;
        }
        case 'popcorn': {
          c.save();
          clipQuad(c, s.glass.map(l.at) as Quad);
          for (const k of l.kernels) {
            const [x, y] = l.at([k.x, k.y]);
            c.fillStyle = '#fff6d8';
            c.fillRect(x - px, y - px, px * 2, px * 2);
            c.fillStyle = '#e8b848';
            c.fillRect(x, y, px, px);
          }
          c.restore();
          break;
        }
        case 'ring': {
          if (l.rungAt === undefined) break;
          const age = t - l.rungAt;
          if (age > 1.6 || age < 0) break;
          const [x, y] = l.at(s.at);
          for (let i = 0; i < 3; i++) {
            const k = age * 1.5 - i * 0.25;
            if (k <= 0 || k > 1) continue;
            c.strokeStyle = `rgba(255,236,160,${(1 - k) * 0.8})`;
            c.lineWidth = px * 1.5;
            c.beginPath();
            c.ellipse(x, y, (6 + k * 18) * px * 2, (4 + k * 12) * px * 2, 0, -Math.PI * 0.85, -Math.PI * 0.15);
            c.stroke();
          }
          break;
        }
      }
    }
    this.drawUse(c, l);
  }

  /**
   * An object's light on the town's glow layer (dusk to dawn), in depth order like lit windows: water catching
   * the lamplight. Called right after the object's own glow.
   */
  drawGlow(g: CanvasRenderingContext2D, objectId: string, reducedMotion: boolean) {
    const l = this.live.get(objectId);
    if (!l) return;
    if (l.water && !reducedMotion) l.water.drawGlow(g, l.dx, l.dy, this.light.lamps);
    // a building's lanterns, lit from dusk: they shine over the dimmed town like its windows
    const t = reducedMotion ? 0 : this.t;
    const px = 1 / (l.sprite.scale ?? 1);
    for (const s of l.specs) {
      // marquee bulbs lit by the drawing's night glow: the dimmed ones go dark on the glow layer too
      if (s.kind === 'marquee') {
        g.globalCompositeOperation = 'destination-out';
        this.drawMarquee(g, l, s, t, px);
        g.globalCompositeOperation = 'source-over';
        continue;
      }
      if (s.kind !== 'glow' || !s.dusk || !this.isOn(l.obj.id)) continue;
      const [x, y] = this.onPiece(l, s.at);
      const a = 0.42 + 0.14 * Math.sin(t * s.speed + l.seed + s.at[0]) + 0.05 * Math.sin(t * 3.1 * s.speed + s.at[1]);
      const r = s.r * px * 1.3;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${s.color},${a})`);
      grad.addColorStop(1, `rgba(${s.color},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  /** Marquee bulbs: every third one dimmed (a round of whole pixels in `off`), the gap stepping along the row. */
  private drawMarquee(c: CanvasRenderingContext2D, l: Live, s: Extract<AnimSpec, { kind: 'marquee' }>, t: number, px: number) {
    const step = Math.floor(t * s.rate);
    c.fillStyle = s.off;
    s.at.forEach((p, i) => {
      if ((i + step) % 3) return;
      const [x, y] = l.at(p);
      for (let j = -s.r; j <= s.r; j++) {
        const hw = Math.round(Math.sqrt(s.r * s.r - j * j));
        c.fillRect(x - (hw + 0.5) * px, y + (j - 0.5) * px, (hw * 2 + 1) * px, px);
      }
    });
  }

  /** A drawing point in world px, riding the part of the piece that moves in a moment (the rocket off its pad). */
  private onPiece(l: Live, p: P): [number, number] {
    const [x, y] = l.at(p);
    const cut = l.spot?.liftoff?.cut;
    return cut !== undefined && p[1] < cut ? [x, y - this.hop(l)] : [x, y];
  }

  /* ------------------------------------------------------------------ things being used (uses.ts) */

  /** Seconds since a moment last happened here (Infinity if never). */
  private age(l: Live, what: MomentKind): number {
    const m = l.moments[what];
    return m ? this.t - m.at : Infinity;
  }

  /** A point in the drawing's opaque bounds, by fraction (world px). */
  private boxAt(l: Live, fx: number, fy: number): [number, number] {
    const k = l.sprite.scale ?? 1;
    const b = l.box;
    return [l.dx + (b.x0 + (b.x1 - b.x0) * fx) / k, l.dy + (b.y0 + (b.y1 - b.y0) * fy) / k];
  }

  private later(l: Live, delay: number, fn: () => void) {
    l.pending.push({ at: this.t + delay, fn });
  }

  /** A note floating up (a big outlined one for a moment someone made). */
  private note(x: number, y: number, big = false) {
    this.effects.add({
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -8 - Math.random() * 4,
      max: 2 + Math.random() * 0.6,
      size: big ? 3 : 2,
      color: ['#ff8ad8', '#8ae2ff', '#ffe066'][Math.floor(Math.random() * (big ? 3 : 2))],
      gravity: 0,
      kind: 'note',
    });
  }

  /** The start of a moment: what flies out at once, and what's scheduled for a beat later. */
  private startUse(l: Live, what: UseKind) {
    const fx = this.effects;
    const detail = l.moments[what]?.detail;
    switch (what) {
      case 'song': {
        const [x, y] = this.notesAt(l);
        for (let i = 0; i < 6; i++) this.later(l, i * 0.18, () => this.note(x + (Math.random() - 0.5) * 8, y, true));
        break;
      }
      case 'piano': {
        // a run up the keys: notes rising along the lid, left to right
        for (let i = 0; i < 8; i++) {
          const [x, y] = this.boxAt(l, 0.25 + i * 0.07, 0.18);
          this.later(l, i * 0.18, () => this.note(x, y, true));
        }
        break;
      }
      case 'pool':
      case 'hockey':
        l.table?.start(this.t, detail);
        break;
      case 'feed': {
        // flakes scattered on the water: rings where they land, then they drift down to the fish
        const spec = l.specs.find((s) => s.kind === 'fish' || s.kind === 'shimmer');
        for (let i = 0; i < 16; i++) {
          const u = 0.2 + Math.random() * 0.6;
          const [x, y] = spec && (spec.kind === 'fish' || spec.kind === 'shimmer') ? l.at(lerp2(spec.glass[0], spec.glass[1], u)) : this.boxAt(l, u, 0.25);
          this.later(l, i * 0.06, () => {
            fx.add({ x, y: y + 1, vx: (Math.random() - 0.5) * 1.2, vy: 2 + Math.random() * 2.5, max: 3.2 + Math.random(), size: 1, color: i % 3 ? '#ffb23f' : '#ffe08a', gravity: 0, kind: 'square' });
            if (i % 4 === 0) fx.add({ x, y: y + 1, max: 0.9, size: 1.5, color: 'rgba(255,255,255,0.95)', kind: 'ripple' });
          });
        }
        break;
      }
      case 'spin':
        this.later(l, SPIN_S, () => {
          const [x, y, r] = this.globeAt(l);
          for (let i = 0; i < 5; i++)
            fx.add({ x: x + (Math.random() - 0.5) * r * 1.6, y: y - r * 0.4 + (Math.random() - 0.5) * r, vy: -4, max: 0.9, size: 2, color: '#fff4b0', kind: 'star' });
        });
        break;
      case 'water': {
        // the can tips over the leaves and pours; the plant perks up with a green glint
        for (let i = 0; i < 22; i++)
          this.later(l, 0.3 + i * 0.045, () => {
            const [x, y] = this.spoutAt(l);
            fx.add({ x: x + (Math.random() - 0.5) * 1.5, y, vx: -2 + (Math.random() - 0.5) * 3, vy: 12, max: 0.55, size: 1, color: '#5ab8ff', gravity: 60, kind: 'drop' });
          });
        this.later(l, 1.35, () => {
          for (let i = 0; i < 5; i++) {
            const [x, y] = this.boxAt(l, 0.25 + Math.random() * 0.5, 0.1 + Math.random() * 0.3);
            fx.add({ x, y, vy: -5, max: 1, size: i % 2 ? 2 : 1, color: '#9cff8a', kind: 'star' });
          }
        });
        break;
      }
      case 'wish': {
        // the coin (drawUse) lands: a splash, rings on the water, and the wish glinting up out of it
        const [cx, cy] = this.coinPath(l, WISH_T);
        this.later(l, WISH_T, () => {
          for (let i = 0; i < 8; i++)
            fx.add({ x: cx + (Math.random() - 0.5) * 2, y: cy, vx: (Math.random() - 0.5) * 16, vy: -14 - Math.random() * 12, max: 0.55, size: 1, color: 'rgba(225,245,255,0.95)', gravity: 70, kind: 'drop' });
          // water that moves on its own drawing takes the coin itself: foam, crisp rings, drops, all in its pixels
          if (l.water) l.water.splash(...this.toDrawing(l, cx, cy));
          else for (let i = 0; i < 3; i++) this.later(l, i * 0.25, () => fx.add({ x: cx, y: cy + 1, max: 1.2, size: 2, color: 'rgba(255,255,255,0.95)', kind: 'ripple' }));
          for (let i = 0; i < 4; i++)
            this.later(l, 0.3 + i * 0.15, () => fx.add({ x: cx + (Math.random() - 0.5) * 8, y: cy - 3, vy: -9, max: 1.1, size: 2, color: '#ffe066', kind: 'star' }));
        });
        break;
      }
      case 'rocket': {
        // smoke billows off the pad as it lifts
        const [x, y] = this.nozzleAt(l, 0);
        for (let i = 0; i < 16; i++)
          this.later(l, Math.random() * 0.5, () =>
            fx.add({ x: x + (Math.random() - 0.5) * 4, y, vx: (Math.random() - 0.5) * 22, vy: -1 - Math.random() * 3, max: 1.2 + Math.random() * 0.8, size: 1.8 + Math.random() * 1.4, color: 'rgba(240,240,240,0.8)', gravity: -1 }),
          );
        break;
      }
      case 'chime':
        l.rungAt = this.t;
        break;
      case 'toast': {
        // glasses up: confetti over the podium, twice
        const [x, y] = this.boxAt(l, 0.5, 0);
        fx.burst(x, y - 6, 'confetti', 26);
        this.later(l, 0.5, () => fx.burst(x, y - 10, 'confetti', 18));
        break;
      }
      case 'claw':
        // a win: a sparkle at the prize chute when the claw's back up
        if (detail === 'win')
          this.later(l, CLAW_S, () => {
            const [x, y] = this.spotAt(l, l.spot?.chute) ?? this.boxAt(l, 0.3, 0.8);
            for (let i = 0; i < 6; i++) fx.add({ x: x + (Math.random() - 0.5) * 10, y: y - Math.random() * 6, vy: -8, max: 1, size: 2, color: i % 2 ? '#fff4b0' : '#ff9fe0', kind: 'star' });
          });
        break;
      default:
        // arcade, reboot: drawn from their moment (drawUse, drawSprite, and the blink and screen specs)
        break;
    }
  }

  /** Where a jukebox's notes come from: its own notes point, else the top of the drawing. */
  private notesAt(l: Live): [number, number] {
    const spec = l.specs.find((s) => s.kind === 'notes');
    return spec && spec.kind === 'notes' ? l.at(spec.at) : this.boxAt(l, 0.5, 0.05);
  }

  /** A point of the drawing's moment spots in world px, if the drawing has it. */
  private spotAt(l: Live, p: P | undefined): [number, number] | undefined {
    return p ? l.at(p) : undefined;
  }

  /** The globe's ball: centre and radius (world px). */
  private globeAt(l: Live): [number, number, number] {
    const g = l.spot?.globe;
    if (g) return [...l.at(g.at), g.r / (l.sprite.scale ?? 1)];
    const [x, y] = this.boxAt(l, 0.5, 0.33);
    return [x, y, ((l.box.x1 - l.box.x0) / (l.sprite.scale ?? 1)) * 0.36];
  }

  /** Where the watering can's rose is (world px), above and beside the leaves. */
  private spoutAt(l: Live): [number, number] {
    const [x, y] = this.boxAt(l, 0.55, 0);
    return [x - 1, y - 3];
  }

  /** The coin's arc from the rim at the front into the water of the basin, `a` seconds in. */
  private coinPath(l: Live, a: number): [number, number] {
    const [sx, sy] = this.boxAt(l, 0.55, 0.98);
    let [cx, cy] = this.boxAt(l, 0.38, 0.8);
    // into open water, not onto a lily pad
    if (l.water) [cx, cy] = l.at(l.water.coinSpot(...this.toDrawing(l, cx, cy)));
    const k = Math.min(1, a / WISH_T);
    return [sx + (cx - sx) * k, sy + (cy - sy) * k - Math.sin(k * Math.PI) * 26];
  }

  /** A world point on an object's drawing, in the drawing's own (unmirrored) pixels: the inverse of `at`. */
  private toDrawing(l: Live, x: number, y: number): [number, number] {
    const k = l.sprite.scale ?? 1;
    const px = (x - l.dx) * k;
    return [l.sprite.mirrored ? l.sprite.canvas.width - px : px, (y - l.dy) * k];
  }

  /** How far the rocket is off its pad (world px), and where its nozzle is. */
  private hop(l: Live): number {
    const a = this.age(l, 'rocket');
    if (a >= ROCKET_S) return 0;
    const up = a < 0.45 ? ease(a / 0.45) : a < ROCKET_S - 0.5 ? 1 : 1 - ease((a - (ROCKET_S - 0.5)) / 0.5);
    return Math.round(up * 7 * 2) / 2;
  }

  private nozzleAt(l: Live, hop: number): [number, number] {
    const n = l.spot?.liftoff?.nozzle;
    const [x, y] = n ? l.at(n) : this.boxAt(l, 0.5, 0.8);
    return [x, y - hop];
  }

  /** A moment's life between frames: scheduled bits, a game on a table, a jukebox that keeps playing. */
  private updateUse(l: Live, dt: number) {
    if (l.pending.length) {
      const due = l.pending.filter((p) => p.at <= this.t);
      l.pending = l.pending.filter((p) => p.at > this.t);
      for (const p of due) p.fn();
    }
    l.table?.update(dt, this.t);
    // a song on: the jukebox keeps giving off notes for a while
    if (this.age(l, 'song') < SONG_S && Math.random() < dt * 2.4) {
      const [x, y] = this.notesAt(l);
      this.note(x + (Math.random() - 0.5) * 6, y, true);
    }
    // the rocket's exhaust while it's up
    if (this.hop(l) > 1 && Math.random() < dt * 14) {
      const [x, y] = this.nozzleAt(l, 0);
      this.effects.add({ x: x + (Math.random() - 0.5) * 3, y, vx: (Math.random() - 0.5) * 14, vy: -1, max: 0.9, size: 1.5 + Math.random(), color: 'rgba(235,235,235,0.7)', gravity: -1 });
    }
  }

  /** What a moment draws over its object: a table's game, the score, a globe spinning, a can, a coin, a flame. */
  private drawUse(c: CanvasRenderingContext2D, l: Live) {
    l.table?.drawOver(c, l.dx, l.dy, l.at, this.t);
    // the arcade score, rising over the cabinet
    const ga = this.age(l, 'arcade');
    const score = l.moments.arcade?.detail;
    if (ga < 2.4 && score) {
      const [x, y] = this.boxAt(l, 0.5, 0);
      label(c, score, x, y - 3 - ga * 4, Math.min(1, (2.4 - ga) * 2), '#ffe66b');
    }
    const board = l.spot?.board;
    if (board) {
      const bq = board;
      this.drawNotes(c, l.obj.id, (i) => {
        const u = 0.1 + (i % 3) * 0.28;
        const v = 0.08 + Math.floor(i / 3) * 0.24;
        const at = (du: number, dv: number) => l.at(lerp2(lerp2(bq[0], bq[1], u + du), lerp2(bq[3], bq[2], u + du), v + dv));
        return [at(0, 0), at(0.22, 0), at(0.22, 0.2), at(0, 0.2)];
      });
    }
    this.drawSpotlight(c, l);
    this.drawGlobe(c, l);
    this.drawCan(c, l);
    this.drawCoin(c, l);
    this.drawFlame(c, l);
    this.drawPrize(c, l);
    this.drawReboot(c, l);
    // the clock striking three: rings spreading from its face, one for each stroke
    const ch = this.age(l, 'chime');
    if (ch < 2.6 && !l.specs.some((s) => s.kind === 'ring')) {
      const face = l.specs.find((s) => s.kind === 'clockface');
      const [x, y] = face && face.kind === 'clockface' ? l.at(face.at) : this.boxAt(l, 0.5, 0.3);
      for (let i = 0; i < 3; i++) {
        const k = (ch - i * 0.7) / 1.1;
        if (k <= 0 || k > 1) continue;
        c.strokeStyle = `rgba(255,233,150,${(1 - k) * 0.95})`;
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(x, y, 4 + k * 13, (4 + k * 13) * 0.62, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }

  /** A toast at the podium: a warm light on it while the room raises a glass. */
  private drawSpotlight(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'toast');
    if (a >= 3.5) return;
    const k = Math.min(1, a * 4, (3.5 - a) * 1.5);
    const [x, y] = this.boxAt(l, 0.5, 0.35);
    const [, top] = this.boxAt(l, 0.5, 0);
    const r = 26;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // the beam down from above, and a pool of light round the podium
    const beam = c.createLinearGradient(0, top - 60, 0, y + 10);
    beam.addColorStop(0, 'rgba(255,236,180,0)');
    beam.addColorStop(1, `rgba(255,236,180,${0.22 * k})`);
    c.fillStyle = beam;
    c.beginPath();
    c.moveTo(x - 5, top - 60);
    c.lineTo(x + 5, top - 60);
    c.lineTo(x + r * 0.8, y + 8);
    c.lineTo(x - r * 0.8, y + 8);
    c.closePath();
    c.fill();
    const pool = c.createRadialGradient(x, y + 8, 0, x, y + 8, r);
    pool.addColorStop(0, `rgba(255,236,180,${0.3 * k})`);
    pool.addColorStop(1, 'rgba(255,236,180,0)');
    c.fillStyle = pool;
    c.fillRect(x - r, y + 8 - r, r * 2, r * 2);
    c.restore();
  }

  /** The globe spinning: its continents race round and slow to a stop, then a pin and where it landed. */
  private drawGlobe(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'spin');
    if (a >= SPIN_S + 2.6) return;
    const [cx, cy, r] = this.globeAt(l);
    if (a < SPIN_S) {
      const turn = 4 * (1 - Math.pow(1 - a / SPIN_S, 2));
      c.save();
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.clip();
      // meridians of land and light sweeping across the ball: squeezed at its edges, wide in the middle
      for (let i = 0; i < 6; i++) {
        const th = ((turn + i / 6) % 1) * Math.PI * 2 - Math.PI;
        if (Math.cos(th) <= 0.05) continue;
        const x = cx + Math.sin(th) * r;
        const w = Math.max(0.5, r * 0.32 * Math.cos(th));
        c.fillStyle = i % 2 ? 'rgba(46,104,58,0.5)' : 'rgba(255,248,214,0.45)';
        c.fillRect(x - w / 2, cy - r, w, r * 2);
      }
      c.restore();
      // motion arcs either side while it's going fast
      const fast = 1 - a / SPIN_S;
      if (fast > 0.35) {
        c.strokeStyle = `rgba(255,255,255,${(fast - 0.35) * 1.3})`;
        c.lineWidth = 0.75;
        for (const side of [-1, 1]) {
          c.beginPath();
          c.arc(cx, cy, r + 2, side > 0 ? -0.5 : Math.PI - 0.5, side > 0 ? 0.5 : Math.PI + 0.5);
          c.stroke();
        }
      }
      return;
    }
    // stopped: a pin where it landed and the city rising over it
    const b = a - SPIN_S;
    const city = l.moments.spin?.detail;
    const seed = [...(city ?? '')].reduce((n, ch) => n + ch.charCodeAt(0), 0);
    const px = Math.round(cx + (((seed % 7) - 3) / 6) * r);
    const py = Math.round(cy - r * 0.2 + ((seed % 5) - 2) * 0.12 * r);
    const drop = b < 0.2 ? (0.2 - b) * 20 : 0;
    c.globalAlpha = Math.min(1, (2.6 - b) * 2);
    c.fillStyle = '#2a1f2d';
    c.fillRect(px - 1, py - 4 - drop, 3, 3);
    c.fillRect(px, py - 2 - drop, 1, 3);
    c.fillStyle = '#ff4d5e';
    c.fillRect(px - 0.5, py - 3.5 - drop, 2, 2);
    c.globalAlpha = 1;
    if (city) label(c, city, cx, cy - r - 3 - b * 3, Math.min(1, (2.6 - b) * 2), '#fff4b0');
  }

  /** The watering can, tipping over the plant and pouring (the drops are particles from its rose). */
  private drawCan(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'water');
    if (a >= 1.6) return;
    const [rx, ry] = this.spoutAt(l);
    const tipped = a > 0.25 && a < 1.3;
    const rows = tipped ? CAN_TIPPED : CAN_LEVEL;
    // the rose (where the water comes out) sits on the spout point; the rest of the can up and to the right
    const rose = tipped ? [0, 7] : [0, 2];
    const x0 = Math.round(rx) - rose[0];
    const y0 = Math.round(ry) - rose[1];
    c.globalAlpha = Math.min(1, a * 5, (1.6 - a) * 4);
    const paint = (dx: number, dy: number, only?: string) =>
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          c.fillStyle = only ?? CAN_COLORS[ch];
          c.fillRect(x0 + x + dx, y0 + y + dy, 1, 1);
        }),
      );
    // a dark edge all round so it reads over leaves and walls, then the can
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paint(dx, dy, '#1b2a2a');
    paint(0, 0);
    c.globalAlpha = 1;
  }

  /** The wishing coin in the air: gold, flashing as it turns over. */
  private drawCoin(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'wish');
    if (a >= WISH_T) return;
    const [x, y] = this.coinPath(l, a);
    const edge = Math.floor(a * 16) % 2 === 1;
    c.fillStyle = '#2a1f2d';
    c.fillRect(Math.round(x) - 1.5, Math.round(y) - 1.5, edge ? 2 : 3, 3);
    c.fillStyle = '#ffd23f';
    c.fillRect(Math.round(x) - 1, Math.round(y) - 1, edge ? 1 : 2, 2);
    if (!edge) {
      c.fillStyle = '#fffbe0';
      c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
    }
  }

  /** The rocket's flame between its nozzle and the pad while it's up. */
  private drawFlame(c: CanvasRenderingContext2D, l: Live) {
    const h = this.hop(l);
    if (h < 1) return;
    const [x, y] = this.nozzleAt(l, h);
    const flick = Math.floor(this.t * 20) % 2;
    c.fillStyle = '#ff7a2f';
    c.fillRect(Math.round(x) - 2, y, 4, h + flick);
    c.fillStyle = '#ffe066';
    c.fillRect(Math.round(x) - 1, y, 2, Math.max(1, h - 1 - flick));
  }

  /** A prize coming up in the claw when it's a win. */
  private drawPrize(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'claw');
    const tip = l.spot?.tip;
    if (a >= CLAW_S || a < 1.05 || !tip || l.moments.claw?.detail !== 'win') return;
    const drop = a < 1.1 ? 1 : 1 - (a - 1.1) / 0.8;
    const [x, y] = l.at([tip[0], tip[1] + drop * 8 + 3]);
    // a little bear: round body, two ears
    const [bx, by] = [Math.round(x), Math.round(y)];
    c.fillStyle = '#2a1f2d';
    c.fillRect(bx - 3, by - 3, 6, 5);
    c.fillStyle = '#ff9fe0';
    c.fillRect(bx - 2, by - 1, 4, 2);
    c.fillRect(bx - 2, by - 2, 1, 1);
    c.fillRect(bx + 1, by - 2, 1, 1);
    c.fillStyle = '#ffd6f2';
    c.fillRect(bx - 1, by - 1, 1, 1);
  }

  /** Turned off and on again: a boot bar over the rack fills amber, then goes green with an OK. */
  private drawReboot(c: CanvasRenderingContext2D, l: Live) {
    const a = this.age(l, 'reboot');
    if (a < 0.6 || a >= 3.4) return;
    const [x, y] = this.boxAt(l, 0.5, 0);
    const w = 16;
    const bx = Math.round(x - w / 2);
    const by = Math.round(y - 7);
    c.globalAlpha = Math.min(1, (3.4 - a) * 3);
    c.fillStyle = '#2a1f2d';
    c.fillRect(bx - 1, by - 1, w + 2, 5);
    c.fillStyle = '#4a4a58';
    c.fillRect(bx, by, w, 3);
    const k = Math.min(1, (a - 0.6) / 1.6);
    c.fillStyle = a < 2.2 ? '#ffb347' : '#6bff8e';
    c.fillRect(bx, by, Math.round(w * k), 3);
    if (a >= 2.2) label(c, 'OK', x, by - 2, Math.min(1, (a - 2.2) * 4, (3.4 - a) * 3), '#6bff8e');
    c.globalAlpha = 1;
  }
}

/**
 * A watering can in world px, spout to the left: level (coming in, going away) and tipped (pouring).
 * b body, L its shine, d its shadow side, h the handle, s the spout, r the rose.
 */
const CAN_LEVEL = ['......hhhh..', '.....h....h.', 'rr...bbbbbbh', 'r.s..bLbbbbb', '...s.bLbbbbd', '....sbLbbbbd', '.....bbbbbbd', '.....ddddddd'];
const CAN_TIPPED = ['........hhh.', '.......h...h', '......bbbbb.', '.....bLbbbbb', '...sbLbbbbbd', '..s.bLbbbbd.', '.s..bbbbbd..', 'rr...dddd...', 'r...........'];
const CAN_COLORS: Record<string, string> = { b: '#3fb7a8', L: '#a6f2e4', d: '#23766c', h: '#23766c', s: '#2f9c8f', r: '#dfe8ea' };

/** How long each moment runs (seconds). */
const SONG_S = 8;
const SPIN_S = 2.1;
const WISH_T = 0.65;
const ROCKET_S = 1.5;
const CLAW_S = 1.9;

function ease(k: number) {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}

/**
 * Where a moment happens on a drawing, in its own pixels (unmirrored): the globe's ball, the rocket's cut
 * above its pad and its nozzle, the claw's tip and the prize chute. Not idle life, so kept out of BY_FILE.
 */
const MOMENT_SPOTS: Record<string, Spots> = {
  'globe-stand.se.png': { globe: { at: [19, 21], r: 14 } },
  'globe-stand.nw.png': { globe: { at: [19, 21], r: 14 } },
  'heirloom-globe.png': { globe: { at: [21.5, 23], r: 17 } },
  'rocket-model.se.png': { liftoff: { cut: 84, nozzle: [20, 84] } },
  'rocket-model.nw.png': { liftoff: { cut: 82, nozzle: [19, 82] } },
  'claw-machine.sw.png': { tip: [24, 38], chute: [15, 66] },
  'claw-machine.ne.png': { chute: [22, 20] },
  'whiteboard-stand.sw.png': { board: [[11, 4], [37, 15], [37, 40], [11, 28]] },
  'water-cooler.se.png': { jug: [16, 25] },
  'water-cooler.nw.png': { jug: [16, 25] },
};

interface Spots {
  /** A board's face (tl, tr, br, bl) where notes are pinned. */
  board?: Quad;
  /** The cooler's jug, where it glugs as a cup's filled. */
  jug?: P;
  globe?: { at: P; r: number };
  liftoff?: { cut: number; nozzle: P };
  tip?: P;
  chute?: P;
}


/** Wall things by manifest key (or sprite). Coordinates are in the wall drawing's own pixels. */
const WALL_SPECS: Record<string, WallSpec> = {
  'screen.countdown': { kind: 'countdown', ring: [49, 14], r: 6, arc: [[9, 22], [22, 10], [37, 9]] },
  'lantern-string': { kind: 'lanterns', at: [[6, 11], [19, 15], [30, 18], [47, 19], [60, 18], [74, 14], [87, 11]], r: 5 },
  neon: { kind: 'neon', letters: 4 },
  // the Launch Lab's mission clock keeps the world's time
  'clock-wall': { kind: 'clock', at: [11, 17.5], rx: 5.5, ry: 6.5, paper: 'rgb(241,225,204)' },
  // Engineering's build dashboard: its status lights (the two grey ones come on too)
  dashboard: {
    kind: 'blink',
    at: [[41.5, 14.5], [41.5, 17.5], [41.5, 20.5], [45.5, 25.5], [45.5, 27.5], [45.5, 30.5], [45.5, 32.5]],
    colors: ['#b4ffc8', '#b4ffc8', '#ffd27a', '#b4ffc8', '#46e375', '#46e375', '#b4ffc8'],
  },
  // the Launch Lab's star map: its stars twinkle, slowly
  'star-map': {
    kind: 'blink',
    at: [[50.5, 40.5], [45.5, 23.5], [48.5, 22.5], [53.5, 27.5], [40.5, 34.5], [24.5, 36.5], [19.5, 27.5], [10.5, 41.5], [33.5, 32.5], [18.5, 32.5], [12.5, 25.5], [41.5, 41.5], [9.5, 30.5], [16.5, 38.5]],
    colors: ['#fff4d6', '#ffe6a8'],
    slow: true,
  },
  // HQ's elevator: its call button glows on and off, as if someone upstairs called it
  elevator: { kind: 'blink', at: [[56.5, 53.5]], colors: ['#ffe9a8'], slow: true },
};

/** Every idle animation by drawing file, and every wall piece's by manifest key: for the spec check (animations.test.ts). */
export function animationSpecs(): { byFile: Record<string, AnimSpec[]>; walls: Record<string, WallSpec> } {
  return { byFile: BY_FILE, walls: WALL_SPECS };
}

/** Whether a floor object stands within a couple of tiles of a window in its room. */
function nearWindow(scene: SceneDef, o: SceneObject): boolean {
  return scene.objects.some((w) => {
    if (w.sprite !== 'window' || !w.wall) return false;
    if (w.wall === 'right') return o.y <= 2 && o.x >= w.x - 1 && o.x <= w.x + (w.w ?? 1);
    return o.x <= 2 && o.y >= w.y - 1 && o.y <= w.y + (w.d ?? w.w ?? 1);
  });
}

/** The pixels of a straight line between two pixels (Bresenham), both ends included. */
function pixelLine(a: P, b: P): P[] {
  const out: P[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x);
  const dy = -Math.abs(b[1] - y);
  const sx = x < b[0] ? 1 : -1;
  const sy = y < b[1] ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 512; n++) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** How big one pixel of a wall piece's drawing is on the wall (world px). */
function wallPixel(at: (p: P) => [number, number]): number {
  const [ax, ay] = at([0, 0]);
  const [bx, by] = at([1, 0]);
  const [, cy] = at([0, 1]);
  return Math.max(0.5, Math.min(Math.hypot(bx - ax, by - ay), Math.abs(cy - ay)));
}

/** A colour sliding slowly around a cycle of "r,g,b" colours. */
function mixCycle(colors: string[], t: number): string {
  const n = colors.length;
  const f = ((t % n) + n) % n;
  const a = colors[Math.floor(f)].split(',').map(Number);
  const b = colors[(Math.floor(f) + 1) % n].split(',').map(Number);
  const k = f - Math.floor(f);
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',');
}

function lerp2(a: P, b: P, t: number): P {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipQuad(c: CanvasRenderingContext2D, q: Quad) {
  c.beginPath();
  c.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 4; i++) c.lineTo(q[i][0], q[i][1]);
  c.closePath();
  c.clip();
}

/** The most common colour inside a quad of a drawing (unmirrored drawing px). */
function sampleColor(sprite: Sprite, q: Quad): string {
  const ctx = sprite.canvas.getContext('2d');
  if (!ctx) return '#3a2618';
  const w = sprite.canvas.width;
  const xs = q.map((p) => (sprite.mirrored ? w - p[0] : p[0]));
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1]))));
  const y1 = Math.min(sprite.canvas.height, Math.ceil(Math.max(...q.map((p) => p[1]))));
  if (x1 <= x0 || y1 <= y0) return '#3a2618';
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const count = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return '#3a2618';
  const [r, g, b] = best.split(',').map((v) => Number(v) * 8 + 4);
  return `rgb(${r},${g},${b})`;
}

/**
 * A placed piece's moving water, read off its drawing once (the town is walked into and out of often); each
 * piece has its own (two bird baths share a drawing, not their ripples).
 */
const waters = new WeakMap<Sprite, Map<string, Waterworks>>();
function waterOf(sprite: Sprite, id: string, spec: (typeof WATERWORKS)[string]): Waterworks {
  let byId = waters.get(sprite);
  if (!byId) waters.set(sprite, (byId = new Map()));
  let w = byId.get(id);
  if (!w) byId.set(id, (w = new Waterworks(sprite, spec)));
  return w;
}

/** The opaque bounds of a drawing (canvas px). */
function maskBox(sp: Sprite): { x0: number; y0: number; x1: number; y1: number } {
  const w = sp.canvas.width;
  const h = sp.canvas.height;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (sp.mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x + 1 > x1) x1 = x + 1;
        if (y < y0) y0 = y;
        if (y + 1 > y1) y1 = y + 1;
      }
  return x1 > x0 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: w, y1: h };
}

/** A drawing darkened, as if switched off (made once per object). */
function darkOf(l: Live): HTMLCanvasElement {
  if (l.dark) return l.dark;
  const src = l.sprite.canvas;
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(6,6,14,0.62)';
  g.fillRect(0, 0, cv.width, cv.height);
  l.dark = cv;
  return cv;
}
