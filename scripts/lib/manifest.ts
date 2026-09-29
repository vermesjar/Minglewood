/**
 * The art manifest from Node, honouring art/studio.py's ManifestLock (public/art/.manifest.lock, created
 * exclusively; stale after 60 s) and writing exactly as studio's save_manifest does (sorted keys, indent 2,
 * ASCII-escaped), so Python and Node writers never clobber each other or churn the file.
 */
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Manifest } from '../../src/shared/models';

export const MANIFEST = 'public/art/manifest.json';
const LOCK = 'public/art/.manifest.lock';

export function loadManifest(path = MANIFEST): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

export function saveManifest(m: Manifest, path = MANIFEST) {
  m.sprites = Object.fromEntries(Object.entries(m.sprites).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  // Python's json.dumps escapes everything past ASCII
  const json = JSON.stringify(m, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync(path, `${json}\n`);
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Read, change and write the manifest while holding studio's lock. */
export function withManifestLock<T>(fn: (m: Manifest) => T): T {
  let fd = -1;
  for (let i = 0; i < 600 && fd < 0; i++) {
    try {
      fd = openSync(LOCK, 'wx');
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 60_000) unlinkSync(LOCK);
      } catch {
        /* gone already */
      }
      sleep(100);
    }
  }
  if (fd < 0) throw new Error('manifest lock timed out');
  try {
    const m = loadManifest();
    const r = fn(m);
    saveManifest(m);
    return r;
  } finally {
    closeSync(fd);
    try {
      unlinkSync(LOCK);
    } catch {
      /* already released */
    }
  }
}
