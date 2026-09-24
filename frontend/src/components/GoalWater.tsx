/*
 * The liquid in a glass.
 *
 * A canvas laid over the tile's own CSS water, driven by `WaterField`. It draws the body and the
 * surface; everything else about the vessel — walls, rim, shadow, the copy — stays in CSS.
 *
 * It renders NOTHING in three cases, and each of them leaves the CSS water showing rather than an
 * empty glass:
 *   - the reader asked for less motion;
 *   - the browser gave us no 2D context;
 *   - the component has not measured itself yet.
 * That is why the CSS water is still maintained: it is the floor this stands on, not dead code.
 */

import { useEffect, useRef, useState } from 'react';
import { join, wake } from '../lib/water/driver';
import { WaterField } from '../lib/water/field';
import { borrowGpu } from '../lib/water/pool';
import { createCanvasRenderer } from '../lib/water/renderer';
import './GoalWater.css';

export interface GoalWaterProps {
  /**
   * 0–1. The level the surface settles to, and the only thing this needs: "full" is not a second
   * input, it is `level >= 1`, so the canvas and the tile's own full styling cannot disagree.
   */
  level: number;
}

/**
 * Has the reader asked for less motion?
 *
 * `matchMedia` is typed as always present and is not: jsdom has none, and neither does a worker.
 * Widening it here is what makes the check a real check rather than something the linter is right
 * to call dead — the same move `supabaseAuth.ts` makes for `localStorage`. Answering "no" when
 * there is nothing to ask is right: a test environment has no reader with a preference.
 */
function prefersLessMotion(): boolean {
  const ask = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  return ask?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function GoalWater({ level }: GoalWaterProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const colorRef = useRef('rgb(100, 116, 139)');
  const [live, setLive] = useState(false);

  // `useState` with an initialiser rather than a ref, so the field is built exactly once and
  // nothing reads a ref during render.
  const [field] = useState(() => new WaterField());

  // The first level a tile is given is a FACT — this is how full the glass is — and every one
  // after it is an EVENT, because something happened. A board that loads with a full glass on it
  // shows a full glass; it does not perform a pour nobody caused.
  const poured = useRef(false);
  useEffect(() => {
    field.setLevel(level, poured.current);
    poured.current = true;
    wake();
  }, [field, level]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    // Asked for less motion: draw nothing, leave the CSS water in charge, cost nothing.
    if (prefersLessMotion()) return;

    /*
     * A FRESH CANVAS EVERY TIME, made here rather than rendered by React.
     *
     * A canvas that has lost a WebGL context can never be given another one, and tearing a Pixi
     * application down loses the context by design. React reuses DOM nodes across an effect's
     * cleanup and re-run — which StrictMode does deliberately on every mount in development — so
     * a rendered canvas was being handed to Pixi, destroyed, and handed over again dead. Pixi
     * reported "this browser does not support WebGL", the pool believed it, and every tile on the
     * board silently fell back to 2D on a machine that was perfectly capable.
     */
    const canvas = document.createElement('canvas');
    canvas.className = 'goal-tile__water-surface';
    host.appendChild(canvas);

    // Setting up is asynchronous, because asking for a GPU context is. The component can unmount
    // in the middle of that — a board being filtered does it constantly — so everything below
    // checks the signal before taking a resource, and hands back anything it already took.
    // An AbortController rather than a boolean: `signal.aborted` is read fresh every time, where
    // a captured `let` reads as permanently false to anything analysing this function.
    const unmounted = new AbortController();
    let teardown: (() => void) | null = null;

    void (async () => {
      const lease = await borrowGpu(canvas, unmounted.signal);
      if (unmounted.signal.aborted) {
        lease?.release();
        return;
      }

      // No GPU going spare — most of a busy board — so draw the same picture in 2D.
      const renderer = lease?.renderer ?? createCanvasRenderer(canvas);
      if (renderer === null) return;

      const tile = host.parentElement ?? host;
      let radius = 18;

      const measure = (): void => {
        // The HOST is measured, never the canvas. A canvas's size is an output of this call, not
        // an input to it: Pixi starts every application at its own default of 800x600 and writes
        // that straight onto the element's inline style, so measuring the canvas just read Pixi's
        // guess back and agreed with it. Every GPU tile drew its water at the bottom of an 800x600
        // surface, most of it outside a tile 190px tall, and the glass looked empty.
        const box = host.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
        // The area colour is a custom property and canvas cannot read one, so it is resolved here
        // through the host's own `color`, once, rather than every frame.
        colorRef.current = getComputedStyle(host).color.trim() || colorRef.current;
        radius = Number.parseFloat(getComputedStyle(tile).borderBottomLeftRadius) || radius;
        setLive(true);
      };

      measure();

      const observer = new ResizeObserver(() => {
        measure();
        wake();
      });
      observer.observe(host);

      const leave = join({
        element: tile,
        moved(dx) {
          // Raw pixels: how much of that reaches the water is the field's business, not ours.
          field.tilt(dx);
        },
        render(elapsed) {
          const moving = field.advance(elapsed);
          renderer.draw((at) => field.heightAt(at), {
            color: colorRef.current,
            full: field.level >= 1,
            radius,
          });
          return moving;
        },
      });

      // No second abort check below: nothing awaits between the one above and this assignment, so
      // the component cannot unmount in that window. React's cleanup does the rest.
      teardown = () => {
        leave();
        observer.disconnect();
        if (lease !== null) lease.release();
        else renderer.destroy();
        canvas.remove();
        setLive(false);
      };
    })();

    return () => {
      unmounted.abort();
      if (teardown === null) canvas.remove();
      else teardown();
    };
  }, [field]);

  return (
    <span
      ref={hostRef}
      className={live ? 'goal-tile__water goal-tile__water--live' : 'goal-tile__water'}
      aria-hidden="true"
    />
  );
}
