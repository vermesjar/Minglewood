import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AvatarLoadout, PresenceStatus } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { STATUS_META } from '@shared/presence';
import { AVATAR_CROPS, avatarSprite, type Pose } from '../engine/sprites/avatar';

/** Pixel-art avatar rendered into a small canvas. `head` crops to the face. */
export function AvatarCanvas({
  loadout,
  scale = 3,
  facing = 'se',
  pose = 'stand',
  head = false,
  crop,
  className,
}: {
  loadout: AvatarLoadout;
  scale?: number;
  facing?: Facing;
  pose?: Pose;
  head?: boolean;
  crop?: keyof typeof AVATAR_CROPS;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = AVATAR_CROPS[crop ?? (head ? 'head' : 'body')] ?? AVATAR_CROPS.full;
  const [sx, sy, sw, sh] = [r.x, r.y, r.w, r.h];
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const s = avatarSprite(loadout, facing, pose);
    ctx.drawImage(s.canvas, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
  }, [loadout, scale, facing, pose, sx, sy, sw, sh]);
  return (
    <canvas
      ref={ref}
      width={sw * scale}
      height={sh * scale}
      className={className}
      style={{ imageRendering: 'pixelated', width: sw * scale, height: sh * scale }}
      aria-hidden
    />
  );
}

export function StatusDot({ status, size = 10 }: { status: PresenceStatus; size?: number }) {
  return (
    <span
      className="status-dot"
      style={{ width: size, height: size, background: STATUS_META[status].color }}
      aria-label={STATUS_META[status].label}
      role="img"
    />
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const d = Math.floor((now - new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30.4);
  if (m < 12) return `${m} month${m === 1 ? '' : 's'} ago`;
  const y = Math.floor(d / 365.25);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

export function tenureLabel(start: string): string {
  const t = timeAgo(start);
  if (t === 'today') return 'Joined today 🌱';
  if (t === 'yesterday') return 'Joined yesterday 🌱';
  return `Joined ${t}`;
}

export function localTime(tz: string): string {
  try {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return '';
  }
}

export function formatDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A card anchored near a screen point, kept inside the viewport. */
export function Popover({ x, y, children, onClose, label }: { x: number; y: number; children: ReactNode; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 12;
    let left = x + 18;
    let top = y - r.height / 2;
    if (left + r.width > window.innerWidth - pad) left = x - r.width - 18;
    left = Math.max(pad, Math.min(left, window.innerWidth - r.width - pad));
    top = Math.max(70, Math.min(top, window.innerHeight - r.height - 90));
    setPos({ left, top });
  }, [x, y, children]);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="card popover"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <button className="close-x" onClick={onClose} aria-label="Close">
        ×
      </button>
      {children}
    </div>
  );
}

export function Modal({ children, onClose, label, wide }: { children: ReactNode; onClose: () => void; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`card modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <button className="close-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
