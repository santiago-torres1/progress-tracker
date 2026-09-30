/*
 * The bench. Two models, one gesture, same screen.
 *
 * The top row is what ships today: `lib/water/field.ts`, a one-dimensional height field, drawn by
 * `lib/water/renderer.ts` in canvas 2D. The bottom row is `lab/fluid.ts`, a particle fluid, drawn by
 * `lab/paint.ts` — same colours, same alphas, same depth stops, all imported from the shipped
 * renderer so that the only difference on the screen is the difference in the MODEL.
 *
 * Both rows are driven by the same `Gesture`: the vessel is moved by a CSS transform and each model
 * measures the vessel the way it measures a real tile. The shipped one is given the horizontal
 * movement of its centre, because that is all `driver.ts` measures and all `field.tilt()` accepts.
 * The new one is given the acceleration of that centre in both axes, which is what a moving glass
 * actually does to its water.
 *
 * `?t=520` FREEZES IT. The whole run is replayed in fixed 60Hz steps up to that millisecond and then
 * drawn once, so a screenshot is reproducible to the frame instead of depending on when Chrome got
 * round to it. Without that, every screenshot of moving water is a different picture and none of
 * them can be compared to the last one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { WaterField } from '../lib/water/field';
import { createCanvasRenderer, type WaterRenderer } from '../lib/water/renderer';
import { readWaterTints, type WaterTints } from '../lib/water/tints';
import { Fluid } from './fluid';
import { GESTURES, Motion, gestureById, type Gesture } from './gestures';
import { createFluidRenderer, type FluidRenderer } from './paint';
import './lab.css';

const STEP_MS = 1000 / 60;

/** The four glasses, as on the shipped water bench: a nearly empty one earns its place. */
const COLUMNS = [
  { name: 'Health · 4%', color: 'rgb(95, 194, 148)', level: 0.04 },
  { name: 'Learning · 34%', color: 'rgb(154, 157, 245)', level: 0.34 },
  { name: 'Money · 62%', color: 'rgb(224, 180, 92)', level: 0.62 },
  { name: 'Creative · full', color: 'rgb(199, 154, 232)', level: 1 },
];

/**
 * When the thing being shown happens over time, show time.
 *
 * `?strip=drop` draws one glass at seven moments of the same gesture, for both models, each replayed
 * from the same start in fixed steps. A slosh is a sequence and a screenshot is not, so without this
 * every report about the vertical response would be a sentence asking somebody to imagine it.
 */
const MOMENTS = [0, 90, 160, 240, 340, 480, 760];

/** One area colour for the strip: it is about time, not about which goal. */
const STRIP_COLOR = 'rgb(224, 180, 92)';

const FALLBACK: WaterTints = [0.13, 0.24, 0.28];
const FALLBACK_FULL: WaterTints = [0.18, 0.27, 0.3];

interface Cell {
  /** The millisecond this cell is painted at and then left alone. Null means every frame. */
  freezeAt: number | null;
  painted: boolean;
  host: HTMLElement;
  vessel: HTMLElement;
  canvas: HTMLCanvasElement;
  level: number;
  color: string;
  width: number;
  height: number;
  radius: number;
  tints: { resting?: WaterTints; full?: WaterTints };
}

interface OldCell extends Cell {
  kind: 'old';
  field: WaterField;
  renderer: WaterRenderer;
  lastX: number;
}

interface NewCell extends Cell {
  kind: 'new';
  fluid: Fluid;
  renderer: FluidRenderer;
  motion: Motion;
}

function stops(cell: Cell, full: boolean): WaterTints {
  if (full) return cell.tints.full ?? FALLBACK_FULL;
  return cell.tints.resting ?? FALLBACK;
}

