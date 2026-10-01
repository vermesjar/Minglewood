import { createHash } from 'node:crypto';

export interface ReviewedFigureContext {
  feet: [number,number];
  legs: unknown;
  height: number;
  figure: {width:number;height:number;ax:number;ay:number;rgbaSha256:string;ownerSha256:string};
}

/** Only original/unmasked body data belongs here: changing the tested mask must remain testable. */
export function reviewedFigureContext(r: {
  feet:[number,number];legs?:unknown;height:number;
  figure:{w:number;h:number;ax:number;ay:number;rgba:number[];owner:number[]};
}): ReviewedFigureContext {
  const hash=(values:number[])=>createHash('sha256').update(Buffer.from(values)).digest('hex');
  return {feet:[...r.feet],legs:structuredClone(r.legs??null),height:r.height,figure:{width:r.figure.w,height:r.figure.h,
    ax:r.figure.ax,ay:r.figure.ay,rgbaSha256:hash(r.figure.rgba),ownerSha256:hash(r.figure.owner)}};
}
