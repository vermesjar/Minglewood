/**
 * The Northstar Labs outdoor world: a lakeside/woodland company town.
 * Authored as code-that-emits-data. The output (`SceneDef`) is plain JSON so a future
 * world builder can load, edit and save it without touching this file.
 */
import type { BuildingSpec, SceneDef, SceneObject } from './scene';
import { hash2, TileCanvas } from './builders';

export const TOWN_ID = 'town';
const W = 46;
const H = 46;

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

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'b-hq',
    roomId: 'hq',
    label: 'Northstar HQ',
    x: 11,
    y: 10,
    w: 7,
    d: 6,
    spec: {
      wallH: 50,
      wall: '#efe4cf',
      wallAccent: '#d5c3a2',
      roof: '#4a7ea3',
      roofStyle: 'hip',
      trim: '#2c4a63',
      window: '#a6dcf5',
      doorFace: 'left',
      doorAt: 3,
      extras: ['flag', 'clock', 'columns'],
      floors: 3,
    },
  },
  {
    id: 'b-arcade',
    roomId: 'arcade',
    label: 'Pixel Pier Arcade',
    x: 25,
    y: 12,
    w: 5,
    d: 4,
    spec: {
      wallH: 28,
      wall: '#7658b3',
      wallAccent: '#5a4191',
      roof: '#2f2650',
      roofStyle: 'flat',
      trim: '#221a3d',
      window: '#ff9ee6',
      doorFace: 'left',
      doorAt: 2,
      extras: ['neon', 'marquee'],
    },
  },
  {
    id: 'b-cafe',
    roomId: 'cafe',
    label: 'Tidewater Café',
    x: 31,
    y: 11,
    w: 5,
    d: 5,
    spec: {
      wallH: 28,
      wall: '#f6cfa4',
      wallAccent: '#e4b07f',
      roof: '#bf5a3f',
      roofStyle: 'gable',
      trim: '#6f3a26',
      window: '#ffe6a8',
      doorFace: 'left',
      doorAt: 2,
      extras: ['awning', 'chimney', 'lanterns'],
      awningColors: ['#e0503f', '#fff4e0'],
    },
  },
  {
    id: 'b-focus',
    roomId: 'focus',
    label: 'The Quiet Grove',
    x: 4,
    y: 4,
    w: 4,
    d: 4,
    spec: {
      wallH: 24,
      wall: '#9a7350',
      wallAccent: '#7d5a3c',
      roof: '#47785a',
      roofStyle: 'gable',
      trim: '#4a3322',
      window: '#ffd98a',
      doorFace: 'right',
      doorAt: 2,
      extras: ['chimney', 'porch', 'lanterns'],
    },
  },
  {
    id: 'b-eng',
    roomId: 'eng',
    label: 'Engineering Studio',
    x: 11,
    y: 24,
    w: 7,
    d: 5,
    spec: {
      wallH: 36,
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
    x: 12,
    y: 32,
    w: 5,
    d: 4,
    spec: {
      wallH: 30,
      wall: '#f6e7a8',
      wallAccent: '#e8cf72',
      roof: '#e27c62',
      roofStyle: 'gable',
      trim: '#8e4633',
      window: '#b9e8ff',
      doorFace: 'right',
      doorAt: 1,
      extras: ['skylight', 'ivy'],
    },
  },
  {
    id: 'b-launch',
    roomId: 'launch',
    label: 'Launch Lab',
    x: 12,
    y: 39,
    w: 5,
    d: 4,
    spec: {
      wallH: 28,
      wall: '#edf0f4',
      wallAccent: '#ff8a3d',
      roof: '#2f3b5c',
      roofStyle: 'flat',
      trim: '#1f2940',
      window: '#9fd0ff',
      doorFace: 'right',
      doorAt: 1,
      extras: ['antenna', 'flag'],
    },
  },
  {
    id: 'b-events',
    roomId: 'events',
    label: 'Lantern Hall',
    x: 25,
    y: 24,
    w: 7,
    d: 5,
    spec: {
      wallH: 38,
      wall: '#cf735c',
      wallAccent: '#b25a45',
      roof: '#5e3b5c',
      roofStyle: 'gable',
      trim: '#3b2239',
      window: '#ffe0a0',
      doorFace: 'left',
      doorAt: 3,
      extras: ['columns', 'marquee', 'lanterns'],
    },
  },
];

