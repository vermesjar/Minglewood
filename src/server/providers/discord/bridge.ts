/**
 * The Discord bridge: makes each space in the world *be* its Discord channels.
 *
 * - Chat, both ways. Saying something in a space posts it to the space's text channel under your name
 *   (through a Minglewood webhook, so it reads like you); messages posted in that channel appear in the
 *   space's conversation, and as a speech bubble over the author when they're standing there.
 * - History. Arriving in a space loads the channel's recent messages: Discord is the record, the world
 *   only mirrors it (nothing is stored here).
 * - Voice follows you. Discord never lets an app pull someone *into* voice, but once you're connected to
 *   any voice channel the bot can move you: walk into the café and you're in the café's voice channel.
 *   And the other way round: switch channels in Discord and your avatar walks into that space.
 * - Channels are Discord's: a rename relabels the space's binding, a deletion unbinds it.
 */
import { randomUUID } from 'node:crypto';
import { bindingSlot, type ChatEntry, type RoomBinding } from '@shared/domain/types';
import { MAX_CHAT } from '@shared/protocol';
import { TOWN_ID } from '@shared/world';
import type { OrgHub } from '../../realtime/orgHub';
import type { Store } from '../../store/store';
import type { VoiceStateChange } from '../types';
import { DiscordApiError, discordApi, type DiscordMessage } from './api';

type Api = Pick<
  typeof discordApi,
  'channelMessages' | 'channelWebhooks' | 'createWebhook' | 'executeWebhook' | 'sendMessage' | 'moveMember' | 'guildMember' | 'guild'
>;

/** How someone appears in a server: their nickname there (else display name), and their picture there. */
export interface DiscordLook {
  name: string;
  avatarUrl?: string;
}

export interface DiscordBridgeDeps {
  store: Store;
  token: () => string;
  /** The application (client) id: webhooks it created are ours. */
  applicationId: () => string;
  hubFor: (orgId: string) => OrgHub;
  orgForGuild: (guildId: string) => Promise<string | undefined>;
  api?: Api;
}

const key = (guildId: string, userId: string) => `${guildId}:${userId}`;

/** Webhook display names can't mention Discord or Clyde, and must be 1–80 characters. */
export function webhookName(name: string): string {
  const clean = name.replace(/discord/gi, 'd1scord').replace(/clyde/gi, 'clyd3').replace(/@(everyone|here)/gi, '$1').trim();
  return (clean || 'Minglewood member').slice(0, 80);
}

