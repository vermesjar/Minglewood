/**
 * Authored depth for the original avatar pixels. Geometry follows the kit's
 * joints; bounded clothing correspondence and thin accessory reliefs are
 * explicit sprite-art conventions, not a reconstruction of an unseen 3D body.
 * No furniture, existing occlusion mask, or expected winner enters this module.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import type { SitLegs } from '@shared/world/sitLegs';
import { FIG } from '@shared/world/seatFigure';
import { kitFrame, LAYER } from './avatarKit';
import { renderAvatarLayers } from './avatarQa';
import type { Pose, Pt } from './avatarFrame';
import { garmentHeight } from './avatarGarmentDepth';
import { M } from './pixkit';

type V = [number, number, number];
type Segment = { a: V; b: V; r: number };
const TILE = Math.sqrt(384), SCALE = 4 / Math.sqrt(3);
const RAY: V = [TILE / 16, TILE / 16, 1];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const point = (x: number, y: number, z: number): V => [(x / 32 + y / 16 + z / 8) * TILE / 2, (y / 16 + z / 8 - x / 32) * TILE / 2, z];
export function sourceSurfaceRoots(a: number, b: number, c: number): number[] {
  const bb = b * b, ac4 = 4 * a * c;
  let d = bb - ac4;
  // Coefficients include projected joint arithmetic. Only rescue negative
  // cancellation within its coefficient-relative roundoff allowance; preserve
  // all positive discriminants and genuine misses. This is a bounded floating
  // point convention, not an exact geometric predicate or a spatial epsilon.
  const allowance = 64 * Number.EPSILON * (Math.abs(bb) + Math.abs(ac4));
  if (Number.isFinite(d) && Number.isFinite(allowance) && d < 0 && d >= -allowance) d = 0;
  return d < 0 || Math.abs(a) < 1e-12 ? [] : [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
}
const roots = sourceSurfaceRoots;
function capsule(o: V, s: Segment): number {
  const delta = sub(s.b, s.a), length = Math.sqrt(dot(delta, delta));
  if (length < 1e-8) return -Infinity;
  const axis = delta.map(v => v / length) as V, offset = sub(o, s.a);
  const rd = RAY.map((v, i) => v - axis[i] * dot(RAY, axis)) as V;
  const od = offset.map((v, i) => v - axis[i] * dot(offset, axis)) as V;
  const values = roots(dot(rd, rd), 2 * dot(rd, od), dot(od, od) - s.r ** 2).filter(t => {
    const along = dot(offset, axis) + t * dot(RAY, axis);
    return along >= 0 && along <= length;
  });
  for (const end of [s.a, s.b]) {
    const q = sub(o, end);
    values.push(...roots(dot(RAY, RAY), 2 * dot(RAY, q), dot(q, q) - s.r ** 2));
  }
  return Math.max(-Infinity, ...values);
}
function ellipsoid(o: V, center: V, radii: V): number {
  const q = sub(o, center).map((v, i) => v / radii[i]) as V;
  const d = RAY.map((v, i) => v / radii[i]) as V;
  return Math.max(-Infinity, ...roots(dot(d, d), 2 * dot(q, d), dot(q, q) - 1));
}

export interface AvatarSurfaceDepth {
  /** Front height relative to the hip center; NaN means unresolved original opacity. */
  z: Float64Array;
  /** 1 solid; 2 pixel footprint; 3 clothing correspondence; 4 accessory relief; 5 source outline; 6 sealed pocket; 7 garment relief; 8 internal stroke; 9 original body-only pocket; 10 source lower garment. */
  method: Uint8Array;
}
/** Local source-paint tangent; disconnected paint and depth discontinuities cannot donate a slope. */
export function sourcePaintGradient(width: number, height: number, nx: number, ny: number,
  owner: ArrayLike<number>, rgba: ArrayLike<number>, depth: ArrayLike<number>,
  sealed?: ArrayLike<number>, bodyPocket?: ArrayLike<number>): Pt | null {
  const donor = ny * width + nx;
  if (sealed?.[donor] || bodyPocket?.[donor]) return null;
  const seen = new Set<number>([donor]), queue = [donor];
  const samples: Array<[number, number, number]> = [];
  while (queue.length) {
    const i = queue.pop()!, x = i % width, y = Math.floor(i / width);
    if (Number.isFinite(depth[i])) samples.push([x - nx, y - ny, depth[i]]);
    for (const [px, py] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (px < 0 || px >= width || py < 0 || py >= height || Math.abs(px - nx) > 2 || Math.abs(py - ny) > 2) continue;
      const j = py * width + px;
      if (seen.has(j) || owner[j] !== owner[donor] || !rgba[j * 4 + 3] || sealed?.[j] || bodyPocket?.[j]) continue;
      seen.add(j); queue.push(j);
    }
  }
  if (samples.length < 3) return null;
  const n = samples.length, mean = samples.reduce((sum, p) => [sum[0] + p[0] / n, sum[1] + p[1] / n, sum[2] + p[2] / n], [0, 0, 0]);
  let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
  for (const p of samples) {
    const x = p[0] - mean[0], y = p[1] - mean[1], z = p[2] - mean[2];
    xx += x * x; xy += x * y; yy += y * y; xz += x * z; yz += y * z;
  }
  const det = xx * yy - xy * xy;
  if (det <= 1e-10) return null;
  const gradient: Pt = [(xz * yy - yz * xy) / det, (yz * xx - xz * xy) / det];
  // Half a world-height unit is one source pixel of vertical rise.
  if (samples.some(p => Math.abs(mean[2] + gradient[0] * (p[0] - mean[0]) + gradient[1] * (p[1] - mean[1]) - p[2]) > .5)) return null;
  return gradient;
}
const cache = new Map<string, AvatarSurfaceDepth>();

