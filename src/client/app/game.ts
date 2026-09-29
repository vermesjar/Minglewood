/**
 * Game controller: the glue between the realtime socket, the WorldView renderer and the React UI.
 * Product decisions about what an interaction *means* live here.
 */
import type { Bootstrap, PublicConfig } from '@shared/api';
import type { AvatarLoadout, PresenceStatus, SavedOutfit } from '@shared/domain/types';
import type { KnockKind, KnockReply, Occupant, ServerMsg } from '@shared/protocol';
import type { EmoteId } from '@shared/presence';
import { EMOTE_IDS } from '@shared/presence';
import { getScene, TOWN_ID, buildingForRoom } from '@shared/world';
import { livedScene } from '@shared/world/lived';
import { DECOR_BY_ID, decorObject, placementProblem } from '@shared/world/decor';
import type { SceneObject } from '@shared/world/scene';
import { isSeat } from '@shared/world/scene';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, type Tile } from '@shared/world/pathfinding';
import { distanceToObject, interactionFor } from '@shared/world/interactions';
import type { PropState } from '@shared/world/interactions';
import { setSoundEnabled } from '../engine/sfx';
import { WorldView, type BuildingBadge } from '../engine/WorldView';
import { api, ApiError, setActivityTransport } from './api';
import { Realtime } from './socket';
import { getState, loadLocal, persistLocal, setState, toast } from './store';
import { isInDiscordActivity, startActivity } from '../discord/activity';

export const QUESTS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'avatar', label: 'Make your avatar yours', hint: 'Open your wardrobe from the top-right.' },
  { id: 'hq', label: 'Visit HQ and its history wall', hint: 'Double-click Northstar HQ.' },
  { id: 'team', label: 'Drop by your team’s room', hint: 'Your team’s home is marked in the sidebar.' },
  { id: 'coffee', label: 'Grab a coffee at Tidewater Café', hint: 'It’s by the lake.' },
  { id: 'wave', label: 'Wave at three coworkers', hint: 'Click someone, then 👋.' },
  { id: 'knock', label: 'Knock on someone who’s open to chat', hint: 'Look for the green dot.' },
  { id: 'artifact', label: 'Discover a piece of company history', hint: 'Frames, trophies, the big oak…' },
  { id: 'party', label: 'Stop by the party in Lantern Hall', hint: 'There’s cake.' },
];

class Game {
  world: WorldView | null = null;
  rt: Realtime | null = null;
  meId = '';
  private grids = new Map<string, WalkGrid>();
  private lastScene: { sceneId: string; occupants: Occupant[]; props?: Record<string, PropState> } | null = null;
  private sceneWaiters = new Map<string, Array<() => void>>();
  private arrival: { goal: Tile; then: () => void; started: number } | null = null;
  private ownPath: string | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private arrivalTimer: number | null = null;
  initialScene = TOWN_ID;

  /* ------------------------------------------------------------------ lifecycle */

