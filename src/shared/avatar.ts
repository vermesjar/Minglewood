/**
 * Composable avatar catalog. Items are data; the client renderer draws each slot as a layer.
 * New items (swag, event rewards, tenure pins) are added here and granted via `Member.unlockedItems`.
 * Nothing is purchasable — items come from participation and belonging.
 */
import type { AvatarLoadout } from './domain/types';

export type AvatarSlot =
  | 'hair'
  | 'top'
  | 'bottom'
  | 'shoes'
  | 'accessory'
  | 'eyes'
  | 'brows'
  | 'mouth'
  | 'facialHair'
  | 'faceDetail'
  | 'headwear'
  | 'eyewear'
  | 'neck'
  | 'topPattern'
  | 'held'
  | 'pet'
  | 'mobility'
  | 'body';

export interface AvatarItem {
  id: string;
  slot: AvatarSlot;
  name: string;
  /** How you get it. Absent = available to everyone. */
  unlock?: { kind: 'event' | 'tenure' | 'team' | 'launch'; description: string };
  /** Hides the hair (hijab, turban). */
  coversHair?: boolean;
  /** Hides the ears as well (a hijab wraps them; a turban leaves them out). */
  coversEars?: boolean;
  /** Replaces the bottoms (dresses, long coats show them only below the hem). */
  fullLength?: boolean;
}

/* ------------------------------------------------------------------ palettes */

export const SKIN_TONES = [
  '#ffe6d0',
  '#ffdcbf',
  '#f6c9a4',
  '#eab58d',
  '#d99e74',
  '#c98d62',
  '#b3764c',
  '#9a5f3a',
  '#7c4a2d',
  '#643721',
  '#4e2a18',
];
/** Just for fun: fantasy tones for the days you feel like a forest spirit. */
export const FANTASY_SKIN = ['#9fe0b5', '#a8d4ff', '#d4b8ff', '#ffb8d9', '#c9ced6'];

export const HAIR_COLORS = [
  '#1f1612',
  '#3b2518',
  '#5a3825',
  '#8a5a32',
  '#b67a45',
  '#d9a35b',
  '#e8c16d',
  '#f5e0a0',
  '#b8432e',
  '#e0703a',
  '#9aa0a8',
  '#e8e6e1',
  '#e27ca7',
  '#9b6bd6',
  '#4a6fd1',
  '#2bb3a3',
  '#7cc576',
];

export const EYE_COLORS = ['#2a1f2d', '#5a3825', '#3f7fbf', '#3f9a6b', '#8a6a3b', '#7a7f88', '#9b6bd6'];

export const CLOTH_COLORS = [
  '#e0503f',
  '#ff8a3d',
  '#f2c14e',
  '#fff1a8',
  '#7cc576',
  '#3f9a6b',
  '#2bb3a3',
  '#9fe3e0',
  '#3f8fd8',
  '#1f2a44',
  '#5b5fc7',
  '#9b6bd6',
  '#e27ca7',
  '#ffc4d6',
  '#f4efe6',
  '#c9b79a',
  '#8e8a84',
  '#3a3a46',
  '#1b1b22',
  '#6b4a33',
];

/* ------------------------------------------------------------------ catalog */

const I = (slot: AvatarSlot, key: string, name: string, extra: Partial<AvatarItem> = {}): AvatarItem => ({
  id: `${slotPrefix[slot]}.${key}`,
  slot,
  name,
  ...extra,
});

const slotPrefix: Record<AvatarSlot, string> = {
  hair: 'hair',
  top: 'top',
  bottom: 'bottom',
  shoes: 'shoes',
  accessory: 'acc',
  eyes: 'eyes',
  brows: 'brows',
  mouth: 'mouth',
  facialHair: 'fh',
  faceDetail: 'fd',
  headwear: 'hat',
  eyewear: 'eye',
  neck: 'neck',
  topPattern: 'pat',
  held: 'held',
  pet: 'pet',
  mobility: 'mob',
  body: 'body',
};