export function Lab() {
  const params = new URLSearchParams(window.location.search);
  const frozenAt = params.get('t');
  const only = params.get('only');
  const strip = params.get('strip');
  const level = Number.parseFloat(params.get('level') ?? '0.62');
  const [gesture, setGesture] = useState<Gesture>(() =>
    gestureById(params.get('strip') ?? params.get('gesture')),
  );
  const [run, setRun] = useState(0);
  const [note, setNote] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);

  const freeze = useMemo(() => {
    const value = frozenAt === null ? null : Number.parseFloat(frozenAt);
    return value !== null && Number.isFinite(value) ? value : null;
  }, [frozenAt]);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;

    const hosts = Array.from(grid.querySelectorAll<HTMLElement>('[data-row][data-level]'));
    const cells: (OldCell | NewCell)[] = [];

    for (const host of hosts) {
      const vessel = host.querySelector<HTMLElement>('.lab__vessel');
      if (vessel === null) continue;
      const canvas = document.createElement('canvas');
      canvas.className = 'lab__canvas';
      vessel.appendChild(canvas);

      const width = vessel.offsetWidth;
      const height = vessel.offsetHeight;
      const styles = getComputedStyle(vessel);
      const radius = Number.parseFloat(styles.borderBottomLeftRadius) || 16;
      const level = Number.parseFloat(host.dataset.level ?? '0');
      const color = host.dataset.color ?? 'rgb(120,120,120)';
      const dpr = window.devicePixelRatio || 1;
      const frame = host.dataset.t;
      const base = {
        freezeAt: frame === undefined ? null : Number.parseFloat(frame),
        painted: false,
        host,
        vessel,
        canvas,
        level,
        color,
        width,
        height,
        radius,
        tints: readWaterTints(styles),
      };

      if (host.dataset.row === 'old') {
        const renderer = createCanvasRenderer(canvas);
        if (renderer === null) continue;
        renderer.resize(width, height, dpr);
        const field = new WaterField();
        field.setLevel(level, false);
        cells.push({ ...base, kind: 'old', field, renderer, lastX: 0 });
      } else {
        const renderer = createFluidRenderer(canvas);
        if (renderer === null) continue;
        renderer.resize(width, height, dpr);
        const fluid = new Fluid({ wide: width / height });
        fluid.setLevel(level, false);
        cells.push({ ...base, kind: 'new', fluid, renderer, motion: new Motion() });
      }
    }

    // Let every glass find its own rest before the gesture starts, so the screenshot is of the
    // gesture and not of four glasses still recovering from being created.
    for (const cell of cells) {
      for (let i = 0; i < 120; i += 1) {
        if (cell.kind === 'old') cell.field.advance(STEP_MS);
        else cell.fluid.advance(STEP_MS);
      }
    }

    let poured = false;

    const paint = (cell: OldCell | NewCell): void => {
      if (cell.kind === 'old') {
        const full = cell.field.level >= 1;
        cell.renderer.draw((at) => cell.field.heightAt(at), {
          color: cell.color,
          full,
          level: cell.field.level,
          radius: cell.radius,
          stops: stops(cell, full),
        });
      } else {
        cell.renderer.draw(cell.fluid, {
          color: cell.color,
          stops: stops(cell, cell.fluid.level >= 1),
          radius: cell.radius,
        });
      }
    };

    /** One fixed step of the whole bench at time `t` ms into the gesture. */
    const step = (t: number, dtMs: number): void => {
      const here = gesture.at(Math.max(0, t));
      const dt = dtMs / 1000;

      if (gesture.pour !== undefined && !poured && t >= gesture.pour.at) {
        poured = true;
        for (const cell of cells) {
          const next = Math.min(1, cell.level + gesture.pour.by);
          if (cell.kind === 'old') cell.field.setLevel(next);
          else cell.fluid.setLevel(next);
        }
      }

      for (const cell of cells) {
        if (cell.freezeAt === null) cell.vessel.style.transform = transformAt(gesture, t);
        if (cell.kind === 'old') {
          // Exactly what `driver.ts` hands the shipped field: horizontal pixels, nothing else.
          const dx = here.x - cell.lastX;
          cell.lastX = here.x;
          if (dx !== 0) cell.field.tilt(dx);
          cell.field.advance(dtMs);
        } else {
          // Glass units, y up: the vessel's own height is 1, and CSS y points the other way.
          const { ax, ay } = cell.motion.feed(here.x / cell.height, -here.y / cell.height, dt);
          cell.fluid.drive(ax, ay);
          cell.fluid.advance(dtMs);
        }
      }
    };

    /** Paint any cell whose moment has arrived, and every cell if there are no moments. */
    const paintDue = (t: number): void => {
      for (const cell of cells) {
        if (cell.freezeAt === null) paint(cell);
        else if (!cell.painted && t >= cell.freezeAt) {
          cell.painted = true;
          paint(cell);
        }
      }
    };

    let frame = 0;
    let stop = false;
    const release = (): void => {
      stop = true;
      cancelAnimationFrame(frame);
      for (const cell of cells) {
        cell.renderer.destroy();
        cell.canvas.remove();
        cell.vessel.style.transform = '';
      }
    };

    const latest = cells.reduce((most, cell) => Math.max(most, cell.freezeAt ?? 0), 0);

    if (freeze !== null || latest > 0) {
      // Replay in fixed steps, painting each cell at its own moment, then stop. A screenshot of this
      // page is the same picture every time it is taken, which is the only way two of them compare.
      const until = Math.max(freeze ?? 0, latest);
      for (let t = 0; t <= until; t += STEP_MS) {
        step(t, STEP_MS);
        paintDue(t);
      }
      // Anything whose moment fell between the last step and `until` is still unpainted.
      for (const cell of cells) {
        if (!cell.painted) paint(cell);
        cell.vessel.style.transform = transformAt(gesture, cell.freezeAt ?? until);
      }
      report(cells, setNote, until);
      return release;
    }

    const started = performance.now();
    let previous = started;
    const loop = (now: number): void => {
      if (stop) return;
      const dtMs = Math.min(50, now - previous);
      previous = now;
      step(now - started, dtMs);
      paintDue(now - started);
      if (now - started > 12_000) {
        report(cells, setNote, now - started);
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const ticker = window.setInterval(() => {
      report(cells, setNote, performance.now() - started);
    }, 400);
    return () => {
      window.clearInterval(ticker);
      release();
    };
  }, [gesture, run, freeze, strip, level]);

  const rows = [
    { id: 'old', title: 'Shipped — one height per x, a curve that bends' },
    { id: 'new', title: 'Lab — particles, which can divide, fall and rejoin' },
  ].filter((row) => only === null || only === row.id);

  return (
    <div className="lab">
      <h1>Water, two models</h1>
      <p className="lab__note">
        One gesture, applied to both rows at once. The vessel really moves; each model measures it
        the way it would measure a tile. The shipped field is given the horizontal movement of the
        vessel&rsquo;s centre, which is all <code>driver.ts</code> measures; the particle fluid is
        given the acceleration of that centre in both axes.
      </p>

      <div className="lab__controls">
        {GESTURES.map((g) => (
          <button
            key={g.id}
            type="button"
            className={g.id === gesture.id ? 'is-on' : ''}
            onClick={() => {
              setGesture(g);
              setRun((n) => n + 1);
            }}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setRun((n) => n + 1);
          }}
        >
          Again
        </button>
        <span className="lab__stats">{note}</span>
      </div>

      <div className="lab__grid" ref={gridRef}>
        {rows.map((row) => (
          <section key={row.id} className="lab__row">
            <h2>{row.title}</h2>
            <div className={strip === null ? 'lab__cells' : 'lab__cells lab__cells--strip'}>
              {strip === null
                ? COLUMNS.map((column) => (
                    <figure
                      key={column.name}
                      className="lab__cell"
                      data-row={row.id}
                      data-level={column.level}
                      data-color={column.color}
                    >
                      <div className="lab__frame">
                        <div className="lab__vessel" style={{ color: column.color }} />
                      </div>
                      <figcaption>{column.name}</figcaption>
                    </figure>
                  ))
                : MOMENTS.map((moment) => (
                    <figure
                      key={moment}
                      className="lab__cell"
                      data-row={row.id}
                      data-level={level}
                      data-color={STRIP_COLOR}
                      data-t={moment}
                    >
                      <div className="lab__frame">
                        <div className="lab__vessel" style={{ color: STRIP_COLOR }} />
                      </div>
                      <figcaption>{moment} ms</figcaption>
                    </figure>
                  ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Where the vessel is at this moment, as a CSS transform. */
function transformAt(gesture: Gesture, t: number): string {
  const here = gesture.at(Math.max(0, t));
  return `translate(${here.x}px, ${here.y}px)`;
}

/** What the bench says about itself: particles, pieces, and the cost of a frame. */
function report(cells: (OldCell | NewCell)[], setNote: (value: string) => void, t: number): void {
  let particles = 0;
  let loops = 0;
  let ms = 0;
  let awake = 0;
  for (const cell of cells) {
    if (cell.kind !== 'new') continue;
    particles += cell.fluid.count;
    loops = Math.max(loops, cell.renderer.stats.loops);
    ms += cell.renderer.stats.ms;
    if (cell.fluid.moving()) awake += 1;
  }
  setNote(
    `t ${Math.round(t)}ms · ${particles} particles · most pieces in one glass ${loops} · ` +
      `${ms.toFixed(2)}ms to draw four · ${awake} still moving`,
  );
}
