/**
 * Hairstyles as hand-drawn pixel maps on the character frame. Each map is placed relative to the head box
 * (origin = head x0 − 2, y0 − 5, so column 2 / row 5 is the head's top-left) and tinted with the chosen hair
 * colour: '#' base, 'h' highlight, 's' shade, 'd' deep shade; '.' is empty. The outline is drawn around each
 * map automatically. `behind` maps are drawn before the body (long hair falling behind the shoulders).
 */
export interface HairMaps {
  front: string[];
  back: string[];
  behindFront?: string[];
  behindBack?: string[];
}

export const HAIR_ORIGIN = { dx: -2, dy: -5 };

export const HAIR: Record<string, HairMaps> = {
  short: {
    front: [
      '.........#..#..#',
      '.......#hh########',
      '.....##hhh#########',
      '....##hh##########s',
      '...##h#############ss',
      '..##h##############sss',
      '.##################sss',
      '.##################sss',
      '.###################ss',
      '.########ssssssssssssss',
      '.#######..s..s..s..s.ss',
      '.######',
      '.#####',
      '..###',
      '...##',
    ],
    back: [
      '........#..#..#',
      '......#hh########',
      '....##hhh##########',
      '...##hh#############',
      '..##h################',
      '.##h##################',
      '.#####################s',
      '.#####################s',
      '.#####################s',
      '.####################ss',
      '.####################ss',
      '.####################ss',
      '.####################ss',
      '.####################s.',
      '..###################s.',
      '..##################ss.',
      '...#################s..',
      '...################ss..',
      '....##s##s##s##s##s#...',
      '.....s..s..s..s..s.....',
    ],
  },
  long: {
    front: [
      '.......##########',
      '.....##hhhh########',
      '....##hhh###########',
      '...##hh##############',
      '..##h################s',
      '.##h#################ss',
      '.###################sss',
      '.###################sss',
      '.#########sssssssss#sss',
      '.######sss.........ssss',
      '.#####s.............sss',
      '.#####...............ss',
      '.####',
      '.####',
      '.####',
      '.###s',
      '.###s',
      '.##ss',
      '..#s',
    ],
    back: [
      '.......##########',
      '.....##hhhh########',
      '....##hhh###########',
      '...##hh##############',
      '..##h################s',
      '.##h##################s',
      '.#####################s',
      '.#####################s',
      '.#####################s',
      '.#####################s',
      '.#####################ss',
      '.#####################ss',
      '.#####################ss',
      '.######################s',
      '.######################s',
      '.######################s',
      '..#####################s',
      '..#####################s',
      '..####################ss',
      '..####################ss',
      '...##################ss',
      '...##s###s###s###s###s',
      '....s...s...s...s...s',
    ],
    behindFront: [
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '##s.................####',
      '##s.................####',
      '##s.................###s',
      '##s.................###s',
      '##s.................###s',
      '##s.................###s',
      '##s.................##ss',
      '##s.................##ss',
      '##s.................##ss',
      '#ss.................##s.',
      '#ss.................##s.',
      '#s..................#ss.',
      'ss..................#s..',
      's...................s...',
    ],
  },
  afro: {
    front: [
      '.........#.##.##.#.......',
      '......##############.....',
      '....##hhhh############...',
      '...#hhhhh##############..',
      '..#hhhh#################.',
      '.#hhh####################',
      '.#hh#####################s',
      '#hh######################s',
      '#h#######################ss',
      '#########################ss',
      '#########################ss',
      '##########################s',
      '##########################s',
      '###########sssssssss######s',
      '##########s.........s####s',
      '#########s............s##s',
      '########...............ss.',
      '#######',
      '.######',
      '.#####s',
      '..###s',
      '...#s',
    ],
    back: [
      '.........#.##.##.#.......',
      '......##############.....',
      '....##hhhh############...',
      '...#hhhhh##############..',
      '..#hhhh#################.',
      '.#hhh####################',
      '.#hh#####################s',
      '#hh######################s',
      '#h#######################ss',
      '#########################ss',
      '#########################ss',
      '##########################s',
      '##########################s',
      '##########################s',
      '##########################s',
      '.#########################s',
      '.########################ss',
      '..#######################s',
      '..######################ss',
      '...#####################s',
      '....##s##s##s##s##s##s#',
    ],
  },
};

/* ------------------------------------------------------------------ back-view form */

/**
 * How a style's hair grows, which decides how its back view is given form (formBackHair). Seen from behind the
 * hair is lit as one volume from the upper left; each texture adds its own detail on top:
 *   straight  combed locks fall from the crown: light streaks run down from a sheen across the back of the head,
 *             shade parts the locks from the ends up, and the ends come to points
 *   wavy      the same locks swinging side to side; each wave's crest catches the light
 *   curly     a pile of small curls, each lit on its own
 *   braided   plaited columns from the crown down
 *   locs      rope locs: rounded segments in columns from the crown down
 *   gathered  pulled back to a tie (a ponytail, pigtails, buns): the locks run to the tie; what's tied hangs as a
 *             lock (or sits as a bun) of its own
 *   crest     a mohawk: a strip of locks down the middle, the sides clipped to a scalp tint
 *   close     clipped close (a buzz): a soft sheen, fading to the scalp at the nape
 */
export type HairTexture = 'straight' | 'wavy' | 'curly' | 'braided' | 'locs' | 'gathered' | 'crest' | 'close';

/** A point on the back view's head box: column 0–21 (left to right), row 0–21 (crown to chin). */
type HeadPt = [number, number];

/**
 * A constructed back view, for styles whose structure is their silhouette (a tail, buns, a curtain of braids):
 * built from the head box, so it sits on the skull in every pose.
 */
export interface HairBuild {
  /** The nape hairline: the hair covers the skull down to this row. */
  hem: number;
  /** Pulled tight to the skull (tied-back hair): no volume past it, and the ear left clear. */
  tight?: boolean;
  /** Where the hair is tied, and what hangs from each tie (a tail) or sits on it (a bun). */
  ties?: Array<{ at: HeadPt; tail?: { to: HeadPt; width: number; swing?: number }; bun?: { at: HeadPt; r: number } }>;
  /** A parting down the back of the head, at this column. */
  parting?: number;
  /** Braids or locs hanging down the back: to this row, across these columns. */
  curtain?: { to: number; from: number; until: number };
  /** A mohawk: the style's own crest kept across these columns; elsewhere the hair is clipped to the skull. */
  crest?: [number, number];
}

