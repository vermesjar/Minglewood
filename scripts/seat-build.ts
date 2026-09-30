/**
 * Build the catalog's seats: every spec in src/shared/art/seatCatalog.ts drawn in all four facings by the seat
 * renderer into public/art/sprites/<key>.<facing>.png, with its manifest entry (THE MODEL SPEC, src/shared/models.ts)
 * written under studio's manifest lock. The game draws seats from the same specs at runtime; these files are for the
 * server (src/server/art.ts), the furniture review and the Design Lab, and scripts/seat-grade.ts proves they match.
 *
 *   node --no-maglev --import tsx scripts/seat-build.ts [--keys a,b] [--dry]
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { SEAT_SPECS, seatArtOf, seatBuildOf } from '../src/shared/art/seatCatalog';
import type { Facing } from '../src/shared/world/scene';
import { buildProblems } from '../src/shared/world/seatSpec';
import { withManifestLock } from './lib/manifest';
import { writePng } from './lib/png';
import { seatEntry } from './lib/seatEntry';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const dry = process.argv.includes('--dry');
const only = arg('keys')?.split(',');
const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
const DIR = 'public/art/sprites';

const specs = SEAT_SPECS.filter((s) => !only || only.includes(s.key));
let bad = 0;
for (const s of specs) {
  const b = seatBuildOf(s.key)!;
  const problems = buildProblems(b);
  if (problems.length) {
    bad++;
    console.error(`${s.key}: ${problems.join('; ')}`);
    continue;
  }
  const e = seatEntry(s.key);
  for (const f of FACINGS) {
    const art = seatArtOf(s.key, f)!;
    const file = `${s.key}.${f}.png`;
    if (e.file !== file && e.facings?.[f]?.file !== file) continue;
    if (!dry) writePng(`${DIR}/${file}`, { w: art.px.w, h: art.px.h, d: new Uint8Array(art.px.d.buffer, art.px.d.byteOffset, art.px.d.length) });
  }
  console.log(`${s.key.padEnd(22)} ${b.kind.padEnd(9)} seat ${String(b.seat).padStart(4)}  h ${String(b.height).padStart(4)}  parts ${b.model.parts.length}`);
}
if (bad) {
  console.error(`${bad} seat(s) don't build`);
  process.exit(1);
}
if (!dry) {
  withManifestLock((m) => {
    for (const s of specs) {
      const e = seatEntry(s.key);
      const old = m.sprites[s.key];
      // the old drawings of this seat that the new entry doesn't use
      const keep = new Set([e.file, ...Object.values(e.facings ?? {}).map((f) => f!.file)].filter((f): f is string => !!f));
      const files = [old?.file, ...Object.values(old?.facings ?? {}).map((f) => f?.file)].filter((f): f is string => !!f && !keep.has(f));
      for (const f of files) if (existsSync(`${DIR}/${f}`)) unlinkSync(`${DIR}/${f}`);
      m.sprites[s.key] = e;
    }
  });
  // stray seat drawings of keys no longer in the catalog (only when building everything)
  if (!only) {
    const catalog = new Set(SEAT_SPECS.map((s) => s.key));
    for (const f of readdirSync(DIR)) {
      const mt = f.match(/^([a-z][\w-]*(?:\.[\w-]+)?)\.(se|sw|ne|nw)\.png$/);
      if (mt && !catalog.has(mt[1]) && /^(chair|couch|armchair|stool|bench|beanbag|ottoman|heirloom-throne)/.test(mt[1])) console.log(`stray seat drawing: ${f}`);
    }
  }
}
console.log(`${specs.length} seat(s) built${dry ? ' (dry run)' : ''}`);
