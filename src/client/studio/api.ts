/** The Design Lab's client for /api/dev/lab (localhost only; every write carries the lab header). */
import type { ModelCategory, RoomKind, Theme } from '@shared/models';

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
  seat: number | null;
  sitStyle: 'chair' | 'stool' | 'lounge' | 'floor';
  backrest: boolean;
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

export interface LibraryPiece {
  key: string;
  name: string | null;
  category: string | null;
  rotation: string | null;
  wall: boolean;
  footprint: [number, number];
  seat: number | null;
  facings: string[];
  issues: string[];
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

const body = (v: unknown) => JSON.stringify(v);

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
  publish: (id: string, overwrite = false) => call<Record<string, unknown>>(`/drafts/${id}/publish`, { method: 'POST', body: body({ overwrite }) }),
  fromCatalog: (key: string) => call<Draft>(`/from-catalog/${encodeURIComponent(key)}`, { method: 'POST', body: '{}' }),
  library: () => call<{ scale: number; pieces: LibraryPiece[] }>('/library'),
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