export interface HairForm {
  texture: HairTexture;
  /** Cut at the nape: from behind nothing of it hangs below the head; the neck shows under the hairline. */
  cropped?: boolean;
  /** An undercut: from this head-box row down the hair is clipped to the scalp; the top overhangs it. */
  clipped?: number;
  build?: HairBuild;
}

export const HAIR_FORM: Record<string, HairForm> = {
  short: { texture: 'straight', cropped: true },
  crop: { texture: 'straight', cropped: true },
  pixie: { texture: 'straight', cropped: true },
  sidepart: { texture: 'straight', cropped: true },
  swoop: { texture: 'straight', cropped: true },
  undercut: { texture: 'straight', cropped: true, clipped: 13 },
  messy: { texture: 'straight', cropped: true },
  mohawk: { texture: 'crest', cropped: true, build: { hem: 17, tight: true, crest: [6, 15] } },
  buzz: { texture: 'close', cropped: true },
  curlyshort: { texture: 'curly', cropped: true },
  curly: { texture: 'curly' },
  afro: { texture: 'curly' },
  bob: { texture: 'straight' },
  mullet: { texture: 'straight' },
  long: { texture: 'straight' },
  bangs: { texture: 'straight' },
  wavy: { texture: 'wavy' },
  ponytail: {
    texture: 'gathered',
    cropped: true,
    build: { hem: 17, tight: true, ties: [{ at: [9, 7], tail: { to: [7, 33], width: 10, swing: -2 } }] },
  },
  pigtails: {
    texture: 'gathered',
    cropped: true,
    build: {
      hem: 17,
      tight: true,
      parting: 10,
      ties: [
        { at: [2, 14], tail: { to: [-3, 28], width: 10, swing: -2 } },
        { at: [19, 14], tail: { to: [24, 28], width: 10, swing: 2 } },
      ],
    },
  },
  bun: { texture: 'gathered', cropped: true, build: { hem: 17, tight: true, ties: [{ at: [10, 1], bun: { at: [10, -4], r: 5.5 } }] } },
  spacebuns: {
    texture: 'gathered',
    cropped: true,
    build: {
      hem: 17,
      tight: true,
      parting: 10,
      ties: [
        { at: [3, 3], bun: { at: [2, 0], r: 4.6 } },
        { at: [18, 3], bun: { at: [19, 0], r: 4.6 } },
      ],
    },
  },
  braids: { texture: 'braided', build: { hem: 17, curtain: { to: 38, from: -3, until: 24 } } },
  locs: { texture: 'locs', build: { hem: 17, curtain: { to: 34, from: -4, until: 25 } } },
};

export interface PlacedMap {
  x: number;
  y: number;
  rows: string[];
  /** Back views: how much of a two-tone highlight each pixel takes (0–1), so it lands on the ends of the hair. */
  ends?: number[][];
}

/** The frame anchors the back-view form reads (a structural subset of avatarFrame's Frame). */
interface HeadFrame {
  head: [number, number, number, number];
  hx: number;
}

type Grid = string[][];

/** The mass of a back-view map and where it sits on the head, in map coordinates. */
interface Geo {
  h: number;
  w: number;
  on: (r: number, c: number) => boolean;
  edge: (r: number, c: number) => boolean;
  /** The head box's top-left. */
  hy0: number;
  hx0: number;
  /** The crown whorl the hair falls from: at the top of the back of the head, left of centre. */
  wc: number;
  wr: number;
  /** The skull's widest row. */
  eq: number;
  /** Each column's top and bottom row, each row's left and right column (−1: none). */
  T: number[];
  /** Each column's top, smoothed over its neighbours (the contour the light follows). */
  top: number[];
  B: number[];
  L: number[];
  R: number[];
  bottom: number;
  /** It hangs well below the head (over the shoulders and down the back). */
  long: boolean;
}

