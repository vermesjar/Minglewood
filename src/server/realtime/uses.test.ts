import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { allScenes, getScene } from '@shared/world';
import { WalkGrid } from '@shared/world/walkGrid';
import { approach, approachTiles } from '@shared/world/interact';
import { FACING_VEC } from '@shared/world/seats';
import { footprint, type Facing, type SceneDef, type SceneObject } from '@shared/world/scene';
import { NOTE_SPRITES, USE_BY_SPRITE, VEND_BY_SPRITE, interactionFor } from '@shared/world/uses';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { NOTES_PER_BOARD, NOTE_MAX_CHARS } from '@shared/protocol';
import { OrgHub, SELF_SERVE_MS, type HubClient } from './orgHub';
import { CLAW_DROP_MS, NOTE_GAP_MS, USE_COOLDOWN_MS, USE_PERSON_GAP_MS, cleanNote, outcomeOf } from './uses';

function client(memberId: string) {
  const msgs: ServerMsg[] = [];
  const c: HubClient & { msgs: ServerMsg[] } = { id: `c-${memberId}-${Math.random()}`, memberId, sceneId: null, msgs, send: (m) => msgs.push(m) };
  return c;
}

function member(store: Store, name: string, role: 'member' | 'admin' = 'member') {
  return store.createMember(ORG_ID, {
    displayName: name,
    title: 'Tester',
    departmentId: 'dep-eng',
    teamId: 'team-platform',
    location: 'Remote',
    timezone: 'UTC',
    startDate: '2026-01-01',
    askMeAbout: [],
    interests: [],
    role,
    avatar: DEFAULT_LOADOUT,
    unlockedItems: [],
    settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
  });
}

const find = (sceneId: string, sprite: string) => getScene(sceneId)!.objects.find((o) => o.sprite === sprite)!;

/** Stand someone where they use `o` from. */
function standAt(hub: OrgHub, memberId: string, sceneId: string, o: SceneObject) {
  const scene = getScene(sceneId)!;
  const way = approach(new WalkGrid(scene), [scene.spawn.x, scene.spawn.y], o)!;
  hub.enter(memberId, sceneId, 'live', way.tile);
}

