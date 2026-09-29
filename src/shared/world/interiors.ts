/**
 * Building interiors. Each is a discrete scene: walls on the two far edges (x=0 "left",
 * y=0 "right"), the exit door on the left wall. Furniture is data — a future editor
 * (and team decoration) manipulates these lists.
 */
import { COUNTER_TOP, type Facing, type InteriorTheme, type SceneDef, type SceneObject } from './scene';

type Obj = Omit<SceneObject, 'id'> & { id?: string };

function room(
  id: string,
  name: string,
  width: number,
  height: number,
  theme: InteriorTheme,
  objs: Obj[],
): SceneDef {
  let n = 0;
  const objects: SceneObject[] = objs.map((o) => ({
    ...o,
    id: o.id ?? `${id}-${++n}`,
    // Lamps are switchable by anyone in the room.
    actions: o.actions ?? (o.sprite === 'lamp' ? [{ kind: 'toggle', label: 'Switch the lamp' }] : undefined),
  }));
  objects.push({
    id: `${id}-door`,
    sprite: 'door',
    wall: 'left',
    x: 0,
    y: theme.doorY,
    label: 'Exit to town',
    actions: [{ kind: 'exit' }],
  });
  return {
    id,
    kind: 'interior',
    name,
    width,
    height,
    tiles: Array.from({ length: height }, () => '.'.repeat(width)),
    spawn: { x: 0, y: theme.doorY },
    objects,
    interior: theme,
  };
}

const sit = [{ kind: 'sit' as const }];
const chair = (x: number, y: number, facing: Facing, variant = 'wood'): Obj => ({
  sprite: 'chair',
  x,
  y,
  facing,
  variant,
  actions: sit,
});
const plant = (x: number, y: number, variant = 'a'): Obj => ({ sprite: 'plant', x, y, variant });

