/**
 * LifeSim drives the seeded demo coworkers so a fresh demo world feels inhabited:
 * they sit, wander, travel between buildings, chat, greet newcomers, wave back,
 * answer knocks, and follow a mock calendar. Everything flows through the same OrgHub API
 * that live users use, so every browser sees the same simulated people.
 *
 * Disabled with SIMULATE_COWORKERS=false (e.g. for a real org).
 */
import { presenceFromCalendar, type CalendarProvider } from '@shared/calendar';
import { STATUS_META } from '@shared/presence';
import { buildingForRoom, getScene, TOWN_ID } from '@shared/world';
import { isSeat, terrainAt } from '@shared/world/scene';
import { TOWN_SPOTS } from '@shared/world/northstarTown';
import type { Tile } from '@shared/world/pathfinding';
import { daysSince } from '@shared/serendipity';
import type { SimProfile } from '@shared/seed/northstar';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import { CHATTER, GREETINGS, WAVE_BACKS } from './chatter';

type Step =
  | { kind: 'walk'; to: Tile }
  | { kind: 'enter'; sceneId: string }
  | { kind: 'sit'; near?: Tile }
  | { kind: 'wait'; ms: number }
  | { kind: 'do'; fn: () => void };

interface NpcState {
  id: string;
  profile: SimProfile;
  plan: Step[];
  waitUntil: number;
  nextIdle: number;
  nextTrip: number;
  busyUntil: number; // scripted moments (greeting someone) pause autonomy
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const first = (n: string) => n.split(' ')[0];

export class LifeSim {
  private npcs = new Map<string, NpcState>();
  private reserved = new Set<string>(); // `${sceneId}:${objectId}`
  private timer: NodeJS.Timeout | null = null;
  private buddyGreeted = new Set<string>();
  private greetedInScene = new Set<string>();

  constructor(
    private readonly hub: OrgHub,
    private readonly store: Store,
    private readonly calendar: CalendarProvider,
  ) {}

