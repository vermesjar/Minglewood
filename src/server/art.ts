/**
 * The art catalog from disk, for the server and the scripts: the manifest and each drawing's pixels, read the way
 * the client reads them (src/shared/art/source.ts), so rules that need to know what a drawing looks like — which
 * wall piece a tall plant hides — give the server exactly the answer decorate mode gave the player.
 *
 * In development the art is public/art (the Design Lab publishes there); a production build serves it from
 * dist/client/art. The manifest is re-read when it changes on disk (a piece just published), and the wall
 * catalog (src/shared/world/decor.ts) follows it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Manifest } from '@shared/models';
import type { ArtSource } from '@shared/art/source';
import type { Pixels } from '@shared/art/footing';
import { registerWallArt } from '@shared/world/decor';

/** An 8-bit PNG (RGBA, RGB, grey, grey+alpha or palette) as RGBA pixels. */
export function decodePng(b: Buffer): Pixels {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  let depth = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ct = data[9];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth}`);
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pp = a + up - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ct === 6) d.set(px.subarray(i * 4, i * 4 + 4), i * 4);
    else if (ct === 2) d.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
    else if (ct === 4) d.set([px[i * 2], px[i * 2], px[i * 2], px[i * 2 + 1]], i * 4);
    else if (ct === 3 && palette) {
      const k = px[i];
      d.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], i * 4);
    } else d.set([px[i], px[i], px[i], 255], i * 4);
  }
  return { w, h, d };
}

/** The catalog in `dir` (…/art: manifest.json and sprites/), re-read when it changes. */
export function fileArtSource(dir: string): ArtSource {
  let manifest: Manifest | null = null;
  let stamp = -1;
  let checked = 0;
  const pixels = new Map<string, { at: number; px: Pixels | null }>();
  const file = resolve(dir, 'manifest.json');
  return {
    manifest() {
      // (a stat at most every half second: placement checks call this per request)
      const now = Date.now();
      if (now - checked < 500 && manifest) return manifest;
      checked = now;
      try {
        const t = statSync(file).mtimeMs;
        if (t !== stamp) {
          manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
          stamp = t;
          registerWallArt(manifest);
        }
      } catch {
        /* keep what we had */
      }
      return manifest;
    },
    pixels(name: string) {
      const path = resolve(dir, 'sprites', name);
      let at = -1;
      try {
        at = statSync(path).mtimeMs;
      } catch {
        return null;
      }
      const hit = pixels.get(name);
      if (hit && hit.at === at) return hit.px;
      let px: Pixels | null = null;
      try {
        px = decodePng(readFileSync(path));
      } catch {
        px = null;
      }
      pixels.set(name, { at, px });
      return px;
    },
  };
}

/** Where the served art lives: public/art in development, the built client's copy in production. */
export function artDir(root = process.cwd()): string {
  for (const d of [resolve(root, 'public', 'art'), resolve(root, 'dist', 'client', 'art')]) if (existsSync(resolve(d, 'manifest.json'))) return d;
  return resolve(root, 'public', 'art');
}

let shared: ArtSource | null = null;
/** The server's art (placement checks). */
export function serverArt(): ArtSource {
  shared ??= fileArtSource(artDir());
  shared.manifest();
  return shared;
}
