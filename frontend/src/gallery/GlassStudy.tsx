/*
 * THE GLASS STUDY — gallery only. Three ways for a goal to stop being a card with water behind its
 * words and become a glass, drawn from the real fixtures so the owner can pick one.
 *
 *   A  a card, with the glass standing at one side of it and the words in a column beside it;
 *   B  the glass IS the tile: it stands on a shelf, and the words hang under it like a label;
 *   C  B's shelf and A's arrangement — the glass and its words side by side, with no card at all.
 *
 * Nothing here is production. `GoalTile` is untouched; the words below come from `lib/describeGoal`,
 * the same functions the tile reads, so every sentence is one the app already says.
 *
 * THE LIQUID IS STATIC AND IT IS `lab/sloshPaint.ts` AT REST. A round glass at rest is the slosh
 * model's flat surface traced by that file's own rules: a 3px meniscus that fades in over the first
 * 10px of depth, a 6px ellipse of top surface seen from slightly above, the body gradient anchored
 * 2px above the resting surface, and two wall-absorption strips. The constants below are that
 * file's, cited rather than reinvented; the only new numbers are the tints and the vessel, and they
 * are tokens (`--liquid-*`, `--vessel-*` in tokens.css) which the SVG reads.
 *
 * `?frame=desktop` or `?frame=phone` shows one width; `?measure=1` writes what the study measured
 * into `<pre id="gs-measure">` for `--dump-dom`.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GoalAction } from '../components/GoalAction';
import { CheckIcon } from '../components/icons';
import { formatPercent } from '../components/format';
import { describeGoal, type TileDetail } from '../lib/describeGoal';
import type { GoalSize, GoalSummary } from '../types/api';
import type { StyleWithVars } from '../types/style';
import { STUDY_GOALS } from './fixtures';
import './glassStudy.css';

export type StudyVariant = 'A' | 'B' | 'C';

/* --- the vessel, from the tokens -------------------------------------------------------------- */

interface Vessel {
  w: number;
  h: number;
  taper: number;
  floorR: number;
  foot: number;
}

const SIZE_KEY: Record<GoalSize, string> = { small: 'sm', medium: 'md', large: 'lg' };

/** Only for a page with no stylesheet: these are the tokens' own values. */
const FALLBACK: Record<GoalSize, { w: number; h: number }> = {
  small: { w: 64, h: 100 },
  medium: { w: 80, h: 125 },
  large: { w: 96, h: 150 },
};

let vessels: Record<GoalSize, Vessel> | null = null;

