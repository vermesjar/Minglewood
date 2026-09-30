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
import type { Decoration } from './world/decor';

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
  /** What's said in a space goes to its text channel, and the channel's messages show in the space. */
  chatBridge: boolean;
  /** Walking between spaces moves you between their voice channels (once you're connected to voice). */
  voiceFollow: boolean;
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
  /** Sign in with Slack is available. */
  slack: { enabled: boolean };
  /** "Add to Discord" page on Minglewood Cloud, when hosted. */
  installUrl: string | null;
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
  decorations: Decoration[];
  me: Member;
  capabilities: { discord: ProviderCapabilities | null; slack: ProviderCapabilities | null; demo: ProviderCapabilities };
  discordConnected: boolean;
  slackConnected: boolean;
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
  slack: SlackAdminStatus;
}

export interface SlackAdminStatus {
  /** Client id + secret + signing secret set: sign-in and the workspace install work. */
  configured: boolean;
  /** A bot token is available (env or from the install): channels, presence events, DMs, unfurls. */
  botConfigured: boolean;
  /** Where an admin adds Minglewood to their workspace (OAuth v2), when configured. */
  installUrl: string | null;
  /** Local mock transport (SLACK_MOCK): outgoing Slack calls are recorded, not sent. */
  mock: boolean;
  /** The workspace this company's rooms bind to: its connection, or SLACK_TEAM_ID on a single-workspace server. */
  team: string | null;
  capabilities: ProviderCapabilities;
  /** The URLs to paste into the Slack app's settings. */
  endpoints: { events: string; commands: string; interactions: string; signInRedirect: string; installRedirect: string };
}
