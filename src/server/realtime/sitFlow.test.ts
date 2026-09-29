/**
 * The sit flow, end to end on the server, for every cushion of every seat in every room and the town: stand
 * near it (in front, behind, beside), walk the path the client would walk to that cushion, arrive, sit — and
 * be seated on exactly that cushion, facing the seat's way. Then re-sit on the same cushion (nothing moves) and
 * stand up (you step off onto the floor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { getScene } from '@shared/world';
import { isSeat } from '@shared/world/scene';
import { seatSpots, FACING_VEC } from '@shared/world/seats';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, pathLength, WALK_SPEED, type Tile } from '@shared/world/pathfinding';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { fromWirePatch, type Occupant, type ServerMsg, type WirePatch } from '@shared/protocol';
import { OrgHub, type HubClient } from './orgHub';
import { encodeServerMsg } from './socketServer';

const SCENES = ['cafe', 'hq', 'eng', 'launch', 'events', 'focus', 'arcade', 'design', 'town'];

describe('the sit flow', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => {
    hub.dispose();
    vi.useRealTimers();
  });

  const member = (name: string) =>
    store.createMember(ORG_ID, {
      displayName: name,
      title: 'Tester',
      departmentId: 'dep-eng',
      teamId: 'team-platform',
      location: 'Remote',
      timezone: 'UTC',
      startDate: '2026-01-01',
      askMeAbout: [],
      interests: [],
      role: 'member',
      avatar: DEFAULT_LOADOUT,
      unlockedItems: [],
      settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
    });

  it('seats you on exactly the cushion you walked to, from the front, behind or the side', () => {
    const failures: string[] = [];
    let n = 0;
    for (const sceneId of SCENES) {
      const scene = getScene(sceneId)!;
      const grid = new WalkGrid(scene);
      for (const seat of scene.objects.filter(isSeat)) {
        for (const spot of seatSpots(seat, scene)) {
          const [fx, fy] = FACING_VEC[spot.facing];
          // somewhere to start: in front, behind, beside (the first walkable of each)
          const starts: Array<[string, Tile]> = [];
          for (const [label, cands] of [
            ['front', [[spot.x + fx, spot.y + fy], [spot.x + 2 * fx, spot.y + 2 * fy]]],
            ['behind', [[spot.x - fx, spot.y - fy], [spot.x - 2 * fx, spot.y - 2 * fy]]],
            ['side', [[spot.x + fy, spot.y + fx], [spot.x - fy, spot.y - fx], [spot.x + 2 * fy, spot.y + 2 * fx], [spot.x - 2 * fy, spot.y - 2 * fx]]],
          ] as Array<[string, Tile[]]>) {
            const t = cands.find(([x, y]) => grid.walkable(x, y));
            if (t) starts.push([label, t]);
          }
          for (const [label, start] of starts) {
            const path = findPath(grid, start, [spot.x, spot.y], { allowGoal: true });
            if (!path) continue; // unreachable from this side (e.g. the far side of a wall): the client says so
            const m = member(`s${n++}`);
            hub.connect({ id: `c-${m.id}`, memberId: m.id, sceneId: null, send: () => undefined } as HubClient);
            hub.enter(m.id, sceneId, 'live', start);
            // walk there as the client does (sends the path now), then let the walk play out
            const took = (pathLength(path) / WALK_SPEED) * 1000;
            const ok = path.length < 2 || hub.move(m.id, path, Date.now());
            if (!ok) {
              failures.push(`${sceneId} ${seat.id} cushion ${spot.index} from ${label}: walk refused`);
              hub.removeActor(m.id);
              continue;
            }
            // the client sends `sit` as it arrives, a beat before the server's clock gets there
            vi.setSystemTime(Date.now() + Math.max(0, took - 80));
            const sat = hub.sit(m.id, seat.id, [spot.x, spot.y]);
            const a = hub.actor(m.id)!;
            if (!sat || a.sittingOn !== seat.id || a.x !== spot.x || a.y !== spot.y || a.facing !== spot.facing)
              failures.push(`${sceneId} ${seat.id} cushion ${spot.index} from ${label}: sat=${sat} at ${a.x},${a.y} ${a.facing} on ${a.sittingOn ?? '-'}`);
            else {
              // re-sitting on your own cushion changes nothing
              hub.sit(m.id, seat.id, [spot.x, spot.y]);
              const b = hub.actor(m.id)!;
              if (b.x !== spot.x || b.y !== spot.y || b.sittingOn !== seat.id) failures.push(`${sceneId} ${seat.id}: re-sit moved you`);
              hub.stand(m.id);
              const c = hub.actor(m.id)!;
              if (c.sittingOn || !grid.walkable(c.x, c.y)) failures.push(`${sceneId} ${seat.id}: standing up didn't step you onto the floor`);
            }
            hub.removeActor(m.id);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('shifts you along a couch or bench to the cushion you click, without getting up', () => {
    const failures: string[] = [];
    let n = 0;
    for (const sceneId of SCENES) {
      const scene = getScene(sceneId)!;
      for (const seat of scene.objects.filter(isSeat)) {
        const spots = seatSpots(seat, scene);
        if (spots.length < 2) continue;
        for (const from of spots)
          for (const to of spots) {
            if (from === to) continue;
            const m = member(`c${n++}`);
            hub.connect({ id: `c-${m.id}`, memberId: m.id, sceneId: null, send: () => undefined } as HubClient);
            hub.enter(m.id, sceneId, 'live', [from.x, from.y]);
            hub.sit(m.id, seat.id, [from.x, from.y]);
            // the client slides you over: no walk, just "sit on that cushion"
            hub.sit(m.id, seat.id, [to.x, to.y]);
            const a = hub.actor(m.id)!;
            if (a.x !== to.x || a.y !== to.y || a.sittingOn !== seat.id)
              failures.push(`${sceneId} ${seat.id}: shifting from cushion ${from.index} to ${to.index} left you at ${a.x},${a.y}`);
            hub.removeActor(m.id);
          }
      }
    }
    expect(failures).toEqual([]);
  });

  it('reaches every client over the wire: arriving clears the walk, standing up clears the seat', () => {
    // what a watching client believes about this member, built only from what crosses the socket (as game.ts does)
    let seen: Partial<Occupant> = {};
    const m = member('wire');
    hub.connect({
      id: 'c-wire',
      memberId: m.id,
      sceneId: null,
      send: (msg: ServerMsg) => {
        const got = JSON.parse(encodeServerMsg(msg)) as ServerMsg;
        if (got.t === 'moved' && got.memberId === m.id) seen = { ...seen, path: got.path, pathStartedAt: got.startedAt, sittingOn: undefined };
        if (got.t === 'updated' && got.memberId === m.id) seen = { ...seen, ...fromWirePatch(got.patch as WirePatch) };
      },
    } as HubClient);
    const scene = getScene('cafe')!;
    const grid = new WalkGrid(scene);
    const seat = scene.objects.filter(isSeat).find((s) => s.sprite === 'couch')!;
    const spot = seatSpots(seat, scene)[0];
    // a few steps away (the café's green sofa: its coffee table stands right in front of it)
    const start = ([[spot.x + 1, spot.y - 2], [spot.x - 1, spot.y - 2], [spot.x + 2, spot.y]] as Tile[]).find(([x, y]) => grid.walkable(x, y))!;
    expect(start).toBeDefined();
    hub.enter(m.id, 'cafe', 'live', start);
    const path = findPath(grid, start, [spot.x, spot.y], { allowGoal: true })!;
    expect(hub.move(m.id, path, Date.now())).toBe(true);
    vi.setSystemTime(Date.now() + (pathLength(path) / WALK_SPEED) * 1000);
    expect(hub.sit(m.id, seat.id, [spot.x, spot.y])).toBe(true);
    expect(seen.sittingOn).toBe(seat.id);
    expect(seen.path).toBeUndefined();
    hub.stand(m.id);
    expect(seen.sittingOn).toBeUndefined();
    const a = hub.actor(m.id)!;
    expect([seen.x, seen.y]).toEqual([a.x, a.y]);
  });
});