function readNumber(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** Read once: the geometry is a token, and the SVG's arithmetic needs it as a number. */
function vesselFor(size: GoalSize): Vessel {
  if (vessels === null) {
    const styles = getComputedStyle(document.documentElement);
    const taper = readNumber(styles, '--vessel-taper', 0.86);
    const floorR = readNumber(styles, '--vessel-floor-r', 0.146);
    const foot = readNumber(styles, '--vessel-foot', 0.06);
    const make = (s: GoalSize): Vessel => ({
      w: readNumber(styles, `--vessel-${SIZE_KEY[s]}-w`, FALLBACK[s].w),
      h: readNumber(styles, `--vessel-${SIZE_KEY[s]}-h`, FALLBACK[s].h),
      taper,
      floorR,
      foot,
    });
    vessels = { small: make('small'), medium: make('medium'), large: make('large') };
  }
  return vessels[size];
}

/* --- sloshPaint.ts at rest -------------------------------------------------------------------- */

// Every one of these is sloshPaint.ts's own constant, at rest, for a round glass.
const MENISCUS_PX = 3;
const MENISCUS_LAMBDA = 2;
const MENISCUS_OFF = 2;
const MENISCUS_IN = 10;
const TOP_BAND_ROUND_PX = 6;
const EMPTY_PX = 1;
const WALL_STRIP = 0.1;
const WALL_STRIP_MAX = 22;
const WALL_ALPHA_ROUND = 0.2;
/** drawGlass: the rim is the near half of an ellipse this tall. */
const RIM_RY = 3.5;

/** Room around the vessel inside the SVG: the pool of light on the table, the rim, the shadow. */
const SIDE = 12;
const TOP = 5;
const BELOW = 7;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

const f = (n: number): string => n.toFixed(2);

interface RestShape {
  /** Front edge, left wall to right wall, as an open path. */
  edge: string;
  body: string;
  band: string;
  /** Where the body gradient starts. */
  gradientTop: number;
  /** The liquid's highest and lowest surface points, vessel y — for the crossing check. */
  surfaceTop: number;
  surfaceBottom: number;
}

/**
 * `buildEdge` + `traceEdge` + `traceBack` from sloshPaint.ts for a flat surface: the slosh model at
 * rest has `hs[j] = depth` everywhere, so the run is a straight line and only the meniscus, the paid
 * area and the ellipse of the round top remain.
 */
function restShape(v: Vessel, level: number): RestShape | null {
  const { w: W, h: H, taper } = v;
  const p = clamp01(level);
  const depth = p * H;
  if (depth < EMPTY_PX) return null;

  const Wl = W * (taper + (1 - taper) * p);
  const inset = (W - Wl) / 2;
  const fade = clamp01((depth - MENISCUS_OFF) / (MENISCUS_IN - MENISCUS_OFF));
  const room = clamp01((H - depth) / (MENISCUS_PX * 2));
  const climb = MENISCUS_PX * fade * (0.4 + 0.6 * room);
  const reach = Math.min(3 * MENISCUS_LAMBDA, Wl / 6);
  // The meniscus is water, so it is paid for out of the middle.
  const pay = Wl > 0 ? (2 * (5 / 6) * climb * MENISCUS_LAMBDA) / Wl : 0;
  const y0 = H - (depth - pay);
  const room2 = clamp01((H - depth) / 4 + 0.35);

  const n = 25;
  const px: number[] = [];
  const front: number[] = [];
  const back: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = inset + reach + ((Wl - 2 * reach) * i) / (n - 1);
    const u = (x - inset) / Wl;
    const band = TOP_BAND_ROUND_PX * room2 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) * fade;
    px.push(x);
    front.push(y0 + 0.5 * band);
    back.push(y0 - 0.5 * band);
  }

  const leftX = inset;
  const rightX = inset + Wl;
  const top = y0 - climb;
  const at = (arr: readonly number[], i: number): number => arr[i] ?? 0;

  let edge = `M${f(leftX)} ${f(top)} Q${f(leftX + reach / 3)} ${f(at(front, 0))} ${f(at(px, 0))} ${f(at(front, 0))}`;
  for (let i = 1; i < n - 1; i += 1) {
    const mx = (at(px, i) + at(px, i + 1)) / 2;
    const my = (at(front, i) + at(front, i + 1)) / 2;
    edge += ` Q${f(at(px, i))} ${f(at(front, i))} ${f(mx)} ${f(my)}`;
  }
  edge += ` L${f(at(px, n - 1))} ${f(at(front, n - 1))}`;
  edge += ` Q${f(rightX - reach / 3)} ${f(at(front, n - 1))} ${f(rightX)} ${f(top)}`;

  const body = `${edge} L${f(W + 2)} ${f(y0)} L${f(W + 2)} ${f(H + 2)} L-2 ${f(H + 2)} L-2 ${f(y0)} Z`;

  let band = `${edge} L${f(at(px, n - 1))} ${f(at(back, n - 1))}`;
  for (let i = n - 2; i > 0; i -= 1) {
    const mx = (at(px, i) + at(px, i - 1)) / 2;
    const my = (at(back, i) + at(back, i - 1)) / 2;
    band += ` Q${f(at(px, i))} ${f(at(back, i))} ${f(mx)} ${f(my)}`;
  }
  band += ` L${f(at(px, 0))} ${f(at(back, 0))} L${f(leftX)} ${f(top)} Z`;

  const rest = Math.round((H - depth) * 2) / 2;
  const sag = Math.max(...front);
  return {
    edge,
    body,
    band,
    gradientTop: rest - 2,
    surfaceTop: Math.min(top, ...back),
    surfaceBottom: sag,
  };
}

/* --- the glass ------------------------------------------------------------------------------- */

interface StudyGlassProps {
  size: GoalSize;
  /** 0–1. */
  level: number;
  /** A habit's minimum, 0–1. */
  minimum?: number | null;
  /** Where a measured goal's water used to be, 0–1. */
  was?: number | null;
  /** The minimum has been met: its etch sets in the area's colour. */
  kept?: boolean;
}

