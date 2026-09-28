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
  channelId: string | null;
  muted: boolean;
  video: boolean;
}

export interface CommunicationProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  listChannels(workspaceId: string): Promise<ExternalChannel[]>;
  joinInstruction(binding: RoomBinding): JoinInstruction;
}
