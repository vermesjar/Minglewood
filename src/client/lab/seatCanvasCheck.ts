/** Dev-only final-frame check. Does not call WorldView drawing, blit, or use its masked sprites. */
export interface CanvasLayer {
  width: number; height: number; rgba: ArrayLike<number>;
  /** Device-pixel position and size of one source pixel. */
  x: number; y: number; pixelScale: number;
  /** Independently recomputed mask, indexed in source pixels. */
  mask?: ArrayLike<number>;
}

/**
 * Verify every opaque source pixel in independently ordered furniture/avatar layers against the
 * final visible canvas. Ground/background pixels and translucent art are explicitly outside this
 * check. This proves placement and final compositing agreement, not correctness of mask semantics.
 */
export function verifySeatCanvas(canvas: HTMLCanvasElement, layers: CanvasLayer[]) {
  const left = Math.max(0, Math.floor(Math.min(...layers.map(l => l.x))));
  const top = Math.max(0, Math.floor(Math.min(...layers.map(l => l.y))));
  const right = Math.min(canvas.width, Math.ceil(Math.max(...layers.map(l => l.x + l.width * l.pixelScale))));
  const bottom = Math.min(canvas.height, Math.ceil(Math.max(...layers.map(l => l.y + l.height * l.pixelScale))));
  const width = Math.max(0, right-left), height = Math.max(0, bottom-top);
  if (!width || !height) throw new Error('Seat evidence lies outside the final canvas');
  const expected = new Uint8ClampedArray(width*height*4);
  const owner = new Int16Array(width*height).fill(-1);
  let translucent = 0;
  layers.forEach((layer, layerIndex) => {
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const sx = Math.floor((left+x+0.5-layer.x)/layer.pixelScale);
      const sy = Math.floor((top+y+0.5-layer.y)/layer.pixelScale);
      if (sx<0 || sy<0 || sx>=layer.width || sy>=layer.height) continue;
      const source = sy*layer.width+sx, alpha = layer.rgba[source*4+3];
      if (!alpha || layer.mask?.[source]) continue;
      const dest = y*width+x;
      if (alpha!==255) { owner[dest]=-1; translucent++; continue; }
      for (let c=0;c<4;c++) expected[dest*4+c]=layer.rgba[source*4+c];
      owner[dest]=layerIndex;
    }
  });
  const actual = canvas.getContext('2d')!.getImageData(left,top,width,height).data;
  const differences: Array<{x:number;y:number;layer:number;expected:number[];actual:number[]}> = [];
  let checked=0;
  for (let i=0;i<owner.length;i++) {
    if (owner[i]<0) continue;
    checked++;
    if ([0,1,2,3].some(c=>expected[i*4+c]!==actual[i*4+c])) differences.push({
      x:left+i%width,y:top+Math.floor(i/width),layer:owner[i],
      expected:Array.from(expected.subarray(i*4,i*4+4)),actual:Array.from(actual.subarray(i*4,i*4+4)),
    });
  }
  return {scope:'Opaque furniture and occupant pixels in final canvas; independent of renderer blit/order, shared mask semantics remain unapproved.',
    rect:{x:left,y:top,width,height},checked,translucent,passed:checked>0&&!differences.length,
    differences,actual:Array.from(actual),expected:Array.from(expected),owner:Array.from(owner)};
}