/** A small, stable hash for staggering lengths and placing curls (the same look every frame). */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Give a back-view hair map form, driven by the map's own mask (or the style's constructed shape) and the
 * frame's head: the result is a tone map ('#' base, 'h' light, 'H' sheen, 's' shade, 'd' deep, 'l' line, 'k'/'K'
 * scalp tint and its shade; '.' empty) that the kit tints from the player's colour, so every style, colour and
 * pose gets the same treatment.
 *
 * The scalp (the standard's zone) is never cut: notches only happen below it.
 */
export function formBackHair(m: PlacedMap, F: HeadFrame, id: string, clip?: (x: number, y: number) => boolean): PlacedMap {
  const form = HAIR_FORM[id] ?? { texture: 'straight' };
  const built = form.build ? buildMass(m, F, form.build, clip) : undefined;
  const at = built ?? { x: m.x, y: m.y, g: massOf(m, F, form, clip), part: undefined };
  const g = at.g;
  const G = geometry(g, at, F);
  const { build } = form;
  const part = at.part;
  const tex = form.texture;
  const out: Grid =
    tex === 'curly'
      ? shadeCurls(g, G)
      : tex === 'close'
        ? shadeClose(g, G)
        : tex === 'gathered' && build && part
          ? shadeGathered(g, G, build, part)
          : (tex === 'braided' || tex === 'locs') && part
            ? shadeRopes(g, G, tex, part)
            : tex === 'crest' && build
              ? shadeCrest(g, G, build)
              : shadeLocks(g, G, form);
  if (form.clipped !== undefined) clipBelow(out, G, form.clipped);
  if (clip) underBrim(out, at, clip);
  // two-tone tips land on the ends: the lower part of the length (its edge ragged along the locks, not ruled
  // across), or what's tied (a tail's end, a bun); never the clipped scalp
  const ties = !!form.build?.ties;
  const ends = out.map((row, r) =>
    row.map((ch, c) => {
      if (ch === '.' || ch === 'k' || ch === 'K') return 0;
      const p = at.part?.[r]?.[c];
      if (ties) return p?.kind === 'tail' ? (p.t > 0.6 ? 0.72 : p.t > 0.38 ? 0.38 : 0) : p?.kind === 'bun' ? 0.72 : 0;
      const t = r / Math.max(1, out.length) + (hash(c >> 1, 5) - 0.5) * 0.1;
      return t > 0.78 ? 0.72 : t > 0.6 ? 0.38 : 0;
    }),
  );
  return { x: at.x, y: at.y, rows: out.map((row) => row.join('')), ends };
}

/**
 * An undercut: below its top the hair is clipped and hugs the skull, fading from stubble in the overhang's shadow
 * to the scalp tint at the nape; the top's edge overhangs it.
 */
function clipBelow(out: Grid, G: Geo, from: number) {
  const DOWN: Record<string, string> = { H: '#', h: '#', '#': 's', s: 'd', d: 'd' };
  for (let r = 0; r < G.h; r++) {
    const hr = r - G.hy0;
    if (hr < from - 1) continue;
    const [a, z] = SKULL[Math.max(0, Math.min(SKULL.length - 1, hr))];
    for (let c = 0; c < G.w; c++) {
      const t = out[r][c];
      if (t === '.') continue;
      const hc = c - G.hx0;
      if (hr === from - 1) out[r][c] = DOWN[t] ?? t;
      else if (hr > NAPE || hc < a || hc > Math.min(z, 19)) out[r][c] = '.';
      else if (hr < from + 2) out[r][c] = domeLight(hc, hr).lit < 0.3 ? 'd' : 's';
      else out[r][c] = domeLight(hc, hr).lit < 0.3 ? 'K' : 'k';
    }
  }
}

/**
 * Under a crown hat the light never reaches the top of the hair: just below the hat's edge the hair is in its
 * shadow (a step darker), and no sheen shows until well below it.
 */
function underBrim(out: Grid, at: { x: number; y: number }, clip: (x: number, y: number) => boolean) {
  const DOWN: Record<string, string> = { H: '#', h: '#', '#': 's', s: 'd', d: 'd', k: 'K' };
  const w = out[0]?.length ?? 0;
  for (let c = 0; c < w; c++) {
    // the hat's edge in this column: the first row it no longer covers
    let edge = -1;
    for (let r = 0; r < out.length; r++) if (clip(at.x + c, at.y + r)) edge = r + 1;
    if (edge < 0) continue;
    for (let r = edge; r < Math.min(out.length, edge + 6); r++) {
      const t = out[r][c];
      if (t === '.') continue;
      out[r][c] = r < edge + 2 ? (DOWN[t] ?? t) : t === 'H' || t === 'h' ? '#' : t;
    }
  }
}

/** The nape hairline on the back of the head (head-box row): hair covers the skull down to here. */
const NAPE = 17;

/** The back of the skull (the kit's back-view head), row by row: its left and right columns on the head box. */
const SKULL: HeadPt[] = [
  [6, 15],
  [4, 17],
  [3, 18],
  [2, 19],
  [1, 20],
  [1, 20],
  [0, 21],
  [0, 21],
  [0, 21],
  [0, 21],
  [0, 21],
  [0, 21],
  [0, 21],
  [1, 20],
  [1, 20],
  [2, 19],
  [3, 18],
  [4, 17],
  [6, 15],
  [8, 13],
];

/** What each constructed pixel belongs to: the dome, a tail (with where along it and how far off its axis), a bun. */
interface Part {
  kind: 'dome' | 'tail' | 'bun' | 'curtain';
  /** Which tie / bun. */
  i: number;
  /** Along the tail (0 at the tie, 1 at the tip); for a bun, its vertical offset (−1 top … 1 bottom). */
  t: number;
  /** Across the tail or bun (−1 left … 1 right). */
  off: number;
}

/** Build a constructed back view (HairBuild) as a mass in map coordinates. */
function buildMass(m: PlacedMap, F: HeadFrame, b: HairBuild, clip?: (x: number, y: number) => boolean) {
  const [x0, y0] = F.head;
  const cells = new Map<string, Part>();
  const key = (c: number, r: number) => `${c},${r}`;
  const put = (c: number, r: number, p: Part) => {
    if (clip?.(x0 + c, y0 + r)) return;
    const k = key(c, r);
    const was = cells.get(k);
    // tails and buns lie over the dome
    if (!was || was.kind === 'dome' || was.kind === 'curtain') cells.set(k, p);
  };
  // the dome over the skull, down to the nape hairline (a pixel of volume past the skull, unless pulled tight)
  for (let r = -1; r <= b.hem; r++) {
    const row = SKULL[Math.max(0, Math.min(SKULL.length - 1, r))];
    const tight = b.tight ? 0 : 1;
    const left = r < 0 ? row[0] + 1 : row[0] - (r < 14 ? 1 : tight);
    // the ear (rows 7–13 on the right) stays clear of tied-back hair
    const right = r < 0 ? row[1] - 1 : row[1] + (r >= 6 && r <= 14 ? tight : r < 14 ? 1 : tight);
    for (let c = left; c <= right; c++) put(c, r, { kind: 'dome', i: 0, t: 0, off: 0 });
  }
  if (b.crest) {
    // the style's own crest (its spikes above the head) across the crest's columns
    const [a, z] = b.crest;
    m.rows.forEach((row, rr) => {
      for (let cc = 0; cc < row.length; cc++) {
        if (row[cc] === '.') continue;
        const c = m.x + cc - x0;
        const r = m.y + rr - y0;
        if (c >= a && c <= z && r <= b.hem) put(c, r, { kind: 'dome', i: 0, t: 0, off: 0 });
      }
    });
  }
  if (b.curtain) {
    const { to, from, until } = b.curtain;
    for (let r = 8; r <= to + 2; r++) {
      // it widens from the sides of the head to hang straight past the shoulders
      const k = Math.min(1, (r - 8) / 9);
      const left = Math.round(0 + (from - 0) * k);
      const right = Math.round(21 + (until - 21) * k);
      for (let c = left; c <= right; c++) {
        // each rope ends at its own length; the outer ones a little shorter
        const edge = Math.min(c - from, until - c);
        const end = to - (edge < 2 ? 2 - edge : 0) - Math.floor(hash(c >> 2, 11) * 3);
        if (r <= end) put(c, r, { kind: 'curtain', i: 0, t: 0, off: 0 });
      }
    }
  }
  (b.ties ?? []).forEach((tie, i) => {
    if (tie.tail) {
      // a teardrop along a gently swinging axis: pinched at the tie, full just below it, tapering to the tip
      const [ax, ay] = tie.at;
      const [bx, by] = tie.tail.to;
      const cx = (ax + bx) / 2 + (tie.tail.swing ?? 0);
      const cy = (ay + by) / 2;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= 1.0001; s += 0.04)
        pts.push([(1 - s) * (1 - s) * ax + 2 * (1 - s) * s * cx + s * s * bx, (1 - s) * (1 - s) * ay + 2 * (1 - s) * s * cy + s * s * by]);
      const half = (s: number) => (tie.tail!.width / 2) * Math.min(1, 0.5 + s * 4) * Math.pow(Math.max(0, 1 - s * s * s), 0.6);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const W2 = tie.tail.width / 2 + 1;
      for (let r = Math.floor(Math.min(...ys)) - 1; r <= Math.ceil(Math.max(...ys)) + 1; r++)
        for (let c = Math.floor(Math.min(...xs) - W2); c <= Math.ceil(Math.max(...xs) + W2); c++) {
          let best = Infinity;
          let bs = 0;
          pts.forEach(([px, py], j) => {
            const d = Math.hypot(c - px, r - py);
            if (d < best) {
              best = d;
              bs = j / (pts.length - 1);
            }
          });
          const hw = half(bs);
          if (best <= hw + 0.35 && hw > 0.4) {
            // which side of the axis
            const j = Math.round(bs * (pts.length - 1));
            const [px, py] = pts[j];
            const [qx, qy] = pts[Math.min(pts.length - 1, j + 1)];
            const side = (qx - px) * (r - py) - (qy - py) * (c - px) > 0 ? -1 : 1;
            put(c, r, { kind: 'tail', i, t: bs, off: Math.max(-1, Math.min(1, (side * best) / Math.max(1, hw))) });
          }
        }
    }
    if (tie.bun) {
      const [bx, by] = tie.bun.at;
      const R = tie.bun.r;
      for (let r = Math.floor(by - R); r <= Math.ceil(by + R); r++)
        for (let c = Math.floor(bx - R); c <= Math.ceil(bx + R); c++)
          if (Math.hypot(c - bx, (r - by) * 1.08) <= R) put(c, r, { kind: 'bun', i, t: (r - by) / R, off: (c - bx) / R });
    }
  });
  // into a grid
  const ks = [...cells.keys()].map((k) => k.split(',').map(Number));
  const minC = Math.min(...ks.map((k) => k[0]));
  const minR = Math.min(...ks.map((k) => k[1]));
  const w = Math.max(...ks.map((k) => k[0])) - minC + 1;
  const h = Math.max(...ks.map((k) => k[1])) - minR + 1;
  const g: Grid = Array.from({ length: h }, () => new Array<string>(w).fill('.'));
  const part: Array<Array<Part | undefined>> = Array.from({ length: h }, () => new Array<Part | undefined>(w).fill(undefined));
  for (const [k, p] of cells) {
    const [c, r] = k.split(',').map(Number);
    g[r - minR][c - minC] = '#';
    part[r - minR][c - minC] = p;
  }
  return { x: x0 + minC, y: y0 + minR, g, part };
}

