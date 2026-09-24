/*
 * The water itself: a one-dimensional height field with springs between neighbours.
 *
 * WHY THIS AND NOT A PHYSICS ENGINE. A rigid-body engine simulates solids. Water made of a few
 * hundred little balls looks like gravel, costs far more, and still does not give the one thing
 * this needs: a clean surface line. A height field is what games have used for 2D water for
 * twenty years — each column of water is a spring that pulls towards its rest level and passes
 * momentum to the columns either side, so a disturbance travels, reflects off the glass walls,
 * meets itself coming back, and dies away. That is a wave, and it comes out of about forty lines.
 *
 * Nothing in here knows about pixels, canvases, React or Pixi. It is a number cruncher with three
 * inputs — a tick of time, a level to settle towards, and the odd shove — which is what makes it
 * testable without a GPU. The drawing lives in `renderer.ts`.
 *
 * The one invariant worth stating: PROPAGATION MOVES WATER, IT DOES NOT MAKE IT. The mean height
 * after any number of steps is the mean height before, give or take floating-point dust. If that
 * ever stops being true the glass will slowly fill or empty on its own, which is a lie about
 * somebody's goal, so there is a test pinning it.
 */

export interface WaterOptions {
  /** How many columns the surface is cut into. More is smoother and costs more. */
  columns?: number;
  /** How hard a column is pulled back to the rest level. Higher is choppier. */
  tension?: number;
  /** How quickly motion is lost. Higher settles sooner. This is a calm app; it settles. */
  damping?: number;
  /** How much of a column's difference is handed to its neighbours each pass. 0–0.5. */
  spread?: number;
}

/*
 * THE RATIO OF `spread` TO `tension` IS WHAT MAKES THIS LOOK LIKE A LIQUID.
 *
 * `tension` is a spring pulling each column back to the rest level on its own; `spread` is how
 * much of its difference a column hands to its neighbours. When tension leads, every column bobs
 * on its own spring at its own frequency and the surface rises and falls as one sheet — which is
 * the motion of a drumskin, or of jelly, and is precisely what the first version of this looked
 * like. Water is the other way round: a disturbance is carried SIDEWAYS, crosses the glass, comes
 * off the far wall and interferes with itself on the way back.
 *
 * So tension is now a quarter of what it was and spread nearly double, and the surface behaves
 * accordingly. Damping came down with them, because a wave that dies before it reaches the far
 * wall never gets to do the one thing that reads as water.
 */
const DEFAULTS = {
  // Sixty-four columns across a tile that is at most ~500px wide: about one column per 8px, which
  // is finer than the eye resolves at these amplitudes.
  columns: 64,
  tension: 0.02,
  damping: 0.012,
  // Two propagation passes run per step, and the scheme is only stable while their combined
  // transfer stays under a half — so this is as much sideways movement as the algorithm has to
  // give, and the ratio is bought by dropping tension rather than by pushing this past 0.25.
  // At 0.3 the surface does not make waves, it detonates: energy climbed four orders of magnitude
  // in three hundred frames.
  spread: 0.2,
} as const;

/** A fixed step, so the simulation does not change character with the frame rate. */
const STEP_MS = 1000 / 60;

/** Past this many steps in one frame, give up catching up: the tab was in the background. */
const MAX_CATCH_UP_STEPS = 6;

/**
 * Heights are in "glass units": 1 is the full height of the vessel, so a displacement of 0.02 is
 * 2% of the glass.
 *
 * This is a safety net, not a design parameter, and it should never fire in normal use. An
 * undamped impulse `v` settles at an amplitude of roughly `v / sqrt(tension)` — about six times
 * the impulse at these constants — so every shove below is sized against that, not against this.
 * It matters that the net is not load-bearing: clamping is the one operation here that can
 * destroy water, and the test that pins the mean will notice if the shoves ever grow into it.
 */
const MAX_DISPLACEMENT = 0.09;

/**
 * The tallest wave the app ever asks for, in glass units.
 *
 * Still small — the brief for this product is calm — but no longer so small that it reads as a
 * surface that merely twitched. At 3% nobody could tell what the motion was meant to be.
 *
 * The impulse that produces it is scaled by the undamped amplitude relation for these constants:
 * a velocity impulse `v` settles at roughly `v / sqrt(tension)`, which is about thirteen times the
 * impulse at the tension above.
 */
const PEAK_WAVE = 0.055;
const IMPULSE = PEAK_WAVE * Math.sqrt(DEFAULTS.tension);

/** How much of a drag's speed reaches the water, per pixel moved in one frame. */
const DRAG_IMPULSE = 0.0016;

/** The most one frame of dragging may inject, so a flick cannot empty the glass up a wall. */
const MAX_DRAG = 0.02;

