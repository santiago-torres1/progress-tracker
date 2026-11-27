/*
 * The glass a goal stands in.
 *
 * Two SVG layers with a slot between them, because the live liquid is a canvas and the glass has to
 * be both behind it and in front of it:
 *
 *   BACK    the shadow and the light the water throws on the table, the room seen through the
 *           glass, the far half of the rim — and the STILL LIQUID (`.goal-glass__still`);
 *   SLOT    `.goal-glass__liquid`: a box exactly the vessel's inside (its rim is the box's top edge,
 *           its walls lean in to a floor `--vessel-taper` times as wide, its floor corners are rounded
 *           by `--vessel-floor-r` × the width). Whatever draws live water is mounted here;
 *   FRONT   the etches on the walls, the thick base, the walls, the near half of the rim, and the
 *           streak of window on the near wall — so the glass is in front of whatever is in it.
 *
 * THE STILL LIQUID IS THE REAL FALLBACK, not a placeholder. It is what shows for anyone who asked for
 * less motion, for a browser that gives no canvas context, and in jsdom; it hides itself only once
 * the live water has measured itself and started (`.goal-tile__water--live`, GoalWater's contract).
 * Its GEOMETRY is the live painter's own: the resting surface is `lib/water/liquidPaint.ts`'s
 * `buildEdge` given a flat frame, traced through its `traceEdge`. The two drawing different liquids
 * is the bug CLAUDE.md records twice; here they cannot. Its fills read the `--liquid-*` tokens, which
 * the live painter reads too.
 *
 * Geometry comes from the `--vessel-*` tokens through `readVessel`, the same reader the live water
 * uses, read once. The foot under the floor (`--vessel-foot`) is glass, outside the liquid.
 */

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  EMPTY_PX,
  WALL_STRIP,
  WALL_STRIP_MAX,
  buildEdge,
  createEdge,
  traceBody,
  traceEdge,
  traceTopSurface,
  type Edge,
} from '../lib/water/liquidPaint';
import type { PathSink } from '../lib/water/path';
import type { SurfaceFrame } from '../lib/water/slosh';
import { VESSEL_FALLBACK, readVessel, type LiquidVessel } from '../lib/water/vessel';
import type { GoalSize } from '../types/api';
import type { StyleWithVars } from '../types/style';
import './GoalGlass.css';

export interface GoalGlassProps {
  size: GoalSize;
  /** Where the water sits, 0–100 — `TileDetail.level`. */
  level: number;
  /** A habit's minimum, 0–100, etched on both walls. */
  minimumLevel: number | null;
  /** Where a measured goal's water used to be, 0–100, etched at a whisper. */
  previousLevel: number | null;
  /** The minimum has been met: its etch sets in the area's colour. */
  kept: boolean;
  /** The live liquid. Mounted in the slot between the glass's back and its front. */
  children?: ReactNode;
}

/** Room around the vessel inside the box: the light pooled on the table, the rim, the shadow. */
const SIDE = 12;
const TOP = 5;
const BELOW = 7;
/** drawGlass's rim: the near half of an ellipse this tall. */
const RIM_RY = 3.5;
/** Samples across a resting surface. It is flat, so this only needs to be enough for the ellipse. */
const SAMPLES = 25;

interface Geometry {
  vessels: Record<GoalSize, LiquidVessel>;
  foot: number;
}

let geometry: Geometry | null = null;

/** The vessel tokens, read once. They do not change with the theme. */
function readGeometry(): Geometry {
  if (geometry !== null) return geometry;
  if (typeof document === 'undefined') {
    const make = (size: GoalSize): LiquidVessel => ({
      width: VESSEL_FALLBACK[size].width,
      height: VESSEL_FALLBACK[size].height,
      taper: VESSEL_FALLBACK.taper,
      radius: VESSEL_FALLBACK.floorRadius * VESSEL_FALLBACK[size].width,
    });
    return {
      vessels: { small: make('small'), medium: make('medium'), large: make('large') },
      foot: 0.06,
    };
  }
  const styles = getComputedStyle(document.documentElement);
  const foot = Number.parseFloat(styles.getPropertyValue('--vessel-foot'));
  geometry = {
    vessels: {
      small: readVessel(styles, 'small'),
      medium: readVessel(styles, 'medium'),
      large: readVessel(styles, 'large'),
    },
    foot: Number.isFinite(foot) && foot >= 0 ? foot : 0.06,
  };
  return geometry;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** A PathSink that writes an SVG path, so the live painter's tracers can draw into a `d`. */
class PathString implements PathSink {
  d = '';

  moveTo(x: number, y: number): void {
    this.d += `M${f(x)} ${f(y)}`;
  }

  lineTo(x: number, y: number): void {
    this.d += `L${f(x)} ${f(y)}`;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.d += `Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`;
  }

  closePath(): void {
    this.d += 'Z';
  }
}

/** The slosh model's surface at rest: flat at the level, across the waterline of a tapered glass. */
function restingEdge(vessel: LiquidVessel, fill: number): Edge | null {
  const depth = fill * vessel.height;
  if (depth < EMPTY_PX) return null;
  // Slosh.waterlineAt: the walls lean in, so the surface is narrower the lower it is.
  const waterline = vessel.width * (vessel.taper + (1 - vessel.taper) * fill);
  const xs = new Float64Array(SAMPLES);
  const hs = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    xs[i] = (waterline * i) / (SAMPLES - 1);
    hs[i] = depth;
  }
  const frame: SurfaceFrame = { xs, hs, count: SAMPLES, waterline, depth, level: depth, heave: 0 };
  const edge = buildEdge(frame, vessel, true, createEdge(SAMPLES + 4));
  return edge.deepest >= EMPTY_PX ? edge : null;
}

