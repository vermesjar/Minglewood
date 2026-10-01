import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SeatModel } from '@shared/world/seatModels';
import { cleanFurniture, cleanSeatModel, devLabRoutes, DraftStore, isLocalRequest, LabError, MAX_REF_BYTES, zipDir } from './devLab';

const req = (over: { ip?: string; headers?: Record<string, string>; method?: string } = {}) => ({
  socket: { remoteAddress: over.ip ?? '127.0.0.1' },
  headers: { host: 'localhost:5173', ...(over.headers ?? {}) },
  method: over.method ?? 'GET',
});

describe('the Design Lab only answers this machine', () => {
  it('lets a local browser in', () => {
    expect(isLocalRequest(req())).toBe(true);
    expect(isLocalRequest(req({ ip: '::1', headers: { host: '127.0.0.1:8787' } }))).toBe(true);
    expect(isLocalRequest(req({ method: 'POST', headers: { 'x-lab': '1', origin: 'http://localhost:5173' } }))).toBe(true);
  });
  it('refuses the LAN, tunnels and DNS rebinding', () => {
    expect(isLocalRequest(req({ ip: '192.168.1.20' }))).toBe(false);
    expect(isLocalRequest(req({ headers: { 'x-forwarded-for': '203.0.113.9' } }))).toBe(false);
    expect(isLocalRequest(req({ headers: { 'cf-connecting-ip': '203.0.113.9' } }))).toBe(false);
    expect(isLocalRequest(req({ headers: { host: 'minglewood.trycloudflare.com' } }))).toBe(false);
    expect(isLocalRequest(req({ headers: { host: 'evil.example:5173' } }))).toBe(false);
    expect(isLocalRequest(req({ headers: { referer: 'https://evil.example/page' } }))).toBe(false);
  });
  it('refuses cross-site writes', () => {
    expect(isLocalRequest(req({ method: 'POST' }))).toBe(false); // no x-lab header: a plain form post
    expect(isLocalRequest(req({ method: 'POST', headers: { 'x-lab': '1', origin: 'https://evil.example' } }))).toBe(false);
    expect(isLocalRequest(req({ method: 'DELETE', headers: { origin: 'http://localhost:5173' } }))).toBe(false);
  });
});