export class WaterField {
  readonly columns: number;

  private readonly tension: number;
  private readonly damping: number;
  private readonly spread: number;

  /** Displacement of each column from the rest level, in glass units. */
  private readonly height: Float32Array;
  private readonly velocity: Float32Array;
  /** Scratch for one propagation pass, allocated once: this runs every frame. */
  private readonly delta: Float32Array;

  /** Where the surface is settling to, 0–1. Set by the goal's progress. */
  private rest = 0;
  private carryMs = 0;

  constructor(options: WaterOptions = {}) {
    this.columns = Math.max(8, Math.floor(options.columns ?? DEFAULTS.columns));
    this.tension = options.tension ?? DEFAULTS.tension;
    this.damping = options.damping ?? DEFAULTS.damping;
    this.spread = options.spread ?? DEFAULTS.spread;

    this.height = new Float32Array(this.columns);
    this.velocity = new Float32Array(this.columns);
    this.delta = new Float32Array(this.columns);
  }

  /** The level the surface returns to, 0 (empty) to 1 (brim). */
  get level(): number {
    return this.rest;
  }

  /**
   * Move the rest level, and let the water notice.
   *
   * A pour is not a new number appearing — it is water arriving, so the surface heaves where it
   * lands and rocks for a moment. `disturb` is off for the first paint of a tile that was already
   * full when the board loaded: that glass is not being poured, it just IS full, and performing a
   * pour for it would tell somebody something happened when nothing did.
   */
  setLevel(next: number, disturb = true): void {
    const clamped = Math.min(1, Math.max(0, next));
    const change = clamped - this.rest;
    this.rest = clamped;

    if (!disturb || change === 0) return;

    // A rise heaves the middle and a fall drags at it, so the sign is carried through. The
    // magnitude is square-rooted: a tiny top-up should still register, a whole glass at once
    // should not erupt.
    const power = Math.sign(change) * Math.sqrt(Math.abs(change)) * IMPULSE;
    this.splash(0.5, power, 0.45);
  }

  /** Put the water flat at its rest level, with nothing moving. */
  still(): void {
    this.height.fill(0);
    this.velocity.fill(0);
    this.carryMs = 0;
  }

  /**
   * A shove at one place on the surface.
   *
   * `at` is 0–1 across the glass, `power` is in glass units of velocity (negative pulls down) and
   * `width` is how much of the surface feels it, as a fraction. The falloff is a raised cosine, so
   * the disturbance has no corners in it — a triangular one leaves a visible kink travelling along
   * the surface.
   */
  splash(at: number, power: number, width = 0.25): void {
    const centre = at * (this.columns - 1);
    const reach = Math.max(1, width * this.columns * 0.5);

    let added = 0;
    for (let i = 0; i < this.columns; i += 1) {
      const distance = Math.abs(i - centre);
      if (distance > reach) continue;
      const falloff = 0.5 * (1 + Math.cos((Math.PI * distance) / reach));
      this.velocity[i] = (this.velocity[i] ?? 0) + power * falloff;
      added += power * falloff;
    }

    // A shove DISPLACES water; it does not pour any in. Without this the net momentum of every
    // splash is integrated straight into height, so a glass ends a tick fractionally fuller than
    // the number it is showing — invisible once, and a drift after fifty of them. Taking the mean
    // back out is also what makes the motion read right: the middle lifts and the edges dip,
    // which is what happens when something lands on water.
    const perColumn = added / this.columns;
    for (let i = 0; i < this.columns; i += 1) {
      this.velocity[i] = (this.velocity[i] ?? 0) - perColumn;
    }
  }

  /**
   * The tile is being dragged sideways.
   *
   * The water is pushed AT THE WALLS, which is the only place a moving glass touches it. The wall
   * the glass is moving towards advances into the water and heaps it up; the wall it is moving
   * away from leaves water behind. What happens next is the ordinary physics below: the heap runs
   * across the glass, comes off the far wall and meets itself returning.
   *
   * Two earlier versions did not do this and both read as something other than liquid. A velocity
   * gradient across the whole surface tips it as one rigid sheet and springs it back — the owner
   * called it gelatin, which was exactly right. A tilted equilibrium is better physics but far too
   * slow: the water needs most of a second to notice a new equilibrium, and a drag is over in a
   * few frames, so it barely leaned at all. Driving at the walls is both prompt and rich, because
   * a disturbance that starts narrow contains every wavelength the glass can hold, and it is those
   * higher modes — not the amplitude — that make a surface read as water.
   */
  tilt(movement: number): void {
    const power = Math.min(MAX_DRAG, Math.max(-MAX_DRAG, movement * DRAG_IMPULSE));
    if (power === 0) return;

    // Moving right heaps the water on the LEFT: the glass sets off and the water is left behind.
    this.splash(0.06, power, 0.22);
    this.splash(0.94, -power, 0.22);
  }

