/**
 * Running as a Discord Activity (Embedded App SDK).
 *
 * Discord launches Activities in an iframe at https://<client_id>.discordsays.com with query
 * params (frame_id, instance_id, guild_id, channel_id…). Only the SDK commands that exist and
 * that our minimal scopes allow are used here — see docs/DISCORD.md for the full audit:
 *  - authorize / authenticate           (identify, guilds.members.read)
 *  - getInstanceConnectedParticipants   (no scope) → "N people here in this Activity"
 *  - openExternalLink                   (no scope) → open channels / links
 * There is no SDK command to join a voice channel; the Activity already runs inside one.
 */
import type { DiscordSDK as DiscordSDKType } from '@discord/embedded-app-sdk';
import { api, setActivityTransport } from '../app/api';

let sdk: DiscordSDKType | null = null;

export function isInDiscordActivity(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has('frame_id') && q.has('instance_id');
}

export interface ActivityContext {
  roomId: string | null;
  participants: number;
}

export async function startActivity(clientId: string, onParticipants: (n: number) => void): Promise<ActivityContext> {
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds.members.read'],
  });
  const res = await api<{ access_token: string; token: string }>('/auth/discord/activity', {
    method: 'POST',
    json: { code, guildId: sdk.guildId ?? undefined },
  });
  setActivityTransport(res.token);
  await sdk.commands.authenticate({ access_token: res.access_token });

  let roomId: string | null = null;
  if (sdk.channelId) {
    roomId = (await api<{ roomId: string | null }>(`/discord/context?channelId=${sdk.channelId}`)).roomId;
  }
  const { participants } = await sdk.commands.getInstanceConnectedParticipants();
  sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (e: { participants: unknown[] }) => onParticipants(e.participants.length));
  return { roomId, participants: participants.length };
}

/** Opens a link the supported way for where we're running. */
export function openLink(url: string) {
  if (sdk) {
    void sdk.commands.openExternalLink({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
