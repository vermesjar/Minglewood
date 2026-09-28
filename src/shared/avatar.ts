/**
 * Composable avatar catalog. Items are data; the client renderer draws each slot as a layer.
 * New items (swag, event rewards, tenure pins) are added here and granted via `Member.unlockedItems`.
 * Nothing is purchasable — items come from participation and belonging.
 */
import type { AvatarLoadout } from './domain/types';

export type AvatarSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';

export interface AvatarItem {
  id: string;
  slot: AvatarSlot;
  name: string;
  /** How you get it. Absent = available to everyone. */
  unlock?: { kind: 'event' | 'tenure' | 'team' | 'launch'; description: string };
}

export const SKIN_TONES = ['#ffe0c4', '#f6c9a4', '#e8b088', '#c98d62', '#a86b45', '#7c4a2d', '#5a3420'];

export const HAIR_COLORS = [
  '#2b1d16',
  '#5a3825',
  '#8a5a32',
  '#c98f4a',
  '#e8c16d',
  '#b8432e',
  '#9aa0a8',
  '#f2efe9',
  '#4a6fd1',
  '#d65fa6',
];

export const CLOTH_COLORS = [
  '#e0503f',
  '#ff8a3d',
  '#f2c14e',
  '#7cc576',
  '#2bb3a3',
  '#3f8fd8',
  '#5b5fc7',
  '#9b6bd6',
  '#e27ca7',
  '#f4efe6',
  '#8e8a84',
  '#3a3a46',
  '#1f2a44',
  '#6b4a33',
];

export const AVATAR_ITEMS: AvatarItem[] = [
  { id: 'hair.short', slot: 'hair', name: 'Short' },
  { id: 'hair.crop', slot: 'hair', name: 'Crop' },
  { id: 'hair.bob', slot: 'hair', name: 'Bob' },
  { id: 'hair.long', slot: 'hair', name: 'Long' },
  { id: 'hair.ponytail', slot: 'hair', name: 'Ponytail' },
  { id: 'hair.curly', slot: 'hair', name: 'Curls' },
  { id: 'hair.bun', slot: 'hair', name: 'Top bun' },
  { id: 'hair.buzz', slot: 'hair', name: 'Buzz' },
  { id: 'hair.swoop', slot: 'hair', name: 'Swoop' },
  { id: 'hair.none', slot: 'hair', name: 'Bald' },

  { id: 'top.tee', slot: 'top', name: 'T-shirt' },
  { id: 'top.hoodie', slot: 'top', name: 'Hoodie' },
  { id: 'top.shirt', slot: 'top', name: 'Button-up' },
  { id: 'top.sweater', slot: 'top', name: 'Striped sweater' },
  { id: 'top.overalls', slot: 'top', name: 'Overalls' },
  { id: 'top.blazer', slot: 'top', name: 'Blazer' },
  {
    id: 'top.aurora-tee',
    slot: 'top',
    name: 'Aurora launch tee',
    unlock: { kind: 'launch', description: 'Shipped with Aurora 1.0 — March 2025' },
  },
  {
    id: 'top.northstar-hoodie',
    slot: 'top',
    name: 'Northstar hoodie',
    unlock: { kind: 'tenure', description: 'Welcome swag — everyone gets one on day one' },
  },

  { id: 'bottom.jeans', slot: 'bottom', name: 'Jeans' },
  { id: 'bottom.chinos', slot: 'bottom', name: 'Chinos' },
  { id: 'bottom.skirt', slot: 'bottom', name: 'Skirt' },
  { id: 'bottom.shorts', slot: 'bottom', name: 'Shorts' },

  { id: 'shoes.sneakers', slot: 'shoes', name: 'Sneakers' },
  { id: 'shoes.boots', slot: 'shoes', name: 'Boots' },
  { id: 'shoes.loafers', slot: 'shoes', name: 'Loafers' },

  { id: 'acc.none', slot: 'accessory', name: 'None' },
  { id: 'acc.glasses', slot: 'accessory', name: 'Glasses' },
  { id: 'acc.sunglasses', slot: 'accessory', name: 'Sunglasses' },
  { id: 'acc.headphones', slot: 'accessory', name: 'Headphones' },
  { id: 'acc.beanie', slot: 'accessory', name: 'Beanie' },
  { id: 'acc.cap', slot: 'accessory', name: 'Cap' },
  { id: 'acc.scarf', slot: 'accessory', name: 'Scarf' },
  { id: 'acc.flower', slot: 'accessory', name: 'Flower' },
  {
    id: 'acc.party-hat',
    slot: 'accessory',
    name: 'Party hat',
    unlock: { kind: 'event', description: 'Attended a celebration in Lantern Hall' },
  },
  {
    id: 'acc.five-year-pin',
    slot: 'accessory',
    name: 'Five-year star pin',
    unlock: { kind: 'tenure', description: 'Five years at Northstar' },
  },
];

