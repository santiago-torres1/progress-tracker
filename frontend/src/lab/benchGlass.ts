/*
 * The bench's own glass, drawn over the liquid on the same canvas: walls, base, the near half of the
 * rim, one streak of window. Bench only. On the board the glass is design-agent's SVG, with its
 * back layer behind the liquid's canvas and its front layer in front; the production painter
 * (`lib/water/liquidPaint.ts`) draws the liquid and nothing else.
 *
 * Inked in `--vessel-ink`, the board's own wall colour, because the `--glass-rim` this used to use is
 * white and disappeared against the light theme.
 */

import type { LiquidVessel } from '../lib/water/vessel';

export interface GlassInk {
  ink: string;
  shine: string;
}

/** The ink for whatever theme is in force on the page. */
export function readGlassInk(styles: CSSStyleDeclaration): GlassInk {
  return {
    ink: styles.getPropertyValue('--vessel-ink').trim() || 'rgba(128, 128, 128, 0.4)',
    shine: styles.getPropertyValue('--glass-hi-soft').trim() || 'rgba(255, 255, 255, 0.14)',
  };
}

/** Draw the glass in CSS px; the canvas's transform is already the renderer's. */
export function drawBenchGlass(
  canvas: HTMLCanvasElement,
  vessel: LiquidVessel,
  glass: GlassInk,
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const { width: W, height: H, taper } = vessel;
  const inset = ((1 - taper) * W) / 2;
  ctx.save();
  ctx.beginPath();
  // Walls and base, drawn half a pixel in so the stroke is not clipped by the canvas edge.
  const r = Math.max(0, Math.min(vessel.radius, (W - 2 * inset) / 2, H));
  ctx.moveTo(0.75, 0);
  ctx.lineTo(inset + 0.75, H - r);
  ctx.quadraticCurveTo(inset + 0.75, H - 0.75, inset + r, H - 0.75);
  ctx.lineTo(W - inset - r, H - 0.75);
  ctx.quadraticCurveTo(W - inset - 0.75, H - 0.75, W - inset - 0.75, H - r);
  ctx.lineTo(W - 0.75, 0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = glass.ink;
  ctx.stroke();
  // The rim, as the near half of an ellipse: the glass is round.
  ctx.beginPath();
  ctx.ellipse(W / 2, 0.75, W / 2 - 0.75, 3.5, 0, 0, Math.PI);
  ctx.lineWidth = 1;
  ctx.stroke();
  // One vertical streak of window on the left wall.
  ctx.fillStyle = glass.shine;
  ctx.fillRect(W * 0.12 + inset * 0.3, H * 0.08, 2.5, H * 0.7);
  ctx.restore();
}
