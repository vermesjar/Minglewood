import { useEffect, useRef, useState } from 'react';
import { DECOR_CATALOG, MAX_DECOR_PER_ROOM, decorItem, wallCatalog, wallSpanOf, type DecorItem } from '@shared/world/decor';
import { spriteFor } from '../engine/sprites/registry';
import { wallArt } from '../engine/sprites/art';
import { wallPieceImage } from '../engine/interior';
import { game } from '../app/game';
import { useStore } from '../app/store';
import { silhouette } from '@shared/art/footing';

type Category = 'floor' | 'wall';

/** A floor piece as it stands, scaled into the tile. */
function drawFloorPreview(item: DecorItem, c: HTMLCanvasElement) {
  const s = spriteFor({ id: 'p', sprite: item.sprite, variant: item.variant, facing: item.facing, x: 0, y: 0 });
  if (!s) return;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const scale = Math.min(44 / s.canvas.width, 44 / s.canvas.height, 2);
  const w = s.canvas.width * scale;
  const h = s.canvas.height * scale;
  ctx.drawImage(s.canvas, (48 - w) / 2, 48 - h, w, h);
}

/** A wall piece flat on, as it hangs (its drawing, or a window drawn in the room's own trim). */
function drawWallPreview(item: DecorItem, c: HTMLCanvasElement, sceneId: string | null) {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const o = { id: 'p', sprite: item.sprite, variant: item.variant, wall: 'right' as const, x: 0, y: 0, w: wallSpanOf(item) };
  const art = wallArt(o);
  let src: CanvasImageSource;
  if (art) src = art.img;
  else {
    // a window: drawn in code, in this room's trim
    const theme = sceneId ? game.scene(sceneId)?.interior : undefined;
    if (!theme) return;
    src = wallPieceImage(o, 'right', { theme, activeDecor: new Set() }).canvas;
  }
  // just what shows of it (drawings carry transparent padding), as big as the tile allows
  const img = src as HTMLImageElement | HTMLCanvasElement;
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  const t = tmp.getContext('2d', { willReadFrequently: true })!;
  t.drawImage(img, 0, 0);
  const b = silhouette({ w: tmp.width, h: tmp.height, d: t.getImageData(0, 0, tmp.width, tmp.height).data });
  if (!b) return;
  const sw = b.r - b.l + 1;
  const sh = b.b - b.t + 1;
  const k = Math.min(44 / sw, 44 / sh, 2);
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  ctx.drawImage(tmp, b.l, b.t, sw, sh, Math.round((48 - w) / 2), Math.round((48 - h) / 2), w, h);
}

function ItemPreview({ item, sceneId }: { item: DecorItem; sceneId: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (item.wall) drawWallPreview(item, c, sceneId);
    else drawFloorPreview(item, c);
  }, [item, sceneId]);
  return <canvas ref={ref} width={48} height={48} style={{ imageRendering: 'pixelated' }} aria-hidden />;
}

const HINTS = {
  floor: 'click the floor to place it',
  wall: 'point at a wall to see where it hangs · click to hang it',
  remove: 'click a team piece to remove it',
  move: 'click a team piece to pick it up',
  moving: 'click where it goes · Esc leaves it where it was',
};

/**
 * Decorate mode: two categories, Furniture (on the floor) and Wall (every piece of wall art, and windows, hung on
 * the room's two back walls); pick a piece and click the floor or a wall to place it; move or remove your team's
 * pieces with the tools.
 */
export function DecoratePalette() {
  const decorate = useStore((s) => s.decorate);
  const sceneId = useStore((s) => s.sceneId);
  const count = useStore((s) => s.boot?.decorations.filter((d) => d.roomId === s.sceneId).length ?? 0);
  const room = useStore((s) => s.boot?.rooms.find((r) => r.id === s.sceneId));
  const selected = decorate?.itemId ? decorItem(decorate.itemId) : undefined;
  const [tab, setTab] = useState<Category>(selected?.wall ? 'wall' : 'floor');
  useEffect(() => {
    if (decorate && !game.canDecorate(sceneId)) game.setDecorate(null);
  }, [decorate, sceneId]);
  useEffect(() => {
    if (selected) setTab(selected.wall ? 'wall' : 'floor');
  }, [selected]);
  if (!decorate || !room) return null;
  const items = tab === 'wall' ? wallCatalog() : DECOR_CATALOG;
  const hint = decorate.moving ? HINTS.moving : decorate.move ? HINTS.move : selected ? HINTS[selected.wall ? 'wall' : 'floor'] : HINTS.remove;
  const tool = (move: boolean) => !decorate.itemId && !!decorate.move === move;
  return (
    <div className="decorate card" role="toolbar" aria-label="Decorate this room">
      <div className="decorate-head">
        <strong>🌿 Decorating {room.name}</strong>
        <span className="muted small">
          {count}/{MAX_DECOR_PER_ROOM} pieces · {hint}
        </span>
        <button className="btn small primary" onClick={() => game.setDecorate(null)}>
          Done
        </button>
      </div>
      <div className="decorate-tabs" role="tablist" aria-label="Categories">
        {(
          [
            ['floor', '🪑 Furniture'],
            ['wall', '🖼️ Wall'],
          ] as const
        ).map(([c, label]) => (
          <button key={c} role="tab" aria-selected={tab === c} className={`decorate-tab ${tab === c ? 'on' : ''}`} onClick={() => setTab(c)} data-category={c}>
            {label}
          </button>
        ))}
      </div>
      <div className="decorate-items">
        <button className={`decor-item ${tool(false) ? 'on' : ''}`} onClick={() => game.setDecorate({ itemId: null })} aria-pressed={tool(false)} data-tool="remove">
          <span className="decor-remove" aria-hidden>
            🧹
          </span>
          <span>Remove</span>
        </button>
        <button className={`decor-item ${decorate.move ? 'on' : ''}`} onClick={() => game.setDecorate({ itemId: null, move: true })} aria-pressed={!!decorate.move} data-tool="move">
          <span className="decor-remove" aria-hidden>
            ✋
          </span>
          <span>Move</span>
        </button>
        {items.map((d) => (
          <button
            key={d.id}
            className={`decor-item ${decorate.itemId === d.id && !decorate.moving ? 'on' : ''}`}
            onClick={() => game.setDecorate({ itemId: d.id })}
            aria-pressed={decorate.itemId === d.id && !decorate.moving}
            title={d.wall ? `${d.name} · ${wallSpanOf(d)} ${wallSpanOf(d) === 1 ? 'tile' : 'tiles'} of wall` : d.name}
            data-item={d.id}
          >
            <ItemPreview item={d} sceneId={sceneId} />
            <span>{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
