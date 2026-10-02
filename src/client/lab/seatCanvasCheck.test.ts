import { describe, expect, it } from 'vitest';
import { verifySeatCanvas, type CanvasLayer } from './seatCanvasCheck';

const red=[220,20,30,255], blue=[20,30,220,255];
const furniture:CanvasLayer={width:2,height:1,rgba:[...red,...red],x:0,y:0,pixelScale:2};
const avatar:CanvasLayer={width:1,height:1,rgba:blue,x:2,y:0,pixelScale:2};
function canvas(pixels:number[][]) {
  return {width:4,height:2,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(pixels.flat())})})} as unknown as HTMLCanvasElement;
}
describe('independent final canvas comparison',()=>{
  it('checks every device pixel at integer zoom',()=>{
    const result=verifySeatCanvas(canvas([red,red,blue,blue,red,red,blue,blue]),[furniture,avatar]);
    expect(result.checked).toBe(8);
    expect(result.passed).toBe(true);
  });
  it('detects furniture painted back over the avatar',()=>{
    const result=verifySeatCanvas(canvas(Array.from({length:8},()=>red)),[furniture,avatar]);
    expect(result.passed).toBe(false);
    expect(result.differences.map(p=>[p.x,p.y])).toEqual([[2,0],[3,0],[2,1],[3,1]]);
  });
  it('detects a one-device-pixel drift and an RGB-only change',()=>{
    const shifted=verifySeatCanvas(canvas([red,red,red,blue,red,red,red,blue]),[furniture,avatar]);
    expect(shifted.differences.map(p=>[p.x,p.y])).toEqual([[2,0],[2,1]]);
    const tinted=verifySeatCanvas(canvas([[219,20,30,255],red,blue,blue,red,red,blue,blue]),[furniture,avatar]);
    expect(tinted.differences).toHaveLength(1);
    expect(tinted.differences[0].actual).toEqual([219,20,30,255]);
  });
});