/**
 * The mass: the map's own silhouette, cleaned of what generation leaves behind (a thread, a slab on the collar
 * hanging by a thin stem, pinholes) and cut at the nape for cropped styles. Every kept pixel is '#'.
 */
function massOf(m: PlacedMap, F: HeadFrame, form: HairForm, clip?: (x: number, y: number) => boolean): Grid {
  const h = m.rows.length;
  const w = Math.max(0, ...m.rows.map((r) => r.length));
  const g: Grid = m.rows.map((row, r) =>
    Array.from({ length: w }, (_, c) => {
      const ch = row[c] ?? '.';
      return ch === '.' || clip?.(m.x + c, m.y + r) ? '.' : '#';
    }),
  );
  const on = (r: number, c: number) => r >= 0 && c >= 0 && r < h && c < w && g[r][c] !== '.';
  const hy0 = F.head[1] - m.y;
  const scalpEnd = hy0 + 16;
  // below the skull, hair has body: it hangs from the hair on the head as a mass at least three pixels thick
  const nape = hy0 + 19;
  // a cropped style ends at the nape: whatever generation left below it (on the neck, the collar) goes
  if (form.cropped) for (let r = nape + 2; r < h; r++) g[r]?.fill('.');
  {
    // which pixels start a solid 3×3 block (hair with body), and so which lie in one
    const full3 = g.map((row, r) =>
      row.map((_, c) => {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!on(r + i, c + j)) return false;
        return true;
      }),
    );
    const body = (r: number, c: number) => {
      if (r < nape) return on(r, c);
      for (let dr = -2; dr <= 0; dr++) for (let dc = -2; dc <= 0; dc++) if (full3[r + dr]?.[c + dc]) return true;
      return false;
    };
    const hangs = g.map(() => new Array<boolean>(w).fill(false));
    const q: Array<[number, number]> = [];
    for (let r = 0; r < Math.min(nape, h); r++)
      for (let c = 0; c < w; c++)
        if (on(r, c)) {
          hangs[r][c] = true;
          q.push([r, c]);
        }
    while (q.length) {
      const [r, c] = q.pop()!;
      for (const [rr, cc] of [
        [r + 1, c],
        [r - 1, c],
        [r, c - 1],
        [r, c + 1],
      ] as const)
        if (rr >= 0 && rr < h && cc >= 0 && cc < w && !hangs[rr][cc] && body(rr, cc)) {
          hangs[rr][cc] = true;
          q.push([rr, cc]);
        }
    }
    // keep what hangs (and its one-pixel rim); of the rest, keep what falls like hair (taller than it is wide)
    const loose = g.map(() => new Array<boolean>(w).fill(false));
    for (let r = nape; r < h; r++)
      for (let c = 0; c < w; c++) {
        if (!on(r, c)) continue;
        let near = false;
        for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1 && !near; dc++) near = !!hangs[r + dr]?.[c + dc];
        loose[r][c] = !near;
      }
    for (let r0 = nape; r0 < h; r0++)
      for (let c0 = 0; c0 < w; c0++) {
        if (!loose[r0][c0]) continue;
        const piece: Array<[number, number]> = [[r0, c0]];
        loose[r0][c0] = false;
        for (let k = 0; k < piece.length; k++) {
          const [r, c] = piece[k];
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++)
              if (loose[r + dr]?.[c + dc]) {
                loose[r + dr][c + dc] = false;
                piece.push([r + dr, c + dc]);
              }
        }
        const rs = piece.map((p) => p[0]);
        const cs = piece.map((p) => p[1]);
        const tall = Math.max(...rs) - Math.min(...rs) + 1;
        const wide = Math.max(...cs) - Math.min(...cs) + 1;
        if (tall < 5 || tall < wide * 1.5) for (const [r, c] of piece) g[r][c] = '.';
      }
  }
  for (let pass = 0; pass < 2; pass++) {
    // no pixel-thin threads (a pixel that isn't part of any solid 2×2)
    const keep = (r: number, c: number) =>
      (on(r, c - 1) && on(r - 1, c - 1) && on(r - 1, c)) ||
      (on(r, c + 1) && on(r - 1, c + 1) && on(r - 1, c)) ||
      (on(r, c - 1) && on(r + 1, c - 1) && on(r + 1, c)) ||
      (on(r, c + 1) && on(r + 1, c + 1) && on(r + 1, c));
    const drop: Array<[number, number]> = [];
    for (let r = scalpEnd; r < h; r++) for (let c = 0; c < w; c++) if (on(r, c) && !keep(r, c)) drop.push([r, c]);
    for (const [r, c] of drop) g[r][c] = '.';
  }
  // the mass is whole: pinholes, pixel-wide slits and enclosed gaps are filled
  for (let pass = 0; pass < 2; pass++) {
    const fill: Array<[number, number]> = [];
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) if (!on(r, c) && ((on(r, c - 1) && on(r, c + 1)) || (on(r - 1, c) && on(r + 1, c)))) fill.push([r, c]);
    for (const [r, c] of fill) g[r][c] = '#';
  }
  const outside = g.map((row) => row.map(() => false));
  const q: Array<[number, number]> = [];
  for (let r = 0; r < h; r++) for (const c of [0, w - 1]) q.push([r, c]);
  for (let c = 0; c < w; c++) q.push([0, c], [h - 1, c]);
  while (q.length) {
    const [r, c] = q.pop()!;
    if (r < 0 || c < 0 || r >= h || c >= w || outside[r][c] || on(r, c)) continue;
    outside[r][c] = true;
    q.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (!on(r, c) && !outside[r][c]) g[r][c] = '#';
  {
    // the back of the skull is hair down to the nape hairline (skin shows only at the neck and the ear)
    const hx0 = F.head[0] - m.x;
    for (let hr = 12; hr <= NAPE; hr++) {
      const [a, z] = SKULL[hr];
      for (let hc = a; hc <= Math.min(z, 19); hc++) {
        const r = hy0 + hr;
        const c = hx0 + hc;
        if (r >= 0 && r < h && c >= 0 && c < w && !clip?.(m.x + c, m.y + r)) g[r][c] = '#';
      }
    }
  }
  if (form.texture === 'curly') {
    // a head of curls is round on top: a notch in the crown (it reads as a cleft) is filled level with its sides
    const top = Array.from({ length: w }, (_, c) => g.findIndex((row) => row[c] !== '.'));
    const high = (cs: number[]) => Math.min(...cs.map((c) => (top[c] >= 0 ? top[c] : Infinity)));
    for (let c = 0; c < w; c++) {
      if (top[c] < 0 || top[c] > hy0 + 8) continue;
      const level = Math.max(high([c - 1, c - 2, c - 3]), high([c + 1, c + 2, c + 3]));
      for (let r = level; r < top[c] && Number.isFinite(level); r++) g[r][c] = '#';
    }
  }
  return g;
}

