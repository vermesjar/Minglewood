/**
 * Things you can poke. Every interactive prop is defined here once and shared by server and
 * client: the server validates reach and rolls the (shared) outcome, every client in the scene
 * plays the same effect. Results are playful and ephemeral: nothing here is about people's work.
 */
import type { SceneObject } from './scene';

export type PropFx =
  | 'coin'
  | 'arcade'
  | 'notes'
  | 'sparks'
  | 'light'
  | 'clack'
  | 'crumbs'
  | 'steam'
  | 'book'
  | 'water'
  | 'mail'
  | 'luck'
  | 'paint'
  | 'reboot'
  | 'bell'
  | 'mic'
  | 'polish'
  | 'launch'
  | 'marshmallow'
  | 'icecream'
  | 'stargaze'
  | 'chess'
  | 'hoop'
  | 'harvest'
  | 'fish'
  | 'skip'
  | 'piano'
  | 'boardgame'
  | 'pingpong';

export interface PropInteraction {
  verb: string;
  emoji: string;
  fx: PropFx;
  /** Tiles from the object's footprint within which you can use it. */
  reach: number;
  /** Where to stand: in front of a facing prop, and at least this far away (a free throw). */
  front?: boolean;
  minDistance?: number;
}

/** Live, in-memory state for a prop (resets when the server restarts; never persisted). */
export interface PropState {
  n?: number;
  day?: string;
  on?: boolean;
  track?: number;
  best?: number;
  bestBy?: string;
  boostUntil?: number;
}

export interface PropResult {
  text?: string;
  n?: number;
  on?: boolean;
  track?: number;
  score?: number;
  best?: boolean;
  /** A little treat the actor carries for a while (e.g. ☕, 🍰). */
  give?: string;
  boostUntil?: number;
  /** A shot that went in, a fish that bit. */
  made?: boolean;
}

export const INTERACTIONS: Record<string, PropInteraction> = {
  fountain: { verb: 'Toss a coin', emoji: '🪙', fx: 'coin', reach: 2 },
  'arcade-cabinet': { verb: 'Play a round', emoji: '🕹️', fx: 'arcade', reach: 1.5 },
  speaker: { verb: 'Change the tune', emoji: '🎵', fx: 'notes', reach: 2 },
  fireplace: { verb: 'Stoke the fire', emoji: '🔥', fx: 'sparks', reach: 2 },
  lamp: { verb: 'Flick the light', emoji: '💡', fx: 'light', reach: 1.5 },
  'lamp-post': { verb: 'Flick the light', emoji: '💡', fx: 'light', reach: 1.5 },
  'pool-table': { verb: 'Take a shot', emoji: '🎱', fx: 'clack', reach: 1.5 },
  'cake-table': { verb: 'Grab a slice', emoji: '🍰', fx: 'crumbs', reach: 1.5 },
  counter: { verb: 'Order a coffee', emoji: '☕', fx: 'steam', reach: 1.5 },
  bookshelf: { verb: 'Pull out a book', emoji: '📚', fx: 'book', reach: 1.5 },
  plant: { verb: 'Water the plant', emoji: '💧', fx: 'water', reach: 1.5 },
  flowerbed: { verb: 'Water the flowers', emoji: '💧', fx: 'water', reach: 1.5 },
  mailbox: { verb: 'Check the mail', emoji: '✉️', fx: 'mail', reach: 1.5 },
  'rocket-statue': { verb: 'Rub for luck', emoji: '🍀', fx: 'luck', reach: 2 },
  easel: { verb: 'Add a brushstroke', emoji: '🎨', fx: 'paint', reach: 1.5 },
  'server-rack': { verb: 'Turn it off and on', emoji: '🔌', fx: 'reboot', reach: 1.5 },
  'bike-rack': { verb: 'Ring a bike bell', emoji: '🔔', fx: 'bell', reach: 1.5 },
  podium: { verb: 'Tap the mic', emoji: '🎤', fx: 'mic', reach: 1.5 },
  'trophy-case': { verb: 'Polish the trophies', emoji: '✨', fx: 'polish', reach: 1.5 },
  'rocket-model': { verb: 'Start the countdown', emoji: '🚀', fx: 'launch', reach: 1.5 },
  campfire: { verb: 'Toast a marshmallow', emoji: '🔥', fx: 'marshmallow', reach: 2 },
  'ice-cream-cart': { verb: 'Get an ice cream', emoji: '🍦', fx: 'icecream', reach: 1.5 },
  telescope: { verb: 'Look through the telescope', emoji: '🔭', fx: 'stargaze', reach: 1.5 },
  'chess-table': { verb: 'Play a quick game', emoji: '♟️', fx: 'chess', reach: 1.5 },
  hoop: { verb: 'Shoot a hoop', emoji: '🏀', fx: 'hoop', reach: 4, front: true, minDistance: 2 },
  'garden-bed': { verb: 'Pick something', emoji: '🧺', fx: 'harvest', reach: 1.5 },
  'fishing-spot': { verb: 'Cast a line', emoji: '🎣', fx: 'fish', reach: 1.5 },
  'stone-pile': { verb: 'Skip a stone', emoji: '🪨', fx: 'skip', reach: 1.5 },
  piano: { verb: 'Play a little tune', emoji: '🎹', fx: 'piano', reach: 1.5 },
  'board-games': { verb: 'Pick a board game', emoji: '🎲', fx: 'boardgame', reach: 1.5 },
  'ping-pong': { verb: 'Rally', emoji: '🏓', fx: 'pingpong', reach: 1.5 },
};

