/**
 * The Slack bridge: makes each space in the world *be* its Slack channel, the way the Discord bridge does.
 *
 * - Chat, both ways. Saying something in a space posts it to the space's channel under your name and picture
 *   (chat:write.customize; Slack still marks it as from the app). Messages posted in that channel appear in the
 *   space's conversation, and as a speech bubble over the author when they're standing there.
 * - History. Arriving in a space loads the channel's recent messages: Slack is the record, the world only mirrors
 *   it (nothing is stored here).
 * - Channels are Slack's: a rename relabels the space's binding; an archive or deletion unbinds it.
 * - The app has to *be in* a channel to hear it. Public channels are joined on demand (channels:join); private ones
 *   need `/invite @Minglewood`, and the admin console says which.
 *
 * What Slack doesn't offer (and we don't fake): moving someone between huddles. Walking into a space can't pull
 * you into its huddle; the chat panel shows a one-click "Switch to the huddle in #…" instead. The other direction
 * works: joining a huddle in Slack walks your avatar into that space (see presence.ts).
 */
import { bindingSlot, type ChatEntry, type RoomBinding } from '@shared/domain/types';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import { SlackApiError, type SlackApi, type SlackMessage } from './api';
import { isConversation, renderSlackText, slackMessageId, slackTime } from './render';
import type { SlackTokens } from './tokens';

type Api = Pick<SlackApi, 'postMessage' | 'usersInfo' | 'conversationsHistory' | 'conversationsInfo' | 'conversationsJoin' | 'authTest'>;

/** How someone appears in a workspace: their display name there, and their picture there. */
export interface SlackLook {
  name: string;
  avatarUrl?: string;
}

export interface SlackBridgeDeps {
  store: Store;
  api: Api;
  tokens: SlackTokens;
  hubFor: (orgId: string) => OrgHub;
  /** The workspace a company's spaces bind to. */
  teamFor: (orgId: string) => string | undefined;
}

export type InChannel = 'member' | 'joined' | 'private' | 'failed';

const key = (teamId: string, id: string) => `${teamId}:${id}`;
const FIVE_MINUTES = 5 * 60_000;

export class SlackBridge {
  /** Everyone's current Slack name and picture per workspace, refreshed every few minutes (unknowns cached too). */
  private looks = new Map<string, { look: SlackLook | undefined; until: number }>();
  /** The bot user per workspace (auth.test), so its own posts aren't mirrored back. */
  private bots = new Map<string, Promise<{ userId: string; botId?: string }>>();
  /** Workspaces where posting under a person's name failed for lack of chat:write.customize. */
  private noCustomize = new Set<string>();
  /** Channels whose history we've loaded (or are loading). */
  private loaded = new Set<string>();
  /** Posts in flight, so the echo Slack sends back isn't shown twice if it beats our response. */
  private pending = new Set<string>();
  private warned = new Set<string>();
  private attached = new WeakSet<OrgHub>();

  constructor(private readonly deps: SlackBridgeDeps) {}

  /** Start listening to a company's world. Safe to call more than once. */
  attach(hub: OrgHub) {
    if (this.attached.has(hub)) return;
    this.attached.add(hub);
    hub.on('said', (memberId, text, sceneId) => void this.onSaid(hub, memberId, text, sceneId));
    hub.on('entered', (_memberId, sceneId, via) => {
      if (via === 'live') void this.loadHistory(hub, sceneId);
    });
    // Newly linked channels: bring their history into spaces people are already in.
    hub.on('bindings', () => {
      for (const sceneId of hub.activeScenes()) void this.loadHistory(hub, sceneId);
    });
  }

  private slackBinding(orgId: string, sceneId: string, slot: 'voice' | 'text'): RoomBinding | undefined {
    const b = this.deps.store.bindingFor(orgId, sceneId, slot);
    return b?.provider === 'slack' ? b : undefined;
  }

  private token(orgId: string): { teamId: string; token: string } | undefined {
    const teamId = this.deps.teamFor(orgId);
    const token = teamId ? this.deps.tokens.forTeam(teamId) : '';
    return teamId && token ? { teamId, token } : undefined;
  }

  /* ------------------------------------------------------------------ world → Slack */

