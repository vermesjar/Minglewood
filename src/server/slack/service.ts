/**
 * Slack for every company world on this server: routes each verified event to its company (by workspace),
 * keeps huddle and status presence in sync, answers /minglewood, previews links, relays knocks as DMs for
 * people who opted in, and posts the optional daily note.
 */
import type { ProviderConnection } from '@shared/domain/types';
import { ORG_ID } from '@shared/seed/northstar';
import { config } from '../config';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import type { SlackUser } from './api';
import { SlackCommands, type CommandReply } from './commands';
import { dailyNote, knockDm, unfurlFor } from './messages';
import { SlackPresence, type HuddleRoom } from './presence';
import type { SlackProvider } from './provider';

/** The parts of a Slack event we read (https://api.slack.com/events). */
export interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string | SlackUser;
  channel?: string;
  ts?: string;
  message_ts?: string;
  unfurl_id?: string;
  source?: string;
  links?: Array<{ url: string; domain?: string }>;
  room?: HuddleRoom;
  message?: { subtype?: string; room?: HuddleRoom };
  dnd_status?: { dnd_enabled?: boolean; snooze_enabled?: boolean; next_dnd_start_ts?: number; next_dnd_end_ts?: number };
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
  ) {}

  /** The company world a workspace belongs to: its installed connection, or SLACK_TEAM_ID for the demo. */
  orgForTeam(teamId: string): string | undefined {
    const connected = this.store.orgForWorkspace('slack', teamId);
    if (connected) return connected;
    if (config.slack.teamId && config.slack.teamId === teamId && this.store.hasOrg(ORG_ID)) return ORG_ID;
    return undefined;
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
    const orgId = this.orgForTeam(teamId);
    if (!orgId) return;
    const presence = this.presenceFor(orgId);
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
        if (ev.subtype === 'huddle_thread' && ev.room && ev.channel) presence.huddleRoom(ev.channel, ev.room);
        else if (ev.subtype === 'message_changed' && ev.message?.subtype === 'huddle_thread' && ev.message.room && ev.channel)
          presence.huddleRoom(ev.channel, ev.message.room);
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
    const target = ev.unfurl_id && ev.source ? { unfurl_id: ev.unfurl_id, source: ev.source } : { channel: ev.channel ?? '', ts: ev.message_ts ?? '' };
    await this.provider.api.unfurl(token, target, unfurls).catch((e) => console.warn('[slack] unfurl failed:', (e as Error).message));
  }

  private disconnect(teamId: string) {
    const orgId = this.store.orgForWorkspace('slack', teamId);
    const conn = orgId ? this.connection(orgId) : undefined;
    if (!orgId || !conn) return;
    this.store.setConnection(orgId, { ...conn, status: 'disconnected' });
    this.store.audit(orgId, conn.connectedBy, 'slack.disconnected', teamId, 'the app was uninstalled from Slack');
  }

  /* ------------------------------------------------------------------ /minglewood */

  command(teamId: string, slackUserId: string, text: string): CommandReply {
    const orgId = this.orgForTeam(teamId);
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
