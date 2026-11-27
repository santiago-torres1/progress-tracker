/*
 * The gestures the water is tested with, as functions of time — shared by the tests in this folder
 * and the bench in `src/lab`. No production code imports this file.
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
  /**
   * How much further the HAND moved than the vessel is drawn moving: the bench keeps every vessel
   * inside its frame by drawing at most 60 px of travel, and feeds the model the acceleration of the
   * real motion, which is this many times larger. 1 if absent.
   */
  hand?: number;
}

/** Where the hand had the vessel at time `t`, CSS px: the drawn position times `hand`. */
export function handAt(gesture: Gesture, t: number): { x: number; y: number } {
  const here = gesture.at(t);
  const k = gesture.hand ?? 1;
  return { x: here.x * k, y: here.y * k };
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

/**
 * A REAL REARRANGE ON THE BOARD: a hand moving a tile about 300 px in about 450 ms, easing in and
 * out. Smoothstep's peak acceleration is `6 · D / T²` = 6 · 300 / 0.45² = 8,889 px/s², which at
 * 0.4 mm/px is 3.56 m/s², or 0.36 g — in the 0.3–0.5 g a hand actually produces. Drawn as 60 px.
 */
const DRAG: Gesture = {
  id: 'drag',
  label: 'Drag (a rearrange)',
  duration: 450,
  moment: 600,
  hand: 5,
  at: (t) => ({ x: ramp(TRAVEL, 450)(t), y: 0 }),
};

/**
 * A DELIBERATE FLICK: 150 px in 110 ms. Peak `6 · 150 / 0.11²` = 74,400 px/s², about 3 g. Drawn as
 * 60 px. The one gesture that is meant to come near breaking.
 */
const FLICK: Gesture = {
  id: 'flick',
  label: 'Flick',
  duration: 110,
  moment: 250,
  hand: 2.5,
  at: (t) => ({ x: ramp(TRAVEL, 110)(t), y: 0 }),
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
  DRAG,
  FLICK,
  DEFAULT_GESTURE,
  /*
   * A yank and a lift are slams: 150 px in 80 ms, about 6 g at the hand. Even at the default
   * strength that is past 1 g at the water, which is what it takes for water to leave a floor.
   */
  {
    id: 'drop',
    label: 'Yank down',
    duration: 80,
    moment: 280,
    hand: 2.5,
    at: (t) => ({ x: 0, y: ramp(TRAVEL, 80)(t) }),
  },
  {
    id: 'lift',
    label: 'Lift up',
    duration: 80,
    moment: 280,
    hand: 2.5,
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
