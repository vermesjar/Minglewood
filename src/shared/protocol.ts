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
import type { Decoration } from './world/decor';
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
  /** Something picked up in the world (a coffee from the espresso machine). Held in the hand, never saved. */
  carrying?: string | null;
}

/** A room NPC right now: position (or the path it's walking) and what it's up to. */
export interface NpcState {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  path?: Tile[];
  pathStartedAt?: number;
  /**
   * 'brew': making an order at their machine; 'serve': handing it over; 'work': busy at their spot (typing,
   * shelving); 'greet': turned to someone, waving hello.
   */
  doing?: 'brew' | 'serve' | 'work' | 'greet';
  /** Sitting on this object (a desk chair). */
  sittingOn?: string;
  /** What's in their hands while making or handing over an order (a carryable id: 'coffee'). */
  holding?: string;
  /** Something they say now (a speech bubble). Sent once, never replayed. */
  say?: string;
}

/** What the world can hand you; each must also be a `held` item the avatar renderer can draw. */
export const CARRYABLE = ['coffee', 'boba', 'icecream', 'plush', 'popcorn', 'soda'] as const;

export type DirectoryEntry = Pick<PresenceState, 'memberId' | 'status' | 'note' | 'sceneId' | 'voice' | 'until'> & {
  online: boolean;
};

export type KnockKind = 'chat' | 'coffee';
export type KnockReply = 'join' | 'soon' | 'no';

export type ServerMsg =
  | { t: 'welcome'; you: string; serverTime: number; directory: DirectoryEntry[] }
  | { t: 'scene'; sceneId: string; occupants: Occupant[]; states?: Record<string, boolean>; npcs?: NpcState[] }
  /** Where a room's NPC is and what it's doing (see SceneDef.npcs). */
  | { t: 'npc'; sceneId: string; npc: NpcState }
  | { t: 'objstate'; sceneId: string; objectId: string; on: boolean }
  /** A one-off moment on a piece of furniture everyone in the room sees (a shot being pulled, the bell rung). */
  | { t: 'moment'; sceneId: string; objectId: string; what: 'brew' | 'ring'; by?: string }
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
  | { t: 'decor'; decorations: Decoration[]; roomId: string; by?: string }
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
  hairHighlight: z.union([hex, z.literal('')]).optional(),
  eyes: idStr.optional(),
  eyeColor: hex.optional(),
  brows: idStr.optional(),
  mouth: idStr.optional(),
  facialHair: idStr.optional(),
  faceDetail: idStr.optional(),
  headwear: idStr.optional(),
  headwearColor: hex.optional(),
  eyewear: idStr.optional(),
  neck: idStr.optional(),
  neckColor: hex.optional(),
  topAccent: hex.optional(),
  topPattern: idStr.optional(),
  held: idStr.optional(),
  heldColor: hex.optional(),
  pet: idStr.optional(),
  petColor: hex.optional(),
  mobility: idStr.optional(),
  body: idStr.optional(),
});

export const outfitsSchema = z
  .array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(24), loadout: loadoutSchema }))
  .max(8);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('enter'), sceneId: idStr, at: tile.optional(), near: idStr.optional() }),
  // `startedAt` (server epoch ms) lets a held-key walk extend its path without restarting it.
  z.object({ t: z.literal('move'), path: z.array(tile).min(1).max(400), startedAt: z.number().finite().optional() }),
  z.object({ t: z.literal('sit'), objectId: idStr }),
  z.object({ t: z.literal('stand') }),
  z.object({ t: z.literal('carry'), objectId: idStr.nullable() }),
  z.object({ t: z.literal('toggle'), objectId: idStr }),
  z.object({ t: z.literal('ring'), objectId: idStr }),
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