describe('using things', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    vi.useFakeTimers();
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => {
    hub.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays the jukebox for the whole room: a moment with the song, and who put it on says so', () => {
    const a = member(store, 'Ada Lovelace');
    const b = member(store, 'Bo');
    const ca = client(a.id);
    const cb = client(b.id);
    hub.connect(ca);
    hub.connect(cb);
    const jukebox = find('arcade', 'jukebox');
    standAt(hub, a.id, 'arcade', jukebox);
    hub.enter(b.id, 'arcade', 'live');
    expect(hub.use(a.id, jukebox.id)).toBe(true);
    const moment = cb.msgs.find((m) => m.t === 'moment' && m.objectId === jukebox.id);
    expect(moment).toMatchObject({ what: 'song', by: a.id });
    const song = moment && moment.t === 'moment' ? moment.detail : undefined;
    expect(song).toBeTruthy();
    expect(cb.msgs.some((m) => m.t === 'said' && m.memberId === a.id && m.text.includes(song!))).toBe(true);
    // turned to face it
    expect(cb.msgs.some((m) => m.t === 'updated' && m.memberId === a.id && m.patch.facing)).toBe(true);
  });

  it('only works standing at it, and not on a double click or while it is still going', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    hub.connect(client(a.id));
    hub.connect(client(b.id));
    const piano = find('events', 'heirloom-piano');
    hub.enter(a.id, 'events', 'live'); // at the door, nowhere near the piano
    expect(hub.use(a.id, piano.id)).toBe(false);
    standAt(hub, a.id, 'events', piano);
    expect(hub.use(a.id, piano.id)).toBe(true);
    expect(hub.use(a.id, piano.id)).toBe(false); // double click
    standAt(hub, b.id, 'events', piano);
    expect(hub.use(b.id, piano.id)).toBe(false); // still playing
    vi.advanceTimersByTime(Math.max(USE_PERSON_GAP_MS, USE_COOLDOWN_MS.piano) + 10);
    expect(hub.use(b.id, piano.id)).toBe(true);
  });

  it('refuses things that have no use', () => {
    const a = member(store, 'Ada');
    hub.connect(client(a.id));
    const cake = find('events', 'cake-table');
    standAt(hub, a.id, 'events', cake);
    expect(hub.use(a.id, cake.id)).toBe(false);
  });

  it('the claw machine: sometimes you win a plush to carry, sometimes it slips', () => {
    const a = member(store, 'Ada');
    const ca = client(a.id);
    hub.connect(ca);
    const claw = find('arcade', 'claw-machine');
    standAt(hub, a.id, 'arcade', claw);
    const carried = () => ca.msgs.filter((m) => m.t === 'updated' && m.memberId === a.id && m.patch.carrying).map((m) => m.t === 'updated' && m.patch.carrying);
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // miss
    expect(hub.use(a.id, claw.id)).toBe(true);
    vi.advanceTimersByTime(CLAW_DROP_MS + 10);
    expect(carried()).toHaveLength(0);
    expect(ca.msgs.some((m) => m.t === 'said' && m.text.includes('So close'))).toBe(true);
    vi.advanceTimersByTime(USE_COOLDOWN_MS.claw);
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // win
    expect(hub.use(a.id, claw.id)).toBe(true);
    expect(carried()).toHaveLength(0); // not until the claw is back up
    vi.advanceTimersByTime(CLAW_DROP_MS + 10);
    expect(carried().pop()).toBe('plush');
  });

  it('keeps each arcade cabinet’s high score', () => {
    const a = member(store, 'Ada');
    const ca = client(a.id);
    hub.connect(ca);
    const cab = find('arcade', 'arcade-cabinet');
    standAt(hub, a.id, 'arcade', cab);
    const lines = () => ca.msgs.filter((m) => m.t === 'said').map((m) => (m.t === 'said' ? m.text : ''));
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    expect(hub.use(a.id, cab.id)).toBe(true);
    expect(lines().pop()).toMatch(/New high score/);
    vi.advanceTimersByTime(USE_COOLDOWN_MS.arcade + 10);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(hub.use(a.id, cab.id)).toBe(true);
    expect(lines().pop()).toMatch(/best .*Ada/);
  });

  it('borrows a book from the shelves to carry around', () => {
    const a = member(store, 'Ada');
    const ca = client(a.id);
    hub.connect(ca);
    const shelf = getScene('focus')!.objects.find((o) => o.sprite === 'bookshelf' && o.actions?.some((x) => x.kind === 'vend'))!;
    expect(shelf).toBeTruthy();
    standAt(hub, a.id, 'focus', shelf);
    expect(hub.carry(a.id, shelf.id)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(ca.msgs.some((m) => m.t === 'updated' && m.patch.carrying === 'book')).toBe(true);
  });

  it('a cup of water from the cooler, an apple from the fruit bowl', () => {
    const a = member(store, 'Ada');
    const ca = client(a.id);
    hub.connect(ca);
    const carried = () => ca.msgs.filter((m) => m.t === 'updated' && m.patch.carrying).map((m) => (m.t === 'updated' ? m.patch.carrying : null));
    standAt(hub, a.id, 'eng', find('eng', 'water-cooler'));
    expect(hub.carry(a.id, find('eng', 'water-cooler').id)).toBe(true);
    vi.advanceTimersByTime(SELF_SERVE_MS + 10);
    expect(carried().pop()).toBe('water');
    standAt(hub, a.id, 'eng', find('eng', 'fruit-bowl'));
    expect(hub.carry(a.id, find('eng', 'fruit-bowl').id)).toBe(true);
    vi.advanceTimersByTime(SELF_SERVE_MS + 10);
    expect(carried().pop()).toBe('apple');
  });

  it('a toast at the podium: the room sees it and hears it', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    const cb = client(b.id);
    hub.connect(client(a.id));
    hub.connect(cb);
    const podium = find('events', 'podium');
    standAt(hub, a.id, 'events', podium);
    hub.enter(b.id, 'events', 'live');
    expect(hub.use(a.id, podium.id)).toBe(true);
    expect(cb.msgs.some((m) => m.t === 'moment' && m.what === 'toast' && m.by === a.id)).toBe(true);
    expect(cb.msgs.some((m) => m.t === 'said' && m.memberId === a.id && m.text.startsWith('🥂'))).toBe(true);
  });

  it('a quiet room keeps quiet: the globe spins for everyone, nobody announces it', () => {
    const a = member(store, 'Ada');
    const ca = client(a.id);
    hub.connect(ca);
    const globe = find('focus', 'globe-stand');
    standAt(hub, a.id, 'focus', globe);
    expect(hub.use(a.id, globe.id)).toBe(true);
    const moment = ca.msgs.find((m) => m.t === 'moment' && m.objectId === globe.id);
    expect(moment && moment.t === 'moment' && moment.detail).toBeTruthy();
    expect(ca.msgs.some((m) => m.t === 'said')).toBe(false);
  });

  it('the table plays out what the server decides: balls down on the break, the shot, the claw', () => {
    const rands = (...xs: number[]) => {
      let i = 0;
      return () => xs[i++ % xs.length];
    };
    expect(outcomeOf('pool', { rand: rands(0.1, 0.9) })).toEqual({ detail: '0', line: '🎱 Nothing dropped — tough table' });
    expect(outcomeOf('pool', { rand: rands(0.7, 0.9) }).detail).toBe('2');
    expect(outcomeOf('pool', { rand: rands(0.5, 0.05) })).toMatchObject({ detail: '1s', line: '🎱 Scratched… classic' });
    expect(outcomeOf('hockey', { rand: rands(0.99) })).toEqual({ detail: 'blocked', line: '🏒 Blocked!' });
    expect(outcomeOf('claw', { rand: rands(0.1) })).toEqual({ win: true, detail: 'win' });
  });
});

