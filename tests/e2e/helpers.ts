/**
 * Playtest harness: a real player in a real browser. Everything is done the way a person does it — clicking
 * on what they see (a pixel of the sprite that the game's own hit test resolves to that thing), walking,
 * waiting to arrive — and checked against the game's live state (the dev hook window.__mw and the store).
 */
import { mkdirSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { botState, TAG } from './global-setup';

export { expect };

const ROOT = process.cwd().replace(/\\/g, '/');
export const SHOTS = `art/review/playtest${TAG ? '/' + TAG.slice(1) : ''}`;
mkdirSync(SHOTS, { recursive: true });

export const ROOMS = [
  'cafe',
  'hq',
  'eng',
  'launch',
  'events',
  'focus',
  'arcade',
  'design',
] as const;

export interface Obj {
  id: string;
  sprite: string;
  variant?: string;
  x: number;
  y: number;
  w?: number;
  d?: number;
  z?: number;
  facing?: string;
  wall?: string;
  flat?: boolean;
  building?: boolean;
  roomId?: string;
  door?: { x: number; y: number };
  actions?: Array<{ kind: string; item?: string; roomId?: string }>;
}
export interface Spot {
  x: number;
  y: number;
  facing: string;
  index: number;
}
export interface Me {
  id: string;
  sceneId: string | null;
  x: number;
  y: number;
  tile: [number, number];
  facing: string;
  moving: boolean;
  sittingOn?: string;
  carrying?: string | null;
  /** The server-confirmed occupant (store), which is what everyone else sees. */
  server?: { x: number; y: number; sittingOn?: string; facing?: string; carrying?: string | null };
}

/** A bug the playthrough saw: collected per test and written to art/review/playtest/findings-*.json. */
export interface Finding {
  area: string;
  what: string;
  shot?: string;
  detail?: unknown;
}

export class Player {
  findings: Finding[] = [];
  reloads = 0;
  /** Page loads so far (boots, the harness's own reloads, and hot reloads from people editing the app). */
  loads = 0;
  /** Steps redone because the page was reloaded under them, and steps given up on (reloaded every try). */
  redone = 0;
  gaveUp: string[] = [];
  /** Realtime connections opened: a new one mid-step means the server restarted (you're put back at the door). */
  sockets = 0;
  constructor(readonly page: Page) {
    page.on('load', () => this.loads++);
    page.on('websocket', () => this.sockets++);
  }

  /**
   * One step of a playthrough, in a room: if the page is reloaded while it runs (a hot reload drops you back
   * in town), what it saw doesn't count: go back in and do it again. If it takes me out of the room without
   * a reload, that's a finding.
   */
  async step(roomId: string, what: string, fn: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await this.sceneId()) !== roomId) await this.enter(roomId);
      const loads = this.loads;
      const sockets = this.sockets;
      // a mark on this page: gone afterwards means the page was replaced (whenever its load event lands)
      await this.ev(() => ((window as any).__playtestMark = true));
      const kept = this.findings;
      this.findings = [];
      let err: unknown;
      try {
        await fn();
      } catch (e) {
        err = e;
      }
      const seen = this.findings;
      this.findings = kept;
      const same = await this.page
        .evaluate(() => !!(window as any).__playtestMark)
        .catch(() => false);
      if (!same || this.loads !== loads || this.sockets !== sockets) {
        await this.ready().catch(() => undefined);
        this.redone++;
        continue;
      }
      this.findings.push(...seen);
      if (err) throw err;
      const now = await this.sceneId();
      if (now !== roomId && roomId !== 'town')
        this.note({
          area: 'app',
          what: `${what} took me out of ${roomId} (I'm in ${now}) without a reload`,
          shot: await this.full(`left-${roomId}-${what.replace(/[^\w]+/g, '-')}`),
        });
      return true;
    }
    this.gaveUp.push(`${roomId}: ${what}`);
    return false;
  }

  /** Wait until the game is up again (after a dev-server hot reload replaced the page). */
  async ready(ms = 60_000) {
    await this.page.waitForFunction(
      () => {
        const g = (window as any).__mw;
        return (
          !!g?.world &&
          !!g.meId &&
          !!(g.world as any).actors?.get?.(g.meId) &&
          !(g.world as any).transition
        );
      },
      undefined,
      { timeout: ms },
    );
  }

  /**
   * page.evaluate that survives the page being replaced underneath it (other people editing the app make
   * the dev server hot-reload it): wait for the game to come back and try again.
   */
  async ev<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    for (let i = 0; ; i++) {
      try {
        return await this.page.evaluate(fn as never, arg);
      } catch (e) {
        const msg = String(e);
        const reloaded =
          /__mw|reading 'world'|reading 'actors'|Cannot read properties of (null|undefined)|Execution context was destroyed|navigation|Target page/.test(
            msg,
          );
        if (!reloaded || i >= 3) throw e;
        this.reloads++;
        await this.page.waitForTimeout(500);
        await this.ready();
      }
    }
  }

  /** Into the world. If the bot's member is gone (the dev server lost it), sign in again and keep the new session. */
  async boot(botFile?: string, botName = 'Playtest Bot') {
    await this.page.goto('/');
    const where = await this.page
      .waitForFunction(
        () => {
          const g = (window as any).__mw;
          if (g?.world && g.meId && (g.world as any).actors?.get?.(g.meId)) return 'world';
          return document.querySelector('.landing-card') ? 'landing' : false;
        },
        undefined,
        { timeout: 60_000 },
      )
      .then((h) => h.jsonValue());
    if (where === 'landing') {
      const res = await this.page.request.post('/api/auth/demo', {
        data: { name: botName, teamId: 'team-aurora', interests: ['coffee'], admin: true },
      });
      const { memberId } = (await res.json()) as { memberId: string };
      await this.page.evaluate((id) => localStorage.setItem(`mw.welcomed.${id}`, '1'), memberId);
      if (botFile) await this.page.context().storageState({ path: botFile });
      await this.page.goto('/');
      await this.page.waitForFunction(
        () => {
          const g = (window as any).__mw;
          return !!g?.world && !!g.meId && !!(g.world as any).actors?.get?.(g.meId);
        },
        undefined,
        { timeout: 60_000 },
      );
    }
    await this.settle();
  }

  /** Where I am and what I'm doing, from the view and from the server-confirmed store. */
  async me(): Promise<Me> {
    return this.ev(() => {
      const g = (window as any).__mw;
      const w = g.world as any;
      const a = w.actors.get(g.meId);
      const o = a.occ;
      return {
        id: g.meId,
        sceneId: w.scene?.id ?? null,
        x: a.x,
        y: a.y,
        tile: [Math.round(a.x), Math.round(a.y)] as [number, number],
        facing: a.facing,
        moving: !!a.moving,
        sittingOn: o.sittingOn,
        carrying: o.carrying,
        server: { x: o.x, y: o.y, sittingOn: o.sittingOn, facing: o.facing, carrying: o.carrying },
      };
    });
  }

  async sceneId(): Promise<string | null> {
    return this.ev(() => ((window as any).__mw.world as any)?.scene?.id ?? null);
  }

  /** The live scene (with decorations and lived-in changes) as the game has it. */
  async scene(): Promise<{
    id: string;
    width: number;
    height: number;
    objects: Obj[];
    npcs?: Array<{ id: string; name: string; role: string }>;
    tiles: string[];
  }> {
    return this.ev(() => {
      const g = (window as any).__mw;
      const id = (g.world as any).scene.id;
      const s = g.scene(id);
      return JSON.parse(
        JSON.stringify({
          id: s.id,
          width: s.width,
          height: s.height,
          objects: s.objects,
          npcs: s.npcs,
          tiles: s.tiles,
        }),
      );
    });
  }

  /** Go into a room and read its scene (again, if a reload drops us back in town in between). */
  async roomScene(roomId: string) {
    for (let i = 0; ; i++) {
      await this.enter(roomId);
      const s = await this.scene();
      if (s.id === roomId || i >= 3) return s;
    }
  }

  /** Seat spots of a seat object (the shared seat standard, loaded the same way the game uses it). */
  async seatSpots(objectId: string): Promise<Spot[]> {
    return this.ev(
      async ([id, root]) => {
        const g = (window as any).__mw;
        const sid = (g.world as any).scene.id;
        const scene = g.scene(sid);
        const seats = await import(`/@fs/${root}/src/shared/world/seats.ts`);
        const o = scene.objects.find((x: any) => x.id === id);
        return o
          ? seats
              .seatSpots(o, scene)
              .map((s: any) => ({ x: s.x, y: s.y, facing: s.facing, index: s.index }))
          : [];
      },
      [objectId, ROOT] as const,
    );
  }

  async walkable(x: number, y: number): Promise<boolean> {
    return this.ev(
      ([x, y]) => {
        const g = (window as any).__mw;
        return !!g.grid((g.world as any).scene.id)?.walkable(x, y);
      },
      [x, y] as const,
    );
  }

  /** Everyone in the room (as the server reported them): id → where they are and what they sit on. */
  async occupants(): Promise<
    Record<string, { x: number; y: number; sittingOn?: string; via?: string }>
  > {
    return this.ev(() => {
      const w = (window as any).__mw.world as any;
      const out: Record<string, unknown> = {};
      for (const [id, a] of w.actors as Map<string, any>)
        out[id] = { x: a.occ.x, y: a.occ.y, sittingOn: a.occ.sittingOn, via: a.occ.via };
      return JSON.parse(JSON.stringify(out));
    });
  }

  /** Wait for the camera to stop moving (so screen positions are stable). */
  async settle(ms = 8000) {
    await this.page
      .waitForFunction(
        () => {
          const w = (window as any).__mw?.world as any;
          if (!w) return false;
          const c = w.camera;
          return (
            !w.transition &&
            Math.abs(c.x - c.tx) < 0.5 &&
            Math.abs(c.y - c.ty) < 0.5 &&
            c.zoom === c.tzoom
          );
        },
        undefined,
        { timeout: ms },
      )
      .catch(() => undefined);
  }

  /** Page coordinates of a point on the floor (tile coords, optionally lifted z art px). */
  async floorPoint(x: number, y: number, z = 0): Promise<{ x: number; y: number }> {
    return this.ev(
      ([x, y, z]) => {
        const w = (window as any).__mw.world as any;
        const ax = (x - y) * 16;
        const ay = (x + y) * 8 - z;
        const [sx, sy] = w.camera.toScreen(ax, ay, w.vw, w.vh);
        const r = w.canvas.getBoundingClientRect();
        return { x: r.left + sx, y: r.top + sy };
      },
      [x, y, z] as const,
    );
  }

  /**
   * A page point that clicks this object the way a player would: a visible pixel of its sprite, nearest to
   * `near` (a tile, e.g. the cushion you mean), that the game's hit test resolves to this object (so
   * nothing drawn in front of it would take the click). Null if no such pixel is on screen.
   */
  async objectPoint(
    id: string,
    near?: { x: number; y: number; z?: number },
  ): Promise<{ x: number; y: number } | null> {
    return this.ev(
      ([id, near]) => {
        const w = (window as any).__mw.world as any;
        const d = w.buildDrawOrder().find((e: any) => e.obj && e.obj.id === id);
        const r = w.canvas.getBoundingClientRect();
        const cam = w.camera;
        let target: [number, number] | null = null;
        if (near)
          target = [
            (near.x + 0.5 - (near.y + 0.5)) * 16,
            (near.x + 0.5 + near.y + 0.5) * 8 - (near.z ?? 8),
          ];
        const tryPoint = (ax: number, ay: number) => {
          const [sx, sy] = cam.toScreen(ax, ay, w.vw, w.vh);
          if (sx < 2 || sy < 2 || sx > w.vw - 2 || sy > w.vh - 2) return null;
          const hit = w.hitTest(sx, sy, ax, ay);
          return hit && hit.kind === 'object' && hit.obj.id === id
            ? { x: r.left + sx, y: r.top + sy }
            : null;
        };
        if (!d) {
          // wall items live in the ground layer: aim at the middle of their hit polygon
          const h = (w.ground?.wallHits ?? []).find((x: any) => x.obj.id === id);
          if (!h) return null;
          const cx = h.poly.reduce((s: number, p: number[]) => s + p[0], 0) / h.poly.length;
          const cy = h.poly.reduce((s: number, p: number[]) => s + p[1], 0) / h.poly.length;
          return tryPoint(cx, cy);
        }
        const k = d.sprite.scale ?? 1;
        const cw = d.sprite.canvas.width;
        const ch = d.sprite.canvas.height;
        const cands: Array<[number, number, number]> = [];
        for (let py = 0; py < ch; py += 2)
          for (let px = 0; px < cw; px += 2) {
            if (!d.sprite.mask[py * cw + px]) continue;
            const ax = d.dx + px / k;
            const ay = d.dy + py / k;
            const cx = d.dx + cw / k / 2;
            const cy = d.dy + ch / k / 2;
            const dist = target
              ? Math.hypot(ax - target[0], ay - target[1])
              : Math.hypot(ax - cx, ay - cy);
            cands.push([dist, ax, ay]);
          }
        cands.sort((a, b) => a[0] - b[0]);
        for (const [, ax, ay] of cands.slice(0, 400)) {
          const p = tryPoint(ax, ay);
          if (p) return p;
        }
        return null;
      },
      [id, near ?? null] as const,
    );
  }

  /** A page point on another person (for opening their card). */
  async actorPoint(memberId: string): Promise<{ x: number; y: number } | null> {
    return this.ev((id) => {
      const w = (window as any).__mw.world as any;
      const a = w.actors.get(id);
      if (!a) return null;
      const r = w.canvas.getBoundingClientRect();
      const rect = a.rect;
      for (const fy of [0.35, 0.5, 0.25, 0.6])
        for (const fx of [0.5, 0.4, 0.6]) {
          const ax = rect.l + (rect.r - rect.l) * fx;
          const ay = rect.t + (rect.b - rect.t) * fy;
          const [sx, sy] = w.camera.toScreen(ax, ay, w.vw, w.vh);
          const hit = w.hitTest(sx, sy, ax, ay);
          if (hit?.kind === 'actor' && hit.id === id) return { x: r.left + sx, y: r.top + sy };
        }
      return null;
    }, memberId);
  }

  async click(p: { x: number; y: number }) {
    await this.page.mouse.click(p.x, p.y);
  }

  /** Wait until a condition on me holds (polling the live state), or time out (returns the last state). */
  async until(pred: (m: Me) => boolean, ms = 12_000): Promise<{ ok: boolean; me: Me }> {
    const end = Date.now() + ms;
    let me = await this.me();
    while (Date.now() < end) {
      if (pred(me)) return { ok: true, me };
      await this.page.waitForTimeout(150);
      me = await this.me();
    }
    return { ok: pred(me), me };
  }

  /** Wait until I've stopped walking (and a moment for the server to confirm). */
  async still(ms = 12_000) {
    await this.until((m) => !m.moving, ms);
    await this.page.waitForTimeout(350);
    return this.me();
  }

  /** Go to a room (or 'town') the way the UI does it (sidebar, search, room cards): game.goTo. */
  async enter(roomId: string, attempt = 0): Promise<void> {
    if ((await this.sceneId()) === roomId) return;
    await this.reset();
    await this.ev((id) => (window as any).__mw.goTo(id), roomId);
    const ok = await this.page
      .waitForFunction(
        (id) => {
          const g = (window as any).__mw;
          const w = g?.world as any;
          return w?.scene?.id === id && !w.transition && !!w.actors.get(g.meId);
        },
        roomId,
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      if (!(await this.alive(`entering ${roomId}`))) return this.enter(roomId, attempt + 1);
      if (attempt < 2) {
        // (the dev server restarts whenever its code is edited; start again from a fresh page)
        await this.page.reload();
        await this.boot();
        return this.enter(roomId, attempt + 1);
      }
      throw new Error(`couldn't get into ${roomId}`);
    }
    await this.page.waitForTimeout(700);
    await this.settle();
    // the whole ground drawn (the town streams its ground in; headless tabs are never throttled)
    await this.ev(() => (window as any).__mw.world?.ground?.finishNow?.());
    if (!(await this.alive(`after entering ${roomId}`))) await this.enter(roomId, attempt + 1);
  }

  /**
   * Is the world still rendering? (An exception in a frame stops the loop for good — a known bug — which
   * freezes everything: walking, transitions, animation.) If it's dead: note it, reload, and carry on.
   */
  async alive(where: string): Promise<boolean> {
    const f0 = await this.page
      .evaluate(() => ((window as any).__mw?.world as any)?.last ?? -1)
      .catch(() => -1);
    await this.page.waitForTimeout(250);
    const f1 = await this.page
      .evaluate(() => ((window as any).__mw?.world as any)?.last ?? -1)
      .catch(() => -1);
    if (f1 !== f0) return true;
    this.note({
      area: 'engine (main session)',
      what: `the frame loop stopped (world frozen) ${where}`,
      shot: await this.full(`frozen-${where.replace(/[^\w]+/g, '-')}-${Date.now()}`),
    });
    await this.page.reload();
    await this.boot();
    return false;
  }

  /** The state of a switchable object (lamps, fireplaces). */
  async isOn(id: string): Promise<boolean> {
    return this.ev((id) => !!((window as any).__mw.world as any).isOn(id), id);
  }

  /** Stand up (if seated) and put down anything carried, so each step starts clean. */
  async reset() {
    const m = await this.me();
    if (m.sittingOn) {
      await this.ev(() => (window as any).__mw.rt?.send({ t: 'stand' }));
      await this.until((x) => !x.sittingOn, 4000);
    }
    if (m.carrying) {
      await this.ev(() => (window as any).__mw.putDown());
      await this.until((x) => !x.carrying, 4000);
    }
  }

  /** A 1:1 crop of the screen around me (or around a page point). */
  async shot(name: string, around?: { x: number; y: number }, size = 300) {
    let c = around;
    if (!c) {
      c = await this.ev(() => {
        const g = (window as any).__mw;
        const w = g.world as any;
        const a = w.actors.get(g.meId);
        const r = w.canvas.getBoundingClientRect();
        const [sx, sy] = w.camera.toScreen(
          (a.rect.l + a.rect.r) / 2,
          (a.rect.t + a.rect.b) / 2,
          w.vw,
          w.vh,
        );
        return { x: r.left + sx, y: r.top + sy };
      });
    }
    const vp = this.page.viewportSize()!;
    const x = Math.max(0, Math.min(vp.width - size, Math.round(c.x - size / 2)));
    const y = Math.max(0, Math.min(vp.height - size, Math.round(c.y - size / 2)));
    const path = `${SHOTS}/${name}.png`;
    await this.page.screenshot({ path, clip: { x, y, width: size, height: size } });
    return path;
  }

  async full(name: string) {
    const path = `${SHOTS}/${name}.png`;
    await this.page.screenshot({ path });
    return path;
  }

  note(f: Finding) {
    this.findings.push(f);
  }
}

