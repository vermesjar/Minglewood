/** Source-authored curved seating depth: bindings and numerical invariants. */
import { projectLocal, rayThrough, type SeatModel, type SeatSurfaceMap } from './seatModels';
import type { Facing } from './scene';

export interface RolledRimProfile {
  cu: number; cv: number; ru: number; rv: number;
  seat: number; rise: number; posterior: number; rim: number; width: number;
  contact_u: number; contact_v: number; skirt: number;
}

export interface AuthoredSeatDepth {
  kind: 'rolled-rim';
  provenance: 'authored-intent';
  identity: 'source-proposal' | 'authored-profile';
  profile: RolledRimProfile;
  geometry: string;
  anchor: [number, number];
  style: string;
  generatorSha256: string;
  sourceInputsSha256: string;
  /** Source-pixel vertical world height. Null exactly where original alpha is zero. */
  z: Array<number | null>;
  /** Full source grid, including derivative neighbors outside alpha; pixel index + .5 is ray center. */
  correspondence: Array<[number, number]>;
}

/** Complete mechanics binding apart from the maps themselves and descriptive review metadata. */
export function authoredGeometrySignature(model: SeatModel): string {
  return JSON.stringify([model.size, model.parts, model.sits, model.views ?? null,
    model.over ?? null, model.compiler ?? null, model.drawings ?? null]);
}

/** All four source views must be explicit v2, with identical profile/geometry/generator bindings.
 * No implicit mirrored map copying; normals are intentionally absent from the runtime representation.
 * Drawing/alpha/anchor/style checks run in resolveSeatSurfaceMap; structural validation is shared.
 */
