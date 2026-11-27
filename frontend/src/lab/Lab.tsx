/*
 * The bench. Several models, one gesture, same screen.
 *
 * Since round three the water it shows is PRODUCTION CODE: the model, the droplets and the painter
 * live in `lib/water` (`slosh.ts`, `spray.ts`, `liquidPaint.ts`, `vessel.ts`) and the bench imports
 * them, so what it draws is what the board will draw. Only the glass around the liquid is the
 * bench's own (`benchGlass.ts`); on the board that is design-agent's SVG.
 *
 * ROWS, CHOSEN IN THE URL: `?rows=real,slosh` is the default.
 *
 *   real   the chosen glass, built by `createGlass` exactly as the board will build it: the large
 *          vessel from the `--vessel-*` tokens, an 8 cm drinking glass at strength 0.5, the liquid
 *          in `--liquid-*`.
 *   glass  the same glass at 0.4 mm/px — 3.8 cm across, rocking at 5 Hz — that it was chosen over.
 *   slosh  the same model and liquid in a wide tile's proportions, for comparison with the glass.
 *          (The spring field it was once shown beside was deleted in round four.)
 *   fluid  the particle experiment (`fluid.ts`). NOT CONSTRUCTED unless named: it is expensive
 *          enough that a strip of it ran past two minutes in headless Chrome.
 *
 * The slosh rows are given the vessel's acceleration in both axes through `Motion`, converted to
 * CSS px/s² explicitly — the model works in px with gravity scaled.
 *
 * `?t=520` FREEZES IT: replayed in fixed 60 Hz steps to that millisecond and drawn once.
 * `?strip=drop` draws one glass per row at several moments of a gesture; `?moments=0,40,80` picks
 * them. `?bench=100` steps and draws a hundred live glasses and writes the cost into the page.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { readLiquidTints } from '../lib/water/tints';
import { Fluid } from './fluid';
import { GESTURES, gestureById, handAt, type Gesture } from '../lib/water/gestures';
import { Motion } from '../lib/water/motion';
import { createFluidRenderer, type FluidRenderer } from './paint';
import { createLiquidRenderer, liquidStops, type LiquidRenderer } from '../lib/water/liquidPaint';
import { DEFAULT_STRENGTH, METRES_PER_PX, Slosh, STEP_S } from '../lib/water/slosh';
import { createGlass, readVessel, type LiquidVessel } from '../lib/water/vessel';
import { drawBenchGlass, readGlassInk, type GlassInk } from './benchGlass';
import { readShippedTints } from './shippedRecipe';
import './lab.css';

const STEP_MS = STEP_S * 1000;

type RowId = 'glass' | 'real' | 'slosh' | 'fluid';

const ROWS: Record<RowId, { title: string; vessel: 'tile' | 'glass' }> = {
  glass: {
    title: 'Glass · 0.4 mm/px — 3.8 cm across, rocks at about 5 Hz (not chosen)',
    vessel: 'glass',
  },
  real: { title: 'Glass · as an 8 cm drinking glass — rocks at about 3 Hz', vessel: 'glass' },
  slosh: { title: 'The same liquid in tile proportions · 0.4 mm/px', vessel: 'tile' },
  fluid: { title: 'Particles (not adopted)', vessel: 'tile' },
};

/**
 * The chosen glass first: an 8 cm drinking glass at strength 0.5, picked by the owner on 2026-11-25.
 * The tile and what ships today below it, for comparison. The 3.8 cm glass that lost is still one
 * `?rows=glass,real` away.
 */
const DEFAULT_ROWS: readonly RowId[] = ['real', 'slosh'];

/** The glasses in the grid view: a nearly empty one earns its place. */
const COLUMNS = [
  { name: 'Health · 4%', area: 'health', level: 0.04 },
  { name: 'Learning · 34%', area: 'learning', level: 0.34 },
  { name: 'Money · 62%', area: 'money', level: 0.62 },
  { name: 'Creative · full', area: 'creative', level: 1 },
];

/** One area for the strip: it is about time, not about which goal. */
const STRIP_AREA = 'money';

/**
 * Strip moments per gesture, ms. Several across the first 1.5 s, where the slosh is, and one late
 * frame that has to show still water. Drop and lift happen in a tenth of a second, so their early
 * frames are closer together.
 */