function doorTile(b: BuildingDef): { x: number; y: number } {
  return b.spec.doorFace === 'left'
    ? { x: b.x + b.spec.doorAt, y: b.y + b.d }
    : { x: b.x + b.w, y: b.y + b.spec.doorAt };
}

function inLake(x: number, y: number): number {
  // Two overlapping ellipses with a gentle wobble. Returns <1 inside water.
  const wob = Math.sin(x * 0.7) * 0.05 + Math.cos(y * 0.9) * 0.05;
  const a = ((x - 40) / 10) ** 2 + ((y - 37) / 13) ** 2;
  const b = ((x - 43) / 6.5) ** 2 + ((y - 20) / 10) ** 2;
  return Math.min(a, b) + wob;
}

export function buildTown(): SceneDef {
  const t = new TileCanvas(W, H, 'g');

  // Grass variation and meadows.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(Math.floor(x / 3), Math.floor(y / 3), 7);
      if (n > 0.72) t.set(x, y, 'h');
      if (x > 21 && y > 32 && hash2(x, y, 3) > 0.55) t.set(x, y, 'm');
    }
  }

  // Lake, with a small lighthouse island.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = inLake(x, y);
      if (v < 1) t.set(x, y, v < 0.45 ? 'W' : 'w');
    }
  }
  for (let y = 35; y <= 39; y++) {
    for (let x = 39; x <= 43; x++) {
      const dd = Math.hypot(x - 41, y - 37);
      if (dd < 1.3) t.set(x, y, 'g');
      else if (dd < 2.2) t.set(x, y, 's');
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

  // Roads and the central plaza.
  t.path(6, 20, 35, 20, 'p', 2); // Main Street (along x)
  t.path(20, 5, 20, 44, 'p', 2); // Grove Lane (along y)
  t.rect(17, 17, 7, 7, 'P');
  // Pier continuing Main Street into the lake.
  for (let x = 36; x <= 41; x++) {
    t.set(x, 20, 'd');
    t.set(x, 21, 'd');
  }

  // Building footprints are grass underneath; doors get short paths to the road.
  const objects: SceneObject[] = [];
  for (const b of BUILDINGS) {
    const door = doorTile(b);
    objects.push({
      id: b.id,
      sprite: 'building',
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
    if (b.spec.doorFace === 'left') t.path(door.x, door.y, door.x, b.y > 20 ? door.y + 1 : 20);
    else t.path(door.x, door.y, 20, door.y);
  }
  // Forest trail to the Quiet Grove.
  t.path(8, 6, 20, 6);
  // Lakeside promenade from Lantern Hall.
  t.path(21, 30, 34, 30);
  // Café terrace.
  t.rect(31, 17, 5, 2, 'P');

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

  // Plaza: fountain, benches, flower beds.
  add({ id: 'fountain', sprite: 'fountain', x: 20, y: 20, w: 2, d: 2, label: 'Founders’ Fountain' });
  add({ sprite: 'bench', x: 18, y: 17, facing: 'sw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 23, y: 18, facing: 'nw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 17, y: 23, facing: 'se', actions: [{ kind: 'sit' }] });
  add({ sprite: 'flowerbed', x: 17, y: 17, variant: 'pink' });
  add({ sprite: 'flowerbed', x: 23, y: 23, variant: 'yellow' });
  add({ sprite: 'flowerbed', x: 23, y: 17, variant: 'blue' });
  add({
    id: 'welcome-sign',
    sprite: 'signpost',
    x: 22,
    y: 24,
    label: 'Welcome to Northstar',
    actions: [
      {
        kind: 'info',
        title: 'Welcome to Northstar Labs',
        body: 'HQ is up the lane. Coffee is by the lake. Engineering hums to the west. Lantern Hall hosts everything worth celebrating.',
      },
    ],
  });

  // Café terrace tables with umbrellas.
  add({ sprite: 'umbrella-table', x: 31, y: 18, variant: 'red', solid: true });
  add({ sprite: 'umbrella-table', x: 35, y: 18, variant: 'teal', solid: true });
  add({ sprite: 'chair', x: 32, y: 18, facing: 'nw', actions: [{ kind: 'sit' }], variant: 'wood' });
  add({ sprite: 'chair', x: 34, y: 18, facing: 'se', actions: [{ kind: 'sit' }], variant: 'wood' });

  // Organizational memory in the landscape.
  add({
    id: 'founders-oak',
    sprite: 'tree/oak-big',
    x: 25,
    y: 36,
    w: 2,
    d: 2,
    label: 'Founders’ Oak',
    artifactId: 'art-founders-oak',
    actions: [{ kind: 'artifact', artifactId: 'art-founders-oak' }],
  });
  add({
    id: 'bench-1000',
    sprite: 'bench',
    x: 24,
    y: 39,
    facing: 'ne',
    variant: 'plaque',
    artifactId: 'art-1000-bench',
    actions: [{ kind: 'sit' }, { kind: 'artifact', artifactId: 'art-1000-bench' }],
  });
  add({
    id: 'rocket-statue',
    sprite: 'rocket-statue',
    x: 18,
    y: 42,
    label: 'Aurora 1.0',
    artifactId: 'art-aurora-statue',
    actions: [{ kind: 'artifact', artifactId: 'art-aurora-statue' }],
  });
  add({
    id: 'lighthouse',
    sprite: 'lighthouse',
    x: 41,
    y: 37,
    label: 'The Little Light',
    artifactId: 'art-lighthouse',
    actions: [{ kind: 'artifact', artifactId: 'art-lighthouse' }],
  });

  // Event decorations outside Lantern Hall (only while a celebration is on).
  add({ sprite: 'balloons', x: 26, y: 31, eventDecor: 'balloons', solid: false });
  add({ sprite: 'balloons', x: 30, y: 31, eventDecor: 'balloons', variant: 'b', solid: false });
  add({ sprite: 'balloons', x: 24, y: 29, eventDecor: 'balloons', variant: 'c', solid: false });

  // Park furniture, picnic, boats, reeds.
  add({ sprite: 'picnic', x: 27, y: 34, w: 2, d: 1 });
  add({ sprite: 'bench', x: 22, y: 34, facing: 'se', actions: [{ kind: 'sit' }] });
  add({ sprite: 'bench', x: 29, y: 31, facing: 'sw', actions: [{ kind: 'sit' }] });
  add({ sprite: 'boat', x: 38, y: 23, variant: 'red', solid: true });
  add({ sprite: 'boat', x: 34, y: 38, variant: 'yellow', solid: true });
  add({ sprite: 'bike-rack', x: 19, y: 29 });
  add({ sprite: 'mailbox', x: 15, y: 19 });

  // Lamp posts along the roads.
  for (let x = 8; x <= 34; x += 6) {
    if (!blocked.has(`${x},22`) && t.get(x, 22) !== 'w') add({ sprite: 'lamp-post', x, y: 22 });
  }
  for (let y = 8; y <= 42; y += 6) {
    if (!blocked.has(`22,${y}`) && !['w', 'W', 'P', 'p'].includes(t.get(22, y)))
      add({ sprite: 'lamp-post', x: 22, y });
  }

  // Flower patches and bushes near paths.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = t.get(x, y);
      if (c !== 'g' && c !== 'h' && c !== 'm') continue;
      if (blocked.has(`${x},${y}`)) continue;
      const r = hash2(x, y, 11);
      const nearPath = ['p', 'P'].includes(t.get(x + 1, y)) || ['p', 'P'].includes(t.get(x, y + 1));
      if (nearPath && r > 0.86) add({ sprite: 'bush', x, y, variant: r > 0.93 ? 'flower' : 'plain' });
    }
  }

  // Forest: dense at the northern/western edges, scattered elsewhere.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = t.get(x, y);
      if (c !== 'g' && c !== 'h' && c !== 'm') continue;
      if (blocked.has(`${x},${y}`)) continue;
      const edge = Math.min(x, y);
      const forest = edge < 3 ? 0.72 : x < 9 && y < 12 ? 0.55 : x < 6 || y < 5 ? 0.45 : 0.07;
      const r = hash2(x, y, 5);
      if (r < forest) {
        const kind = hash2(x, y, 9);
        const sprite = kind < 0.45 ? 'tree/pine' : kind < 0.8 ? 'tree/round' : 'tree/birch';
        add({ sprite, x, y, variant: hash2(x, y, 13) > 0.5 ? 'a' : 'b' });
      }
    }
  }
  // Reeds along the shore.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (t.get(x, y) === 's' && !blocked.has(`${x},${y}`) && hash2(x, y, 17) > 0.9)
        add({ sprite: 'reeds', x, y, solid: false });
    }
  }

  return {
    id: TOWN_ID,
    kind: 'outdoor',
    name: 'Northstar Town',
    width: W,
    height: H,
    tiles: t.toStrings(),
    spawn: { x: 18, y: 21 },
    objects,
  };
}
