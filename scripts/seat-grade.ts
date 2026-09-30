/**
 * THE SEAT GRADE (src/shared/art/seatGrade.ts), run over the catalog: every seat built from its spec, rendered in all
 * four facings, graded on its model, its render and its composition with every review look on every cushion, and its
 * files (public/art/sprites/<key>.<facing>.png, its manifest entry) checked against the render pixel for pixel.
 *
 *   node --no-maglev --import tsx scripts/seat-grade.ts [--keys a,b] [--out art/review/seat-grade] [--check]
 *
 * Writes one sheet per seat (art/review/seat-grade/<key>.png: each facing empty and with each look, at 2× and 4×) and
 * one of them all (all.png), and the report (report.json). --check (the gate) prints the failures and exits 1 on any.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SEAT_LOOKS } from '../src/shared/world/seatModels';
import { SIT_POSE_OF } from '../src/shared/world/seats';
import { SEAT_SPECS, seatArtOf, seatBuildOf } from '../src/shared/art/seatCatalog';
import { gradeModel, gradeRender, gradeSitter, sittingIn, type LookGrade } from '../src/shared/art/seatGrade';
import { composeSeat } from '../src/shared/art/seatCompose';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';
import { loadManifest } from './lib/manifest';
import { seatEntry, SEAT_FACINGS } from './lib/seatEntry';
import { blank, readPng, writePng, type Img } from './lib/png';
import { paste, row, scaled, stack, type RGB } from './lib/draw';
import { text } from './lib/font';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const OUT = arg('out') ?? 'art/review/seat-grade';
const check = process.argv.includes('--check');
const only = arg('keys')?.split(',');
mkdirSync(OUT, { recursive: true });
const manifest = loadManifest();
const BG: RGB = [46, 40, 54];

interface Report {
  key: string;
  problems: string[];
  facings: Record<string, { render: Record<string, number | string>; looks: LookGrade[] }>;
}

const toImg = (px: { w: number; h: number; d: Uint8ClampedArray | Uint8Array }): Img => ({ w: px.w, h: px.h, d: new Uint8Array(px.d.buffer, px.d.byteOffset, px.d.length) });
const onBg = (img: Img): Img => {
  const b = blank(img.w, img.h, BG, 255);
  paste(b, img, 0, 0);
  return b;
};
const label = (s: string, img: Img, colour: RGB = [230, 220, 200]): Img => {
  const out = blank(Math.max(img.w, s.length * 4 + 4), img.h + 12, BG, 255);
  text(out, 2, 2, s, colour, 1);
  paste(out, img, 0, 12);
  return out;
};

const reports: Report[] = [];
const sheets: Img[] = [];
const specs = SEAT_SPECS.filter((s) => !only || only.includes(s.key));
for (const spec of specs) {
  const key = spec.key;
  const b = seatBuildOf(key)!;
  const problems = gradeModel(b).map((p) => `model: ${p}`);
  const rep: Report = { key, problems, facings: {} };
  const rows: Img[] = [];
  const entry = manifest.sprites[key];
  const want = seatEntry(key);
  if (!entry) problems.push('files: no manifest entry (run scripts/seat-build.ts)');
  else if (JSON.stringify(entry) !== JSON.stringify(want)) problems.push('files: the manifest entry differs from the build (run scripts/seat-build.ts)');
  const pose = SIT_POSE_OF[b.style] as Pose;
  for (const f of SEAT_FACINGS) {
    const art = seatArtOf(key, f)!;
    const r = gradeRender(b, art);
    problems.push(...r.problems.map((p) => `${f}: ${p}`));
    // the file
    // (a radial seat's one drawing is its se render: the other facings turn its grain and tufting with the seat)
    const file = `public/art/sprites/${want.file ?? want.facings?.[f]?.file}`;
    if (!existsSync(file)) problems.push(`${f}: no drawing at ${file}`);
    else if (!want.file || f === 'se') {
      const png = readPng(file);
      let same = png.w === art.px.w && png.h === art.px.h;
      if (same) for (let i = 0; i < png.d.length && same; i++) if (png.d[i] !== art.px.d[i]) same = false;
      if (!same) problems.push(`${f}: ${file} isn't the render (run scripts/seat-build.ts)`);
    }
    const sitting = sittingIn(b.model, b.style, f);
    const looks: LookGrade[] = [];
    const cells: Img[] = [label(`${f} empty`, scaled(onBg(toImg(art.px)), 2))];
    let big: Img | null = null;
    sitting.forEach((S, cushion) => {
      if (!S) {
        problems.push(`${f}: cushion ${cushion} has no sitting point over its tile`);
        return;
      }
      SEAT_LOOKS.forEach((look, k) => {
        const fig = renderAvatarLayers(look, f, pose, S.legs);
        const g = gradeSitter(b, art, cushion, k, fig);
        looks.push(g);
        problems.push(...g.problems.map((p) => `${f}: ${p}`));
        const C = composeSeat(art, b.model, b.style, sitting.map((s) => s?.sit ?? null), sitting.map((s) => s?.legs ?? null), [{ cushion, fig }], 40);
        const img = onBg(toImg(C.px));
        cells.push(label(`c${cushion} L${k} ${g.problems.length ? 'FAIL' : 'ok'}`, scaled(img, 2), g.problems.length ? [255, 120, 120] : undefined));
        if (cushion === 0 && k === 0) big = scaled(img, 4);
      });
    });
    // everyone seated at once, at 4×
    if (sitting.every((s) => s)) {
      const all = composeSeat(
        art,
        b.model,
        b.style,
        sitting.map((s) => s!.sit),
        sitting.map((s) => s!.legs),
        sitting.map((S, c) => ({ cushion: c, fig: renderAvatarLayers(SEAT_LOOKS[c % SEAT_LOOKS.length], f, pose, S!.legs) })),
        40,
      );
      cells.push(label('all 4x', scaled(onBg(toImg(all.px)), 4)));
    }
    if (big) cells.push(label('L0 4x', big));
    rows.push(row(cells, BG, 6));
    rep.facings[f] = { render: r.measured, looks };
  }
  const head = blank(4, 14, BG, 255);
  text(head, 2, 2, `${key}  ${b.kind}  seat ${b.seat}  h ${b.height}  ${problems.length ? `${problems.length} PROBLEM(S)` : 'PASS'}`, problems.length ? [255, 120, 120] : [140, 230, 160], 1);
  const sheet = stack([head, ...rows], BG, 4);
  writePng(`${OUT}/${key}.png`, sheet);
  sheets.push(sheet);
  reports.push(rep);
  console.log(`${key.padEnd(22)} ${problems.length ? `FAIL ${problems.length}` : 'pass'}`);
  for (const p of problems) console.log(`   - ${p}`);
}
writePng(`${OUT}/all.png`, stack(sheets, BG, 12));
writeFileSync(`${OUT}/report.json`, JSON.stringify(reports, null, 1));
const failed = reports.filter((r) => r.problems.length);
console.log(`${reports.length - failed.length} of ${reports.length} seat(s) pass; sheets in ${OUT}/`);
if (check && failed.length) process.exit(1);