  private async onSaid(hub: OrgHub, memberId: string, text: string, sceneId: string): Promise<void> {
    const binding = this.slackBinding(hub.orgId, sceneId, 'text');
    const member = hub.member(memberId);
    const auth = this.token(hub.orgId);
    if (!binding || !member || !auth) return;
    const log = hub.chatLog(sceneId);
    let localId: string | undefined;
    for (let i = log.length - 1; i >= 0 && !localId; i--) if (log[i].memberId === memberId && log[i].text === text) localId = log[i].id;
    const channel = binding.externalChannelId;
    const pendingKey = `${channel}|${text}`;
    this.pending.add(pendingKey);
    setTimeout(() => this.pending.delete(pendingKey), 15_000);
    try {
      const identity = this.deps.store.get(hub.orgId).identities.find((i) => i.provider === 'slack' && i.memberId === memberId);
      const look = (identity && (await this.lookOf(auth.teamId, identity.externalId))) ?? { name: member.displayName, avatarUrl: identity?.avatarUrl };
      const posted = await this.post(auth, channel, text, look);
      if (posted?.ts && localId) hub.relabelChat(sceneId, localId, slackMessageId(channel, posted.ts));
    } catch (e) {
      this.pending.delete(pendingKey);
      if (e instanceof SlackApiError && e.error === 'not_in_channel') {
        const state = await this.ensureInChannel(hub.orgId, channel);
        if (state === 'joined') return this.onSaid(hub, memberId, text, sceneId);
        this.warnOnce(hub, memberId, `post:${channel}`, e, `Couldn’t post to ${binding.label} — ask an admin to invite the Minglewood app to that channel (/invite @Minglewood).`);
        return;
      }
      this.warnOnce(hub, memberId, `post:${channel}`, e, `Couldn’t post to ${binding.label} — ask an admin to check Minglewood’s Slack permissions.`);
    }
  }

  /** Post as the person (name + picture); without chat:write.customize, as the app with their name in bold. */
  private async post(auth: { teamId: string; token: string }, channel: string, text: string, look: SlackLook) {
    if (!this.noCustomize.has(auth.teamId)) {
      try {
        return await this.deps.api.postMessage(auth.token, channel, text, undefined, { username: look.name.slice(0, 80), iconUrl: look.avatarUrl });
      } catch (e) {
        if (!(e instanceof SlackApiError) || e.error !== 'missing_scope') throw e;
        this.noCustomize.add(auth.teamId);
        console.warn('[slack] chat:write.customize is missing — posting as the app instead of under people’s names');
      }
    }
    return this.deps.api.postMessage(auth.token, channel, `*${look.name}*: ${text}`);
  }

  /** Their display name and picture in this workspace (cached a few minutes; unknown people too). */
  async lookOf(teamId: string, userId: string): Promise<SlackLook | undefined> {
    const k = key(teamId, userId);
    const hit = this.looks.get(k);
    if (hit && hit.until > Date.now()) return hit.look;
    const token = this.deps.tokens.forTeam(teamId);
    let look: SlackLook | undefined;
    if (token) {
      try {
        const u = await this.deps.api.usersInfo(token, userId);
        const name = u.profile?.display_name || u.real_name || u.name;
        look = name ? { name, avatarUrl: u.profile?.image_192 || u.profile?.image_72 } : undefined;
      } catch {
        look = undefined;
      }
    }
    this.looks.set(k, { look, until: Date.now() + FIVE_MINUTES });
    return look;
  }

  /** The bot's own user id in a workspace (so its posts aren't mirrored back as someone else's). */
  private bot(teamId: string) {
    let p = this.bots.get(teamId);
    if (!p) {
      const token = this.deps.tokens.forTeam(teamId);
      p = token
        ? this.deps.api.authTest(token).then(
            (a) => ({ userId: a.user_id, botId: a.bot_id }),
            () => {
              this.bots.delete(teamId); // ask again next time
              return { userId: '' };
            },
          )
        : Promise.resolve({ userId: '' });
      this.bots.set(teamId, p);
    }
    return p;
  }

  /** Is this Slack user our app's bot user in that workspace? */
  async isBot(teamId: string, userId: string): Promise<boolean> {
    const bot = await this.bot(teamId);
    return !!bot.userId && bot.userId === userId;
  }

  /* ------------------------------------------------------------------ Slack → world */

  /** A message posted in a channel (from the Events API). */
  async onMessage(orgId: string, m: SlackMessage & { channel: string }) {
    if (!isConversation(m) || !this.deps.store.hasOrg(orgId)) return;
    const auth = this.token(orgId);
    if (!auth) return;
    if (this.pending.has(`${m.channel}|${m.text ?? ''}`)) return; // our own post, echoed before we heard back
    const bot = await this.bot(auth.teamId);
    if (m.bot_id && ((bot.botId && m.bot_id === bot.botId) || (m.user && m.user === bot.userId))) return; // our own echo
    const spaces = this.deps.store.get(orgId).bindings.filter((b) => b.provider === 'slack' && bindingSlot(b.kind) === 'text' && b.externalChannelId === m.channel);
    if (!spaces.length) return;
    const hub = this.deps.hubFor(orgId);
    for (const b of spaces) {
      const entry = await this.toEntry(orgId, auth.teamId, b.roomId, m.channel, m);
      hub.pushChat(entry);
      if (entry.memberId && hub.actor(entry.memberId)?.sceneId === b.roomId) hub.bubble(entry.memberId, entry.text.slice(0, 140));
    }
  }

