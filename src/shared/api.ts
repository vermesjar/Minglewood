/** HTTP API payload types shared by server and client. */
import type {
  AuditEntry,
  Department,
  HistoricalArtifact,
  Member,
  OrgEvent,
  Organization,
  ProviderConnection,
  Room,
  RoomBinding,
  Team,
  World,
} from './domain/types';

export interface ProviderCapabilities {
  /** Sign in with the provider and verify workspace membership. */
  identity: boolean;
  /** List channels to bind rooms to. */
  channelListing: boolean;
  /** Know who is in a voice channel (and mute/video flags). */
  voicePresence: boolean;
  /** Know who is speaking in real time. */
  speakingIndicators: boolean;
  /** Put the user directly into a voice channel without a click in the provider's client. */
  directVoiceJoin: boolean;
  /** Open the channel in the provider's client via link. */
  deepLinkJoin: boolean;
  /** Run Minglewood embedded inside the provider (e.g. a Discord Activity). */
  embeddedApp: boolean;
}

export interface JoinInstruction {
  kind: 'deeplink' | 'demo' | 'unavailable';
  label: string;
  webUrl?: string;
  appUrl?: string;
  /** Plain-language explanation of what happens next (shown in the UI). */
  explainer: string;
}

export type PublicMember = Omit<Member, 'settings'>;
export type BindingView = RoomBinding & { join: JoinInstruction };

export interface PublicConfig {
  brand: { name: string; tagline: string };
  demoMode: boolean;
  discord: { enabled: boolean; clientId: string | null };
}

export interface Bootstrap {
  org: Organization;
  world: World;
  departments: Department[];
  teams: Team[];
  rooms: Room[];
  members: PublicMember[];
  bindings: BindingView[];
  events: OrgEvent[];
  artifacts: HistoricalArtifact[];
  me: Member;
  capabilities: { discord: ProviderCapabilities | null; demo: ProviderCapabilities };
  discordConnected: boolean;
}

export interface ExternalChannel {
  id: string;
  name: string;
  kind: 'voice' | 'stage' | 'text' | 'other';
  parentName?: string;
}

export interface AdminOverview {
  org: Organization;
  rooms: Room[];
  teams: Team[];
  departments: Department[];
  bindings: BindingView[];
  connections: ProviderConnection[];
  events: OrgEvent[];
  artifacts: HistoricalArtifact[];
  members: Array<{ id: string; displayName: string; teamId: string }>;
  audit: AuditEntry[];
  memberCount: number;
  discord: { configured: boolean; botConfigured: boolean; installUrl: string | null; capabilities: ProviderCapabilities };
}
