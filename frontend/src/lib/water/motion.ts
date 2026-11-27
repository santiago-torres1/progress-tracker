/*
 * Turning where a glass IS into what its water FEELS: an acceleration, in both axes.
 *
 * Two ways, for two kinds of input.
 *
 *   Motion  a measured position that moves smoothly — the bench's gestures, a transform following a
 *           pointer. The acceleration is the second difference, with the velocity smoothed once so
 *           the quantisation of a measured rectangle does not come through as noise.
 *
 *   Carry   a position that JUMPS — which is what the board does today. A drag on the board is not a
 *           transform following the pointer: `useArrange` reorders the grid, and the tile is in one
 *           cell this frame and the next cell along the next. Differenced, that is an infinite
 *           acceleration for one frame. So the glass is CARRIED there instead: a critically damped
 *           follower chases the measured position, as a hand would, and its acceleration is what the
 *           water feels. A jump of 150 px — about one glass along a shelf — then pushes the water at
 *           about 0.43 g, the bench's own drag (0.36 g), rather than at forty.
 */

/**
 * Feed a position, get the acceleration of that position. Positions in any unit; the acceleration
 * comes back in the same unit per s².
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

/**
 * How long the carrying hand takes, s: the time constant of the follower.
 *
 * A critically damped follower given a jump `D` accelerates at most `D / τ²`, at the start. At
 * 0.12 s a 150 px jump peaks at 10,400 px/s², 0.43 g at the drive's 0.4 mm/px — the bench's drag.
 * Shorter and every rearrange is a flick; longer and the water answers a beat after the glass moved.
 */
export const CARRY_S = 0.12;

/** Below this, px and px/s, the follower has arrived and is reported still. */
const CARRY_QUIET = 0.05;

/**
 * A hand carrying the glass to wherever it was measured. Critically damped, so it never overshoots:
 * the glass arrives and stops, and the slosh is the water's own.
 */
export class Carry {
  private x: number | null = null;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private tx = 0;
  private ty = 0;
  private readonly w: number;

  constructor(seconds = CARRY_S) {
    this.w = 1 / Math.max(1e-3, seconds);
  }

  /**
   * Feed where the glass is now, get the hand's acceleration in the same unit per s². `dt` in
   * seconds; a frame that is long (a tab coming back) is stepped in pieces so the hand stays stable.
   */
  feed(x: number, y: number, dt: number): { ax: number; ay: number } {
    if (this.x === null) {
      this.x = x;
      this.y = y;
      this.tx = x;
      this.ty = y;
      return { ax: 0, ay: 0 };
    }
    this.tx = x;
    this.ty = y;
    if (dt <= 0) return { ax: 0, ay: 0 };

    const pieces = Math.max(1, Math.ceil((dt * this.w) / 0.25));
    const h = dt / pieces;
    const w2 = this.w * this.w;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < pieces; i += 1) {
      const ax = w2 * (this.tx - this.x) - 2 * this.w * this.vx;
      const ay = w2 * (this.ty - this.y) - 2 * this.w * this.vy;
      this.vx += ax * h;
      this.vy += ay * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      sumX += ax;
      sumY += ay;
    }
    return { ax: sumX / pieces, ay: sumY / pieces };
  }

  /** Has the hand arrived? A loop may stop once every glass's hand has. */
  get still(): boolean {
    if (this.x === null) return true;
    return (
      Math.abs(this.tx - this.x) < CARRY_QUIET &&
      Math.abs(this.ty - this.y) < CARRY_QUIET &&
      Math.abs(this.vx) < CARRY_QUIET &&
      Math.abs(this.vy) < CARRY_QUIET
    );
  }

  reset(): void {
    this.x = null;
    this.vx = 0;
    this.vy = 0;
  }
}