export const test = base.extend<{ player: Player }, { botFile: string }>({
  botFile: [
    async ({}, use, workerInfo) => use(botState(workerInfo.parallelIndex)),
    { scope: 'worker' },
  ],
  storageState: async ({ botFile }, use) => use(botFile),
  player: async ({ page, botFile }, use, testInfo) => {
    const p = new Player(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await p.boot(botFile, `Playtest Bot ${testInfo.parallelIndex + 1}`);
    await use(p);
    for (const e of new Set(errors)) p.note({ area: 'app', what: `uncaught page error: ${e}` });
    testInfo.annotations.push({
      type: 'harness',
      description: JSON.stringify({ loads: p.loads, redone: p.redone, gaveUp: p.gaveUp }),
    });
    if (p.gaveUp.length)
      console.log(
        `[harness] ${testInfo.title}: gave up on ${p.gaveUp.length} step(s) (reloaded every try): ${p.gaveUp.join('; ')}`,
      );
    if (p.findings.length) {
      const { writeFileSync } = await import('node:fs');
      const slug = testInfo.titlePath
        .slice(1)
        .join(' ')
        .replace(/[^\w]+/g, '-')
        .toLowerCase();
      writeFileSync(`${SHOTS}/findings-${slug}.json`, JSON.stringify(p.findings, null, 2));
      await testInfo.attach('findings', {
        body: JSON.stringify(p.findings, null, 2),
        contentType: 'application/json',
      });
    }
  },
});
