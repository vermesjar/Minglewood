/** The Design Lab's client for /api/dev/lab (localhost only; every write carries the lab header). */
import type { ModelCategory, RoomKind, Theme } from '@shared/models';
import type { SeatKind } from '@shared/world/seats';
import type { SeatModel } from '@shared/world/seatModels';

/**
 * A draft seat's model (the seat model standard, src/shared/world/seatModels.ts; ModelPanel.tsx): the 3D proxy with any
 * per-view nudges (`views`) and traced over layers (`over`), the day the reviewer passed it, and the drawings it was
 * made on (seatLab.ts drawingsSignature).
 */
export interface DraftModel {
  model: SeatModel;
  reviewed?: string;
  for: string;
}

export type Facing = 'se' | 'sw' | 'ne' | 'nw';
export type Rotation = 'radial' | 'mirror' | 'full' | 'flat';
export type PartKind = 'hair' | 'hat' | 'top' | 'pet';

/** A furniture draft: the model spec's declaration (src/shared/models.ts) plus how to draw it. */
export interface FurnitureSpec {
  name: string;
  category: ModelCategory;
  tags: string[];
  rooms: RoomKind[];
  themes: Theme[];
  /** [width, depth] in tiles, as seen facing sw/ne (models.ts footprintFacing). */
  footprint: [number, number];
  height: number;
  width?: number;
  fit: 'stand' | 'diamond';
  fill: number;
  rotation: Rotation;
  layer: 'object' | 'surface' | 'floor';
  useFace: 'front' | 'any';
  sameFromBehind: boolean;
  /** The cushion's height (art px), how it's sat in, and whether it has a back and arms: what Auto-fit starts from. */
  seat: number | null;
  seatKind?: SeatKind;
  sitStyle: 'chair' | 'stool' | 'lounge' | 'floor';
  backrest: boolean;
  arms?: boolean;
  /** How people sit in it: its 3D model (ModelPanel.tsx). A seat publishes with one that holds and is passed. */
  seatModel?: DraftModel | null;
  surface: number | null;
  light: { x: number; y: number; r?: number } | null;
  wallV?: [number, number];
  actions: Array<{ kind: string; [k: string]: unknown }>;
  prompt: string;
  prompts: Partial<Record<Facing, string>>;
  quality: 'low' | 'medium' | 'high';
  colors: number;
}

export interface PartSpec {
  kind: PartKind;
  name: string;
  label: string;
  prompt: string;
  backPrompt: string;
  long: boolean;
  drape: boolean;
  quality: 'medium' | 'high';
}

export interface Placed {
  x: number;
  y: number;
  rows: string[];
}

export interface DraftView {
  file?: string;
  anchor?: [number, number];
  nudge?: [number, number];
  placed?: Placed;
  behind?: Placed | null;
  take?: number;
  accepted?: boolean;
}

export interface Draft {
  seatMotionReview?: { result?: string; state: string; visualApproval: boolean };
  seatingSurfaceReview?: { status: 'INCOMPLETE' | 'FAILED' | 'UNREVIEWED'; error?: string; contract?: string };
  id: string;
  kind: 'furniture' | 'part';
  key: string;
  title: string;
  created: string;
  updated: string;
  published?: string;
  /** A published part's line for AVATAR_ITEMS (src/shared/avatar.ts). */
  catalogLine?: string;
  origin?: string;
  refs: string[];
  furniture?: FurnitureSpec;
  part?: PartSpec;
  views: Record<string, DraftView>;
  takes: Array<{ n: number; at: string; views: string[]; note?: string; usd?: number }>;
}

export interface DraftSummary {
  id: string;
  kind: 'furniture' | 'part';
  key: string;
  title: string;
  updated: string;
  published?: string;
  thumb?: string;
}

export interface Usage {
  total: number;
  cap: number;
  today: number;
  callsToday: number;
  estimates: Record<string, number>;
}

export interface CheckResult {
  problems: string[];
  placement: Array<{ facing: Facing; ok: boolean; notes: string[] }>;
}

export interface SeatReviewStatus {
  checkedAt: string;
  draftSignature: string;
  accepted: boolean;
  problems: string[];
  failures: number;
  unresolved: number;
  reviewedPixels: number;
  rendererReceipt: string;
  motion: { state: string; invariantsPassed: boolean; visualApproved: boolean; films: number; problems: string[] };
  wardrobe?: { accepted: boolean; looks: number; contexts: number; problems: string[] };
  contexts: Array<{ facing: Facing; cushion: number; look: number; captured: boolean; reviewed: boolean; unresolved: number }>;
  evidence: Array<{ label: string; path: string }>;
}
export interface SeatReviewFrame {
  facing: Facing; look: number; rect: { x: number; y: number; width: number; height: number }; rgba: number[]; capture: string;
}
export interface SeatMotionFrames {
  facing: Facing; look: number; filmSha256: string; resultSha256: string; scope: string;
  frames: Array<{ png: string; rect: SeatReviewFrame['rect']; phase: string; pose: string; cushion: number | null; renderedFrame: number }>;
}