  /**
   * Advance by however long really passed, in fixed steps.
   *
   * Returns whether anything is still moving, so a caller can stop drawing a glass that has gone
   * quiet instead of burning a frame on it forever.
   */
  advance(elapsedMs: number): boolean {
    this.carryMs += Math.max(0, elapsedMs);
    let steps = Math.floor(this.carryMs / STEP_MS);
    this.carryMs -= steps * STEP_MS;

    if (steps > MAX_CATCH_UP_STEPS) {
      // Gone from the screen and come back. Do not replay a minute of waves at it.
      steps = MAX_CATCH_UP_STEPS;
      this.carryMs = 0;
    }

    for (let step = 0; step < steps; step += 1) this.step();
    return this.isMoving();
  }

  /** The surface, as displacements from the rest level. Do not write to it. */
  surface(): Readonly<Float32Array> {
    return this.height;
  }

  /**
   * Height at a point across the glass, 0–1, as an absolute level.
   *
   * Linear between columns: the renderer wants a smooth curve and interpolating here keeps the
   * sampling in one place.
   */
  heightAt(at: number): number {
    const x = Math.min(1, Math.max(0, at)) * (this.columns - 1);
    const left = Math.floor(x);
    const right = Math.min(this.columns - 1, left + 1);
    const t = x - left;
    const a = this.height[left] ?? 0;
    const b = this.height[right] ?? 0;
    return this.rest + (a + (b - a) * t);
  }

  /** Still worth drawing? Below this nothing is visible at any plausible tile size. */
  isMoving(): boolean {
    for (let i = 0; i < this.columns; i += 1) {
      if (Math.abs(this.height[i] ?? 0) > 1e-4) return true;
      if (Math.abs(this.velocity[i] ?? 0) > 1e-4) return true;
    }
    return false;
  }

  /** Total displacement energy. Only used by the tests, to prove this thing calms down. */
  energy(): number {
    let total = 0;
    for (let i = 0; i < this.columns; i += 1) {
      const h = this.height[i] ?? 0;
      const v = this.velocity[i] ?? 0;
      total += h * h + v * v;
    }
    return total;
  }

  /** Mean displacement. Should not drift: see the note at the top of the file. */
  mean(): number {
    let total = 0;
    for (let i = 0; i < this.columns; i += 1) total += this.height[i] ?? 0;
    return total / this.columns;
  }

  private step(): void {
    const { columns, tension, damping, spread, height, velocity, delta } = this;

    for (let i = 0; i < columns; i += 1) {
      const h = height[i] ?? 0;
      const v = ((velocity[i] ?? 0) - tension * h) * (1 - damping);
      velocity[i] = v;
      const next = h + v;
      // The clamp is what keeps a frantic drag from turning the glass into a fountain. It costs
      // nothing at the amplitudes this app ever asks for.
      height[i] =
        next > MAX_DISPLACEMENT
          ? MAX_DISPLACEMENT
          : next < -MAX_DISPLACEMENT
            ? -MAX_DISPLACEMENT
            : next;
    }

    // Two passes, gathering into `delta` before applying: writing heights as we go would let a
    // wave travel further to the right than to the left purely because of loop order.
    for (let pass = 0; pass < 2; pass += 1) {
      delta.fill(0);
      for (let i = 0; i < columns; i += 1) {
        const h = height[i] ?? 0;
        if (i > 0) {
          const d = spread * (h - (height[i - 1] ?? 0));
          delta[i - 1] = (delta[i - 1] ?? 0) + d;
          delta[i] = (delta[i] ?? 0) - d;
        }
        if (i < columns - 1) {
          const d = spread * (h - (height[i + 1] ?? 0));
          delta[i + 1] = (delta[i + 1] ?? 0) + d;
          delta[i] = (delta[i] ?? 0) - d;
        }
      }
      for (let i = 0; i < columns; i += 1) {
        const d = delta[i] ?? 0;
        velocity[i] = (velocity[i] ?? 0) + d;
        // Clamped here as well as in the spring pass: propagation can carry a column past the
        // limit that the spring pass had just brought it inside, and the whole safety net is worth
        // nothing if the last write of the step goes round it.
        const next = (height[i] ?? 0) + d;
        height[i] =
          next > MAX_DISPLACEMENT
            ? MAX_DISPLACEMENT
            : next < -MAX_DISPLACEMENT
              ? -MAX_DISPLACEMENT
              : next;
      }
    }
  }
}
