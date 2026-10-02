import { describe, expect, it } from 'vitest';
import { FIG, drawingPrint, figAx, figSeatRowFor } from '@shared/world/seatFigure';
import { projectLocal, SEAT_LOOKS, type SeatModel } from '@shared/world/seatModels';
import { type SitLegs } from '@shared/world/sitLegs';
import { renderAvatarLayers } from './avatarQa';
import { kitFrame } from './avatarKit';
import { type Pose } from './avatarFrame';
import { sitterMask } from './seatLayers';
import { surfacePartsSignature, type ModelView } from './seatModel';

/** An extended painted cushion projects across the hanging shin. Its plane
 * alone says it is higher, but the seated shin is in front of that cushion. */
function fixture(options: { reach?: number; pose?: Pose; rear?: boolean; arm?: boolean; back?: boolean; wrap?: boolean; wrapSide?: 'near' | 'far'; offset?: number } = {}) {
  const facing = options.rear ? 'ne' : 'se', pose = options.pose ?? 'sit';
  const model: SeatModel = { size: [1, 1], sits: [[0.5, 0.42, 12]], parts: [
    { part: 'seat', u: [0.32, 0.68], v: [0.22, 0.74], z: [9, 12] },
    { part: options.wrap ? 'wrap' : options.back ? 'back' : 'arm',
      u: options.wrap ? options.wrapSide === 'near' ? [0.8, 1] : options.wrapSide === 'far' ? [0, 0.2] : [0.2, 0.8] : [0.97, 1.035],
      v: [0.11, 0.92], z: options.wrap ? [0, 2] : [2.75, 18] },
  ] };
  const legs: SitLegs = { reach: options.reach ?? 0.35, rise: 0, drop: 11, toe: 0.03, hang: 2.5 };
  const f = kitFrame(SEAT_LOOKS[0], options.rear ? 'back' : 'front', pose, legs);
  const x = Math.round(f.legNear.m[0]), y = Math.round(f.legNear.m[1] + (options.rear ? 15 : 8)), index = y * FIG.w + x;
  const p = projectLocal([0, 0], model.size, facing, ...model.sits[0]);
  const px = { w: FIG.w, h: FIG.h, d: new Uint8Array(FIG.w * FIG.h * 4) };
  px.d.set([220, 180, 20, 255], index * 4);
  const labels = new Array<number>(FIG.w * FIG.h).fill(0);
  labels[index] = options.arm || options.back || options.wrap ? 4 : 1;
  model.surfaces = { [facing]: { version: 1, width: px.w, height: px.h,
    drawing: drawingPrint(px.w, px.h, px.d), modelParts: surfacePartsSignature(model), labels } };
  const view: ModelView = { model, facing, style: 'chair', art: { px, ax: figAx(facing) - p[0], ay: figSeatRowFor('chair') - p[1] } };
  const feet: [number, number] = [figAx(facing) + (options.offset ?? 0), FIG.feet];
  const figureIndex = index - (options.offset ?? 0);
  expect(renderAvatarLayers(SEAT_LOOKS[0], facing, pose, legs).px[figureIndex * 4 + 3]).toBe(255);
  return sitterMask(view, SEAT_LOOKS[0], facing, pose, feet, legs, 13.5)[figureIndex];
}

describe('the supporting cushion and hanging shins', () => {
  it('keeps a settled shin in front when its knees clear the cushion', () => expect(fixture()).toBe(0));
  it('does not excuse a tucked knee that remains inside the cushion', () => expect(fixture({ reach: 0.05 })).toBe(1));
  it('does not use the seated relation during a crouching transition', () => expect(fixture({ pose: 'crouch' })).toBe(1));
  it('does not use it while the figure is still moving into place', () => expect(fixture({ offset: 1 })).toBe(1));
  it('preserves rear-view cushion depth', () => expect(fixture({ rear: true })).toBe(1));
  it('preserves a foreground arm across the very same shin pixel', () => expect(fixture({ arm: true })).toBe(1));
  it('keeps the backrest behind a settled front-facing sitter', () => expect(fixture({ back: true })).toBe(0));
  it('keeps the same backrest over a rear-facing sitter', () => expect(fixture({ back: true, rear: true })).toBe(1));
  it('keeps an explicitly painted rear shell over the body despite an undersized wrap proxy', () => expect(fixture({ wrap: true, rear: true })).toBe(1));
  it('does not promote a low wrap into the foreground in a front view', () => expect(fixture({ wrap: true })).toBe(0));
  it('keeps the near side of a soft seat over its sitter in either view', () => {
    expect(fixture({ wrap: true, wrapSide: 'near' })).toBe(1);
    expect(fixture({ wrap: true, wrapSide: 'near', rear: true })).toBe(1);
  });
  it('keeps the opposite soft rim behind its sitter in either view', () => {
    expect(fixture({ wrap: true, wrapSide: 'far' })).toBe(0);
    expect(fixture({ wrap: true, wrapSide: 'far', rear: true })).toBe(0);
  });
});
