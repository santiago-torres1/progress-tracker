/*
 * `lab.html?bench=100`: what a hundred glasses cost per frame, measured in the browser.
 *
 * Three boards of a hundred goals: all calm, eight breaking up at once, and all hundred breaking —
 * the worst case, which no real board reaches. Sizes are a desktop board's: mostly small tiles,
 * some medium, a few large.
 *
 * It runs SYNCHRONOUSLY, at module load and before React, a fixed number of frames in a loop.
 * Headless Chrome under a virtual-time budget does not run animation frames reliably, and inside a
 * React effect its clock did not advance at all: the first run of this bench reported zero for
 * everything. Run while the page is still loading, `performance.now()` is real. Two figures come
 * out for drawing:
 *
 *   record  the time to issue the canvas calls, which is what the main thread pays per frame when
 *           rasterising happens elsewhere (GPU raster, the ordinary case in a real browser);
 *   flushed the same plus reading one pixel back from every canvas, which forces each one to
 *           rasterise before the clock stops — an upper bound, and the honest number for a
 *           software-rendered machine (this headless run is `--disable-gpu`).
 *
 * The result is written into `<pre id="bench-result">` as JSON, for `--dump-dom`. (The spring field
 * it was once measured beside was deleted in round four; `?board=1` measures the real tiles.)
 */

import { createLiquidRenderer } from '../lib/water/liquidPaint';
import { G_PX, STEP_S } from '../lib/water/slosh';
import { readLiquidTints } from '../lib/water/tints';
import { VESSEL_FALLBACK, createGlass } from '../lib/water/vessel';
import { liquidStops } from '../lib/water/liquidPaint';
import { DropletBudget } from '../lib/water/spray';

/**
 * Since round three the board's goals are glasses (layout B): large, medium and small, the
 * `--vessel-*` tokens' sizes. Mostly small, some medium, a few large.
 */
const SIZES = [
  { width: 64, height: 100, share: 0.6 },
  { width: 80, height: 125, share: 0.3 },
  { width: 96, height: 150, share: 0.1 },
];

const AREAS = ['health', 'learning', 'money', 'relationships', 'work', 'creative'];

const WARM = 30;
const FRAMES = 120;

export interface BenchResult {
  tiles: number;
  dpr: number;
  frames: number;
  pixels: number;
  /** All asleep; eight breaking; all breaking. */
  calm: Timing & { mostInAir: number; thrown: number };
  eight: Timing & { mostInAir: number; thrown: number };
  worst: Timing & { mostInAir: number; thrown: number };
}

interface Timing {
  stepMs: number;
  recordMs: number;
  flushedMs: number;
  stepP95: number;
  recordP95: number;
}

function sizeFor(i: number, tiles: number): { width: number; height: number } {
  const u = (i + 0.5) / tiles;
  let acc = 0;
  for (const size of SIZES) {
    acc += size.share;
    if (u <= acc) return size;
  }
  return SIZES[0] ?? { width: 64, height: 100 };
}

/** Build a hundred tiles in `host`, run the frames, and write the result into the page. */
export function runSloshBench(host: HTMLElement, tiles: number): BenchResult {
  const dpr = window.devicePixelRatio || 1;
  const canvases: HTMLCanvasElement[] = [];
  const boxes: { width: number; height: number; color: string }[] = [];

  for (let i = 0; i < tiles; i += 1) {
    const size = sizeFor(i, tiles);
    const holder = document.createElement('div');
    holder.className = 'lab-bench__tile';
    holder.style.width = `${size.width}px`;
    holder.style.height = `${size.height}px`;
    holder.style.color = `var(--area-${AREAS[i % AREAS.length] ?? 'money'})`;
    const canvas = document.createElement('canvas');
    canvas.className = 'lab__canvas';
    holder.appendChild(canvas);
    host.appendChild(holder);
    canvases.push(canvas);
    boxes.push({ ...size, color: getComputedStyle(holder).color });
  }
  const liquid = liquidStops(readLiquidTints(getComputedStyle(host)), false);
  let pixels = 0;
  for (const box of boxes) pixels += box.width * box.height * dpr * dpr;

  // --- the modal slosh, three boards -------------------------------------------------------------
  /*
   * (a) calm: every glass asleep, as a board nobody is touching is. (b) eight glasses flicked hard
   * enough to break up, the rest asleep. (c) the worst case: all hundred breaking at once, which the
   * shared droplet budget caps at 300 in the air. As on the board, a sleeping glass is neither
   * stepped nor drawn: `advance` returns at once and the loop skips its paint.
   */
  const scenario = (breaking: number): Timing & { mostInAir: number; thrown: number } => {
    const budget = new DropletBudget();
    const glasses = boxes.map((box, i) => {
      const vessel = {
        width: box.width,
        height: box.height,
        taper: VESSEL_FALLBACK.taper,
        radius: VESSEL_FALLBACK.floorRadius * box.width,
      };
      // Exactly as the board will build a glass: `createGlass`, an 8 cm glass at strength 0.5.
      const model = createGlass(vessel, { seed: i + 1, budget });
      model.setLevel(0.25 + ((i * 37) % 60) / 100, false);
      model.advance(STEP_S * 1000);
      const renderer = createLiquidRenderer(canvases[i] ?? document.createElement('canvas'));
      renderer?.resize(vessel, dpr);
      // Spread the breaking ones across the board.
      const live = breaking > 0 && i % Math.max(1, Math.floor(boxes.length / breaking)) === 0;
      return { model, renderer, box, live, phase: (i * 2.39996) % (Math.PI * 2) };
    });
    let mostInAir = 0;
    const timing = measure(
      (frame) => {
        const t = frame * STEP_S;
        for (const g of glasses) {
          if (g.live) {
            // A hard shake, about 3 g of hand at 3 Hz: past breaking on every tile size here.
            g.model.drive(3 * G_PX * Math.sin(2 * Math.PI * 3 * t + g.phase), 0);
          }
          g.model.advance(STEP_S * 1000);
        }
        mostInAir = Math.max(mostInAir, budget.live);
      },
      () => {
        for (const g of glasses) {
          if (g.model.asleep) continue;
          g.renderer?.draw(g.model, { color: g.box.color, stops: liquid });
        }
      },
      canvases,
    );
    const thrown = glasses.reduce((sum, g) => sum + g.model.droplets.thrown, 0);
    for (const g of glasses) g.model.dispose();
    return { ...timing, mostInAir, thrown };
  };

  const calm = scenario(0);
  const eight = scenario(8);
  const worst = scenario(boxes.length);

  return { tiles, dpr, frames: FRAMES, pixels: Math.round(pixels), calm, eight, worst };
}

function measure(
  step: (frame: number) => void,
  draw: () => void,
  canvases: readonly HTMLCanvasElement[],
): Timing {
  const steps: number[] = [];
  const records: number[] = [];
  let flushed = 0;
  const probes = canvases.map((canvas) => canvas.getContext('2d'));

  for (let frame = 0; frame < WARM + FRAMES; frame += 1) {
    const a = performance.now();
    step(frame);
    const b = performance.now();
    draw();
    const c = performance.now();
    for (const ctx of probes) ctx?.getImageData(0, 0, 1, 1);
    const d = performance.now();
    if (frame >= WARM) {
      steps.push(b - a);
      records.push(c - b);
      flushed += d - b;
    }
  }

  return {
    stepMs: round(mean(steps)),
    recordMs: round(mean(records)),
    flushedMs: round(flushed / FRAMES),
    stepP95: round(p95(steps)),
    recordP95: round(p95(records)),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