function geometry(g: Grid, m: { x: number; y: number }, F: HeadFrame): Geo {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const on = (r: number, c: number) => r >= 0 && c >= 0 && r < h && c < w && g[r][c] !== '.';
  const edge = (r: number, c: number) => on(r, c) && (!on(r - 1, c) || !on(r + 1, c) || !on(r, c - 1) || !on(r, c + 1));
  const hy0 = F.head[1] - m.y;
  const hx0 = F.head[0] - m.x;
  const L: number[] = [];
  const R: number[] = [];
  for (let r = 0; r < h; r++) {
    L[r] = g[r].findIndex((ch) => ch !== '.');
    R[r] = L[r] < 0 ? -1 : w - 1 - [...g[r]].reverse().findIndex((ch) => ch !== '.');
  }
  const T: number[] = [];
  const B: number[] = [];
  for (let c = 0; c < w; c++) {
    T[c] = -1;
    B[c] = -1;
    for (let r = 0; r < h; r++)
      if (g[r][c] !== '.') {
        if (T[c] < 0) T[c] = r;
        B[c] = r;
      }
  }
  const bottom = Math.max(...B);
  const top = T.map((_, c) => {
    const ts = [T[c - 1], T[c], T[c + 1]].filter((t) => t !== undefined && t >= 0);
    return ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : -1;
  });
  const eq = Math.min(hy0 + 11, h - 1);
  const wc = F.hx - 2 - m.x;
  return { h, w, on, edge, hy0, hx0, wc, wr: hy0 + 1, eq, T, top, B, L, R, bottom, long: bottom > hy0 + 24 };
}

/**
 * The light on one volume of hair, lit from the upper left: how much light each pixel's surface catches (about
 * −0.2 in the far shade to 1 on the crown), from the mass's own silhouette. The top of the hair faces up; the
 * sides turn away; the underside at a cropped nape tucks in.
 */
function volumeLight(G: Geo, r: number, c: number, cropped: boolean) {
  const { L, R, B } = G;
  const half = Math.max(3, (R[r] - L[r]) / 2);
  const nx = Math.max(-1, Math.min(1, (c - (L[r] + R[r]) / 2) / half));
  const dt = r - (G.top[c] >= 0 ? G.top[c] : r);
  let ny = dt < 7 ? -(1 - dt / 7) * 0.85 : 0;
  if (cropped && r > G.eq) ny = Math.max(ny, Math.min(0.8, (r - G.eq) / Math.max(4, B[c] - G.eq)) * 0.8);
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return { lit: -0.45 * nx - 0.5 * ny + 0.74 * nz, nx, dt };
}

/** Tone steps, lightest first, and the value each needs. */
const RAMP: Array<[string, number]> = [
  ['H', 1.12],
  ['h', 0.92],
  ['#', 0.38],
  ['s', 0.12],
  ['d', -Infinity],
];
const toneOf = (v: number) => RAMP.find(([, t]) => v >= t)![0];

