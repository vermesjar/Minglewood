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
