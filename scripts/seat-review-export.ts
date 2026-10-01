/** Strict independent-review input boundary: never export masks, mapped surfaces, masked figures or final canvas. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LAYER, kitFrame } from '../src/client/engine/sprites/avatarKit';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';
import { reviewedFigureContext } from './lib/seat-review-context';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const input = arg('capture'), out = arg('out'), key = arg('key'), onlyContext = arg('context');
if (!input || !out || !key) throw new Error('--capture FILE --out DIRECTORY --key KEY required');
const records = JSON.parse(readFileSync(input, 'utf8'));
mkdirSync(out, { recursive: true });
for (const facing of ['se', 'sw', 'ne', 'nw']) {
  const selected = records.filter((r: any) => r.facing === facing && (!onlyContext || `${facing}-${r.reviewLook}-${r.cushion}` === onlyContext));
  if (!selected.length) continue;
  const a = selected[0].art;
  const contexts = selected.map((r: any) => {
    const original = renderAvatarLayers(r.look, r.facing, r.pose, r.legs);
    if (original.owner.length !== r.figure.owner.length || original.owner.some((v, i) => v !== r.figure.owner[i]) ||
        original.px.some((v, i) => (i % 4 === 3 || original.px[i - i % 4 + 3] > 0) && v !== r.figure.rgba[i]))
      throw new Error('Original avatar differs from current frame source; recapture before deriving anatomical evidence');
    const F = kitFrame(r.look, ['ne', 'nw'].includes(facing) ? 'back' : 'front', r.pose, r.legs);
    const mirror = ['sw', 'nw'].includes(facing);
    const origin = [Math.round(r.feet[0]) - r.figure.ax, Math.round(r.feet[1]) - r.figure.ay];
    // Kit joints are continuous coordinates; raster cells reflect with w-1-x,
    // but their geometry reflects with w-x (Mask.fill samples x+.5).
    const project = (p: number[]) => [origin[0] + (mirror ? r.figure.w - p[0] : p[0]), origin[1] + p[1]];
    const limb = (l: typeof F.legNear) => ({hip: project(l.a), knee: project(l.m), ankle: project(l.b),
      hipHeight:r.height, kneeHeight:r.height + (r.legs?.rise ?? (F.hipY-l.m[1])/2),
      ankleHeight:r.height + (r.legs ? r.legs.rise-r.legs.drop+2.5 : (F.hipY-l.b[1])/2)});
    return ({
    id: `${facing}-${r.reviewLook}-${r.cushion}`, case: `${r.id}/${facing}/${r.cushion}`,
    context: { key, facing, cushion: r.cushion, pose: r.pose, look: r.look, modelSource: r.model.compiler?.source,
      figureContext: reviewedFigureContext(r) },
    anatomy: {version:2, unit:'world vertical pixels; source drawing is 2x density', hipCenter:project([F.hx,F.hipY]), hipContact:project([F.hx,F.hipY+3]),
      waistRow:origin[1]+F.waistY, hipRow:origin[1]+F.hipY, pelvisBottomRow:origin[1]+F.hipY+3, hipCenterHeight:r.height,
      nearLeg:{...limb(F.legNear),heel:!!F.heelNear},farLeg:{...limb(F.legFar),heel:!!F.heelFar},torso:F.torso.map(project),
      handNear:project(F.handNear),standingFeetRow:origin[1]+104,
      nearArm:{shoulder:project(F.armNear.a),elbow:project(F.armNear.m),wrist:project(F.armNear.b)},
      farArm:{shoulder:project(F.armFar.a),elbow:project(F.armFar.m),wrist:project(F.armFar.b)}},
    figure: { w: r.figure.w, h: r.figure.h, ax: r.figure.ax, ay: r.figure.ay, rgba: r.figure.rgba, owner: r.figure.owner,
      sealed: Array.from(original.sealed ?? new Uint8Array(original.owner.length)),
      sourceMetadataVersion: original.sourceMetadataVersion,
      shoeLimb: Array.from(original.shoeLimb ?? new Uint8Array(original.owner.length)),
      bodyPocket: Array.from(original.bodyPocket ?? new Uint8Array(original.owner.length)),
      lowerGarment: original.lowerGarment ? {...original.lowerGarment,mask:Array.from(original.lowerGarment.mask)} : null },
  }); });
  const data = { version: 1, key, facing, sourceArt: { width: a.w, height: a.h, anchor: [a.ax, a.ay], rgba: a.rgba },
    sourceViews: Object.fromEntries(['se', 'sw', 'ne', 'nw'].map(f => {
      const v = records.find((r: any) => r.facing === f)?.art;
      return [f, v ? { width: v.w, height: v.h, rgba: v.rgba } : null];
    })),
    ownerNames: Object.fromEntries(Object.entries(LAYER).map(([name, code]) => [code, name])), contexts };
  const serialized = JSON.stringify(data);
  writeFileSync(`${out}/${facing}.json`, serialized);
  console.log(JSON.stringify({ facing, contexts: contexts.length, independentInputSha256: createHash('sha256').update(serialized).digest('hex') }));
}
