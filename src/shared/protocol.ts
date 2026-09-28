/**
 * Realtime wire protocol (JSON over WebSocket). Client messages are validated with zod on the
 * server; server messages are trusted by the client.
 *
 * Subscription model: a socket is subscribed to exactly one scene at a time and receives
 * fine-grained updates (movement, emotes) only for that scene. Org-wide awareness comes from a
 * coarse, throttled `directory` message (status + which room), never positions.
 */
import { z } from 'zod';
import type { AvatarLoadout, HistoricalArtifact, Member, OrgEvent, PresenceState, PresenceStatus } from './domain/types';
import type { Facing } from './world/scene';
import type { Tile } from './world/pathfinding';
import { EMOTE_IDS, type EmoteId } from './presence';

export interface Occupant {
  memberId: string;
  x: number;
  y: number;
  facing: Facing;
  path?: Tile[];
  pathStartedAt?: number; // server epoch ms
  sittingOn?: string; // object id
  status: PresenceStatus;
  note?: string;
  avatar: AvatarLoadout;
  /** How they're present: a live Minglewood session, a simulated demo coworker, or a provider (e.g. in Discord voice). */
  via: 'live' | 'sim' | 'provider';
  voice?: PresenceState['voice'];
  speaking?: boolean;
}

export type DirectoryEntry = Pick<PresenceState, 'memberId' | 'status' | 'note' | 'sceneId' | 'voice' | 'until'> & {
  online: boolean;
};

export type KnockKind = 'chat' | 'coffee';
export type KnockReply = 'join' | 'soon' | 'no';

export type ServerMsg =
  | { t: 'welcome'; you: string; serverTime: number; directory: DirectoryEntry[] }
  | { t: 'scene'; sceneId: string; occupants: Occupant[] }
  | { t: 'joined'; sceneId: string; occupant: Occupant }
  | { t: 'left'; sceneId: string; memberId: string; toSceneId?: string }
  | { t: 'moved'; memberId: string; path: Tile[]; startedAt: number }
  | { t: 'updated'; memberId: string; patch: Partial<Occupant> }
  | { t: 'emote'; memberId: string; emote: EmoteId; targetId?: string }
  | { t: 'said'; memberId: string; text: string }
  | { t: 'directory'; entries: DirectoryEntry[] }
  | { t: 'knock'; knockId: string; fromId: string; kind: KnockKind; sceneId?: string }
  | { t: 'knock-result'; knockId: string; targetId: string; reply: KnockReply; message?: string; sceneId?: string }
  | { t: 'toast'; text: string; tone?: 'info' | 'celebrate' | 'social' }
  | { t: 'events'; events: OrgEvent[] }
  | { t: 'artifacts'; artifacts: HistoricalArtifact[]; added?: string }
  | { t: 'member'; memberId: string; avatar: AvatarLoadout; unlockedItems: string[] }
  | { t: 'profile'; member: Omit<Member, 'settings'> }
  | { t: 'error'; message: string };

const tile = z.tuple([z.number().int().min(0).max(512), z.number().int().min(0).max(512)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const idStr = z.string().min(1).max(64);

export const loadoutSchema = z.object({
  skin: hex,
  hair: idStr,
  hairColor: hex,
  top: idStr,
  topColor: hex,
  bottom: idStr,
  bottomColor: hex,
  shoes: idStr,
  shoesColor: hex,
  accessory: idStr,
});

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('enter'), sceneId: idStr, at: tile.optional(), near: idStr.optional() }),
  z.object({ t: z.literal('move'), path: z.array(tile).min(1).max(400) }),
  z.object({ t: z.literal('sit'), objectId: idStr }),
  z.object({ t: z.literal('stand') }),
  z.object({
    t: z.literal('status'),
    status: z.enum(['available', 'open', 'focused', 'meeting', 'away']),
    note: z.string().max(60).optional(),
  }),
  z.object({
    t: z.literal('emote'),
    emote: z.enum(EMOTE_IDS as [EmoteId, ...EmoteId[]]),
    targetId: idStr.optional(),
  }),
  z.object({ t: z.literal('say'), text: z.string().min(1).max(120) }),
  z.object({ t: z.literal('knock'), targetId: idStr, kind: z.enum(['chat', 'coffee']) }),
  z.object({ t: z.literal('knock-reply'), knockId: idStr, reply: z.enum(['join', 'soon', 'no']) }),
  z.object({ t: z.literal('avatar'), loadout: loadoutSchema }),
  z.object({ t: z.literal('claim-reward'), eventId: idStr }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;
