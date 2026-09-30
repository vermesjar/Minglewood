/**
 * The animation specs are anchored to points in their drawings' own pixels: every drawing named must exist, and
 * every point, box and quad must lie on it (a spec left behind by a redrawn or renamed drawing fails here, not in
 * a playtest).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { animationSpecs } from './animations';
import { WATERWORKS } from './waterworks';

const SPRITES = resolve(__dirname, '../../../public/art/sprites');
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../public/art/manifest.json'), 'utf8')) as {
  sprites: Record<string, { file?: string }>;
};

/** A PNG's size, from its header. */
function size(file: string): [number, number] {
  const b = readFileSync(resolve(SPRITES, file));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Every [x, y] a spec names (points, the corners of boxes and quads), with where in the spec it sits. */
function points(v: unknown, path = ''): Array<[string, number, number]> {
  if (!v || typeof v !== 'object') return [];
  if (Array.isArray(v)) {
    if (v.length === 2 && v.every((n) => typeof n === 'number')) return [[path, v[0], v[1]]];
    if (/(rect|box)$/.test(path) && v.length === 4 && v.every((n) => typeof n === 'number'))
      return [
        [path, v[0], v[1]],
        [path, v[2], v[3]],
      ];
    return v.flatMap((x, i) => points(x, `${path}[${i}]`));
  }
  // (a foam ellipse's radii aren't a point)
  return Object.entries(v).flatMap(([k, x]) => (k === 'foam' ? [] : points(x, path ? `${path}.${k}` : k)));
}

function onDrawing(file: string, spec: unknown) {
  expect(existsSync(resolve(SPRITES, file)), `${file} exists`).toBe(true);
  const [w, h] = size(file);
  for (const [where, x, y] of points(spec)) {
    expect(x >= 0 && x <= w && y >= 0 && y <= h, `${file} ${where} (${x}, ${y}) lies on its ${w}×${h} drawing`).toBe(true);
  }
}

describe('animation specs', () => {
  const { byFile, walls } = animationSpecs();
  it('every animated drawing exists and every point lies on it', () => {
    for (const [file, specs] of Object.entries(byFile)) onDrawing(file, specs);
  });
  it('every animated wall piece has a drawing and its points lie on it', () => {
    for (const [key, spec] of Object.entries(walls)) {
      const file = manifest.sprites[key]?.file;
      if (!file) continue; // a procedural sign (neon): drawn in code, placed by fractions of its span
      onDrawing(file, spec);
    }
  });
  it('moving water lies on its drawing', () => {
    for (const [file, spec] of Object.entries(WATERWORKS)) onDrawing(file, spec);
  });
});
