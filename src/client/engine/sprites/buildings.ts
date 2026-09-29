/** Procedural isometric buildings from a data spec (`BuildingSpec`). */
import type { BuildingSpec } from '@shared/world/scene';
import { darken, lighten, INK } from './color';
import { IsoPainter, rng, type Sprite } from './painter';

function roofHeight(spec: BuildingSpec, w: number, d: number) {
  return spec.roofStyle === 'flat' ? 5 : Math.round(Math.min(w, d) * 7 + 6);
}

function extraTop(spec: BuildingSpec) {
  return spec.extras.includes('flag') ? 30 : spec.extras.includes('antenna') ? 24 : 12;
}

function makePainter(spec: BuildingSpec, w: number, d: number) {
  return new IsoPainter(w, d, spec.wallH + roofHeight(spec, w, d) + extraTop(spec), 4, 10);
}

export function buildingSprite(spec: BuildingSpec, w: number, d: number, seed = 1): Sprite {
  const P = makePainter(spec, w, d);
  const H = spec.wallH;
  const rand = rng(seed * 7919);
  const floors = spec.floors ?? 1;
  const floorH = (H - 4) / floors;
  const doorPlane = spec.doorFace === 'left' ? d : w;
  const doorU = spec.doorAt + 0.5;

  // Foundation and walls.
  P.box(-0.08, -0.08, 0, w + 0.16, d + 0.16, 4, darken(spec.wallAccent, 0.25));
  P.box(0, 0, 3, w, d, H - 3, spec.wall);

  // Subtle vertical siding texture.
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? w : d;
    const plane = face === 'left' ? d : w;
    for (let u = 0.25; u < len; u += 0.25) {
      if (rand() < 0.5) P.faceRect(face, plane, u, 4, 0.02, H - 5, darken(spec.wall, face === 'left' ? 0.05 : 0.2));
    }
    // corner trims
    P.faceRect(face, plane, 0, 3, 0.1, H - 3, darken(spec.wallAccent, face === 'left' ? 0 : 0.18));
    P.faceRect(face, plane, len - 0.1, 3, 0.1, H - 3, darken(spec.wallAccent, face === 'left' ? 0 : 0.18));
    // floor bands
    for (let f = 1; f < floors; f++) {
      P.faceRect(face, plane, 0, 3 + f * floorH - 1, len, 2, darken(spec.wallAccent, face === 'left' ? 0 : 0.18));
    }
    // eave shadow
    P.faceRect(face, plane, 0, H - 3, len, 3, darken(spec.wall, face === 'left' ? 0.28 : 0.4));
  }

  // Windows.
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? w : d;
    const plane = face === 'left' ? d : w;
    const shade = face === 'left' ? 0 : 0.18;
    for (let f = 0; f < floors; f++) {
      const z0 = 3 + f * floorH + (f === 0 ? 7 : 5);
      const wh = Math.max(6, Math.min(11, floorH - 11));
      for (let u = 0.5; u < len; u += 1) {
        if (f === 0 && face === spec.doorFace && Math.abs(u - doorU) < 0.9) continue;
        P.faceRect(face, plane, u - 0.24, z0 - 1, 0.48, wh + 2, darken(spec.trim, shade));
        P.faceRect(face, plane, u - 0.18, z0, 0.36, wh, darken(spec.window, shade * 0.6));
        P.faceRect(face, plane, u - 0.18, z0 + wh - 3, 0.12, 3, lighten(spec.window, 0.55));
        P.faceRect(face, plane, u - 0.02, z0, 0.04, wh, darken(spec.trim, shade));
        P.faceRect(face, plane, u - 0.27, z0 - 2, 0.54, 1, lighten(spec.wallAccent, 0.2));
      }
    }
  }

  // Door.
  {
    const face = spec.doorFace;
    const shade = face === 'left' ? 0 : 0.18;
    P.faceRect(face, doorPlane, doorU - 0.32, 3, 0.64, 19, darken(spec.trim, shade));
    P.faceRect(face, doorPlane, doorU - 0.25, 3, 0.5, 16, darken('#8a5a3b', shade));
    P.faceRect(face, doorPlane, doorU - 0.2, 10, 0.4, 7, darken(spec.window, 0.1 + shade));
    P.faceRect(face, doorPlane, doorU + 0.12, 7, 0.05, 2, '#ffd36b');
    if (face === 'left') P.box(doorU - 0.4, d, 0, 0.8, 0.22, 3, lighten(spec.wallAccent, 0.1));
    else P.box(w, doorU - 0.4, 0, 0.22, 0.8, 3, lighten(spec.wallAccent, 0.1));
  }

  // Door-face extras.
  const onFace = (u0: number, z: number, du: number, dz: number, fill: string) =>
    P.faceRect(spec.doorFace, doorPlane, u0, z, du, dz, fill);
  if (spec.extras.includes('marquee')) {
    onFace(doorU - 0.7, 23, 1.4, 7, darken(spec.trim, 0.1));
    onFace(doorU - 0.64, 24, 1.28, 5, lighten(spec.wallAccent, 0.35));
    for (let u = doorU - 0.6; u <= doorU + 0.6; u += 0.2) onFace(u, 29, 0.06, 1, '#ffe38a');
  }
  if (spec.extras.includes('neon')) {
    onFace(doorU - 0.8, 22, 1.6, 5, '#1a1330');
    for (let u = doorU - 0.7; u < doorU + 0.7; u += 0.14) onFace(u, 23, 0.07, 3, rand() > 0.5 ? '#ff5fd1' : '#5ff3ff');
  }
  if (spec.extras.includes('awning')) {
    const [a, b] = spec.awningColors ?? ['#e0503f', '#fff4e0'];
    const len = spec.doorFace === 'left' ? w : d;
    let i = 0;
    for (let u = 0.2; u < len - 0.2; u += 0.3, i++) {
      const col = i % 2 ? b : a;
      if (spec.doorFace === 'left') {
        P.poly([[u, d, 24], [u + 0.3, d, 24], [u + 0.3, d + 0.5, 17], [u, d + 0.5, 17]], col);
        P.poly([[u, d + 0.5, 17], [u + 0.3, d + 0.5, 17], [u + 0.15, d + 0.5, 14]], darken(col, 0.1));
      } else {
        P.poly([[w, u, 24], [w, u + 0.3, 24], [w + 0.5, u + 0.3, 17], [w + 0.5, u, 17]], darken(col, 0.12));
        P.poly([[w + 0.5, u, 17], [w + 0.5, u + 0.3, 17], [w + 0.5, u + 0.15, 14]], darken(col, 0.2));
      }
    }
  }
  if (spec.extras.includes('columns')) {
    const col = '#fbf6ea';
    const len = spec.doorFace === 'left' ? w : d;
    const xs = [0.35, doorU - 0.75, doorU + 0.55, len - 0.55];
    for (const u of xs) {
      if (spec.doorFace === 'left') P.box(u, d + 0.05, 3, 0.2, 0.2, Math.min(H - 6, 30), col);
      else P.box(w + 0.05, u, 3, 0.2, 0.2, Math.min(H - 6, 30), col);
    }
    if (spec.doorFace === 'left') P.box(0.2, d, Math.min(H - 6, 30) + 3, len - 0.4, 0.34, 3, lighten(spec.trim, 0.5));
    else P.box(w, 0.2, Math.min(H - 6, 30) + 3, 0.34, len - 0.4, 3, lighten(spec.trim, 0.5));
  }
  if (spec.extras.includes('porch')) {
    const wood = '#b07a4a';
    if (spec.doorFace === 'right') {
      P.box(w, doorU - 1, 0, 0.7, 2, 3, wood);
      P.box(w + 0.6, doorU - 1, 3, 0.1, 0.1, 16, darken(wood, 0.2));
      P.box(w + 0.6, doorU + 0.9, 3, 0.1, 0.1, 16, darken(wood, 0.2));
      P.box(w, doorU - 1.1, 19, 0.8, 2.2, 2, darken(spec.roof, 0.05));
    } else {
      P.box(doorU - 1, d, 0, 2, 0.7, 3, wood);
    }
  }
  if (spec.extras.includes('clock')) {
    const [sx, sy] = P.p(w / 2, d, H - 11);
    const c = P.ctx;
    c.fillStyle = '#fffaf0';
    c.beginPath();
    c.arc(sx, sy, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = INK;
    c.fillRect(sx, sy - 3, 1, 3);
    c.fillRect(sx, sy, 3, 1);
  }
  if (spec.extras.includes('ivy')) {
    for (let i = 0; i < 40; i++) {
      const u = rand() < 0.5 ? rand() * 0.8 : w - rand() * 0.8;
      P.faceRect('left', d, u, 3 + rand() * (H - 8), 0.08, 2, rand() > 0.5 ? '#5e9c4a' : '#7bbf5a');
    }
  }
  if (spec.extras.includes('lanterns')) {
    for (const face of ['left', 'right'] as const) {
      const len = face === 'left' ? w : d;
      const plane = face === 'left' ? d : w;
      for (let u = 0.4; u < len; u += 0.8) {
        P.faceRect(face, plane, u, H - 6, 0.02, 3, INK);
        P.faceRect(face, plane, u - 0.05, H - 9, 0.12, 3, '#ffcf5a');
      }
    }
  }

  // Roof.
  const rh = roofHeight(spec, w, d);
  const rz = H + rh;
  const o = 0.22;
  const roof = spec.roof;
  if (spec.roofStyle === 'flat') {
    P.box(-0.06, -0.06, H, w + 0.12, d + 0.12, 4, darken(roof, 0.05), { top: lighten(roof, 0.12) });
    P.poly([[0.18, 0.18, H + 4], [w - 0.18, 0.18, H + 4], [w - 0.18, d - 0.18, H + 4], [0.18, d - 0.18, H + 4]], darken(roof, 0.12));
  } else if (spec.roofStyle === 'gable') {
    if (w >= d) {
      P.poly([[-o, -o, H], [w + o, -o, H], [w + o, d / 2, rz], [-o, d / 2, rz]], darken(roof, 0.15));
      P.poly([[w, 0, H], [w, d, H], [w, d / 2, rz - 2]], darken(spec.wall, 0.22));
      P.poly([[-o, d + o, H], [w + o, d + o, H], [w + o, d / 2, rz], [-o, d / 2, rz]], roof);
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        P.poly(
          [[-o, d + o - t * (d / 2 + o), H + t * rh], [w + o, d + o - t * (d / 2 + o), H + t * rh], [w + o, d + o - t * (d / 2 + o), H + t * rh + 1], [-o, d + o - t * (d / 2 + o), H + t * rh + 1]],
          darken(roof, 0.12),
        );
      }
      P.poly([[-o, d / 2, rz], [w + o, d / 2, rz], [w + o, d / 2, rz + 2], [-o, d / 2, rz + 2]], lighten(roof, 0.25));
    } else {
      P.poly([[-o, -o, H], [-o, d + o, H], [w / 2, d + o, rz], [w / 2, -o, rz]], lighten(roof, 0.05));
      P.poly([[0, d, H], [w, d, H], [w / 2, d, rz - 2]], spec.wall);
      P.poly([[w + o, -o, H], [w + o, d + o, H], [w / 2, d + o, rz], [w / 2, -o, rz]], darken(roof, 0.2));
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const x = w + o - t * (w / 2 + o);
        P.poly([[x, -o, H + t * rh], [x, d + o, H + t * rh], [x, d + o, H + t * rh + 1], [x, -o, H + t * rh + 1]], darken(roof, 0.32));
      }
    }
  } else {
    // hip
    const ridgeAlongX = w >= d;
    const r1: [number, number] = ridgeAlongX ? [d / 2, d / 2] : [w / 2, w / 2];
    const r2: [number, number] = ridgeAlongX ? [w - d / 2, d / 2] : [w / 2, d - w / 2];
    P.poly([[-o, -o, H], [w + o, -o, H], [r2[0], r2[1], rz], [r1[0], r1[1], rz]], darken(roof, 0.18));
    P.poly([[-o, -o, H], [r1[0], r1[1], rz], [r2[0], r2[1], rz], [-o, d + o, H]], lighten(roof, 0.06));
    P.poly([[w + o, -o, H], [w + o, d + o, H], [r2[0], r2[1], rz], [r1[0], r1[1], rz]], darken(roof, 0.24));
    P.poly([[-o, d + o, H], [w + o, d + o, H], [r2[0], r2[1], rz], [r1[0], r1[1], rz]], roof);
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      const yy = d + o - t * (d + o - r1[1]);
      const xa = -o + t * (r1[0] + o);
      const xb = w + o - t * (w + o - r2[0]);
      P.poly([[xa, yy, H + t * rh], [xb, yy, H + t * rh], [xb, yy, H + t * rh + 1], [xa, yy, H + t * rh + 1]], darken(roof, 0.14));
    }
  }

  // Roof extras.
  if (spec.extras.includes('chimney')) {
    const cx = w * 0.72;
    const cy = spec.roofStyle === 'gable' && w >= d ? d * 0.3 : d * 0.35;
    P.box(cx, cy, H + rh * 0.35, 0.45, 0.45, rh * 0.75 + 4, '#a3553f');
    P.box(cx - 0.04, cy - 0.04, H + rh * 1.1 + 4, 0.53, 0.53, 2, '#7d3f2f');
  }
  if (spec.extras.includes('solar')) {
    for (let i = 0; i < 3; i++) {
      P.box(0.5 + i * 1.3, 0.5, H + 5, 1.0, Math.min(1.4, d - 1.2), 2, '#2c4d86', { top: '#3e6cb3' });
      P.poly([[0.5 + i * 1.3 + 0.5, 0.5, H + 7], [0.5 + i * 1.3 + 0.52, 0.5, H + 7], [0.5 + i * 1.3 + 0.52, 0.5 + Math.min(1.4, d - 1.2), H + 7], [0.5 + i * 1.3 + 0.5, 0.5 + Math.min(1.4, d - 1.2), H + 7]], '#8fb4e8');
    }
  }
  if (spec.extras.includes('skylight')) {
    const sz = spec.roofStyle === 'flat' ? H + 4 : H + rh * 0.45;
    P.box(w * 0.55, d * 0.6, sz, 0.7, 0.6, 3, '#bfe9ff', { top: '#e8fbff' });
  }
  if (spec.extras.includes('antenna')) {
    const ax = w - 0.6;
    const ay = 0.5;
    const base = spec.roofStyle === 'flat' ? H + 4 : rz;
    P.box(ax, ay, base, 0.06, 0.06, 20, '#6b7280');
    P.px(ax, ay, base + 21, -1, -1, 3, 3, '#ff4d4d');
  }
  if (spec.extras.includes('flag')) {
    const fx = spec.roofStyle === 'hip' ? (w >= d ? w / 2 : w / 2) : w / 2;
    const fy = d / 2;
    const base = spec.roofStyle === 'flat' ? H + 4 : rz;
    P.box(fx, fy, base, 0.06, 0.06, 26, '#e8e2d6');
    P.px(fx, fy, base + 26, 1, 0, 11, 4, '#e0503f');
    P.px(fx, fy, base + 26, 1, 4, 11, 3, '#f2a93b');
    P.px(fx, fy, base + 26, 5, 1, 3, 3, '#fffaf0');
  }

  return P.finish();
}

