/*
 * The gestures both models are tested with, as functions of time.
 *
 * ONE SOURCE OF MOTION, TWO MODELS. The point of the bench is that the shipped height field and the
 * particle fluid are driven by the identical movement of the identical box, so a difference between
 * the two rows is a difference between the models and not between two setups. The gesture returns
 * the vessel's offset in CSS pixels; the bench applies it to both vessels as a transform and lets
 * each model measure it the way it measures a real tile.
 *
 * `drop` and `lift` exist because they are the whole of the owner's second complaint, and because
 * the shipped model cannot answer them: `driver.ts` measures horizontal movement only, and even if
 * it measured the vertical, `field.splash()` subtracts its own mean from every column — and a
 * uniform vertical shove is precisely the input that correction cancels to exactly zero.
 */

export interface Gesture {
  /** For the URL and the button. */
  id: string;
  label: string;
  /** How long the motion lasts, in ms. The bench keeps running well past it. */
  duration: number;
  /** Where the vessel is at time `t` ms, in CSS pixels. `y` is positive downwards, as CSS is. */
  at(t: number): { x: number; y: number };
  /** A level change, if this gesture is a pour: how much, and when. */
  pour?: { at: number; by: number };
  /** The moment worth freezing for a screenshot. */
  moment: number;
}

/**
 * How far a gesture travels, in CSS pixels.
 *
 * Small, and deliberately so: the vessel has to stay inside its frame or the thing being looked at
 * leaves the screen — the first version moved 170 pixels and the glass ended below the bottom of the
 * picture. It does not need to be large. What reaches the water is ACCELERATION, and sixty pixels in
 * eighty milliseconds across a 144-pixel vessel is twelve gravities, three times the hardest shove
 * the fluid will accept.
 */
const TRAVEL = 60;

/** Smooth start, smooth stop: the shape a hand actually moves a thing in. */
function ease(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

function ramp(distance: number, ms: number) {
  return (t: number): number => distance * ease(t / ms);
}

/** Fling is the default: it is the gesture the shipped model answers best, so it is the fair one. */
const DEFAULT_GESTURE: Gesture = {
  id: 'fling',
  label: 'Fling sideways',
  duration: 90,
  moment: 300,
  at: (t) => ({ x: ramp(TRAVEL, 90)(t), y: 0 }),
};

export const GESTURES: readonly Gesture[] = [
  {
    id: 'pour',
    label: 'Pour',
    duration: 0,
    moment: 900,
    at: () => ({ x: 0, y: 0 }),
    pour: { at: 200, by: 0.3 },
  },
  DEFAULT_GESTURE,
  {
    id: 'drop',
    label: 'Yank down',
    duration: 80,
    moment: 280,
    at: (t) => ({ x: 0, y: ramp(TRAVEL, 80)(t) }),
  },
  {
    id: 'lift',
    label: 'Lift up',
    duration: 80,
    moment: 280,
    at: (t) => ({ x: 0, y: -ramp(TRAVEL, 80)(t) }),
  },
  {
    id: 'shake',
    label: 'Shake',
    duration: 520,
    moment: 480,
    at: (t) => ({
      x: t > 520 ? 0 : TRAVEL * 0.7 * Math.sin((t / 520) * Math.PI * 5) * ease((520 - t) / 160),
      y: 0,
    }),
  },
  {
    id: 'still',
    label: 'Leave it alone',
    duration: 0,
    moment: 600,
    at: () => ({ x: 0, y: 0 }),
  },
];

export function gestureById(id: string | null): Gesture {
  return GESTURES.find((g) => g.id === id) ?? DEFAULT_GESTURE;
}

/**
 * Turning a measured position into an acceleration, which is what a moving vessel gives its water.
 *
 * This is the piece `driver.ts` would have to grow, and the reason it is a separate object: an
 * acceleration is the SECOND difference of a measured position, so the raw signal is mostly the
 * quantisation of `getBoundingClientRect`. One exponential smoothing of the velocity is enough to
 * make it usable, and the fluid low-passes what comes out of here a second time — a real body of
 * water responds to the integral of a force, not to its instantaneous value, so the smoothing is
 * physics rather than a filter bolted on.
 *
 * Positions arrive in GLASS UNITS (the vessel's own height is 1), so the same numbers describe a
 * small tile and a large one.
 */
export class Motion {
  private x: number | null = null;
  private y: number | null = null;
  private vx = 0;
  private vy = 0;

  /** Feed a position, get the acceleration. `dt` in seconds. */
  feed(x: number, y: number, dt: number): { ax: number; ay: number } {
    if (this.x === null || this.y === null || dt <= 0) {
      this.x = x;
      this.y = y;
      return { ax: 0, ay: 0 };
    }

    const rawX = (x - this.x) / dt;
    const rawY = (y - this.y) / dt;
    this.x = x;
    this.y = y;

    const blend = Math.min(1, dt / VELOCITY_LAG);
    const nextX = this.vx + (rawX - this.vx) * blend;
    const nextY = this.vy + (rawY - this.vy) * blend;
    const ax = (nextX - this.vx) / dt;
    const ay = (nextY - this.vy) / dt;
    this.vx = nextX;
    this.vy = nextY;
    return { ax, ay };
  }

  reset(): void {
    this.x = null;
    this.y = null;
    this.vx = 0;
    this.vy = 0;
  }
}

/** How much the measured velocity is smoothed before it is differenced, in seconds. */
const VELOCITY_LAG = 0.012;
