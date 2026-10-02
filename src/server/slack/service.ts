/**
 * Slack for every company world on this server: routes each verified event to its company (by workspace),
 * keeps huddle and status presence in sync, mirrors channel chat into spaces (and back, through the bridge),
 * answers /minglewood, previews links, relays knocks as DMs for people who opted in, and posts the optional
 * daily note.
 */
import type { ProviderConnection } from '@shared/domain/types';
import { ORG_ID } from '@shared/seed/northstar';
import { config, slackConfigured } from '../config';
import type { NewSlackTenant } from '../cloud/controlPlane';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import type { SlackMessage, SlackUser } from './api';
import type { SlackBridge } from './bridge';
import { SlackCommands, type CommandReply } from './commands';
import { dailyNote, knockDm, unfurlFor } from './messages';
import { SlackPresence, type HuddleRoom } from './presence';
import type { SlackProvider } from './provider';

/** The parts of a Slack event we read (https://api.slack.com/events). */
export interface SlackEvent extends Partial<Omit<SlackMessage, 'channel' | 'user' | 'ts'>> {
  type: string;
  subtype?: string;
  user?: string | SlackUser;
  /** A channel id — or, on channel_rename / group_rename, the channel itself. */
  channel?: string | { id: string; name?: string };
  ts?: string;
  message_ts?: string;
  unfurl_id?: string;
  source?: string;
  links?: Array<{ url: string; domain?: string }>;
  room?: HuddleRoom;
  message?: { subtype?: string; room?: HuddleRoom };
  dnd_status?: { dnd_enabled?: boolean; snooze_enabled?: boolean; next_dnd_start_ts?: number; next_dnd_end_ts?: number };
}

/** Minglewood Cloud's view of Slack installs (when the server runs with the control plane). */
export interface SlackTenants {
  forSlackTeam(teamId: string): Promise<string | undefined>;
  createForSlack(t: NewSlackTenant): Promise<string>;
}