export function avatarSurfaceDepth(look: AvatarLoadout, facing: Facing, pose: Pose, legs?: SitLegs): AvatarSurfaceDepth {
  const key = JSON.stringify([look, facing, pose, legs]);
  const previous = cache.get(key);
  if (previous) return previous;
  if (facing === 'sw' || facing === 'nw') {
    // The original avatar kit mirrors its two authored views byte-for-byte.
    // Mirror the authored depth too: independently solving tangent rays can
    // choose different fallback branches after floating-point cancellation.
    const source = avatarSurfaceDepth(look, facing === 'sw' ? 'se' : 'ne', pose, legs);
    const result = { z: new Float64Array(FIG.w * FIG.h), method: new Uint8Array(FIG.w * FIG.h) };
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
      const i = y * FIG.w + x, j = y * FIG.w + FIG.w - 1 - x;
      result.z[i] = source.z[j]; result.method[i] = source.method[j];
    }
    cache.set(key, result);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return result;
  }
  const fig = renderAvatarLayers(look, facing, pose, legs), back = facing === 'ne';
  const F = kitFrame(look, back ? 'back' : 'front', pose, legs), mirrored = false;
  // Continuous geometry reflects with w-x, while raster indices use w-1-x.
  const xy = (p: Pt): Pt => [mirrored ? FIG.w - p[0] : p[0], p[1]];
  const joint = (p: Pt, z: number): V => { const q = xy(p); return point(q[0], q[1], z); };
  const rowHeight = (y: number) => (F.hipY - y) / 2;
  const legSegments: Segment[] = [], arms: Segment[] = [], shoes: Array<{ center: V; radii: V }> = [];
  const bootShafts:Segment[]=[],skateWheels:Array<Array<{center:V;radii:V}>>=[];
  for (const leg of [F.legNear, F.legFar]) {
    const knee = legs?.rise ?? rowHeight(leg.m[1]);
    const ankle = legs ? knee - legs.drop + 2.5 : rowHeight(leg.b[1]);
    legSegments.push({ a: joint(leg.a, 0), b: joint(leg.m, knee), r: 4.4 / SCALE },
      { a: joint(leg.m, knee), b: joint(leg.b, ankle), r: 4.1 / SCALE });
    const q = xy(leg.b), toe = (back ? -.5 : 1.5) * (mirrored ? -1 : 1);
    shoes.push({ center: point(q[0] + toe, q[1] + 2.5, ankle - 1.25), radii: [5.5 / SCALE, 5.5 / SCALE, 1.75] });
    // Original drawShoes owns a vertical seven-pixel rainboot shaft and three
    // one-pixel skate wheels. Those are equipment, not the bent anatomical shin.
    const heel=shoes.length===1?F.heelNear:F.heelFar,lift=heel?1:0;
    const base=point(q[0]+.5,q[1]-lift,ankle),top=point(q[0]+.5,q[1]-lift-7,ankle+3.5);
    bootShafts.push({a:base,b:top,r:3.5/SCALE});
    const x0=q[0]-3-(back?2:0),y0=q[1]-lift;
    skateWheels.push([1,4,7].map(dx=>({center:point(Math.round(x0+dx)+.5,Math.round(y0+6)+.5,ankle-3.25),radii:[.5/SCALE,.5/SCALE,.25] as V})));
  }
  for (const arm of [F.armNear, F.armFar]) {
    arms.push({ a: joint(arm.a, rowHeight(arm.a[1])), b: joint(arm.m, rowHeight(arm.m[1])), r: 4.4 / SCALE },
      { a: joint(arm.m, rowHeight(arm.m[1])), b: joint(arm.b, rowHeight(arm.b[1])), r: 4.4 / SCALE });
  }
  const torsoTop = Math.min(...F.torso.map(p => p[1]));
  const torso: Segment = { a: joint([F.hx, torsoTop + 3], rowHeight(torsoTop) - 1.5),
    b: joint([F.hx, F.waistY - 2], rowHeight(F.waistY) + 1), r: 9.5 / SCALE };
  const pelvisCenter = joint([F.hx + .5, F.hipY], 0), pelvisRadius = 9.5 / SCALE;
  const waistTop = rowHeight(F.waistY - 1);
  const hips = M().rrect(F.hx - 9, F.waistY - 1, F.hx + 10, F.hipY + 3, 2);
  function pelvis(o: V): number {
    let best = ellipsoid(o, pelvisCenter, [pelvisRadius, pelvisRadius, 1.5]);
    const q = sub(o, pelvisCenter), r2 = pelvisRadius ** 2;
    for (const z of roots(RAY[0] ** 2 + RAY[1] ** 2, 2 * (q[0] * RAY[0] + q[1] * RAY[1]), q[0] ** 2 + q[1] ** 2 - r2))
      if (z >= 0 && z <= waistTop) best = Math.max(best, z);
    if ((q[0] + RAY[0] * waistTop) ** 2 + (q[1] + RAY[1] * waistTop) ** 2 <= r2) best = Math.max(best, waistTop);
    return best;
  }
  const cardinal = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && a < FIG.w && b >= 0 && b < FIG.h);
  const cane:Segment[]=[];
  if(look.mobility==='mob.cane'&&!F.sitting){
    const [hx,hy]=F.handNear;
    const cp=(x:number,y:number)=>point(Math.round(x)+.5,Math.round(y)+.5,rowHeight(Math.round(y)+.5));
    // The original cane is a one-pixel upright shaft and a hooked three-pixel
    // handle at the near hand. Its vertical anchors follow the source hand/feet.
    cane.push({a:cp(hx-1,hy),b:cp(hx-1,103),r:.5/SCALE},
      {a:cp(hx-1,hy-2),b:cp(hx+1,hy-2),r:.5/SCALE},
      {a:cp(hx+1,hy-2),b:cp(hx+1,hy-1),r:.5/SCALE});
  }
  function core(x: number, y: number, owner: number, hip: boolean, shoeLimb = 0): number {
    const o = point(x + .5, y + .5, 0);
    let best = hip ? pelvis(o) : -Infinity;
    if (owner === LAYER.legs || owner === LAYER.outline) for (const s of legSegments) best = Math.max(best, capsule(o, s));
    if (([LAYER.armBack, LAYER.armFront, LAYER.torso, LAYER.outline] as number[]).includes(owner))
      for (const s of arms) best = Math.max(best, capsule(o, s));
    if (owner === LAYER.torso || owner === LAYER.outline) {
      const z = capsule(o, torso);
      if (z >= -1.5) best = Math.max(best, z);
    }
    if (owner === LAYER.shoes || owner === LAYER.outline) for (const shoe of shoes) best = Math.max(best, ellipsoid(o, shoe.center, shoe.radii));
    // Original shoe paint encloses its own ankle; exact painter provenance
    // prevents a crossing/opposite leg from donating an unrelated depth.
    if (owner === LAYER.shoes && (shoeLimb === 1 || shoeLimb === 2))
      best = Math.max(best, capsule(o, legSegments[(shoeLimb - 1) * 2 + 1]));
    if(owner===LAYER.cane)for(const segment of cane)best=Math.max(best,capsule(o,segment));
    return best;
  }
  const result: AvatarSurfaceDepth = { z: new Float64Array(FIG.w * FIG.h).fill(NaN), method: new Uint8Array(FIG.w * FIG.h) };
  for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
    const i = y * FIG.w + x;
    if (!fig.px[i * 4 + 3]) continue;
    const owner = fig.owner[i], bx = mirrored ? FIG.w - 1 - x : x;
    const hip = owner === LAYER.pelvis || owner === LAYER.legs && hips.has(bx, y) || owner === LAYER.outline && cardinal(x, y).some(([a, b]) => fig.owner[b * FIG.w + a] === LAYER.pelvis);
    const shoeLimb = fig.shoeLimb?.[i] ?? 0;
    let z = core(x, y, owner, hip, shoeLimb), method = 1;
    if (!Number.isFinite(z)) {
      const span = owner === LAYER.outline ? 1.5 : .5;
      for (const dx of [-span, 0, span]) for (const dy of [-span, 0, span]) z = Math.max(z, core(x + dx, y + dy, owner, hip, shoeLimb));
      method = 2;
    }
    if (!Number.isFinite(z) && ([LAYER.hairBehind, LAYER.held, LAYER.neck, LAYER.head, LAYER.face, LAYER.hair, LAYER.hat, LAYER.glasses, LAYER.accessory] as number[]).includes(owner)) {
      z = rowHeight(y + .5) + (owner === LAYER.hairBehind ? -1.5 : 1.5);
      method = 4;
    }
    if (!Number.isFinite(z) && (owner === LAYER.torso || owner === LAYER.outline)) {
      for (const [dx, dy] of [[-2.5, 0], [2.5, 0], [0, -2.5], [0, 2.5], [-1.75, -1.75], [1.75, -1.75], [-1.75, 1.75], [1.75, 1.75]])
        z = Math.max(z, core(x + dx, y + dy, owner, false));
      method = 3;
    }
    if (!Number.isFinite(z) && owner === LAYER.torso && Math.abs(x + .5 - F.hx) <= 16 && y >= F.shoulderY - 2 && y <= F.hipY + 3) {
      // Generated garment drawings can extend beyond the skeletal skin. Their
      // remaining torso pixels are an explicitly authored thin clothing face,
      // bounded to the source torso region, rather than an invented limb hit.
      z = rowHeight(y + .5) + 1.25;
      method = 7;
    }
    if(!Number.isFinite(z)&&owner===LAYER.shoes&&(shoeLimb===1||shoeLimb===2)){
      for(const dx of [-.5,0,.5])for(const dy of [-.5,0,.5]){
        const ray=point(x+.5+dx,y+.5+dy,0);
        if(look.shoes==='shoes.rainboots')z=Math.max(z,capsule(ray,bootShafts[shoeLimb-1]));
        if(look.shoes==='shoes.skates')for(const wheel of skateWheels[shoeLimb-1])z=Math.max(z,ellipsoid(ray,wheel.center,wheel.radii));
      }
      if(Number.isFinite(z))method=11;
    }
    if(owner===LAYER.legs&&fig.lowerGarment?.mask[i]){
      const cloth=garmentHeight(fig.lowerGarment,x+.5,y+.5,{waist:rowHeight(F.waistY-1),hip:0,
        nearKnee:legs?.rise??rowHeight(F.legNear.m[1]),farKnee:legs?.rise??rowHeight(F.legFar.m[1])});
      if(!Number.isFinite(cloth))throw Error('Original lower-garment paint lacks an authored cloth face');
      if(!Number.isFinite(z)||cloth>z){z=cloth;method=10;}
    }
    if (Number.isFinite(z)) { result.z[i] = z; result.method[i] = method; }
  }
  // Source-only local tangent transport: neighboring pixels are different
  // rays, so their absolute heights cannot be copied onto an outline pixel.
  // Fit only the original donor's painted owner; never inspect furniture.
  const gradients = new Map<number, Pt | null>();
  const gradientAt = (nx: number, ny: number): Pt | null => {
    const ni = ny * FIG.w + nx;
    if (gradients.has(ni)) return gradients.get(ni)!;
    const gradient = sourcePaintGradient(FIG.w, FIG.h, nx, ny, fig.owner, fig.px, result.z, fig.sealed, fig.bodyPocket);
    gradients.set(ni, gradient); return gradient;
  };
  for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
    const i = y * FIG.w + x;
    if (!fig.px[i * 4 + 3] || fig.owner[i] !== LAYER.outline) continue;
    const values = cardinal(x, y).filter(([a, b]) => fig.owner[b * FIG.w + a] !== LAYER.outline && Number.isFinite(result.z[b * FIG.w + a]))
      .map(([a, b]) => {
        const g = gradientAt(a, b);
        return result.z[b * FIG.w + a] + (g ? g[0] * (x - a) + g[1] * (y - b) : 0);
      });
    if (values.length) { result.z[i] = Math.max(Number.isFinite(result.z[i]) ? result.z[i] : -Infinity, ...values); result.method[i] = 5; }
  }
  // sealPinholes authors a tiny filled patch bounded by the original stroke.
  // Extend that boundary harmonically across only the recorded source pocket;
  // never propagate depth along the whole outline or across an open leg gap.
  function harmonic(domain: Uint8Array, method: number, limit: number) {
    const seen = new Uint8Array(FIG.w * FIG.h);
    for (let start = 0; start < seen.length; start++) {
      if (!domain[start] || seen[start]) continue;
      const cells: number[] = [], queue = [start];
      seen[start] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        cells.push(i);
        for (const [x, y] of cardinal(i % FIG.w, Math.floor(i / FIG.w))) {
          const j = y * FIG.w + x;
          if (domain[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
        }
      }
      for (const i of cells) result.z[i] = NaN;
      if (cells.length > limit) continue;
      const index = new Map(cells.map((i, n) => [i, n]));
      const equations = cells.map(() => new Float64Array(cells.length + 1));
      let valid = true;
      cells.forEach((i, n) => {
        const neighbors = cardinal(i % FIG.w, Math.floor(i / FIG.w));
        equations[n][n] = neighbors.length;
        for (const [x, y] of neighbors) {
          const j = y * FIG.w + x, inner = index.get(j);
          if (inner !== undefined) equations[n][inner] -= 1;
          else if (fig.px[j * 4 + 3] && Number.isFinite(result.z[j])) equations[n][cells.length] += result.z[j];
          else valid = false;
        }
      });
      if (!valid) continue;
      // Dirichlet system on the exact source component, without scan-order diffusion.
      for (let n = 0; n < cells.length; n++) {
        const divisor = equations[n][n];
        if (Math.abs(divisor) < 1e-12) { valid = false; break; }
        for (let k = n; k <= cells.length; k++) equations[n][k] /= divisor;
        for (let row = 0; row < cells.length; row++) if (row !== n) {
          const factor = equations[row][n];
          for (let k = n; k <= cells.length; k++) equations[row][k] -= factor * equations[n][k];
        }
      }
      if (valid) cells.forEach((i, n) => { result.z[i] = equations[n][cells.length]; result.method[i] = method; });
    }
  }
  // Solve adjacent original fills together so neither kind borrows a
  // provisional depth from the other. Larger components stay unresolved.
  const filled = new Uint8Array(FIG.w * FIG.h);
  for (let i = 0; i < filled.length; i++) filled[i] = fig.sealed?.[i] || fig.bodyPocket?.[i] ? 1 : 0;
  harmonic(filled, 6, 20);
  for (let i = 0; i < filled.length; i++) if (fig.bodyPocket?.[i] && Number.isFinite(result.z[i])) result.method[i] = 9;
  // An outline enclosed on all four sides by the original opaque avatar is
  // an internal painted seam, not an exposed silhouette. Give that seam a
  // continuous surface from its enclosing source boundary. Furniture and
  // runtime mask results never participate in selecting this domain.
  const internal = new Uint8Array(FIG.w * FIG.h);
  for (let y = 1; y < FIG.h - 1; y++) for (let x = 1; x < FIG.w - 1; x++) {
    const i = y * FIG.w + x;
    if (fig.px[i * 4 + 3] && fig.owner[i] === LAYER.outline &&
        cardinal(x, y).every(([a, b]) => fig.px[(b * FIG.w + a) * 4 + 3])) internal[i] = 1;
  }
  harmonic(internal, 8, FIG.w * FIG.h);
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return result;
}
