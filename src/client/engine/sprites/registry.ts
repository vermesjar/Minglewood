/**
 * Asset registry: maps a scene object's `sprite` key to a Sprite. This is the seam where
 * professional art replaces procedural placeholders — swap an entry for an image-backed Sprite.
 */
import type { SceneObject } from '@shared/world/scene';
import type { Sprite } from './painter';
import { buildingSprite, festiveOverlay, windowLightsOverlay } from './buildings';
import {
  balloonsSprite,
  boatSprite,
  bushSprite,
  flowerbedSprite,
  fountainSprite,
  lampPostSprite,
  lighthouseSprite,
  picnicSprite,
  rocketStatueSprite,
  seatSprite,
  signpostSprite,
  smallProp,
  treeSprite,
  umbrellaTableSprite,
} from './nature';
import {
  arcadeCabinetSprite,
  armchairSprite,
  beanbagSprite,
  bookshelfSprite,
  cakeTableSprite,
  chairSprite,
  counterSprite,
  couchSprite,
  deskSprite,
  easelSprite,
  fireplaceSprite,
  lampSprite,
  plantSprite,
  podiumSprite,
  poolTableSprite,
  receptionSprite,
  rocketModelSprite,
  serverRackSprite,
  speakerSprite,
  stoolSprite,
  tableLongSprite,
  tableLowSprite,
  tableRoundSprite,
  timeCapsuleSprite,
  trophyCaseSprite,
} from './furniture';

const cache = new Map<string, Sprite | null>();

function build(o: SceneObject): Sprite | null {
  const w = o.w ?? 1;
  const d = o.d ?? 1;
  const f = o.facing ?? 'se';
  const v = o.variant ?? 'a';
  if (o.sprite.startsWith('tree/')) return treeSprite(o.sprite.slice(5), v);
  switch (o.sprite) {
    case 'building':
      return o.building ? buildingSprite(o.building, w, d, o.id.length) : null;
    case 'bush':
      return bushSprite(v);
    case 'flowerbed':
      return flowerbedSprite(v);
    case 'bench':
      return seatSprite(f, { color: '#9c6a42', seat: '#c08a55', wide: true, plaque: v === 'plaque' });
    case 'lamp-post':
      return lampPostSprite();
    case 'fountain':
      return fountainSprite();
    case 'signpost':
      return signpostSprite();
    case 'umbrella-table':
      return umbrellaTableSprite(v);
    case 'picnic':
      return picnicSprite();
    case 'boat':
      return boatSprite(v);
    case 'mailbox':
    case 'bike-rack':
    case 'reeds':
      return smallProp(o.sprite);
    case 'rocket-statue':
      return rocketStatueSprite();
    case 'lighthouse':
      return lighthouseSprite();
    case 'balloons':
      return balloonsSprite(v);
    case 'chair':
      return chairSprite(f, o.variant);
    case 'stool':
      return stoolSprite();
    case 'couch':
      return couchSprite(w, d, f, o.variant);
    case 'armchair':
      return armchairSprite(f, o.variant);
    case 'table-round':
      return tableRoundSprite();
    case 'table-low':
      return tableLowSprite(w, d);
    case 'table-long':
      return tableLongSprite(w, d, o.variant);
    case 'counter':
      return counterSprite(w, d);
    case 'reception':
      return receptionSprite(w, d);
    case 'desk':
      return deskSprite(w, d, o.variant);
    case 'bookshelf':
      return bookshelfSprite(o.variant);
    case 'server-rack':
      return serverRackSprite();
    case 'beanbag':
      return beanbagSprite(o.variant);
    case 'plant':
      return plantSprite(o.variant);
    case 'lamp':
      return lampSprite();
    case 'trophy-case':
      return trophyCaseSprite(w, d);
    case 'time-capsule':
      return timeCapsuleSprite();
    case 'podium':
      return podiumSprite();
    case 'speaker':
      return speakerSprite();
    case 'cake-table':
      return cakeTableSprite(w, d);
    case 'rocket-model':
      return rocketModelSprite();
    case 'easel':
      return easelSprite(f, o.variant);
    case 'pool-table':
      return poolTableSprite(w, d);
    case 'arcade-cabinet':
      return arcadeCabinetSprite(o.variant);
    case 'fireplace':
      return fireplaceSprite();
    default:
      return null;
  }
}

function key(o: SceneObject): string {
  if (o.sprite === 'building') return `building:${o.id}`;
  return `${o.sprite}|${o.w ?? 1}|${o.d ?? 1}|${o.facing ?? ''}|${o.variant ?? ''}`;
}

export function spriteFor(o: SceneObject): Sprite | null {
  const k = key(o);
  if (!cache.has(k)) cache.set(k, build(o));
  return cache.get(k)!;
}

export function festiveFor(o: SceneObject): Sprite | null {
  if (!o.building) return null;
  const k = `festive:${o.id}`;
  if (!cache.has(k)) cache.set(k, festiveOverlay(o.building, o.w ?? 1, o.d ?? 1));
  return cache.get(k)!;
}

export function windowLightsFor(o: SceneObject): Sprite | null {
  if (!o.building) return null;
  const k = `lights:${o.id}`;
  if (!cache.has(k)) cache.set(k, windowLightsOverlay(o.building, o.w ?? 1, o.d ?? 1, o.id.length));
  return cache.get(k)!;
}