/** Bunting + lights draped along the eaves while an event is on. Shares the building's anchor. */
export function festiveOverlay(spec: BuildingSpec, w: number, d: number): Sprite {
  const P = makePainter(spec, w, d);
  const H = spec.wallH;
  const colors = ['#e24c9c', '#3ec7e0', '#ffd23f', '#7cc576', '#ff8a3d'];
  let i = 0;
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? w : d;
    const plane = face === 'left' ? d : w;
    for (let u = 0.1; u < len - 0.2; u += 0.34, i++) {
      const col = colors[i % colors.length];
      const pts =
        face === 'left'
          ? ([[u, plane + 0.02, H - 1], [u + 0.26, plane + 0.02, H - 1], [u + 0.13, plane + 0.02, H - 8]] as [number, number, number][])
          : ([[plane + 0.02, u, H - 1], [plane + 0.02, u + 0.26, H - 1], [plane + 0.02, u + 0.13, H - 8]] as [number, number, number][]);
      P.poly(pts, col);
    }
  }
  return P.finish({ outline: false });
}

/**
 * Warm light in the windows, for evenings and busy buildings. Same geometry and anchor as the
 * building so it can be layered on top with additive blending. A few windows stay dark.
 */
export function windowLightsOverlay(spec: BuildingSpec, w: number, d: number, seed = 1): Sprite {
  const P = makePainter(spec, w, d);
  const H = spec.wallH;
  const rand = rng(seed * 104729);
  const floors = spec.floors ?? 1;
  const floorH = (H - 4) / floors;
  const doorU = spec.doorAt + 0.5;
  const doorPlane = spec.doorFace === 'left' ? d : w;
  const warm = ['#ffd98a', '#ffe7a8', '#ffc978'];
  for (const face of ['left', 'right'] as const) {
    const len = face === 'left' ? w : d;
    const plane = face === 'left' ? d : w;
    for (let f = 0; f < floors; f++) {
      const z0 = 3 + f * floorH + (f === 0 ? 7 : 5);
      const wh = Math.max(6, Math.min(11, floorH - 11));
      for (let u = 0.5; u < len; u += 1) {
        if (f === 0 && face === spec.doorFace && Math.abs(u - doorU) < 0.9) continue;
        if (rand() < 0.22) continue;
        const col = warm[Math.floor(rand() * warm.length)];
        P.faceRect(face, plane, u - 0.18, z0, 0.36, wh, col);
        P.faceRect(face, plane, u - 0.02, z0, 0.04, wh, '#b8864a');
      }
    }
  }
  P.faceRect(spec.doorFace, doorPlane, doorU - 0.2, 10, 0.4, 7, '#ffe7a8');
  return P.finish({ outline: false });
}