  private async toEntry(orgId: string, teamId: string, sceneId: string, channel: string, m: SlackMessage): Promise<ChatEntry> {
    const d = this.deps.store.get(orgId);
    const identity = m.user && !m.bot_id ? d.identities.find((i) => i.provider === 'slack' && i.externalId === m.user) : undefined;
    const member = identity ? d.members.get(identity.memberId) : undefined;
    // Names for the author and anyone mentioned, from Slack (cached).
    const mentioned = [...(m.text ?? '').matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((x) => x[1]);
    const ids = [...new Set([...(m.user && !member ? [m.user] : []), ...mentioned])];
    const looks = new Map(await Promise.all(ids.map(async (id) => [id, await this.lookOf(teamId, id)] as const)));
    const nameOf = (id: string) => {
      const own = d.identities.find((i) => i.provider === 'slack' && i.externalId === id);
      return (own && d.members.get(own.memberId)?.displayName) || looks.get(id)?.name;
    };
    const author = m.user ? looks.get(m.user) : undefined;
    const name = member?.displayName ?? (m.bot_id ? m.username || m.bot_profile?.name : undefined) ?? author?.name ?? 'Someone in Slack';
    const text = renderSlackText(m, nameOf);
    return {
      id: slackMessageId(channel, m.ts),
      sceneId,
      memberId: member?.id,
      name,
      avatarUrl: author?.avatarUrl ?? m.bot_profile?.icons?.image_72,
      text: text || '(no text)',
      at: slackTime(m.ts),
      source: 'slack',
    };
  }

  /** First visit to a bound space: pull the channel's recent history into the space. */
  async loadHistory(hub: OrgHub, sceneId: string) {
    const b = this.slackBinding(hub.orgId, sceneId, 'text');
    const auth = this.token(hub.orgId);
    if (!b || !auth || this.loaded.has(b.externalChannelId)) return;
    this.loaded.add(b.externalChannelId);
    try {
      let msgs: SlackMessage[];
      try {
        msgs = await this.deps.api.conversationsHistory(auth.token, b.externalChannelId, 30);
      } catch (e) {
        if (!(e instanceof SlackApiError) || e.error !== 'not_in_channel' || (await this.ensureInChannel(hub.orgId, b.externalChannelId)) !== 'joined') throw e;
        msgs = await this.deps.api.conversationsHistory(auth.token, b.externalChannelId, 30);
      }
      const bot = await this.bot(auth.teamId);
      const lines = msgs.filter((m) => isConversation(m) && !(m.bot_id && ((bot.botId && m.bot_id === bot.botId) || m.user === bot.userId) && !m.username)).reverse();
      const entries = await Promise.all(lines.map((m) => this.toEntry(hub.orgId, auth.teamId, sceneId, b.externalChannelId, m)));
      hub.seedChat(sceneId, entries);
    } catch (e) {
      this.loaded.delete(b.externalChannelId); // try again next time someone arrives
      console.warn(`[slack] history for ${b.label}:`, (e as Error).message);
    }
  }

  /* ------------------------------------------------------------------ being in the channel */

  /** Make sure the app is in a bound channel: joins public ones; private ones need an /invite. */
  async ensureInChannel(orgId: string, channelId: string): Promise<InChannel> {
    const auth = this.token(orgId);
    if (!auth) return 'failed';
    try {
      const info = await this.deps.api.conversationsInfo(auth.token, channelId);
      if (info.is_member) return 'member';
      if (info.is_private) return 'private';
      await this.deps.api.conversationsJoin(auth.token, channelId);
      this.loaded.delete(channelId);
      return 'joined';
    } catch (e) {
      console.warn(`[slack] joining ${channelId}:`, (e as Error).message);
      return 'failed';
    }
  }

  /** The app was added to (or removed from) a channel: its history is worth loading again. */
  onMembership(orgId: string, channelId: string) {
    this.loaded.delete(channelId);
    if (!this.deps.store.hasOrg(orgId)) return;
    const hub = this.deps.hubFor(orgId);
    for (const sceneId of hub.activeScenes()) void this.loadHistory(hub, sceneId);
  }

  /* ------------------------------------------------------------------ channels are Slack's */

  onChannel(orgId: string, channel: { id: string; name?: string; gone: boolean }) {
    const d = this.deps.store.get(orgId);
    for (const b of d.bindings.filter((x) => x.provider === 'slack' && x.externalChannelId === channel.id)) {
      if (channel.gone) this.deps.store.setBinding(orgId, null, b.roomId, bindingSlot(b.kind));
      else if (channel.name) this.deps.store.relabelBinding(orgId, b.id, bindingSlot(b.kind) === 'text' ? `#${channel.name}` : `🎧 #${channel.name}`);
    }
    this.loaded.delete(channel.id);
    if (this.deps.store.hasOrg(orgId)) this.deps.hubFor(orgId).bindingsChanged();
  }

  private warnOnce(hub: OrgHub, memberId: string, what: string, e: unknown, text: string) {
    console.warn(`[slack] ${what}:`, (e as Error).message);
    if (this.warned.has(what)) return;
    this.warned.add(what);
    hub.notify(memberId, text);
    setTimeout(() => this.warned.delete(what), FIVE_MINUTES);
  }
}