/** Is (x,y) on the side a prop faces? Props without a facing are fine from anywhere. */
export function inFrontOf(o: SceneObject, x: number, y: number): boolean {
  const cx = o.x + ((o.w ?? 1) - 1) / 2;
  const cy = o.y + ((o.d ?? 1) - 1) / 2;
  switch (o.facing) {
    case 'se':
      return x > cx;
    case 'nw':
      return x < cx;
    case 'sw':
      return y > cy;
    case 'ne':
      return y < cy;
    default:
      return true;
  }
}

export function interactionFor(o: SceneObject): PropInteraction | undefined {
  return INTERACTIONS[o.sprite];
}

/** Distance (tiles) from a point to an object's footprint. */
export function distanceToObject(o: SceneObject, x: number, y: number): number {
  const x0 = o.x;
  const y0 = o.y;
  const x1 = o.x + (o.w ?? 1) - 1;
  const y1 = o.y + (o.d ?? 1) - 1;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

export const TRACKS = [
  { name: 'Lo-fi study beats', color: '#9b6bd6' },
  { name: 'Bossa nova afternoon', color: '#f2a93b' },
  { name: 'City pop sunset', color: '#e24c9c' },
  { name: 'Chiptune jam', color: '#3ec7e0' },
  { name: 'Jazz trio, late set', color: '#ffd23f' },
  { name: 'Synthwave drive', color: '#ff5fd1' },
  { name: 'Silence (ahh)', color: '#b8b2a7' },
] as const;

const BOOKS = [
  'The Mythical Man-Month',
  'Thinking in Systems',
  'A Pattern Language',
  'The Design of Everyday Things',
  'Shape Up',
  'An Elegant Puzzle',
  'The Art of Gathering',
  'Working in Public',
  'How Buildings Learn',
  'Team Topologies',
  'Crucial Conversations',
  'Four Thousand Weeks',
  'a very worn cookbook',
  'a sci-fi paperback with a coffee ring',
];

const MAIL = [
  'A postcard from the last offsite: “wish you were here!”',
  'A seed packet labelled “plant anywhere”.',
  'A thank-you note with no signature. Mysterious.',
  'A flyer: “Lost: one rubber duck. Answers to Quackers.”',
  'A tiny drawing of the lighthouse.',
  'An invite to the next Friday demo — bring snacks.',
  'Nothing. The mailbox echoes gently.',
];

const POOL = ['Sank two stripes in a row!', 'Scratched. Classic.', 'A clean bank shot. Show-off.', 'The 8-ball, way too early…', 'Missed by a mile, but it looked cool.'];
const LUCK = ['Luck +1 ✨', 'Your next build will pass. Probably.', 'Fortune favors the bold (and the caffeinated).', 'Somebody out there just smiled.', 'Great things incoming.'];
const REBOOT = ['Blinkenlights restored.', 'It was DNS. It’s always DNS.', 'The fans sigh contentedly.', 'Uptime: 0 seconds. Fresh start!'];
const MIC = ['*tap tap* Is this thing on?', '*squeal* …sorry!', 'Testing, one, two.'];

const FISH: Array<{ name: string; w: number; kg: [number, number] }> = [
  { name: 'a perch', w: 22, kg: [0.2, 0.6] },
  { name: 'a bluegill', w: 20, kg: [0.1, 0.4] },
  { name: 'a little minnow', w: 14, kg: [0.02, 0.05] },
  { name: 'a rainbow trout', w: 10, kg: [0.8, 2.4] },
  { name: 'a sleepy catfish', w: 8, kg: [1.5, 4.5] },
  { name: 'an old boot 👢', w: 8, kg: [0.6, 0.9] },
  { name: 'Quackers, the lost rubber duck 🦆', w: 3, kg: [0.05, 0.05] },
  { name: 'a GOLDEN KOI ✨', w: 2, kg: [2, 3.5] },
  { name: 'nothing — the fish are napping', w: 13, kg: [0, 0] },
];
const SIGHTS = [
  'A heron gliding over the lake.',
  'Someone waving from the lighthouse.',
  'Saturn’s rings, faint but there.',
  'The Moon’s craters, crisp tonight.',
  'A sailboat far out past the island.',
  'A shooting star! Make a wish.',
  'The HQ clock. You’re not late. Probably.',
];
const CHESS = ['Won with a sneaky knight fork ♞', 'Stalemate. Honor preserved.', 'Lost to the pigeon. Again.', 'Checkmate in 17 moves ♛', 'Resigned gracefully, with a bow.'];
const FLAVORS = ['Lemon sorbet', 'Salted caramel', 'Pistachio', 'Strawberry swirl', 'Mint chip', 'Blue raspberry (it’s blue!)'];
const TUNES = ['a little Satie', 'chopsticks, with feeling', 'the first bars of Clair de Lune', 'something jazzy and made-up', 'the office birthday song'];
const GAMES = ['Catan — who’s in?', 'Codenames — pick your spymaster.', 'Ticket to Ride — all aboard.', 'Wingspan — bird nerds unite.', 'a 1000-piece lighthouse puzzle.'];
const CROPS = ['🍅', '🥕', '🍓', '🌽', '🌻'];

function weighted<T extends { w: number }>(arr: readonly T[], r: () => number): T {
  let x = r() * arr.reduce((t, a) => t + a.w, 0);
  for (const a of arr) if ((x -= a.w) < 0) return a;
  return arr[arr.length - 1];
}

export const pick = <T>(arr: readonly T[], r = Math.random): T => arr[Math.floor(r() * arr.length)];

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Roll a shared outcome and update the prop's state. `name` is the actor's first name.
 * Pure apart from `state` and `rand`, so it's easy to test.
 */
export function rollInteraction(o: SceneObject, state: PropState, name: string, now = Date.now(), rand = Math.random): PropResult {
  const it = interactionFor(o);
  if (!it) return {};
  const today = dayKey(now);
  const bump = () => {
    if (state.day !== today) {
      state.day = today;
      state.n = 0;
    }
    state.n = (state.n ?? 0) + 1;
    return state.n;
  };
  switch (it.fx) {
    case 'coin': {
      const n = bump();
      return { n, text: n === 1 ? 'First wish of the day ✨' : `Wish #${n} today ✨` };
    }
    case 'arcade': {
      const score = Math.round((800 + rand() * rand() * 98_000) / 10) * 10;
      const best = score > (state.best ?? 0);
      if (best) {
        state.best = score;
        state.bestBy = name;
      }
      return { score, best, text: best ? `🏆 New high score: ${score.toLocaleString('en-US')}!` : `${score.toLocaleString('en-US')} pts · best ${(state.best ?? 0).toLocaleString('en-US')} (${state.bestBy})` };
    }
    case 'notes': {
      state.track = ((state.track ?? 0) + 1) % TRACKS.length;
      return { track: state.track, text: `Now playing: ${TRACKS[state.track].name}` };
    }
    case 'sparks': {
      state.boostUntil = now + 25_000;
      return { boostUntil: state.boostUntil, text: 'The fire roars happily.' };
    }
    case 'light': {
      state.on = state.on === false;
      return { on: state.on };
    }
    case 'clack':
      return { text: pick(POOL, rand) };
    case 'crumbs':
      return { give: '🍰', text: 'Mmm. Frosting.' };
    case 'steam':
      return { give: '☕', text: pick(['One flat white, coming up.', 'Oat latte, extra foam.', 'Pour-over, fruity notes.', 'Hot chocolate. No regrets.'], rand) };
    case 'book':
      return { give: '📖', text: `Reading “${pick(BOOKS, rand)}”` };
    case 'water': {
      const n = bump();
      return { n, text: n === 1 ? 'Thirsty no more 🌱' : `Watered ${n} times today — it’s thriving 🌱` };
    }
    case 'mail':
      return { text: pick(MAIL, rand) };
    case 'luck':
      return { text: pick(LUCK, rand) };
    case 'paint': {
      const n = bump();
      return { n, text: `Brushstroke #${n} on today’s canvas 🎨` };
    }
    case 'reboot':
      return { text: pick(REBOOT, rand) };
    case 'bell':
      return { text: 'Brring brring!' };
    case 'mic':
      return { text: pick(MIC, rand) };
    case 'polish':
      return { text: 'Sparkling. The past has never looked better.' };
    case 'launch':
      return { text: '3… 2… 1… 🚀' };
    case 'marshmallow':
      return rand() < 0.2 ? { give: '🍡', text: 'It caught fire. Still delicious.' } : { give: '🍡', text: 'Golden brown. Perfection.' };
    case 'icecream': {
      const f = pick(FLAVORS, rand);
      return { give: '🍦', text: `${f}, one scoop` };
    }
    case 'stargaze':
      return { text: pick(SIGHTS, rand) };
    case 'chess':
      return { text: pick(CHESS, rand) };
    case 'hoop': {
      // Streaks belong to whoever's shooting; a miss resets it.
      if (state.bestBy !== name) state.n = 0;
      state.bestBy = name;
      const made = rand() < 0.45 + Math.min(0.2, (state.n ?? 0) * 0.04);
      state.n = made ? (state.n ?? 0) + 1 : 0;
      const streak = state.n;
      return { made, n: streak, text: made ? (streak >= 3 ? `Swish! ${streak} in a row 🔥` : 'Swish!') : pick(['Off the rim.', 'Airball…', 'So close!'], rand) };
    }
    case 'harvest': {
      const n = bump();
      const crop = pick(CROPS, rand);
      return { n, give: crop, text: `Picked a ${crop} — ${n} harvested today` };
    }
    case 'fish': {
      const f = weighted(FISH, rand);
      const kg = f.kg[0] + rand() * (f.kg[1] - f.kg[0]);
      const made = f.kg[1] > 0;
      const best = made && kg > (state.best ?? 0) && !f.name.includes('boot') && !f.name.includes('Quackers');
      if (best) {
        state.best = Math.round(kg * 10) / 10;
        state.bestBy = name;
      }
      const size = made && kg >= 0.1 ? ` (${kg.toFixed(1)} kg)` : '';
      return { made, best, text: `${made ? 'Caught' : 'Caught'} ${f.name}${size}${best ? ' — biggest today!' : ''}` };
    }
    case 'skip': {
      const n = Math.max(1, Math.min(12, Math.round(1 + rand() * 4 + rand() * rand() * 7)));
      const best = n > (state.best ?? 0);
      if (best) {
        state.best = n;
        state.bestBy = name;
      }
      return { n, best, text: best ? `${n} skips — a new record!` : `${n} skip${n === 1 ? '' : 's'} (record: ${state.best} by ${state.bestBy})` };
    }
    case 'piano':
      return { text: `Played ${pick(TUNES, rand)}` };
    case 'boardgame':
      return { text: `Pulled out ${pick(GAMES, rand)}` };
    case 'pingpong': {
      const n = 1 + Math.floor(rand() * rand() * 40);
      const best = n > (state.best ?? 0);
      if (best) {
        state.best = n;
        state.bestBy = name;
      }
      return { n, best, text: best ? `${n}-hit rally — table record!` : `${n}-hit rally` };
    }
  }
}
