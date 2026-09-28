/**
 * Bridges provider voice presence into the world: when a member joins a Discord voice channel
 * that's bound to a room, they appear in that room (via: 'provider') — even if they never opened
 * Minglewood. This is how real conversations become visible places.
 */
import { isSeat } from '@shared/world/scene';
import type { OrgHub } from '../realtime/orgHub';
import type { Store } from '../store/store';
import type { VoiceStateChange } from './types';

export class VoicePresenceSync {
  constructor(
    private readonly hub: OrgHub,
    private readonly store: Store,
  ) {}

  apply(change: VoiceStateChange) {
    const data = this.store.get(this.hub.orgId);
    const identity = data.identities.find((i) => i.provider === 'discord' && i.externalId === change.externalUserId);
    if (!identity) return; // Not a Minglewood member yet — nothing to show.
    const memberId = identity.memberId;
    const binding = change.channelId
      ? data.bindings.find((b) => b.provider === 'discord' && b.externalChannelId === change.channelId)
      : undefined;

    this.hub.setVoice(
      memberId,
      change.channelId ? { providerChannelId: change.channelId, muted: change.muted, video: change.video } : undefined,
    );

    const actor = this.hub.actor(memberId);
    if (actor?.via === 'live') return; // They're in the world themselves; the badge is enough.
    if (!binding) {
      if (actor?.via === 'provider') this.hub.removeActor(memberId);
      return;
    }
    if (actor?.sceneId === binding.roomId) return;
    const scene = this.hub.scene(binding.roomId);
    const seat = scene?.objects.find((o) => isSeat(o) && !this.hub.seatTaken(binding.roomId, o.id));
    this.hub.enter(memberId, binding.roomId, 'provider', seat ? [seat.x, seat.y] : undefined);
    if (seat) this.hub.sit(memberId, seat.id);
  }
}
