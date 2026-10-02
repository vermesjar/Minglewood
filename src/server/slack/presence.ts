/**
 * Slack presence → the world, for one company:
 *
 * Huddles. Slack tells us two things, separately: `user_huddle_changed` (users:read) says a person is now in a
 * huddle and gives the huddle's call id — for every huddle, channel or DM; the channel's `huddle_thread` message
 * (and its `message_changed` updates, channels:history / groups:history) says which channel that call belongs to
 * and who's in it. We join them: a person in a huddle in a channel bound to a room appears in that room, sitting
 * down — exactly like someone in a bound Discord voice channel (VoicePresenceSync) — and leaves when they drop
 * out. A huddle with no known channel (a DM, a table) still shows as a badge, and its call id tells the world who
 * is talking with whom.
 *
 * Status. `user_change` carries the Slack status (emoji + text + expiry) and `dnd_updated_user` Do Not Disturb;
 * mapSlackStatus turns them into a Minglewood status (source: 'provider'). We only show a status for someone
 * who's around (in the world or in a huddle) — being in a Slack meeting doesn't make an absent person present.
 */
import { bindingSlot } from '@shared/domain/types';
import { TOWN_ID } from '@shared/world';
import type { Store } from '../store/store';
import type { OrgHub } from '../realtime/orgHub';
import { VoicePresenceSync } from '../providers/voiceSync';
import type { SlackUser } from './api';
import { mapSlackStatus } from './status';

export interface HuddleRoom {
  id: string;
  participants?: string[];
  has_ended?: boolean;
  channels?: string[];
}

export class SlackPresence {
  private readonly voice: VoicePresenceSync;
  /** Huddle call id → the channel it's in. */
  private readonly callChannel = new Map<string, string>();
  /** Person → the huddle call they're in. */
  private readonly inCall = new Map<string, string>();
  /** Person → their last Slack status and DND (DND and status arrive in different events). */
  private readonly statusOf = new Map<string, { text?: string; emoji?: string; expiration?: number; dnd?: boolean }>();

  constructor(
    private readonly hub: OrgHub,
    private readonly store: Store,
  ) {
    this.voice = new VoicePresenceSync(hub, store, 'slack');
  }

  memberFor(slackUserId: string): string | undefined {
    return this.store.identity(this.hub.orgId, 'slack', slackUserId)?.memberId;
  }

  /* ------------------------------------------------------------------ huddles */

  /**
   * Someone is in a huddle. In a channel: they appear in its room, and if they're already walking around they walk
   * over. Without a known channel (a DM huddle): a badge with the call id, so people on the same call match.
   */
  private inHuddle(slackUserId: string, channel: string | null, callId: string) {
    this.voice.apply({ externalUserId: slackUserId, channelId: channel, callId, muted: false, video: false });
    if (channel) this.walkOver(slackUserId, channel);
  }

  /**
   * Slack can't move you between huddles, but the other way round works: when you join a huddle in Slack while
   * you're in the world, your avatar walks into that huddle's space (unless you turned "voice follows me" off).
   */
  private walkOver(slackUserId: string, channel: string) {
    const memberId = this.memberFor(slackUserId);
    if (!memberId) return;
    const d = this.store.get(this.hub.orgId);
    const binding = d.bindings.find((b) => b.provider === 'slack' && bindingSlot(b.kind) === 'voice' && b.externalChannelId === channel);
    const member = d.members.get(memberId);
    const actor = this.hub.actor(memberId);
    if (!binding || !member || member.settings.voiceFollow === false || actor?.via !== 'live' || actor.sceneId === binding.roomId) return;
    this.hub.enter(memberId, binding.roomId, 'live');
    const place = binding.roomId === TOWN_ID ? 'town' : (d.rooms.find((r) => r.id === binding.roomId)?.name ?? 'the room');
    this.hub.notify(memberId, `🎧 You joined the huddle in ${binding.label.replace(/^🎧\s*/, '')} — walked you over to ${place}.`);
  }

  /** user_huddle_changed: `in_a_huddle` with a call id, or `default_unset` when they leave. */
  userHuddle(slackUserId: string, state: string | undefined, callId: string | undefined) {
    if (state === 'in_a_huddle' && callId) {
      this.inCall.set(slackUserId, callId);
      // the huddle's channel may not be known (yet): a DM huddle never has one, a channel's huddle_thread places them
      this.inHuddle(slackUserId, this.callChannel.get(callId) ?? null, callId);
    } else {
      if (!this.inCall.has(slackUserId)) return;
      this.inCall.delete(slackUserId);
      this.voice.apply({ externalUserId: slackUserId, channelId: null, muted: false, video: false });
    }
  }

  /** A huddle's thread message in a channel (start, participants changing, end). */
  huddleRoom(channelId: string, room: HuddleRoom) {
    const channel = channelId || room.channels?.[0];
    if (!channel || !room.id) return;
    this.callChannel.set(room.id, channel);
    const here = new Set(room.has_ended ? [] : (room.participants ?? []));
    for (const user of here) {
      this.inCall.set(user, room.id);
      this.inHuddle(user, channel, room.id);
    }
    for (const [user, call] of [...this.inCall]) {
      if (call === room.id && !here.has(user)) {
        this.inCall.delete(user);
        this.voice.apply({ externalUserId: user, channelId: null, muted: false, video: false });
      }
    }
    if (room.has_ended) this.callChannel.delete(room.id);
  }

  /* ------------------------------------------------------------------ status */

  /** user_change (or users.info): the person's Slack status. */
  userStatus(user: SlackUser) {
    const prev = this.statusOf.get(user.id) ?? {};
    this.statusOf.set(user.id, { ...prev, text: user.profile?.status_text, emoji: user.profile?.status_emoji, expiration: user.profile?.status_expiration });
    this.applyStatus(user.id);
    // user_change also carries huddle state
    if (user.profile && 'huddle_state' in user.profile) this.userHuddle(user.id, user.profile.huddle_state, user.profile.huddle_state_call_id);
  }

  /** dnd_updated_user: Do Not Disturb snoozed now, or inside its schedule. */
  dnd(slackUserId: string, d: { dnd_enabled?: boolean; snooze_enabled?: boolean; next_dnd_start_ts?: number; next_dnd_end_ts?: number }, nowSeconds = Date.now() / 1000) {
    const scheduled = !!d.dnd_enabled && !!d.next_dnd_start_ts && !!d.next_dnd_end_ts && d.next_dnd_start_ts <= nowSeconds && nowSeconds < d.next_dnd_end_ts;
    const prev = this.statusOf.get(slackUserId) ?? {};
    this.statusOf.set(slackUserId, { ...prev, dnd: !!d.snooze_enabled || scheduled });
    this.applyStatus(slackUserId);
  }

  private applyStatus(slackUserId: string) {
    const memberId = this.memberFor(slackUserId);
    if (!memberId) return;
    const s = this.statusOf.get(slackUserId) ?? {};
    const mapped = mapSlackStatus(s);
    const p = this.hub.presenceOf(memberId);
    const around = p.status !== 'offline' || !!p.voice;
    if (!around) return;
    if (mapped) this.hub.setStatus(memberId, mapped.status, mapped.note, 'provider', mapped.until);
    // their Slack status was cleared: drop what Slack set (a status they chose in Minglewood stays)
    else if (p.source === 'provider') this.hub.setStatus(memberId, 'available', undefined, 'default');
  }
}
