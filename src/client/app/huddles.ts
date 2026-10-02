/**
 * Silent disco: who's hearing what. A space has one voice (its channel's huddle / voice channel), but people in it
 * can be on other calls (a table's huddle, a one-on-one) or on none. The headphone badge by a name says which:
 *
 *   gold          — on the room's own call: everyone gold is talking together
 *   another color — on some other call; everyone on that call shares its color (one per call id). Headphones
 *                   when someone else in this room is on it (a table); a phone when nobody here is (they're
 *                   talking to someone elsewhere)
 *   grey, slashed — in the room but on no call at all: present, hearing nothing
 *
 * The badge only shows where it means something: in a space that has a voice channel, or for anyone on a call.
 */
import type { Occupant } from '@shared/protocol';
import type { BindingView } from '@shared/api';

export const ROOM_CALL_COLOR = '#f2b705';
export const NO_CALL_COLOR = '#9a9388';

/** Distinct, readable on paper and ink; none of them gold or grey. */
const CALL_COLORS = ['#e8457f', '#3f8cff', '#1fb3a5', '#a45cff', '#ff7f2a', '#1ca85e', '#e0453b', '#0ea5c9', '#c2410c', '#7c3aed'];

/** The same call always gets the same color (within a session). */
export function callColor(callId: string): string {
  let h = 0;
  for (let i = 0; i < callId.length; i++) h = (h * 31 + callId.charCodeAt(i)) >>> 0;
  return CALL_COLORS[h % CALL_COLORS.length];
}

export interface VoiceBadge {
  kind: 'room' | 'other' | 'none';
  color: string;
  /** The call everyone with this badge shares (undefined for 'none'). */
  callId?: string;
  /** 'other' only: on the phone — nobody else in this room is on that call. */
  shape?: 'headphones' | 'phone';
  /** What it means, in words (set by the caller who knows the names). */
  title?: string;
}

type Voiced = Pick<Occupant, 'voice'> | { voice?: Occupant['voice'] } | undefined;

/**
 * The badge for a person as seen in a space whose voice channel is `roomChannelId` (undefined: the space has none).
 * `others` are the other people in that space, to tell a table (headphones) from a call elsewhere (phone).
 */
export function voiceBadge(person: Voiced, roomChannelId: string | undefined, others: Voiced[] = []): VoiceBadge | null {
  const v = person?.voice;
  if (v) {
    if (roomChannelId && v.providerChannelId === roomChannelId) return { kind: 'room', color: ROOM_CALL_COLOR, callId: v.callId ?? v.providerChannelId };
    const callId = v.callId ?? v.providerChannelId;
    const sharedHere = !!callId && others.some((o) => o !== person && (o?.voice?.callId ?? o?.voice?.providerChannelId) === callId);
    return { kind: 'other', color: callId ? callColor(callId) : NO_CALL_COLOR, callId: callId || undefined, shape: sharedHere ? 'headphones' : 'phone' };
  }
  return roomChannelId ? { kind: 'none', color: NO_CALL_COLOR } : null;
}

/** The voice channel of a space (its huddle / voice channel), from the bindings. */
export function roomVoiceChannel(bindings: BindingView[] | undefined, sceneId: string | null | undefined): string | undefined {
  return bindings?.find((b) => b.roomId === sceneId && b.kind !== 'text')?.externalChannelId;
}

/** A direct link into someone's call, when it's a channel we know (a bound one); DM huddles have no link. */
export function callLink(bindings: BindingView[] | undefined, person: Voiced): string | undefined {
  const ch = person?.voice?.providerChannelId;
  if (!ch) return undefined;
  const b = bindings?.find((x) => x.kind !== 'text' && x.externalChannelId === ch);
  return b?.join.liveWebUrl ?? b?.join.webUrl;
}

/** What the badge means, in words. */
export function badgeTitle(badge: VoiceBadge | null, others: string[]): string {
  if (!badge) return '';
  if (badge.kind === 'room') return 'In the room’s huddle';
  if (badge.kind === 'none') return 'Not in a huddle — present, hearing nothing';
  if (badge.shape === 'phone') return others.length ? `On a call with ${others.join(', ')} (not in this room)` : 'On a call with someone elsewhere';
  return others.length ? `In a huddle with ${others.join(', ')}` : 'In a huddle';
}

/** Headphones, drawn into a canvas: a small disc with the band and two cups; slashed for "on no call". */
export function drawHeadphones(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, badge: VoiceBadge) {
  c.save();
  c.fillStyle = '#2a1f2d';
  c.beginPath();
  c.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = badge.color;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  const ink = badge.kind === 'none' ? '#f4efe6' : '#2a1f2d';
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = Math.max(1.2, r * 0.22);
  c.lineCap = 'round';
  if (badge.shape === 'phone') {
    // a phone: body with a screen cut out
    const w = r * 0.8;
    const h = r * 1.3;
    c.fillRect(cx - w / 2, cy - h / 2, w, h);
    c.fillStyle = badge.color;
    c.fillRect(cx - w / 2 + r * 0.14, cy - h / 2 + r * 0.2, w - r * 0.28, h - r * 0.5);
  } else {
    // the band
    c.beginPath();
    c.arc(cx, cy + r * 0.15, r * 0.55, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    // the cups
    const cup = r * 0.26;
    c.fillRect(cx - r * 0.55 - cup * 0.5, cy + r * 0.05, cup, cup * 1.6);
    c.fillRect(cx + r * 0.55 - cup * 0.5, cy + r * 0.05, cup, cup * 1.6);
  }
  if (badge.kind === 'none') {
    c.strokeStyle = '#e0453b';
    c.lineWidth = Math.max(1.5, r * 0.28);
    c.beginPath();
    c.moveTo(cx - r * 0.7, cy + r * 0.7);
    c.lineTo(cx + r * 0.7, cy - r * 0.7);
    c.stroke();
  }
  c.restore();
}
