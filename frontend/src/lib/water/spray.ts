/*
 * The water that has left the body: droplets in flight, and beads running down a wall.
 *
 * A store and a budget, nothing else — the physics that throws them and catches them lives in
 * `slosh.ts`, because a droplet leaving is a dent in the modes and a droplet landing is a bump in
 * them, and only the model can do either.
 *
 * THE BUDGET IS SHARED. A board can hold a hundred glasses, and a hundred glasses each throwing
 * forty droplets is four thousand things to step and draw. So every glass draws from one pool: at
 * most `MAX_DROPLETS` each, at most `GLOBAL_DROPLETS` across the board, and as the board gets busy
 * each glass's share shrinks — a glass that is refused a droplet simply keeps that water in its
 * body, which is always an honest answer.
 */

/** The most droplets one glass ever holds. */
export const MAX_DROPLETS = 40;

/** The most droplets across every glass sharing a budget. */
export const GLOBAL_DROPLETS = 300;

/** A droplet in flight, and one that has met a wall and is running down it. */
export const FLYING = 0;
export const SLIDING = 1;

export class DropletBudget {
  live = 0;
  readonly cap: number;

  constructor(cap = GLOBAL_DROPLETS) {
    this.cap = cap;
  }

  /**
   * How many more droplets a glass already holding `own` may take right now.
   *
   * Full share until the board is 60% through its budget, then a share shrinking to a handful at
   * the cap: a busy board degrades into fewer droplets per glass, never into no glass breaking.
   */
  allowance(own: number): number {
    const left = this.cap - this.live;
    if (left <= 0) return 0;
    const busy = this.live / this.cap;
    const share =
      busy <= 0.6 ? MAX_DROPLETS : Math.max(4, Math.round(MAX_DROPLETS * ((1 - busy) / 0.4)));
    return Math.max(0, Math.min(left, share - own));
  }
}

/** The budget every glass shares unless it is given its own (tests are). */
export const sharedBudget = new DropletBudget();

/** Struct-of-arrays, allocated once per glass: nothing is allocated while water is flying. */
export class Droplets {
  /** Vessel coordinates: x from the vessel's left edge, y up from the floor, px. */
  readonly x = new Float64Array(MAX_DROPLETS);
  readonly y = new Float64Array(MAX_DROPLETS);
  readonly vx = new Float64Array(MAX_DROPLETS);
  readonly vy = new Float64Array(MAX_DROPLETS);
  readonly r = new Float64Array(MAX_DROPLETS);
  readonly age = new Float64Array(MAX_DROPLETS);
  readonly state = new Uint8Array(MAX_DROPLETS);
  count = 0;
  /** Every droplet ever thrown by this glass. For the tests and the bench. */
  thrown = 0;

  private readonly budget: DropletBudget;

  constructor(budget: DropletBudget) {
    this.budget = budget;
  }

  /** Add one, if the budget allows. Returns its index, or -1. */
  add(x: number, y: number, vx: number, vy: number, r: number): number {
    if (this.budget.allowance(this.count) <= 0) return -1;
    const i = this.count;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.r[i] = r;
    this.age[i] = 0;
    this.state[i] = FLYING;
    this.count += 1;
    this.thrown += 1;
    this.budget.live += 1;
    return i;
  }

  /** Remove one by swapping the last into its place. */
  remove(i: number): void {
    const last = this.count - 1;
    this.x[i] = this.x[last] ?? 0;
    this.y[i] = this.y[last] ?? 0;
    this.vx[i] = this.vx[last] ?? 0;
    this.vy[i] = this.vy[last] ?? 0;
    this.r[i] = this.r[last] ?? 0;
    this.age[i] = this.age[last] ?? 0;
    this.state[i] = this.state[last] ?? FLYING;
    this.count = last;
    this.budget.live -= 1;
  }

  /** Give every droplet back to the budget without landing it: the glass is going away. */
  release(): void {
    this.budget.live -= this.count;
    this.count = 0;
  }

  /** Total area of water in the droplets, px² (the model is two-dimensional: area is volume). */
  area(): number {
    let total = 0;
    for (let i = 0; i < this.count; i += 1) {
      const r = this.r[i] ?? 0;
      total += Math.PI * r * r;
    }
    return total;
  }
}