interface StillShapes {
  edge: string;
  body: string;
  band: string;
  gradientTop: number;
}

/** liquidPaint's body, band and front edge, as path strings. */
function stillShapes(edge: Edge, vessel: LiquidVessel): StillShapes {
  const front = new PathString();
  traceEdge(front, edge, true);

  // The body: the front edge, then down past the floor; the vessel's clip draws the floor.
  const body = new PathString();
  traceBody(body, edge, vessel);

  // The band of top surface, as liquidPaint draws it on flat water: a round glass's ellipse.
  const band = new PathString();
  traceTopSurface(band, edge, true);

  return {
    edge: front.d,
    body: body.d,
    band: band.d,
    gradientTop: Math.round(edge.restY * 2) / 2 - 2,
  };
}

export function GoalGlass({
  size,
  level,
  minimumLevel,
  previousLevel,
  kept,
  children,
}: GoalGlassProps) {
  const uid = useId().replace(/:/g, '');
  const id = (name: string): string => `goal-glass-${name}-${uid}`;

  const { vessels, foot: footShare } = readGeometry();
  const vessel = vessels[size];
  const { width: W, height: H, taper } = vessel;
  const fill = Math.min(Math.max(level / 100, 0), 1);
  const full = level >= 100;

  const inset = ((1 - taper) * W) / 2;
  const r = Math.max(0, Math.min(vessel.radius, (W - 2 * inset) / 2, H));
  const foot = Math.round(H * footShare);
  const Hb = H + foot;
  const rO = r * 0.5;
  const slope = inset / (H - r);
  const insetO = slope * (Hb - rO);
  const boxW = W + 2 * SIDE;
  const boxH = TOP + Hb + BELOW;

  const edge = restingEdge(vessel, fill);
  const still = edge === null ? null : stillShapes(edge, vessel);

  const cavity = `M0 0L${f(W)} 0L${f(W - inset)} ${f(H - r)}Q${f(W - inset)} ${f(H)} ${f(W - inset - r)} ${f(H)}L${f(inset + r)} ${f(H)}Q${f(inset)} ${f(H)} ${f(inset)} ${f(H - r)}Z`;
  const outer = `M0 0L${f(insetO)} ${f(Hb - rO)}Q${f(insetO)} ${f(Hb)} ${f(insetO + rO)} ${f(Hb)}L${f(W - insetO - rO)} ${f(Hb)}Q${f(W - insetO)} ${f(Hb)} ${f(W - insetO)} ${f(Hb - rO)}L${f(W)} 0`;
  const floor = `M${f(inset)} ${f(H - r)}Q${f(inset)} ${f(H)} ${f(inset + r)} ${f(H)}L${f(W - inset - r)} ${f(H)}Q${f(W - inset)} ${f(H)} ${f(W - inset)} ${f(H - r)}`;
  const rimNear = `M0 0A${f(W / 2)} ${f(RIM_RY)} 0 0 0 ${f(W)} 0`;
  const rimFar = `M0 0A${f(W / 2)} ${f(RIM_RY)} 0 0 1 ${f(W)} 0`;
  const strip = Math.min(W * WALL_STRIP, WALL_STRIP_MAX);
  const place = `translate(${String(SIDE)} ${String(TOP)})`;

  /** Two etches at one height, near wall and far wall, each reaching in from the wall. */
  const wallAt = (y: number): number => slope * Math.min(Math.max(0, y), H - r);
  const near = Math.max(6, W * 0.09);
  const far = Math.max(8, W * 0.13);
  const etch = (at: number, cut: 'min' | 'kept' | 'was') => {
    const y = H - (Math.min(96, Math.max(2, at)) / 100) * H;
    const xl = wallAt(y) + 0.75;
    const xr = W - wallAt(y) - 0.75 - far;
    if (cut === 'kept') {
      return (
        <g className="goal-glass__etch goal-glass__etch--kept">
          <rect x={f(xl)} y={f(y - 1)} width={f(near)} height={2} />
          <rect x={f(xr)} y={f(y - 1)} width={f(far)} height={2} />
        </g>
      );
    }
    return (
      <g className={cut === 'was' ? 'goal-glass__etch goal-glass__etch--was' : 'goal-glass__etch'}>
        <rect className="goal-glass__groove" x={f(xl)} y={f(y - 1)} width={f(near)} height={1} />
        <rect className="goal-glass__catch" x={f(xl)} y={f(y)} width={f(near)} height={1} />
        <rect className="goal-glass__groove" x={f(xr)} y={f(y - 1)} width={f(far)} height={1} />
        <rect className="goal-glass__catch" x={f(xr)} y={f(y)} width={f(far)} height={1} />
      </g>
    );
  };

  const box: StyleWithVars = { width: boxW, height: boxH, '--fill': fill };
  const slot: CSSProperties = {
    left: SIDE,
    top: TOP,
    width: W,
    height: H,
    borderBottomLeftRadius: r,
    borderBottomRightRadius: r,
  };

  return (
    <span
      className={full ? 'goal-glass goal-glass--full' : 'goal-glass'}
      style={box}
      aria-hidden="true"
    >
      <svg
        className="goal-glass__back"
        width={boxW}
        height={boxH}
        viewBox={`0 0 ${String(boxW)} ${String(boxH)}`}
      >
        <defs>
          <clipPath id={id('cavity')}>
            <path d={cavity} />
          </clipPath>
          <radialGradient id={id('contact')}>
            <stop offset="0" className="goal-glass__stop-contact" />
            <stop offset="1" className="goal-glass__stop-contact-clear" />
          </radialGradient>
          <radialGradient id={id('pool')}>
            <stop offset="0" className="goal-glass__stop-pool" />
            <stop offset="1" className="goal-glass__stop-clear" />
          </radialGradient>
          {still !== null && (
            <>
              <clipPath id={id('body')}>
                <path d={still.body} />
              </clipPath>
              <linearGradient
                id={id('depth')}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={f(still.gradientTop)}
                x2="0"
                y2={f(H)}
              >
                <stop offset="0" className="goal-glass__stop-film" />
                <stop offset="0.12" className="goal-glass__stop-top" />
                <stop offset="0.7" className="goal-glass__stop-mid" />
                <stop offset="1" className="goal-glass__stop-deep" />
              </linearGradient>
              <linearGradient
                id={id('near')}
                gradientUnits="userSpaceOnUse"
                x1={f(inset * 0.5)}
                y1="0"
                x2={f(inset * 0.5 + strip)}
                y2="0"
              >
                <stop offset="0" className="goal-glass__stop-wall-near" />
                <stop offset="1" className="goal-glass__stop-clear" />
              </linearGradient>
              <linearGradient
                id={id('far')}
                gradientUnits="userSpaceOnUse"
                x1={f(W - inset * 0.5)}
                y1="0"
                x2={f(W - inset * 0.5 - strip)}
                y2="0"
              >
                <stop offset="0" className="goal-glass__stop-wall-far" />
                <stop offset="1" className="goal-glass__stop-clear" />
              </linearGradient>
            </>
          )}
        </defs>

        <g transform={place}>
          <ellipse
            cx={f(W / 2)}
            cy={f(Hb)}
            rx={f(W / 2 - insetO + 4)}
            ry={3.5}
            fill={`url(#${id('contact')})`}
          />
          {still !== null && (
            <ellipse
              cx={f(W / 2 + W * 0.14)}
              cy={f(Hb + 1)}
              rx={f(W * 0.55)}
              ry={4}
              fill={`url(#${id('pool')})`}
            />
          )}
          <path className="goal-glass__room" d={cavity} />
          <path className="goal-glass__rim-far" d={rimFar} />

          {still !== null && (
            <g className="goal-glass__still" clipPath={`url(#${id('cavity')})`}>
              <path d={still.body} fill={`url(#${id('depth')})`} />
              <g clipPath={`url(#${id('body')})`}>
                <rect
                  x="0"
                  y="0"
                  width={f(inset * 0.5 + strip)}
                  height={f(H)}
                  fill={`url(#${id('near')})`}
                />
                <rect
                  x={f(W - inset * 0.5 - strip)}
                  y="0"
                  width={f(inset * 0.5 + strip)}
                  height={f(H)}
                  fill={`url(#${id('far')})`}
                />
              </g>
              <path className="goal-glass__band" d={still.band} />
              <path className="goal-glass__edge" d={still.edge} />
            </g>
          )}
        </g>
      </svg>

      <span className="goal-glass__liquid" style={slot}>
        {children}
      </span>

      <svg
        className="goal-glass__front"
        width={boxW}
        height={boxH}
        viewBox={`0 0 ${String(boxW)} ${String(boxH)}`}
      >
        <defs>
          <clipPath id={id('wall')}>
            <path d={cavity} />
          </clipPath>
        </defs>
        <g transform={place}>
          <g clipPath={`url(#${id('wall')})`}>
            {minimumLevel !== null && etch(minimumLevel, kept ? 'kept' : 'min')}
            {previousLevel !== null && etch(previousLevel, 'was')}
            <rect
              className="goal-glass__streak"
              x={f(W * 0.12 + inset * 0.3)}
              y={f(H * 0.08)}
              width={2.5}
              height={f(H * 0.7)}
            />
          </g>
          <path className="goal-glass__base" d={`${outer}Z${cavity}`} fillRule="evenodd" />
          <path className="goal-glass__floor" d={floor} />
          <path className="goal-glass__wall" d={outer} />
          <path className="goal-glass__rim" d={rimNear} />
        </g>
      </svg>
    </span>
  );
}