export function buildInteriors(): SceneDef[] {
  const cafe = room(
    'cafe',
    'Tidewater Café',
    12,
    10,
    {
      floor: '#b98256',
      floorAlt: '#a87148',
      floorPattern: 'planks',
      wall: '#f3dcb8',
      wallTop: '#8a5a3b',
      trim: '#6b3f2a',
      doorY: 7,
      ambient: 'warm',
    },
    [
      { sprite: 'rug', x: 7, y: 6, w: 5, d: 4, flat: true, variant: 'terracotta' },
      // A modular bar: six counter segments with the café's things standing on top.
      ...[2, 3, 4, 5, 6, 7].map((x): Obj => ({ sprite: 'counter', x, y: 1, facing: 'sw', variant: 'cafe', label: 'Espresso bar' })),
      { sprite: 'pastry-case', x: 2, y: 1, z: COUNTER_TOP, facing: 'sw', label: 'Pastry case' },
      { sprite: 'cake-stand', x: 3, y: 1, z: COUNTER_TOP, label: 'Cake of the day' },
      {
        sprite: 'espresso',
        x: 4,
        y: 1,
        z: COUNTER_TOP,
        facing: 'sw',
        label: 'Espresso machine',
        actions: [{ kind: 'vend', item: 'coffee', label: 'Get a coffee' }],
      },
      { sprite: 'grinder', x: 5, y: 1, z: COUNTER_TOP, label: 'Coffee grinder' },
      { sprite: 'register', x: 6, y: 1, z: COUNTER_TOP, facing: 'sw' },
      { sprite: 'jar', x: 7, y: 1, z: COUNTER_TOP, label: 'Biscotti' },
      { sprite: 'backbar', wall: 'right', x: 5, y: 0, w: 3, label: 'Back bar' },
      { sprite: 'stool', x: 6, y: 2, actions: sit },
      { sprite: 'stool', x: 7, y: 2, actions: sit },
      { sprite: 'menu-board', wall: 'right', x: 3, y: 0, w: 2, label: 'Today: oat flat white' },
      { sprite: 'window', wall: 'right', x: 8, y: 0, w: 2 },
      { sprite: 'window', wall: 'left', x: 0, y: 2, d: 2 },
      { sprite: 'frame', wall: 'left', x: 0, y: 5, variant: 'lake' },
      { sprite: 'table-round', x: 4, y: 4 },
      chair(3, 4, 'se', 'cafe'),
      chair(5, 4, 'nw', 'cafe'),
      chair(4, 5, 'ne', 'cafe'),
      { sprite: 'table-round', x: 8, y: 3 },
      chair(7, 3, 'se', 'cafe'),
      chair(9, 3, 'nw', 'cafe'),
      chair(8, 4, 'ne', 'cafe'),
      { sprite: 'table-round', x: 4, y: 8 },
      chair(3, 8, 'se', 'cafe'),
      chair(5, 8, 'nw', 'cafe'),
      { sprite: 'couch', x: 8, y: 9, w: 2, d: 1, facing: 'ne', variant: 'green', actions: sit },
      { sprite: 'table-low', x: 8, y: 7, w: 2, d: 1 },
      { sprite: 'armchair', x: 11, y: 7, facing: 'nw', variant: 'mustard', actions: sit },
      { sprite: 'armchair', x: 11, y: 5, facing: 'nw', variant: 'mustard', actions: sit },
      plant(11, 1, 'b'),
      plant(1, 1),
      { sprite: 'lamp', x: 11, y: 9 },
    ],
  );

  const hq = room(
    'hq',
    'Northstar HQ — Lobby',
    14,
    12,
    {
      floor: '#e9e2d3',
      floorAlt: '#d3c9b5',
      floorPattern: 'checker',
      wall: '#ebe6db',
      wallTop: '#4a7ea3',
      trim: '#2c4a63',
      doorY: 9,
      ambient: 'bright',
    },
    [
      { sprite: 'rug', x: 5, y: 5, w: 5, d: 4, flat: true, variant: 'logo' },
      { sprite: 'reception', x: 6, y: 2, w: 3, d: 1, label: 'Reception' },
      {
        sprite: 'frame',
        wall: 'right',
        x: 1,
        y: 0,
        variant: 'garage',
        artifactId: 'art-garage',
        actions: [{ kind: 'artifact', artifactId: 'art-garage' }],
      },
      {
        sprite: 'frame',
        wall: 'right',
        x: 3,
        y: 0,
        variant: 'customer',
        artifactId: 'art-first-customer',
        actions: [{ kind: 'artifact', artifactId: 'art-first-customer' }],
      },
      {
        sprite: 'frame',
        wall: 'right',
        x: 10,
        y: 0,
        variant: 'lisbon',
        artifactId: 'art-lisbon',
        actions: [{ kind: 'artifact', artifactId: 'art-lisbon' }],
      },
      {
        sprite: 'frame',
        wall: 'right',
        x: 12,
        y: 0,
        variant: 'team',
        artifactId: 'art-series-a',
        actions: [{ kind: 'artifact', artifactId: 'art-series-a' }],
      },
      { sprite: 'logo-wall', wall: 'right', x: 6, y: 0, w: 3, label: 'Northstar Labs' },
      {
        sprite: 'elevator',
        wall: 'left',
        x: 0,
        y: 2,
        d: 2,
        label: 'Elevator',
        actions: [
          {
            kind: 'info',
            title: 'Elevator to floors 2–3',
            body: 'Upper floors unlock as the company grows into them. Each floor can host a department neighborhood.',
          },
        ],
      },
      {
        sprite: 'bulletin',
        wall: 'left',
        x: 0,
        y: 5,
        d: 2,
        label: 'New faces board',
        actions: [
          {
            kind: 'info',
            title: 'New faces this month',
            body: 'Say hi to the folks who just joined — they’re still learning where the coffee is.',
          },
        ],
      },
      {
        sprite: 'trophy-case',
        x: 12,
        y: 4,
        w: 1,
        d: 2,
        label: 'Trophy case',
        artifactId: 'art-support-award',
        actions: [{ kind: 'artifact', artifactId: 'art-support-award' }],
      },
      { sprite: 'couch', x: 2, y: 7, w: 1, d: 2, facing: 'se', variant: 'blue', actions: sit },
      { sprite: 'table-low', x: 3, y: 7, w: 1, d: 2 },
      { sprite: 'couch', x: 4, y: 7, w: 1, d: 2, facing: 'nw', variant: 'blue', actions: sit },
      {
        sprite: 'time-capsule',
        x: 11,
        y: 9,
        label: 'Time capsule',
        artifactId: 'art-time-capsule',
        actions: [{ kind: 'artifact', artifactId: 'art-time-capsule' }],
      },
      plant(1, 1, 'b'),
      plant(13, 1),
      plant(13, 11, 'b'),
      plant(9, 11),
    ],
  );

  const engDesks: Obj[] = [];
  for (const [dx, dy] of [
    [2, 3],
    [5, 3],
    [8, 3],
    [2, 6],
    [5, 6],
    [8, 6],
  ]) {
    engDesks.push({ sprite: 'desk', x: dx, y: dy, w: 2, d: 1, facing: 'sw' });
    engDesks.push(chair(dx, dy + 1, 'ne', 'office'));
    engDesks.push(chair(dx + 1, dy + 1, 'ne', 'office'));
  }
  const eng = room(
    'eng',
    'Engineering Studio',
    16,
    12,
    {
      floor: '#7f93a8',
      floorAlt: '#72869b',
      floorPattern: 'carpet',
      wall: '#e1e8ec',
      wallTop: '#4f5b69',
      trim: '#35404d',
      doorY: 9,
      ambient: 'bright',
    },
    [
      { sprite: 'rug', x: 11, y: 7, w: 4, d: 4, flat: true, variant: 'teal' },
      ...engDesks,
      {
        sprite: 'whiteboard',
        wall: 'right',
        x: 2,
        y: 0,
        w: 3,
        label: 'Architecture sketch',
        actions: [
          {
            kind: 'info',
            title: 'Architecture sketch',
            body: 'Today’s whiteboard: the Aurora sync engine. Ask Ben or Priya — they love explaining it.',
          },
        ],
      },
      { sprite: 'window', wall: 'right', x: 6, y: 0, w: 2 },
      { sprite: 'pennant', wall: 'right', x: 9, y: 0, variant: 'platform', label: 'Platform' },
      { sprite: 'pennant', wall: 'right', x: 10, y: 0, variant: 'mobile', label: 'Mobile' },
      { sprite: 'window', wall: 'left', x: 0, y: 3, d: 2 },
      {
        sprite: 'bookshelf',
        x: 12,
        y: 0,
        facing: 'sw',
        label: 'Engineering Library',
        actions: [
          {
            kind: 'info',
            title: 'The Engineering Library',
            body: 'Borrowed books, design docs, and the famous “Why we chose Postgres” zine. Take one, leave one.',
          },
        ],
      },
      { sprite: 'bookshelf', x: 13, y: 0, facing: 'sw', variant: 'b' },
      { sprite: 'server-rack', x: 15, y: 0, label: 'The Toaster (retired build server)' },
      { sprite: 'beanbag', x: 12, y: 9, variant: 'orange', actions: sit },
      { sprite: 'beanbag', x: 14, y: 8, variant: 'purple', actions: sit },
      { sprite: 'table-low', x: 13, y: 9, w: 1, d: 1 },
      plant(15, 11, 'b'),
      plant(1, 1),
      plant(10, 1),
    ],
  );

  const launch = room(
    'launch',
    'Launch Lab — Project Aurora',
    12,
    10,
    {
      floor: '#e3e6ec',
      floorAlt: '#d2d7df',
      floorPattern: 'tiles',
      wall: '#f4f2ee',
      wallTop: '#2f3b5c',
      trim: '#1f2940',
      doorY: 7,
      ambient: 'bright',
    },
    [
      { sprite: 'table-long', x: 4, y: 4, w: 4, d: 2, label: 'War-room table' },
      chair(3, 4, 'se', 'office'),
      chair(3, 5, 'se', 'office'),
      chair(8, 4, 'nw', 'office'),
      chair(8, 5, 'nw', 'office'),
      chair(5, 3, 'sw', 'office'),
      chair(6, 3, 'sw', 'office'),
      chair(5, 6, 'ne', 'office'),
      chair(6, 6, 'ne', 'office'),
      {
        sprite: 'kanban',
        wall: 'right',
        x: 1,
        y: 0,
        w: 4,
        label: 'Aurora 2.0 board',
        actions: [
          {
            kind: 'info',
            title: 'Aurora 2.0 — launch board',
            body: 'Onboarding flow ✅  Offline sync 🛠  Pricing page 🛠  Launch party 🎉 (booked Lantern Hall)',
          },
        ],
      },
      { sprite: 'screen', wall: 'right', x: 6, y: 0, w: 2, variant: 'countdown', label: 'Launch countdown' },
      {
        sprite: 'rocket-model',
        x: 10,
        y: 2,
        label: 'Aurora 1.0 rocket',
        artifactId: 'art-aurora-rocket',
        actions: [{ kind: 'artifact', artifactId: 'art-aurora-rocket' }],
      },
      {
        sprite: 'frame',
        wall: 'left',
        x: 0,
        y: 3,
        variant: 'hackathon',
        artifactId: 'art-hackathon',
        actions: [{ kind: 'artifact', artifactId: 'art-hackathon' }],
      },
      { sprite: 'beanbag', x: 10, y: 8, variant: 'orange', actions: sit },
      plant(11, 9, 'b'),
      plant(1, 1),
    ],
  );

  const seats: Obj[] = [];
  for (const y of [6, 8]) {
    for (const x of [3, 4, 5, 6, 9, 10, 11, 12]) seats.push(chair(x, y, 'ne', 'red'));
  }
  const events = room(
    'events',
    'Lantern Hall',
    16,
    13,
    {
      floor: '#a8683f',
      floorAlt: '#965a34',
      floorPattern: 'planks',
      wall: '#f2d6c4',
      wallTop: '#5e3b5c',
      trim: '#3b2239',
      doorY: 10,
      ambient: 'festive',
    },
    [
      { sprite: 'stage', x: 4, y: 1, w: 8, d: 3, flat: true, solid: false, label: 'Stage' },
      { sprite: 'podium', x: 8, y: 2 },
      { sprite: 'speaker', x: 3, y: 1 },
      { sprite: 'speaker', x: 12, y: 1 },
      { sprite: 'banner', wall: 'right', x: 5, y: 0, w: 6, label: 'Lantern Hall' },
      ...seats,
      { sprite: 'cake-table', x: 13, y: 10, w: 2, d: 1, eventDecor: 'balloons', label: 'Birthday cake' },
      { sprite: 'balloons', x: 2, y: 4, eventDecor: 'balloons', solid: false },
      { sprite: 'balloons', x: 14, y: 4, eventDecor: 'balloons', variant: 'b', solid: false },
      { sprite: 'balloons', x: 15, y: 11, eventDecor: 'balloons', variant: 'c', solid: false },
      { sprite: 'window', wall: 'left', x: 0, y: 3, d: 2 },
      { sprite: 'window', wall: 'left', x: 0, y: 6, d: 2 },
      { sprite: 'lantern-string', wall: 'right', x: 1, y: 0, w: 3 },
      { sprite: 'lantern-string', wall: 'right', x: 12, y: 0, w: 3 },
      plant(1, 1, 'b'),
      plant(15, 1, 'b'),
    ],
  );

  const focus = room(
    'focus',
    'The Quiet Grove',
    12,
    10,
    {
      floor: '#617f5b',
      floorAlt: '#58754f',
      floorPattern: 'carpet',
      wall: '#eadfc9',
      wallTop: '#47785a',
      trim: '#4a3322',
      doorY: 7,
      ambient: 'dim',
    },
    [
      { sprite: 'rug', x: 1, y: 3, w: 3, d: 4, flat: true, variant: 'cream' },
      ...[2, 3, 4, 7, 8].map((x, i) => ({
        sprite: 'bookshelf',
        x,
        y: 0,
        facing: 'sw' as const,
        variant: i % 2 ? 'b' : 'a',
      })),
      { sprite: 'fireplace', x: 10, y: 0, w: 1, d: 1, label: 'Fireplace' },
      { sprite: 'armchair', x: 2, y: 4, facing: 'se', variant: 'rust', actions: sit },
      { sprite: 'armchair', x: 2, y: 6, facing: 'se', variant: 'rust', actions: sit },
      { sprite: 'lamp', x: 1, y: 5 },
      { sprite: 'desk', x: 6, y: 3, w: 2, d: 1, facing: 'sw', variant: 'wood' },
      chair(6, 4, 'ne'),
      chair(7, 4, 'ne'),
      { sprite: 'desk', x: 6, y: 6, w: 2, d: 1, facing: 'sw', variant: 'wood' },
      chair(6, 7, 'ne'),
      chair(7, 7, 'ne'),
      { sprite: 'armchair', x: 10, y: 5, facing: 'nw', variant: 'green', actions: sit },
      {
        sprite: 'sign-quiet',
        wall: 'left',
        x: 0,
        y: 3,
        label: 'Quiet, please',
        actions: [
          {
            kind: 'info',
            title: 'The Quiet Grove',
            body: 'Everyone here is shown as focused. Knocks are held until they come up for air.',
          },
        ],
      },
      { sprite: 'window', wall: 'right', x: 5, y: 0, w: 2 },
      plant(11, 9, 'b'),
      plant(11, 1),
    ],
  );

  const arcade = room(
    'arcade',
    'Pixel Pier Arcade',
    12,
    10,
    {
      floor: '#3b2e60',
      floorAlt: '#4a3a78',
      floorPattern: 'checker',
      wall: '#2e2549',
      wallTop: '#1c1630',
      trim: '#ff5fd1',
      doorY: 7,
      ambient: 'neon',
    },
    [
      ...[2, 3, 4, 5].map((x, i) => ({
        sprite: 'arcade-cabinet',
        x,
        y: 1,
        facing: 'sw' as const,
        variant: ['pink', 'cyan', 'lime', 'orange'][i],
        label: ['Lake Runner', 'Deploy Defender', 'Coffee Quest', 'Star Pong'][i],
        actions: [
          {
            kind: 'activity' as const,
            label: 'Play',
            body: 'Arcade cabinets are where Discord Activities will launch — play together with whoever is in the room.',
          },
        ],
      })),
      {
        sprite: 'arcade-cabinet',
        x: 9,
        y: 1,
        facing: 'sw',
        variant: 'gold',
        label: 'Offsite ’25 Champion Cabinet',
        artifactId: 'art-offsite-cabinet',
        actions: [{ kind: 'artifact', artifactId: 'art-offsite-cabinet' }],
      },
      { sprite: 'neon', wall: 'right', x: 6, y: 0, w: 3, label: 'PLAY' },
      { sprite: 'pool-table', x: 5, y: 5, w: 3, d: 2, label: 'Pool table' },
      { sprite: 'couch', x: 1, y: 3, w: 1, d: 2, facing: 'se', variant: 'purple', actions: sit },
      { sprite: 'beanbag', x: 10, y: 7, variant: 'cyan', actions: sit },
      { sprite: 'beanbag', x: 9, y: 8, variant: 'pink', actions: sit },
      plant(11, 9, 'b'),
    ],
  );

  const design = room(
    'design',
    'Design Loft',
    12,
    10,
    {
      floor: '#dcbd90',
      floorAlt: '#cfae7e',
      floorPattern: 'planks',
      wall: '#fbf3dd',
      wallTop: '#e27c62',
      trim: '#8e4633',
      doorY: 7,
      ambient: 'bright',
    },
    [
      { sprite: 'rug', x: 5, y: 5, w: 5, d: 4, flat: true, variant: 'mustard' },
      {
        sprite: 'moodboard',
        wall: 'right',
        x: 1,
        y: 0,
        w: 4,
        label: 'Onboarding moodboard',
        actions: [
          {
            kind: 'info',
            title: 'Onboarding redesign moodboard',
            body: 'Warm, legible, a little bit of play. Maya is collecting references — drop yours in #design-crit.',
          },
        ],
      },
      { sprite: 'swatches', wall: 'right', x: 7, y: 0, w: 3, label: 'Color swatches' },
      { sprite: 'window', wall: 'left', x: 0, y: 2, d: 2 },
      { sprite: 'easel', x: 2, y: 3, facing: 'se' },
      { sprite: 'easel', x: 2, y: 5, facing: 'se', variant: 'b' },
      { sprite: 'table-long', x: 6, y: 6, w: 3, d: 2, variant: 'light' },
      { sprite: 'stool', x: 5, y: 6, actions: sit },
      { sprite: 'stool', x: 5, y: 7, actions: sit },
      { sprite: 'stool', x: 9, y: 6, actions: sit },
      { sprite: 'stool', x: 9, y: 7, actions: sit },
      { sprite: 'desk', x: 8, y: 2, w: 2, d: 1, facing: 'sw', variant: 'light' },
      chair(8, 3, 'ne', 'office'),
      chair(9, 3, 'ne', 'office'),
      plant(11, 1, 'b'),
      plant(11, 9),
      plant(1, 9, 'b'),
    ],
  );

  return [hq, cafe, eng, launch, events, focus, arcade, design];
}