export const ITEM_BY_ID = new Map(AVATAR_ITEMS.map((i) => [i.id, i]));

export function itemsForSlot(slot: AvatarSlot, unlocked: readonly string[]): AvatarItem[] {
  return AVATAR_ITEMS.filter((i) => i.slot === slot && (!i.unlock || unlocked.includes(i.id)));
}

export const DEFAULT_LOADOUT: AvatarLoadout = {
  skin: SKIN_TONES[2],
  hair: 'hair.short',
  hairColor: HAIR_COLORS[1],
  top: 'top.northstar-hoodie',
  topColor: CLOTH_COLORS[5],
  bottom: 'bottom.jeans',
  bottomColor: CLOTH_COLORS[12],
  shoes: 'shoes.sneakers',
  shoesColor: CLOTH_COLORS[9],
  accessory: 'acc.none',
};

/** Deterministic pleasant random loadout from a seed string (for new guests). */
export function loadoutFromSeed(seed: string): AvatarLoadout {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const pick = <T>(arr: readonly T[]) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return arr[(h >>> 0) % arr.length];
  };
  const base = (slot: AvatarSlot) => AVATAR_ITEMS.filter((i) => i.slot === slot && !i.unlock);
  return {
    skin: pick(SKIN_TONES),
    hair: pick(base('hair')).id,
    hairColor: pick(HAIR_COLORS.slice(0, 7)),
    top: pick(base('top')).id,
    topColor: pick(CLOTH_COLORS),
    bottom: pick(base('bottom')).id,
    bottomColor: pick([CLOTH_COLORS[12], CLOTH_COLORS[11], CLOTH_COLORS[13], CLOTH_COLORS[10]]),
    shoes: pick(base('shoes')).id,
    shoesColor: pick(CLOTH_COLORS),
    accessory: pick(['acc.none', 'acc.none', 'acc.glasses', 'acc.headphones', 'acc.beanie']),
  };
}

/** Validates a loadout against the catalog and the member's unlocks. */
export function sanitizeLoadout(l: AvatarLoadout, unlocked: readonly string[]): AvatarLoadout {
  const ok = (id: string, slot: AvatarSlot) => {
    const item = ITEM_BY_ID.get(id);
    return !!item && item.slot === slot && (!item.unlock || unlocked.includes(id));
  };
  const color = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
  return {
    skin: SKIN_TONES.includes(l.skin) ? l.skin : DEFAULT_LOADOUT.skin,
    hair: ok(l.hair, 'hair') ? l.hair : DEFAULT_LOADOUT.hair,
    hairColor: color(l.hairColor, DEFAULT_LOADOUT.hairColor),
    top: ok(l.top, 'top') ? l.top : 'top.tee',
    topColor: color(l.topColor, DEFAULT_LOADOUT.topColor),
    bottom: ok(l.bottom, 'bottom') ? l.bottom : DEFAULT_LOADOUT.bottom,
    bottomColor: color(l.bottomColor, DEFAULT_LOADOUT.bottomColor),
    shoes: ok(l.shoes, 'shoes') ? l.shoes : DEFAULT_LOADOUT.shoes,
    shoesColor: color(l.shoesColor, DEFAULT_LOADOUT.shoesColor),
    accessory: ok(l.accessory, 'accessory') ? l.accessory : 'acc.none',
  };
}