/**
 * Locks (straight and wavy hair). Strands fan out from the crown whorl over the back of the skull and fall
 * straight below it (swinging side to side if wavy). The light on the volume is broken up along those strands:
 *   - each lock is rounder than the mass, lit on its left and creased on its right, and the creases deepen toward
 *     the ends, so shade rises from the tips between the locks in tapering fingers of different lengths
 *   - a sheen band crosses the upper back of the head and catches on the locks as short streaks
 *   - where a crease reaches the ends below the skull, the tips part in a notch
 */
function shadeLocks(g: Grid, G: Geo, form: HairForm): Grid {
  const { on, edge, eq, wc, wr, B } = G;
  const Le = G.L[eq];
  const out: Grid = g.map((row) => row.map((ch) => (ch === '.' ? '.' : '#')));
  if (Le < 0) return out;
  const wavy = form.texture === 'wavy';
  const long = G.long;
  const fan = (r: number) => Math.min(1.8, (eq - wr) / Math.max(1, r - wr));
  // the flow: the column a strand through (r, c) falls at, below the skull's widest row
  const flow = (r: number, c: number) => (r >= eq ? (wavy ? c - Math.sin(((r - eq) / 9) * Math.PI * 2) * 1.8 : c) : wc + (c - wc) * fan(r));
  // lock boundaries (creases), spaced unevenly across the whole mass
  const SP = [5, 4, 6, 4, 5, 6];
  const minL = Math.min(...G.L.filter((v) => v >= 0));
  const maxR = Math.max(...G.R);
  const bounds: number[] = [];
  for (let u = Le + 2, i = 0; u <= maxR + 10; u += SP[i++ % SP.length]) bounds.push(u);
  for (let u = Le + 2 - 5; u >= minL - 10; u -= 5) bounds.unshift(u);
  // how far each crease's shade rises from the ends
  const RISE = long ? [14, 22, 11, 18, 13, 24, 10] : [5, 7, 4, 6, 5, 7, 4];
  // and how far each lock's light runs down from the sheen
  const FALL = long ? [9, 15, 6, 12, 18, 8] : [3, 5, 2, 4, 5, 3];
  const sheenAt = long ? 4.5 : 4;
  for (let r = 0; r < G.h; r++)
    for (let c = 0; c < G.w; c++) {
      if (!on(r, c) || edge(r, c)) continue;
      const { lit, nx, dt } = volumeLight(G, r, c, !!form.cropped);
      const u = flow(r, c);
      let k = 0;
      while (k + 1 < bounds.length && bounds[k + 1] <= u) k++;
      const t = (u - bounds[k]) / Math.max(1, (bounds[k + 1] ?? bounds[k] + 5) - bounds[k]);
      // the lock's own roundness: its crest a third of the way in, the crease at its right-hand edge
      const hem = B[c] - r;
      const rise = RISE[(k + 3) % RISE.length];
      const deep = hem < rise ? 1 - hem / rise : 0;
      const grow = Math.min(1, Math.max(0, (dt - 1) / 3));
      const crest = Math.cos((t - 0.3) * Math.PI * 2);
      let val = lit + grow * (0.12 + 0.2 * deep) * crest - 0.12 * deep * deep + (hash(k, 7) - 0.5) * 0.1;
      // waves: each wave's crest bulges toward us and catches the light, its trough falls into shade
      if (wavy && r > eq - 3) val += 0.2 * Math.cos(((r - eq) / 9) * Math.PI * 2 + (c - wc) * 0.22);
      // light runs down the crest of each lock on the lit side, fading as it goes
      const fall = FALL[(k + 5) % FALL.length];
      const down = dt - sheenAt;
      if (nx < 0.35 && crest > 0.55 && down >= 0 && down < fall) val += 0.24 * (1 - down / fall);
      // the crease between locks: a shade line from the ends up, deep near the ends
      if (crest < -0.6 && deep > 0.08) val = Math.min(val, deep > 0.5 ? 0.1 : 0.3);
      // the sheen: a band across the upper back of the head, strongest left of centre, caught by the crests
      const band = Math.exp(-(((dt - sheenAt) / 1.3) ** 2)) * Math.max(0, 1 - ((nx + 0.25) / 0.75) ** 2);
      val += band * (0.3 + 0.18 * crest);
      out[r][c] = toneOf(val);
    }
  despeckle(out, g);
  // tips: where a crease reaches the ends below the skull, the hair parts in a notch
  const scalpEnd = G.hy0 + NAPE + 1;
  for (const b of bounds) {
    const c = Math.round(b + 0.8 * 5 - 0.5);
    const bot = B[c];
    if (bot === undefined || bot < scalpEnd) continue;
    const cut = (rr: number, cc: number) => {
      if (rr >= scalpEnd && on(rr, cc) && rr === B[cc]) out[rr][cc] = '.';
    };
    cut(bot, c);
    if (long) {
      if (on(bot - 1, c) && bot - 1 >= scalpEnd && on(bot - 1, c - 1) && on(bot - 1, c + 1)) out[bot - 1][c] = '.';
      cut(B[c + 1], c + 1);
    }
  }
  return out;
}

/** A lone pixel of one tone amid another (dither noise, not form) takes its neighbours' most common tone. */
function despeckle(out: Grid, g: Grid) {
  const h = out.length;
  const w = out[0]?.length ?? 0;
  for (let pass = 0; pass < 2; pass++)
    for (let r = 1; r < h - 1; r++)
      for (let c = 1; c < w - 1; c++) {
        const t = out[r][c];
        if (t === '.' || g[r][c] === '.') continue;
        const n0 = out[r - 1][c];
        const n1 = out[r + 1][c];
        const n2 = out[r][c - 1];
        const n3 = out[r][c + 1];
        if (n0 === '.' || n1 === '.' || n2 === '.' || n3 === '.' || n0 === t || n1 === t || n2 === t || n3 === t) continue;
        const ns = [n0, n1, n2, n3];
        let best = n0;
        let most = 0;
        for (const x of ns) {
          let k = 0;
          for (const y of ns) if (y === x) k++;
          if (k > most) {
            most = k;
            best = x;
          }
        }
        out[r][c] = best;
      }
}

