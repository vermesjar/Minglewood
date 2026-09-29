/**
 * The Northstar Labs outdoor world: a lakeside/woodland company town.
 * Authored as code-that-emits-data. The output (`SceneDef`) is plain JSON so a future
 * world builder can load, edit and save it without touching this file.
 *
 * Scale: characters stand ~40 art px tall, so buildings are sized as real buildings around them — a
 * one-storey café is ~2½ people tall, HQ is three storeys — and the map is large enough that they breathe.
 * Each building has finished exterior art (`building.<variant>` in the art manifest, conformed to its exact
 * footprint by art/town_conform.py); the spec below is the procedural fallback and drives event bunting.
 */
import type { BuildingSpec, SceneDef, SceneObject } from './scene';
import { hash2, TileCanvas } from './builders';

export const TOWN_ID = 'town';
const W = 76;
const H = 76;

interface BuildingDef {
  id: string;
  roomId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
  spec: BuildingSpec;
}

// Footprints match the drawn exteriors exactly (art/town_conform.py measures and conforms them); wallH is the
// measured eave height of the art (event bunting hangs there).
export const BUILDINGS: BuildingDef[] = [
  {
    id: 'b-hq',
    roomId: 'hq',
    label: 'Northstar HQ',
    x: 30,
    y: 15,
    w: 11,
    d: 8,
    spec: {
      wallH: 224,
      wall: '#efe4cf',
      wallAccent: '#d5c3a2',
      roof: '#4a5a8a',
      roofStyle: 'hip',
      trim: '#2c4a63',
      window: '#ffd98a',
      doorFace: 'left',
      doorAt: 5,
      extras: ['flag', 'clock', 'columns'],
      floors: 3,
    },
  },
  {
    id: 'b-arcade',
    roomId: 'arcade',
    label: 'Pixel Pier Arcade',
    x: 43,
    y: 26,
    w: 8,
    d: 5,
    spec: {
      wallH: 87,
      wall: '#7658b3',
      wallAccent: '#5a4191',
      roof: '#2f2650',
      roofStyle: 'flat',
      trim: '#221a3d',
      window: '#ff9ee6',
      doorFace: 'left',
      doorAt: 4,
      extras: ['neon', 'marquee'],
    },
  },
  {
    id: 'b-cafe',
    roomId: 'cafe',
    label: 'Tidewater Café',
    x: 53,
    y: 24,
    w: 8,
    d: 6,
    spec: {
      wallH: 99,
      wall: '#f6cfa4',
      wallAccent: '#e4b07f',
      roof: '#bf5a3f',
      roofStyle: 'gable',
      trim: '#6f3a26',
      window: '#ffe6a8',
      doorFace: 'left',
      doorAt: 3,
      extras: ['awning', 'chimney', 'lanterns'],
      awningColors: ['#e0503f', '#fff4e0'],
    },
  },
  {
    id: 'b-focus',
    roomId: 'focus',
    label: 'The Quiet Grove',
    x: 8,
    y: 7,
    w: 7,
    d: 8,
    spec: {
      wallH: 61,
      wall: '#9a7350',
      wallAccent: '#7d5a3c',
      roof: '#47785a',
      roofStyle: 'gable',
      trim: '#4a3322',
      window: '#ffd98a',
      doorFace: 'right',
      doorAt: 3,
      extras: ['chimney', 'porch', 'lanterns'],
    },
  },
  {
    id: 'b-eng',
    roomId: 'eng',
    label: 'Engineering Studio',
    x: 17,
    y: 40,
    w: 11,
    d: 7,
    spec: {
      wallH: 170,
      wall: '#dce6ec',
      wallAccent: '#a2744c',
      roof: '#4f5b69',
      roofStyle: 'flat',
      trim: '#35404d',
      window: '#9fe3e0',
      doorFace: 'right',
      doorAt: 2,
      extras: ['solar', 'skylight', 'antenna'],
      floors: 2,
    },
  },
  {
    id: 'b-design',
    roomId: 'design',
    label: 'Design Loft',
    x: 21,
    y: 52,
    w: 7,
    d: 6,
    spec: {
      wallH: 149,
      wall: '#f6e7a8',
      wallAccent: '#e8cf72',
      roof: '#e27c62',
      roofStyle: 'gable',
      trim: '#8e4633',
      window: '#b9e8ff',
      doorFace: 'right',
      doorAt: 2,
      extras: ['skylight', 'ivy'],
      floors: 2,
    },
  },
  {
    id: 'b-launch',
    roomId: 'launch',
    label: 'Launch Lab',
    x: 21,
    y: 62,
    w: 7,
    d: 6,
    spec: {
      wallH: 126,
      wall: '#edf0f4',
      wallAccent: '#ff8a3d',
      roof: '#2f3b5c',
      roofStyle: 'flat',
      trim: '#1f2940',
      window: '#9fd0ff',
      doorFace: 'right',
      doorAt: 3,
      extras: ['antenna', 'flag'],
      floors: 2,
    },
  },
  {
    id: 'b-events',
    roomId: 'events',
    label: 'Lantern Hall',
    x: 38,
    y: 57,
    w: 12,
    d: 6,
    spec: {
      wallH: 153,
      wall: '#cf735c',
      wallAccent: '#b25a45',
      roof: '#5e3b5c',
      roofStyle: 'gable',
      trim: '#3b2239',
      window: '#ffe0a0',
      doorFace: 'left',
      doorAt: 5,
      extras: ['columns', 'marquee', 'lanterns'],
    },
  },
];

