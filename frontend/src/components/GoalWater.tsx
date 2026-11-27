/*
 * The live liquid in a goal's glass.
 *
 * Mounted by `GoalGlass` in the slot between the glass's back and its front, so the walls and the
 * rim are in front of it. The slot is exactly the vessel's inside; this measures it, builds the water
 * the owner chose for it (`createGlass`: an 8 cm drinking glass, strength 0.5), and paints it with
 * the production painter (`liquidPaint.ts`), clipped to the glass. The glass itself is the SVG's.
 *
 * IT GOES LIVE ONLY ONCE IT HAS DRAWN. `GoalGlass` hides its still liquid when this host carries
 * `goal-tile__water--live`, and the class is added after the first frame has actually been painted
 * — never on mounting — so there is no instant with no water in the glass. It never goes live:
 *   - for a reader who asked for less motion (and it lets go if they ask while it is running);
 *   - in a browser that gives no 2D context;
 *   - in jsdom, where the test setup returns no context, so the still liquid is what every test sees.
 *
 * ONE LOOP FOR THE WHOLE BOARD (`driver.ts`), which reads every glass's position before anything is
 * drawn, and stops when nothing moves: a sleeping glass is neither stepped nor painted.
 */

import { useEffect, useRef, useState } from 'react';
import { join, wake } from '../lib/water/driver';
import { createLiquidRenderer, liquidStops } from '../lib/water/liquidPaint';
import type { Slosh } from '../lib/water/slosh';
import { readLiquidTints, type WaterTints } from '../lib/water/tints';
import { createGlass, readVesselBox, type LiquidVessel } from '../lib/water/vessel';
import './GoalWater.css';

export interface GoalWaterProps {
  /**
   * 0–1. The level the surface settles to, and the only thing this needs: "full" is not a second
   * input, it is `level >= 1`, so the canvas and the glass's own full styling cannot disagree.
   */
  level: number;
}

const LESS_MOTION = '(prefers-reduced-motion: reduce)';
const DARK = '(prefers-color-scheme: dark)';

/**
 * A media query, or nothing where there is no `matchMedia` (jsdom, a worker). Widened here because
 * the DOM types say it is always present and it is not.
 */
function query(text: string): MediaQueryList | null {
  const ask = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
  return ask?.(text) ?? null;
}

export function GoalWater({ level }: GoalWaterProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [live, setLive] = useState(false);

  /** The level as a prop, for whichever water exists when it changes or is (re)built. */
  const levelRef = useRef(level);
  /** Hands a level change to the running water. Null while there is none. */
  const pourRef = useRef<((next: number) => void) | null>(null);

  /*
   * The first level a glass is given is a FACT — this is how full it is — and every one after it is
   * an EVENT, because something happened: a tick pours in, an undo drains back out. A board that
   * loads with a full glass on it shows a full glass; it does not perform a pour nobody caused.
   */
  useEffect(() => {
    levelRef.current = level;
    pourRef.current?.(level);
  }, [level]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const lessMotion = query(LESS_MOTION);
    // Asked for less motion: draw nothing, leave the still liquid in the glass, cost nothing.
    if (lessMotion?.matches === true) return;

    // Made here rather than rendered by React, so a re-run of this effect never inherits a canvas
    // some earlier run already drew into.
    const canvas = document.createElement('canvas');
    canvas.className = 'goal-tile__water-surface';
    host.appendChild(canvas);
    const renderer = createLiquidRenderer(canvas);
    if (renderer === null) {
      // No 2D context: the still liquid stays, and nothing joins the loop.
      canvas.remove();
      return;
    }

    let model: Slosh | null = null;
    let vessel: LiquidVessel | null = null;
    let color = 'rgb(100, 116, 139)';
    let tints: { resting?: WaterTints; full?: WaterTints } = {};
    /** Something other than the water changed — size, theme, level — so the next frame paints. */
    let dirty = true;
    let drawn = false;

    /**
     * Read everything the drawing depends on that is not the water: the slot's box (the vessel),
     * the area's colour (through the host's `color`, since canvas cannot read a custom property),
     * and the liquid tints for the theme in force. Run on mounting, on every resize of the slot —
     * which is what `+` / `−` on a tile is — and whenever the theme changes.
     */
    const measure = (): void => {
      const width = host.offsetWidth;
      const height = host.offsetHeight;
      if (width === 0 || height === 0) return;
      const styles = getComputedStyle(host);
      const next = readVesselBox(styles, width, height);
      if (vessel?.width !== width || vessel.height !== height) {
        // A glass of a new size is a new glass: its scale (`realScale`) is its width. Built still,
        // at the level it holds — resizing pours nothing — and the old one gives its droplets back.
        const previous = model;
        model = createGlass(next);
        model.setLevel(levelRef.current, false);
        previous?.dispose();
        vessel = next;
      }
      renderer.resize(next, window.devicePixelRatio || 1);
      color = styles.color.trim() || color;
      tints = readLiquidTints(styles);
      dirty = true;
    };

    measure();

    pourRef.current = (next) => {
      if (model === null) return;
      model.setLevel(next, true);
      dirty = true;
      wake();
    };

    const observer = new ResizeObserver(() => {
      measure();
      wake();
    });
    observer.observe(host);

    const dark = query(DARK);
    const onTheme = (): void => {
      measure();
      wake();
    };
    dark?.addEventListener('change', onTheme);

    const leave = join({
      element: host,
      accelerated(ax, ay) {
        if (model === null) return;
        // A full glass holds still: at the brim there is nowhere for a slosh to go but over it.
        const full = model.level >= 1;
        model.drive(full ? 0 : ax, full ? 0 : ay);
      },
      render(elapsed, onScreen) {
        if (model === null) return false;
        const moving = model.advance(elapsed);
        // Out of sight it keeps settling, and is painted when it is back.
        if (!onScreen) {
          if (moving) dirty = true;
          return moving;
        }
        // Still water is not redrawn. The loop runs while ANY glass moves, and without this one
        // tile being dragged would repaint every glass on the board for an identical picture.
        if (!moving && !dirty) return false;
        dirty = false;
        renderer.draw(model, { color, stops: liquidStops(tints, model.level >= 1) });
        if (!drawn) {
          drawn = true;
          setLive(true);
        }
        return moving;
      },
    });

    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      pourRef.current = null;
      leave();
      observer.disconnect();
      dark?.removeEventListener('change', onTheme);
      lessMotion?.removeEventListener('change', onLessMotion);
      model?.dispose();
      renderer.destroy();
      canvas.remove();
      setLive(false);
    };
    // Asked for less motion while it runs: let go at once, and the still liquid comes back.
    function onLessMotion(event: MediaQueryListEvent): void {
      if (event.matches) stop();
    }
    lessMotion?.addEventListener('change', onLessMotion);

    return stop;
  }, []);

  return (
    <span
      ref={hostRef}
      className={live ? 'goal-tile__water goal-tile__water--live' : 'goal-tile__water'}
      aria-hidden="true"
    />
  );
}
