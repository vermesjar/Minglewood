import { footprint, isSeat, isSolid, terrainAt, UNWALKABLE_TERRAIN, type SceneDef } from './scene';

/**
 * Boolean walkability grid for a scene. All furniture blocks, seats included: you can't walk through a
 * chair or stand in a couch. A seat is reached only as the last step of a path (pathfinding's allowGoal)
 * and you sit there — see seats.ts.
 */
export class WalkGrid {
  readonly width: number;
  readonly height: number;
  private cells: Uint8Array;

  constructor(scene: SceneDef, activeDecor: ReadonlySet<string> = new Set()) {
    this.width = scene.width;
    this.height = scene.height;
    this.cells = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells[y * this.width + x] = UNWALKABLE_TERRAIN.has(terrainAt(scene, x, y)) ? 0 : 1;
      }
    }
    for (const o of scene.objects) {
      if (o.eventDecor && !activeDecor.has(o.eventDecor)) continue;
      if (!isSolid(o) && !isSeat(o)) continue;
      const f = footprint(o);
      for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) this.set(x, y, false);
    }
    for (const a of scene.staff ?? []) for (let y = a.y; y < a.y + a.d; y++) for (let x = a.x; x < a.x + a.w; x++) this.set(x, y, false);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  walkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.cells[y * this.width + x] === 1;
  }

  set(x: number, y: number, v: boolean): void {
    if (this.inBounds(x, y)) this.cells[y * this.width + x] = v ? 1 : 0;
  }

  /** Nearest walkable tile to (x,y) by expanding square rings. */
  nearestWalkable(x: number, y: number, maxR = 8): { x: number; y: number } | null {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (this.walkable(rx, ry)) return { x: rx, y: ry };
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = rx + dx;
          const ny = ry + dy;
          if (!this.walkable(nx, ny)) continue;
          const d = Math.hypot(nx - x, ny - y);
          if (!best || d < best.d) best = { x: nx, y: ny, d };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    return null;
  }
}