export class SlackService {
  private presence = new Map<string, SlackPresence>();
  private relays = new Set<string>();
  /** org → the date (YYYY-MM-DD, org time) its daily note last went out. */
  private dailyPosted = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: Store,
    private readonly ensureHub: (orgId: string) => OrgHub,
    readonly provider: SlackProvider,
    /** Chat both ways, history, channel renames (present whenever Slack is wired up). */
    readonly bridge: SlackBridge,
    private readonly tenants: SlackTenants | null = null,
  ) {}

  /** The company world a workspace belongs to: its installed connection, or SLACK_TEAM_ID for the demo. */
  orgForTeam(teamId: string): string | undefined {
    const connected = this.store.orgForWorkspace('slack', teamId);
    if (connected) return connected;
    if (config.slack.teamId && config.slack.teamId === teamId && this.store.hasOrg(ORG_ID)) return ORG_ID;
    return undefined;
  }

  /** Like orgForTeam, also asking Minglewood Cloud about workspaces that installed through it. */
  async resolveOrg(teamId: string): Promise<string | undefined> {
    const local = this.orgForTeam(teamId);
    if (local) return local;
    return this.tenants?.forSlackTeam(teamId).catch((e) => {
      console.warn('[cloud] slack team lookup failed:', (e as Error).message);
      return undefined;
    });
  }

  /** A new company from an Add-to-Slack install (through Minglewood Cloud). */
  createCompany(t: NewSlackTenant): Promise<string> {
    if (!this.tenants) return Promise.reject(new Error('no control plane'));
    return this.tenants.createForSlack(t);
  }

  /**
   * Can someone add Minglewood to a workspace without signing in first? Yes when the install can create a company
   * (Minglewood Cloud) or connect the one workspace this server was set up for (SLACK_TEAM_ID).
   */
  addUrl(): string | null {
    if (!slackConfigured() || !(this.tenants || config.slack.teamId)) return null;
    return `${config.publicUrl.replace(/\/$/, '')}/api/slack/add`;
  }

  connection(orgId: string): ProviderConnection | undefined {
    return this.store.get(orgId).connections.find((c) => c.provider === 'slack' && c.status === 'active');
  }

  teamFor(orgId: string): string | undefined {
    return this.connection(orgId)?.externalWorkspaceId ?? (orgId === ORG_ID && config.slack.teamId ? config.slack.teamId : undefined);
  }

  private presenceFor(orgId: string): SlackPresence {
    let p = this.presence.get(orgId);
    if (!p) {
      p = new SlackPresence(this.ensureHub(orgId), this.store);
      this.presence.set(orgId, p);
    }
    this.relayKnocks(orgId);
    return p;
  }

  /* ------------------------------------------------------------------ events */

  async onEvent(teamId: string, ev: SlackEvent): Promise<void> {
    if (ev.type === 'app_uninstalled' || ev.type === 'tokens_revoked') return this.disconnect(teamId);
    const orgId = await this.resolveOrg(teamId);
    if (!orgId) return;
    const presence = this.presenceFor(orgId);
    const channelId = typeof ev.channel === 'string' ? ev.channel : ev.channel?.id;
    switch (ev.type) {
      case 'user_change':
        if (typeof ev.user === 'object') presence.userStatus(ev.user);
        return;
      case 'user_huddle_changed':
        if (typeof ev.user === 'object') presence.userHuddle(ev.user.id, ev.user.profile?.huddle_state, ev.user.profile?.huddle_state_call_id);
        return;
      case 'dnd_updated_user':
        if (typeof ev.user === 'string' && ev.dnd_status) presence.dnd(ev.user, ev.dnd_status);
        return;
      case 'message':
        if (ev.subtype === 'huddle_thread' && ev.room && channelId) presence.huddleRoom(channelId, ev.room);
        else if (ev.subtype === 'message_changed' && ev.message?.subtype === 'huddle_thread' && ev.message.room && channelId)
          presence.huddleRoom(channelId, ev.message.room);
        else if (channelId && ev.ts && typeof ev.user !== 'object') await this.bridge.onMessage(orgId, { ...ev, user: ev.user, channel: channelId, ts: ev.ts });
        return;
      case 'channel_rename':
      case 'group_rename':
        if (typeof ev.channel === 'object') this.bridge.onChannel(orgId, { id: ev.channel.id, name: ev.channel.name, gone: false });
        return;
      case 'channel_archive':
      case 'channel_deleted':
      case 'group_archive':
      case 'group_deleted':
        if (channelId) this.bridge.onChannel(orgId, { id: channelId, gone: true });
        return;
      case 'member_joined_channel':
        if (channelId && typeof ev.user === 'string' && (await this.bridge.isBot(teamId, ev.user))) this.bridge.onMembership(orgId, channelId);
        return;
      case 'channel_left':
      case 'group_left':
        if (channelId) this.bridge.onMembership(orgId, channelId);
        return;
      case 'link_shared':
        return this.unfurl(orgId, teamId, ev);
    }
  }

  private async unfurl(orgId: string, teamId: string, ev: SlackEvent) {
    const token = this.provider.tokens.forTeam(teamId);
    if (!token || !ev.links?.length) return;
    const hub = this.ensureHub(orgId);
    const unfurls: Record<string, unknown> = {};
    for (const l of ev.links) {
      const u = unfurlFor(hub, this.store, l.url);
      if (u) unfurls[l.url] = u;
    }
    if (!Object.keys(unfurls).length) return;
    const channel = typeof ev.channel === 'string' ? ev.channel : '';
    const target = ev.unfurl_id && ev.source ? { unfurl_id: ev.unfurl_id, source: ev.source } : { channel, ts: ev.message_ts ?? '' };
    await this.provider.api.unfurl(token, target, unfurls).catch((e) => console.warn('[slack] unfurl failed:', (e as Error).message));
  }

  private disconnect(teamId: string) {
    const orgId = this.store.orgForWorkspace('slack', teamId);
    const conn = orgId ? this.connection(orgId) : undefined;
    this.provider.tokens.clear(teamId);
    if (!orgId || !conn) return;
    this.store.setConnection(orgId, { ...conn, status: 'disconnected' });
    this.store.audit(orgId, conn.connectedBy, 'slack.disconnected', teamId, 'the app was uninstalled from Slack');
  }

  /* ------------------------------------------------------------------ /minglewood */

  async command(teamId: string, slackUserId: string, text: string): Promise<CommandReply> {
    const orgId = await this.resolveOrg(teamId);
    if (!orgId) return { response_type: 'ephemeral', text: 'Minglewood isn’t connected to this workspace yet — an admin can add it from the Minglewood admin console.' };
    const hub = this.ensureHub(orgId);
    this.presenceFor(orgId);
    const id = this.store.identity(orgId, 'slack', slackUserId);
    const caller = id ? this.store.member(orgId, id.memberId) : undefined;
    return new SlackCommands(hub, this.store).handle(text, caller);
  }

  /* ------------------------------------------------------------------ knocks → DMs */

  /** Knocks for people who aren't in the world reach them as a Slack DM, if they've turned that on. */
  private relayKnocks(orgId: string) {
    if (this.relays.has(orgId)) return;
    this.relays.add(orgId);
    const hub = this.ensureHub(orgId);
    hub.on('missedKnock', (k) => {
      void (async () => {
        const target = this.store.member(orgId, k.targetId);
        const from = this.store.member(orgId, k.fromId);
        const id = this.store.get(orgId).identities.find((i) => i.provider === 'slack' && i.memberId === k.targetId);
        const token = this.provider.tokens.forTeam(this.teamFor(orgId));
        if (!target?.settings.slackKnockDms || !from || !id || !token) return;
        const dm = await this.provider.api.openDm(token, id.externalId);
        const msg = knockDm(from, k.kind);
        await this.provider.api.postMessage(token, dm, msg.text, msg.blocks);
      })().catch((e) => console.warn('[slack] knock DM failed:', (e as Error).message));
    });
  }

  /** Make sure every connected company relays knocks from the start (not only after its first Slack event). */
  watch(orgIds: string[]) {
    for (const orgId of orgIds) if (this.teamFor(orgId)) this.relayKnocks(orgId);
  }

  /* ------------------------------------------------------------------ the daily note */

  /** Posts each company's daily note once, at its chosen hour (in the org's timezone). */
  async postDailyNotes(now = new Date()) {
    for (const orgId of this.store.orgIds()) {
      const conn = this.connection(orgId);
      const channel = conn?.settings?.dailyChannelId;
      if (!conn || !channel) continue;
      const tz = this.store.get(orgId).org.timezone || 'UTC';
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const day = `${get('year')}-${get('month')}-${get('day')}`;
      if (Number(get('hour')) !== (conn.settings?.dailyHour ?? 9) || this.dailyPosted.get(orgId) === day) continue;
      const token = this.provider.tokens.forTeam(conn.externalWorkspaceId);
      if (!token) continue;
      this.dailyPosted.set(orgId, day);
      const note = dailyNote(this.ensureHub(orgId), this.store, now);
      await this.provider.api.postMessage(token, channel, note.text, note.blocks).catch((e) => console.warn('[slack] daily note failed:', (e as Error).message));
    }
  }

  start() {
    if (this.timer) return;
    this.watch(this.store.orgIds());
    this.timer = setInterval(() => void this.postDailyNotes(), 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
