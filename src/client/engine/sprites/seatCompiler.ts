/** The automatic seating compiler shared by the Design Lab and the catalog build. */
import { MODEL_FACINGS, modelShapeProblems, seatPlacementProblems, type SeatModel } from '@shared/world/seatModels';
import { drawingPrint } from '@shared/world/seatFigure';
import { fitModel, type Family, type FitInput } from './seatModelFit';
import { seatProblems } from './seatLayers';
import { resolveSeatSurfaceMap } from './seatModel';

export interface SeatCompileInput extends FitInput {
  /** Preserve generated labels across compilation only when final drawings and geometry still match. */
  surfaces?: SeatModel['surfaces'];
}

export function attachSeatSurfaces(model: SeatModel, input: Pick<SeatCompileInput, 'surfaces' | 'views' | 'style'>): SeatModel {
  if (input.surfaces === undefined) return model;
  if (Object.values(input.surfaces).some(map => map?.version === 2) &&
      (input.views.length !== MODEL_FACINGS.length || MODEL_FACINGS.some(f => !input.views.some(v => v.facing === f))))
    throw new Error('Authored seating depth must be checked against all four final source drawings.');
  const mapped = { ...model, surfaces: structuredClone(input.surfaces) };
  if (!mapped.surfaces) throw new Error('Malformed seating surface maps.');
  for (const view of input.views) resolveSeatSurfaceMap({ ...view, model: mapped, style: input.style });
  return mapped;
}

export const SEAT_COMPILER_VERSION = 4;

/** Mechanics follow the declaration, not the spelling of an asset's name. */
export function seatFamily(input: Pick<FitInput, 'size' | 'style' | 'backrest' | 'arms'>): Family {
  if (input.style === 'floor') return input.backrest ? 'beanbag' : 'floor-cushion';
  if (input.style === 'stool') return 'stool';
  if (input.size[0] > 1) return input.style === 'lounge' ? 'couch' : 'bench';
  if (input.style === 'lounge') return 'armchair';
  if (!input.backrest && !input.arms) return 'ottoman';
  return 'chair';
}

export interface CompiledSeat {
  version: number;
  model: SeatModel;
  problems: string[];
}

export function seatCompileSignature(input: FitInput): string {
  return sourceSignature(input, SEAT_COMPILER_VERSION);
}

function sourceSignature(input: FitInput, version: number): string {
  return JSON.stringify([version, input.size, input.seat, input.style, input.backrest, input.arms,
    input.family ?? seatFamily(input), input.views.map(({ facing, art }) => [facing, art.ax, art.ay, drawingPrint(art.px.w, art.px.h, art.px.d)])]);
}

/** Validation of already published geometry only. Draft freshness always uses seatCompileSignature.
 * Version 2 predates arch topology and version 3 predates source-sized posterior contact.
 * Recognizing their unchanged source does not recompile,
 * re-sign, or certify its physical geometry or independent pixel evidence. */
export function publishedSeatSourceStatus(model: SeatModel, input: FitInput): 'current' | 'legacy-v2' | 'legacy-v3' | 'stale' {
  const compiler = model.compiler;
  if (!compiler || model.views || model.over) return 'stale';
  if (compiler.version === SEAT_COMPILER_VERSION && compiler.source === seatCompileSignature(input)) return 'current';
  if (compiler.version === 2 && compiler.source === sourceSignature(input, 2)) return 'legacy-v2';
  if (compiler.version === 3 && compiler.source === sourceSignature(input, 3)) return 'legacy-v3';
  return 'stale';
}

/** No old rig, per-view nudge, traced mask, or hand-authored part is an input. */
export function compileSeat(input: SeatCompileInput): CompiledSeat {
  if (input.views.length !== 4 || MODEL_FACINGS.some((f) => !input.views.some((v) => v.facing === f))) throw new Error('Seating needs all four resolved views.');
  if (input.size[1] !== 1 || !Number.isInteger(input.size[0]) || input.size[0] < 1) throw new Error('Seats need one row of cushions and a whole-number width.');
  const fitInput = { ...input, family: input.family ?? seatFamily(input), hintU: undefined };
  let fitted = fitModel(fitInput, undefined, { shakes: 8 });
  const problemsFor = (model: SeatModel) => [...modelShapeProblems(model, input.size[0]), ...seatPlacementProblems(model),
    ...input.views.flatMap((view) => seatProblems({ ...view, model, style: input.style }))];
  if (problemsFor(fitted.model).length) {
    const retry = fitModel(fitInput, undefined, { shakes: 40 });
    if (problemsFor(retry.model).length < problemsFor(fitted.model).length || retry.score > fitted.score && problemsFor(retry.model).length <= problemsFor(fitted.model).length) fitted = retry;
  }
  const model: SeatModel = attachSeatSurfaces({
    ...fitted.model,
    compiler: { version: SEAT_COMPILER_VERSION, source: seatCompileSignature(input) },
    drawings: Object.fromEntries(input.views.map(({ facing, art }) => [facing, drawingPrint(art.px.w, art.px.h, art.px.d)])),
  }, input);
  const problems = [...modelShapeProblems(model, input.size[0]), ...seatPlacementProblems(model)];
  if (input.arms && model.parts.filter(p => p.part === 'arm').length < 2)
    problems.push('An armed seat must contain both arm surfaces.');
  if (input.backrest && !model.parts.some(p => p.part === 'back' || p.part === 'wrap'))
    problems.push('A seat with a back must contain a back or wrap surface.');
  for (const view of input.views) for (const problem of seatProblems({ ...view, model, style: input.style })) problems.push(`${view.facing}: ${problem}`);
  return { version: SEAT_COMPILER_VERSION, model, problems };
}
