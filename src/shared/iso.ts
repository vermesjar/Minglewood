/** Isometric projection helpers. Art space: one tile is 32×16 art pixels (2:1 dimetric). */
export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export interface Vec2 {
  x: number;
  y: number;
}

/** Tile (x,y,z-in-art-px) → art-space screen coordinates of that point. */
export function isoToScreen(x: number, y: number, z = 0): Vec2 {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H - z };
}

/** Art-space screen point → fractional tile coordinates on the ground plane. */
export function screenToIso(sx: number, sy: number): Vec2 {
  return { x: sy / TILE_H + sx / TILE_W, y: sy / TILE_H - sx / TILE_W };
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