export function authoredMapProblems(map: Extract<SeatSurfaceMap, { version: 2 }>, model: SeatModel, facing: Facing): string[] {
  const problems: string[] = [], a = map.authored, n = map.width * map.height;
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(finite);
  if (!a || a.kind !== 'rolled-rim' || a.provenance !== 'authored-intent' ||
      !['source-proposal', 'authored-profile'].includes(a.identity) ||
      !pair(a.anchor) || a.style !== 'floor' ||
      a.geometry !== authoredGeometrySignature(model) ||
      !/^[a-f0-9]{64}$/.test(a.generatorSha256) || !/^[a-f0-9]{64}$/.test(a.sourceInputsSha256))
    return ['Malformed or stale authored surface identity.'];
  const p = a.profile;
  const keys = ['cu', 'cv', 'ru', 'rv', 'seat', 'rise', 'posterior', 'rim', 'width', 'contact_u', 'contact_v', 'skirt'] as const;
  if (!p || keys.some(k => !finite(p[k])) || p.ru <= 0 || p.rv <= 0 || p.width <= 0 ||
      p.seat < 0 || p.rise < 0 || p.skirt < 0 || p.skirt > p.seat || p.posterior < 0 || p.posterior > 1 ||
      p.rim <= 0 || p.rim >= 1 || model.size[0] !== 1 || model.size[1] !== 1 ||
      model.sits.length !== 1 || model.sits[0].some((v, i) => Math.abs(v - [p.contact_u, p.contact_v, p.seat][i]) > 1e-8))
    return ['Malformed authored rolled-rim profile or support contact.'];
  if (!Array.isArray(a.z) || a.z.length !== n || !Array.isArray(a.correspondence) || a.correspondence.length !== n ||
      !a.correspondence.every(pair)) return ['Incomplete authored surface buffers.'];
  for (let i = 0; i < n; i++) {
    if (map.labels[i] === 0 ? a.z[i] !== null : !finite(a.z[i]) || a.z[i]! < 0 || a.z[i]! > 128) {
      problems.push('Authored depth must cover exactly opaque source pixels with finite physical height.'); break;
    }
  }
  const at = (x: number, y: number, axis: 0 | 1) => a.correspondence[y * map.width + x][axis];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!map.labels[y * map.width + x]) continue;
    const q = a.correspondence[y * map.width + x];
    if (Math.hypot(q[0] - x, q[1] - y) > 7 + 1e-8) return [...problems, 'Authored correspondence exceeds seven source pixels.'];
    const xl = Math.max(0, x - 1), xr = Math.min(map.width - 1, x + 1), yl = Math.max(0, y - 1), yr = Math.min(map.height - 1, y + 1);
    if (xl === xr || yl === yr) return [...problems, 'Authored correspondence grid is too small.'];
    const dx = (at(xr, y, 0) - at(xl, y, 0)) / (xr - xl), dy = (at(x, yr, 1) - at(x, yl, 1)) / (yr - yl);
    const xy = (at(x, yr, 0) - at(x, yl, 0)) / (yr - yl), yx = (at(xr, y, 1) - at(xl, y, 1)) / (xr - xl);
    const determinant = dx * dy - xy * yx, trace = dx * dx + dy * dy + xy * xy + yx * yx;
    const stretch = Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2);
    if (determinant < .08 - 1e-8 || stretch > 3 + 1e-8) return [...problems, 'Authored correspondence folds, collapses, or stretches excessively.'];
    const z = a.z[y * map.width + x];
    if (z === null || !finite(z)) continue;
    const ray = rayThrough(a.anchor, model.size, facing, q[0] + .5, q[1] + .5);
    const inside = (height: number) => {
      const u = ray.u0 + ray.du * height, v = ray.v0 + ray.dv * height;
      return height >= 0 && ((u - p.cu) / p.ru) ** 2 + ((v - p.cv) / p.rv) ** 2 <= 1 && height <= rolledRimHeight(p, u, v);
    };
    // The producer's .1/2^12 root interval is <.000025 world units. A bracket
    // check remains stable on almost-vertical rounded skirts where a vertical
    // height residual is ill-conditioned; this is numerical precision, not art fringe padding.
    if (!inside(Math.max(0, z - .0001)) || inside(z + .0001))
      return [...problems, 'Authored depth is not on its bound curved solid.'];
  }
  const contact = projectLocal(a.anchor, model.size, facing, p.contact_u, p.contact_v, p.seat).map(v => v - .5);
  const [cx, cy] = contact, ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
  if (ix < 0 || iy < 0 || ix + 1 >= map.width || iy + 1 >= map.height) return [...problems, 'Authored contact lies outside its source grid.'];
  const interpolated = (axis: 0 | 1) => at(ix, iy, axis) * (1 - fx) * (1 - fy) + at(ix + 1, iy, axis) * fx * (1 - fy) +
    at(ix, iy + 1, axis) * (1 - fx) * fy + at(ix + 1, iy + 1, axis) * fx * fy;
  if (Math.hypot(interpolated(0) - cx, interpolated(1) - cy) > .05 + 1e-8)
    problems.push('Authored correspondence moves the support contact.');
  return problems;
}

export function rolledRimHeight(p: RolledRimProfile, u: number, v: number): number {
  const a = (u - p.cu) / p.ru, b = (v - p.cv) / p.rv, radius = Math.hypot(a, b);
  if (radius > 1) return 0;
  const contactRadius = Math.hypot((p.contact_u - p.cu) / p.ru, (p.contact_v - p.cv) / p.rv);
  const contactOuter = Math.sqrt(Math.max(1e-8, 1 - contactRadius ** 2));
  const contactPosterior = .5 + .5 * Math.tanh((p.contact_v - p.cv) / p.rv * 3);
  const base = (p.seat - p.skirt) / contactOuter - p.rise * Math.exp(-((p.rim / p.width) ** 2)) * (1 - p.posterior + p.posterior * contactPosterior);
  const wellRadius = Math.hypot((u - p.contact_u) / p.ru, (v - p.contact_v) / p.rv);
  const rim = Math.exp(-(((wellRadius - p.rim) / p.width) ** 2)), posterior = .5 + .5 * Math.tanh(b * 3);
  return p.skirt + Math.sqrt(Math.max(0, 1 - radius ** 2)) * (base + p.rise * rim * (1 - p.posterior + p.posterior * posterior));
}
