/** Screen-space UI drawn on the canvas: pills, name tags, bubbles. Crisp at any zoom. */
export const UI_FONT = '"Nunito", "Segoe UI", system-ui, sans-serif';
export const INK_CSS = '#2a1f2d';
export const PAPER = '#fff8ec';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function pill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottom: number,
  text: string,
  opts: { bg?: string; fg?: string; size?: number; bold?: boolean; border?: string; padX?: number } = {},
): { x: number; y: number; w: number; h: number } {
  const size = opts.size ?? 12;
  ctx.font = `${opts.bold === false ? 600 : 800} ${size}px ${UI_FONT}`;
  const padX = opts.padX ?? 7;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = size + 9;
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottom - h);
  ctx.fillStyle = 'rgba(42,31,45,0.25)';
  roundRect(ctx, x, y + 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = opts.bg ?? PAPER;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.border ?? INK_CSS;
  ctx.stroke();
  ctx.fillStyle = opts.fg ?? INK_CSS;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  return { x, y, w, h };
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

/* ------------------------------------------------------------------ speech bubbles, laid out as a set */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Someone mid-sentence: where they are, what they said, and how to label the bubble. */
export interface BubbleSpec {
  key: string;
  /** The speaker's head (screen x) and the top of whatever sits over it (name pill, marker, head). */
  anchorX: number;
  anchorY: number;
  name: string;
  text: string;
  /** When it was said (newest bubbles sit closest to their speaker; older ones move up and fade). */
  start: number;
  /** Lifetime fade in/out, 0..1. */
  alpha: number;
  /** Border colour (an NPC's bubbles are edged in their colour). */
  accent?: string;
  /** A little head of the speaker at the bubble's left (sprite canvas + crop). */
  head?: { img: CanvasImageSource; sx: number; sy: number; sw: number; sh: number };
}

export interface PlacedBubble extends BubbleSpec, Rect {
  lines: string[];
  nameW: number;
  fade: number;
  /** Whether the tail has clear air to its speaker (a bubble stacked over another carries none). */
  tail: boolean;
}

const BUBBLE = { font: `600 12px ${UI_FONT}`, nameFont: `800 12px ${UI_FONT}`, lh: 15, padL: 5, icon: 24, gap: 5, padR: 9, padV: 6, maxText: 188 };

/** Wrap "Name: text" — the name bold on the first line — into the text column. */
function bubbleLines(ctx: CanvasRenderingContext2D, name: string, text: string): { lines: string[]; nameW: number; width: number } {
  ctx.font = BUBBLE.nameFont;
  const nameW = Math.ceil(ctx.measureText(`${name}: `).width);
  ctx.font = BUBBLE.font;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let widest = 0;
  const budget = () => BUBBLE.maxText - (lines.length === 0 ? nameW : 0);
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > budget() && cur) {
      widest = Math.max(widest, ctx.measureText(cur).width + (lines.length === 0 ? nameW : 0));
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  lines.push(cur);
  widest = Math.max(widest, ctx.measureText(cur).width + (lines.length === 1 ? nameW : 0));
  return { lines: lines.slice(0, 4), nameW, width: Math.ceil(widest) };
}

const hit = (a: Rect, b: Rect, m = 3) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * Place every bubble so none overlaps another (or any obstacle, e.g. name pills): the newest sits right over
 * its speaker; each older one takes the nearest free spot — a little up, or nudged sideways — and fades a
 * step for every newer bubble crowding it, like a chat column rising over the room.
 */
export function layoutBubbles(
  ctx: CanvasRenderingContext2D,
  specs: BubbleSpec[],
  obstacles: Rect[],
  vw: number,
  /** Where each bubble sat last frame (offset from its anchor), so bubbles hold still while they can. */
  memory?: Map<string, { dx: number; dy: number }>,
): PlacedBubble[] {
  const placed: PlacedBubble[] = [];
  const taken: Rect[] = [...obstacles];
  for (const s of [...specs].sort((a, b) => b.start - a.start)) {
    const { lines, nameW, width } = bubbleLines(ctx, s.name, s.text);
    const w = BUBBLE.padL + BUBBLE.icon + BUBBLE.gap + width + BUBBLE.padR;
    const h = Math.max(lines.length * BUBBLE.lh + BUBBLE.padV * 2 - 1, BUBBLE.icon + 6);
    const baseX = s.anchorX - w / 2;
    const baseY = s.anchorY - 9 - h;
    const was = memory?.get(s.key);
    const cands: Array<{ x: number; y: number; cost: number }> = [];
    for (let k = 0; k <= 24; k++)
      for (const f of [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75]) {
        const x = Math.round(Math.min(Math.max(baseX + f * w, 6), vw - 6 - w));
        const y = Math.round(baseY - k * 5);
        // holding last frame's spot beats a marginally better one (no jitter as people shuffle)
        const stay = was && Math.abs(x - s.anchorX - was.dx) < 4 && Math.abs(y - s.anchorY - was.dy) < 4 ? 30 : 0;
        cands.push({ x, y, cost: k * 5 + Math.abs(f * w) * 1.4 - stay });
      }
    cands.sort((a, b) => a.cost - b.cost);
    let spot = cands.find((c) => !taken.some((r) => hit({ x: c.x, y: c.y, w, h }, r)));
    if (!spot) {
      // very crowded: stack above everything this bubble would touch
      const x = Math.round(Math.min(Math.max(baseX, 6), vw - 6 - w));
      const over = taken.filter((r) => r.x < x + w && x < r.x + r.w && r.y < baseY + h);
      spot = { x, y: Math.round(Math.min(baseY, ...over.map((r) => r.y - h - 4))), cost: 0 };
    }
    const crowd = placed.filter((p) => Math.abs(p.x + p.w / 2 - (spot!.x + w / 2)) < 220 && Math.abs(p.y - spot!.y) < 160).length;
    const b: PlacedBubble = { ...s, x: spot.x, y: Math.max(4, spot.y), w, h, lines, nameW, fade: Math.max(0, Math.min(1, crowd / 3)), tail: true };
    placed.push(b);
    taken.push(b);
    memory?.set(s.key, { dx: b.x - s.anchorX, dy: b.y - s.anchorY });
  }
  if (memory) for (const k of [...memory.keys()]) if (!specs.some((s) => s.key === k)) memory.delete(k);
  for (const b of placed) {
    const tx = Math.min(Math.max(b.anchorX, b.x + 12), b.x + b.w - 12);
    const under: Rect = { x: tx - 6, y: b.y + b.h, w: 12, h: 9 };
    b.tail = !placed.some((o) => o !== b && hit(under, o, 0));
  }
  return placed;
}

/** Blend two #rrggbb colours (t = 0 → a). */
function mixCss(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

/** One laid-out bubble: speaker's head, bold name, text, and a tail that finds its speaker. */
export function drawBubble(ctx: CanvasRenderingContext2D, b: PlacedBubble) {
  ctx.save();
  // Bubbles stay solid (see-through text over busy art is unreadable); an older one dims its ink instead.
  ctx.globalAlpha = Math.max(0, Math.min(1, b.alpha));
  const { x, y, w, h } = b;
  const dim = 0.45 * b.fade;
  const edge = mixCss(b.accent ?? INK_CSS, '#b9adb7', dim);
  const ink = mixCss(INK_CSS, '#8f8490', dim);
  // the tail points at its speaker (leaning when the bubble had to move aside)
  const tipX = Math.round(Math.min(Math.max(b.anchorX, x + 12), x + w - 12));
  const reach = Math.min(8, Math.max(4, b.anchorY - 2 - (y + h)));
  const lean = Math.max(-6, Math.min(6, (b.anchorX - tipX) * 0.5));
  ctx.fillStyle = 'rgba(42,31,45,0.22)';
  roundRect(ctx, x, y + 3, w, h, 9);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 9);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = edge;
  ctx.stroke();
  if (b.tail) {
    ctx.beginPath();
    ctx.moveTo(tipX - 5, y + h - 1);
    ctx.lineTo(tipX + lean, y + h + reach);
    ctx.lineTo(tipX + 5, y + h - 1);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tipX - 5, y + h);
    ctx.lineTo(tipX + lean, y + h + reach);
    ctx.lineTo(tipX + 5, y + h);
    ctx.stroke();
  }
  // speaker's head, pixel-crisp
  const ix = x + BUBBLE.padL;
  const iy = y + Math.round((h - (b.head?.sh ?? BUBBLE.icon)) / 2);
  if (b.head) {
    // 1:1 (a whole number of pixels per sprite pixel: scaling down would drop pixels)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(b.head.img, b.head.sx, b.head.sy, b.head.sw, b.head.sh, ix, iy, b.head.sw, b.head.sh);
  }
  const tx = ix + BUBBLE.icon + BUBBLE.gap;
  const ty = y + Math.round((h - b.lines.length * BUBBLE.lh) / 2) + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = b.accent ? edge : ink;
  ctx.font = BUBBLE.nameFont;
  ctx.fillText(`${b.name}:`, tx, ty);
  ctx.fillStyle = ink;
  ctx.font = BUBBLE.font;
  b.lines.forEach((l, i) => ctx.fillText(l, tx + (i === 0 ? b.nameW : 0), ty + i * BUBBLE.lh));
  ctx.restore();
}

export function speechBubble(ctx: CanvasRenderingContext2D, cx: number, bottom: number, text: string, alpha: number, accent?: string) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 12px ${UI_FONT}`;
  const lines = wrapText(ctx, text, 170);
  const lh = 15;
  const w = Math.min(190, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18);
  const h = lines.length * lh + 10;
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottom - h - 7);
  ctx.fillStyle = 'rgba(42,31,45,0.22)';
  roundRect(ctx, x, y + 3, w, h, 9);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 9);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent ?? INK_CSS;
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(cx - 6, y + h - 1);
  ctx.lineTo(cx, y + h + 7);
  ctx.lineTo(cx + 5, y + h - 1);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 6, y + h);
  ctx.lineTo(cx, y + h + 7);
  ctx.lineTo(cx + 5, y + h);
  ctx.stroke();
  ctx.fillStyle = INK_CSS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + 6 + i * lh));
  ctx.restore();
  return y;
}