/**
 * One glass, standing. Back to front: the shadow and the light it throws on the table, the room
 * seen through it, the far half of the rim, the liquid (body, wall absorption, top surface, front
 * edge), the etches on its walls, the thick base, the walls, the near half of the rim, the streak
 * of window on the near wall.
 */
export function StudyGlass({
  size,
  level,
  minimum = null,
  was = null,
  kept = false,
}: StudyGlassProps) {
  const uid = useId().replace(/:/g, '');
  const ref = (name: string): string => `gs-${name}-${uid}`;

  const v = vesselFor(size);
  const { w: W, h: H } = v;
  const inset = ((1 - v.taper) * W) / 2;
  const r = Math.max(0, Math.min(v.floorR * W, (W - 2 * inset) / 2, H));
  const foot = Math.round(H * v.foot);
  const Hb = H + foot;
  const rO = r * 0.5;
  const slope = inset / (H - r);
  const insetO = slope * (Hb - rO);
  const svgW = W + 2 * SIDE;
  const svgH = TOP + Hb + BELOW;
  const full = level >= 1;
  const rest = restShape(v, level);

  const vessel = `M0 0 L${f(W)} 0 L${f(W - inset)} ${f(H - r)} Q${f(W - inset)} ${f(H)} ${f(W - inset - r)} ${f(H)} L${f(inset + r)} ${f(H)} Q${f(inset)} ${f(H)} ${f(inset)} ${f(H - r)} Z`;
  const outer = `M0 0 L${f(insetO)} ${f(Hb - rO)} Q${f(insetO)} ${f(Hb)} ${f(insetO + rO)} ${f(Hb)} L${f(W - insetO - rO)} ${f(Hb)} Q${f(W - insetO)} ${f(Hb)} ${f(W - insetO)} ${f(Hb - rO)} L${f(W)} 0`;
  const floor = `M${f(inset)} ${f(H - r)} Q${f(inset)} ${f(H)} ${f(inset + r)} ${f(H)} L${f(W - inset - r)} ${f(H)} Q${f(W - inset)} ${f(H)} ${f(W - inset)} ${f(H - r)}`;
  const rimFront = `M0 0 A${f(W / 2)} ${f(RIM_RY)} 0 0 0 ${f(W)} 0`;
  const rimBack = `M0 0 A${f(W / 2)} ${f(RIM_RY)} 0 0 1 ${f(W)} 0`;

  const strip = Math.min(W * WALL_STRIP, WALL_STRIP_MAX);
  const wallX = (y: number): number => slope * Math.min(Math.max(0, y), H - r);
  const lenNear = Math.max(6, W * 0.09);
  const lenFar = Math.max(8, W * 0.13);

  /** Two etches at one height, near wall and far wall. `kind` decides how they are cut. */
  const etch = (at: number, kind: 'min' | 'kept' | 'was') => {
    const y = H - Math.min(0.96, Math.max(0.02, at)) * H;
    const xl = wallX(y) + 0.75;
    const xr = W - wallX(y) - 0.75 - lenFar;
    if (kind === 'kept') {
      return (
        <g className="gs-etch gs-etch--kept">
          <rect x={f(xl)} y={f(y - 1)} width={f(lenNear)} height={2} />
          <rect x={f(xr)} y={f(y - 1)} width={f(lenFar)} height={2} />
        </g>
      );
    }
    return (
      <g className={kind === 'was' ? 'gs-etch gs-etch--was' : 'gs-etch'}>
        <rect className="gs-etch__ink" x={f(xl)} y={f(y - 1)} width={f(lenNear)} height={1} />
        <rect className="gs-etch__lit" x={f(xl)} y={f(y)} width={f(lenNear)} height={1} />
        <rect className="gs-etch__ink" x={f(xr)} y={f(y - 1)} width={f(lenFar)} height={1} />
        <rect className="gs-etch__lit" x={f(xr)} y={f(y)} width={f(lenFar)} height={1} />
      </g>
    );
  };

  const style: StyleWithVars = { '--fill': clamp01(level) };

  return (
    <svg
      className={full ? 'gs-glass gs-glass--full' : 'gs-glass'}
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${String(svgW)} ${String(svgH)}`}
      aria-hidden="true"
      style={style}
      data-gs-glass=""
      data-vx={SIDE}
      data-vy={TOP}
      data-vw={W}
      data-vh={Hb}
      data-water-top={rest === null ? '' : f(TOP + rest.surfaceTop)}
      data-water-bottom={rest === null ? '' : f(TOP + rest.surfaceBottom)}
    >
      <defs>
        <clipPath id={ref('vessel')}>
          <path d={vessel} />
        </clipPath>
        <radialGradient id={ref('contact')}>
          <stop offset="0" className="gs-stop-contact" />
          <stop offset="1" className="gs-stop-contact-clear" />
        </radialGradient>
        <radialGradient id={ref('pool')}>
          <stop offset="0" className="gs-stop-pool" />
          <stop offset="1" className="gs-stop-clear" />
        </radialGradient>
        {rest !== null && (
          <>
            <clipPath id={ref('body')}>
              <path d={rest.body} />
            </clipPath>
            <linearGradient
              id={ref('depth')}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={f(rest.gradientTop)}
              x2="0"
              y2={f(H)}
            >
              <stop offset="0" className="gs-stop-film" />
              <stop offset="0.12" className="gs-stop-top" />
              <stop offset="0.7" className="gs-stop-mid" />
              <stop offset="1" className="gs-stop-deep" />
            </linearGradient>
            <linearGradient
              id={ref('near')}
              gradientUnits="userSpaceOnUse"
              x1={f(inset * 0.5)}
              y1="0"
              x2={f(inset * 0.5 + strip)}
              y2="0"
            >
              <stop
                offset="0"
                style={{
                  stopColor: `color-mix(in srgb, var(--goal) ${String(WALL_ALPHA_ROUND * 100)}%, transparent)`,
                }}
              />
              <stop offset="1" className="gs-stop-clear" />
            </linearGradient>
            <linearGradient
              id={ref('far')}
              gradientUnits="userSpaceOnUse"
              x1={f(W - inset * 0.5)}
              y1="0"
              x2={f(W - inset * 0.5 - strip)}
              y2="0"
            >
              <stop
                offset="0"
                style={{
                  stopColor: `color-mix(in srgb, var(--goal) ${String(WALL_ALPHA_ROUND * 80)}%, transparent)`,
                }}
              />
              <stop offset="1" className="gs-stop-clear" />
            </linearGradient>
          </>
        )}
      </defs>

      <g transform={`translate(${String(SIDE)} ${String(TOP)})`}>
        {/* the table: contact, and the colour the water throws down through the base */}
        <ellipse
          cx={f(W / 2)}
          cy={f(Hb)}
          rx={f(W / 2 - insetO + 4)}
          ry={3.5}
          fill={`url(#${ref('contact')})`}
        />
        {rest !== null && (
          <ellipse
            cx={f(W / 2 + W * 0.14)}
            cy={f(Hb + 1)}
            rx={f(W * 0.55)}
            ry={4}
            fill={`url(#${ref('pool')})`}
          />
        )}

        <path className="gs-glass__room" d={vessel} />
        <path className="gs-glass__rim-back" d={rimBack} />

        <g clipPath={`url(#${ref('vessel')})`}>
          {rest !== null && (
            <>
              <path d={rest.body} fill={`url(#${ref('depth')})`} />
              <g clipPath={`url(#${ref('body')})`}>
                <rect
                  x="0"
                  y="0"
                  width={f(inset * 0.5 + strip)}
                  height={f(H)}
                  fill={`url(#${ref('near')})`}
                />
                <rect
                  x={f(W - inset * 0.5 - strip)}
                  y="0"
                  width={f(inset * 0.5 + strip)}
                  height={f(H)}
                  fill={`url(#${ref('far')})`}
                />
              </g>
              <path className="gs-glass__band" d={rest.band} />
              <path className="gs-glass__edge" d={rest.edge} />
            </>
          )}
          {minimum !== null && etch(minimum, kept ? 'kept' : 'min')}
          {was !== null && etch(was, 'was')}
          <rect
            className="gs-glass__streak"
            x={f(W * 0.12 + inset * 0.3)}
            y={f(H * 0.08)}
            width={2.5}
            height={f(H * 0.7)}
          />
        </g>

        <path className="gs-glass__base" d={`${outer} Z ${vessel}`} fillRule="evenodd" />
        <path className="gs-glass__floor" d={floor} />
        <path className="gs-glass__wall" d={outer} />
        <path className="gs-glass__rim" d={rimFront} />
      </g>
    </svg>
  );
}

/* --- the words, from lib/describeGoal -------------------------------------------------------- */

/** `TileDetail`, with its three levels in the 0–1 units `StudyGlass` draws with. */
interface Words extends Pick<
  TileDetail,
  'valueLine' | 'measure' | 'stateText' | 'stateTick' | 'driftText'
> {
  level: number;
  was: number | null;
  minimum: number | null;
  kept: boolean;
}

function describe(goal: GoalSummary): Words {
  const detail = describeGoal(goal);
  return {
    level: detail.level / 100,
    was: detail.previousLevel === null ? null : detail.previousLevel / 100,
    minimum: detail.minimumLevel === null ? null : detail.minimumLevel / 100,
    kept: detail.keptAlive,
    valueLine: detail.valueLine,
    measure: detail.measure,
    stateText: detail.stateText,
    stateTick: detail.stateTick,
    driftText: detail.driftText,
  };
}

/* --- the parts every variant shares ---------------------------------------------------------- */

interface TileProps {
  goal: GoalSummary;
  held: boolean;
  undoable: boolean;
}

function Meta({ goal }: { goal: GoalSummary }) {
  return (
    <p className="gs-meta" data-gs-text="meta">
      <span className="gs-area">
        <i className="gs-dot" aria-hidden="true" />
        {goal.area?.name ?? 'No area'}
      </span>{' '}
      <span className="gs-kind">{goal.kind}</span>
    </p>
  );
}

function Foot({ words }: { words: Words }) {
  if (words.measure === null && words.stateText === null && words.driftText === null) return null;
  return (
    <p className="gs-foot" data-gs-text="foot">
      {words.measure !== null && <span className="gs-pct">{words.measure}</span>}
      {words.stateText !== null && (
        <span className="gs-state">
          {words.stateTick && <CheckIcon className="gs-kept-mark" />}
          {words.stateText}
        </span>
      )}
      {words.driftText !== null && <span className="gs-drift">{words.driftText}</span>}
    </p>
  );
}

function Actions({ goal, held, undoable }: TileProps) {
  return (
    <div className="gs-actions">
      <GoalAction
        goal={goal}
        busy={false}
        undoable={undoable}
        onComplete={() => undefined}
        onUndo={() => undefined}
        onLogValue={() => undefined}
      />
      <button
        className="goal-tile__action goal-tile__grip"
        type="button"
        aria-label={`Move ${goal.title}`}
        aria-pressed={held}
      >
        <span aria-hidden="true">⠿</span>
      </button>
    </div>
  );
}

function tileClass(base: string, goal: GoalSummary, held: boolean, words: Words): string {
  const classes = ['gs-tile', base, `gs-tile--${SIZE_KEY[goal.size]}`];
  if (held) classes.push('gs-tile--held');
  if (words.level >= 1) classes.push('gs-tile--full');
  return classes.join(' ');
}

function Glass({ goal, words }: { goal: GoalSummary; words: Words }) {
  return (
    <StudyGlass
      size={goal.size}
      level={words.level}
      minimum={words.minimum}
      was={words.was}
      kept={words.kept}
    />
  );
}

/* --- A: a card, the glass beside the words --------------------------------------------------- */

function TileA({ goal, held, undoable }: TileProps) {
  const words = describe(goal);
  return (
    <li
      className={tileClass('gs-a', goal, held, words)}
      data-area={goal.area?.slug}
      data-gs-tile={goal.id}
      data-gs-size={goal.size}
    >
      <div className="gs-a__glass">
        <Glass goal={goal} words={words} />
      </div>
      <div className="gs-a__words">
        <Meta goal={goal} />
        <p className="gs-title" data-gs-text="title">
          {goal.title}
        </p>
        <p className="gs-val" data-gs-text="value">
          {words.valueLine}
        </p>
        <Foot words={words} />
        <button className="gs-open" type="button" aria-label={goal.title} />
        <Actions goal={goal} held={held} undoable={undoable} />
      </div>
    </li>
  );
}

/* --- B: the glass is the tile ---------------------------------------------------------------- */

function TileB({ goal, held, undoable }: TileProps) {
  const words = describe(goal);
  return (
    <li
      className={tileClass('gs-b', goal, held, words)}
      data-area={goal.area?.slug}
      data-gs-tile={goal.id}
      data-gs-size={goal.size}
    >
      <div className="gs-b__stand">
        <Glass goal={goal} words={words} />
      </div>
      <div className="gs-b__label">
        <p className="gs-title" data-gs-text="title">
          {goal.title}
        </p>
        <Meta goal={goal} />
        <p className="gs-val" data-gs-text="value">
          {words.valueLine}
        </p>
        <Foot words={words} />
      </div>
      <button className="gs-open" type="button" aria-label={goal.title} />
      <Actions goal={goal} held={held} undoable={undoable} />
    </li>
  );
}

/* --- C: on the shelf, the words beside the glass, no card ------------------------------------ */

function TileC({ goal, held, undoable }: TileProps) {
  const words = describe(goal);
  return (
    <li
      className={tileClass('gs-c', goal, held, words)}
      data-area={goal.area?.slug}
      data-gs-tile={goal.id}
      data-gs-size={goal.size}
    >
      <div className="gs-c__glass">
        <Glass goal={goal} words={words} />
      </div>
      <div className="gs-c__words">
        <p className="gs-title" data-gs-text="title">
          {goal.title}
        </p>
        <Meta goal={goal} />
        <p className="gs-val" data-gs-text="value">
          {words.valueLine}
        </p>
        <Foot words={words} />
        <button className="gs-open" type="button" aria-label={goal.title} />
        <Actions goal={goal} held={held} undoable={undoable} />
      </div>
    </li>
  );
}

const TILE: Record<StudyVariant, (props: TileProps) => ReactNode> = {
  A: TileA,
  B: TileB,
  C: TileC,
};

/* --- the board ------------------------------------------------------------------------------- */

/** One tile picked up, one just ticked, one control focused: the states a board is caught in. */
const HELD = 'g-read';
const UNDOABLE = new Set(['g-move']);
const FOCUSED = 'g-guitar';

function Board({ variant, focus }: { variant: StudyVariant; focus: boolean }) {
  const root = useRef<HTMLUListElement | null>(null);
  const Tile = TILE[variant];

  useEffect(() => {
    if (!focus) return;
    const target = root.current?.querySelector<HTMLButtonElement>(
      `[data-gs-tile="${FOCUSED}"] .goal-tile__tick`,
    );
    target?.focus({ preventScroll: true });
  }, [focus]);

  return (
    <ul className={`gs-board gs-board--${variant.toLowerCase()}`} role="list" ref={root}>
      {STUDY_GOALS.map((goal) => (
        <Tile key={goal.id} goal={goal} held={goal.id === HELD} undoable={UNDOABLE.has(goal.id)} />
      ))}
    </ul>
  );
}

const BETS: Record<StudyVariant, string> = {
  A: 'Card · glass beside the words',
  B: 'Shelf · words under the glass',
  C: 'Shelf · words beside the glass',
};

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export function GlassStudy({ variant }: { variant: StudyVariant }) {
  const frame = param('frame');
  const showDesktop = frame === null || frame === 'desktop';
  const showPhone = frame === null || frame === 'phone';

  return (
    <div className="gs" data-gs-variant={variant}>
      {showDesktop && (
        <section className="gs__frame gs__frame--desktop" data-gs-frame="desktop">
          <p className="gs__frame-label">
            {variant} · {BETS[variant]} · desktop board, 960 px
          </p>
          <Board variant={variant} focus />
        </section>
      )}
      {showPhone && (
        <section className="gs__frame gs__frame--phone" data-gs-frame="phone">
          <p className="gs__frame-label">{variant} · phone, 390 px</p>
          <Board variant={variant} focus={false} />
        </section>
      )}
      {param('measure') === '1' && <Measure variant={variant} />}
    </div>
  );
}

/* --- the levels, every size ------------------------------------------------------------------ */

const LEVELS = [0, 0.04, 0.34, 0.62, 1];
const LEVEL_AREAS = ['health', 'learning', 'money', 'relationships', 'creative'];
const SIZES: readonly GoalSize[] = ['small', 'medium', 'large'];

/** The liquid alone: three sizes by five levels, a habit minimum and a "was" on the last row. */
export function GlassLevels() {
  return (
    <div className="gs-levels">
      {SIZES.map((size) => (
        <div className="gs-levels__row" key={size}>
          <p className="gs-levels__size">{size}</p>
          {LEVELS.map((level, i) => (
            <figure className="gs-levels__cell" key={level} data-area={LEVEL_AREAS[i]}>
              <StudyGlass
                size={size}
                level={level}
                minimum={size === 'medium' ? 0.25 : null}
                kept={size === 'medium' && level >= 0.25}
                was={size === 'large' && level < 1 ? Math.min(0.96, level + 0.08) : null}
              />
              <figcaption>{formatPercent(level)}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}

/* --- measuring ------------------------------------------------------------------------------- */

type Rgba = [number, number, number, number];

function colourReader(): (css: string) => Rgba {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (css) => {
    if (ctx === null) return [0, 0, 0, 1];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 255) / 255];
  };
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5
  );
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/**
 * Numbers, not impressions. For every tile in every frame: is each text box unclipped and inside
 * its tile, does any text box overlap the vessel, does any waterline cross any text, how far the
 * nearest words are from the glass, the worst text contrast against the room or card behind it,
 * and the size of every control.
 */
function Measure({ variant }: { variant: StudyVariant }) {
  const [report, setReport] = useState('measuring…');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const read = colourReader();
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const room = ['--bg', '--bg-2', '--bg-3'].map((name) => {
        probe.style.backgroundColor = `var(${name})`;
        return read(getComputedStyle(probe).backgroundColor);
      });
      probe.remove();

      const lines: string[] = [];
      let clipped = 0;
      let outside = 0;
      let onGlass = 0;
      let crossings = 0;
      let overlaps = 0;
      let worstContrast = Infinity;
      let worstContrastAt = '';
      let smallestTarget = Infinity;
      let smallestTargetAt = '';

      const host = document.querySelector(`[data-gs-variant="${variant}"]`);
      for (const frameEl of host?.querySelectorAll<HTMLElement>('[data-gs-frame]') ?? []) {
        const frameName = frameEl.dataset.gsFrame ?? '?';
        const boardEl = frameEl.querySelector('.gs-board');
        if (boardEl === null) continue;
        const board = box(boardEl);
        lines.push(
          `## ${variant} ${frameName}: board ${r1(board.right - board.left)} x ${r1(board.bottom - board.top)}`,
        );
        const tiles = Array.from(frameEl.querySelectorAll<HTMLElement>('[data-gs-tile]'));
        const tileBoxes = tiles.map(box);
        tileBoxes.forEach((a, i) => {
          tileBoxes.forEach((b, j) => {
            if (j > i && intersects(a, b)) overlaps += 1;
          });
        });

        tiles.forEach((tile, i) => {
          const t = tileBoxes[i] ?? box(tile);
          const svg = tile.querySelector<SVGSVGElement>('[data-gs-glass]');
          if (svg === null) return;
          const s = box(svg);
          const num = (name: string): number => Number.parseFloat(svg.getAttribute(name) ?? '');
          const vessel: Box = {
            left: s.left + num('data-vx'),
            top: s.top + num('data-vy') - RIM_RY,
            right: s.left + num('data-vx') + num('data-vw'),
            bottom: s.top + num('data-vy') + num('data-vh'),
          };
          const waterTop = s.top + num('data-water-top');
          const waterBottom = s.top + num('data-water-bottom');
          const hasWater = Number.isFinite(waterTop);

          let tileClipped = 0;
          let tileOutside = 0;
          let tileOnGlass = 0;
          let tileCross = 0;
          let gap = Infinity;
          let tileContrast = Infinity;

          for (const text of tile.querySelectorAll<HTMLElement>('[data-gs-text]')) {
            const b = box(text);
            if (
              text.scrollWidth > text.clientWidth + 0.5 ||
              text.scrollHeight > text.clientHeight + 0.5
            ) {
              tileClipped += 1;
              lines.push(
                `  CLIPPED ${frameName} ${tile.dataset.gsTile ?? '?'} ${text.dataset.gsText ?? '?'}: scroll ${String(text.scrollWidth)}x${String(text.scrollHeight)} client ${String(text.clientWidth)}x${String(text.clientHeight)}`,
              );
            }
            if (!inside(b, t) || !inside(b, board)) tileOutside += 1;
            if (intersects(b, vessel)) tileOnGlass += 1;
            if (
              hasWater &&
              b.left < vessel.right &&
              b.right > vessel.left &&
              b.top < waterBottom &&
              b.bottom > waterTop
            ) {
              tileCross += 1;
            }
            // Words below the glass (B) or beside it (A, C): the clear space between them.
            const below = b.top - vessel.bottom;
            const beside = b.left - vessel.right;
            gap = Math.min(gap, Math.max(below, beside));

            // Contrast: every element carrying text inside this one, against what is behind it.
            for (const el of [text, ...Array.from(text.querySelectorAll<HTMLElement>('*'))]) {
              if (el.closest('svg') !== null || el.tagName === 'I') continue;
              const ownText = Array.from(el.childNodes).some(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
              );
              if (!ownText) continue;
              const fg = read(getComputedStyle(el).color);
              const layers: Rgba[] = [];
              for (let a: HTMLElement | null = el; a !== null; a = a.parentElement) {
                const bg = read(getComputedStyle(a).backgroundColor);
                if (bg[3] > 0) layers.push(bg);
                if (bg[3] >= 1) break;
              }
              for (const base of room) {
                let behind: Rgba = base;
                for (let k = layers.length - 1; k >= 0; k -= 1) {
                  const layer = layers[k];
                  if (layer !== undefined) behind = over(layer, behind);
                }
                const c = contrast(over(fg, behind), behind);
                if (c < tileContrast) tileContrast = c;
                if (c < worstContrast) {
                  worstContrast = c;
                  worstContrastAt = `${frameName} ${tile.dataset.gsTile ?? '?'} "${el.textContent.trim().slice(0, 32)}"`;
                }
              }
            }
          }

          const targets = Array.from(
            tile.querySelectorAll<HTMLButtonElement>('button:not(.gs-open)'),
          )
            .map((button) => {
              const b = box(button);
              const w = b.right - b.left;
              const h = b.bottom - b.top;
              if (Math.min(w, h) < smallestTarget) {
                smallestTarget = Math.min(w, h);
                smallestTargetAt = `${frameName} ${tile.dataset.gsTile ?? '?'} ${button.getAttribute('aria-label') ?? ''}`;
              }
              const name = button.textContent.trim() || '⠿';
              if (!inside(b, t)) tileOutside += 1;
              return `${name} ${r1(w)}x${r1(h)}`;
            })
            .join(', ');

          clipped += tileClipped;
          outside += tileOutside;
          onGlass += tileOnGlass;
          crossings += tileCross;

          const waterNote = hasWater
            ? `water y ${r1(waterTop - t.top)}–${r1(waterBottom - t.top)}`
            : 'dry';
          lines.push(
            [
              `${tile.dataset.gsTile ?? '?'} ${tile.dataset.gsSize ?? ''}`,
              `tile ${r1(t.right - t.left)}x${r1(t.bottom - t.top)}`,
              `vessel ${r1(vessel.right - vessel.left)}x${r1(vessel.bottom - vessel.top)}`,
              waterNote,
              `clipped ${String(tileClipped)} outside ${String(tileOutside)} on-glass ${String(tileOnGlass)} crossings ${String(tileCross)}`,
              `glass->words ${r1(gap)}px`,
              `min contrast ${tileContrast.toFixed(2)}`,
              targets,
            ].join(' | '),
          );
        });
      }

      lines.unshift(
        `TOTAL ${variant}: clipped ${String(clipped)}, outside ${String(outside)}, text on glass ${String(onGlass)}, waterline crossings ${String(crossings)}, tile overlaps ${String(overlaps)}, worst contrast ${worstContrast.toFixed(2)} (${worstContrastAt}), smallest target ${r1(smallestTarget)}px (${smallestTargetAt})`,
      );
      setReport(lines.join('\n'));
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [variant]);

  return (
    <pre id={`gs-measure-${variant}`} className="gs-measure">
      {report}
    </pre>
  );
}