const MOMENTS: Record<string, readonly number[]> = {
  drag: [0, 150, 300, 450, 600, 800, 1200, 4000],
  flick: [0, 70, 100, 130, 170, 250, 600, 4000],
  fling: [0, 100, 200, 300, 450, 650, 1300, 4000],
  shake: [0, 150, 300, 450, 600, 800, 1400, 4500],
  drop: [0, 30, 60, 90, 120, 160, 300, 4000],
  lift: [0, 60, 90, 120, 150, 200, 350, 4000],
  pour: [0, 300, 450, 600, 800, 1000, 1500, 5000],
  still: [0, 600],
};

/** The tile row's vessel, CSS px. The glass rows read theirs from the `--vessel-*` tokens. */
const TILE = { width: 200, height: 90, radius: 18 };

interface Cell {
  freezeAt: number | null;
  painted: boolean;
  vessel: HTMLElement;
  canvas: HTMLCanvasElement;
  caption: HTMLElement | null;
  step(t: number, dtMs: number, here: { x: number; y: number }, pour: number | null): void;
  paint(): void;
  destroy(): void;
  moving(): boolean;
  /** Anything worth saying under a frozen frame: how much is in the air. */
  note(): string;
}

function parseRows(value: string | null): RowId[] {
  if (value === null) return [...DEFAULT_ROWS];
  const picked = value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is RowId => part in ROWS);
  return picked.length > 0 ? picked : [...DEFAULT_ROWS];
}

function parseMoments(value: string | null, gesture: Gesture): readonly number[] {
  if (value !== null) {
    const picked = value
      .split(',')
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part) && part >= 0);
    if (picked.length > 0) return picked;
  }
  return MOMENTS[gesture.id] ?? MOMENTS.fling ?? [0];
}

export function Lab() {
  return <Bench params={new URLSearchParams(window.location.search)} />;
}