describe('drafts on disk', () => {
  let root: string;
  let store: DraftStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lab-'));
    store = new DraftStore(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

  it('creates, lists and reads a furniture draft with a clean spec', () => {
    const d = store.create({ kind: 'furniture', key: 'bench.oak', furniture: { category: 'seating', footprint: [9, 0] as unknown as [number, number], rotation: 'spin' as never, seat: 11 } });
    expect(d.id).toMatch(/^bench-oak-[0-9a-f]{6}$/);
    expect(d.furniture).toMatchObject({ footprint: [4, 1], rotation: 'mirror', seat: 11 });
    expect(store.list().map((s) => s.id)).toEqual([d.id]);
    expect(store.read(d.id).key).toBe('bench.oak');
  });

  it('rejects bad keys and ids', () => {
    expect(() => store.create({ kind: 'furniture', key: '../escape' })).toThrow(LabError);
    expect(() => store.read('../../etc')).toThrow(LabError);
  });

  it('keeps reference images honest: type, magic bytes and size', () => {
    const d = store.create({ kind: 'part', key: 'wavy-bob' });
    const name = store.addRef(d.id, 'image/png', png);
    expect(store.read(d.id).refs).toEqual([name]);
    expect(() => store.addRef(d.id, 'image/gif', png)).toThrow(/PNG, JPEG or WebP/);
    expect(() => store.addRef(d.id, 'image/jpeg', png)).toThrow(/not the image type/);
    expect(() => store.addRef(d.id, 'image/png', Buffer.alloc(MAX_REF_BYTES + 1))).toThrow(/8 MB/);
  });

  it('never serves a file outside the draft', () => {
    const d = store.create({ kind: 'furniture', key: 'lamp.brass' });
    expect(store.file(d.id, 'draft.json')).toContain(d.id);
    expect(() => store.file(d.id, '../../../package.json')).toThrow(LabError);
  });

  it('discarding moves a draft aside instead of deleting it', () => {
    const d = store.create({ kind: 'furniture', key: 'desk.walnut' });
    store.discard(d.id);
    expect(store.has(d.id)).toBe(false);
    expect(readdirSync(join(root, '.trash')).some((n) => n.startsWith(d.id))).toBe(true);
  });

  it('exports a draft as a zip', () => {
    const d = store.create({ kind: 'furniture', key: 'plant.fern' });
    const z = zipDir(store.dir(d.id));
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(existsSync(store.dir(d.id))).toBe(true);
  });

  it('names a piece in a few words: from its key until it has a name, never from the prompt', () => {
    const d = store.create({ kind: 'furniture', key: 'bench-garden.teal', furniture: { prompt: 'Steampunk inspired coffee machine; lots of dials and very intricate.' } });
    expect(d.furniture?.name).toBe('Teal bench garden');
    expect(d.title).toBe('Teal bench garden');
    expect(cleanFurniture({ name: 'x'.repeat(100) }).name).toHaveLength(40);
  });

  it('keeps a seat model on seating only, with its per-view sitting points and traced over layers', () => {
    const model: SeatModel = {
      size: [1, 1],
      parts: [
        { part: 'seat', u: [0.1, 0.9], v: [0, 0.9], z: [4, 11.004] },
        { part: 'back', u: [0, 1], v: [0.7, 0.95], z: [11, 26] },
      ],
      sits: [[0.5, 0.45, 11]],
      views: { ne: [[0.5, 0.8]], sw: [[0.5, 0.4, 3] as never] },
      over: { nw: [[[1, 2], [30, 2], [30, 20]], [[1, 1]]] },
      fitted: '2026-09-29',
      reviewed: '2026-09-29',
    };
    const draft = { model, reviewed: '2026-09-30', for: 'sig' };
    expect(cleanFurniture({ category: 'decor', seatModel: draft }).seatModel).toBeNull();
    const kept = cleanFurniture({ category: 'seating', seatModel: draft }).seatModel!;
    expect(kept.reviewed).toBe('2026-09-30');
    expect(kept.for).toBe('sig');
    expect(kept.model.parts[0].z).toEqual([4, 11]);
    // a well-formed view's nudge is kept, a malformed one dropped; a traced layer keeps its polygons (not a lone point)
    expect(kept.model.views).toEqual({ ne: [[0.5, 0.8]] });
    expect(kept.model.over).toEqual({ nw: [[[1, 2], [30, 2], [30, 20]]] });
    expect(kept.model.fitted).toBe('2026-09-29');
    // the day it's passed is the draft's; the model's own stamps are written at publish (scripts/lab-model.ts)
    expect(kept.model.reviewed).toBeUndefined();
    expect(cleanSeatModel({ model: { ...model, parts: [] }, for: 'sig' })).toBeNull();
    // A body-contact policy without semantic surfaces must be rejected, not silently erased.
    expect(() => cleanSeatModel({ model: { ...model, bodyContact: { version: 1 } }, for: 'sig' })).toThrow();
  });

  it('keeps nothing of how seats were rigged and calibrated before their models', () => {
    // a draft saved by the old Lab: its rig, its calibration and the catalog's hip depths go on its next save
    const f = cleanFurniture({ category: 'seating', seatRig: { views: {} }, seatCalibration: { cushion: [1, 2] }, catalogProfile: { seatDepth: 0 } } as never);
    expect(Object.keys(f).filter((k) => /seat|profile|calibration/i.test(k)).sort()).toEqual(['seat', 'seatKind', 'seatModel']);
  });

  it('supplies mechanics from a seating type without calibration fields', () => {
    expect(cleanFurniture({ category: 'seating', seatKind: 'beanbag' })).toMatchObject({ seat: 6, sitStyle: 'floor', backrest: true, arms: false });
    expect(cleanFurniture({ category: 'seating', seatKind: 'couch' })).toMatchObject({ footprint: [2, 1], seat: 10, sitStyle: 'lounge', arms: true });
    expect(cleanFurniture({ category: 'seating', seatKind: 'floor-cushion' })).toMatchObject({ height: 3, seat: 3, sitStyle: 'floor', backrest: false });
    expect(cleanFurniture({ category: 'seating', seatKind: 'chair', arms: true })).toMatchObject({ arms: true });
  });

  it('clamps a spec to what the pipeline accepts', () => {
    const f = cleanFurniture({ height: 9999, quality: 'ultra' as never, prompts: { se: 'x'.repeat(2000) }, actions: [{ kind: 'sit' }, { nope: 1 } as never] });
    expect(f.height).toBe(200);
    expect(f.quality).toBe('medium');
    expect(f.prompts.se).toHaveLength(600);
    expect(f.actions).toEqual([{ kind: 'sit' }]);
  });
});

describe('checks on one draft never overlap', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('resumes seating checks on existing beauty and returns pending quality as structured progress', async () => {
    root = mkdtempSync(join(tmpdir(), 'lab-'));
    const store = new DraftStore(root);
    const seat = store.create({ kind: 'furniture', key: 'seat-retry', furniture: { category: 'seating' } });
    const lamp = store.create({ kind: 'furniture', key: 'lamp-retry' });
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return { code: 1, result: { problems: ['Transition visual evidence remains pending.'] } };
    };
    const server = express().use('/lab', devLabRoutes(root, { run })).listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const headers = { 'x-lab': '1', origin: 'http://localhost:5196' };
      const response = await fetch(`http://127.0.0.1:${port}/lab/drafts/${seat.id}/seat-review`, { method: 'POST', headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ problems: ['Transition visual evidence remains pending.'] });
      expect(calls[0][0]).toBe('furniture-surfaces');
      expect(calls[0]).toContain('http://localhost:5196');
      expect(calls[0]).not.toContain('furniture-generate');
      const unsupported = await fetch(`http://127.0.0.1:${port}/lab/drafts/${lamp.id}/seat-review`, { method: 'POST', headers });
      expect(unsupported.status).toBe(400);
      expect(calls).toHaveLength(1);
    } finally { server.close(); }
  });

  it('five checks fired at once all answer, and the art tool never runs two at a time', async () => {
    root = mkdtempSync(join(tmpdir(), 'lab-'));
    const store = new DraftStore(root);
    const d = store.create({ kind: 'furniture', key: 'desk-oak' });
    let active = 0;
    let most = 0;
    let runs = 0;
    // a stand-in for designlab.py furniture-check: rewrites the draft's stage slowly, then reads it back
    const run = async (args: string[]) => {
      runs++;
      active++;
      most = Math.max(most, active);
      const stage = join(root, d.id, 'stage');
      mkdirSync(stage, { recursive: true });
      const entry = { [d.key]: { name: 'Oak desk', note: 'x'.repeat(20_000) } };
      writeFileSync(join(stage, 'entries.json'), JSON.stringify(entry).slice(0, 5000)); // half-written…
      await new Promise((r) => setTimeout(r, 30));
      writeFileSync(join(stage, 'entries.json'), JSON.stringify(entry)); // …then whole
      await new Promise((r) => setTimeout(r, 30));
      const back = JSON.parse(readFileSync(join(stage, 'entries.json'), 'utf8')) as Record<string, unknown>;
      active--;
      return { code: 1, result: { problems: ['draw the se, nw view(s)'], entry: back[d.key], sprites: stage, args } };
    };
    const app = express().use('/lab', devLabRoutes(root, { run }));
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await Promise.all(
        Array.from({ length: 5 }, () => fetch(`http://127.0.0.1:${port}/lab/drafts/${d.id}/check`, { method: 'POST', headers: { 'x-lab': '1' } })),
      );
      const bodies = (await Promise.all(res.map((r) => r.json()))) as Array<{ problems?: string[]; error?: string }>;
      expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      for (const b of bodies) {
        expect(b.error).toBeUndefined();
        expect(b.problems).toEqual(['draw the se, nw view(s)']);
      }
      expect(most).toBe(1);
      expect(runs).toBeLessThanOrEqual(2); // one running, the rest share the one queued behind it
    } finally {
      server.close();
    }
  }, 30_000); // a real server and real files: generous for a loaded machine
});
