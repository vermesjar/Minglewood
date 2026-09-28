import { useEffect, useRef } from 'react';
import { DECOR_CATALOG, MAX_DECOR_PER_ROOM } from '@shared/world/decor';
import { spriteFor } from '../engine/sprites/registry';
import { game } from '../app/game';
import { useStore } from '../app/store';

function ItemPreview({ itemId }: { itemId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const item = DECOR_CATALOG.find((d) => d.id === itemId);
    const c = ref.current;
    if (!item || !c) return;
    const s = spriteFor({ id: 'p', sprite: item.sprite, variant: item.variant, facing: item.facing, x: 0, y: 0 });
    if (!s) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const scale = Math.min(44 / s.canvas.width, 44 / s.canvas.height, 2);
    const w = s.canvas.width * scale;
    const h = s.canvas.height * scale;
    ctx.drawImage(s.canvas, (48 - w) / 2, 48 - h, w, h);
  }, [itemId]);
  return <canvas ref={ref} width={48} height={48} style={{ imageRendering: 'pixelated' }} aria-hidden />;
}

/** Decorate mode: pick a piece, click the floor to place it; click your team's pieces to remove. */
export function DecoratePalette() {
  const decorate = useStore((s) => s.decorate);
  const sceneId = useStore((s) => s.sceneId);
  const count = useStore((s) => s.boot?.decorations.filter((d) => d.roomId === s.sceneId).length ?? 0);
  const room = useStore((s) => s.boot?.rooms.find((r) => r.id === s.sceneId));
  useEffect(() => {
    if (decorate && !game.canDecorate(sceneId)) game.setDecorate(null);
  }, [decorate, sceneId]);
  if (!decorate || !room) return null;
  return (
    <div className="decorate card" role="toolbar" aria-label="Decorate this room">
      <div className="decorate-head">
        <strong>🌿 Decorating {room.name}</strong>
        <span className="muted small">
          {count}/{MAX_DECOR_PER_ROOM} pieces · click the floor to place · click a team piece to remove
        </span>
        <button className="btn small primary" onClick={() => game.setDecorate(null)}>
          Done
        </button>
      </div>
      <div className="decorate-items">
        <button className={`decor-item ${decorate.itemId === null ? 'on' : ''}`} onClick={() => game.setDecorate({ itemId: null })} aria-pressed={decorate.itemId === null}>
          <span className="decor-remove" aria-hidden>
            🧹
          </span>
          <span>Remove</span>
        </button>
        {DECOR_CATALOG.map((d) => (
          <button key={d.id} className={`decor-item ${decorate.itemId === d.id ? 'on' : ''}`} onClick={() => game.setDecorate({ itemId: d.id })} aria-pressed={decorate.itemId === d.id} title={d.name}>
            <ItemPreview itemId={d.id} />
            <span>{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