function doorTile(b: BuildingDef): { x: number; y: number } {
  return b.spec.doorFace === 'left'
    ? { x: b.x + b.spec.doorAt, y: b.y + b.d }
    : { x: b.x + b.w, y: b.y + b.spec.doorAt };
}

/**
 * The lake: two overlapping ellipses with a gentle wobble. Returns < 1 inside water. It stays inside the map
 * with a far shore and a treeline beyond it, so the town sits in a valley rather than on a floating slab.
 */
function inLake(x: number, y: number): number {
  const wob = Math.sin(x * 0.45) * 0.045 + Math.cos(y * 0.55) * 0.045;
  const a = ((x - 61) / 11.5) ** 2 + ((y - 60) / 11) ** 2;
  const b = ((x - 66) / 6.5) ** 2 + ((y - 39) / 12.5) ** 2;
  return Math.min(a, b) + wob;
}

export function buildTown(): SceneDef {
  const t = new TileCanvas(W, H, 'g');

  // Grass variation and meadows.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(Math.floor(x / 4), Math.floor(y / 4), 7);
      if (n > 0.74) t.set(x, y, 'h');
      if (x > 30 && y > 54 && hash2(x, y, 3) > 0.55) t.set(x, y, 'm');
    }
  }

  // Lake, with the lighthouse island.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = inLake(x, y);
      if (v < 1) t.set(x, y, v < 0.45 ? 'W' : 'w');
    }
  }
  for (let y = 57; y <= 64; y++) {
    for (let x = 61; x <= 68; x++) {
      const dd = Math.hypot(x - 64.5, y - 60.5);
      if (dd < 1.9) t.set(x, y, 'g');
      else if (dd < 3.1) t.set(x, y, 's');
    }
  }
  // Sandy shore on land next to water.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = t.get(x, y);
      if (c === 'w' || c === 'W' || c === 's') continue;
      const nearWater = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ].some(([dx, dy]) => {
        const n = t.get(x + dx, y + dy);
        return n === 'w' || n === 'W';
      });
      if (nearWater) t.set(x, y, 's');
    }
  }

  // Roads: Main Street runs east from the woods to the pier; Grove Lane runs south from HQ's steps; the plaza
  // sits where they cross.
  t.path(6, 34, 62, 34, 'p', 3); // Main Street (along x)
  t.path(34, 23, 34, 72, 'p', 3); // Grove Lane (along y), from HQ's door
  t.rect(29, 29, 13, 13, 'P'); // the plaza
  // HQ forecourt, the café terrace and the promenade.
  t.rect(31, 23, 9, 3, 'P');
  t.rect(52, 30, 10, 3, 'P');
  // Pier: Main Street continues onto the lake.
  for (let x = 62; x <= 71; x++) for (let k = 0; k < 3; k++) if (['w', 'W', 's'].includes(t.get(x, 34 + k))) t.set(x, 34 + k, 'd');

  // Building footprints are grass underneath; doors get paths to the nearest road.
  const objects: SceneObject[] = [];
  for (const b of BUILDINGS) {
    const door = doorTile(b);
    objects.push({
      id: b.id,
      sprite: 'building',
      variant: b.roomId,
      x: b.x,
      y: b.y,
      w: b.w,
      d: b.d,
      label: b.label,
      building: b.spec,
      roomId: b.roomId,
      door,
      actions: [{ kind: 'enter', roomId: b.roomId }],
    });
  }
  // Door paths (drawn after the buildings are known so they meet the right road).
  const road = (b: BuildingDef, ...pts: Array<[number, number]>) => {
    let [ax, ay] = [doorTile(b).x, doorTile(b).y];
    for (const [bx, by] of pts) {
      t.path(ax, ay, bx, by, 'p', 2);
      [ax, ay] = [bx, by];
    }
  };
  const byRoom = (id: string) => BUILDINGS.find((b) => b.roomId === id)!;
  road(byRoom('arcade'), [47, 34]);
  road(byRoom('cafe'), [56, 33]);
  road(byRoom('eng'), [34, 42]);
  road(byRoom('design'), [34, 54]);
  road(byRoom('launch'), [34, 65]);
  road(byRoom('events'), [43, 66]);
  // Forest trail from the Quiet Grove, winding down to Main Street.
  road(byRoom('focus'), [22, 12], [22, 33]);
  // Lakeside promenade: from Grove Lane past Lantern Hall's doors to the shore.
  t.path(35, 66, 54, 66, 'p', 2);
  // A park path from the plaza down through the park to the hall.
  t.path(38, 42, 38, 57, 'p', 2);

  const blocked = new Set<string>();
  const block = (x: number, y: number, w = 1, d = 1) => {
    for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) blocked.add(`${xx},${yy}`);
  };
  for (const b of BUILDINGS) {
    block(b.x - 1, b.y - 1, b.w + 2, b.d + 2);
    const door = doorTile(b);
    block(door.x - 1, door.y - 1, 3, 3);
  }

  let n = 0;
  const add = (o: Omit<SceneObject, 'id'> & { id?: string }) => {
    const id = o.id ?? `o${++n}`;
    objects.push({ ...o, id });
    block(o.x, o.y, o.w ?? 1, o.d ?? 1);
  };

  // Plaza: the fountain at the crossroads, benches facing it, flower beds at the corners.
  add({ id: 'fountain', sprite: 'fountain', x: 34, y: 34, w: 3, d: 3, label: 'Founders’ Fountain' });
  add({ sprite: 'bench', x: 31, y: 32, facing: 'se', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 39, y: 32, facing: 'sw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 31, y: 39, facing: 'ne', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 39, y: 39, facing: 'nw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'flowerbed', x: 29, y: 29, variant: 'pink' });
  add({ sprite: 'flowerbed', x: 41, y: 29, variant: 'yellow' });
  add({ sprite: 'flowerbed', x: 29, y: 41, variant: 'blue' });
  add({ sprite: 'flowerbed', x: 41, y: 41, variant: 'pink' });
  add({
    id: 'welcome-sign',
    sprite: 'signpost',
    x: 37,
    y: 41,
    label: 'Welcome to town',
    actions: [
      {
        kind: 'info',
        title: 'Welcome to town',
        body: 'HQ is up the lane. Coffee is by the lake. The studios hum to the west, and the event hall hosts everything worth celebrating.',
      },
    ],
  });

  // Plaza life: a flower seller and the town notice board.
  add({ sprite: 'flower-cart', x: 38, y: 30, w: 2, d: 2, label: 'Flower cart' });
  add({
    id: 'noticeboard',
    sprite: 'noticeboard',
    x: 30,
    y: 37,
    label: 'Town notice board',
    actions: [{ kind: 'info', title: 'Town notice board', body: 'Lost scarf (teal), found by the fountain. Book club Thursday at the Quiet Grove. Lantern Hall hosts the next all-hands.' }],
  });

  // HQ forecourt: flower beds either side of the steps.
  add({ sprite: 'flowerbed', x: 31, y: 24, variant: 'red' });
  add({ sprite: 'flowerbed', x: 39, y: 24, variant: 'red' });

  // Café terrace by the water.
  add({ sprite: 'umbrella-table', x: 53, y: 31, variant: 'red', solid: true });
  add({ sprite: 'umbrella-table', x: 59, y: 31, variant: 'teal', solid: true });
  // the café's own bentwood chairs, carried out onto the terrace
  add({ sprite: 'chair', x: 54, y: 31, facing: 'nw', actions: [{ kind: 'sit' }], variant: 'cafe' });
  add({ sprite: 'chair', x: 53, y: 32, facing: 'ne', actions: [{ kind: 'sit' }], variant: 'cafe' });
  add({ sprite: 'chair', x: 58, y: 31, facing: 'se', actions: [{ kind: 'sit' }], variant: 'cafe' });
  add({ sprite: 'chair', x: 59, y: 32, facing: 'ne', actions: [{ kind: 'sit' }], variant: 'cafe' });

  // Organizational memory in the landscape.
  add({
    id: 'founders-oak',
    sprite: 'tree/oak-big',
    x: 49,
    y: 45,
    w: 3,
    d: 3,
    label: 'Founders’ Oak',
    artifactId: 'art-founders-oak',
    actions: [{ kind: 'artifact', artifactId: 'art-founders-oak' }],
  });
  add({
    id: 'bench-1000',
    sprite: 'bench',
    x: 48,
    y: 49,
    facing: 'ne',
    variant: 'plaque',
    artifactId: 'art-1000-bench',
    actions: [{ kind: 'sit' }, { kind: 'artifact', artifactId: 'art-1000-bench' }],
  });
  add({
    id: 'rocket-statue',
    sprite: 'rocket-statue',
    x: 30,
    y: 66,
    label: 'Aurora 1.0',
    artifactId: 'art-aurora-statue',
    actions: [{ kind: 'artifact', artifactId: 'art-aurora-statue' }],
  });
  add({
    id: 'lighthouse',
    sprite: 'lighthouse',
    x: 64,
    y: 60,
    w: 2,
    d: 2,
    label: 'The Little Light',
    artifactId: 'art-lighthouse',
    actions: [{ kind: 'artifact', artifactId: 'art-lighthouse' }],
  });

  // Event decorations outside Lantern Hall (only while a celebration is on).
  add({ sprite: 'balloons', x: 41, y: 65, eventDecor: 'balloons', solid: false });
  add({ sprite: 'balloons', x: 46, y: 65, eventDecor: 'balloons', variant: 'b', solid: false });
  add({ sprite: 'balloons', x: 38, y: 65, eventDecor: 'balloons', variant: 'c', solid: false });

  // The park south of the hall: a bandstand by the Founders' Oak, a picnic spot, benches, boats at the shore.
  add({ id: 'bandstand', sprite: 'gazebo', x: 42, y: 45, w: 3, d: 3, label: 'The bandstand' });
  // A little cherry orchard north-east of HQ, planted in rows.
  for (let oy = 0; oy < 3; oy++)
    for (let ox = 0; ox < 4; ox++) add({ sprite: 'tree/round', x: 47 + ox * 3, y: 8 + oy * 3 + (ox % 2), variant: 'b' });
  // The park south of the hall: picnic, benches, boats at the shore.
  add({ sprite: 'picnic', x: 47, y: 51, w: 2, d: 2 });
  add({ sprite: 'bench', x: 41, y: 49, facing: 'ne', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 46, y: 44, facing: 'sw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'flowerbed', x: 40, y: 44, variant: 'yellow' });
  add({ sprite: 'flowerbed', x: 45, y: 49, variant: 'blue' });
  // Rowboats moored in open water: one beside the pier, one off the park shore.
  add({ sprite: 'boat', x: 67, y: 38, w: 2, d: 2, variant: 'red', solid: true });
  add({ sprite: 'boat', x: 55, y: 60, w: 2, d: 2, variant: 'yellow', solid: true });
  // A lamp at the end of the pier.
  add({ sprite: 'lamp-post', x: 71, y: 34 });
  // on open grass by Grove Lane, clear of the studio's stoop (its own art has a bike by the door)
  add({ sprite: 'bike-rack', x: 33, y: 45 });
  add({ sprite: 'mailbox', x: 28, y: 36 });

  // Lamp posts along both roads, every six tiles.
  for (let x = 8; x <= 60; x += 6) {
    if (!blocked.has(`${x},37`) && t.get(x, 37) !== 'w') add({ sprite: 'lamp-post', x, y: 37 });
  }
  for (let y = 26; y <= 70; y += 6) {
    if (!blocked.has(`37,${y}`) && !['w', 'W', 'P', 'p'].includes(t.get(37, y))) add({ sprite: 'lamp-post', x: 37, y });
  }

  // Flower patches and bushes near paths.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = t.get(x, y);
      if (c !== 'g' && c !== 'h' && c !== 'm') continue;
      if (blocked.has(`${x},${y}`)) continue;
      const r = hash2(x, y, 11);
      const nearPath = ['p', 'P'].includes(t.get(x + 1, y)) || ['p', 'P'].includes(t.get(x, y + 1));
      if (nearPath && r > 0.87) add({ sprite: 'bush', x, y, variant: r > 0.935 ? 'flower' : 'plain' });
    }
  }

  // Forest: a deep wood at the north and west edges and around the Quiet Grove, scattered park trees elsewhere.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = t.get(x, y);
      if (c !== 'g' && c !== 'h' && c !== 'm') continue;
      if (blocked.has(`${x},${y}`)) continue;
      // keep a clear ring around roads so they read as streets, not forest trails
      const nearRoad = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => ['p', 'P', 'd'].includes(t.get(x + dx, y + dy))));
      if (nearRoad) continue;
      if (Math.hypot(x - 64.5, y - 60.5) < 3.2) continue; // the lighthouse island stays clear
      // every entrance keeps an open approach (no tree on the steps or right in front of the door)
      if (BUILDINGS.some((b) => Math.abs(doorTile(b).x - x) <= 3 && Math.abs(doorTile(b).y - y) <= 3)) continue;
      // the far edges too: a treeline across the water closes the valley
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const grove = Math.hypot(x - 12, y - 11) < 14;
      const meadowWest = x < 20 && y > 46;
      const forest = edge < 3 ? 0.7 : grove ? 0.42 : x < 8 || y < 7 ? 0.38 : meadowWest ? 0.12 : 0.045;
      const r = hash2(x, y, 5);
      if (r < forest) {
        const kind = hash2(x, y, 9);
        const sprite = kind < 0.45 ? 'tree/pine' : kind < 0.8 ? 'tree/round' : 'tree/birch';
        // blossoming cherries are an accent (the orchard, the odd one in the woods), not the whole forest
        const odds = sprite === 'tree/round' ? 0.93 : 0.5;
        add({ sprite, x, y, variant: hash2(x, y, 13) > odds ? 'b' : 'a' });
      }
    }
  }
  // Reeds along the shore.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (t.get(x, y) === 's' && !blocked.has(`${x},${y}`) && hash2(x, y, 17) > 0.9) add({ sprite: 'reeds', x, y, solid: false });
    }
  }

  return {
    id: TOWN_ID,
    kind: 'outdoor',
    name: 'Northstar Town',
    width: W,
    height: H,
    tiles: t.toStrings(),
    spawn: { x: 32, y: 40 },
    objects,
  };
}