export const AVATAR_ITEMS: AvatarItem[] = [
  // hair
  I('hair', 'short', 'Short'),
  I('hair', 'crop', 'Crop'),
  I('hair', 'pixie', 'Pixie'),
  I('hair', 'sidepart', 'Side part'),
  I('hair', 'swoop', 'Swoop'),
  I('hair', 'undercut', 'Undercut'),
  I('hair', 'mohawk', 'Mohawk'),
  I('hair', 'buzz', 'Buzz'),
  I('hair', 'curlyshort', 'Short curls'),
  I('hair', 'curly', 'Curls'),
  I('hair', 'afro', 'Afro'),
  I('hair', 'bob', 'Bob'),
  I('hair', 'mullet', 'Mullet'),
  I('hair', 'long', 'Long'),
  I('hair', 'wavy', 'Wavy'),
  I('hair', 'bangs', 'Blunt bangs'),
  I('hair', 'ponytail', 'Ponytail'),
  I('hair', 'pigtails', 'Pigtails'),
  I('hair', 'bun', 'Top bun'),
  I('hair', 'spacebuns', 'Space buns'),
  I('hair', 'braids', 'Braids'),
  I('hair', 'locs', 'Locs'),
  I('hair', 'none', 'Bald'),

  // face
  I('eyes', 'dot', 'Classic'),
  I('eyes', 'wide', 'Bright'),
  I('eyes', 'lashes', 'Lashes'),
  I('eyes', 'happy', 'Happy'),
  I('eyes', 'sleepy', 'Sleepy'),
  I('eyes', 'wink', 'Wink'),
  I('eyes', 'sparkle', 'Sparkly'),
  I('brows', 'soft', 'Soft'),
  I('brows', 'bold', 'Bold'),
  I('brows', 'none', 'None'),
  I('mouth', 'smile', 'Smile'),
  I('mouth', 'grin', 'Grin'),
  I('mouth', 'neutral', 'Chill'),
  I('mouth', 'smirk', 'Smirk'),
  I('mouth', 'o', 'Ooh'),
  I('mouth', 'tongue', 'Cheeky'),
  I('facialHair', 'none', 'None'),
  I('facialHair', 'stubble', 'Stubble'),
  I('facialHair', 'mustache', 'Mustache'),
  I('facialHair', 'goatee', 'Goatee'),
  I('facialHair', 'beard', 'Beard'),
  I('faceDetail', 'none', 'None'),
  I('faceDetail', 'blush', 'Rosy cheeks'),
  I('faceDetail', 'freckles', 'Freckles'),
  I('faceDetail', 'mole', 'Beauty mark'),
  I('faceDetail', 'bandaid', 'Band-aid'),

  // headwear
  I('headwear', 'none', 'None'),
  I('headwear', 'beanie', 'Beanie'),
  I('headwear', 'cap', 'Cap'),
  I('headwear', 'capback', 'Backwards cap'),
  I('headwear', 'bucket', 'Bucket hat'),
  I('headwear', 'beret', 'Beret'),
  I('headwear', 'headband', 'Headband'),
  I('headwear', 'bow', 'Big bow'),
  I('headwear', 'catears', 'Cat ears'),
  I('headwear', 'flowers', 'Flower crown'),
  I('headwear', 'headphones', 'Headphones'),
  I('headwear', 'cowboy', 'Cowboy hat'),
  I('headwear', 'sun-hat', 'Sun hat'),
  I('headwear', 'crown', 'Crown'),
  I('headwear', 'hijab', 'Hijab', { coversHair: true, coversEars: true }),
  I('headwear', 'turban', 'Turban', { coversHair: true }),
  I('headwear', 'party', 'Party hat', { unlock: { kind: 'event', description: 'Came to a celebration in Lantern Hall' } }),

  // eyewear
  I('eyewear', 'none', 'None'),
  I('eyewear', 'round', 'Round glasses'),
  I('eyewear', 'square', 'Square glasses'),
  I('eyewear', 'sun', 'Sunglasses'),
  I('eyewear', 'heart', 'Heart shades'),
  I('eyewear', 'star', 'Star shades'),
  I('eyewear', '3d', '3D glasses'),
  I('eyewear', 'monocle', 'Monocle'),
  I('eyewear', 'goggles', 'Goggles'),

  // neck
  I('neck', 'none', 'None'),
  I('neck', 'scarf', 'Scarf'),
  I('neck', 'bowtie', 'Bow tie'),
  I('neck', 'tie', 'Tie'),
  I('neck', 'necklace', 'Necklace'),
  I('neck', 'bandana', 'Bandana'),
  I('neck', 'lanyard', 'Company lanyard'),

  // tops
  I('top', 'tee', 'T-shirt'),
  I('top', 'tank', 'Tank top'),
  I('top', 'hoodie', 'Hoodie'),
  I('top', 'shirt', 'Button-up'),
  I('top', 'sweater', 'Knit sweater'),
  I('top', 'turtleneck', 'Turtleneck'),
  I('top', 'flannel', 'Flannel'),
  I('top', 'cardigan', 'Cardigan'),
  I('top', 'jersey', 'Jersey'),
  I('top', 'puffer', 'Puffer jacket'),
  I('top', 'overalls', 'Overalls'),
  I('top', 'blazer', 'Blazer'),
  I('top', 'kimono', 'Wrap top'),
  I('top', 'apron', 'Café apron'),
  I('top', 'dress', 'Dress', { fullLength: true }),
  I('top', 'raincoat', 'Raincoat', { fullLength: true }),
  I('top', 'labcoat', 'Lab coat', { fullLength: true }),
  I('top', 'aurora-tee', 'Aurora launch tee', { unlock: { kind: 'launch', description: 'Shipped with Aurora 1.0 — March 2025' } }),
  I('top', 'northstar-hoodie', 'Northstar hoodie', { unlock: { kind: 'tenure', description: 'Welcome swag — everyone gets one on day one' } }),
  I('topPattern', 'solid', 'Solid'),
  I('topPattern', 'stripes', 'Stripes'),
  I('topPattern', 'dots', 'Polka dots'),
  I('topPattern', 'check', 'Checks'),
  I('topPattern', 'stars', 'Stars'),
  I('topPattern', 'hearts', 'Hearts'),

  // bottoms
  I('bottom', 'jeans', 'Jeans'),
  I('bottom', 'chinos', 'Chinos'),
  I('bottom', 'joggers', 'Joggers'),
  I('bottom', 'cargo', 'Cargo pants'),
  I('bottom', 'leggings', 'Leggings'),
  I('bottom', 'shorts', 'Shorts'),
  I('bottom', 'skirt', 'Skirt'),
  I('bottom', 'longskirt', 'Long skirt'),

  // shoes
  I('shoes', 'sneakers', 'Sneakers'),
  I('shoes', 'hightops', 'High-tops'),
  I('shoes', 'boots', 'Boots'),
  I('shoes', 'rainboots', 'Rain boots'),
  I('shoes', 'loafers', 'Loafers'),
  I('shoes', 'heels', 'Heels'),
  I('shoes', 'sandals', 'Sandals'),
  I('shoes', 'slippers', 'Fluffy slippers'),
  I('shoes', 'skates', 'Roller skates'),

  // extras
  I('accessory', 'none', 'None'),
  I('accessory', 'flower', 'Flower clip'),
  I('accessory', 'earrings', 'Earrings'),
  I('accessory', 'hearing-aid', 'Hearing aid'),
  I('accessory', 'star-pin', 'Star pin'),
  I('accessory', 'rainbow-pin', 'Rainbow pin'),
  I('accessory', 'five-year-pin', 'Five-year star pin', { unlock: { kind: 'tenure', description: 'Five years at Northstar' } }),
  I('held', 'none', 'Nothing'),
  I('held', 'coffee', 'Coffee'),
  I('held', 'boba', 'Boba tea'),
  I('held', 'laptop', 'Laptop'),
  I('held', 'book', 'Book'),
  I('held', 'plant', 'Tiny plant'),
  I('held', 'icecream', 'Ice cream'),
  I('held', 'balloon', 'Balloon'),
  I('held', 'umbrella', 'Umbrella'),
  I('held', 'popcorn', 'Popcorn'),
  I('held', 'soda', 'Soda'),
  I('held', 'plush', 'Prize plush'),
  I('pet', 'none', 'No buddy'),
  I('pet', 'cat', 'Cat'),
  I('pet', 'dog', 'Dog'),
  I('pet', 'duck', 'Duck'),
  I('pet', 'bunny', 'Bunny'),
  I('pet', 'frog', 'Frog'),
  I('mobility', 'none', 'None'),
  I('mobility', 'wheelchair', 'Wheelchair'),
  I('mobility', 'cane', 'Cane'),
  I('body', 'a', 'Straight'),
  I('body', 'b', 'Soft'),
];