/** Clipped close: one volume with a soft sheen, fading to the scalp at the nape. */
function shadeClose(g: Grid, G: Geo): Grid {
  const { on, edge, eq } = G;
  const out: Grid = g.map((row, r) =>
    row.map((ch, c) => {
      if (ch === '.') return '.';
      if (edge(r, c)) return '#';
      const { lit, nx, dt } = volumeLight(G, r, c, true);
      if (r > eq + 4 && !on(r + 2, c)) return lit < 0.3 ? 'K' : 'k';
      const band = Math.exp(-(((dt - 3.5) / 1.2) ** 2)) * Math.max(0, 1 - ((nx + 0.25) / 0.75) ** 2);
      return toneOf(lit + band * 0.3 - 0.04);
    }),
  );
  despeckle(out, g);
  return out;
}

/**
 * Curls: one volume, its light in broad zones, with small curls scattered over it (staggered and jittered, so
 * they never line up): each curl a lit top-left and a shaded underside, a step either side of its zone's tone.
 * The outline's bumps are the style's own.
 */
function shadeCurls(g: Grid, G: Geo): Grid {
  const { on, edge } = G;
  const step: number[][] = g.map((row, r) =>
    row.map((ch, c) => {
      if (ch === '.' || edge(r, c)) return NaN;
      const { lit, nx, dt } = volumeLight(G, r, c, false);
      const band = Math.exp(-(((dt - 4) / 1.5) ** 2)) * Math.max(0, 1 - ((nx + 0.25) / 0.75) ** 2);
      return stepOf(lit + band * 0.22);
    }),
  );
  const out: Grid = g.map((row, r) => row.map((ch, c) => (ch === '.' ? '.' : Number.isNaN(step[r][c]) ? '#' : toneAt(step[r][c]))));
  // scattered, never in rows: candidates on a fine grid, each kept by chance if it's clear of the curls so far
  const curls: Array<[number, number, number]> = [];
  for (let r = 1; r < G.h - 1; r += 2)
    for (let c = 1; c < G.w - 1; c += 2) {
      const cr = r + Math.floor(hash(c, r) * 2);
      const cc = c + Math.floor(hash(r + 99, c) * 2);
      if (hash(cr * 7, cc * 3) > 0.8 || !on(cr, cc) || Number.isNaN(step[cr][cc])) continue;
      const size = hash(cc, cr + 31) < 0.35 ? 2 : 1;
      if (curls.some(([r2, c2, s2]) => Math.hypot(r2 - cr, (c2 - cc) * 0.9) < 2 + size + s2)) continue;
      curls.push([cr, cc, size]);
    }
  for (const [cr, cc, size] of curls) {
    const mark = (dr: number, dc: number, d: number) => {
      const r = cr + dr;
      const c = cc + dc;
      if (on(r, c) && !Number.isNaN(step[r]?.[c])) out[r][c] = toneAt(step[r][c] + d);
    };
    // each curl's underside turns away into shade (a crescent on its lower right); where the light is strong its
    // top-left catches it (some curls only, so they don't pattern)
    const base = step[cr][cc];
    if (base >= 3 || (base === 2 && hash(cc + 7, cr) < 0.4)) {
      if (size === 2) [[-2, 0], [-2, -1], [-1, -2], [0, -2]].forEach(([dr, dc]) => mark(dr, dc, 1));
      else [[-1, 0], [-1, -1], [0, -1]].forEach(([dr, dc]) => mark(dr, dc, 1));
    }
    if (size === 2) [[0, 2], [1, 2], [2, 1], [2, 0]].forEach(([dr, dc]) => mark(dr, dc, -1));
    else [[0, 1], [1, 1], [1, 0]].forEach(([dr, dc]) => mark(dr, dc, -1));
  }
  return out;
}

/** Tone steps as numbers (0 deep … 4 sheen), for textures that add their own detail to the volume's light. */
const STEPS = ['d', 's', '#', 'h', 'H'];
const stepOf = (v: number) => Math.max(0, RAMP.length - 1 - RAMP.findIndex(([, t]) => v >= t));
const toneAt = (step: number) => STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.round(step)))];
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** The light on the skull's dome (a sphere on the head box) at a head-box point. */
function domeLight(hc: number, hr: number) {
  const nx = clamp1((hc - 10.5) / 11.5);
  const ny = clamp1((hr - 10.5) / 11.5);
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return { lit: -0.45 * nx - 0.5 * ny + 0.74 * nz, nx };
}

/** Each column's top row among the pixels of one kind of part. */
function topsOf(part: Array<Array<Part | undefined>>, kind: Part['kind']) {
  const w = part[0]?.length ?? 0;
  return Array.from({ length: w }, (_, c) => part.findIndex((row) => row[c]?.kind === kind));
}

/**
 * Gathered hair (a ponytail, pigtails, buns). On the dome the locks run to the tie, tightening as they near it (the
 * creases deepen), with the sheen across the upper back of the head; a parting shows the scalp down the middle.
 * The tie is a dark band; a tail hangs from it as one lock of its own (full below the tie, tapering to its tip,
 * creased toward the end); a bun is a ball of hair with its wrap spiralling in.
 */