  async start() {
    try {
      if (isInDiscordActivity()) {
        setState({ inDiscord: true });
        // Activity: all traffic via the Discord proxy. Config first, then SDK auth.
        setActivityTransport('');
        const config = await api<PublicConfig>('/config');
        setState({ config });
        if (config.discord.clientId && !this.activityStarted) {
          try {
            const ctx = await startActivity(config.discord.clientId, (n) =>
              toast(`${n} ${n === 1 ? 'person is' : 'people are'} here in this Discord Activity`, 'social'),
            );
            this.activityStarted = true;
            if (ctx.roomId) this.initialScene = ctx.roomId;
          } catch (e) {
            // Declined or not a member: explain instead of re-prompting.
            setState({ phase: 'landing', authError: e instanceof ApiError && e.status === 403 ? 'not_member' : 'activity_auth' });
            return;
          }
        }
      } else {
        const config = await api<PublicConfig>('/config');
        setState({ config });
      }
      const boot = await api<Bootstrap>('/bootstrap');
      this.begin(boot);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setState({ phase: 'landing' });
        return;
      }
      // Server restarting or network blip: keep the loading screen and retry.
      console.warn('[startup] retrying', e);
      this.startAttempts++;
      if (this.startAttempts > 20) setState({ phase: 'landing' });
      else setTimeout(() => void this.start(), Math.min(4000, 400 * this.startAttempts));
    }
  }

  private startAttempts = 0;
  private activityStarted = false;

  begin(boot: Bootstrap) {
    this.meId = boot.me.id;
    const local = loadLocal(boot.me.id);
    const isNew = daysSinceStart(boot.me.startDate) <= 1 && !localStorage.getItem(`mw.welcomed.${boot.me.id}`);
    setState({
      boot,
      membersById: new Map(boot.members.map((m) => [m.id, m])),
      events: boot.events,
      phase: 'world',
      welcomeOpen: isNew,
      ...local,
    });
    this.rt = new Realtime(
      (m) => this.onMessage(m),
      (s) => setState({ connection: s }),
    );
    this.rt.connect();
    if (!this.arrivalTimer) this.arrivalTimer = window.setInterval(() => this.checkArrival(), 90);
  }

  /** Re-read org config (rooms, bindings, events) — e.g. after an admin edits it. */
  async refreshBoot() {
    try {
      const boot = await api<Bootstrap>('/bootstrap');
      setState({ boot, membersById: new Map(boot.members.map((m) => [m.id, m])), events: boot.events });
      this.refreshBadges();
    } catch {
      /* keep the current snapshot */
    }
  }

  attach(canvas: HTMLCanvasElement) {
    this.world = new WorldView(canvas, {
      onGroundClick: (t) => this.onGroundClick(t),
      onActorClick: (id, p) => this.selectMember(id, p),
      onObjectClick: (o, p) => this.onObjectClick(o, p),
      onObjectActivate: (o) => this.onObjectActivate(o),
      onHover: (label) => setState({ hoverLabel: label }),
      onHoverTile: (tile) => this.updateGhost(tile),
      nameOf: (id) => getState().membersById.get(id)?.displayName ?? 'Someone',
    });
    this.applyPrefs();
    if (this.lastScene) this.loadScene(this.lastScene.sceneId, this.lastScene.occupants, this.lastScene.props);
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
  }

  detach() {
    this.world?.destroy();
    this.world = null;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
  }

  /** Tell the renderer which parts of the screen the panels cover. */
  syncInsets() {
    const s = getState();
    if (!this.world) return;
    const narrow = window.innerWidth <= 820;
    const interior = !!s.boot?.rooms.some((r) => r.id === s.sceneId);
    this.world.setInsets({
      left: !narrow && s.prefs.sidebarOpen ? 305 : 0,
      right: !narrow && interior ? 325 : 0,
    });
  }

  applyPrefs() {
    const p = getState().prefs;
    this.syncInsets();
    if (!this.world) return;
    this.world.reducedMotion = p.reducedMotion;
    this.world.effects.reducedMotion = p.reducedMotion;
    this.world.ambience.reducedMotion = p.reducedMotion;
    this.world.ambience.alwaysDay = !!p.alwaysDay;
    this.world.showAllNames = p.showAllNames;
    setSoundEnabled(!!p.sound);
  }

  async signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/';
  }

  /* ------------------------------------------------------------------ server messages */

  private onMessage(m: ServerMsg) {
    const w = this.world;
    switch (m.t) {
      case 'welcome':
        this.world?.setServerOffset(this.rt!.serverOffset);
        setState({ directory: Object.fromEntries(m.directory.map((d) => [d.memberId, d])) });
        this.refreshBadges();
        this.rt!.send({ t: 'enter', sceneId: getState().sceneId ?? this.initialScene });
        break;
      case 'scene':
        this.loadScene(m.sceneId, m.occupants, m.props);
        break;
      case 'joined':
        if (m.sceneId !== getState().sceneId) break;
        w?.upsert(m.occupant);
        setState((s) => ({ occupants: { ...s.occupants, [m.occupant.memberId]: m.occupant } }));
        if (m.sceneId === TOWN_ID) {
          const door = this.buildingDoorNear(m.occupant.x, m.occupant.y);
          if (door) w?.doorPuff(door);
        } else w?.arrivalPuff(m.occupant.memberId);
        if (m.occupant.memberId !== this.meId) this.announce(`${this.name(m.occupant.memberId)} arrived`);
        break;
      case 'left':
        if (m.sceneId === TOWN_ID && m.toSceneId && m.toSceneId !== TOWN_ID) w?.doorPuff(m.toSceneId);
        w?.remove(m.memberId);
        setState((s) => {
          const o = { ...s.occupants };
          delete o[m.memberId];
          const sel = s.selection?.kind === 'member' && s.selection.id === m.memberId ? null : s.selection;
          return { occupants: o, selection: sel };
        });
        break;
      case 'moved':
        if (m.memberId === this.meId && this.ownPath === pathKey(m.path)) break;
        w?.move(m.memberId, m.path, m.startedAt);
        break;
      case 'updated':
        w?.patch(m.memberId, m.patch);
        setState((s) => {
          const cur = s.occupants[m.memberId];
          return cur ? { occupants: { ...s.occupants, [m.memberId]: { ...cur, ...m.patch } } } : {};
        });
        break;
      case 'emote':
        w?.emote(m.memberId, m.emote, m.targetId);
        break;
      case 'interacted':
        w?.propFx(m.objectId, m.memberId, m.result);
        break;
      case 'combo':
        w?.combo(m.a, m.b);
        if (m.a === this.meId || m.b === this.meId) this.greet(m.a === this.meId ? m.b : m.a);
        break;
      case 'said':
        w?.say(m.memberId, m.text);
        break;
      case 'directory':
        setState({ directory: Object.fromEntries(m.entries.map((d) => [d.memberId, d])) });
        this.refreshBadges();
        break;
      case 'knock':
        setState((s) => ({ knocks: [...s.knocks, { knockId: m.knockId, fromId: m.fromId, kind: m.kind, at: Date.now() }] }));
        this.announce(`${this.name(m.fromId)} is knocking`);
        break;
      case 'knock-result': {
        const who = this.name(m.targetId).split(' ')[0];
        const text =
          m.reply === 'join'
            ? `${who}: “${m.message ?? 'Come on over!'}”`
            : m.reply === 'soon'
              ? `${who}: “${m.message ?? 'In a few minutes!'}”`
              : `${who}: “${m.message ?? 'Not right now — catch you later!'}”`;
        const sceneId = m.sceneId;
        toast(text, 'social', m.reply === 'join' && sceneId ? { label: 'Go there', run: () => this.goToMember(m.targetId, sceneId) } : undefined, 9000);
        break;
      }
      case 'toast':
        toast(m.text, m.tone);
        break;
      case 'events':
        setState({ events: m.events });
        this.refreshBadges();
        break;
      case 'member':
        setState((s) => {
          const map = new Map(s.membersById);
          const cur = map.get(m.memberId);
          if (cur) map.set(m.memberId, { ...cur, avatar: m.avatar, unlockedItems: m.unlockedItems });
          const boot = s.boot && m.memberId === this.meId ? { ...s.boot, me: { ...s.boot.me, avatar: m.avatar, unlockedItems: m.unlockedItems } } : s.boot;
          return { membersById: map, boot };
        });
        this.refreshBadges();
        break;
      case 'artifacts': {
        setState((s) => (s.boot ? { boot: { ...s.boot, artifacts: m.artifacts } } : {}));
        const cur = getState().sceneId;
        const added = m.added ? m.artifacts.find((a) => a.id === m.added) : undefined;
        if (added && cur === added.sceneId && this.lastScene) this.loadScene(cur, Object.values(getState().occupants), this.lastScene.props);
        if (added) {
          const room = getState().boot?.rooms.find((r) => r.id === added.sceneId);
          toast(`🏺 New in ${room?.name ?? 'town'}: “${added.title}”`, 'celebrate', { label: 'Go see it', run: () => this.showArtifact(added.id) }, 12000);
        }
        break;
      }
      case 'decor': {
        setState((s) => (s.boot ? { boot: { ...s.boot, decorations: m.decorations } } : {}));
        if (getState().sceneId === m.roomId && this.lastScene) this.loadScene(m.roomId, Object.values(getState().occupants), this.lastScene.props);
        if (m.by && m.by !== this.meId && getState().sceneId === m.roomId) toast(`🌿 ${this.name(m.by).split(' ')[0]} just redecorated`, 'social', undefined, 3500);
        break;
      }
      case 'profile':
        setState((s) => {
          const map = new Map(s.membersById);
          map.set(m.member.id, m.member);
          return { membersById: map };
        });
        break;
      case 'error':
        console.warn('[server]', m.message);
        break;
    }
  }

  private loadScene(sceneId: string, occupants: Occupant[], props?: Record<string, PropState>) {
    this.lastScene = { sceneId, occupants, props };
    const prev = getState().sceneId;
    setState({
      sceneId,
      occupants: Object.fromEntries(occupants.map((o) => [o.memberId, o])),
      selection: null,
    });
    const scene = this.scene(sceneId);
    if (this.world && scene) {
      const active = this.activeEvents();
      const decor = new Set(active.map((e) => e.decor));
      const festiveRooms = new Set(active.filter((e) => e.decor === 'balloons' || e.decor === 'launch').map((e) => e.roomId));
      const ev = active.find((e) => e.roomId === sceneId);
      this.world.setServerOffset(this.rt?.serverOffset ?? 0);
      this.syncInsets();
      this.world.loadScene(scene, occupants, {
        meId: this.meId,
        activeDecor: decor,
        festiveRooms,
        bannerText: ev ? ev.title : undefined,
        party: !!ev && ev.decor === 'balloons',
        grid: this.grid(sceneId),
        props,
      });
      this.refreshBadges();
    }
    this.sceneWaiters.get(sceneId)?.forEach((r) => r());
    this.sceneWaiters.delete(sceneId);
    if (prev !== sceneId) this.onEnteredScene(sceneId);
  }

  private onEnteredScene(sceneId: string) {
    if (getState().decorate) this.setDecorate(null);
    const s = getState();
    const room = s.boot?.rooms.find((r) => r.id === sceneId);
    this.announce(room ? `You entered ${room.name}` : 'You are in town');
    const me = s.boot?.me;
    const team = s.boot?.teams.find((t) => t.id === me?.teamId);
    if (sceneId === 'hq') this.quest('hq');
    if (sceneId === 'cafe') this.quest('coffee');
    if (team?.homeRoomId === sceneId) this.quest('team');
    if (this.activeEvents().some((e) => e.roomId === sceneId)) this.quest('party');
  }

  /* ------------------------------------------------------------------ derived */

  activeEvents(now = Date.now()) {
    return getState().events.filter((e) => Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  }

  private refreshBadges() {
    const s = getState();
    if (!s.boot || !this.world) return;
    const active = this.activeEvents();
    const badges = new Map<string, BuildingBadge>();
    for (const r of s.boot.rooms) {
      const here = Object.values(s.directory).filter((d) => d.online && d.sceneId === r.id);
      here.sort((a, b) => rank(a.status) - rank(b.status));
      const ev = active.find((e) => e.roomId === r.id);
      badges.set(r.id, {
        name: r.name,
        emoji: r.emoji,
        count: here.length,
        openCount: here.filter((d) => d.status === 'open').length,
        faces: here.map((d) => s.membersById.get(d.memberId)?.avatar).filter((a): a is AvatarLoadout => !!a),
        event: ev ? `${ev.kind === 'birthday' ? '🎂' : '🎉'} ${ev.kind === 'birthday' ? 'Party now!' : 'Happening now'}` : undefined,
      });
    }
    this.world.setBadges(badges);
    const festive = new Set(active.filter((e) => e.decor === 'balloons' || e.decor === 'launch').map((e) => e.roomId));
    this.world.setFestive(festive);
  }

  /** The scene as it looks today, including artifacts added since it was authored. */
  scene(sceneId: string) {
    const base = getScene(sceneId);
    const boot = getState().boot;
    return base ? livedScene(base, boot?.artifacts ?? [], boot?.decorations ?? []) : undefined;
  }

  object(sceneId: string, objectId: string) {
    return this.scene(sceneId)?.objects.find((o) => o.id === objectId);
  }

  /** Walk the viewer to a piece of history and open its story. */
  showArtifact(artifactId: string) {
    const a = getState().boot?.artifacts.find((x) => x.id === artifactId);
    if (!a) return;
    const open = () => {
      const o = this.scene(a.sceneId)?.objects.find((x) => x.artifactId === artifactId);
      if (o) setState({ selection: { kind: 'object', sceneId: a.sceneId, objectId: o.id, x: window.innerWidth / 2, y: window.innerHeight / 2 } });
    };
    if (getState().sceneId === a.sceneId) open();
    else {
      this.goTo(a.sceneId);
      setTimeout(open, 1600);
    }
  }

  grid(sceneId: string): WalkGrid | null {
    const scene = this.scene(sceneId);
    if (!scene) return null;
    const decor = [...new Set(this.activeEvents().map((e) => e.decor))].sort().join(',');
    const placed = (getState().boot?.decorations ?? []).filter((d) => d.roomId === sceneId).map((d) => d.id).join(',');
    const key = `${sceneId}|${decor}|${placed}`;
    let g = this.grids.get(key);
    if (!g) {
      g = new WalkGrid(scene, new Set(decor.split(',').filter(Boolean)));
      this.grids.set(key, g);
    }
    return g;
  }

  name(id: string) {
    return getState().membersById.get(id)?.displayName ?? 'Someone';
  }

  private announce(text: string) {
    setState({ announce: text });
  }

  /* ------------------------------------------------------------------ movement */

  walkTo(goal: Tile, then?: () => void): boolean {
    const sceneId = getState().sceneId;
    if (!this.world || !sceneId) return false;
    const grid = this.grid(sceneId);
    const start = this.world.actorTile(this.meId);
    if (!grid || !start) return false;
    const seat = getScene(sceneId)?.objects.some((o) => isSeat(o) && o.x === goal[0] && o.y === goal[1]);
    let target = goal;
    if (!grid.walkable(goal[0], goal[1]) && !seat) {
      const n = grid.nearestWalkable(goal[0], goal[1], 3);
      if (!n) return false;
      target = [n.x, n.y];
    }
    const path = findPath(grid, start, target, { allowGoal: !!seat });
    if (!path) {
      toast('Can’t get there from here.');
      return false;
    }
    this.arrival = then ? { goal: target, then, started: Date.now() } : null;
    if (path.length === 1) {
      this.checkArrival();
      return true;
    }
    const startedAt = Date.now() + (this.rt?.serverOffset ?? 0);
    this.ownPath = pathKey(path);
    this.world.move(this.meId, path, startedAt);
    this.world.showDestination(target);
    this.rt?.send({ t: 'move', path });
    return true;
  }

  private checkArrival() {
    const a = this.arrival;
    if (!a || !this.world) return;
    if (this.world.isMoving(this.meId)) return;
    const t = this.world.actorTile(this.meId);
    this.arrival = null;
    if (t && Math.abs(t[0] - a.goal[0]) <= 1 && Math.abs(t[1] - a.goal[1]) <= 1) a.then();
  }

  private onGroundClick(t: Tile) {
    const dec = getState().decorate;
    if (dec) {
      if (dec.itemId) void this.placeDecoration(dec.itemId, t);
      return;
    }
    setState({ selection: null });
    this.world?.setSelected(null);
    this.walkTo(t);
  }

  step(dx: number, dy: number) {
    const t = this.world?.actorTile(this.meId);
    const sceneId = getState().sceneId;
    if (!t || !sceneId || this.world?.isMoving(this.meId)) return;
    const grid = this.grid(sceneId)!;
    const tries: Tile[] = [[t[0] + dx, t[1] + dy]];
    if (dx && dy) tries.push([t[0] + dx, t[1]], [t[0], t[1] + dy]);
    for (const goal of tries) {
      if (grid.walkable(goal[0], goal[1])) {
        this.walkTo(goal);
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ navigation */

  goToScene(sceneId: string, opts: { near?: string; at?: Tile } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.sceneWaiters.set(sceneId, [...(this.sceneWaiters.get(sceneId) ?? []), resolve]);
      this.rt?.send({ t: 'enter', sceneId, near: opts.near, at: opts.at });
    });
  }

  /** Go to a room, with the iris transition. From town, nearby doors are walked to first. */
  enterRoom(roomId: string) {
    const s = getState();
    if (s.sceneId === roomId) return;
    setState({ selection: null });
    const door = buildingForRoom(roomId)?.door;
    const me = this.world?.actorTile(this.meId);
    const go = () => this.world?.transitionTo(() => this.goToScene(roomId));
    if (s.sceneId === TOWN_ID && door && me && Math.hypot(me[0] - door.x, me[1] - door.y) < 9) {
      if (!this.walkTo([door.x, door.y], go)) go();
    } else go();
  }

  exitToTown() {
    const s = getState();
    const scene = s.sceneId ? getScene(s.sceneId) : null;
    if (!scene || scene.kind !== 'interior') return;
    const go = () => this.world?.transitionTo(() => this.goToScene(TOWN_ID));
    const me = this.world?.actorTile(this.meId);
    const doorY = scene.interior!.doorY;
    if (me && Math.hypot(me[0], me[1] - doorY) < 6) {
      if (!this.walkTo([0, doorY], go)) go();
    } else go();
  }

  goTo(sceneId: string) {
    if (sceneId === TOWN_ID) this.exitToTown();
    else this.enterRoom(sceneId);
  }

  /** Jump next to a coworker — search and knocks should never require a long walk. */
  goToMember(memberId: string, sceneHint?: string) {
    const s = getState();
    const sceneId = s.directory[memberId]?.sceneId ?? sceneHint;
    const name = this.name(memberId).split(' ')[0];
    if (!sceneId) {
      toast(`${name} isn’t sharing where they are right now.`);
      return;
    }
    setState({ selection: null, panel: null });
    if (sceneId === s.sceneId) {
      const t = this.world?.actorTile(memberId);
      if (t) {
        this.world?.focusOn(t);
        this.walkTo([t[0] + 1, t[1]]);
      }
      return;
    }
    this.world?.transitionTo(() => this.goToScene(sceneId, { near: memberId }));
  }

  focusRoom(roomId: string) {
    const b = buildingForRoom(roomId);
    if (!b || !this.world) return;
    this.world.focusOn([b.x + Math.floor((b.w ?? 1) / 2), b.y + Math.floor((b.d ?? 1) / 2)]);
  }

  /* ------------------------------------------------------------------ objects & people */

  selectMember(id: string, p: { x: number; y: number }) {
    setState({ selection: { kind: 'member', id, x: p.x, y: p.y } });
    this.world?.setSelected(id);
  }

  private onObjectClick(o: SceneObject, p: { x: number; y: number }) {
    const sceneId = getState().sceneId!;
    if (getState().decorate) {
      if (o.id.startsWith('decor-')) void this.removeDecoration(o.id.slice(6));
      else toast('That piece belongs to the room — you can remove things your team added.', 'info', undefined, 3000);
      return;
    }
    const kinds = new Set(o.actions?.map((a) => a.kind));
    if (kinds.has('exit')) return this.exitToTown();
    if (kinds.has('sit')) {
      const occ = getState().occupants[this.meId];
      if (occ?.sittingOn === o.id) {
        this.rt?.send({ t: 'stand' });
        return;
      }
      if (!kinds.has('artifact')) {
        this.walkTo([o.x, o.y], () => this.rt?.send({ t: 'sit', objectId: o.id }));
        return;
      }
    }
    if (kinds.has('artifact')) this.quest('artifact');
    // Props you can use: walk over and do it. Things with a story still open their card.
    if (interactionFor(o) && !kinds.has('info') && !kinds.has('activity') && !kinds.has('link') && !kinds.has('artifact')) {
      setState({ selection: null });
      this.useProp(o);
      return;
    }
    setState({ selection: { kind: 'object', sceneId, objectId: o.id, x: p.x, y: p.y } });
  }

  /** Walk within reach of a prop, then use it. */
  useProp(o: SceneObject) {
    const it = interactionFor(o);
    const sceneId = getState().sceneId;
    const me = this.world?.actorTile(this.meId);
    if (!it || !sceneId || !me) return;
    const send = () => this.rt?.send({ t: 'interact', objectId: o.id });
    if (distanceToObject(o, me[0], me[1]) <= it.reach && !this.world?.isMoving(this.meId)) {
      send();
      return;
    }
    const grid = this.grid(sceneId);
    if (!grid) return;
    const spots: Tile[] = [];
    const r = Math.ceil(it.reach);
    for (let y = o.y - r; y < o.y + (o.d ?? 1) + r; y++) {
      for (let x = o.x - r; x < o.x + (o.w ?? 1) + r; x++) {
        if (grid.walkable(x, y) && distanceToObject(o, x, y) <= it.reach) spots.push([x, y]);
      }
    }
    spots.sort((a, b) => Math.hypot(a[0] - me[0], a[1] - me[1]) - Math.hypot(b[0] - me[0], b[1] - me[1]));
    for (const spot of spots.slice(0, 4)) {
      if (this.walkTo(spot, send)) return;
    }
  }

  /** Which building's door is right next to this spot (someone just came out of it). */
  private buildingDoorNear(x: number, y: number): string | undefined {
    for (const r of getState().boot?.rooms ?? []) {
      const d = buildingForRoom(r.id)?.door;
      if (d && Math.abs(d.x - x) <= 2 && Math.abs(d.y - y) <= 2) return r.id;
    }
    return undefined;
  }

  private onObjectActivate(o: SceneObject) {
    const enter = o.actions?.find((a) => a.kind === 'enter');
    if (enter && enter.kind === 'enter') this.enterRoom(enter.roomId);
  }

  /* ------------------------------------------------------------------ social actions */

  emote(emote: EmoteId, targetId?: string) {
    const occ = getState().occupants;
    const t = targetId && occ[targetId] ? targetId : undefined;
    if (emote === 'highfive' && t && t !== this.meId) {
      const me = this.world?.actorTile(this.meId);
      const them = this.world?.actorTile(t);
      if (me && them && Math.hypot(me[0] - them[0], me[1] - them[1]) > 1.6) {
        const sceneId = getState().sceneId;
        const grid = sceneId ? this.grid(sceneId) : null;
        const spot = grid?.nearestWalkable(them[0] + 1, them[1], 2);
        const go = () => this.rt?.send({ t: 'emote', emote, targetId: t });
        if (spot && this.walkTo([spot.x, spot.y], go)) return;
      }
    }
    this.rt?.send({ t: 'emote', emote, targetId: t });
    if (emote === 'wave' && t && t !== this.meId) {
      this.greet(t);
      setState((s) => ({ waves: s.waves + 1 }));
      if (getState().waves >= 3) this.quest('wave');
      persistLocal(this.meId);
    }
  }

  greet(memberId: string) {
    setState((s) => (s.greeted.includes(memberId) ? {} : { greeted: [...s.greeted, memberId] }));
    persistLocal(this.meId);
  }

  say(text: string) {
    const t = text.trim();
    if (t) this.rt?.send({ t: 'say', text: t.slice(0, 120) });
  }

  setStatus(status: Exclude<PresenceStatus, 'offline'>, note?: string) {
    this.rt?.send({ t: 'status', status, note });
  }

  knock(targetId: string, kind: KnockKind) {
    this.rt?.send({ t: 'knock', targetId, kind });
    const who = this.name(targetId).split(' ')[0];
    toast(kind === 'coffee' ? `☕ You invited ${who} for a coffee…` : `🚪 You knocked on ${who}’s door…`, 'social');
    this.greet(targetId);
    this.quest('knock');
    setState({ selection: null });
  }

  replyKnock(knockId: string, reply: KnockReply) {
    const k = getState().knocks.find((x) => x.knockId === knockId);
    this.rt?.send({ t: 'knock-reply', knockId, reply });
    setState((s) => ({ knocks: s.knocks.filter((x) => x.knockId !== knockId) }));
    if (k && reply === 'join') this.goToMember(k.fromId);
  }

  claimReward(eventId: string) {
    this.rt?.send({ t: 'claim-reward', eventId });
  }

  async saveAvatar(loadout: AvatarLoadout) {
    await api('/me/avatar', { method: 'PUT', json: loadout });
    this.quest('avatar');
  }

  async saveOutfits(outfits: SavedOutfit[]) {
    const res = await api<{ outfits: SavedOutfit[] }>('/me/outfits', { method: 'PUT', json: { outfits } });
    setState((s) => (s.boot ? { boot: { ...s.boot, me: { ...s.boot.me, outfits: res.outfits } } } : {}));
  }

  /** One tap from the menu: switch to a saved look or a vibe without opening the wardrobe. */
  async wearLook(loadout: AvatarLoadout, label: string) {
    try {
      await this.saveAvatar(loadout);
      toast(`${label} — looking good ✨`, 'celebrate', undefined, 2500);
    } catch (e) {
      toast(`Couldn’t change: ${(e as Error).message}`);
    }
  }

  async updateProfile(patch: Record<string, unknown>) {
    const { me } = await api<{ me: Bootstrap['me'] }>('/me', { method: 'PATCH', json: patch });
    setState((s) => {
      const map = new Map(s.membersById);
      map.set(me.id, { ...map.get(me.id)!, ...me });
      return { boot: s.boot ? { ...s.boot, me } : s.boot, membersById: map };
    });
  }

  /* ------------------------------------------------------------------ decorating */

  canDecorate(roomId: string | null): boolean {
    const s = getState();
    const me = s.boot?.me;
    const room = s.boot?.rooms.find((r) => r.id === roomId);
    if (!me || !room) return false;
    return me.role !== 'member' || (!!room.ownerTeamId && room.ownerTeamId === me.teamId);
  }

  setDecorate(mode: { itemId: string | null } | null) {
    setState({ decorate: mode, selection: null });
    if (!mode) this.world?.setGhost(null);
  }

  private updateGhost(tile: Tile | null) {
    const dec = getState().decorate;
    const sceneId = getState().sceneId;
    if (!dec?.itemId || !tile || !sceneId || !this.world) {
      this.world?.setGhost(null);
      return;
    }
    const scene = this.scene(sceneId);
    const obj = decorObject({ id: 'ghost', roomId: sceneId, itemId: dec.itemId, x: tile[0], y: tile[1], placedBy: '', placedAt: '' });
    if (!scene || !obj) return;
    const occupied = new Set(Object.values(getState().occupants).map((o) => `${Math.round(o.x)},${Math.round(o.y)}`));
    this.world.setGhost({ obj, valid: !placementProblem(scene, tile[0], tile[1], occupied) });
  }

  async placeDecoration(itemId: string, t: Tile) {
    const sceneId = getState().sceneId;
    if (!sceneId) return;
    try {
      await api(`/rooms/${sceneId}/decor`, { method: 'POST', json: { itemId, x: t[0], y: t[1] } });
      toast(`Placed ${DECOR_BY_ID.get(itemId)?.name.toLowerCase()} ✨`, 'celebrate', undefined, 2000);
    } catch (e) {
      toast((e as Error).message, 'info', undefined, 3500);
    }
  }

  async removeDecoration(id: string) {
    const sceneId = getState().sceneId;
    try {
      await api(`/rooms/${sceneId}/decor/${id}`, { method: 'DELETE' });
    } catch (e) {
      toast((e as Error).message, 'info', undefined, 3500);
    }
  }

  quest(id: string) {
    const s = getState();
    if (s.quests[id]) return;
    setState({ quests: { ...s.quests, [id]: true } });
    persistLocal(this.meId);
    const q = QUESTS.find((x) => x.id === id);
    if (q && daysSinceStart(s.boot?.me.startDate ?? '') <= 30) toast(`✨ ${q.label}`, 'celebrate', undefined, 3500);
  }

  dismissSuggestion(id: string) {
    setState((s) => ({ dismissed: [...s.dismissed, id] }));
    persistLocal(this.meId);
  }

  /* ------------------------------------------------------------------ keyboard */

  private onKey(e: KeyboardEvent) {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setState({ panel: 'search' });
      return;
    }
    if (e.key === 'Escape') {
      setState({ selection: null, panel: null });
      this.world?.setSelected(null);
      return;
    }
    if (typing) return;
    const map: Record<string, [number, number]> = {
      ArrowUp: [-1, -1],
      w: [-1, -1],
      ArrowDown: [1, 1],
      s: [1, 1],
      ArrowLeft: [-1, 1],
      a: [-1, 1],
      ArrowRight: [1, -1],
      d: [1, -1],
    };
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      this.step(dir[0], dir[1]);
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      setState({ panel: 'search' });
      return;
    }
    if (e.key === 'Enter') {
      (document.getElementById('mw-chat') as HTMLInputElement | null)?.focus();
      e.preventDefault();
      return;
    }
    if (e.key === '+' || e.key === '=') this.world?.zoomBy(1.25);
    if (e.key === '-') this.world?.zoomBy(0.8);
    const n = Number(e.key);
    if (n >= 1 && n <= EMOTE_IDS.length) {
      const sel = getState().selection;
      this.emote(EMOTE_IDS[n - 1], sel?.kind === 'member' ? sel.id : undefined);
    }
  }
}

function rank(s: PresenceStatus) {
  return ['open', 'available', 'meeting', 'focused', 'away', 'offline'].indexOf(s);
}

function pathKey(p: Tile[]) {
  return p.map((t) => t.join(',')).join(';');
}

export function daysSinceStart(iso: string): number {
  if (!iso) return 999;
  return Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000);
}

export const game = new Game();
