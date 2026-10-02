/**
 * Game controller: the glue between the realtime socket, the WorldView renderer and the React UI.
 * Product decisions about what an interaction *means* live here.
 */
import { carryMeta } from '@shared/carry';
import type { Bootstrap, PublicConfig } from '@shared/api';
import type { AvatarLoadout, PresenceStatus, SavedOutfit } from '@shared/domain/types';
import { MAX_CHAT, NOTE_MAX_CHARS, fromWirePatch, type KnockKind, type KnockReply, type NpcState, type Occupant, type ServerMsg, type WirePatch } from '@shared/protocol';
import type { EmoteId } from '@shared/presence';
import { EMOTE_IDS } from '@shared/presence';
import { getScene, TOWN_ID, buildingForRoom } from '@shared/world';
import { livedScene } from '@shared/world/lived';
import { decorItem, decorObject, placementProblem, wallPiece, wallPlacementProblem, wallSpanOf, withoutDecoration, type DecorItem, type WallFace } from '@shared/world/decor';
import type { SceneDef, SceneObject } from '@shared/world/scene';
import { seatSpotAt, seatSpots, stepOffTiles } from '@shared/world/seats';
import { approach } from '@shared/world/interact';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, reroute, type Tile } from '@shared/world/pathfinding';
import { heldDelta, KEY_DIRS, planHeldWalk, type ScreenDir } from '@shared/world/heldWalk';
import { WorldView, type BuildingBadge, type WallSpot } from '../engine/WorldView';
import { clientArt, loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setWorldClock } from '../engine/weather';
import { api, ApiError, setActivityTransport } from './api';
import { Realtime } from './socket';
import { getState, loadLocal, persistLocal, setState, toast } from './store';
import { isInDiscordActivity, openLink, startActivity } from '../discord/activity';
import { badgeTitle, roomVoiceChannel, voiceBadge } from './huddles';

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


/** How long you may stand on a seat's tile unseated (a sit on its way) before you're walked off it (WorldView stands you up then too). */
/** How long after shifting along a couch a click on it still means "the cushion I'm moving to". */
const SHIFT_SETTLE_MS = 900;
const SIT_CONFIRM_MS = 1500;
/** How long an 'enter' we've sent keeps further clicks on that door from sending another. */
const ENTER_PENDING_MS = 5000;