/** A Discord message as one readable line: mentions by name, custom emoji by name, attachments noted. */
export function renderContent(m: DiscordMessage): string {
  const names = new Map((m.mentions ?? []).map((u) => [u.id, u.member?.nick ?? u.global_name ?? u.username]));
  let text = (m.content ?? '')
    .replace(/<@!?(\d+)>/g, (_s, id: string) => `@${names.get(id) ?? 'someone'}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .trim();
  const extras = [
    ...(m.attachments ?? []).map((a) => `📎 ${a.filename}`),
    ...(m.sticker_items ?? []).map((s) => `🏷️ ${s.name}`),
  ];
  if (extras.length) text = [text, ...extras].filter(Boolean).join(' ');
  return text.slice(0, MAX_CHAT);
}

export class DiscordBridge {
  private readonly api: Api;
  /** channel id → our webhook there (null: we can't make one, post as the bot instead). */
  private hooks = new Map<string, { id: string; token: string } | null>();
  private ourHookIds = new Set<string>();
  /** Text channels whose history we've loaded (or are loading). */
  private loaded = new Set<string>();
  /** Where each person is connected to voice, per server. */
  private inVoice = new Map<string, string>();
  /** Moves we asked for, so the resulting voice update isn't mistaken for the person switching channels. */
  private expected = new Map<string, { channelId: string; until: number }>();
  private warned = new Set<string>();
  /** Everyone's current Discord name and picture per server, refreshed every few minutes. */
  private looks = new Map<string, { look: DiscordLook; until: number }>();
  /** Each server's AFK channel (or none), refreshed every few minutes. */
  private afk = new Map<string, { channelId: string | null; until: number }>();
  private attached = new WeakSet<OrgHub>();
  /** False when the bot doesn't have the Message Content intent: we see that messages happen, not what they say. */
  messageContent = true;
  botUserId: string | null = null;

  constructor(private readonly deps: DiscordBridgeDeps) {
    this.api = deps.api ?? discordApi;
  }

  /** Start listening to a company's world. Safe to call more than once. */
  attach(hub: OrgHub) {
    if (this.attached.has(hub)) return;
    this.attached.add(hub);
    hub.on('said', (memberId, text, sceneId) => void this.onSaid(hub, memberId, text, sceneId));
    hub.on('entered', (memberId, sceneId, via) => {
      if (via === 'live') void this.onEntered(hub, memberId, sceneId);
    });
    // Newly linked channels: bring their history into spaces people are already in.
    hub.on('bindings', () => {
      for (const sceneId of hub.activeScenes()) void this.loadHistory(hub, sceneId);
    });
  }

  /* ------------------------------------------------------------------ world → Discord */

  private discordBinding(orgId: string, sceneId: string, slot: 'voice' | 'text'): RoomBinding | undefined {
    const b = this.deps.store.bindingFor(orgId, sceneId, slot);
    return b?.provider === 'discord' ? b : undefined;
  }

  private async onSaid(hub: OrgHub, memberId: string, text: string, sceneId: string) {
    const binding = this.discordBinding(hub.orgId, sceneId, 'text');
    const member = hub.member(memberId);
    if (!binding || !member) return;
    const log = hub.chatLog(sceneId);
    let localId: string | undefined;
    for (let i = log.length - 1; i >= 0 && !localId; i--) if (log[i].memberId === memberId && log[i].text === text) localId = log[i].id;
    try {
      const hook = await this.hookFor(binding.externalChannelId);
      // Post looking exactly like them in this server: their nickname and picture there, fetched fresh.
      const look = (await this.lookOf(hub.orgId, memberId, binding.externalGuildId)) ?? { name: member.displayName, avatarUrl: this.avatarFor(hub.orgId, memberId) };
      const posted = hook
        ? await this.api.executeWebhook(hook, { content: text, username: webhookName(look.name), avatar_url: look.avatarUrl })
        : await this.api.sendMessage(this.deps.token(), binding.externalChannelId, `**${look.name}**: ${text}`);
      if (posted?.id && localId) hub.relabelChat(sceneId, localId, posted.id);
    } catch (e) {
      this.warnOnce(hub, memberId, `post:${binding.externalChannelId}`, e, `Couldn’t post to ${binding.label} — ask an admin to check Minglewood’s Discord permissions.`);
    }
  }

  /** Their nickname and picture in this server, from Discord (cached a few minutes). */
  async lookOf(orgId: string, memberId: string, guildId: string | undefined): Promise<DiscordLook | undefined> {
    const identity = this.deps.store.get(orgId).identities.find((i) => i.provider === 'discord' && i.memberId === memberId);
    if (!identity || !guildId) return undefined;
    const k = key(guildId, identity.externalId);
    const hit = this.looks.get(k);
    if (hit && hit.until > Date.now()) return hit.look;
    try {
      const gm = await this.api.guildMember(this.deps.token(), guildId, identity.externalId);
      const u = gm.user;
      const avatarUrl = gm.avatar
        ? `https://cdn.discordapp.com/guilds/${guildId}/users/${identity.externalId}/avatars/${gm.avatar}.png?size=128`
        : u?.avatar
          ? `https://cdn.discordapp.com/avatars/${identity.externalId}/${u.avatar}.png?size=128`
          : identity.avatarUrl;
      const look = { name: gm.nick ?? u?.global_name ?? u?.username ?? identity.username ?? 'Minglewood member', avatarUrl };
      this.looks.set(k, { look, until: Date.now() + 5 * 60_000 });
      return look;
    } catch {
      return undefined; // fall back to their Minglewood name and saved picture
    }
  }

  private avatarFor(orgId: string, memberId: string): string | undefined {
    return this.deps.store.get(orgId).identities.find((i) => i.provider === 'discord' && i.memberId === memberId)?.avatarUrl;
  }

  private async hookFor(channelId: string): Promise<{ id: string; token: string } | null> {
    if (this.hooks.has(channelId)) return this.hooks.get(channelId)!;
    const token = this.deps.token();
    try {
      const existing = (await this.api.channelWebhooks(token, channelId)).find(
        (w) => w.token && w.application_id && w.application_id === this.deps.applicationId(),
      );
      const hook = existing ?? (await this.api.createWebhook(token, channelId, 'Minglewood'));
      const ready = hook?.token ? { id: hook.id, token: hook.token } : null;
      if (ready) this.ourHookIds.add(ready.id);
      this.hooks.set(channelId, ready);
      return ready;
    } catch (e) {
      // No Manage Webhooks: fall back to posting as the bot ("**Name**: text").
      if (e instanceof DiscordApiError && (e.status === 403 || e.status === 50013)) {
        this.hooks.set(channelId, null);
        return null;
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------------ Discord → world */

  /** A message posted in a server channel (from the gateway). */
  async onMessage(guildId: string, m: DiscordMessage) {
    if (m.webhook_id && this.ourHookIds.has(m.webhook_id)) return; // our own echo
    if (this.botUserId && m.author.id === this.botUserId) return;
    const orgId = await this.deps.orgForGuild(guildId);
    if (!orgId || !this.deps.store.hasOrg(orgId)) return;
    const spaces = this.deps.store
      .get(orgId)
      .bindings.filter((b) => b.provider === 'discord' && bindingSlot(b.kind) === 'text' && b.externalChannelId === m.channel_id);
    if (!spaces.length) return;
    const hub = this.deps.hubFor(orgId);
    for (const b of spaces) {
      const entry = this.toEntry(orgId, b.roomId, m);
      hub.pushChat(entry);
      if (entry.memberId && hub.actor(entry.memberId)?.sceneId === b.roomId) hub.bubble(entry.memberId, entry.text.slice(0, 140));
    }
  }

  private toEntry(orgId: string, sceneId: string, m: DiscordMessage): ChatEntry {
    const d = this.deps.store.get(orgId);
    const identity = m.webhook_id ? undefined : d.identities.find((i) => i.provider === 'discord' && i.externalId === m.author.id);
    const member = identity ? d.members.get(identity.memberId) : undefined;
    // A webhook message from another app, or a person we don't know yet: show them as Discord does.
    const name = member?.displayName ?? m.member?.nick ?? m.author.global_name ?? m.author.username;
    const text = renderContent(m) || (this.messageContent ? '' : '💬 (a message in Discord)');
    return {
      id: m.id,
      sceneId,
      memberId: member?.id,
      name,
      avatarUrl: m.author.avatar ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64` : undefined,
      text: text || '(no text)',
      at: m.timestamp ?? new Date().toISOString(),
      source: 'discord',
    };
  }

  private async onEntered(hub: OrgHub, memberId: string, sceneId: string) {
    await Promise.all([this.loadHistory(hub, sceneId), this.followInto(hub, memberId, sceneId)]);
  }

  /** First visit to a bound space: pull the channel's recent history into the space. */
  async loadHistory(hub: OrgHub, sceneId: string) {
    const b = this.discordBinding(hub.orgId, sceneId, 'text');
    if (!b || this.loaded.has(b.externalChannelId)) return;
    this.loaded.add(b.externalChannelId);
    try {
      const msgs = await this.api.channelMessages(this.deps.token(), b.externalChannelId, 30);
      hub.seedChat(sceneId, msgs.reverse().map((m) => this.toEntry(hub.orgId, sceneId, m)));
    } catch (e) {
      this.loaded.delete(b.externalChannelId); // try again next time someone arrives
      console.warn(`[discord] history for ${b.label}:`, (e as Error).message);
    }
  }

  /* ------------------------------------------------------------------ voice follows you */

  /** Walked into a space: if you're in Discord voice, move you to that space's voice channel. */
  private async followInto(hub: OrgHub, memberId: string, sceneId: string) {
    const vb = this.discordBinding(hub.orgId, sceneId, 'voice');
    const member = hub.member(memberId);
    if (!member || member.settings.voiceFollow === false) return;
    const d = this.deps.store.get(hub.orgId);
    const identity = d.identities.find((i) => i.provider === 'discord' && i.memberId === memberId);
    if (!identity) return;
    if (!vb) {
      await this.leaveVoice(hub, memberId, identity.externalId, sceneId);
      return;
    }
    if (!vb.externalGuildId) return;
    const k = key(vb.externalGuildId, identity.externalId);
    const current = this.inVoice.get(k);
    if (!current || current === vb.externalChannelId) return;
    this.expected.set(k, { channelId: vb.externalChannelId, until: Date.now() + 10_000 });
    try {
      await this.api.moveMember(this.deps.token(), vb.externalGuildId, identity.externalId, vb.externalChannelId);
    } catch (e) {
      this.expected.delete(k);
      this.warnOnce(hub, memberId, `move:${vb.externalGuildId}`, e, `Couldn’t move you into ${vb.label} — Minglewood needs the “Move Members” permission in Discord.`);
    }
  }

  /**
   * Walked into a space with no voice channel (the Quiet Grove, or a room nobody linked): you're no longer in
   * the call you came from. If the server has an AFK channel we park you there — connected but silent — so the
   * next space with a voice channel can move you straight back in; otherwise you're disconnected. People in a
   * voice channel that isn't one of the spaces' (a gaming channel, a meeting) are left alone.
   */
  private async leaveVoice(hub: OrgHub, memberId: string, userId: string, sceneId: string) {
    const d = this.deps.store.get(hub.orgId);
    const guildId = d.connections.find((c) => c.provider === 'discord' && c.status === 'active')?.externalWorkspaceId;
    if (!guildId) return;
    const k = key(guildId, userId);
    const current = this.inVoice.get(k);
    const fromSpace = current && d.bindings.some((b) => b.provider === 'discord' && bindingSlot(b.kind) === 'voice' && b.externalChannelId === current);
    if (!current || !fromSpace) return;
    const park = await this.afkChannel(guildId);
    const target = park && park !== current ? park : null;
    this.expected.set(k, { channelId: target ?? '', until: Date.now() + 10_000 });
    try {
      await this.api.moveMember(this.deps.token(), guildId, userId, target);
      const room = d.rooms.find((r) => r.id === sceneId);
      hub.notify(
        memberId,
        target
          ? `🤫 ${room?.name ?? 'This space'} has no voice channel — you’re parked in the AFK channel (silent) until you walk somewhere with one.`
          : `🤫 ${room?.name ?? 'This space'} has no voice channel — you’ve left voice. Use “Join voice” when you head somewhere else.`,
      );
    } catch (e) {
      this.expected.delete(k);
      this.warnOnce(hub, memberId, `leave:${guildId}`, e, 'Couldn’t take you out of voice — Minglewood needs the “Move Members” permission in Discord.');
    }
  }

  private async afkChannel(guildId: string): Promise<string | null> {
    const hit = this.afk.get(guildId);
    if (hit && hit.until > Date.now()) return hit.channelId;
    try {
      const g = await this.api.guild(this.deps.token(), guildId);
      const channelId = g.afk_channel_id ?? null;
      this.afk.set(guildId, { channelId, until: Date.now() + 5 * 60_000 });
      return channelId;
    } catch {
      return null;
    }
  }

  /** A voice state change from the gateway (called alongside the presence sync). */
  onVoice(guildId: string, change: VoiceStateChange, orgId: string | undefined) {
    const k = key(guildId, change.externalUserId);
    if (change.channelId) this.inVoice.set(k, change.channelId);
    else this.inVoice.delete(k);
    const exp = this.expected.get(k);
    if (exp && exp.until > Date.now() && exp.channelId === (change.channelId ?? '')) {
      this.expected.delete(k);
      return; // the move we asked for
    }
    if (!orgId || !change.channelId || !this.deps.store.hasOrg(orgId)) return;
    // They switched channels in Discord themselves: walk their avatar into that space.
    const d = this.deps.store.get(orgId);
    const identity = d.identities.find((i) => i.provider === 'discord' && i.externalId === change.externalUserId);
    const binding = d.bindings.find((b) => b.provider === 'discord' && bindingSlot(b.kind) === 'voice' && b.externalChannelId === change.channelId);
    if (!identity || !binding) return;
    const member = d.members.get(identity.memberId);
    const hub = this.deps.hubFor(orgId);
    const actor = hub.actor(identity.memberId);
    if (!member || member.settings.voiceFollow === false || actor?.via !== 'live' || actor.sceneId === binding.roomId) return;
    hub.enter(identity.memberId, binding.roomId, 'live');
    const place = binding.roomId === TOWN_ID ? 'town' : (d.rooms.find((r) => r.id === binding.roomId)?.name ?? 'the room');
    hub.notify(identity.memberId, `🎧 You switched to ${binding.label} in Discord — walked you over to ${place}.`);
  }

  /** Is this person connected to voice in this server right now (as far as the gateway has told us)? */
  voiceChannelOf(guildId: string, userId: string): string | undefined {
    return this.inVoice.get(key(guildId, userId));
  }

  /* ------------------------------------------------------------------ channels are Discord's */

  onChannel(orgId: string, channel: { id: string; name?: string; deleted: boolean }) {
    const d = this.deps.store.get(orgId);
    for (const b of d.bindings.filter((x) => x.provider === 'discord' && x.externalChannelId === channel.id)) {
      if (channel.deleted) this.deps.store.setBinding(orgId, null, b.roomId, bindingSlot(b.kind));
      else if (channel.name) this.deps.store.relabelBinding(orgId, b.id, bindingSlot(b.kind) === 'text' ? `#${channel.name}` : `🔊 ${channel.name}`);
    }
    this.hooks.delete(channel.id);
    this.loaded.delete(channel.id);
  }

  private warnOnce(hub: OrgHub, memberId: string, what: string, e: unknown, text: string) {
    console.warn(`[discord] ${what}:`, (e as Error).message);
    if (this.warned.has(what)) return;
    this.warned.add(what);
    hub.notify(memberId, text);
    setTimeout(() => this.warned.delete(what), 5 * 60_000);
  }

  /** Test hook: pretend we already know where someone is in voice. */
  setVoice(guildId: string, userId: string, channelId: string | null) {
    if (channelId) this.inVoice.set(key(guildId, userId), channelId);
    else this.inVoice.delete(key(guildId, userId));
  }

  static newId = () => randomUUID();
}
