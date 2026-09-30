/**
 * The Design Lab's API (dev only, localhost only): drafts of furniture and character parts, generated, checked
 * and published through the art pipeline (art/designlab.py → studio.py / charkit.py). Mounted by app.ts only
 * outside production, behind `labGuard`; the OpenAI key never leaves the Python tools.
 */
import { Router, raw, json, type NextFunction, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { extname, relative, resolve, sep } from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import { CATEGORIES, ROOM_KINDS, THEMES, wallSpanFor, type ModelCategory, type RoomKind, type Theme } from '@shared/models';
import { humanizeKey, NAME_MAX } from '@shared/catalogName';
import { seatProfile } from '@shared/world/seats';

/* ------------------------------------------------------------------ the guard */

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FORWARD_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'forwarded', 'x-forwarded-host'];

function hostnameOf(v: string | undefined): string | null {
  if (!v) return null;
  try {
    return new URL(v.includes('://') ? v : `http://${v}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Whether a request comes from a browser on this machine, talking to the dev server by a loopback name: the
 * socket is loopback (so not the LAN), nothing forwarded it (so not a tunnel), the Host is loopback (so not DNS
 * rebinding: the dev proxy keeps the browser's Host for /api/dev), and any Origin or Referer is loopback too.
 */
export function isLocalRequest(req: { socket: { remoteAddress?: string | null }; headers: IncomingHttpHeaders; method?: string }): boolean {
  if (!LOOPBACK_IPS.has(req.socket.remoteAddress ?? '')) return false;
  for (const h of FORWARD_HEADERS) if (req.headers[h] !== undefined) return false;
  const host = hostnameOf(String(req.headers.host ?? ''));
  if (!host || !LOOPBACK_HOSTS.has(host)) return false;
  for (const h of ['origin', 'referer'] as const) {
    const v = req.headers[h];
    if (v === undefined) continue;
    const name = hostnameOf(String(v));
    if (!name || !LOOPBACK_HOSTS.has(name)) return false;
  }
  // writes carry a custom header: a cross-site form or fetch can't send it without a CORS preflight we never allow
  if (req.method && !['GET', 'HEAD'].includes(req.method) && req.headers['x-lab'] !== '1') return false;
  return true;
}

export function labGuard(req: Request, res: Response, next: NextFunction) {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'the Design Lab is only available on this machine (localhost)' });
    return;
  }
  next();
}

/* ------------------------------------------------------------------ drafts on disk */

export interface DraftSummary {
  id: string;
  kind: 'furniture' | 'part';
  key: string;
  title: string;
  updated: string;
  published?: string;
  thumb?: string;
}

const KEY_RE = /^[a-z0-9][a-z0-9.-]{1,48}$/;
const ID_RE = /^[a-z0-9-]{3,64}$/;
const ROTATIONS = ['radial', 'mirror', 'full', 'flat'] as const;
const PART_KINDS = ['hair', 'hat', 'top', 'pet'] as const;
const IMAGE_TYPES: Record<string, { ext: string; magic: number[] }> = {
  'image/png': { ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: '.webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
export const MAX_REF_BYTES = 8 * 1024 * 1024;

export class DraftStore {
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new LabError(400, 'bad draft id');
    const d = resolve(this.root, id);
    if (!d.startsWith(this.root + sep)) throw new LabError(400, 'bad draft id');
    return d;
  }

  has(id: string) {
    return ID_RE.test(id) && existsSync(resolve(this.dir(id), 'draft.json'));
  }

  read(id: string): Draft {
    if (!this.has(id)) throw new LabError(404, 'no such draft');
    return JSON.parse(readFileSync(resolve(this.dir(id), 'draft.json'), 'utf8')) as Draft;
  }

  write(d: Draft) {
    d.updated = localStamp();
    writeAtomic(resolve(this.dir(d.id), 'draft.json'), JSON.stringify(d, null, 2) + '\n');
  }

  create(input: { kind: 'furniture' | 'part'; key: string; title?: string; furniture?: Partial<FurnitureSpec>; part?: Partial<PartSpec>; origin?: string }): Draft {
    if (!KEY_RE.test(input.key)) throw new LabError(400, 'key: lowercase letters, digits, dots and dashes (2–49 chars)');
    const id = `${input.key.replace(/\./g, '-')}-${randomBytes(3).toString('hex')}`.slice(0, 64);
    mkdirSync(resolve(this.dir(id), 'refs'), { recursive: true });
    const now = localStamp();
    const d: Draft = {
      id,
      kind: input.kind,
      key: input.key,
      title: input.title?.slice(0, 80) || input.key,
      created: now,
      updated: now,
      refs: [],
      views: {},
      takes: [],
      origin: input.origin,
    };
    if (input.kind === 'furniture') {
      d.furniture = cleanFurniture({ ...defaultFurniture(), ...input.furniture });
      // the catalog name is short and its own: from the key until it's given one (never from the prompt)
      if (!d.furniture.name) d.furniture.name = humanizeKey(input.key);
      if (!input.title) d.title = d.furniture.name;
    }
    else d.part = cleanPart({ ...defaultPart(input.key), ...input.part });
    this.write(d);
    this.log(id, 'create', { kind: d.kind, key: d.key });
    return d;
  }

  list(): DraftSummary[] {
    if (!existsSync(this.root)) return [];
    const out: DraftSummary[] = [];
    for (const id of readdirSync(this.root)) {
      if (!this.has(id)) continue;
      const d = this.read(id);
      const first = Object.values(d.views ?? {})[0] as { file?: string } | undefined;
      out.push({ id, kind: d.kind, key: d.key, title: d.title, updated: d.updated, published: d.published, thumb: first?.file });
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /** Discarding moves a draft aside (art/drafts/.trash), never deletes it. */
  discard(id: string) {
    const d = this.dir(id);
    if (!this.has(id)) throw new LabError(404, 'no such draft');
    const trash = resolve(this.root, '.trash');
    mkdirSync(trash, { recursive: true });
    renameSync(d, resolve(trash, `${id}-${Date.now()}`));
  }

  addRef(id: string, type: string, body: Buffer): string {
    const t = IMAGE_TYPES[type];
    if (!t) throw new LabError(415, 'reference images must be PNG, JPEG or WebP');
    if (body.length === 0 || body.length > MAX_REF_BYTES) throw new LabError(413, 'reference images must be under 8 MB');
    if (!t.magic.every((b, i) => body[i] === b)) throw new LabError(415, 'that file is not the image type it claims to be');
    const d = this.read(id);
    const name = `ref-${Date.now().toString(36)}${t.ext}`;
    writeFileSync(resolve(this.dir(id), 'refs', name), body);
    d.refs = [...(d.refs ?? []), name].slice(-6);
    this.write(d);
    this.log(id, 'ref', { name });
    return name;
  }

  removeRef(id: string, name: string) {
    const d = this.read(id);
    d.refs = (d.refs ?? []).filter((r) => r !== name);
    this.write(d);
  }

  /** A file inside a draft (never outside it). */
  file(id: string, rel: string): string {
    const base = this.dir(id);
    const p = resolve(base, rel);
    if (!p.startsWith(base + sep) || !existsSync(p) || !statSync(p).isFile()) throw new LabError(404, 'no such file');
    return p;
  }

  history(id: string): unknown[] {
    const p = resolve(this.dir(id), 'history.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown)
      .slice(-100);
  }

  log(id: string, event: string, data: Record<string, unknown> = {}) {
    const line = JSON.stringify({ t: localStamp(), event, ...data }) + '\n';
    writeFileSync(resolve(this.dir(id), 'history.jsonl'), line, { flag: 'a' });
  }
}

/**
 * Write a file the art tools may be reading at the same moment (designlab.py loads draft.json on every check):
 * to a temp file beside it, then swapped in, so a reader sees the old draft or the new, never a truncated one.
 */
function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      // Windows refuses while a reader has it open: a moment, then again
      if (i >= 40) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** Local time, like the Python tools' time.strftime('%Y-%m-%dT%H:%M:%S'), so a draft's history reads in one clock. */
function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class LabError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A furniture draft: the model spec's declaration (src/shared/models.ts: name, category, tags, rooms, footprint
 * [width, depth], height, rotation, layer, use, seat, surface, light, wall) plus how to draw it.
 */
export interface FurnitureSpec {
  name: string;
  category: ModelCategory;
  tags: string[];
  rooms: RoomKind[];
  themes: Theme[];
  footprint: [number, number];
  height: number;
  width?: number;
  fit: 'stand' | 'diamond';
  fill: number;
  rotation: (typeof ROTATIONS)[number];
  /** Floor pieces people stand on (rugs) and pieces that stand on a counter's top. */
  layer: 'object' | 'surface' | 'floor';
  /** Used from its front (a machine, a seat) or from any side (a bell, a plant). */
  useFace: 'front' | 'any';
  /** A mirror piece whose back honestly looks like its front: one drawing serves both. */
  sameFromBehind: boolean;
  /**
   * The seat standard (seats.ts SeatProfile): the cushion's height, how it's sat in, whether it has a back and arms.
   * What the Lab's Auto-fit seeds the seat's model from.
   */
  seat: number | null;
  sitStyle: 'chair' | 'stool' | 'lounge' | 'floor';
  backrest: boolean;
  arms: boolean;
  surface: number | null;
  light: { x: number; y: number; r?: number } | null;
  wallV?: [number, number];
  actions: Array<{ kind: string; [k: string]: unknown }>;
  prompt: string;
  prompts: Partial<Record<'se' | 'sw' | 'ne' | 'nw', string>>;
  quality: 'low' | 'medium' | 'high';
  colors: number;
}

export interface PartSpec {
  kind: (typeof PART_KINDS)[number];
  name: string;
  label: string;
  prompt: string;
  backPrompt: string;
  long: boolean;
  drape: boolean;
  quality: 'medium' | 'high';
}

export interface Draft {
  id: string;
  kind: 'furniture' | 'part';
  key: string;
  title: string;
  created: string;
  updated: string;
  published?: string;
  catalogLine?: string;
  origin?: string;
  refs: string[];
  furniture?: FurnitureSpec;
  part?: PartSpec;
  views: Record<string, { file?: string; anchor?: [number, number]; nudge?: [number, number]; placed?: unknown; behind?: unknown; take?: number; accepted?: boolean }>;
  takes: Array<{ n: number; at: string; views: string[]; note?: string; usd?: number }>;
}

function defaultFurniture(): FurnitureSpec {
  return {
    name: '',
    category: 'decor',
    tags: [],
    rooms: ['lounge'],
    themes: [],
    footprint: [1, 1],
    height: 40,
    fit: 'stand',
    fill: 0.7,
    rotation: 'mirror',
    layer: 'object',
    useFace: 'front',
    sameFromBehind: false,
    seat: null,
    sitStyle: 'chair',
    backrest: true,
    arms: false,
    surface: null,
    light: null,
    actions: [],
    prompt: '',
    prompts: {},
    quality: 'medium',
    colors: 28,
  };
}

function defaultPart(key: string): PartSpec {
  return { kind: 'hair', name: key, label: '', prompt: '', backPrompt: '', long: false, drape: false, quality: 'high' };
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Only known fields, in range: the spec is written to disk and handed to the Python tools. */
export function cleanFurniture(f: Partial<FurnitureSpec>): FurnitureSpec {
  const d = defaultFurniture();
  const fp = Array.isArray(f.footprint) ? f.footprint : d.footprint;
  const rotation = (ROTATIONS as readonly string[]).includes(String(f.rotation)) ? (f.rotation as FurnitureSpec['rotation']) : d.rotation;
  const prompts: FurnitureSpec['prompts'] = {};
  for (const k of ['se', 'sw', 'ne', 'nw'] as const) if (f.prompts?.[k]) prompts[k] = str(f.prompts[k], 600);
  const light = f.light && typeof f.light === 'object' ? { x: num(f.light.x, 0, 400, 0), y: num(f.light.y, 0, 400, 0), r: num(f.light.r, 4, 120, 40) } : null;
  const words = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
  const category = (CATEGORIES as readonly string[]).includes(String(f.category)) ? (f.category as ModelCategory) : d.category;
  const rooms = words(f.rooms).filter((r): r is RoomKind => (ROOM_KINDS as readonly string[]).includes(r));
  const legacyLabel = (f as { label?: unknown }).label;
  return {
    name: str(f.name ?? legacyLabel, NAME_MAX).trim(),
    category,
    tags: [...new Set(words(f.tags))].slice(0, 12),
    rooms: rooms.length ? [...new Set(rooms)] : d.rooms,
    themes: [...new Set(words(f.themes).filter((t): t is Theme => (THEMES as readonly string[]).includes(t)))],
    footprint: [num(fp[0], 1, 4, 1), num(fp[1], 1, 4, 1)],
    height: num(f.height, 4, 200, d.height),
    width: f.width ? num(f.width, 8, 400, 64) : undefined,
    fit: f.fit === 'diamond' ? 'diamond' : 'stand',
    fill: num(f.fill, 0, 1, d.fill),
    rotation,
    layer: f.layer === 'surface' || f.layer === 'floor' ? f.layer : 'object',
    useFace: f.useFace === 'any' ? 'any' : 'front',
    sameFromBehind: !!f.sameFromBehind,
    // seating and only seating has a seat (the model spec's rule)
    seat: category !== 'seating' ? null : f.seat === null || f.seat === undefined || (f.seat as unknown) === '' ? 12 : num(f.seat, 0, 60, 12),
    sitStyle: (['chair', 'stool', 'lounge', 'floor'] as const).includes(f.sitStyle as never) ? (f.sitStyle as FurnitureSpec['sitStyle']) : 'chair',
    backrest: f.backrest === undefined ? true : !!f.backrest,
    arms: category === 'seating' && !!f.arms,
    surface: f.surface === null || f.surface === undefined || (f.surface as unknown) === '' ? null : num(f.surface, 0, 80, 20),
    light,
    wallV: rotation === 'flat' ? [num(f.wallV?.[0], 0, 60, 18), num(f.wallV?.[1], 1, 62, 47)] : undefined,
    actions: Array.isArray(f.actions)
      ? f.actions
          .filter((a) => a && typeof a === 'object' && typeof a.kind === 'string')
          .slice(0, 4)
          .map((a) => JSON.parse(JSON.stringify(a)) as FurnitureSpec['actions'][number])
      : [],
    prompt: str(f.prompt, 1500),
    prompts,
    quality: f.quality === 'high' || f.quality === 'low' ? f.quality : 'medium',
    colors: num(f.colors, 8, 64, d.colors),
  };
}

export function cleanPart(p: Partial<PartSpec>): PartSpec {
  const kind = (PART_KINDS as readonly string[]).includes(String(p.kind)) ? (p.kind as PartSpec['kind']) : 'hair';
  const name = KEY_RE.test(String(p.name)) ? String(p.name) : 'new-part';
  return {
    kind,
    name,
    label: str(p.label, 40),
    prompt: str(p.prompt, 1200),
    backPrompt: str(p.backPrompt, 1200),
    long: !!p.long,
    drape: !!p.drape,
    quality: p.quality === 'medium' ? 'medium' : 'high',
  };
}

/* ------------------------------------------------------------------ the Python tools */

const ART = resolve(process.cwd(), 'art');
const busy = new Set<string>();

/** Run art/designlab.py; resolves with its `@@JSON` result (never the key or the environment). */
export function runLab(args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; result: Record<string, unknown> }> {
  return runArtTool(args, timeoutMs);
}

function runArtTool(args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; result: Record<string, unknown> }> {
  return new Promise((done) => {
    const p = spawn('uv', ['run', 'designlab.py', ...args], { cwd: ART, env: process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    p.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').reverse().find((l) => l.startsWith('@@JSON '));
      let result: Record<string, unknown>;
      try {
        result = line ? (JSON.parse(line.slice(7)) as Record<string, unknown>) : { error: stderr.trim().slice(-600) || 'the art tool failed' };
      } catch {
        result = { error: 'unreadable result from the art tool' };
      }
      done({ code: code ?? 1, result });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      done({ code: 1, result: { error: `could not run the art tools (uv): ${e.message}` } });
    });
  });
}

/** The model check (scripts/model-check.ts) on the whole catalog: key → problems. Cached for a minute. */
let catalogCheck: { at: number; problems: Promise<Record<string, string[]>> } | null = null;
function modelCheckCatalog(): Promise<Record<string, string[]>> {
  if (catalogCheck && Date.now() - catalogCheck.at < 60_000) return catalogCheck.problems;
  const problems = new Promise<Record<string, string[]>>((done) => {
    const tsx = resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const p = spawn(process.execPath, [tsx, '--tsconfig', 'tsconfig.json', 'scripts/model-check.ts', '--json'], { cwd: process.cwd(), windowsHide: true });
    let stdout = '';
    p.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    const timer = setTimeout(() => p.kill(), 180_000);
    p.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').reverse().find((l) => l.startsWith('{'));
      try {
        done(line ? ((JSON.parse(line) as { problems?: Record<string, string[]> }).problems ?? {}) : {});
      } catch {
        done({});
      }
    });
    p.on('error', () => done({}));
  });
  catalogCheck = { at: Date.now(), problems };
  return problems;
}

/* ------------------------------------------------------------------ placement checks (the furniture review's) */

type Facing = 'se' | 'sw' | 'ne' | 'nw';
type Img = { w: number; h: number; d: Uint8Array | Uint8ClampedArray };

/** The furniture review's own checks (scripts/furniture-review.ts), so the lab judges a draft exactly as the gate does. */
interface Review {
  resolve(e: unknown, facing: Facing, sprites: string): { img: Img } | null;
  placement(p: unknown, town: boolean, key: string): { kind: 'small'; dx: number; dy: number } | { kind: 'large'; spill: string[] };
  specks(img: Img): number[];
  reviewEntry(key: string, e: unknown, sprites: string): { issues: string[] };
}
// a computed path: loaded at runtime by tsx, and kept out of the app's typecheck (it's a script, not app code)
const REVIEW_MODULE = ['..', '..', '..', 'scripts', 'furniture-review'].join('/');
const review = () => import(/* @vite-ignore */ REVIEW_MODULE) as Promise<Review>;

async function placementChecks(key: string, entry: Record<string, unknown>, sprites: string) {
  const fr = await review();
  const out: Array<{ facing: Facing; ok: boolean; notes: string[] }> = [];
  for (const facing of ['se', 'sw', 'ne', 'nw'] as Facing[]) {
    const p = fr.resolve(entry, facing, sprites);
    if (!p) {
      out.push({ facing, ok: false, notes: ['no drawing'] });
      continue;
    }
    const notes: string[] = [];
    const fit = fr.placement(p, false, key);
    if (fit.kind === 'small') {
      if (Math.abs(fit.dx) > 3 || Math.abs(fit.dy) > 3) notes.push(`small piece: base ${fit.dx.toFixed(1)}, ${fit.dy.toFixed(1)} px off centre (centred automatically in game)`);
    } else notes.push(...fit.spill.map((s) => `spills past its footprint: ${s}`));
    const sp = fr.specks(p.img);
    if (sp.length) notes.push(`${sp.length} stray bit(s): ${sp.join(', ')} px`);
    const cut = slicedTop(p.img);
    if (cut) notes.push(`top sliced flat (${cut} px wide)`);
    out.push({ facing, ok: notes.every((n) => n.startsWith('small piece')), notes });
  }
  return out;
}

/** The furniture review's "top cut flat by the slicer" test (a drawing whose top rows are a flat run). */
function slicedTop(img: Img): number {
  const span = (y: number) => {
    let l = -1;
    let r = -1;
    for (let x = 0; x < img.w; x++)
      if (img.d[(y * img.w + x) * 4 + 3]) {
        if (l < 0) l = x;
        r = x;
      }
    return l < 0 ? 0 : r - l + 1;
  };
  if (img.h < 4) return 0;
  const [a, b, c] = [span(0), span(1), span(2)];
  return a > 6 && b - a < 2 && c - b < 2 ? a : 0;
}

/* ------------------------------------------------------------------ zip export (deflate from zlib, no zip library) */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipDir(dir: string): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = resolve(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ name: relative(dir, p).split(sep).join('/'), data: readFileSync(p) });
    }
  };
  walk(dir);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* ------------------------------------------------------------------ routes */

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain' };

/** `run` stands in for the art tools (tests). */
export function devLabRoutes(root = resolve(ART, 'drafts'), opts: { run?: typeof runLab } = {}): Router {
  const runLab = opts.run ?? runArtTool;
  const store = new DraftStore(root);
  const r = Router();
  const PUBLIC_ART = resolve(process.cwd(), 'public', 'art');
  const readManifest = () => JSON.parse(readFileSync(resolve(PUBLIC_ART, 'manifest.json'), 'utf8')) as { scale: number; sprites: Record<string, Record<string, unknown>> };
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
    try {
      const v = await fn(req, res);
      if (v !== undefined && !res.headersSent) res.json(v);
    } catch (e) {
      const status = e instanceof LabError ? e.status : 500;
      if (!res.headersSent) res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  const draftPath = (id: string) => relative(ART, store.dir(id)).split(sep).join('/');
  /**
   * One art-tool run per draft at a time, in order: a check, a generation and a publish all rebuild
   * <draft>/stage, so two at once would read each other's half-written files.
   */
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(id, tail);
    void tail.then(() => {
      if (chains.get(id) === tail) chains.delete(id);
    });
    return run;
  };
  const once = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    if (busy.has(id)) throw new LabError(409, 'this draft is already generating; wait for it to finish');
    busy.add(id);
    try {
      return await serial(id, fn);
    } finally {
      busy.delete(id);
    }
  };
  /** Checks come in bursts (every nudge asks for one): at most one waits behind the running one, shared by all. */
  const queuedCheck = new Map<string, Promise<unknown>>();

  r.get('/usage', wrap(async () => (await runLab(['usage'], 60_000)).result));

  r.get('/drafts', wrap(() => store.list()));
  r.post(
    '/drafts',
    json({ limit: '64kb' }),
    wrap((req) => {
      const b = req.body as { kind?: string; key?: string; title?: string; furniture?: Partial<FurnitureSpec>; part?: Partial<PartSpec> };
      if (b.kind !== 'furniture' && b.kind !== 'part') throw new LabError(400, 'kind is furniture or part');
      return store.create({ kind: b.kind, key: String(b.key ?? ''), title: b.title, furniture: b.furniture, part: b.part });
    }),
  );
  r.get('/drafts/:id', wrap((req) => ({ draft: store.read(req.params.id), history: store.history(req.params.id) })));
  r.put(
    '/drafts/:id',
    json({ limit: '1mb' }),
    wrap((req) => {
      const d = store.read(req.params.id);
      const b = req.body as Partial<Draft>;
      if (typeof b.title === 'string') d.title = b.title.slice(0, 80);
      if (b.furniture && d.kind === 'furniture') {
        d.furniture = cleanFurniture({ ...d.furniture, ...b.furniture });
        if (d.furniture.name) d.title = d.furniture.name; // a furniture draft goes by its catalog name
      }
      if (b.part && d.kind === 'part') d.part = cleanPart({ ...d.part, ...b.part });
      if (b.views)
        for (const [k, v] of Object.entries(b.views)) {
          const cur = d.views[k];
          if (!cur || !v) continue;
          if (Array.isArray(v.nudge)) cur.nudge = [num(v.nudge[0], -64, 64, 0), num(v.nudge[1], -64, 64, 0)];
          if (typeof v.accepted === 'boolean') cur.accepted = v.accepted;
        }
      store.write(d);
      return d;
    }),
  );
  r.delete(
    '/drafts/:id',
    wrap((req) => {
      store.discard(req.params.id);
      return { ok: true };
    }),
  );
  r.post(
    '/drafts/:id/refs',
    raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: MAX_REF_BYTES }),
    wrap((req) => {
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      if (!Buffer.isBuffer(req.body)) throw new LabError(415, 'reference images must be PNG, JPEG or WebP');
      return { name: store.addRef(req.params.id, type, req.body), draft: store.read(req.params.id) };
    }),
  );
  r.delete(
    '/drafts/:id/refs/:name',
    wrap((req) => {
      store.removeRef(req.params.id, req.params.name);
      return store.read(req.params.id);
    }),
  );
  r.get('/drafts/:id/file/*', (req, res) => {
    try {
      const p = store.file(req.params.id, (req.params as Record<string, string>)[0]);
      res.type(MIME[extname(p)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.send(readFileSync(p));
    } catch (e) {
      res.status(e instanceof LabError ? e.status : 500).json({ error: e instanceof Error ? e.message : 'error' });
    }
  });
  r.post(
    '/drafts/:id/generate',
    json({ limit: '16kb' }),
    wrap((req) =>
      once(req.params.id, async () => {
        const d = store.read(req.params.id);
        const b = req.body as { view?: string; note?: string; quality?: string };
        const args =
          d.kind === 'furniture'
            ? ['furniture-generate', draftPath(d.id), ...(b.view ? ['--view', String(b.view)] : []), ...(b.note ? ['--note', String(b.note).slice(0, 400)] : [])]
            : ['part-generate', draftPath(d.id), '--view', String(b.view ?? 'front')];
        if (b.quality && ['low', 'medium', 'high'].includes(b.quality)) args.push('--quality', b.quality);
        const { code, result } = await runLab(args);
        if (code !== 0 || result.error) throw new LabError(502, String(result.error ?? 'generation failed'));
        return result;
      }),
    ),
  );
  r.post(
    '/drafts/:id/check',
    wrap(async (req) => {
      const id = req.params.id;
      if (store.read(id).kind !== 'furniture') return { problems: [], placement: [] };
      let queued = queuedCheck.get(id);
      if (!queued) {
        queued = serial(id, async () => {
          queuedCheck.delete(id); // running now: a change from here on needs a check of its own
          const d = store.read(id);
          const { code, result } = await runLab(['furniture-check', draftPath(d.id)], 120_000);
          if (code !== 0 && !result.problems) throw new LabError(500, String(result.error ?? 'check failed'));
          const placement = Object.keys(d.views).length ? await placementChecks(d.key, result.entry as Record<string, unknown>, String(result.sprites)) : [];
          return { problems: result.problems ?? [], placement, entry: result.entry };
        });
        queuedCheck.set(id, queued);
      }
      return queued;
    }),
  );
  r.post(
    '/drafts/:id/publish',
    json({ limit: '4kb' }),
    wrap((req) =>
      once(req.params.id, async () => {
        const d = store.read(req.params.id);
        const overwrite = (req.body as { overwrite?: boolean })?.overwrite ? ['--overwrite'] : [];
        const { code, result } = await runLab([d.kind === 'furniture' ? 'furniture-publish' : 'part-publish', draftPath(d.id), ...overwrite], 180_000);
        if (code !== 0 || result.error) throw new LabError(409, [String(result.error ?? 'publish failed'), ...((result.problems as string[]) ?? [])].join(' — '));
        return result;
      }),
    ),
  );
  r.get('/drafts/:id/export', (req, res) => {
    try {
      const d = store.read(req.params.id);
      res.type('application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${d.id}.zip"`);
      res.send(zipDir(store.dir(d.id)));
    } catch (e) {
      res.status(e instanceof LabError ? e.status : 500).json({ error: e instanceof Error ? e.message : 'error' });
    }
  });

  /** A catalog piece as a draft: its drawings become an accepted take 0, ready to iterate on. */
  r.post(
    '/from-catalog/:key',
    wrap((req) => {
      const key = req.params.key;
      const e = readManifest().sprites[key] as
        | (Partial<Omit<FurnitureSpec, 'light' | 'layer'>> & {
            layer?: string;
            light?: FurnitureSpec['light'];
            use?: { face?: string };
            wall?: { v: [number, number] };
            file?: string;
            anchor?: [number, number];
            facings?: Record<string, { file: string; anchor?: [number, number] }>;
          })
        | undefined;
      if (!e) throw new LabError(404, 'no such catalog piece');
      const rotation = (e.rotation ?? (e.wall ? 'flat' : e.facings ? 'mirror' : 'radial')) as FurnitureSpec['rotation'];
      const d = store.create({
        kind: 'furniture',
        key,
        title: e.name ?? key,
        origin: key,
        furniture: {
          ...e,
          footprint: e.footprint ?? [1, 1],
          rotation,
          seat: e.seat ?? null,
          surface: e.surface ?? null,
          light: e.light ?? null,
          wallV: e.wall?.v,
          layer: (e.layer === 'wall' ? 'object' : e.layer) as FurnitureSpec['layer'],
          useFace: e.use?.face === 'any' ? 'any' : 'front',
        },
      });
      const take = resolve(store.dir(d.id), 'takes', '0');
      mkdirSync(take, { recursive: true });
      const recs: Array<[string, { file: string; anchor?: [number, number] }]> = e.facings ? Object.entries(e.facings) : e.file ? [['one', { file: e.file, anchor: e.anchor }]] : [];
      for (const [name, rec] of recs) {
        writeFileSync(resolve(take, `${name}.png`), readFileSync(resolve(PUBLIC_ART, 'sprites', rec.file)));
        d.views[name] = { file: `takes/0/${name}.png`, anchor: rec.anchor ?? [0, 0], nudge: [0, 0], take: 0, accepted: true };
      }
      d.takes.push({ n: 0, at: d.created, views: recs.map(([n]) => n), note: `from the catalog (${key})` });
      // what the catalog measured of its drawings (how tall it is, how its base stands on its footprint): staged as the
      // catalog has it (designlab.py stage), not the defaults for a new drawing
      const measured = e as { height?: number; base?: string };
      if (measured.height !== undefined || measured.base !== undefined)
        (d as Draft & { measured?: Record<string, unknown> }).measured = { ...(measured.height !== undefined ? { height: measured.height } : {}), ...(measured.base !== undefined ? { base: measured.base } : {}) };
      // a seat's arms, as its family has them (the seat framework builds the seat itself: src/shared/art/seatCatalog.ts)
      if (d.furniture && e.seat !== undefined) d.furniture.arms = !!seatProfile(key.split('.')[0], { arms: (e as { arms?: boolean }).arms }).arms;
      store.write(d);
      return d;
    }),
  );

  /**
   * A virtual art root for the sandbox: the published catalog with this draft's piece swapped in, so the real
   * renderer (loadArt(base)) shows the draft exactly as the game would.
   */
  r.get(
    '/art/:id/art/manifest.json',
    wrap((req) => {
      const d = store.read(req.params.id);
      const m = readManifest();
      if (d.kind === 'furniture' && d.furniture) {
        const f = d.furniture;
        const e: Record<string, unknown> = { name: f.name, category: f.category, footprint: f.footprint, height: f.height, fit: 'anchor', rotation: f.rotation };
        if (f.seat !== null) Object.assign(e, { seat: f.seat, sitStyle: f.sitStyle, backrest: f.backrest, arms: f.arms });
        if (f.surface !== null) e.surface = f.surface;
        if (f.light) e.light = f.light;
        if (f.rotation === 'flat') {
          // THE WALL ART STANDARD, as publishing stages it (art/designlab.py wall_standard): it hangs from the
          // band's bottom, as tall as its drawing at 2:1, in a span wide enough to hold it (never squeezed)
          const band = f.wallV ?? [18, 47];
          let size: { w: number; h: number } | null = null;
          try {
            const one = d.views.one?.file ? readFileSync(store.file(d.id, d.views.one.file)) : null;
            if (one && one.length >= 24) size = { w: one.readUInt32BE(16), h: one.readUInt32BE(20) };
          } catch {
            size = null;
          }
          e.wall = { v: size ? [band[0], band[0] + size.h / 2] : band };
          if (size) e.footprint = [Math.max(f.footprint[0], wallSpanFor(size.w)), 1];
        }
        for (const [name, v] of Object.entries(d.views)) {
          if (!v.file) continue;
          const rec = { file: `__draft__/${d.id}/${v.file}`, anchor: [(v.anchor?.[0] ?? 0) + (v.nudge?.[0] ?? 0), (v.anchor?.[1] ?? 0) + (v.nudge?.[1] ?? 0)] };
          if (name === 'one') Object.assign(e, rec);
          else ((e.facings as Record<string, unknown>) ??= {})[name] = rec;
        }
        m.sprites[d.key] = e;
      }
      return m;
    }),
  );
  r.get('/art/:id/art/sprites/*', (req, res) => {
    try {
      const rel = (req.params as Record<string, string>)[0];
      let p: string;
      if (rel.startsWith('__draft__/')) {
        const [, id, ...rest] = rel.split('/');
        p = store.file(id, rest.join('/'));
      } else {
        const base = resolve(PUBLIC_ART, 'sprites');
        p = resolve(base, rel);
        if (!p.startsWith(base + sep) || !existsSync(p)) throw new LabError(404, 'no such sprite');
      }
      res.type('image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(readFileSync(p));
    } catch (e) {
      res.status(e instanceof LabError ? e.status : 500).end();
    }
  });

  /** Every catalog piece with its rotation and the review's verdict (for the library). */
  r.get(
    '/library',
    wrap(async () => {
      const m = readManifest();
      const [fr, model] = await Promise.all([review(), modelCheckCatalog()]);
      const out = [];
      for (const [key, e] of Object.entries(m.sprites)) {
        let issues: string[] = [...(model[key] ?? [])];
        try {
          if (!e.wall) issues = [...new Set([...issues, ...fr.reviewEntry(key, e, 'public/art/sprites').issues])];
        } catch (err) {
          issues.push(`review failed: ${(err as Error).message}`);
        }
        out.push({
          key,
          name: (e.name as string) ?? null,
          category: (e.category as string) ?? null,
          rotation: (e.rotation as string) ?? null,
          wall: !!e.wall,
          footprint: e.footprint,
          seat: e.seat ?? null,
          facings: Object.keys((e.facings as object) ?? {}),
          issues,
        });
      }
      return { scale: m.scale, pieces: out };
    }),
  );

  /** Character parts in the libraries (for the library and "open as draft"). */
  r.get(
    '/parts',
    wrap(() => {
      const dir = resolve(process.cwd(), 'src', 'client', 'engine', 'sprites');
      const out: Record<string, string[]> = {};
      for (const k of PART_KINDS) {
        const p = resolve(dir, `${k}Lib.json`);
        out[k] = existsSync(p) ? Object.keys(JSON.parse(readFileSync(p, 'utf8')) as object) : [];
      }
      return out;
    }),
  );
  return r;
}