  start() {
    const data = this.store.get(this.hub.orgId);
    const now = Date.now();
    for (const m of data.members.values()) {
      const profile = data.sim[m.id];
      if (!m.simulated || !profile) continue;
      const npc: NpcState = {
        id: m.id,
        profile,
        plan: [],
        waitUntil: 0,
        nextIdle: now + rand(4_000, 30_000),
        nextTrip: now + rand(60_000, 240_000) / Math.max(0.2, profile.sociability),
        busyUntil: 0,
      };
      this.npcs.set(m.id, npc);
      this.hub.setStatus(m.id, profile.status, profile.note, 'default');
      this.placeInitially(npc);
    }
    this.hub.on('entered', (memberId, sceneId, via) => via === 'live' && this.onLiveEntered(memberId, sceneId));
    this.hub.on('emote', (memberId, emote, sceneId, targetId) => this.onEmote(memberId, emote, sceneId, targetId));
    this.hub.on('knock', (k) => this.onKnock(k.id, k.fromId, k.targetId, k.kind));
    this.timer = setInterval(() => this.tick(), 500);
    this.syncCalendar();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /* ------------------------------------------------------------------ placement */

  private placeInitially(npc: NpcState) {
    const sceneId = npc.profile.start;
    const scene = getScene(sceneId);
    if (!scene) return;
    if (scene.kind === 'interior') {
      const seat = this.freeSeat(sceneId);
      if (seat) {
        this.hub.enter(npc.id, sceneId, 'sim', [seat.x, seat.y]);
        this.hub.sit(npc.id, seat.id);
        return;
      }
    }
    this.hub.enter(npc.id, sceneId, 'sim', this.randomSpot(sceneId));
  }

  /** A free seat in the scene (`near`: within a few tiles of there). */
  private freeSeat(sceneId: string, near?: Tile) {
    const scene = this.hub.scene(sceneId);
    if (!scene) return undefined;
    const seats = scene.objects.filter(
      (o) =>
        isSeat(o) &&
        !this.hub.seatTaken(sceneId, o.id) &&
        !this.reserved.has(`${sceneId}:${o.id}`) &&
        (!near || Math.hypot(o.x - near[0], o.y - near[1]) < 5),
    );
    return seats.length ? pick(seats) : undefined;
  }

  private randomSpot(sceneId: string): Tile | undefined {
    const scene = getScene(sceneId);
    const grid = this.hub.grid(sceneId);
    if (!scene || !grid) return undefined;
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(Math.random() * scene.width);
      const y = Math.floor(Math.random() * scene.height);
      if (!grid.walkable(x, y)) continue;
      if (scene.kind === 'outdoor') {
        const t = terrainAt(scene, x, y);
        if (!['p', 'P', 'd', 's', 't'].includes(t) && Math.random() < 0.8) continue;
      }
      return [x, y];
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ main loop */

  private tick() {
    const now = Date.now();
    for (const npc of this.npcs.values()) this.stepNpc(npc, now);
    if (Math.random() < 0.35) this.chatter();
    if (Math.floor(now / 1000) % 15 === 0) this.syncCalendar();
  }

  private stepNpc(npc: NpcState, now: number) {
    const a = this.hub.actor(npc.id);
    if (!a) return;
    if (this.hub.position(a, now).moving || now < npc.waitUntil) return;

    const step = npc.plan.shift();
    if (step) {
      this.runStep(npc, step, now);
      return;
    }
    if (now < npc.busyUntil) return;
    const status = this.hub.presenceOf(npc.id).status;
    const settled = status === 'focused' || status === 'meeting';

    if (now > npc.nextTrip && !settled) {
      npc.nextTrip = now + rand(90_000, 300_000) / Math.max(0.2, npc.profile.sociability);
      // Celebrations pull people in; hosts and the guest of honor stay put.
      const ev = this.hub.activeEvents(now).find((e) => e.decor === 'balloons');
      if (ev && a.sceneId === ev.roomId && (ev.hostIds.includes(npc.id) || npc.profile.start === ev.roomId)) return;
      if (ev && a.sceneId !== ev.roomId && Math.random() < 0.45 * npc.profile.sociability) {
        this.planTrip(npc, ev.roomId);
        return;
      }
      const choices = npc.profile.haunts.filter((h) => h !== a.sceneId);
      if (choices.length) this.planTrip(npc, pick(choices));
      return;
    }
    if (now > npc.nextIdle) {
      npc.nextIdle = now + (settled ? rand(60_000, 180_000) : rand(15_000, 60_000));
      const scene = getScene(a.sceneId);
      if (!scene) return;
      if (scene.kind === 'interior') {
        if (!a.sittingOn || Math.random() < 0.4) npc.plan.push({ kind: 'sit' });
        else if (Math.random() < 0.3) this.hub.emote(npc.id, pick(['laugh', 'idea', 'thumbs', 'clap'] as const));
      } else if (a.sceneId === TOWN_ID && Math.random() < 0.55) {
        // out for a stroll: to one of the town's places (the garden, the pier, the campfire…), by the paths;
        // a while there, and sometimes a sit on a bench nearby
        const place = pick(TOWN_SPOTS);
        const spot = this.randomSpotNear(a.sceneId, place.x, place.y, 2);
        if (!spot) return;
        npc.plan.push({ kind: 'walk', to: spot }, { kind: 'wait', ms: rand(6_000, 18_000) });
        if (Math.random() < 0.4) npc.plan.push({ kind: 'sit', near: [place.x, place.y] });
      } else {
        const spot = this.randomSpotNear(a.sceneId, a.x, a.y, 9);
        if (spot) npc.plan.push({ kind: 'walk', to: spot });
      }
    }
  }

  private runStep(npc: NpcState, step: Step, now: number) {
    switch (step.kind) {
      case 'walk':
        this.hub.walkTo(npc.id, step.to, { stroll: true });
        break;
      case 'enter': {
        this.hub.enter(npc.id, step.sceneId, 'sim');
        break;
      }
      case 'sit': {
        const a = this.hub.actor(npc.id)!;
        const seat = this.freeSeat(a.sceneId, step.near);
        if (!seat && step.near) break; // no bench free there: stroll on
        if (!seat) {
          const spot = this.randomSpot(a.sceneId);
          if (spot) this.hub.walkTo(npc.id, spot);
          break;
        }
        const key = `${a.sceneId}:${seat.id}`;
        this.reserved.add(key);
        if (!this.hub.walkTo(npc.id, [seat.x, seat.y], { stroll: true }) && Math.hypot(a.x - seat.x, a.y - seat.y) > 1.6) {
          this.reserved.delete(key);
          break;
        }
        npc.plan.unshift({
          kind: 'do',
          fn: () => {
            this.reserved.delete(key);
            this.hub.sit(npc.id, seat.id);
          },
        });
        break;
      }
      case 'wait':
        npc.waitUntil = now + step.ms;
        break;
      case 'do':
        step.fn();
        break;
    }
  }

  /** Plan: leave current building → walk through town → enter target → find a seat. */
  private planTrip(npc: NpcState, targetSceneId: string) {
    const a = this.hub.actor(npc.id);
    if (!a) return;
    const steps: Step[] = [];
    const here = getScene(a.sceneId);
    if (here?.kind === 'interior' && here.interior) {
      steps.push({ kind: 'walk', to: [0, here.interior.doorY] }, { kind: 'enter', sceneId: TOWN_ID });
    }
    if (targetSceneId === TOWN_ID) {
      const spot = this.randomSpot(TOWN_ID);
      if (spot) steps.push({ kind: 'walk', to: spot });
    } else {
      const door = buildingForRoom(targetSceneId)?.door;
      if (!door) return;
      steps.push({ kind: 'walk', to: [door.x, door.y] }, { kind: 'enter', sceneId: targetSceneId }, { kind: 'sit' });
    }
    npc.plan = steps;
  }

  private randomSpotNear(sceneId: string, x: number, y: number, r: number): Tile | undefined {
    const grid = this.hub.grid(sceneId);
    const scene = getScene(sceneId);
    if (!grid || !scene) return undefined;
    for (let i = 0; i < 30; i++) {
      const nx = Math.round(x + rand(-r, r));
      const ny = Math.round(y + rand(-r, r));
      if (!grid.walkable(nx, ny)) continue;
      const t = terrainAt(scene, nx, ny);
      if (scene.kind === 'outdoor' && !['p', 'P', 'd', 's', 'm', 't'].includes(t) && Math.random() < 0.7) continue;
      return [nx, ny];
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ social behavior */

  private chatter() {
    const byScene = new Map<string, string[]>();
    for (const npc of this.npcs.values()) {
      const a = this.hub.actor(npc.id);
      if (!a) continue;
      const st = this.hub.presenceOf(npc.id).status;
      if (st === 'focused' || st === 'meeting') continue;
      byScene.set(a.sceneId, [...(byScene.get(a.sceneId) ?? []), npc.id]);
    }
    for (const [sceneId, ids] of byScene) {
      const lines = CHATTER[sceneId];
      if (!lines || ids.length < (sceneId === TOWN_ID ? 1 : 2)) continue;
      const chance = sceneId === TOWN_ID ? 0.03 : 0.09;
      if (Math.random() > chance) continue;
      const speaker = pick(ids);
      if (this.hub.say(speaker, pick(lines))) {
        this.hub.setSpeaking(speaker, true);
        setTimeout(() => this.hub.setSpeaking(speaker, false), 2600);
        const listener = ids.find((i) => i !== speaker);
        if (listener && Math.random() < 0.5) {
          setTimeout(() => this.hub.emote(listener, pick(['laugh', 'thumbs', 'heart', 'clap'] as const)), 1800);
        }
      }
    }
  }

  private liveName(memberId: string) {
    return first(this.hub.member(memberId)?.displayName ?? 'friend');
  }

  private onLiveEntered(memberId: string, sceneId: string) {
    const member = this.hub.member(memberId);
    if (!member) return;
    // The onboarding buddy walks over to greet brand-new people on their first arrival in town.
    if (sceneId === TOWN_ID && daysSince(member.startDate, Date.now()) <= 3 && !this.buddyGreeted.has(memberId)) {
      this.buddyGreeted.add(memberId);
      setTimeout(() => this.sendBuddy(memberId), 2500);
      return;
    }
    // Someone in the room says hi (once per person per room).
    const key = `${memberId}:${sceneId}`;
    if (this.greetedInScene.has(key)) return;
    const here = [...this.npcs.values()].filter((n) => {
      const a = this.hub.actor(n.id);
      const st = this.hub.presenceOf(n.id).status;
      return a?.sceneId === sceneId && STATUS_META[st].interruptible;
    });
    if (!here.length || sceneId === TOWN_ID) return;
    this.greetedInScene.add(key);
    const greeter = pick(here);
    setTimeout(() => {
      this.hub.emote(greeter.id, 'wave', memberId);
      this.hub.say(greeter.id, pick(GREETINGS).replace('{name}', this.liveName(memberId)));
    }, rand(1200, 2600));
  }

  private sendBuddy(memberId: string) {
    const buddy = this.npcs.get('m-rosa');
    const target = this.hub.actor(memberId);
    if (!buddy || !target || target.sceneId !== TOWN_ID) return;
    const name = this.liveName(memberId);
    const ba = this.hub.actor(buddy.id);
    const steps: Step[] = [];
    const here = ba && getScene(ba.sceneId);
    if (here?.kind === 'interior' && here.interior) {
      // Pop out of Lantern Hall right away rather than walking to the door.
      steps.push({ kind: 'enter', sceneId: TOWN_ID });
    }
    const approach = () => {
      const t = this.hub.actor(memberId);
      if (!t || t.sceneId !== TOWN_ID) return;
      const pos = this.hub.position(t);
      const grid = this.hub.grid(TOWN_ID)!;
      const spot = this.hub.freeNear(TOWN_ID, grid, Math.round(pos.x) + 1, Math.round(pos.y) + 1);
      this.hub.walkTo(buddy.id, [spot.x, spot.y]);
    };
    steps.push(
      { kind: 'do', fn: approach },
      { kind: 'wait', ms: 300 },
      { kind: 'do', fn: approach },
      {
        kind: 'do',
        fn: () => {
          this.hub.emote(buddy.id, 'wave', memberId);
          this.hub.say(buddy.id, `Welcome to Northstar, ${name}! I’m Rosa, your onboarding buddy 🌱`);
        },
      },
      { kind: 'wait', ms: 4200 },
      { kind: 'do', fn: () => this.hub.say(buddy.id, 'HQ is up the lane, coffee’s by the lake, and there’s cake in Lantern Hall today!') },
      { kind: 'wait', ms: 4500 },
      { kind: 'do', fn: () => this.hub.say(buddy.id, 'Knock on anyone who looks open to chat. Holler if you need me!') },
      { kind: 'wait', ms: 9000 },
      { kind: 'do', fn: () => this.planTrip(buddy, buddy.profile.start) },
    );
    buddy.plan = steps;
    buddy.busyUntil = Date.now() + 45_000;
    buddy.nextTrip = Date.now() + 40_000;
  }

  private onEmote(memberId: string, emote: string, sceneId: string, targetId?: string) {
    if (this.npcs.has(memberId) || emote !== 'wave') return;
    const target = targetId && this.npcs.get(targetId);
    const responders = target
      ? [target]
      : [...this.npcs.values()].filter((n) => this.hub.actor(n.id)?.sceneId === sceneId).slice(0, 1);
    for (const npc of responders) {
      const a = this.hub.actor(npc.id);
      if (!a || a.sceneId !== sceneId) continue;
      setTimeout(() => {
        this.hub.emote(npc.id, 'wave', memberId);
        const st = this.hub.presenceOf(npc.id).status;
        if (STATUS_META[st].interruptible || Math.random() < 0.3) {
          this.hub.say(npc.id, pick(WAVE_BACKS).replace('{name}', this.liveName(memberId)));
        }
      }, rand(700, 1500));
    }
  }

  private onKnock(knockId: string, fromId: string, targetId: string, kind: 'chat' | 'coffee') {
    const npc = this.npcs.get(targetId);
    if (!npc) return;
    const p = this.hub.presenceOf(targetId);
    const roomName = (sceneId?: string) =>
      this.store.get(this.hub.orgId).rooms.find((r) => r.id === sceneId)?.name ?? 'town';
    const a = this.hub.actor(targetId);
    if (p.status === 'meeting') {
      const until = p.until ? new Date(p.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'a bit';
      setTimeout(() => this.hub.knockReply(knockId, targetId, 'no', `In a meeting until ${until} — catch you after!`), rand(1500, 2500));
      return;
    }
    if (p.status === 'focused') {
      setTimeout(
        () => this.hub.knockReply(knockId, targetId, 'soon', 'Heads-down right now — can I come find you in 20?'),
        rand(3000, 5000),
      );
      return;
    }
    setTimeout(() => {
      if (kind === 'coffee') {
        this.hub.knockReply(knockId, targetId, 'join', 'Yes please! Meet you at Tidewater Café ☕', 'cafe');
        if (a?.sceneId !== 'cafe') {
          this.planTrip(npc, 'cafe');
          npc.busyUntil = Date.now() + 120_000;
          npc.nextTrip = Date.now() + 240_000;
        }
      } else {
        this.hub.knockReply(knockId, targetId, 'join', `Sure — come find me in ${roomName(a?.sceneId)}!`);
      }
    }, rand(1800, 3200));
    void fromId;
  }

  /* ------------------------------------------------------------------ calendar */

  private syncCalendar() {
    const now = Date.now();
    for (const npc of this.npcs.values()) {
      const blocks = this.calendar.blocksFor(npc.id, now - 3600_000, now + 3600_000);
      const cal = presenceFromCalendar(blocks, now);
      const p = this.hub.presenceOf(npc.id);
      if (cal && p.source !== 'calendar') {
        this.hub.setStatus(npc.id, 'meeting', cal.note, 'calendar', cal.until);
      } else if (!cal && p.source === 'calendar') {
        const s = npc.profile.status === 'meeting' ? 'available' : npc.profile.status;
        this.hub.setStatus(npc.id, s, npc.profile.status === 'meeting' ? undefined : npc.profile.note, 'default');
      }
    }
  }
}
