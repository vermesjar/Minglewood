/**
 * The communication-provider boundary. The world engine and hub only speak these types;
 * Discord (and later Slack/Teams) live behind it. Capabilities are explicit so the UI can
 * degrade gracefully instead of assuming what a platform exposes.
 */
import type { ProviderKind, RoomBinding } from '@shared/domain/types';

export type { ProviderCapabilities, ExternalChannel, JoinInstruction } from '@shared/api';
import type { ProviderCapabilities, ExternalChannel, JoinInstruction } from '@shared/api';

export interface ExternalIdentityProfile {
  externalId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** Verified member of the connected workspace. */
  workspaceMember: boolean;
  workspaceNick?: string;
  roleIds: string[];
}

export interface VoiceStateChange {
  externalUserId: string;
  /** The channel they're in, or null: off voice — unless `callId` says they're on a call with no channel we know. */
  channelId: string | null;
  /** The call itself (a Slack huddle's call id; Discord: the channel). Same id = talking together. */
  callId?: string;
  muted: boolean;
  video: boolean;
}

export interface CommunicationProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  listChannels(workspaceId: string): Promise<ExternalChannel[]>;
  joinInstruction(binding: RoomBinding): JoinInstruction;
}
