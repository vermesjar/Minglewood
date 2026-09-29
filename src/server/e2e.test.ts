/**
 * End-to-end: two people sign in over HTTP, connect over WebSocket, and see each other in realtime.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import type { ServerMsg } from '@shared/protocol';
import { getScene } from '@shared/world';
import { WalkGrid } from '@shared/world/walkGrid';
import { planHeldWalk, type WalkState } from '@shared/world/heldWalk';
import { positionAlong, type Tile } from '@shared/world/pathfinding';
import { createApp, type App } from './app';
import { MemoryPersistence } from './store/jsonFile';

let app: App;
let base: string;

class Client {
  msgs: ServerMsg[] = [];
  ws!: WebSocket;
  memberId = '';
  constructor(readonly name: string) {}

  async signIn() {
    const res = await fetch(`${base}/api/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.name, teamId: 'team-design' }),
    });
    const body = (await res.json()) as { token: string; memberId: string };
    this.memberId = body.memberId;
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { Cookie: cookie } });
    this.ws.on('message', (raw) => this.msgs.push(JSON.parse(raw.toString())));
    await this.waitFor((m) => m.t === 'welcome');
  }

  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => boolean, ms = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const hit = this.msgs.find(pred);
        if (hit) return resolve(hit as T);
        if (Date.now() - start > ms) return reject(new Error(`${this.name}: timed out`));
        setTimeout(tick, 20);
      };
      tick();
    });
  }
}

beforeAll(async () => {
  app = await createApp({ persistence: new MemoryPersistence(), simulateCoworkers: false });
  await new Promise<void>((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
});

describe('realtime, end to end', () => {
  it('two people see each other move, wave, and knock', async () => {
    const ada = new Client('Ada');
    const bo = new Client('Bo');
    await ada.signIn();
    await bo.signIn();

    ada.send({ t: 'enter', sceneId: 'cafe' });
    const adaScene = await ada.waitFor<Extract<ServerMsg, { t: 'scene' }>>((m) => m.t === 'scene' && m.sceneId === 'cafe');
    bo.send({ t: 'enter', sceneId: 'cafe' });
    const boScene = await bo.waitFor<Extract<ServerMsg, { t: 'scene' }>>((m) => m.t === 'scene' && m.sceneId === 'cafe');
    expect(boScene.occupants.some((o) => o.memberId === ada.memberId)).toBe(true);
    await ada.waitFor((m) => m.t === 'joined' && m.occupant.memberId === bo.memberId);

    // Ada walks one step; Bo sees the path.
    const me = adaScene.occupants.find((o) => o.memberId === ada.memberId)!;
    const grid = new WalkGrid(getScene('cafe')!);
    const next = [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]
      .map(([dx, dy]) => [me.x + dx, me.y + dy])
      .find(([x, y]) => grid.walkable(x, y))!;
    ada.send({ t: 'move', path: [[me.x, me.y], next] });
    const moved = await bo.waitFor<Extract<ServerMsg, { t: 'moved' }>>((m) => m.t === 'moved' && m.memberId === ada.memberId);
    expect(moved.path[1]).toEqual(next);

    // A wave reaches Bo, with a gentle toast.
    ada.send({ t: 'emote', emote: 'wave', targetId: bo.memberId });
    await bo.waitFor((m) => m.t === 'emote' && m.memberId === ada.memberId);
    await bo.waitFor((m) => m.t === 'toast' && m.text.includes('Ada waved'));

    // Knock → Join → Ada learns where to go.
    ada.send({ t: 'knock', targetId: bo.memberId, kind: 'chat' });
    const knock = await bo.waitFor<Extract<ServerMsg, { t: 'knock' }>>((m) => m.t === 'knock');
    bo.send({ t: 'knock-reply', knockId: knock.knockId, reply: 'join' });
    const result = await ada.waitFor<Extract<ServerMsg, { t: 'knock-result' }>>((m) => m.t === 'knock-result');
    expect(result).toMatchObject({ reply: 'join', sceneId: 'cafe' });

    // Org-wide directory shows Ada in the café (location shared with everyone by default).
    const dir = await bo.waitFor<Extract<ServerMsg, { t: 'directory' }>>(
      (m) => m.t === 'directory' && m.entries.some((e) => e.memberId === ada.memberId && e.sceneId === 'cafe'),
      2500,
    );
    expect(dir).toBeTruthy();

    // Leaving is visible too.
    ada.ws.close();
    await bo.waitFor((m) => m.t === 'left' && m.memberId === ada.memberId);
    bo.ws.close();
  });

  it('a held-key walk reaches others as one continuous motion and stops at the next tile', async () => {
    const ada = new Client('Ada');
    const bo = new Client('Bo');
    await ada.signIn();
    await bo.signIn();
    // Somewhere in town with a long straight run to walk along.
    const grid = new WalkGrid(getScene('town')!);
    let at: Tile | null = null;
    for (let y = 0; y < 60 && !at; y++)
      for (let x = 0; x < 60 && !at; x++) if ([0, 1, 2, 3, 4, 5, 6, 7, 8].every((i) => grid.walkable(x + i, y))) at = [x, y];
    ada.send({ t: 'enter', sceneId: 'town', at });
    await ada.waitFor((m) => m.t === 'scene' && m.sceneId === 'town');
    bo.send({ t: 'enter', sceneId: 'town' });
    await bo.waitFor((m) => m.t === 'scene' && m.sceneId === 'town');

    // Ada holds "down-right" (+x) for 1.2 s, steering every frame exactly like the client does.
    const seen: Array<{ path: Tile[]; startedAt: number; at: number }> = [];
    bo.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === 'moved' && m.memberId === ada.memberId) seen.push({ path: m.path, startedAt: m.startedAt, at: Date.now() });
    });
    let cur: WalkState | null = null;
    const where = (s: WalkState | null, t: number) => (s ? positionAlong(s.path, t - s.startedAt) : { x: at![0], y: at![1], done: true });
    const steer = (d: Tile | null) => {
      const now = Date.now();
      const p = where(cur, now);
      const next = planHeldWalk(cur && !p.done ? cur : null, [Math.round(p.x), Math.round(p.y)], now, d, grid);
      if (!next) return;
      cur = next;
      ada.send({ t: 'move', path: next.path, startedAt: next.startedAt });
    };
    const t0 = Date.now();
    while (Date.now() - t0 < 1200) {
      steer([1, 0]);
      await new Promise((r) => setTimeout(r, 16));
    }
    const released = where(cur, Date.now());
    steer(null);
    await new Promise((r) => setTimeout(r, 700));

    // The server accepted every step (a rejection would resync Ada with an 'updated' patch).
    expect(ada.msgs.some((m) => m.t === 'updated' && m.memberId === ada.memberId && 'x' in m.patch)).toBe(false);
    // Bo never sees Ada jump: each new path agrees with the previous one about where she is.
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) {
      const before = positionAlong(seen[i - 1].path, seen[i].at - seen[i - 1].startedAt);
      const after = positionAlong(seen[i].path, seen[i].at - seen[i].startedAt);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.05);
    }
    // She covered ground at walking speed, and stopped within one tile of where the key came up.
    const end = where(cur, Date.now());
    expect(end.done).toBe(true);
    expect(end.x - at![0]).toBeGreaterThan(4);
    expect(end.x - released.x).toBeLessThanOrEqual(1);
    ada.ws.close();
    bo.ws.close();
  });

  it('rejects malformed messages without disturbing others', async () => {
    const cy = new Client('Cy');
    await cy.signIn();
    cy.ws.send('{"t":"move","path":"nope"}');
    await cy.waitFor((m) => m.t === 'error');
    cy.ws.close();
  });
});