class Game {
  world: WorldView | null = null;
  rt: Realtime | null = null;
  meId = '';
  private grids = new Map<string, WalkGrid>();
  private lastScene: { sceneId: string; occupants: Occupant[] } | null = null;
  /** The current room's NPCs as the server last told us (kept across scene reloads). */
  private npcStates = new Map<string, NpcState>();
  private sceneWaiters = new Map<string, Array<() => void>>();
  /** Where our walk is going and what happens there (`scene`: the room whose door we're walking to). */
  private arrival: { goal: Tile; then: () => void; started: number; scene?: string } | null = null;
  /** The scene we've asked the server to put us in and haven't been placed in yet. */
  private pendingScene: { id: string; at: number } | null = null;
  /** Our recently sent paths, so the server's echo of them doesn't restart our own walk. */
  private ownPaths: string[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private blurHandler: (() => void) | null = null;
  /** Screen directions currently held (arrows / WASD) and the steering loop that follows them. */
  private held = new Set<ScreenDir>();
  private walkRaf = 0;
  private keyWalking = false;
  private arrivalTimer: number | null = null;
  initialScene = TOWN_ID;
  /** From a link (`?to=<memberId>`: Slack's "join me", an unfurl's Join button): arrive next to them. */
  private linkTo: string | null = null;

  /* ------------------------------------------------------------------ lifecycle */

  async start() {
    this.readLink();
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
      const [boot] = await Promise.all([api<Bootstrap>('/bootstrap'), this.artReady]);
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

  /**
   * Links into the world (Slack unfurls, /minglewood, shared URLs): `?room=<roomId>` opens that room,
   * `?to=<memberId>` puts you next to that person. Read once, then tidied out of the address bar.
   */
  private readLink() {
    this.noteStatusGrant();
    const q = new URLSearchParams(location.search);
    const room = q.get('room');
    const to = q.get('to');
    if (!room && !to) return;
    if (room && /^[a-z0-9-]{1,40}$/.test(room)) this.initialScene = room;
    if (to && /^[\w-]{1,60}$/.test(to)) this.linkTo = to;
    q.delete('room');
    q.delete('to');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }

  private startAttempts = 0;
  /** Switch states for the current scene, kept so a re-attached view can restore them. */
  private sceneStates: Record<string, boolean> | undefined;
  /** Finished art (public/art) loads alongside the bootstrap; procedural sprites fill any gaps. */
  private artReady = loadArt().then(clearSpriteCache);
  private activityStarted = false;

  begin(boot: Bootstrap) {
    this.meId = boot.me.id;
    setWorldClock({ timeZone: boot.org.timezone });
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
    if (!this.arrivalTimer)
      this.arrivalTimer = window.setInterval(() => {
        this.checkArrival();
        this.offSeatIfStanding();
      }, 90);
  }

  /** Re-read org config (rooms, bindings, events) — e.g. after an admin edits it. */
  async refreshBoot() {
    try {
      const boot = await api<Bootstrap>('/bootstrap');
      setWorldClock({ timeZone: boot.org.timezone });
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
      onHoverWall: (spot) => this.updateWallGhost(spot),
      onWallClick: (spot) => this.onWallClick(spot),
      nameOf: (id) => getState().membersById.get(id)?.displayName ?? 'Someone',
      voiceBadge: (id) => {
        const s = getState();
        const all = Object.values(s.occupants);
        const badge = voiceBadge(s.occupants[id], roomVoiceChannel(s.boot?.bindings, s.sceneId), all);
        if (badge?.kind === 'other') {
          const names = all.filter((o) => o.memberId !== id && o.voice?.callId === badge.callId).map((o) => s.membersById.get(o.memberId)?.displayName.split(' ')[0] ?? '…');
          badge.title = badgeTitle(badge, names);
        } else if (badge) badge.title = badgeTitle(badge, []);
        return badge;
      },
    });
    this.applyPrefs();
    this.world.setObjStates(this.sceneStates);
    if (this.lastScene) this.loadScene(this.lastScene.sceneId, this.lastScene.occupants);
    this.keyHandler = (e) => this.onKey(e);
    this.keyUpHandler = (e) => {
      const dir = KEY_DIRS[e.code];
      if (dir && this.held.delete(dir)) this.steer();
    };
    this.blurHandler = () => {
      this.held.clear();
      this.steer();
    };
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    window.addEventListener('blur', this.blurHandler);
  }

  detach() {
    this.world?.destroy();
    this.world = null;
    this.held.clear();
    cancelAnimationFrame(this.walkRaf);
    this.walkRaf = 0;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.keyUpHandler) window.removeEventListener('keyup', this.keyUpHandler);
    if (this.blurHandler) window.removeEventListener('blur', this.blurHandler);
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
    this.world.showAllNames = p.showAllNames;
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
        setWorldClock({ offsetMs: this.rt!.serverOffset });
        setState({ directory: Object.fromEntries(m.directory.map((d) => [d.memberId, d])) });
        this.refreshBadges();
        {
          // a link to someone (?to=) lands you next to them if they share where they are
          const to = this.linkTo;
          this.linkTo = null;
          const theirs = to ? m.directory.find((d) => d.memberId === to)?.sceneId : undefined;
          this.rt!.send({ t: 'enter', sceneId: getState().sceneId ?? theirs ?? this.initialScene, near: theirs ? to! : undefined });
        }
        break;
      case 'scene':
        this.world?.setObjStates(m.states);
        this.sceneStates = m.states;
        this.npcStates = new Map((m.npcs ?? []).map((n) => [n.id, n]));
        setState({ notes: m.notes ?? [] });
        this.loadScene(m.sceneId, m.occupants);
        this.world?.setNotes(getState().notes);
        break;
      case 'notes':
        if (m.sceneId !== getState().sceneId) break;
        setState((s) => ({ notes: [...s.notes.filter((n) => n.objectId !== m.objectId), ...m.notes] }));
        w?.setNotes(getState().notes, true);
        break;
      case 'objstate':
        if (m.sceneId === getState().sceneId) {
          w?.setObjState(m.objectId, m.on);
          this.sceneStates = { ...this.sceneStates, [m.objectId]: m.on };
        }
        break;
      case 'joined':
        if (m.sceneId !== getState().sceneId) break;
        w?.upsert(m.occupant);
        setState((s) => ({ occupants: { ...s.occupants, [m.occupant.memberId]: m.occupant } }));
        if (m.occupant.memberId !== this.meId) this.announce(`${this.name(m.occupant.memberId)} arrived`);
        break;
      case 'left':
        w?.remove(m.memberId);
        setState((s) => {
          const o = { ...s.occupants };
          delete o[m.memberId];
          const sel = s.selection?.kind === 'member' && s.selection.id === m.memberId ? null : s.selection;
          return { occupants: o, selection: sel };
        });
        break;
      case 'moved':
        // walking means not sitting: the store forgets the seat too (the view does in move()), so the seat is
        // free to click again and the Stand up button goes
        setState((s) => {
          const cur = s.occupants[m.memberId];
          return cur?.sittingOn ? { occupants: { ...s.occupants, [m.memberId]: { ...cur, sittingOn: undefined } } } : {};
        });
        if (m.memberId === this.meId) {
          // the echo of a walk we sent is used up here: the same path sent again by the server later is a
          // resync (it refused a walk of ours) and must be walked
          const own = this.ownPaths.indexOf(pathKey(m.path));
          if (own >= 0) {
            this.ownPaths.splice(own, 1);
            break;
          }
        }
        w?.move(m.memberId, m.path, m.startedAt);
        break;
      case 'moment':
        if (m.sceneId === getState().sceneId) w?.playObject(m.objectId, m.what, m.by, m.detail);
        break;
      case 'npc': {
        const scene = m.sceneId === getState().sceneId ? this.scene(m.sceneId) : undefined;
        if (!scene) break;
        this.npcStates.set(m.npc.id, m.npc);
        w?.updateNpc(scene, m.npc);
        break;
      }
      case 'updated': {
        // cleared fields arrive as null (JSON has no undefined): standing up clears sittingOn, arriving clears path
        const patch = fromWirePatch(m.patch as WirePatch);
        if (m.memberId === this.meId && patch.carrying && patch.carrying !== getState().occupants[this.meId]?.carrying)
          this.handedOver(patch.carrying);
        w?.patch(m.memberId, patch);
        setState((s) => {
          const cur = s.occupants[m.memberId];
          return cur ? { occupants: { ...s.occupants, [m.memberId]: { ...cur, ...patch } } } : {};
        });
        break;
      }
      case 'emote':
        w?.emote(m.memberId, m.emote);
        break;
      case 'chat-history':
        setState({ chat: { sceneId: m.sceneId, entries: m.entries, channel: m.channel } });
        break;
      case 'chat':
        setState((s) =>
          s.chat.sceneId !== m.entry.sceneId || s.chat.entries.some((e) => e.id === m.entry.id)
            ? {}
            : { chat: { ...s.chat, entries: [...s.chat.entries, m.entry].slice(-80) } },
        );
        break;
      case 'bindings-changed':
        void this.refreshBoot();
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
        if (added && cur === added.sceneId && this.lastScene) this.loadScene(cur, Object.values(getState().occupants));
        if (added) {
          const room = getState().boot?.rooms.find((r) => r.id === added.sceneId);
          toast(`🏺 New in ${room?.name ?? 'town'}: “${added.title}”`, 'celebrate', { label: 'Go see it', run: () => this.showArtifact(added.id) }, 12000);
        }
        break;
      }
      case 'decor': {
        setState((s) => (s.boot ? { boot: { ...s.boot, decorations: m.decorations } } : {}));
        if (getState().sceneId === m.roomId && this.lastScene) this.loadScene(m.roomId, Object.values(getState().occupants));
        // the ghost under the pointer is judged against the room as it now is
        if (getState().sceneId === m.roomId) this.updateWallGhost(this.lastWallSpot);
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

  private loadScene(sceneId: string, occupants: Occupant[]) {
    this.lastScene = { sceneId, occupants };
    if (this.pendingScene?.id === sceneId) this.pendingScene = null;
    this.arrival = null;
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
      });
      this.world.setNpcs(scene, [...this.npcStates.values()]);
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
        openCount: here.filter((d) => d.status === 'available' || d.status === 'open').length,
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
    const placed = (getState().boot?.decorations ?? [])
      .filter((d) => d.roomId === sceneId)
      .map((d) => `${d.id}@${d.x},${d.y}${d.wall ?? ''}`)
      .join(',');
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
    const lived = this.scene(sceneId);
    const seat = !!lived && !!seatSpotAt(lived, goal[0], goal[1]);
    let target = goal;
    if (!grid.walkable(goal[0], goal[1]) && !seat) {
      const n = grid.nearestWalkable(goal[0], goal[1], 3);
      if (!n) return false;
      target = [n.x, n.y];
    }
    // Mid-walk, the step in progress is finished and the new way continues from its end (a figure never snaps
    // back to a tile's centre, however fast you click); the same destination again sends nothing.
    const now = this.serverNow();
    const way = reroute(this.world.actorPath(this.meId), start, now, (from) => findPath(grid, from, target, { allowGoal: !!seat }));
    if (!way) {
      toast('Can’t get there from here.');
      return false;
    }
    this.arrival = then ? { goal: target, then, started: Date.now() } : null;
    if (way.path.length === 1) {
      this.checkArrival();
      return true;
    }
    this.keyWalking = false;
    if (!way.same) this.sendOwnPath(way.path, way.startedAt);
    this.world.showDestination(target);
    return true;
  }

  private serverNow() {
    return Date.now() + (this.rt?.serverOffset ?? 0);
  }

  /** Walk our own avatar locally right away and tell the server; its echo of the same path is ignored. */
  private sendOwnPath(path: Tile[], startedAt: number) {
    this.ownPaths = [...this.ownPaths.slice(-7), pathKey(path)];
    this.world?.move(this.meId, path, startedAt);
    this.rt?.send({ t: 'move', path, startedAt });
    // walking off a seat: it's free again for the store too (the server clears it as the walk starts)
    setState((s) => {
      const cur = s.occupants[this.meId];
      return cur?.sittingOn ? { occupants: { ...s.occupants, [this.meId]: { ...cur, sittingOn: undefined } } } : {};
    });
  }

  /** Arrow keys / WASD changed: keep steering while any are held, stop at the next tile when released. */
  private steer() {
    if (heldDelta(this.held)) {
      if (!this.walkRaf) this.walkRaf = requestAnimationFrame(this.walkTick);
    } else this.planKeyWalk();
  }

  private walkTick = () => {
    this.walkRaf = 0;
    if (!heldDelta(this.held)) return;
    this.planKeyWalk();
    this.walkRaf = requestAnimationFrame(this.walkTick);
  };

  private planKeyWalk() {
    const sceneId = getState().sceneId;
    const d = heldDelta(this.held);
    if (!this.world || !sceneId || (!d && !this.keyWalking)) return;
    const grid = this.grid(sceneId);
    const tile = this.world.actorTile(this.meId);
    if (!grid || !tile) return;
    const next = planHeldWalk(this.world.actorPath(this.meId), tile, this.serverNow(), d, grid);
    if (!next) return;
    this.keyWalking = true;
    this.arrival = null;
    this.sendOwnPath(next.path, next.startedAt);
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
      // (a wall piece hangs from a click on the wall: onWallClick)
      if (dec.itemId && !decorItem(dec.itemId)?.wall) void this.placeDecoration(dec.itemId, t);
      return;
    }
    setState({ selection: null });
    this.world?.setSelected(null);
    // A click on a seat's tile (a bench's far cushion, the floor-coloured gap in a low seat's sprite) means
    // "sit there", never "stand inside the furniture".
    const sceneId = getState().sceneId;
    const scene = sceneId ? this.scene(sceneId) : undefined;
    const at = scene ? seatSpotAt(scene, t[0], t[1]) : null;
    if (at) {
      const me = getState().occupants[this.meId];
      if (me?.sittingOn === at.seat.id && me.x === at.spot.x && me.y === at.spot.y) return;
      this.sitOn(at.seat, [at.spot.x, at.spot.y]);
      return;
    }
    this.walkTo(t);
  }

  /* ------------------------------------------------------------------ navigation */

  goToScene(sceneId: string, opts: { near?: string; at?: Tile } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.sceneWaiters.set(sceneId, [...(this.sceneWaiters.get(sceneId) ?? []), resolve]);
      this.pendingScene = { id: sceneId, at: Date.now() };
      this.rt?.send({ t: 'enter', sceneId, near: opts.near, at: opts.at });
    });
  }

  /**
   * Already on our way to this scene: walking to its door, or asked the server to put us there and waiting.
   * Clicking the door again (and again) is then nothing new — one trip, one 'enter', one iris.
   */
  private headingTo(sceneId: string) {
    if (this.arrival?.scene === sceneId) return true;
    const p = this.pendingScene;
    return !!p && p.id === sceneId && Date.now() - p.at < ENTER_PENDING_MS;
  }

  /** Walk to a scene's door if it's near, then go; from further away (or with no way to the door) just go. */
  private travelTo(sceneId: string, door: Tile | null) {
    // already there (a click that lands after the iris), or already on the way: nothing to do
    if (getState().sceneId === sceneId || this.headingTo(sceneId)) return;
    const go = () => {
      // (pending from the moment the iris starts closing, not only once 'enter' goes out after it)
      this.pendingScene = { id: sceneId, at: Date.now() };
      this.world?.transitionTo(() => this.goToScene(sceneId));
    };
    if (door && this.walkTo(door, go)) {
      if (this.arrival) this.arrival.scene = sceneId;
    } else go();
  }

  /** Go to a room, with the iris transition. From town, nearby doors are walked to first. */
  enterRoom(roomId: string) {
    const s = getState();
    if (s.sceneId === roomId) return;
    setState({ selection: null });
    const door = buildingForRoom(roomId)?.door;
    const me = this.world?.actorTile(this.meId);
    const near = s.sceneId === TOWN_ID && door && me && Math.hypot(me[0] - door.x, me[1] - door.y) < 9;
    this.travelTo(roomId, near ? [door.x, door.y] : null);
  }

  exitToTown() {
    const s = getState();
    const scene = s.sceneId ? getScene(s.sceneId) : null;
    if (!scene || scene.kind !== 'interior') return;
    const me = this.world?.actorTile(this.meId);
    const doorY = scene.interior!.doorY;
    const near = me && Math.hypot(me[0], me[1] - doorY) < 6;
    this.travelTo(TOWN_ID, near ? [0, doorY] : null);
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

  /**
   * Show someone's card from outside the world (search, lists): the card opens wherever they are; if they're in
   * this scene the camera glances over to them, but nobody moves until you choose to join them.
   */
  showMember(id: string) {
    const t = this.world?.actorTile(id);
    if (t) this.world?.focusOn(t);
    this.selectMember(id, this.world?.actorScreen(id) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  selectMember(id: string, p: { x: number; y: number }) {
    if (id.startsWith('npc:')) {
      const sceneId = getState().sceneId;
      if (sceneId) setState({ selection: { kind: 'npc', sceneId, npcId: id.slice(4), x: p.x, y: p.y } });
      this.world?.setSelected(id);
      return;
    }
    setState({ selection: { kind: 'member', id, x: p.x, y: p.y } });
    this.world?.setSelected(id);
  }

  /**
   * Something just landed in your hands: make it unmistakable. Whoever made it (the NPC running that machine)
   * says so as they hand it over, the item pops up over your head with a sparkle, and a toast confirms it; the
   * action bar then shows what you're holding until you put it down.
   */
  /** Something landed in your hands (the maker's hand-over line comes from the server, for the whole room). */
  private handedOver(item: string) {
    const meta = carryMeta(item);
    this.world?.gotItem(this.meId, meta?.emoji ?? '✨');
    toast(meta?.got ?? 'Enjoy!', 'social', { label: 'Put down', run: () => this.putDown() }, 4500);
  }

  /** Order from whatever an NPC runs (the barista's espresso machine). */
  orderFrom(sceneId: string, npcId: string) {
    const scene = this.scene(sceneId);
    const npc = scene?.npcs?.find((n) => n.id === npcId);
    const machine = npc?.serves ? scene?.objects.find((o) => o.sprite === npc.serves && o.actions?.some((a) => a.kind === 'vend')) : undefined;
    if (!machine) return;
    setState({ selection: null });
    this.useObject(machine, () => this.rt?.send({ t: 'carry', objectId: machine.id }));
  }

  private onObjectClick(o: SceneObject, p: { x: number; y: number }) {
    const sceneId = getState().sceneId!;
    const dec = getState().decorate;
    if (dec) {
      if (!o.id.startsWith('decor-')) toast('That piece belongs to the room — you can move or remove things your team added.', 'info', undefined, 3000);
      else if (!dec.move) void this.removeDecoration(o.id.slice(6));
      else if (!dec.moving) {
        // the move tool: pick it up; the next click puts it down
        const d = getState().boot?.decorations.find((x) => x.id === o.id.slice(6));
        if (d) {
          this.setDecorate({ itemId: d.itemId, move: true, moving: d.id });
          toast(`Moving the ${decorItem(d.itemId)?.name.toLowerCase() ?? 'piece'}: click where it goes`, 'info', undefined, 3000);
        }
      }
      return;
    }
    const kinds = new Set(o.actions?.map((a) => a.kind));
    if (kinds.has('exit')) return this.exitToTown();
    if (kinds.has('note')) {
      // the board's notes open at once; you walk up to it to pin one
      setState({ selection: { kind: 'object', sceneId, objectId: o.id, x: p.x, y: p.y } });
      this.useObject(o, () => undefined);
      return;
    }
    if (kinds.has('ring')) {
      this.useObject(o, () => {
        this.rt?.send({ t: 'ring', objectId: o.id });
        this.emote('celebrate');
        this.say('🔔 Ding ding!');
      });
      return;
    }
    if (kinds.has('use')) {
      // walk up to its working face, turn to it and use it (the server picks the song, the score, the city)
      this.useObject(o, () => this.rt?.send({ t: 'use', objectId: o.id }));
      // an heirloom's story or an artifact stays in the info stand
      if (kinds.has('info') || kinds.has('artifact')) {
        if (kinds.has('artifact')) this.quest('artifact');
        setState({ selection: { kind: 'object', sceneId, objectId: o.id, x: p.x, y: p.y } });
      }
      return;
    }
    if (kinds.has('toggle')) {
      this.rt?.send({ t: 'toggle', objectId: o.id });
      return;
    }
    if (kinds.has('vend')) {
      // Like the real thing: walk up to the counter in front of the machine and order.
      this.useObject(o, () => this.rt?.send({ t: 'carry', objectId: o.id }));
      return;
    }
    if (kinds.has('sit')) {
      const occ = getState().occupants[this.meId];
      // the cushion that was clicked (a bench or couch has one per tile), judged at cushion height
      const spots = seatSpots(o, this.scene(sceneId));
      const target = spots.length > 1 ? this.world?.cushionAt(o, spots, p.x, p.y) : undefined;
      if (occ?.sittingOn === o.id) {
        // Already sitting here: clicking your own cushion does nothing (stand up with the Stand up button or by
        // walking off); clicking another free cushion of the same seat shifts you over. "Your cushion" is the
        // one you're in or still sliding into (the store only learns it when the server confirms the shift).
        // (just shifted — the server hasn't answered, or you're still sliding — any click on this seat is you
        // settling in: it keeps the cushion you're moving to)
        const shifting = this.shift && this.shift.seat === o.id && Date.now() - this.shift.at < SHIFT_SETTLE_MS;
        const cur = shifting ? this.shift!.to : (this.world?.cushionOf(this.meId) ?? occ);
        const mine = !target || shifting || (target.x === cur.x && target.y === cur.y);
        if (!mine) this.sitOn(o, [target.x, target.y]);
        return;
      }
      // sit down — and a seat that's also a memory (the 1,000th Customer Bench) tells its story alongside
      this.sitOn(o, target ? [target.x, target.y] : undefined);
      if (!kinds.has('artifact')) return;
    }
    if (kinds.has('artifact')) this.quest('artifact');
    setState({ selection: { kind: 'object', sceneId, objectId: o.id, x: p.x, y: p.y } });
  }

  /** Walk to where something is used from (in front of it, never behind a bar), face it, then act. */
  private useObject(o: SceneObject, then: () => void) {
    const sceneId = getState().sceneId;
    const grid = sceneId ? this.grid(sceneId) : undefined;
    const me = this.world?.actorTile(this.meId);
    if (!grid || !me || !this.world) return;
    // (mid-walk: finish the step in progress and approach from its end — see walkTo)
    let tile: Tile | null = null;
    const way = reroute(this.world.actorPath(this.meId), me, this.serverNow(), (from) => {
      const a = approach(grid, from, o);
      tile = a?.tile ?? null;
      return a?.path ?? null;
    });
    if (!way || !tile) {
      toast('Can’t get there from here.');
      return;
    }
    const done = () => {
      this.world?.faceObject(this.meId, o);
      then();
    };
    this.arrival = { goal: tile, then: done, started: Date.now() };
    if (way.path.length === 1) {
      this.checkArrival();
      return;
    }
    this.keyWalking = false;
    if (!way.same) this.sendOwnPath(way.path, way.startedAt);
    this.world.showDestination(tile);
  }

  /**
   * Walk to a free spot on a seat (a couch or bench has one per cushion) and sit down there: the cushion you
   * clicked if it's free, else the free one nearest to it (or to you).
   */
  private sitOn(o: SceneObject, prefer?: Tile) {
    const sceneId = getState().sceneId;
    const scene = sceneId ? this.scene(sceneId) : undefined;
    const me = this.world?.actorTile(this.meId);
    if (!scene || !me) return;
    const occ = Object.values(getState().occupants);
    const free = seatSpots(o, scene).filter((s) => !occ.some((p) => p.memberId !== this.meId && p.sittingOn === o.id && p.x === s.x && p.y === s.y));
    if (!free.length) {
      toast('Someone’s already sitting there.', 'info', undefined, 2500);
      return;
    }
    const ref = prefer ?? me;
    free.sort((a, b) => Math.hypot(a.x - ref[0], a.y - ref[1]) - Math.hypot(b.x - ref[0], b.y - ref[1]));
    const spot = free[0];
    const sit = () => this.rt?.send({ t: 'sit', objectId: o.id, at: [spot.x, spot.y] });
    // already on this couch or bench: slide over to the cushion (the seat's tiles aren't walked on; the server
    // moves you along the seat and every screen glides you there)
    if (getState().occupants[this.meId]?.sittingOn === o.id) {
      this.shift = { seat: o.id, to: { x: spot.x, y: spot.y }, at: Date.now() };
      sit();
      return;
    }
    this.walkTo([spot.x, spot.y], sit);
  }

  /** The last shift along a couch or bench: which seat, to which cushion, when. */
  private shift: { seat: string; to: { x: number; y: number }; at: number } | null = null;

  /** Since when we've stood on a seat's tile without sitting (0: we haven't). */
  private onSeatSince = 0;

  /**
   * Never left standing in the furniture: on a seat's tile, not sitting and not walking, for a moment (a sit
   * the server refused or never got, someone taking the cushion first, a refused walk) — walk off it onto the
   * floor beside it, so every screen sees you step off.
   */
  private offSeatIfStanding() {
    const sceneId = getState().sceneId;
    const scene = sceneId ? this.scene(sceneId) : undefined;
    const grid = sceneId ? this.grid(sceneId) : undefined;
    const t = this.world?.actorTile(this.meId);
    const at = scene && t && !getState().occupants[this.meId]?.sittingOn && !this.world?.isMoving(this.meId) ? seatSpotAt(scene, t[0], t[1]) : null;
    if (!at || !grid) {
      this.onSeatSince = 0;
      return;
    }
    const now = Date.now();
    if (!this.onSeatSince) this.onSeatSince = now;
    if (now - this.onSeatSince < SIT_CONFIRM_MS) return;
    this.onSeatSince = 0;
    const off = stepOffTiles(at.spot).find(([x, y]) => grid.walkable(x, y)) ?? (() => {
      const n = grid.nearestWalkable(at.spot.x, at.spot.y, 2);
      return n ? ([n.x, n.y] as Tile) : undefined;
    })();
    if (off) this.walkTo(off);
  }

  private onObjectActivate(o: SceneObject) {
    const enter = o.actions?.find((a) => a.kind === 'enter');
    if (enter && enter.kind === 'enter') this.enterRoom(enter.roomId);
  }

  /* ------------------------------------------------------------------ social actions */

  /** Pin a note on a board (you need to be standing at it; the server checks). */
  postNote(objectId: string, text: string) {
    this.rt?.send({ t: 'note', objectId, text: text.slice(0, NOTE_MAX_CHARS) });
  }

  /** Take one of your notes down (an admin can take down anyone's). */
  removeNote(noteId: string) {
    this.rt?.send({ t: 'unnote', noteId });
  }

  /** Put down whatever you picked up. */
  putDown() {
    this.rt?.send({ t: 'carry', objectId: null });
  }

  emote(emote: EmoteId, targetId?: string) {
    const occ = getState().occupants;
    const t = targetId && occ[targetId] ? targetId : undefined;
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
    if (t) this.rt?.send({ t: 'say', text: t.slice(0, MAX_CHAT) });
  }

  setStatus(status: Exclude<PresenceStatus, 'offline'>, note?: string) {
    this.rt?.send({ t: 'status', status, note });
  }

  /** After "Sync my status to Slack" comes back: say so, once. */
  noteStatusGrant() {
    const q = new URLSearchParams(location.search);
    const status = q.get('status');
    const notice = q.get('notice');
    if (status !== 'slack' && notice !== 'slack_connect_declined') return;
    // tidy only our own params out of the address bar (a ?room= link alongside still counts)
    q.delete('status');
    q.delete('notice');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (status === 'slack') toast('Your Slack account is connected: what you say in a space is posted as you, and the status you set here mirrors to Slack.', 'info', undefined, 8000);
    else toast('No problem — you can connect your Slack account later from your profile (posts as you, status mirrored).', 'info', undefined, 8000);
  }

  /**
   * "Start a huddle with…": Slack can't start one for us, so this opens the right conversation in Slack (a DM, or a
   * group DM of the people picked) where the headphones button starts it. Slack drops you from the room's huddle
   * on its own, and the badges follow within a second.
   */
  async startHuddle(memberIds: string[]) {
    try {
      const r = await api<{ kind: 'dm' | 'group'; webUrl: string; appUrl: string }>('/slack/huddle', { method: 'POST', json: { memberIds } });
      openLink(r.webUrl);
      toast(r.kind === 'group' ? 'Opened a group DM in Slack — hit the headphones button there to start the huddle.' : 'Opened the DM in Slack — hit the headphones button there to start the huddle.', 'info', undefined, 7000);
    } catch (e) {
      toast((e as Error).message, 'info', undefined, 7000);
    }
  }

  /** Walk-up to a huddle we can't link into (a DM huddle): everyone on it hears you'd like in; any of them can invite you. */
  async askToJoinHuddle(memberId: string) {
    try {
      const r = await api<{ asked: number; names: string[] }>('/slack/huddle/ask', { method: 'POST', json: { memberId } });
      toast(r.asked ? `Asked ${r.names.join(' and ')} — they can invite you from Slack’s huddle window.` : 'Nobody’s on that call right now.', 'info', undefined, 6000);
    } catch (e) {
      toast((e as Error).message, 'info', undefined, 6000);
    }
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

  setDecorate(mode: { itemId: string | null; move?: boolean; moving?: string } | null) {
    setState({ decorate: mode, selection: null });
    const item = mode?.itemId ? decorItem(mode.itemId) : undefined;
    this.world?.setDecorMode(!mode ? null : item?.wall ? 'wall' : item ? 'floor' : 'pick');
    this.world?.setGhost(null);
    this.lastWallSpot = null;
  }

  /** The room as the piece being placed meets it: without itself while it's being moved. */
  private decorScene(sceneId: string) {
    const scene = this.scene(sceneId);
    const moving = getState().decorate?.moving;
    return scene && moving ? withoutDecoration(scene, moving) : scene;
  }

  private updateGhost(tile: Tile | null) {
    const dec = getState().decorate;
    const sceneId = getState().sceneId;
    const item = dec?.itemId ? decorItem(dec.itemId) : undefined;
    if (item?.wall) return; // wall pieces follow the wall under the pointer (updateWallGhost)
    if (!dec?.itemId || !tile || !sceneId || !this.world) {
      this.world?.setGhost(null);
      return;
    }
    const scene = this.decorScene(sceneId);
    const obj = decorObject({ id: 'ghost', roomId: sceneId, itemId: dec.itemId, x: tile[0], y: tile[1], placedBy: '', placedAt: '' });
    if (!scene || !obj) return;
    const occupied = new Set(Object.values(getState().occupants).map((o) => `${Math.round(o.x)},${Math.round(o.y)}`));
    this.world.setGhost({ obj, valid: !placementProblem(scene, tile[0], tile[1], occupied, obj, clientArt) });
  }

  /** The last point of a wall under the pointer (decorate mode, hanging a wall piece). */
  private lastWallSpot: WallSpot | null = null;

  /** Where a wall piece hangs with the pointer at `spot`: its span centred on the pointer, kept on the wall. */
  private wallSpotAt(item: DecorItem, spot: WallSpot, scene: SceneDef): number {
    const span = wallSpanOf(item);
    const len = spot.face === 'right' ? scene.width : scene.height;
    return Math.max(0, Math.min(len - span, Math.round(spot.u - span / 2)));
  }

  private updateWallGhost(spot: WallSpot | null) {
    this.lastWallSpot = spot;
    const dec = getState().decorate;
    const sceneId = getState().sceneId;
    const item = dec?.itemId ? decorItem(dec.itemId) : undefined;
    if (!item?.wall) return;
    const scene = sceneId ? this.decorScene(sceneId) : undefined;
    if (!spot || !scene || !this.world) {
      this.world?.setGhost(null);
      return;
    }
    const at = this.wallSpotAt(item, spot, scene);
    const obj = wallPiece(item, spot.face, at);
    if (obj) this.world.setGhost({ obj, valid: !wallPlacementProblem(scene, item, spot.face, at, clientArt) });
  }

  private onWallClick(spot: WallSpot) {
    const dec = getState().decorate;
    const sceneId = getState().sceneId;
    const item = dec?.itemId ? decorItem(dec.itemId) : undefined;
    const scene = sceneId ? this.decorScene(sceneId) : undefined;
    if (!item?.wall || !scene) return;
    const at = this.wallSpotAt(item, spot, scene);
    void this.placeDecoration(item.id, spot.face === 'right' ? [at, 0] : [0, at], spot.face);
  }

  /** Place a piece (on a floor tile, or on a wall with its span starting at x or y), or put down the one being moved. */
  async placeDecoration(itemId: string, t: Tile, wall?: WallFace) {
    const sceneId = getState().sceneId;
    if (!sceneId) return;
    const moving = getState().decorate?.moving;
    const name = decorItem(itemId)?.name.toLowerCase() ?? 'piece';
    const json = { itemId, x: t[0], y: t[1], ...(wall ? { wall } : {}) };
    try {
      if (moving) {
        await api(`/rooms/${sceneId}/decor/${moving}`, { method: 'PATCH', json });
        toast(`Moved the ${name} ✨`, 'celebrate', undefined, 2000);
        this.setDecorate({ itemId: null, move: true });
      } else {
        await api(`/rooms/${sceneId}/decor`, { method: 'POST', json });
        toast(`${wall ? 'Hung' : 'Placed'} ${name} ✨`, 'celebrate', undefined, 2000);
      }
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
      // (a piece picked up to move stays where it was)
      if (getState().decorate?.moving) this.setDecorate({ itemId: null, move: true });
      setState({ selection: null, panel: null });
      this.world?.setSelected(null);
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      if (!this.held.has(dir)) {
        this.held.add(dir);
        this.steer();
      }
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
  return ['available', 'open', 'meeting', 'focused', 'away', 'offline'].indexOf(s);
}

function pathKey(p: Tile[]) {
  return p.map((t) => t.join(',')).join(';');
}

export function daysSinceStart(iso: string): number {
  if (!iso) return 999;
  return Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000);
}

export const game = new Game();

// Dev-only handle for poking at the running world from the console or browser automation.
if (import.meta.env.DEV) (window as unknown as { __mw: Game }).__mw = game;
