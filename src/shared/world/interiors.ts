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
  // Objects that artifacts (or saved state) point at carry explicit ids; the rest are numbered in order,
  // skipping any id already taken so a pinned object never collides with a numbered one.
  const taken = new Set(objs.map((o) => o.id).filter(Boolean));
  let n = 0;
  const next = () => {
    let k: string;
    do k = `${id}-${++n}`;
    while (taken.has(k));
    return k;
  };
  const objects: SceneObject[] = objs.map((o) => ({
    ...o,
    id: o.id ?? next(),
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
/** Height of the top of a display plinth (art px): heirlooms shown on one stand at this z. */
const PLINTH_TOP = 12.5;

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
        // its working face toward the barista; guests see the back panel and plaque, as in a real café
        facing: 'ne',
        label: 'Espresso machine',
        actions: [{ kind: 'vend', item: 'coffee', label: 'Get a coffee' }],
      },
      { sprite: 'grinder', x: 5, y: 1, z: COUNTER_TOP, label: 'Coffee grinder' },
      { sprite: 'register', x: 6, y: 1, z: COUNTER_TOP, facing: 'ne' },
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
      { sprite: 'table-round', x: 8, y: 3 },
      chair(7, 3, 'se', 'cafe'),
      chair(9, 3, 'nw', 'cafe'),
      { sprite: 'table-round', x: 4, y: 8 },
      chair(3, 8, 'se', 'cafe'),
      chair(5, 8, 'nw', 'cafe'),
      { sprite: 'couch', x: 8, y: 9, w: 2, d: 1, facing: 'ne', variant: 'green', actions: sit },
      { sprite: 'table-low', x: 8, y: 7, w: 2, d: 1 },
      { sprite: 'armchair', x: 11, y: 7, facing: 'nw', variant: 'mustard', actions: sit },
      { sprite: 'armchair', x: 11, y: 5, facing: 'nw', variant: 'mustard', actions: sit },
      plant(11, 1, 'b'),
      plant(0, 1),
      { sprite: 'lamp', x: 11, y: 9 },
      // The house machine, made in the Design Lab: a brass-and-copper showpiece by the window, self-serve.
      {
        id: 'cafe-steampunk',
        sprite: 'steampunk-coffee-machine',
        x: 0,
        y: 0,
        facing: 'se',
        label: 'The house machine',
        actions: [{ kind: 'vend', item: 'coffee', label: 'Pull a shot' }],
      },
    ],
  );
  // The lane behind the bar is the barista's: guests order across the counter, they don't walk behind it.
  cafe.staff = [{ x: 2, y: 0, w: 6, d: 1 }];
  cafe.npcs = [
    {
      id: 'barista',
      name: 'Juno',
      role: 'Barista',
      blurb: 'Pulls every shot at the Tidewater. Order at the espresso machine and Juno will make it for you.',
      avatar: {
        skin: '#c98d62',
        hair: 'hair.bun',
        hairColor: '#2b1d16',
        eyes: 'eyes.dot',
        mouth: 'mouth.smile',
        top: 'top.apron',
        topColor: '#2f5d46',
        topAccent: '#f4efe6',
        bottom: 'bottom.chinos',
        bottomColor: '#3a3a46',
        shoes: 'shoes.sneakers',
        shoesColor: '#f4efe6',
        accessory: 'acc.none',
      },
      spots: [
        { x: 4, y: 0, facing: 'sw' },
        { x: 2, y: 0, facing: 'sw' },
        { x: 6, y: 0, facing: 'sw' },
      ],
      serves: 'espresso',
    },
  ];

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
      { sprite: 'reception', x: 6, y: 2, w: 3, d: 1, facing: 'sw', label: 'Reception' },
      {
        id: 'hq-3',
        sprite: 'frame',
        wall: 'right',
        x: 1,
        y: 0,
        variant: 'garage',
        artifactId: 'art-garage',
        actions: [{ kind: 'artifact', artifactId: 'art-garage' }],
      },
      {
        id: 'hq-4',
        sprite: 'frame',
        wall: 'right',
        x: 3,
        y: 0,
        variant: 'customer',
        artifactId: 'art-first-customer',
        actions: [{ kind: 'artifact', artifactId: 'art-first-customer' }],
      },
      {
        id: 'hq-5',
        sprite: 'frame',
        wall: 'right',
        x: 4,
        y: 0,
        variant: 'lisbon',
        artifactId: 'art-lisbon',
        actions: [{ kind: 'artifact', artifactId: 'art-lisbon' }],
      },
      {
        id: 'hq-6',
        sprite: 'frame',
        wall: 'right',
        x: 2,
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
        y: 4,
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
        // along the right edge, its glass front toward the room's open side so the trophies show
        id: 'hq-10',
        sprite: 'trophy-case',
        x: 12,
        y: 4,
        w: 1,
        d: 2,
        facing: 'se',
        label: 'Trophy case',
        artifactId: 'art-support-award',
        actions: [{ kind: 'artifact', artifactId: 'art-support-award' }],
      },
      // The heirloom gallery: the trophy case, then the company's treasures on plinths along the right edge,
      // on a navy runner with brass stanchions at either end.
      { id: 'hq-gallery-rug', sprite: 'rug', x: 11, y: 6, w: 3, d: 5, flat: true, variant: 'navy' },
      { id: 'hq-plinth-1', sprite: 'plinth', x: 12, y: 7 },
      {
        id: 'hq-trophy',
        sprite: 'heirloom-trophy',
        x: 12,
        y: 7,
        z: PLINTH_TOP,
        label: 'The Keystone Trophy',
        actions: [{ kind: 'info', title: 'The Keystone Trophy', body: 'Best Remote Workplace, 2024. Everyone who answered the survey signed the underside.' }],
      },
      {
        id: 'hq-14',
        sprite: 'time-capsule',
        x: 12,
        y: 8,
        label: 'Time capsule',
        artifactId: 'art-time-capsule',
        actions: [{ kind: 'artifact', artifactId: 'art-time-capsule' }],
      },
      { id: 'hq-plinth-2', sprite: 'plinth', x: 12, y: 9 },
      {
        id: 'hq-gold',
        sprite: 'heirloom-gold',
        x: 12,
        y: 9,
        z: PLINTH_TOP,
        label: 'The Gold Reserve',
        actions: [{ kind: 'info', title: 'The Gold Reserve', body: 'Seven ingots for seven straight quarters on plan. One more quarter and the pyramid grows a new layer.' }],
      },
      { id: 'hq-stanchion-1', sprite: 'stanchion', x: 11, y: 6 },
      { id: 'hq-stanchion-2', sprite: 'stanchion', x: 11, y: 10 },
      // The Founders' Throne on its own oxblood dais, flanked by topiaries and stanchions.
      { id: 'hq-dais', sprite: 'rug', x: 10, y: 1, w: 3, d: 3, flat: true, variant: 'oxblood' },
      { id: 'hq-throne', sprite: 'heirloom-throne', x: 11, y: 1, facing: 'sw', label: 'The Founders’ Throne — earned at Series A', actions: sit },
      { id: 'hq-topiary-1', sprite: 'planter', variant: 'brass', x: 10, y: 1 },
      { id: 'hq-topiary-2', sprite: 'planter', variant: 'brass', x: 12, y: 1 },
      { id: 'hq-stanchion-3', sprite: 'stanchion', x: 10, y: 3 },
      { id: 'hq-stanchion-4', sprite: 'stanchion', x: 12, y: 3 },
      // Reception, framed by topiaries under the logo wall.
      { id: 'hq-desk-chair', sprite: 'chair', variant: 'office', x: 8, y: 1, facing: 'sw', label: 'Reception chair' },
      { id: 'hq-topiary-3', sprite: 'planter', variant: 'brass', x: 5, y: 2 },
      { id: 'hq-topiary-4', sprite: 'planter', variant: 'brass', x: 9, y: 2 },
      // The lounge by the elevator, on its own rug.
      { id: 'hq-lounge-rug', sprite: 'rug', x: 1, y: 6, w: 5, d: 4, flat: true, variant: 'cream' },
      { sprite: 'couch', x: 2, y: 7, w: 1, d: 2, facing: 'se', variant: 'blue', actions: sit },
      { sprite: 'table-low', x: 3, y: 7, w: 1, d: 2 },
      { sprite: 'couch', x: 4, y: 7, w: 1, d: 2, facing: 'nw', variant: 'blue', actions: sit },
      { id: 'hq-armchair', sprite: 'armchair', variant: 'mustard', x: 5, y: 6, facing: 'sw', actions: sit },
      { id: 'hq-side-table', sprite: 'table-side', variant: 'brass', x: 2, y: 6 },
      { id: 'hq-lamp', sprite: 'lamp', x: 1, y: 8, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      // Visitors wait on benches facing reception across the star.
      { id: 'hq-bench-1', sprite: 'bench', variant: 'navy', x: 5, y: 10, w: 2, d: 1, facing: 'ne', actions: sit },
      { id: 'hq-bench-table', sprite: 'table-side', variant: 'brass', x: 7, y: 10 },
      { id: 'hq-bench-2', sprite: 'bench', variant: 'navy', x: 8, y: 10, w: 2, d: 1, facing: 'ne', actions: sit },
      { id: 'hq-topiary-5', sprite: 'planter', variant: 'brass', x: 4, y: 10 },
      { id: 'hq-topiary-6', sprite: 'planter', variant: 'brass', x: 10, y: 10 },
      {
        id: 'hq-aquarium',
        sprite: 'heirloom-aquarium',
        x: 0,
        y: 7,
        w: 1,
        d: 2,
        facing: 'se',
        label: 'The Koi Aquarium',
        actions: [{ kind: 'info', title: 'The Koi Aquarium', body: 'Every fish is named after a product codename. The black moor is Aurora. Nobody knows who named the snail.' }],
      },
      { id: 'hq-window', sprite: 'window', wall: 'left', x: 0, y: 0, d: 2 },
      { id: 'hq-clock', sprite: 'clock-grand', x: 13, y: 0, facing: 'sw', label: 'The grandfather clock' },
    ],
  );

  // One back-to-back pod: the far row faces the room over its monitors, the near row faces the screens.
  // The front desk is the receptionist's: guests talk to Margot across it.
  hq.staff = [{ x: 6, y: 1, w: 3, d: 1 }];
  hq.npcs = [
    {
      id: 'receptionist',
      name: 'Margot',
      role: 'Receptionist',
      blurb: 'Runs the front desk at Northstar HQ. Tell Margot who you’re looking for and she’ll point you to their room — or let them know you’re here.',
      avatar: {
        skin: '#f6c9a4',
        hair: 'hair.bob',
        hairColor: '#1f1612',
        eyes: 'eyes.lashes',
        eyeColor: '#3f7fbf',
        brows: 'brows.soft',
        mouth: 'mouth.smile',
        eyewear: 'eye.round',
        top: 'top.blazer',
        topColor: '#1f2a44',
        topAccent: '#d9a441',
        neck: 'neck.lanyard',
        neckColor: '#d9a441',
        bottom: 'bottom.skirt',
        bottomColor: '#1f2a44',
        shoes: 'shoes.loafers',
        shoesColor: '#3b2518',
        accessory: 'acc.none',
      },
      spots: [
        { x: 7, y: 1, facing: 'sw' },
        { x: 6, y: 1, facing: 'sw', doing: 'work' },
        { x: 8, y: 1, facing: 'sw', sit: 'hq-desk-chair' },
      ],
      greeting: ['Welcome to Northstar!', 'Looking for someone? I can point you there.', 'Good to see you — make yourself at home.'],
    },
  ];

  const engDesks: Obj[] = [];
  for (const dx of [3, 5, 7]) {
    engDesks.push({ sprite: 'desk', x: dx, y: 4, w: 2, d: 1, facing: 'ne' });
    engDesks.push({ sprite: 'desk', x: dx, y: 5, w: 2, d: 1, facing: 'sw' });
    for (const cx of [dx, dx + 1]) {
      engDesks.push(chair(cx, 3, 'sw', 'office'));
      engDesks.push(chair(cx, 6, 'ne', 'office'));
    }
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
      // The desk pod on a slate rug.
      { id: 'eng-pod-rug', sprite: 'rug', x: 2, y: 2, w: 8, d: 6, flat: true, variant: 'slate' },
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
        variant: 'birch',
        label: 'Engineering Library',
        actions: [
          {
            kind: 'info',
            title: 'The Engineering Library',
            body: 'Borrowed books, design docs, and the famous “Why we chose Postgres” zine. Take one, leave one.',
          },
        ],
      },
      { sprite: 'bookshelf', x: 13, y: 0, facing: 'sw', variant: 'birch2' },
      { sprite: 'server-rack', x: 15, y: 0, facing: 'sw', label: 'The Toaster (retired build server)' },
      { id: 'eng-shelf3', sprite: 'bookshelf', x: 14, y: 0, facing: 'sw', variant: 'birch' },
      plant(10, 1),
      { id: 'eng-poster', sprite: 'poster', variant: 'ship', wall: 'right', x: 5, y: 0, label: 'Ship it' },
      // The kitchenette in the back corner: fridge, the café's counter with a machine of its own, water, fruit.
      { id: 'eng-fridge', sprite: 'fridge', x: 0, y: 0, facing: 'se', label: 'Fridge' },
      ...[1, 2].map((y): Obj => ({ id: `eng-counter-${y}`, sprite: 'counter', x: 0, y, facing: 'se', variant: 'cafe', label: 'Kitchenette' })),
      {
        id: 'eng-espresso',
        sprite: 'espresso',
        x: 0,
        y: 1,
        z: COUNTER_TOP,
        facing: 'se',
        label: 'Espresso machine',
        actions: [{ kind: 'vend', item: 'coffee', label: 'Get a coffee' }],
      },
      { id: 'eng-fruit', sprite: 'fruit-bowl', x: 0, y: 2, z: COUNTER_TOP, label: 'Fruit bowl' },
      { id: 'eng-water', sprite: 'water-cooler', x: 0, y: 3, facing: 'se', label: 'Water cooler' },
      // The pairing station against the left wall, a rolling whiteboard beside it.
      { id: 'eng-pair-desk', sprite: 'desk', x: 0, y: 6, w: 1, d: 2, facing: 'se', label: 'Pairing station' },
      { id: 'eng-pair-chair-1', ...chair(1, 6, 'nw', 'office') },
      { id: 'eng-pair-chair-2', ...chair(1, 7, 'nw', 'office') },
      { id: 'eng-pair-board', sprite: 'whiteboard-stand', x: 0, y: 8, facing: 'se', label: 'Pairing board' },
      // The meeting nook by the door, under the build dashboard.
      {
        id: 'eng-dashboard',
        sprite: 'dashboard',
        wall: 'left',
        x: 0,
        y: 10,
        d: 2,
        label: 'Build status',
        actions: [{ kind: 'info', title: 'Build status', body: 'Main is green. The nightly Aurora build finished in 11 minutes; one flaky test is quarantined.' }],
      },
      { id: 'eng-meet-rug', sprite: 'rug', x: 1, y: 9, w: 4, d: 3, flat: true, variant: 'teal' },
      { id: 'eng-meet-table', sprite: 'table-low', x: 2, y: 10, w: 1, d: 2 },
      { id: 'eng-meet-sofa', sprite: 'couch', variant: 'blue', x: 3, y: 10, w: 1, d: 2, facing: 'nw', actions: sit },
      { id: 'eng-meet-chair', sprite: 'armchair', variant: 'mustard', x: 1, y: 11, facing: 'se', actions: sit },
      { id: 'eng-meet-lamp', sprite: 'lamp', x: 4, y: 9, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      // The lounge: a sofa and a coffee table anchor the beanbags.
      { id: 'eng-lounge-rug', sprite: 'rug', x: 10, y: 6, w: 5, d: 5, flat: true, variant: 'teal' },
      { id: 'eng-lounge-sofa', sprite: 'couch', variant: 'green', x: 11, y: 6, w: 2, d: 1, facing: 'sw', actions: sit },
      { id: 'eng-lamp', sprite: 'lamp', x: 13, y: 6, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      { id: 'eng-lounge-table', sprite: 'table-low', x: 11, y: 7, w: 2, d: 1 },
      { sprite: 'beanbag', x: 11, y: 8, variant: 'orange', actions: sit },
      { sprite: 'beanbag', x: 12, y: 8, variant: 'purple', actions: sit },
      { sprite: 'beanbag', x: 10, y: 8, variant: 'cyan', actions: sit },
      { id: 'eng-lounge-side', sprite: 'table-low', x: 10, y: 7, w: 1, d: 1, variant: 'side' },
      plant(15, 10, 'b'),
      // A second, smaller pod at the front for the platform team.
      { id: 'eng-pod2-rug', sprite: 'rug', x: 5, y: 8, w: 4, d: 4, flat: true, variant: 'slate' },
      { id: 'eng-pod2-desk-1', sprite: 'desk', x: 6, y: 9, w: 2, d: 1, facing: 'ne' },
      { id: 'eng-pod2-desk-2', sprite: 'desk', x: 6, y: 10, w: 2, d: 1, facing: 'sw' },
      { id: 'eng-pod2-chair-1', ...chair(6, 8, 'sw', 'office') },
      { id: 'eng-pod2-chair-2', ...chair(7, 8, 'sw', 'office') },
      { id: 'eng-pod2-chair-3', ...chair(6, 11, 'ne', 'office') },
      { id: 'eng-pod2-chair-4', ...chair(7, 11, 'ne', 'office') },
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
      // The war room: the long table on a mission-navy rug under the launch board and countdown.
      { id: 'launch-war-rug', sprite: 'rug', x: 3, y: 3, w: 6, d: 4, flat: true, variant: 'mission' },
      { sprite: 'table-long', x: 4, y: 4, w: 4, d: 2, facing: 'sw', label: 'War-room table' },
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
      { id: 'launch-clock', sprite: 'clock-wall', wall: 'right', x: 5, y: 0, label: 'Mission clock' },
      { id: 'launch-window', sprite: 'window', wall: 'right', x: 9, y: 0, w: 2 },
      // The launch shrine: the Aurora 1.0 rocket between brass stanchions, the bell in front, on its own rug.
      { id: 'launch-shrine-rug', sprite: 'rug', x: 9, y: 1, w: 3, d: 4, flat: true, variant: 'navy' },
      {
        id: 'launch-12',
        sprite: 'rocket-model',
        x: 10,
        y: 2,
        label: 'Aurora 1.0 rocket',
        artifactId: 'art-aurora-rocket',
        actions: [{ kind: 'artifact', artifactId: 'art-aurora-rocket' }],
      },
      { id: 'launch-stanchion-1', sprite: 'stanchion', x: 9, y: 2 },
      { id: 'launch-stanchion-2', sprite: 'stanchion', x: 11, y: 2 },
      { id: 'launch-bell', sprite: 'heirloom-bell', x: 10, y: 4, label: 'The Launch Bell — ring it when something ships', actions: [{ kind: 'ring', label: 'Ring the bell' }] },
      plant(11, 5, 'b'),
      // The maker corner under the board: workbench, stools, a rack of spare parts.
      { id: 'launch-workbench', sprite: 'workbench', x: 2, y: 1, w: 2, d: 1, facing: 'sw', label: 'Workbench' },
      { id: 'launch-stool-1', sprite: 'stool', x: 2, y: 2, actions: sit },
      { id: 'launch-stool-2', sprite: 'stool', x: 3, y: 2, actions: sit },
      { id: 'launch-parts', sprite: 'parts-rack', x: 0, y: 1, facing: 'se', label: 'Spare parts' },
      plant(5, 1),
      // The wall of fame by the door: the hackathon photo, the star map, the mission patches.
      {
        id: 'launch-13',
        sprite: 'frame',
        wall: 'left',
        x: 0,
        y: 3,
        variant: 'hackathon',
        artifactId: 'art-hackathon',
        actions: [{ kind: 'artifact', artifactId: 'art-hackathon' }],
      },
      { id: 'launch-star-map', sprite: 'star-map', wall: 'left', x: 0, y: 4, d: 2, label: 'Star map' },
      { id: 'launch-patches', sprite: 'mission-patches', wall: 'left', x: 0, y: 8, label: 'Mission patches' },
      // A coffee corner by the door: two segments of the café's counter with a machine of its own.
      { id: 'launch-counter', sprite: 'counter', x: 0, y: 9, facing: 'se', variant: 'cafe', label: 'Coffee corner' },
      {
        id: 'launch-espresso',
        sprite: 'espresso',
        x: 0,
        y: 9,
        z: COUNTER_TOP,
        facing: 'se',
        label: 'Espresso machine',
        actions: [{ kind: 'vend', item: 'coffee', label: 'Get a coffee' }],
      },
      { id: 'launch-bench', sprite: 'bench', variant: 'navy', x: 3, y: 9, w: 2, d: 1, facing: 'ne', actions: sit },
      { id: 'launch-bench-table', sprite: 'table-low', x: 5, y: 9, w: 1, d: 1, variant: 'side' },
      // The break corner for the long nights before a launch.
      { id: 'launch-lounge-rug', sprite: 'rug', x: 6, y: 7, w: 5, d: 3, flat: true, variant: 'cream' },
      { id: 'launch-lamp', sprite: 'lamp', x: 6, y: 7, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      { id: 'launch-couch', sprite: 'couch', variant: 'blue', x: 7, y: 7, w: 2, d: 1, facing: 'sw', actions: sit },
      { id: 'launch-side-table', sprite: 'table-low', x: 9, y: 7, w: 1, d: 1, variant: 'side' },
      { id: 'launch-coffee-table', sprite: 'table-low', x: 7, y: 8, w: 2, d: 1 },
      { id: 'launch-beanbag-2', sprite: 'beanbag', x: 7, y: 9, variant: 'cyan', actions: sit },
      { sprite: 'beanbag', x: 8, y: 9, variant: 'orange', actions: sit },
      plant(10, 9, 'b'),
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
      // The stage: podium, speakers, the grand piano stage left, flower stands at the front corners.
      { sprite: 'stage', x: 4, y: 1, w: 8, d: 3, flat: true, solid: false, label: 'Stage' },
      { sprite: 'podium', x: 8, y: 2, facing: 'sw', label: 'Podium' },
      { id: 'events-cake', sprite: 'cake-table', x: 5, y: 2, w: 2, d: 1, facing: 'sw', eventDecor: 'balloons', label: 'Birthday cake' },
      { sprite: 'speaker', x: 3, y: 1, facing: 'sw' },
      { sprite: 'speaker', x: 12, y: 1, facing: 'sw' },
      { sprite: 'banner', wall: 'right', x: 5, y: 0, w: 6, label: 'Lantern Hall' },
      { sprite: 'lantern-string', wall: 'right', x: 1, y: 0, w: 3 },
      { sprite: 'lantern-string', wall: 'right', x: 12, y: 0, w: 3 },
      { id: 'events-flowers-1', sprite: 'flower-stand', x: 4, y: 4 },
      { id: 'events-flowers-2', sprite: 'flower-stand', x: 11, y: 4 },
      {
        id: 'events-piano',
        sprite: 'heirloom-piano',
        x: 13,
        y: 2,
        w: 2,
        d: 2,
        facing: 'sw',
        label: 'The Lantern Hall Grand',
        actions: [{ kind: 'info', title: 'The Lantern Hall Grand', body: 'Bought for the 2023 holiday party. Inês plays it every Thursday at four — requests welcome.' }],
      },
      // The audience either side of a plum aisle runner.
      { id: 'events-aisle', sprite: 'rug', x: 7, y: 4, w: 2, d: 6, flat: true, variant: 'plum' },
      ...seats,
      // Under the windows: a bistro table and a paper-lantern lamp.
      { sprite: 'window', wall: 'left', x: 0, y: 3, d: 2 },
      { sprite: 'window', wall: 'left', x: 0, y: 6, d: 2 },
      { id: 'events-bistro-2', sprite: 'table-round', x: 1, y: 6 },
      { id: 'events-bistro-2-chair-1', ...chair(1, 5, 'sw', 'cafe') },
      { id: 'events-bistro-2-chair-3', ...chair(1, 7, 'ne', 'cafe') },
      { id: 'events-lantern-1', sprite: 'lantern-floor', x: 0, y: 8, actions: [{ kind: 'toggle', label: 'Switch the lantern' }] },
      // By the piano, for the people who come for the music.
      { id: 'events-bistro', sprite: 'table-round', x: 14, y: 6 },
      { id: 'events-bistro-chair-1', ...chair(13, 6, 'se', 'cafe') },
      { id: 'events-bistro-chair-2', ...chair(15, 6, 'nw', 'cafe') },
      // The front of the hall: standing tables on a rose rug for mingling after the talk.
      { id: 'events-mingle-rug', sprite: 'rug', x: 3, y: 10, w: 8, d: 3, flat: true, variant: 'rose' },
      { id: 'events-cocktail-1', sprite: 'cocktail-table', x: 4, y: 11 },
      { id: 'events-cocktail-2', sprite: 'cocktail-table', x: 7, y: 11 },
      { id: 'events-cocktail-3', sprite: 'cocktail-table', x: 10, y: 11 },
      { id: 'events-lantern-2', sprite: 'lantern-floor', x: 2, y: 12, actions: [{ kind: 'toggle', label: 'Switch the lantern' }] },
      // The refreshment corner: the party table, the lemonade cart, a lantern.
      { id: 'events-refresh-rug', sprite: 'rug', x: 12, y: 9, w: 4, d: 4, flat: true, variant: 'plum' },
      { id: 'events-buffet', sprite: 'buffet', x: 13, y: 10, w: 2, d: 1, facing: 'sw', label: 'Refreshments' },
      { id: 'events-bar-cart', sprite: 'bar-cart', x: 12, y: 10, facing: 'se', label: 'Lemonade cart' },
      { id: 'events-cocktail-4', sprite: 'cocktail-table', x: 14, y: 12 },
      { id: 'events-flowers-3', sprite: 'flower-stand', x: 15, y: 9 },
      { id: 'events-lantern-3', sprite: 'lantern-floor', x: 15, y: 12, actions: [{ kind: 'toggle', label: 'Switch the lantern' }] },
      { sprite: 'balloons', x: 2, y: 4, eventDecor: 'balloons', solid: false },
      { sprite: 'balloons', x: 14, y: 4, eventDecor: 'balloons', variant: 'b', solid: false },
      { sprite: 'balloons', x: 15, y: 11, eventDecor: 'balloons', variant: 'c', solid: false },
      // Coats by the door.
      { id: 'events-coat-rack', sprite: 'coat-rack', x: 0, y: 9, label: 'Coat rack' },
      // Lanterns light the walk from the door to the stage.
      { id: 'events-lantern-4', sprite: 'lantern-floor', x: 2, y: 9, actions: [{ kind: 'toggle', label: 'Switch the lantern' }] },
      { id: 'events-lantern-5', sprite: 'lantern-floor', x: 12, y: 7, actions: [{ kind: 'toggle', label: 'Switch the lantern' }] },
      plant(1, 1, 'b'),
      plant(15, 1, 'b'),
      plant(0, 12, 'b'),
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
      // A wall of walnut shelving from the corner to the window and one beyond it (none beside the hearth, where
      // the fireside chairs would stand in front of it).
      ...[0, 1, 2, 3, 4, 8].map((x, i) => ({
        sprite: 'bookshelf',
        x,
        y: 0,
        facing: 'sw' as const,
        variant: i % 2 ? 'b' : 'a',
      })),
      { sprite: 'window', wall: 'right', x: 5, y: 0, w: 2 },
      // Wren's stacks: an ivy stand by the window, returns piled under it at the end of the shelves.
      { id: 'focus-ivy', sprite: 'plant', variant: 'ivy', x: 7, y: 0 },
      { id: 'focus-returns', sprite: 'book-stack', x: 5, y: 0, label: 'Returns' },
      // Fireside: two green wingbacks in an L round the hearth, a lamp-lit side table between them.
      { sprite: 'rug', x: 9, y: 1, w: 3, d: 2, flat: true, variant: 'cream' },
      { sprite: 'fireplace', x: 10, y: 0, w: 1, d: 1, facing: 'sw', label: 'Fireplace', actions: [{ kind: 'toggle', label: 'Light the fire' }] },
      { sprite: 'armchair', x: 9, y: 1, facing: 'se', variant: 'green', actions: sit },
      { sprite: 'armchair', x: 11, y: 1, facing: 'nw', variant: 'green', actions: sit },
      { id: 'focus-fire-table', sprite: 'side-table', variant: 'walnut', x: 9, y: 2, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      { id: 'focus-fern-1', sprite: 'plant', variant: 'fern', x: 11, y: 2 },
      // The window nook: a rust wingback and a banker's lamp.
      { sprite: 'armchair', x: 5, y: 1, facing: 'sw', variant: 'rust', actions: sit },
      { id: 'focus-nook-table', sprite: 'side-table', variant: 'walnut', x: 6, y: 1, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      // The study table on a forest rug, the old globe at its end.
      { id: 'focus-study-rug', sprite: 'rug', x: 1, y: 3, w: 6, d: 4, flat: true, variant: 'forest' },
      { sprite: 'desk', x: 2, y: 4, w: 2, d: 1, facing: 'sw', variant: 'wood' },
      { sprite: 'desk', x: 4, y: 4, w: 2, d: 1, facing: 'sw', variant: 'wood' },
      chair(2, 5, 'ne'),
      chair(3, 5, 'ne'),
      chair(4, 5, 'ne'),
      chair(5, 5, 'ne'),
      { id: 'focus-globe', sprite: 'globe-stand', x: 6, y: 4, label: 'The old globe' },
      // The reading circle: two wingbacks facing across the marble table, an ottoman footrest, on a forest rug.
      { id: 'focus-circle-rug', sprite: 'rug', x: 7, y: 5, w: 5, d: 5, flat: true, variant: 'forest' },
      { sprite: 'armchair', x: 8, y: 7, facing: 'se', variant: 'rust', actions: sit },
      { sprite: 'table-round', x: 9, y: 7 },
      { sprite: 'armchair', x: 10, y: 7, facing: 'nw', variant: 'rust', actions: sit },
      { id: 'focus-ottoman', sprite: 'ottoman', variant: 'green', x: 9, y: 8, label: 'Footrest' },
      { sprite: 'lamp', x: 8, y: 6 },
      { id: 'focus-circle-books', sprite: 'book-stack', x: 10, y: 8 },
      // A second nook by the door: two wingbacks and a side table.
      { id: 'focus-nook2-rug', sprite: 'rug', x: 1, y: 7, w: 4, d: 3, flat: true, variant: 'cream' },
      { id: 'focus-nook2-chair-1', sprite: 'armchair', x: 2, y: 8, facing: 'se', variant: 'green', actions: sit },
      { id: 'focus-nook2-table', sprite: 'side-table', variant: 'walnut', x: 3, y: 8, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      { id: 'focus-nook2-chair-2', sprite: 'armchair', x: 4, y: 8, facing: 'nw', variant: 'rust', actions: sit },
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
      // Plants in the corners only.
      plant(11, 9, 'b'),
      plant(0, 9, 'b'),
      { id: 'focus-dragonlamp', sprite: 'heirloom-dragonlamp', x: 11, y: 3, facing: 'sw', label: 'Jade Dragon Lamp — a gift from our Singapore customers', actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
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
      // The cabinet row stands against the back wall, the champion cabinet and the claw machine at its end.
      ...[1, 2, 3, 4].map((x, i) => ({
        sprite: 'arcade-cabinet',
        x,
        y: 0,
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
        id: 'arcade-5',
        sprite: 'arcade-cabinet',
        x: 9,
        y: 0,
        facing: 'sw',
        variant: 'gold',
        label: 'Offsite ’25 Champion Cabinet',
        artifactId: 'art-offsite-cabinet',
        actions: [{ kind: 'artifact', artifactId: 'art-offsite-cabinet' }],
      },
      { sprite: 'neon', wall: 'right', x: 5, y: 0, w: 3, label: 'PLAY' },
      { id: 'arcade-jukebox', sprite: 'jukebox', x: 6, y: 0, facing: 'sw', label: 'Jukebox' },
      { id: 'arcade-claw', sprite: 'claw-machine', x: 10, y: 0, facing: 'sw', label: 'Claw machine' },
      { id: 'arcade-stool-1', sprite: 'stool', variant: 'neon', x: 10, y: 2, actions: sit },
      { id: 'arcade-stool-2', sprite: 'stool', variant: 'neon', x: 11, y: 2, actions: sit },
      { id: 'arcade-window', sprite: 'window', wall: 'left', x: 0, y: 2, d: 2 },
      // A vinyl sofa under the pier window.
      { sprite: 'couch', x: 1, y: 2, w: 1, d: 2, facing: 'se', variant: 'purple', actions: sit },
      // The game floor.
      { sprite: 'pool-table', x: 3, y: 4, w: 3, d: 2, facing: 'sw', label: 'Pool table' },
      { id: 'arcade-air-hockey', sprite: 'air-hockey', x: 8, y: 4, w: 2, d: 1, facing: 'sw', label: 'Air hockey' },
      // Snacks and prizes by the door: the vending machine, the prize counter, a high table with stools.
      {
        id: 'arcade-vending',
        sprite: 'vending-machine',
        x: 0,
        y: 9,
        facing: 'se',
        label: 'Snack machine',
        actions: [{ kind: 'vend', item: 'soda', label: 'Get a soda' }],
      },
      {
        id: 'arcade-prizes',
        sprite: 'prize-counter',
        x: 1,
        y: 5,
        w: 1,
        d: 2,
        facing: 'se',
        label: 'Prize counter',
        actions: [{ kind: 'vend', item: 'plush', label: 'Trade in your tickets' }],
      },
      { id: 'arcade-snack-rug', sprite: 'rug', x: 2, y: 7, w: 5, d: 3, flat: true, variant: 'neon' },
      { id: 'arcade-high-table', sprite: 'table-high', variant: 'neon', x: 4, y: 8 },
      { id: 'arcade-stool-3', sprite: 'stool', variant: 'neon', x: 3, y: 8, actions: sit },
      { id: 'arcade-stool-4', sprite: 'stool', variant: 'neon', x: 5, y: 8, actions: sit },
      { id: 'arcade-popcorn', sprite: 'popcorn-cart', x: 6, y: 7, label: 'Popcorn', actions: [{ kind: 'vend', item: 'popcorn', label: 'Grab some popcorn' }] },
      // Beanbags round a side table in the front corner.
      { id: 'arcade-lounge-rug', sprite: 'rug', x: 8, y: 6, w: 4, d: 4, flat: true, variant: 'cyan' },
      { id: 'arcade-side-table', sprite: 'table-low', x: 9, y: 8, w: 1, d: 1, variant: 'side' },
      { sprite: 'beanbag', x: 9, y: 7, variant: 'cyan', actions: sit },
      { sprite: 'beanbag', x: 10, y: 9, variant: 'pink', actions: sit },
      { id: 'arcade-beanbag-3', sprite: 'beanbag', x: 8, y: 8, variant: 'purple', actions: sit },
      plant(11, 5),
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
      { id: 'design-window-2', sprite: 'window', wall: 'right', x: 10, y: 0, w: 2 },
      // Two desks facing the moodboard; a plant corner beside them.
      { sprite: 'desk', x: 1, y: 1, w: 2, d: 1, facing: 'sw', variant: 'light' },
      { id: 'design-desk-2', sprite: 'desk', x: 3, y: 1, w: 2, d: 1, facing: 'sw', variant: 'light' },
      chair(1, 2, 'ne', 'office'),
      chair(2, 2, 'ne', 'office'),
      { id: 'design-chair-3', ...chair(3, 2, 'ne', 'office') },
      { id: 'design-chair-4', ...chair(4, 2, 'ne', 'office') },
      { id: 'design-fiddle', sprite: 'plant', variant: 'fiddle', x: 0, y: 0 },
      { id: 'design-snake', sprite: 'plant', variant: 'snake', x: 0, y: 1 },
      { id: 'design-pothos', sprite: 'plant', variant: 'pothos', x: 6, y: 1 },
      // The making corner under the swatches: plan chest, a jacket in progress, the easels.
      { id: 'design-plan-chest', sprite: 'plan-chest', x: 7, y: 0, facing: 'sw', label: 'Plan chest' },
      { id: 'design-dress-form', sprite: 'dress-form', x: 9, y: 1, facing: 'sw', label: 'Jacket in progress' },
      { sprite: 'easel', x: 9, y: 3, facing: 'sw' },
      { sprite: 'easel', x: 10, y: 3, facing: 'sw', variant: 'b' },
      plant(11, 3, 'b'),
      // The crit wall: work pinned up for review, drafting stools on an oat rug.
      {
        id: 'design-pinup',
        sprite: 'pinup',
        wall: 'left',
        x: 0,
        y: 4,
        d: 3,
        label: 'Crit wall',
        actions: [{ kind: 'info', title: 'Crit wall', body: 'Thursday crit at three. Pin up what you have — half-finished is the point.' }],
      },
      { id: 'design-crit-rug', sprite: 'rug', x: 1, y: 4, w: 3, d: 3, flat: true, variant: 'oat' },
      { id: 'design-crit-stool-1', sprite: 'stool', variant: 'drafting', x: 2, y: 4, facing: 'nw', actions: sit },
      { id: 'design-crit-stool-2', sprite: 'stool', variant: 'drafting', x: 2, y: 5, facing: 'nw', actions: sit },
      { id: 'design-crit-stool-3', sprite: 'stool', variant: 'drafting', x: 2, y: 6, facing: 'nw', actions: sit },
      // The big worktable on the mustard rug.
      { sprite: 'rug', x: 5, y: 4, w: 5, d: 3, flat: true, variant: 'mustard' },
      { sprite: 'table-long', x: 6, y: 5, w: 3, d: 2, facing: 'sw', variant: 'light', label: 'Worktable' },
      { sprite: 'stool', x: 5, y: 5, actions: sit },
      { sprite: 'stool', x: 5, y: 6, actions: sit },
      { sprite: 'stool', x: 9, y: 5, actions: sit },
      { sprite: 'stool', x: 9, y: 6, actions: sit },
      // Materials by the door.
      { id: 'design-materials', sprite: 'materials-shelf', x: 0, y: 9, facing: 'se', label: 'Materials' },
      { id: 'design-paper', sprite: 'paper-bin', x: 1, y: 9, label: 'Paper rolls' },
      // The lounge: the sage sofa, a coffee table and the mustard armchairs under the arc lamp.
      { id: 'design-print', sprite: 'print', variant: 'poster', wall: 'right', x: 6, y: 0, label: 'Print' },
      { id: 'design-lounge-rug', sprite: 'rug', x: 6, y: 7, w: 6, d: 3, flat: true, variant: 'oat' },
      { id: 'design-arc-lamp', sprite: 'lamp-arc', x: 11, y: 7, actions: [{ kind: 'toggle', label: 'Switch the lamp' }] },
      { id: 'design-sofa', sprite: 'couch', variant: 'green', x: 7, y: 8, w: 1, d: 2, facing: 'se', actions: sit },
      { id: 'design-lounge-table', sprite: 'table-low', x: 8, y: 8, w: 1, d: 2 },
      { id: 'design-crit-1', sprite: 'armchair', variant: 'mustard', x: 9, y: 8, facing: 'nw', actions: sit },
      { id: 'design-crit-2', sprite: 'armchair', variant: 'mustard', x: 9, y: 9, facing: 'nw', actions: sit },
      { id: 'design-crit-table', sprite: 'table-round', x: 11, y: 8 },
      {
        id: 'design-globe',
        sprite: 'heirloom-globe',
        x: 11,
        y: 9,
        label: 'The Crystal Globe',
        actions: [{ kind: 'info', title: 'The Crystal Globe', body: 'Marks the day Northstar had teammates on every continent except Antarctica. (We’re working on it.)' }],
      },
    ],
  );

  // The prize counter's attendant works the lane behind it.
  arcade.staff = [{ x: 0, y: 5, w: 1, d: 2 }];
  arcade.npcs = [
    {
      id: 'attendant',
      name: 'Pip',
      role: 'Arcade attendant',
      blurb: 'Keeps the cabinets running and the prize counter stocked at Pixel Pier. Pip knows every high score in the building.',
      avatar: {
        skin: '#7c4a2d',
        hair: 'hair.curlyshort',
        hairColor: '#1f1612',
        eyes: 'eyes.wide',
        eyeColor: '#5a3825',
        brows: 'brows.bold',
        mouth: 'mouth.grin',
        headwear: 'hat.cap',
        headwearColor: '#4fe3f0',
        top: 'top.jersey',
        topColor: '#2a1f4a',
        topAccent: '#ff5fd1',
        bottom: 'bottom.jeans',
        bottomColor: '#1f2a44',
        shoes: 'shoes.hightops',
        shoesColor: '#ff5fd1',
        accessory: 'acc.none',
      },
      spots: [
        { x: 0, y: 5, facing: 'se' },
        { x: 0, y: 6, facing: 'se', doing: 'work' },
      ],
      serves: 'prize-counter',
      greeting: ['Welcome to Pixel Pier!', 'Tickets? Prizes are this way!', 'High score to beat is on cabinet two.'],
    },
  ];

  // The aisle along the stacks is the librarian's: Wren shelves returns and keeps the grove quiet, a step back
  // from the shelves so people can still reach them.
  focus.staff = [{ x: 1, y: 2, w: 3, d: 1 }];
  focus.npcs = [
    {
      id: 'librarian',
      name: 'Wren',
      role: 'Librarian',
      blurb: 'Looks after the Quiet Grove’s shelves. Ask Wren for a book, a quiet corner, or the famous “Why we chose Postgres” zine.',
      avatar: {
        skin: '#b3764c',
        hair: 'hair.pixie',
        hairColor: '#c9ced6',
        eyes: 'eyes.sleepy',
        eyeColor: '#3f9a6b',
        brows: 'brows.soft',
        mouth: 'mouth.smile',
        eyewear: 'eye.square',
        top: 'top.cardigan',
        topColor: '#6d8d68',
        topAccent: '#f4efe0',
        bottom: 'bottom.longskirt',
        bottomColor: '#4a3322',
        shoes: 'shoes.loafers',
        shoesColor: '#4a2c20',
        held: 'held.book',
        heldColor: '#d9a441',
        accessory: 'acc.none',
      },
      spots: [
        { x: 1, y: 2, facing: 'sw' },
        { x: 3, y: 2, facing: 'ne', doing: 'work' },
      ],
    },
  ];

  return [hq, cafe, eng, launch, events, focus, arcade, design];
}