describe('notes on the boards', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    vi.useFakeTimers();
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => {
    hub.dispose();
    vi.useRealTimers();
  });

  const board = () => getScene('eng')!.objects.find((o) => o.sprite === 'whiteboard' && o.wall)!;
  const notesOf = (c: { msgs: ServerMsg[] }) => {
    const last = c.msgs.filter((m) => m.t === 'notes').pop();
    return last && last.t === 'notes' ? last.notes : [];
  };

  it('pins a short note for the room, cleaned, and shows it to whoever comes in later', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    const ca = client(a.id);
    const cb = client(b.id);
    hub.connect(ca);
    hub.connect(cb);
    hub.enter(a.id, 'eng', 'live'); // at the door
    expect(hub.note(a.id, board().id, 'hello')).toBe(false); // walk up first
    standAt(hub, a.id, 'eng', board());
    expect(hub.note(a.id, board().id, '  Standup moved to 10:15 <b>today</b>\n\u202e!  ')).toBe(true);
    expect(notesOf(ca)).toMatchObject([{ by: a.id, text: 'Standup moved to 10:15 btoday/b !' }]);
    hub.enter(b.id, 'eng', 'live');
    const scene = cb.msgs.filter((m) => m.t === 'scene').pop();
    expect(scene && scene.t === 'scene' && scene.notes?.map((n) => n.text)).toEqual(['Standup moved to 10:15 btoday/b !']);
  });

  it('one note at a time per person, and a full board lets its oldest go', () => {
    const people = Array.from({ length: NOTES_PER_BOARD + 1 }, (_, i) => member(store, 'P' + i));
    const cs = people.map((p) => client(p.id));
    cs.forEach((c) => hub.connect(c));
    for (const p of people) standAt(hub, p.id, 'eng', board());
    expect(hub.note(people[0].id, board().id, 'first')).toBe(true);
    expect(hub.note(people[0].id, board().id, 'again')).toBe(false); // too soon
    vi.advanceTimersByTime(NOTE_GAP_MS + 10);
    people.slice(1).forEach((p, i) => expect(hub.note(p.id, board().id, 'note ' + (i + 1))).toBe(true));
    const texts = notesOf(cs[0]).map((n) => n.text);
    expect(texts).toHaveLength(NOTES_PER_BOARD);
    expect(texts).not.toContain('first');
    expect(cleanNote('x'.repeat(NOTE_MAX_CHARS + 20))).toHaveLength(NOTE_MAX_CHARS);
    expect(cleanNote(' \u0000 ')).toBe('');
  });

  it('only the person who left a note (or an admin) takes it down', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    const boss = member(store, 'Boss', 'admin');
    const ca = client(a.id);
    [ca, client(b.id), client(boss.id)].forEach((c) => hub.connect(c));
    for (const p of [a, b, boss]) standAt(hub, p.id, 'eng', board());
    hub.note(a.id, board().id, 'mine');
    hub.note(b.id, board().id, 'theirs');
    const [mine, theirs] = notesOf(ca);
    expect(hub.unnote(b.id, mine.id)).toBe(false);
    expect(hub.unnote(a.id, mine.id)).toBe(true);
    expect(hub.unnote(boss.id, theirs.id)).toBe(true);
    expect(notesOf(ca)).toEqual([]);
  });
});

