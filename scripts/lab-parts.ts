/**
 * A Design Lab seat's PARTS on its staged drawings (src/client/engine/sprites/seatParts.ts): the pictures a vision model
 * is shown to propose them (art/designlab.py propose-parts), its answer applied, and the publish check — every own
 * view has a part map and its rig is what that compiles to — then the part maps stored beside the catalog's
 * (art/seat-parts/KEY.FACING.png). Each prints one JSON object.
 *
 *   npx tsx scripts/lab-parts.ts --entries E --sprites S --key KEY --facing F --sheet DIR
 *       → DIR/F.regions.png (the numbered regions), DIR/F.plain.png, DIR/F.json (studio.py vision-parts' meta)
 *   npx tsx scripts/lab-parts.ts --entries E --sprites S --key KEY --facing F --apply LABELS.json [--out PNG]
 *       → {"parts": the part map (seatParts.ts partsToString), "w", "h"}; --out also writes it as a part-map PNG
 *   npx tsx scripts/lab-parts.ts --entries E --sprites S --key KEY --parts PARTS.json --rig RIG.json [--write]
 *       PARTS.json: the draft's seatParts ({"views": {facing: parts}}); RIG.json: its seatRig (rigLab.ts DraftRig).
 *       → {"ok", "problems": [...], "written"?}: every own view has a part map of its drawing's size, and its rig's
 *       front layer is exactly what the part map compiles to with the rig's hips; --write stores the part maps.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Facing } from '../src/shared/world/scene';
import type { SeatRig } from '../src/shared/world/seatRigs';
import { rigCushions } from '../src/client/engine/sprites/seatRig';
import { encodeParts, isCompiled, partsFromLabels, partsFromString, partsToString, plainSheet, proposalMeta, regions, regionSheet, type PartLabels } from '../src/client/engine/sprites/seatParts';
import { writePng, type Img } from './lib/png';
import { ownFacings, profileOf, rigView, type Sprites } from './lib/rigs';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const key = arg('--key')!;
  const sprites = arg('--sprites')!;
  const M = JSON.parse(readFileSync(arg('--entries')!, 'utf8')) as Sprites;
  if (!M[key]) throw new Error(`no entry for ${key}`);
  // a view's drawing exactly as the game resolves it (its own; own views are never a partner's mirrored)
  const drawing = (f: Facing): Img => {
    const px = rigView(M, key, f, sprites).art.px;
    return { w: px.w, h: px.h, d: new Uint8Array(px.d.buffer, px.d.byteOffset, px.d.length) };
  };
  if (arg('--sheet')) {
    const f = arg('--facing') as Facing;
    const dir = arg('--sheet')!;
    const img = drawing(f);
    const lab = regions(img);
    const p = profileOf(M, key);
    const meta = proposalMeta(img, lab, {
      facing: f,
      name: String((M[key] as { name?: string }).name ?? key),
      cushions: rigCushions(M[key].footprint, f).length,
      sitStyle: p.sitStyle,
      backrest: p.backrest,
      arms: !!p.arms,
    });
    mkdirSync(dir, { recursive: true });
    writePng(`${dir}/${f}.regions.png`, regionSheet(img, lab, meta.zoom) as Img);
    writePng(`${dir}/${f}.plain.png`, plainSheet(img, meta.zoom) as Img);
    writeFileSync(`${dir}/${f}.json`, JSON.stringify(meta, null, 2));
    console.log(JSON.stringify({ ok: true, regions: meta.regions.length, image: `${dir}/${f}.regions.png`, plain: `${dir}/${f}.plain.png`, meta: `${dir}/${f}.json` }));
  } else if (arg('--apply')) {
    const f = arg('--facing') as Facing;
    const img = drawing(f);
    const labels = JSON.parse(readFileSync(arg('--apply')!, 'utf8')) as PartLabels;
    const parts = partsFromLabels(regions(img), img.w, labels);
    if (arg('--out')) writePng(arg('--out')!, encodeParts(img.w, img.h, parts) as Img);
    console.log(JSON.stringify({ ok: true, parts: partsToString(parts), w: img.w, h: img.h }));
  } else {
    const draft = JSON.parse(readFileSync(arg('--parts')!, 'utf8')) as { views?: Partial<Record<Facing, string>> };
    const rig = JSON.parse(readFileSync(arg('--rig')!, 'utf8')) as { views?: Partial<Record<Facing, SeatRig>> };
    const problems: string[] = [];
    const maps: Array<{ f: Facing; img: Img; parts: Uint8Array }> = [];
    for (const f of ownFacings(M, key)) {
      const img = drawing(f);
      const text = draft.views?.[f];
      const parts = text ? partsFromString(text, img.w * img.h) : null;
      if (!text) problems.push(`${f}: no part map (Propose, or copy the parts from a piece in the same shape)`);
      else if (!parts) problems.push(`${f}: the part map doesn't fit the drawing (the drawing changed: propose again)`);
      else if (!rig.views?.[f]) problems.push(`${f}: not compiled into a rig`);
      else if (!isCompiled(rig.views[f]!, f, img.w, img.h, parts)) problems.push(`${f}: the rig isn't what the part map compiles to (change a part or a hip to compile it again)`);
      if (parts) maps.push({ f, img, parts });
    }
    let written: string[] | undefined;
    if (!problems.length && process.argv.includes('--write')) {
      mkdirSync('art/seat-parts', { recursive: true });
      written = maps.map(({ f, img, parts }) => {
        const file = `art/seat-parts/${key}.${f}.png`;
        writePng(file, encodeParts(img.w, img.h, parts) as Img);
        return file;
      });
    }
    console.log(JSON.stringify({ ok: !problems.length, problems, ...(written ? { written } : {}) }));
    process.exit(problems.length ? 1 : 0);
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: (err as Error).message, problems: [] }));
  process.exit(2);
}