function shadeGathered(g: Grid, G: Geo, b: HairBuild, part: Array<Array<Part | undefined>>): Grid {
  const { on, edge, hy0, hx0 } = G;
  const out: Grid = g.map((row) => row.map((ch) => (ch === '.' ? '.' : '#')));
  const ties = b.ties ?? [];
  const domeTop = topsOf(part, 'dome');
  for (let r = 0; r < G.h; r++)
    for (let c = 0; c < G.w; c++) {
      const p = part[r][c];
      if (!on(r, c) || !p || edge(r, c)) continue;
      const hr = r - hy0;
      const hc = c - hx0;
      if (p.kind === 'dome' || p.kind === 'curtain') {
        const { lit, nx } = domeLight(hc, hr);
        if (b.parting !== undefined && hc === b.parting && hr >= 0 && hr < b.hem - 1) {
          out[r][c] = lit < 0.3 ? 'K' : 'k';
          continue;
        }
        // the strands run to the tie on this side of the parting (or the nearest)
        const mine = ties.filter((t) => b.parting === undefined || t.at[0] < b.parting === hc < b.parting);
        const tie = (mine.length ? mine : ties).reduce((best, t) => (Math.hypot(hc - t.at[0], hr - t.at[1]) < Math.hypot(hc - best.at[0], hr - best.at[1]) ? t : best));
        const dx = hc - tie.at[0];
        const dy = hr - tie.at[1];
        const dist = Math.hypot(dx, dy);
        const u = (Math.atan2(dx, dy) * 7) / 4.5;
        const crest = Math.cos((u - Math.floor(u) - 0.3) * Math.PI * 2);
        const tension = Math.max(0, 1 - dist / 9);
        const grow = Math.min(1, dist / 3);
        let val = lit + grow * (0.12 + 0.2 * tension) * crest - 0.12 * tension;
        const dt = r - domeTop[c];
        const band = Math.exp(-(((dt - 3.5) / 1.3) ** 2)) * Math.max(0, 1 - ((nx + 0.25) / 0.75) ** 2);
        val += band * (0.3 + 0.18 * crest);
        // beside the parting, the hair rolls away from it into shade
        if (b.parting !== undefined && hc === b.parting + 1) val -= 0.3;
        out[r][c] = toneOf(val);
      } else if (p.kind === 'tail') {
        const tie = ties[p.i];
        const tail = tie.tail!;
        const len = Math.hypot(tail.to[0] - tie.at[0], tail.to[1] - tie.at[1]);
        const along = p.t * len;
        if (along < 1.5) {
          out[r][c] = 'l';
          continue;
        }
        const nx = p.off;
        let val = -0.45 * nx + 0.74 * Math.sqrt(Math.max(0, 1 - nx * nx)) + 0.1 - 0.32 * p.t;
        // the fullness just below the tie catches the light
        val += 0.3 * Math.exp(-(((p.t - 0.22) / 0.12) ** 2)) * Math.max(0, 1 - ((nx + 0.3) / 0.8) ** 2);
        const u = ((nx + 1) * tail.width) / 2 / 3;
        const crest = Math.cos((u - Math.floor(u) - 0.3) * Math.PI * 2);
        val += (0.1 + 0.22 * p.t) * crest - 0.1 * p.t * p.t;
        // right under the tie, in its shadow
        if (along < 3) val -= 0.3;
        out[r][c] = toneOf(val);
      } else {
        // a bun: a ball, its wrap spiralling in
        const nx = clamp1(p.off);
        const ny = clamp1(p.t);
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const lit = -0.45 * nx - 0.5 * ny + 0.74 * nz + 0.05;
        const rho = Math.hypot(nx, ny);
        const f = (((rho * 1.6 - Math.atan2(ny, nx) / (Math.PI * 2)) % 1) + 1) % 1;
        const groove = f < 0.18 && rho > 0.25 && rho < 0.95;
        out[r][c] = toneOf(groove ? Math.min(lit - 0.4, 0.3) : lit + 0.08 * Math.cos(f * Math.PI * 2));
      }
    }
  despeckle(out, g);
  return out;
}

/**
 * Braids and locs: ropes from the crown down. On the back of the head they fan out from the crown like any locks;
 * below it they hang in columns, a crease between each. Braids are plaited (the light steps from side to side
 * every row); locs are rounded segments. The volume's light (and the sheen) shift each rope's own tones.
 */
function shadeRopes(g: Grid, G: Geo, texture: 'braided' | 'locs', part: Array<Array<Part | undefined>>): Grid {
  const { on, edge, eq, wc, wr, B } = G;
  const out: Grid = g.map((row) => row.map((ch) => (ch === '.' ? '.' : '#')));
  const Le = G.L[eq];
  if (Le < 0) return out;
  const pitch = texture === 'braided' ? 4 : 5;
  const fan = (r: number) => Math.min(1.8, (eq - wr) / Math.max(1, r - wr));
  const flow = (r: number, c: number) => (r >= eq ? c : wc + (c - wc) * fan(r));
  const domeTop = topsOf(part, 'dome');
  for (let r = 0; r < G.h; r++)
    for (let c = 0; c < G.w; c++) {
      if (!on(r, c) || edge(r, c)) continue;
      const { lit, nx } = volumeLight(G, r, c, false);
      const dt = r - (domeTop[c] >= 0 ? domeTop[c] : G.T[c]);
      const band = Math.exp(-(((dt - 4) / 1.3) ** 2)) * Math.max(0, 1 - ((nx + 0.25) / 0.75) ** 2);
      const macro = stepOf(lit + band * 0.3) - 2;
      const u = flow(r, c) - Le;
      const j = Math.floor(u / pitch);
      const x = Math.floor(u - j * pitch);
      const crease = x === pitch - 1;
      let local: number;
      if (dt < 3) local = crease ? -1 : 0;
      // a plait: a bead every two rows, its top lit, its underside in shade (neighbouring braids staggered)
      else if (texture === 'braided') local = crease ? -2 : (r + j) % 2 === 0 ? [1, 1, 0][x] : [0, -1, -1][x];
      else local = crease ? -2 : Math.round([0.6, 0, -0.7][(((r + j * 2) % 3) + 3) % 3] + [0, 0.5, 0.2, -0.6][x]);
      let step = 2 + macro + local;
      // the ends: each rope's last pixel is its underside
      if (B[c] - r === 0 && r > eq) step -= 1;
      out[r][c] = toneAt(step);
      // the ropes part at the ends
      if (crease && r > eq + 8 && B[c] - r <= 1) out[r][c] = '.';
    }
  despeckle(out, g);
  return out;
}

/** A mohawk: the crest a ridge of locks down the middle of the back of the head, lit on its left; the sides are
 *  clipped to the scalp (its tint, shaded round the skull). */
function shadeCrest(g: Grid, G: Geo, b: HairBuild): Grid {
  const { on, edge, hy0, hx0 } = G;
  const [a, z] = b.crest!;
  const mid = (a + z) / 2;
  const half = (z - a) / 2;
  return g.map((row, r) =>
    row.map((ch, c) => {
      if (ch === '.') return '.';
      if (edge(r, c)) return '#';
      const hc = c - hx0;
      const hr = r - hy0;
      if (hc < a || hc > z) return domeLight(hc, hr).lit < 0.3 ? 'K' : 'k';
      const off = clamp1((hc - mid) / half);
      const u = (hc - a) / 3;
      const crest = Math.cos((u - Math.floor(u) - 0.3) * Math.PI * 2);
      let val = 0.62 - 0.55 * off + 0.14 * crest + (hr < 0 ? 0.12 : 0);
      if (hr > 12) val -= (hr - 12) * 0.08;
      // the crest stands off the scalp: its edges beside the clipped sides are in shade
      if (!on(r, c - 2) || !on(r, c + 2)) val -= 0.15;
      return toneOf(val);
    }),
  );
}