describe('every usable thing', () => {
  it('nothing that should do something was left out for standing where nobody can reach it', () => {
    const left: string[] = [];
    for (const scene of allScenes().values())
      for (const o of scene.objects) {
        const kinds = new Set(o.actions?.map((a) => a.kind));
        const vend = (o.variant && VEND_BY_SPRITE[o.sprite + '.' + o.variant]) || VEND_BY_SPRITE[o.sprite];
        if ((interactionFor(o) && !o.wall && !kinds.has('use')) || (vend && !o.wall && !kinds.has('vend')) || (NOTE_SPRITES.has(o.sprite) && !kinds.has('note')))
          left.push(scene.id + '/' + o.id + ' (' + o.sprite + ')');
      }
    expect(left).toEqual([]);
  });

  it('can be walked up to and used, in every room and in town', () => {
    const stuck: string[] = [];
    let n = 0;
    for (const scene of allScenes().values()) {
      const grid = new WalkGrid(scene);
      for (const o of scene.objects) {
        if (!o.actions?.some((a) => a.kind === 'use')) continue;
        n++;
        if (!approach(grid, [scene.spawn.x, scene.spawn.y], o)) stuck.push(`${scene.id}/${o.id} (${o.sprite})`);
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(stuck).toEqual([]);
  });

  // Every kind of usable thing, turned all four ways in an empty room: you use it from the floor beside it,
  // from its working face when it has one.
  const kinds = Object.keys(USE_BY_SPRITE);
  const facings: Facing[] = ['se', 'sw', 'ne', 'nw'];
  for (const sprite of kinds)
    it(`${sprite} is used from its front in all four rotations`, () => {
      const real = [...allScenes().values()].flatMap((s) => s.objects).find((o) => o.sprite === sprite);
      const [w0, d0] = [real?.w ?? 1, real?.d ?? 1];
      for (const facing of facings) {
        // a long piece's length runs across the way it faces
        const long = Math.max(w0, d0);
        const short = Math.min(w0, d0);
        const [w, d] = w0 === d0 ? [w0, d0] : facing === 'se' || facing === 'nw' ? [short, long] : [long, short];
        const o: SceneObject = { id: 'x', sprite, x: 4, y: 4, w, d, facing, actions: [{ kind: 'use', use: USE_BY_SPRITE[sprite].use, label: '' }] };
        const scene: SceneDef = {
          id: 'test',
          kind: 'interior',
          name: 'test',
          width: 12,
          height: 12,
          tiles: Array.from({ length: 12 }, () => '.'.repeat(12)),
          spawn: { x: 0, y: 0 },
          objects: [o],
        };
        const way = approach(new WalkGrid(scene), [0, 0], o);
        expect(way, `${sprite} ${facing}`).not.toBeNull();
        const [tx, ty] = way!.tile;
        const f = footprint(o);
        // edge-adjacent to the footprint
        const nearX = tx < f.x0 ? f.x0 - tx : tx >= f.x1 ? tx - f.x1 + 1 : 0;
        const nearY = ty < f.y0 ? f.y0 - ty : ty >= f.y1 ? ty - f.y1 + 1 : 0;
        expect(nearX + nearY, `${sprite} ${facing} adjacent`).toBe(1);
        // on the working face
        const [fx, fy] = FACING_VEC[facing];
        const front = approachTiles(o).filter(([x, y]) => (fx > 0 && x === f.x1) || (fx < 0 && x === f.x0 - 1) || (fy > 0 && y === f.y1) || (fy < 0 && y === f.y0 - 1));
        expect(front.some(([x, y]) => x === tx && y === ty), `${sprite} ${facing} from the front`).toBe(true);
      }
    });
});