export const ITEM_BY_ID = new Map(AVATAR_ITEMS.map((i) => [i.id, i]));

/** Older ids that grant/map to current ones. */
const UNLOCK_ALIASES: Record<string, string> = { 'acc.party-hat': 'hat.party' };

export function hasUnlock(unlocked: readonly string[], itemId: string): boolean {
  return unlocked.includes(itemId) || unlocked.some((u) => UNLOCK_ALIASES[u] === itemId);
}

export function itemsForSlot(slot: AvatarSlot): AvatarItem[] {
  return AVATAR_ITEMS.filter((i) => i.slot === slot);
}

/* ------------------------------------------------------------------ defaults & normalization */

export type FullLoadout = Required<AvatarLoadout>;

export const DEFAULT_LOADOUT: FullLoadout = {
  skin: SKIN_TONES[4],
  hair: 'hair.short',
  hairColor: HAIR_COLORS[2],
  hairHighlight: '',
  eyes: 'eyes.dot',
  eyeColor: EYE_COLORS[0],
  brows: 'brows.soft',
  mouth: 'mouth.smile',
  facialHair: 'fh.none',
  faceDetail: 'fd.none',
  headwear: 'hat.none',
  headwearColor: CLOTH_COLORS[2],
  eyewear: 'eye.none',
  neck: 'neck.none',
  neckColor: CLOTH_COLORS[0],
  top: 'top.northstar-hoodie',
  topColor: CLOTH_COLORS[8],
  topAccent: CLOTH_COLORS[14],
  topPattern: 'pat.solid',
  bottom: 'bottom.jeans',
  bottomColor: CLOTH_COLORS[9],
  shoes: 'shoes.sneakers',
  shoesColor: CLOTH_COLORS[14],
  accessory: 'acc.none',
  held: 'held.none',
  heldColor: CLOTH_COLORS[12],
  pet: 'pet.none',
  petColor: '#e8a15a',
  mobility: 'mob.none',
  body: 'body.a',
};