export interface LibraryPiece {
  key: string;
  name: string | null;
  category: string | null;
  rotation: string | null;
  wall: boolean;
  footprint: [number, number];
  seat: number | null;
  seatKind?: SeatKind;
  facings: string[];
  issues: string[];
  /** A seat's model in art/seat-models.json: none, fitted but not passed, or passed by the reviewer. */
  model?: 'none' | 'fitted' | 'reviewed';
}

const BASE = '/api/dev/lab';

export { humanizeKey, NAME_MAX } from '@shared/catalogName';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET') headers.set('x-lab', '1');
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/** A cleared field travels as null: JSON drops undefined, and the server merges a patch over the draft, so a dropped key would keep the old value. */
const body = (v: unknown) => JSON.stringify(v, (_k, val: unknown) => (val === undefined ? null : val));

export const lab = {
  usage: () => call<Usage>('/usage'),
  drafts: () => call<DraftSummary[]>('/drafts'),
  create: (v: { kind: 'furniture' | 'part'; key: string; title?: string; furniture?: Partial<FurnitureSpec>; part?: Partial<PartSpec> }) =>
    call<Draft>('/drafts', { method: 'POST', body: body(v) }),
  draft: (id: string) => call<{ draft: Draft; history: Array<Record<string, unknown>> }>(`/drafts/${id}`),
  update: (id: string, v: Partial<Pick<Draft, 'title' | 'views'>> & { furniture?: Partial<FurnitureSpec>; part?: Partial<PartSpec> }) =>
    call<Draft>(`/drafts/${id}`, { method: 'PUT', body: body(v) }),
  discard: (id: string) => call<{ ok: boolean }>(`/drafts/${id}`, { method: 'DELETE' }),
  addRef: (id: string, file: File) =>
    call<{ name: string; draft: Draft }>(`/drafts/${id}/refs`, { method: 'POST', body: file, headers: { 'Content-Type': file.type } }),
  removeRef: (id: string, name: string) => call<Draft>(`/drafts/${id}/refs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  generate: (id: string, v: { view?: string; note?: string; quality?: string }) =>
    call<{ draft: Draft; usd: number }>(`/drafts/${id}/generate`, { method: 'POST', body: body(v) }),
  check: (id: string) => call<CheckResult>(`/drafts/${id}/check`, { method: 'POST', body: '{}' }),
  retrySeatReview: (id: string) => call<{ draft: Draft; problems: string[] }>(`/drafts/${id}/seat-review`, { method: 'POST', body: '{}' }),
  seatReview: (id: string) => call<SeatReviewStatus>(`/drafts/${id}/seat-review`),
  seatReviewFrame: (id: string, facing: Facing, look: number) => call<SeatReviewFrame>(`/drafts/${id}/seat-review/frame?facing=${facing}&look=${look}`),
  seatMotionFrames: (id: string, facing: Facing, look: number) => call<SeatMotionFrames>(`/drafts/${id}/seat-review/motion?facing=${facing}&look=${look}`),
  publish: (id: string, overwrite = false) => call<Record<string, unknown>>(`/drafts/${id}/publish`, { method: 'POST', body: body({ overwrite }) }),
  fromCatalog: (key: string) => call<Draft>(`/from-catalog/${encodeURIComponent(key)}`, { method: 'POST', body: '{}' }),
  library: () => call<{ scale: number; pieces: LibraryPiece[] }>('/library'),
  /** The character parts in the libraries (hair, hats, tops, pets). */
  parts: () => call<Record<PartKind, string[]>>('/parts'),
  fileUrl: (id: string, rel: string, bust = '') => `${BASE}/drafts/${id}/file/${rel}${bust ? `?v=${bust}` : ''}`,
  exportUrl: (id: string) => `${BASE}/drafts/${id}/export`,
  artBase: (id: string) => `${BASE}/art/${id}`,
};

/** A generation's likely cost, from the real spend log (the mean of the same kind, quality and size). */
export function estimate(u: Usage | null, kind: 'build' | 'charkit', quality: string, size: string, n = 1): number | null {
  if (!u) return null;
  const v = u.estimates[`${kind}|${quality}|${size}`] ?? u.estimates[`${kind}|high|${size}`];
  return v === undefined ? null : v * n;
}
