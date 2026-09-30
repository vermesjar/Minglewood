/** The manifest entry a built catalog seat declares (THE MODEL SPEC, src/shared/models.ts): what scripts/seat-build.ts writes and scripts/seat-grade.ts checks. */
import { seatArtOf, seatBuildOf } from '../../src/shared/art/seatCatalog';
import type { ModelSpec } from '../../src/shared/models';
import type { Facing } from '../../src/shared/world/scene';
import { centredAnchor } from '../../src/shared/art/footing';
import { placedSize } from '../../src/shared/world/seatModels';

export const SEAT_FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];

export function seatEntry(key: string): ModelSpec {
  const b = seatBuildOf(key)!;
  const s = b.spec;
  const facings: NonNullable<ModelSpec['facings']> = {};
  for (const f of SEAT_FACINGS) {
    const art = seatArtOf(key, f)!;
    facings[f] = { file: `${key}.${f}.png`, anchor: [art.ax, art.ay] };
  }
  // the base as the runtime classes it (sprites/art.ts centres a piece small for its footprint, whatever its anchor):
  // small in any facing, it stands on a narrow base; else it covers its footprint
  const small = SEAT_FACINGS.some((f) => {
    const art = seatArtOf(key, f)!;
    const { w, d } = placedSize(b.model.size, f);
    return centredAnchor(art.px, w, d, 2) !== null;
  });
  const wide = !small;
  // a round seat on a column is the same from every side: one drawing (the renderer's se view)
  const radial = b.kind === 'stool' || b.kind === 'barstool' || b.kind === 'ottoman';
  const drawings = radial ? { rotation: 'radial' as const, file: `${key}.se.png`, anchor: facings.se!.anchor } : { rotation: 'full' as const, facings };
  return {
    name: s.name,
    category: 'seating',
    tags: s.tags ?? [b.kind],
    rooms: s.rooms,
    ...(s.themes ? { themes: s.themes } : {}),
    footprint: [b.size[0], b.size[1]],
    height: b.height,
    ...drawings,
    fit: 'anchor',
    base: wide ? 'filled' : 'centred',
    walk: 'seat',
    layer: 'object',
    seat: b.seat,
    sitStyle: b.style,
    backrest: b.backrest,
    ...(b.hasArms ? { arms: true } : {}),
    use: { face: 'front', actions: ['sit'] },
    note: `built from its seat spec (${b.kind}; src/shared/art/seatCatalog.ts)${s.note ? `: ${s.note}` : ''}`,
  };
}