/** Maps looks saved before the catalog grew (single "accessory" slot) onto the new slots. */
export function normalizeLoadout(l: AvatarLoadout): FullLoadout {
  const out: FullLoadout = { ...DEFAULT_LOADOUT, ...stripUndefined(l) } as FullLoadout;
  const legacy: Record<string, Partial<FullLoadout>> = {
    'acc.glasses': { eyewear: 'eye.round', accessory: 'acc.none' },
    'acc.sunglasses': { eyewear: 'eye.sun', accessory: 'acc.none' },
    'acc.headphones': { headwear: 'hat.headphones', headwearColor: '#ff8a3d', accessory: 'acc.none' },
    'acc.beanie': { headwear: 'hat.beanie', headwearColor: '#f2c14e', accessory: 'acc.none' },
    'acc.cap': { headwear: 'hat.cap', headwearColor: '#3f8fd8', accessory: 'acc.none' },
    'acc.scarf': { neck: 'neck.scarf', neckColor: '#e0503f', accessory: 'acc.none' },
    'acc.party-hat': { headwear: 'hat.party', accessory: 'acc.none' },
  };
  const m = legacy[out.accessory];
  if (m) {
    // Only fill slots the old look didn't already set explicitly.
    for (const [k, v] of Object.entries(m) as Array<[keyof FullLoadout, string]>) {
      if (k === 'accessory' || l[k] === undefined || l[k] === DEFAULT_LOADOUT[k]) out[k] = v;
    }
  }
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const SLOT_FIELDS: Array<[keyof FullLoadout, AvatarSlot]> = [
  ['hair', 'hair'],
  ['top', 'top'],
  ['bottom', 'bottom'],
  ['shoes', 'shoes'],
  ['accessory', 'accessory'],
  ['eyes', 'eyes'],
  ['brows', 'brows'],
  ['mouth', 'mouth'],
  ['facialHair', 'facialHair'],
  ['faceDetail', 'faceDetail'],
  ['headwear', 'headwear'],
  ['eyewear', 'eyewear'],
  ['neck', 'neck'],
  ['topPattern', 'topPattern'],
  ['held', 'held'],
  ['pet', 'pet'],
  ['mobility', 'mobility'],
  ['body', 'body'],
];

const COLOR_FIELDS: Array<keyof FullLoadout> = [
  'skin',
  'hairColor',
  'eyeColor',
  'headwearColor',
  'neckColor',
  'topColor',
  'topAccent',
  'bottomColor',
  'shoesColor',
  'heldColor',
  'petColor',
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Validates a loadout against the catalog and the member's unlocks. Any hex color is allowed. */
export function sanitizeLoadout(input: AvatarLoadout, unlocked: readonly string[]): FullLoadout {
  const l = normalizeLoadout(input);
  const out = { ...l };
  for (const [field, slot] of SLOT_FIELDS) {
    const item = ITEM_BY_ID.get(out[field]);
    const ok = !!item && item.slot === slot && (!item.unlock || hasUnlock(unlocked, item.id));
    if (!ok) out[field] = slot === 'top' ? 'top.tee' : DEFAULT_LOADOUT[field];
  }
  for (const f of COLOR_FIELDS) if (!HEX.test(out[f])) out[f] = DEFAULT_LOADOUT[f];
  if (out.hairHighlight && !HEX.test(out.hairHighlight)) out.hairHighlight = '';
  return out;
}

/* ------------------------------------------------------------------ vibes & randomness */

export interface Vibe {
  id: string;
  name: string;
  emoji: string;
  /** Outfit only — identity (skin, face, hair) is always kept. */
  outfit: Partial<FullLoadout>;
}

export const VIBES: Vibe[] = [
  { id: 'cozy', name: 'Cozy', emoji: '☕', outfit: { top: 'top.sweater', topColor: '#c9b79a', topPattern: 'pat.solid', bottom: 'bottom.joggers', bottomColor: '#8e8a84', shoes: 'shoes.slippers', shoesColor: '#ffc4d6', headwear: 'hat.beanie', headwearColor: '#e0503f', neck: 'neck.scarf', neckColor: '#f2c14e', held: 'held.coffee', eyewear: 'eye.none' } },
  { id: 'sporty', name: 'Sporty', emoji: '🏀', outfit: { top: 'top.jersey', topColor: '#3f8fd8', topAccent: '#f4efe6', topPattern: 'pat.solid', bottom: 'bottom.shorts', bottomColor: '#1b1b22', shoes: 'shoes.hightops', shoesColor: '#e0503f', headwear: 'hat.headband', headwearColor: '#f4efe6', neck: 'neck.none', held: 'held.none', eyewear: 'eye.none' } },
  { id: 'business', name: 'Big meeting', emoji: '💼', outfit: { top: 'top.blazer', topColor: '#1f2a44', topAccent: '#f4efe6', topPattern: 'pat.solid', bottom: 'bottom.chinos', bottomColor: '#3a3a46', shoes: 'shoes.loafers', shoesColor: '#3b2518', headwear: 'hat.none', neck: 'neck.tie', neckColor: '#e0503f', held: 'held.laptop', eyewear: 'eye.square' } },
  { id: 'artsy', name: 'Artsy', emoji: '🎨', outfit: { top: 'top.overalls', topColor: '#e27ca7', topAccent: '#f4efe6', topPattern: 'pat.solid', bottom: 'bottom.jeans', bottomColor: '#f4efe6', shoes: 'shoes.sneakers', shoesColor: '#f2c14e', headwear: 'hat.beret', headwearColor: '#1b1b22', neck: 'neck.none', held: 'held.book', heldColor: '#2bb3a3', eyewear: 'eye.round' } },
  { id: 'party', name: 'Party', emoji: '🎉', outfit: { top: 'top.dress', topColor: '#9b6bd6', topAccent: '#f2c14e', topPattern: 'pat.stars', bottom: 'bottom.leggings', bottomColor: '#1b1b22', shoes: 'shoes.heels', shoesColor: '#f2c14e', headwear: 'hat.crown', neck: 'neck.necklace', held: 'held.balloon', heldColor: '#e27ca7', eyewear: 'eye.heart' } },
  { id: 'outdoors', name: 'Outdoorsy', emoji: '🌲', outfit: { top: 'top.flannel', topColor: '#e0503f', topAccent: '#1b1b22', topPattern: 'pat.solid', bottom: 'bottom.cargo', bottomColor: '#6b4a33', shoes: 'shoes.boots', shoesColor: '#6b4a33', headwear: 'hat.bucket', headwearColor: '#3f9a6b', neck: 'neck.bandana', neckColor: '#f2c14e', held: 'held.plant', eyewear: 'eye.none' } },
  { id: 'rainy', name: 'Rainy day', emoji: '🌧️', outfit: { top: 'top.raincoat', topColor: '#f2c14e', topAccent: '#1b1b22', topPattern: 'pat.solid', bottom: 'bottom.jeans', bottomColor: '#1f2a44', shoes: 'shoes.rainboots', shoesColor: '#3f9a6b', headwear: 'hat.none', neck: 'neck.none', held: 'held.umbrella', heldColor: '#e0503f', eyewear: 'eye.none' } },
  { id: 'gamer', name: 'Game night', emoji: '🎮', outfit: { top: 'top.hoodie', topColor: '#5b5fc7', topAccent: '#9fe3e0', topPattern: 'pat.solid', bottom: 'bottom.joggers', bottomColor: '#3a3a46', shoes: 'shoes.hightops', shoesColor: '#f4efe6', headwear: 'hat.headphones', headwearColor: '#2bb3a3', neck: 'neck.none', held: 'held.boba', eyewear: 'eye.none' } },
  { id: 'summer', name: 'Summer', emoji: '🌞', outfit: { top: 'top.tank', topColor: '#fff1a8', topAccent: '#ff8a3d', topPattern: 'pat.stripes', bottom: 'bottom.shorts', bottomColor: '#2bb3a3', shoes: 'shoes.sandals', shoesColor: '#6b4a33', headwear: 'hat.bucket', headwearColor: '#f4efe6', neck: 'neck.none', held: 'held.icecream', eyewear: 'eye.sun' } },
  { id: 'lab', name: 'Deep science', emoji: '🧪', outfit: { top: 'top.labcoat', topColor: '#f4efe6', topAccent: '#3f8fd8', topPattern: 'pat.solid', bottom: 'bottom.chinos', bottomColor: '#1f2a44', shoes: 'shoes.sneakers', shoesColor: '#3a3a46', headwear: 'hat.none', neck: 'neck.lanyard', neckColor: '#3f8fd8', held: 'held.none', eyewear: 'eye.goggles' } },
  { id: 'skate', name: 'Skate park', emoji: '🤙', outfit: { top: 'top.tee', topColor: '#9fe3e0', topAccent: '#e27ca7', topPattern: 'pat.check', bottom: 'bottom.shorts', bottomColor: '#e27ca7', shoes: 'shoes.skates', shoesColor: '#f4efe6', headwear: 'hat.capback', headwearColor: '#e0503f', neck: 'neck.none', held: 'held.none', eyewear: 'eye.3d' } },
];

export function applyVibe(l: AvatarLoadout, vibe: Vibe, unlocked: readonly string[]): FullLoadout {
  return sanitizeLoadout({ ...normalizeLoadout(l), ...vibe.outfit }, unlocked);
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * A pleasant random look. Colors come from a small harmonious set so "surprise me" rarely
 * produces something clashing. `keepIdentity` keeps skin, face and hair.
 */
export function randomLoadout(
  seed: string,
  opts: { unlocked?: readonly string[]; base?: AvatarLoadout; keepIdentity?: boolean } = {},
): FullLoadout {
  const r = seededRandom(seed);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const chance = (p: number) => r() < p;
  const unlocked = opts.unlocked ?? [];
  const avail = (slot: AvatarSlot) => AVATAR_ITEMS.filter((i) => i.slot === slot && (!i.unlock || hasUnlock(unlocked, i.id)));
  const id = (slot: AvatarSlot) => pick(avail(slot)).id;
  const noneOr = (slot: AvatarSlot, p: number) => (chance(p) ? pick(avail(slot).filter((i) => !i.id.endsWith('.none'))).id : `${slotPrefix[slot]}.none`);

  // Harmony: an anchor hue family plus neutrals.
  const families = [
    ['#e0503f', '#f2c14e', '#1f2a44', '#f4efe6'],
    ['#2bb3a3', '#9fe3e0', '#3a3a46', '#fff1a8'],
    ['#9b6bd6', '#e27ca7', '#1b1b22', '#f4efe6'],
    ['#3f8fd8', '#f4efe6', '#c9b79a', '#1f2a44'],
    ['#7cc576', '#6b4a33', '#fff1a8', '#3a3a46'],
    ['#ff8a3d', '#1f2a44', '#9fe3e0', '#f4efe6'],
  ];
  const fam = pick(families);
  const col = () => pick(fam);

  const base = normalizeLoadout(opts.base ?? DEFAULT_LOADOUT);
  const identity: Partial<FullLoadout> = opts.keepIdentity
    ? {
        skin: base.skin,
        hair: base.hair,
        hairColor: base.hairColor,
        hairHighlight: base.hairHighlight,
        eyes: base.eyes,
        eyeColor: base.eyeColor,
        brows: base.brows,
        mouth: base.mouth,
        facialHair: base.facialHair,
        faceDetail: base.faceDetail,
        mobility: base.mobility,
        body: base.body,
      }
    : {
        skin: pick(SKIN_TONES),
        hair: id('hair'),
        hairColor: chance(0.85) ? pick(HAIR_COLORS.slice(0, 12)) : pick(HAIR_COLORS.slice(12)),
        hairHighlight: chance(0.15) ? pick(HAIR_COLORS.slice(12)) : '',
        eyes: id('eyes'),
        eyeColor: pick(EYE_COLORS),
        brows: pick(['brows.soft', 'brows.soft', 'brows.bold']),
        mouth: id('mouth'),
        facialHair: noneOr('facialHair', 0.2),
        faceDetail: noneOr('faceDetail', 0.3),
        mobility: base.mobility,
        body: id('body'),
      };
  const top = id('top');
  return sanitizeLoadout(
    {
      ...base,
      ...identity,
      headwear: identity.hair && ITEM_BY_ID.get(String(base.headwear))?.coversHair && opts.keepIdentity ? base.headwear : noneOr('headwear', 0.4),
      headwearColor: col(),
      eyewear: noneOr('eyewear', 0.3),
      neck: noneOr('neck', 0.3),
      neckColor: col(),
      top,
      topColor: col(),
      topAccent: col(),
      topPattern: chance(0.3) ? id('topPattern') : 'pat.solid',
      bottom: id('bottom'),
      bottomColor: pick([...fam, '#1f2a44', '#3a3a46', '#c9b79a']),
      shoes: id('shoes'),
      shoesColor: col(),
      accessory: noneOr('accessory', 0.25),
      held: noneOr('held', 0.35),
      heldColor: col(),
      pet: base.pet,
      petColor: base.petColor,
    },
    unlocked,
  );
}

/** Deterministic pleasant random loadout from a seed string (for new guests). */
export function loadoutFromSeed(seed: string): FullLoadout {
  const l = randomLoadout(seed);
  return { ...l, headwear: 'hat.none', held: 'held.none', eyewear: l.eyewear === 'eye.3d' ? 'eye.none' : l.eyewear, top: 'top.northstar-hoodie' };
}