function Bench({ params }: { params: URLSearchParams }) {
  const frozenAt = params.get('t');
  const strip = params.get('strip');
  const rowsParam = params.get('rows') ?? params.get('only');
  const momentsParam = params.get('moments');
  // A pour starts from a third, so the rise has room and is not squeezed against the rim.
  const level = Number.parseFloat(params.get('level') ?? (strip === 'pour' ? '0.34' : '0.62'));
  const pourSpray = params.get('pourspray') === '1';
  const [strength, setStrength] = useState(() => {
    const asked = Number.parseFloat(params.get('strength') ?? '');
    return Number.isFinite(asked) ? asked : DEFAULT_STRENGTH;
  });
  /** Read by every cell every step, so the slider acts on glasses already moving. */
  const strengthRef = useRef(strength);
  const [gesture, setGesture] = useState<Gesture>(() =>
    gestureById(params.get('strip') ?? params.get('gesture')),
  );
  const [run, setRun] = useState(0);
  /** The status line is bench chrome, written straight to the DOM: it is not React state. */
  const noteRef = useRef<HTMLSpanElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => parseRows(rowsParam), [rowsParam]);
  const moments = useMemo(() => parseMoments(momentsParam, gesture), [momentsParam, gesture]);

  const freeze = useMemo(() => {
    const value = frozenAt === null ? null : Number.parseFloat(frozenAt);
    return value !== null && Number.isFinite(value) ? value : null;
  }, [frozenAt]);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;

    const hosts = Array.from(grid.querySelectorAll<HTMLElement>('[data-row][data-level]'));
    const cells: Cell[] = [];
    const root = getComputedStyle(document.documentElement);
    const glassInk = readGlassInk(root);

    for (const host of hosts) {
      const vessel = host.querySelector<HTMLElement>('.lab__vessel');
      if (vessel === null) continue;
      const row = host.dataset.row as RowId;
      const cell = createCell(row, host, vessel, glassInk, { strength: strengthRef, pourSpray });
      if (cell !== null) cells.push(cell);
    }

    /** One fixed step of the whole bench at time `t` ms into the gesture. */
    let poured = false;
    const step = (t: number, dtMs: number): void => {
      // The hand's motion, not the drawn one: see `Gesture.hand`.
      const here = handAt(gesture, Math.max(0, t));
      let pour: number | null = null;
      if (gesture.pour !== undefined && !poured && t >= gesture.pour.at) {
        poured = true;
        pour = gesture.pour.by;
      }
      for (const cell of cells) {
        if (cell.freezeAt === null) cell.vessel.style.transform = transformAt(gesture, t);
        cell.step(t, dtMs, here, pour);
      }
    };

    const paintDue = (t: number): void => {
      for (const cell of cells) {
        if (cell.freezeAt === null) cell.paint();
        else if (!cell.painted && t >= cell.freezeAt - 1e-6) {
          cell.painted = true;
          cell.paint();
          if (cell.caption !== null) {
            const here = handAt(gesture, cell.freezeAt);
            const at = `${Math.round(cell.freezeAt)} ms`;
            const moved = here.x === 0 && here.y === 0 ? '' : ` · ${offset(here)}`;
            cell.caption.textContent = at + moved + cell.note();
          }
        }
      }
    };

    let frame = 0;
    let stop = false;
    const release = (): void => {
      stop = true;
      cancelAnimationFrame(frame);
      for (const cell of cells) {
        cell.destroy();
        cell.canvas.remove();
        cell.vessel.style.transform = '';
      }
    };

    const latest = cells.reduce((most, cell) => Math.max(most, cell.freezeAt ?? 0), 0);

    if (freeze !== null || latest > 0) {
      const until = Math.max(freeze ?? 0, latest);
      for (let t = 0; t <= until + 1e-6; t += STEP_MS) {
        step(t, STEP_MS);
        paintDue(t);
      }
      for (const cell of cells) {
        if (!cell.painted) cell.paint();
        // A strip shows each glass where the water is relative to it; the caption says where the
        // glass had got to. A single frozen frame shows the glass where it really was.
        if (strip === null) cell.vessel.style.transform = transformAt(gesture, until);
      }
      say(noteRef.current, `frozen at ${Math.round(until)} ms · ${cells.length} glasses`);
      return release;
    }

    const started = performance.now();
    let previous = started;
    const loop = (now: number): void => {
      if (stop) return;
      const dtMs = Math.min(50, now - previous);
      previous = now;
      // Fixed steps, the same ones a frozen frame replays, so live and frozen agree.
      const t = now - started;
      step(t, dtMs);
      paintDue(t);
      const awake = cells.filter((cell) => cell.moving()).length;
      say(noteRef.current, `t ${Math.round(t)} ms · ${awake} of ${cells.length} glasses moving`);
      if (t > 12_000) return;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return release;
  }, [gesture, run, freeze, strip, level, rows, moments, pourSpray]);

  return (
    <div className="lab">
      <h1>Water, side by side</h1>
      <p className="lab__note">
        One gesture, applied to every row at once, fed as the hand&rsquo;s motion (the vessels are
        drawn travelling at most 60 px). The glass is an 8 cm drinking glass at strength 0.5, the
        pair chosen for the board; <code>?rows=glass,real</code> adds the 3.8 cm glass it was chosen
        over. The strength slider scales how hard any gesture pushes. The water is the board&rsquo;s
        own code (<code>lib/water</code>); only the glass drawn around it is the bench&rsquo;s.{' '}
        <code style={{ whiteSpace: 'nowrap' }}>?pourspray=1</code> lets a pour throw droplets.
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
        <label className="lab__strength">
          Strength {strength.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={strength}
            onChange={(event) => {
              const next = Number(event.target.value);
              strengthRef.current = next;
              setStrength(next);
            }}
          />
        </label>
        <span className="lab__stats" ref={noteRef} />
      </div>

      <div className="lab__grid" ref={gridRef}>
        {rows.map((row) => (
          <section key={`${row}-${run}`} className="lab__row">
            <h2>{ROWS[row].title}</h2>
            <div className={strip === null ? 'lab__cells' : 'lab__cells lab__cells--strip'}>
              {strip === null
                ? COLUMNS.map((column) => (
                    <figure
                      key={column.name}
                      className="lab__cell"
                      data-row={row}
                      data-level={column.level}
                    >
                      <div className="lab__frame">
                        <div
                          className={vesselClass(row)}
                          style={{ color: `var(--area-${column.area})` }}
                        />
                      </div>
                      <figcaption>{column.name}</figcaption>
                    </figure>
                  ))
                : moments.map((moment) => (
                    <figure
                      key={moment}
                      className="lab__cell"
                      data-row={row}
                      data-level={level}
                      data-t={moment}
                    >
                      <div className="lab__frame">
                        <div
                          className={vesselClass(row)}
                          style={{ color: `var(--area-${STRIP_AREA})` }}
                        />
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

function vesselClass(row: RowId): string {
  return ROWS[row].vessel === 'glass'
    ? 'lab__vessel lab__vessel--glass'
    : 'lab__vessel lab__vessel--tile';
}

function offset(here: { x: number; y: number }): string {
  const parts: string[] = [];
  if (here.x !== 0) parts.push(`x ${here.x > 0 ? '+' : ''}${Math.round(here.x)}`);
  if (here.y !== 0) parts.push(`y ${here.y > 0 ? '↓' : '↑'}${Math.abs(Math.round(here.y))}`);
  return parts.join(' ');
}

/** Build one cell of a row: its canvas, its model, its renderer. */
function createCell(
  row: RowId,
  host: HTMLElement,
  vessel: HTMLElement,
  glassInk: GlassInk,
  options: { strength: { current: number }; pourSpray: boolean },
): Cell | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'lab__canvas';
  vessel.appendChild(canvas);

  const width = vessel.offsetWidth;
  const height = vessel.offsetHeight;
  const styles = getComputedStyle(vessel);
  const radius = Number.parseFloat(styles.borderBottomLeftRadius) || TILE.radius;
  const level = Number.parseFloat(host.dataset.level ?? '0');
  const color = styles.color.trim() || 'rgb(120, 120, 120)';
  const dpr = window.devicePixelRatio || 1;
  const frame = host.dataset.t;
  const tints = readShippedTints(styles);
  const caption = host.querySelector<HTMLElement>('figcaption');
  const base = {
    freezeAt: frame === undefined ? null : Number.parseFloat(frame),
    painted: false,
    vessel,
    canvas,
    caption: frame === undefined ? null : caption,
  };

  if (row === 'fluid') {
    const renderer: FluidRenderer | null = createFluidRenderer(canvas);
    if (renderer === null) return null;
    renderer.resize(width, height, dpr);
    const fluid = new Fluid({ wide: width / height });
    fluid.setLevel(level, false);
    for (let i = 0; i < 120; i += 1) fluid.advance(STEP_MS);
    const motion = new Motion();
    return {
      ...base,
      step(_t, dtMs, here, pour) {
        if (pour !== null) fluid.setLevel(Math.min(1, level + pour));
        const { ax, ay } = motion.feed(here.x / height, -here.y / height, dtMs / 1000);
        fluid.drive(ax, ay);
        fluid.advance(dtMs);
      },
      paint() {
        const full = fluid.level >= 1;
        renderer.draw(fluid, {
          color,
          stops: full ? tints.full : tints.resting,
          radius,
        });
      },
      destroy() {
        renderer.destroy();
      },
      moving: () => fluid.moving(),
      note: () => '',
    };
  }

  // The slosh rows: the board's large glass (the promoted model and painter, exactly as the board
  // will build them), the 3.8 cm glass it was chosen over, and the tile.
  const isGlass = row === 'glass' || row === 'real';
  const renderer: LiquidRenderer | null = createLiquidRenderer(canvas);
  if (renderer === null) return null;
  const shape: LiquidVessel = isGlass
    ? { ...readVessel(getComputedStyle(document.documentElement), 'large'), width, height }
    : { width, height, taper: 1, radius };
  renderer.resize(shape, dpr);
  const model =
    row === 'real'
      ? createGlass(shape, { strength: options.strength.current, pourSpray: options.pourSpray })
      : new Slosh({
          width,
          height,
          taper: shape.taper,
          metresPerPx: METRES_PER_PX,
          strength: options.strength.current,
          pourSpray: options.pourSpray,
        });
  const liquid = readLiquidTints(styles);
  model.setLevel(level, false);
  const motion = new Motion();

  return {
    ...base,
    step(_t, dtMs, here, pour) {
      if (pour !== null) model.setLevel(Math.min(1, level + pour));
      // Motion works in GLASS UNITS — the vessel's height is 1, y up — and returns glass units per
      // s². The model works in CSS px, so the conversion is one multiplication by the same height.
      const { ax, ay } = motion.feed(here.x / height, -here.y / height, dtMs / 1000);
      model.strength = options.strength.current;
      model.drive(ax * height, ay * height);
      model.advance(dtMs);
    },
    paint() {
      const full = model.level >= 1;
      renderer.draw(model, { color, stops: liquidStops(liquid, full), round: isGlass });
      if (isGlass) drawBenchGlass(canvas, shape, glassInk);
    },
    destroy() {
      renderer.destroy();
      model.dispose();
    },
    moving: () => !model.asleep,
    note: () => {
      const n = model.droplets.count;
      return n === 0 ? '' : ` · ${n} drops`;
    },
  };
}

function say(target: HTMLElement | null, text: string): void {
  if (target !== null) target.textContent = text;
}

/** Where the vessel is at this moment, as a CSS transform. */
function transformAt(gesture: Gesture, t: number): string {
  const here = gesture.at(Math.max(0, t));
  return `translate(${here.x}px, ${here.y}px)`;
}
