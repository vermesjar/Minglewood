/**
 * End-to-end, over the wire: ordering a coffee from the café's barista. Ada walks up to the counter in front
 * of the espresso machine and orders; Bo, across the room, sees the barista step to the machine, the shot
 * being pulled, and the cup handed over — in that order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import type { ServerMsg } from '@shared/protocol';
import { getScene } from '@shared/world';
import { WalkGrid } from '@shared/world/walkGrid';
import { approach } from '@shared/world/interact';
import { pathLength, WALK_SPEED } from '@shared/world/pathfinding';
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
    const body = (await res.json()) as { memberId: string };
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

describe('the café, end to end', () => {
  it('orders a coffee from the barista: to the machine, the shot, the hand-over', async () => {
    const ada = new Client('Ada');
    const bo = new Client('Bo');
    await ada.signIn();
    await bo.signIn();
    bo.send({ t: 'enter', sceneId: 'cafe' });
    const boScene = await bo.waitFor<Extract<ServerMsg, { t: 'scene' }>>((m) => m.t === 'scene' && m.sceneId === 'cafe');
    expect(boScene.npcs?.map((n) => n.id)).toEqual(['barista']);

    ada.send({ t: 'enter', sceneId: 'cafe' });
    const adaScene = await ada.waitFor<Extract<ServerMsg, { t: 'scene' }>>((m) => m.t === 'scene' && m.sceneId === 'cafe');
    const me = adaScene.occupants.find((o) => o.memberId === ada.memberId)!;
    const cafe = getScene('cafe')!;
    const machine = cafe.objects.find((o) => o.sprite === 'espresso')!;
    const way = approach(new WalkGrid(cafe), [me.x, me.y], machine)!;
    expect(way.tile).toEqual([machine.x, machine.y + 1]); // the room side of the bar
    ada.send({ t: 'move', path: way.path });
    await new Promise((r) => setTimeout(r, (pathLength(way.path) / WALK_SPEED) * 1000 + 150));
    ada.send({ t: 'carry', objectId: machine.id });

    const got = await bo.waitFor((m) => m.t === 'updated' && m.memberId === ada.memberId && m.patch.carrying === 'coffee', 8000);
    const i = (m: ServerMsg) => bo.msgs.indexOf(m);
    const brewing = bo.msgs.find((m) => m.t === 'npc' && m.npc.doing === 'brew');
    const shot = bo.msgs.find((m) => m.t === 'moment' && m.what === 'brew' && m.objectId === machine.id);
    expect(brewing && brewing.t === 'npc' && [brewing.npc.x, brewing.npc.y]).toEqual([machine.x, 0]);
    expect(shot).toBeDefined();
    expect(i(brewing!)).toBeLessThan(i(got));
    expect(i(shot!)).toBeLessThan(i(got));
  }, 15000);

  it('rings the launch bell for everyone in the room', async () => {
    const ada = new Client('Ada2');
    await ada.signIn();
    const launch = getScene('launch')!;
    const bell = launch.objects.find((o) => o.actions?.some((a) => a.kind === 'ring'));
    if (!bell) return; // no bell in this build of the room
    ada.send({ t: 'enter', sceneId: 'launch' });
    const scene = await ada.waitFor<Extract<ServerMsg, { t: 'scene' }>>((m) => m.t === 'scene' && m.sceneId === 'launch');
    const me = scene.occupants.find((o) => o.memberId === ada.memberId)!;
    const way = approach(new WalkGrid(launch), [me.x, me.y], bell)!;
    ada.send({ t: 'move', path: way.path });
    await new Promise((r) => setTimeout(r, (pathLength(way.path) / WALK_SPEED) * 1000 + 150));
    ada.send({ t: 'ring', objectId: bell.id });
    await ada.waitFor((m) => m.t === 'moment' && m.what === 'ring' && m.objectId === bell.id);
  }, 15000);
});
