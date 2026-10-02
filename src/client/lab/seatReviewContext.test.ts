import { describe, expect, it } from 'vitest';
import { reviewedFigureContext } from '../../../scripts/lib/seat-review-context';

function capture() {
  return {feet:[12,24] as [number,number],legs:{reach:0.3,drop:11},height:13.5,
    figure:{w:1,h:1,ax:0,ay:1,rgba:[10,20,30,255],owner:[20],actual:[10,20,30,0],mask:[1]}};
}
describe('immutable reviewed avatar context',()=>{
  it('binds original color, ownership, layout, and physical placement',()=>{
    const source=capture(),known=reviewedFigureContext(source);
    for(const mutation of [
      (r:ReturnType<typeof capture>)=>{r.figure.rgba[0]++;},
      (r:ReturnType<typeof capture>)=>{r.figure.owner[0]++;},
      (r:ReturnType<typeof capture>)=>{r.figure.ax++;},
      (r:ReturnType<typeof capture>)=>{r.feet[1]++;},
      (r:ReturnType<typeof capture>)=>{r.legs.drop++;},
      (r:ReturnType<typeof capture>)=>{r.height++;},
    ]){const changed=capture();mutation(changed);expect(reviewedFigureContext(changed)).not.toEqual(known);}
  });
  it('keeps expectations reusable to test a changed mask, and snapshots mutable placement',()=>{
    const r=capture(),known=reviewedFigureContext(r);
    r.figure.mask[0]=0;r.figure.actual[3]=255;
    expect(reviewedFigureContext(r)).toEqual(known);
    r.feet[0]++;r.legs.drop++;
    expect(known.feet).toEqual([12,24]);
    expect(known.legs).toEqual({reach:0.3,drop:11});
  });
});
