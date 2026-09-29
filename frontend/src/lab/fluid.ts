/*
 * Water made of water, instead of water made of a curve.
 *
 * WHY THIS REPLACES THE HEIGHT FIELD RATHER THAN TUNING IT. `lib/water/field.ts` stores one
 * surface height per horizontal position, which makes the surface a FUNCTION of x. A function has
 * exactly one value everywhere, so it cannot break in two, cannot fold over, cannot leave a
 * droplet behind on a wall, and cannot have air underneath it. Those are not missing features of
 * that model, they are shapes it has no way to spell. Every one of them is a thing water does.
 *
 * The vertical case proves it. A glass yanked downwards leaves its water behind — the water keeps
 * going while the glass has already left, so for a moment there is a gap between the liquid and
 * the base. A height field measured from the floor of the glass cannot represent a gap, and worse,
 * `splash()` subtracts its own mean from every column to guarantee that it moves water without
 * making any: a uniform vertical shove is exactly the input that correction cancels to zero. The
 * shipped field's answer to "the glass moved down" is, provably, nothing at all.
 *
 * So the state here is a bag of particles with positions and velocities, and the surface is
 * whatever shape they happen to make — including no single shape at all. `mesh.ts` turns them into
 * something drawable.
 *
 * THE SOLVER is Position-Based Fluids (Macklin & Müller 2013): predict where every particle would
 * go, then repeatedly nudge positions until the local density is right again, then read the
 * velocities back out of how far things actually moved. It is the scheme every game fluid uses,
 * for one reason — correcting POSITIONS cannot explode. Pressure forces in a classic SPH solver
 * can, and do, the first time somebody flings a tile across the screen.
 *
 * NO LIBRARY. A rigid-body engine (matter.js, planck) simulates solids and would give gravel in a
 * glass; the 2D SPH packages on npm are either asm.js blobs or unmaintained. The whole solver is
 * about 120 lines of arithmetic and it has to satisfy the product's invariants, which a third
 * party's does not know about. Cost of this file in the bundle: what it weighs, and nothing else.
 *
 * UNITS. y is 0 at the floor of the glass and 1 at the rim; x runs 0 to `wide`, where `wide` is
 * the vessel's width over its height — so a droplet is round rather than an ellipse, and the same
 * numbers describe a wide tile and a tall one. Time is seconds. Gravity is in glass-heights per
 * second squared, which is the only reason any constant below has a plausible size.
 *
 * THE INVARIANT, in this model's own terms: WATER IS MOVED, NEVER MADE. A particle is a fixed
 * parcel of liquid, so the count is the volume: `count * spacing^2` is the area of the water and
 * nothing in `advance()` may change `count`. Only `setLevel` may, because only a pour adds water.
 * `fluid.test.ts` pins that, and `mesh.test.ts` pins the other half of it — that the shape drawn
 * from those particles has the area the glass says it has.
 */

export interface FluidOptions {
  /** The vessel's width divided by its height. 1 is square. */
  wide?: number;
  /** The most particles this glass will ever carry. See `SPACING` for what it buys. */
  budget?: number;
}

/**
 * Gravity, in glass-heights per second squared.
 *
 * Real gravity for a real glass is about 100 of these units (a 10cm glass, 9.81 m/s²), and at 100
 * a droplet crosses the whole glass in 0.14s — three frames of streaking, then it is over. This is
 * a quarter of that, which is the honest trade: the motion has to be legible at the size of a tile
 * on a board, and a droplet that takes a third of a second to fall is one somebody can actually
 * see leave and rejoin. It is also what keeps the substep count sane; see `SUB_DT`.
 */
const GRAVITY = 26;

/**
 * The solver's own timestep, independent of the frame rate.
 *
 * PBF is unconditionally stable but it is not accurate at any step: a particle must not cross more
 * than about half a smoothing radius in one step or the constraint solve has nothing local to work
 * with and the fluid goes lumpy. Terminal speed here is about `sqrt(2*GRAVITY)` = 7 glass-heights
 * a second, and the smoothing radius at a full glass is 0.13, so the step has to be under
 * 0.13/2/7 = 0.009s. Three substeps per 60Hz frame it is.
 */
const SUB_DT = 1 / 180;

/** Past this many substeps in one call, stop catching up: the tab was in the background. */
const MAX_SUBSTEPS = 9;

/**
 * How many times the density constraint is solved per substep.
 *
 * Pressure has to travel from the floor to the surface for a stack of water to hold itself up, and
 * it travels one particle layer per iteration — so this is really a statement about how quickly the
 * glass stops fidgeting. At one iteration the liquid is visibly compressible and the residual
 * motion of a still glass MEASURED 0.065 glass-heights a second, which is a surface that crawls;
 * three brings it to a tenth of that and there is nothing left for a fourth to buy at tile size.
 */
const ITERATIONS = 3;

/** Constraint force mixing: keeps `lambda` finite where a particle has almost no neighbours. */
const RELAXATION = 1e-4;

/**
 * How deep a density deficit the fluid will try to close: surface tension, with a bound.
 *
 * ZERO, AND THAT IS A MEASURED DECISION RATHER THAN AN OMISSION.
 *
 * With it at zero the water resists being squeezed and not being pulled apart, which is what keeps
 * the solver stable (see `densities`) and is most of why droplets can exist at all. The cost is that
 * a hard vertical yank DILATES the body: the drawn shape peaks at 1.42 times the area the water
 * really occupies during a lift, and 1.22 during a drop, before returning to 1.03 when it settles.
 *
 * A bound of 0.08 fixes that outright — measured, it holds every gesture under 1.08 — and it is the
 * physically right answer, because real water does resist being pulled apart. It was tried and
 * rejected: a free surface reads about half of rest density, so the bound is active along the whole
 * surface all the time, and a glass with NOTHING done to it never went still again at any value
 * down to 0.02. A board that never stops redrawing is a worse defect than a transient over-read
 * that the glass clips anyway, so this is zero until the tension can be made to switch itself off —
 * which is a second pass, not a constant.
 */
const TENSION = 0.08;

/**
 * The speeds between which surface tension fades in, in glass-heights a second.
 *
 * It has to be exactly zero on water that is not going anywhere. A constant tension is a force with
 * nothing to balance it at a free surface, so the surface never stops being pulled at: MEASURED, a
 * glass with NOTHING done to it never reported itself still at any constant value down to 0.02, and
 * a version that merely tapered towards zero still left a sixth of it acting on the settled jitter
 * and never settled either.
 *
 * Nor is it enough to be zero at the jitter: the gate has to be a long way clear of it, because
 * tension makes particles move and moving particles turn the tension on. At 0.8 a shaken FULL glass
 * found the limit cycle and hovered just above the stillness threshold forever. At 1.6 — eight times
 * the 0.2 glass-heights a second a settled glass jitters at, and half what water in flight does —
 * every gesture at every level finishes.
 */
const TENSION_OFF = 1.6;
const TENSION_ON = 3;

/*
 * NO ARTIFICIAL PRESSURE TERM, AND THAT IS A DECISION.
 *
 * Every PBF implementation carries one: a small extra repulsion at close range, because particles
 * with few neighbours read as too thin, get pulled together to fix it, and the free surface
 * collapses into strings instead of staying a surface. It is called tensile instability and the fix
 * is in the original paper.
 *
 * It is not needed here, because clamping `lambda` to compression removed the cause rather than the
 * symptom: there is no attraction to be unstable. Worse, it actively broke the shallow glasses. The
 * term is added to `lambda` but does not scale with it, and `lambda` scales with the smoothing
 * radius while the term was a constant — so in a glass at 4%, where the water is three particle
 * rows deep and every `lambda` is zero, the repulsion was the ONLY thing left in the correction. It
 * expanded the layer in the only direction that was free: a 4% glass, untouched, threw its water
 * halfway up the vessel. Measured, twice, before and after capping the wall support, which is how
 * it was clear the wall support was not the culprit.
 */

/**
 * XSPH viscosity: each particle drifts a little towards the average velocity of its neighbours.
 *
 * This is the whole reason the fluid coheres into a body instead of a cloud of independent dots,
 * and it is also most of why it settles. Higher is syrup.
 */
const VISCOSITY = 0.11;

/**
 * Smoothing radius as a multiple of particle spacing.
 *
 * 2.4 puts about `pi * 2.4^2` = 18 particles inside the kernel, which is the number 2D SPH is
 * written for. Below ~2 the density estimate is too noisy to constrain; above ~3 the cost is
 * quadratic in this number for no gain.
 */
const SMOOTHING = 2.4;

/** Resolution of the wall-support table. Thirty-two steps is well under a tenth of a pixel. */
const GHOST_STEPS = 32;

/**
 * Particle spacing, and therefore how many particles a glass gets.
 *
 * A fixed spacing cannot work: a full glass would need thousands, and a glass at 3% would get
 * four. So the spacing is chosen per level to spend the budget — coarse particles in a full glass,
 * where the body is big and nobody can see the grain, and fine ones in a shallow one, where the
 * whole of the water is three particles deep and the grain is all there is.
 *
 * `SPACING_MIN` is the floor, because there is no point resolving a puddle finer than a pixel: at
 * a 110px-tall tile it is just over one pixel.
 */
const SPACING_MIN = 0.012;
const SPACING_MAX = 0.06;
const BUDGET = 420;

/** Room above the budget for a pour in flight, so a top-up never reallocates. */
const HEADROOM = 1.35;

/** How wide the pour is, as a fraction of the glass, and how fast it arrives. */
const POUR_WIDTH = 0.42;
const POUR_SPEED = 2.2;

/**
 * How far past the static tilt limit a brief gesture may push, and the vertical ceiling.
 *
 * Both MEASURED against the simulation — see the note in `drive`. A drag of 300 pixels in a tenth of
 * a second across a 110-pixel tile is two and a half glass-heights in 0.1s, which differenced twice
 * is about forty gravities: enough to throw every particle out of the glass. What is left after the
 * ceilings is a fling that tears the sheet and a glass that still holds its water.
 */
const TILT_HEADROOM = 5;

/** How hard the water may be thrown up the glass — the yanked-downwards case. */
const HEAVE_UP = 7;

/**
 * And the ceiling the other way, which is deliberately much lower.
 *
 * Lifting a glass presses its water into the base; letting go throws it back. Real water does that
 * too, but four hundred particles cannot store a compression the way a continuum does — the bottom
 * layer takes the whole of it and hands it back as a jet, and the body comes apart into a froth of
 * separate pieces rather than into droplets. MEASURED, with both ceilings at seven: a glass lifted
 * hard broke into twenty-five pieces with air trapped between them, which reads as foam, and this
 * product may not draw foam. Pressing down is therefore allowed about a third of what floating up
 * is, and the asymmetry is honest about where the model is weak.
 */
const HEAVE_DOWN = 2.5;

/**
 * The level at which the vertical ceiling reaches its full value, fading linearly below it.
 *
 * MEASURED against the rule rather than chosen: at the shipped field's own shallow threshold of
 * 0.09, a glass at 5% lifted hard threw its entire contents a QUARTER of the way up the vessel —
 * four and a half times its own depth, which reads as a glass with more in it than the goal has.
 * This is the value at which every gesture, at every level below 0.15, keeps the water inside twice
 * its own depth plus one droplet.
 */
const HEAVE_FULL = 0.33;

/**
 * How fast the water notices the vessel moving, in seconds.
 *
 * Acceleration is a second difference of a measured position, so the raw signal is almost entirely
 * quantisation noise; and a real body of water responds to the integral of a force rather than to
 * its instantaneous value. One low-pass fixes both. Short enough that a yank still arrives as a
 * yank: 40ms is two and a half frames.
 */
const DRIVE_LAG = 0.018;

/**
 * Below this much movement, for this many consecutive frames, the water is called still.
 *
 * MOVEMENT, NOT SPEED, and that distinction was learned the hard way. A position-based solver does
 * not converge to rest; it converges to a standing oscillation at the substep frequency, because
 * gravity compresses the stack a little every substep and the pressure solve pushes it back. So the
 * MEAN SPEED of a settled glass never reaches zero — measured, it settles at 0.17 glass-heights a
 * second in a full glass and 0.03 in a shallow one, a spread of six to one that no single speed
 * threshold can sit inside. A glass that never reports itself still is a board that redraws every
 * tile forever, which is the one performance promise this app has already made.
 *
 * What that oscillation does NOT do is go anywhere: the particles move a tenth of a pixel and come
 * back. So the question asked here is the question that actually matters — did anything move far
 * enough to see? — and it is asked of the furthest-travelled particle over one frame.
 *
 * In glass units, and MEASURED at two thirds of a pixel on a 110-pixel tile. The floor it has to
 * clear is 0.37 of a pixel, which is what a full glass does forever; the motion it must not swallow
 * is the tail of a slosh, which is still two pixels a frame when the surface is visibly rocking and
 * falls through this threshold about two seconds after the shove. Set at a third of a pixel — the
 * first value tried, and the one the arithmetic suggested — a full glass hovered a twentieth of a
 * pixel above it and never once reported itself still.
 */
const STILL_MOVE = 0.006;
const STILL_FRAMES = 8;

/**
 * A light global drag, per second.
 *
 * It bleeds off the standing oscillation described above rather than removing it, and it shortens
 * the tail of a slosh, which a calm product wants. It also passes for air resistance on a droplet,
 * which is a thing droplets have.
 */
const DRAG = 2.4;

/**
 * Dry friction: a fixed amount of speed removed per second, rather than a fraction of it.
 *
 * A proportional drag halves a speed and halves it again and never reaches zero, which is fine for a
 * wave and useless for the thing that actually keeps a glass awake — the free surface simmering.
 * Particles at the surface have no neighbours above them, so nothing resists their falling back onto
 * the layer below; they land, bounce, and land again indefinitely. MEASURED after the corner fix,
 * that simmer was the entire remaining jitter: the median particle in a full glass moved 0.05 of a
 * pixel a frame and the worst dozen, all of them at the surface, moved half a pixel.
 *
 * Friction of this shape brings a speed to EXACTLY zero in finite time, which is what a settling
 * criterion needs, and it barely touches a falling droplet — it takes 0.9 glass-heights a second off
 * a droplet doing five.
 */
const STICTION = 0.9;

/**
 * How far above the rim the simulation carries on, in glass heights.
 *
 * The vessel has to keep its water — losing a particle is the invariant broken in the most visible
 * way there is, a glass that empties itself because somebody shook it — so there is a lid. But a lid
 * AT the rim is a crusher: water flung at it is held in a layer one particle thick at enormous
 * density, the solve spends every frame trying to push it somewhere, and there is nowhere. MEASURED:
 * a full glass flung hard never went still again, at any of the four drive ceilings tried.
 *
 * So the water is given somewhere to be. Above the rim it is simply not drawn — the tile clips
 * there and always did — and it comes back down on its own.
 */
const LID = 1.35;

/** A wetting film on the walls, in bins up the glass. */
const FILM_BINS = 32;

/**
 * The wall film: water that has been up the wall and is running back down.
 *
 * It is drawn, and it is not volume — exactly as the shipped renderer's meniscus is not volume.
 * Wetting is water clinging in a layer microns thick; counting it as part of the glass's contents
 * would mean a glass that empties slightly every time somebody shakes it, and the invariant at the
 * top of this file says no.
 *
 * `FALL` is how fast it runs down, `SOAK` how fast contact lays it down, and `DRY` how fast it
 * gives up. `DRY` is what guarantees the glass ends still: a film that never dried would be a
 * thing to redraw forever.
 */
const FILM_REACH = 1.4;
const FILM_SOAK = 9;
const FILM_FALL = 0.55;
const FILM_DRY = 1.8;

export interface FluidDrive {
  /** The vessel's acceleration, in glass-heights per second squared, y up. */
  x: number;
  y: number;
}

export class Fluid {
  readonly wide: number;
  readonly budget: number;

  /** Live particle count. This is the volume of the water: see the invariant at the top. */
  count = 0;
  /** Particle spacing, and so `count * spacing^2` is the area the water occupies. */
  spacing = SPACING_MIN;
  /** Smoothing radius. */
  radius = SPACING_MIN * SMOOTHING;

  readonly x: Float32Array;
  readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly qx: Float32Array;
  private readonly qy: Float32Array;
  private readonly rho: Float32Array;
  private readonly lam: Float32Array;
  private readonly dxs: Float32Array;
  private readonly dys: Float32Array;
  /** Last frame's positions, so stillness can be asked as "did anything move?". */
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;

  /** Neighbour lists, rebuilt once per substep and reused across the iterations. */
  private readonly nbrStart: Int32Array;
  private readonly nbrList: Int32Array;
  private readonly cellOf: Int32Array;
  private cellStart = new Int32Array(1);
  private cellCount = new Int32Array(1);
  private cellItems: Int32Array;
  private cols = 1;
  private rows = 1;

  /** Wall film, 0–1 thick, indexed from the floor up. */
  readonly filmLeft = new Float32Array(FILM_BINS);
  readonly filmRight = new Float32Array(FILM_BINS);

  private restDensity = 1;
  /** How much density a wall stands in for, by distance from it. See `buildGhost`. */
  private readonly ghost = new Float32Array(GHOST_STEPS + 1);
  private levelValue = 0;
  private driveX = 0;
  private driveY = 0;
  private wantX = 0;
  private wantY = 0;
  private carryMs = 0;
  private quiet = 0;
  /** How far the furthest particle moved last frame, in glass units. Read by the bench. */
  lastMove = 0;
  /** Particles still to arrive from a pour, and when the nozzle may next let one row go. */
  private pending = 0;
  private nozzleWait = 0;
  private seed = 1;

  constructor(options: FluidOptions = {}) {
    this.wide = Math.max(0.2, options.wide ?? 1);
    this.budget = Math.max(16, Math.floor(options.budget ?? BUDGET));

    const cap = Math.ceil(this.budget * HEADROOM);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.qx = new Float32Array(cap);
    this.qy = new Float32Array(cap);
    this.rho = new Float32Array(cap);
    this.lam = new Float32Array(cap);
    this.dxs = new Float32Array(cap);
    this.dys = new Float32Array(cap);
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.nbrStart = new Int32Array(cap + 1);
    this.nbrList = new Int32Array(cap * 48);
    this.cellOf = new Int32Array(cap);
    this.cellItems = new Int32Array(cap);
  }

  /** 0–1, how full the glass is. */
  get level(): number {
    return this.levelValue;
  }

  /** The area the particles stand for, in glass units. `level * wide` when the books balance. */
  volume(): number {
    return this.count * this.spacing * this.spacing;
  }

  /**
   * Set how full the glass is.
   *
   * `disturb` off is the first paint of a tile that was already full: seed a settled block and do
   * not perform a pour nobody caused. On, water ARRIVES — a stream falling in from above the
   * surface, which lands, splashes and settles, because that is what pouring looks like and this
   * model can now express it.
   */
  setLevel(next: number, disturb = true): void {
    const level = Math.min(1, Math.max(0, next));
    const before = this.levelValue;
    this.levelValue = level;

    const spacing = spacingFor(level, this.wide, this.budget);
    const target = Math.min(this.x.length, Math.round((level * this.wide) / (spacing * spacing)));

    if (!disturb || level === 0) {
      this.spacing = spacing;
      this.radius = spacing * SMOOTHING;
      this.seedBlock(target);
      this.filmLeft.fill(0);
      this.filmRight.fill(0);
      this.quiet = STILL_FRAMES;
      return;
    }

    /*
     * A change of spacing means every particle now stands for a different amount of water, and
     * there is no honest way to rescale a body of them in flight. So the water that was already
     * there is re-seeded as a settled block at the OLD level with the NEW spacing, and the
     * difference is then poured on top of it. A pour arrives at a glass that is almost always
     * still, so in practice nothing is lost; what it costs is that a pour interrupts a slosh.
     */
    if (Math.abs(spacing - this.spacing) > this.spacing * 0.02) {
      const keep = Math.round((Math.min(before, level) * this.wide) / (spacing * spacing));
      this.spacing = spacing;
      this.radius = spacing * SMOOTHING;
      this.seedBlock(Math.min(this.x.length, keep));
    }

    if (target > this.count) this.pour(target - this.count);
    else this.drain(this.count - target);
    this.quiet = 0;
  }

  /** Put the water flat and still at its level. */
  still(): void {
    const spacing = spacingFor(this.levelValue, this.wide, this.budget);
    this.spacing = spacing;
    this.radius = spacing * SMOOTHING;
    this.seedBlock(Math.round((this.levelValue * this.wide) / (spacing * spacing)));
    this.filmLeft.fill(0);
    this.filmRight.fill(0);
    this.driveX = 0;
    this.driveY = 0;
    this.wantX = 0;
    this.wantY = 0;
    this.carryMs = 0;
    this.pending = 0;
    this.quiet = STILL_FRAMES;
  }

  /**
   * The vessel is accelerating.
   *
   * This is the whole of the interaction, and it is the same input for both axes — which is the
   * point. A glass that moves does not push its water; it moves out from under it, and the water
   * carries on. In the glass's own frame that is a body force of `-a`, so dragging right throws
   * the water left and dropping the glass throws the water UP, relative to a floor that has left.
   * There is no second mechanism for the vertical case and no scalar tilt: one vector, two axes.
   */
  drive(ax: number, ay: number): void {
    /*
     * A WAVE IS NEVER TALLER THAN THE WATER IT IS MADE OF, expressed as the only thing that can
     * enforce it here: a ceiling on how hard the vessel is allowed to push.
     *
     * Sideways, the ceiling is physical. Water under a steady lateral acceleration `a` settles to a
     * flat surface tilted by `a / g`, which lifts the downhill wall by `(wide / 2) * a / g` — so the
     * acceleration at which that lift equals the depth of the water is `2 * level * g / wide`, and
     * anything past it is asking for a wave the glass does not contain enough water to make. Which
     * is not a guess: with a flat six-gravity ceiling, a hard fling threw the water of a glass at
     * EVERY level — four percent, a quarter, a half — clean up to the rim, twenty-five times the
     * depth of a shallow glass's own water. `TILT_HEADROOM` is how far past the static limit a
     * gesture lasting a tenth of a second is allowed to go, and it is measured, not assumed.
     *
     * Vertically there is no tilt to limit, only a lift. The body leaves the floor and comes back,
     * which is the whole of what was asked for — so the ceiling is a plain multiple of gravity,
     * faded out below `HEAVE_FULL` because the same sentence still applies with "wave" replaced by
     * "body": a glass at 5% thrown at seven gravities put its entire contents at a QUARTER of the
     * way up the vessel, four and a half times its own depth, which reads as a glass with more in it
     * than the goal has.
     */
    const tilt = GRAVITY * TILT_HEADROOM * ((2 * this.levelValue) / this.wide);
    const shallow = Math.min(1, this.levelValue / HEAVE_FULL);
    this.wantX = clamp(-ax, -tilt, tilt);
    this.wantY = clamp(-ay, -GRAVITY * HEAVE_DOWN * shallow, GRAVITY * HEAVE_UP * shallow);
  }

  /**
   * Advance by however long really passed, in fixed substeps.
   *
   * Returns whether anything is still moving, so the caller can stop drawing a glass that has gone
   * quiet — the same contract the shipped field has, and for the same reason: a board nobody is
   * touching must cost nothing.
   */
  advance(elapsedMs: number): boolean {
    if (this.count === 0) return false;

    this.carryMs += Math.max(0, elapsedMs);
    let steps = Math.floor(this.carryMs / (SUB_DT * 1000));
    this.carryMs -= steps * SUB_DT * 1000;
    if (steps > MAX_SUBSTEPS) {
      steps = MAX_SUBSTEPS;
      this.carryMs = 0;
    }

    for (let s = 0; s < steps; s += 1) this.substep(SUB_DT);
    if (steps > 0) this.settleCheck();
    return this.moving();
  }

  /** Mean speed, in glass-heights per second. Diagnostics; stillness uses `lastMove`. */
  meanSpeed(): number {
    if (this.count === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.count; i += 1) {
      total += Math.hypot(this.vx[i] ?? 0, this.vy[i] ?? 0);
    }
    return total / this.count;
  }

  moving(): boolean {
    return this.count > 0 && this.quiet < STILL_FRAMES;
  }

  /** The highest particle, in glass units. Used by the tests that bound a wave. */
  highest(): number {
    let top = 0;
    for (let i = 0; i < this.count; i += 1) top = Math.max(top, this.y[i] ?? 0);
    return top;
  }

  /** How many particles are clear of the body: this is what "it divided into droplets" measures. */
  detached(): number {
    this.buildGrid();
    this.buildNeighbours();
    let loose = 0;
    for (let i = 0; i < this.count; i += 1) {
      const n = (this.nbrStart[i + 1] ?? 0) - (this.nbrStart[i] ?? 0);
      if (n < 6) loose += 1;
    }
    return loose;
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * How much density the WALL stands in for, tabulated once per spacing.
   *
   * A particle sitting on the floor is missing every neighbour that would have been below it, so it
   * measures about half the rest density and the constraint concludes there is a hole there. With
   * `lambda` clamped to compression that means the whole bottom layer is unsupported: it falls into
   * the hard wall clamp, the layer above compresses onto it, and the solve spends every frame
   * pushing the stack back up. That is where most of the jitter in the first working version came
   * from, and the water ground against the floor of the glass instead of resting on it.
   *
   * So the wall is given the density it displaces. For a straight wall at distance `d` the missing
   * neighbours are a half-plane, and the fraction of the kernel lying beyond a chord at `d` is
   * `integral of W(r) * 2 * acos(d/r) * r dr` from `d` to the radius — worth exactly 0.5 at the
   * wall itself, which is the half that is missing. Integrated numerically here rather than
   * approximated, because it is done once per pour and never per frame.
   */
  private buildGhost(): void {
    const h = this.radius;
    const poly = poly6Norm(h);
    const h2 = h * h;
    const slices = 256;

    for (let k = 0; k <= GHOST_STEPS; k += 1) {
      const d = (k / GHOST_STEPS) * h;
      let total = 0;
      for (let m = 0; m < slices; m += 1) {
        const r = d + ((m + 0.5) / slices) * (h - d);
        const diff = h2 - r * r;
        if (diff <= 0) continue;
        const w = poly * diff * diff * diff;
        total += w * 2 * Math.acos(Math.min(1, d / r)) * r * ((h - d) / slices);
      }
      this.ghost[k] = total;
    }
  }

  /** The tabulated wall support at this distance, interpolated. Zero out of reach. */
  private ghostAt(d: number): number {
    if (d >= this.radius) return 0;
    const t = (Math.max(0, d) / this.radius) * GHOST_STEPS;
    const k = Math.min(GHOST_STEPS - 1, Math.floor(t));
    const f = t - k;
    return (this.ghost[k] ?? 0) * (1 - f) + (this.ghost[k + 1] ?? 0) * f;
  }

  /**
   * A settled block of water on the floor of the glass.
   *
   * Laid out on a hexagonal lattice — the packing a two-dimensional fluid actually relaxes to — with
   * a hair of jitter on top.
   *
   * THE JITTER IS NOT DECORATION. A perfect lattice stays perfect until something pulls on it, and
   * then it comes apart along a lattice plane rather than anywhere else. Seeded without it, a glass
   * stretched by a hard vertical yank separated into four dead-straight horizontal LAYERS with lines
   * of air between them — water does not have strata, and the picture read like a diagram. A third
   * of a spacing of noise removes the planes and nothing else. The generator is seeded, so a test
   * and a screenshot see the same water twice.
   */
  private seedBlock(target: number): void {
    const n = Math.max(0, Math.min(this.x.length, target));
    const a = hexPitch(this.spacing);
    const rowStep = (a * Math.sqrt(3)) / 2;
    const across = Math.max(1, Math.floor(this.wide / a));
    this.count = n;
    this.seed = 1;
    for (let i = 0; i < n; i += 1) {
      const col = i % across;
      const row = Math.floor(i / across);
      const shift = (row & 1) === 0 ? 0 : a / 2;
      this.x[i] = Math.min(
        this.wide - a * 0.5,
        (col + 0.5) * a + shift + (this.random() - 0.5) * a * 0.3,
      );
      this.y[i] = (row + 0.5) * rowStep + (this.random() - 0.5) * rowStep * 0.3;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.restDensity = latticeDensity(this.radius, this.spacing);
    this.buildGhost();
  }

  /**
   * Water arriving: a stream from above, over time, rather than a block teleported to the rim.
   *
   * The first version added every new particle at once, above the surface. Two hundred and eighty
   * of them appeared in the same place, could not possibly be that dense, and the solve did the only
   * thing it could — flung them at the walls, where a score of them stayed jammed against the rim
   * for the next four hundred frames. The glass never went still again.
   *
   * So a pour is a NOZZLE: it releases one row at a time, spaced so that the row before it has had
   * time to fall out of the way, and it takes as long as it takes. Which is also what pouring is.
   */
  private pour(n: number): void {
    this.pending += Math.min(n, this.x.length - this.count);
  }

  /** Let the nozzle go for `dt`, if it is time and the water has moved out from under it. */
  private runNozzle(dt: number): void {
    if (this.pending <= 0) return;
    this.nozzleWait -= dt;
    if (this.nozzleWait > 0) return;

    const a = hexPitch(this.spacing);
    const across = Math.max(2, Math.round((this.wide * POUR_WIDTH) / a));
    const room = this.x.length - this.count;
    const batch = Math.min(this.pending, across, room);
    if (batch <= 0) {
      this.pending = 0;
      return;
    }

    const lip = 1 - this.spacing * 0.5;
    for (let k = 0; k < batch; k += 1) {
      const i = this.count + k;
      this.x[i] = this.wide * 0.5 + (k - (batch - 1) / 2) * a + (this.random() - 0.5) * a * 0.2;
      this.y[i] = lip;
      this.vx[i] = 0;
      this.vy[i] = -POUR_SPEED;
    }
    this.count += batch;
    this.pending -= batch;
    // Far enough apart that the next row starts where this one has already left.
    this.nozzleWait = a / POUR_SPEED;
  }

  /** Water leaving: the top of the body goes first, which is where a glass actually loses it. */
  private drain(n: number): void {
    for (let k = 0; k < n && this.count > 0; k += 1) {
      let top = 0;
      let best = -Infinity;
      for (let i = 0; i < this.count; i += 1) {
        const yy = this.y[i] ?? 0;
        if (yy > best) {
          best = yy;
          top = i;
        }
      }
      const last = this.count - 1;
      this.x[top] = this.x[last] ?? 0;
      this.y[top] = this.y[last] ?? 0;
      this.vx[top] = this.vx[last] ?? 0;
      this.vy[top] = this.vy[last] ?? 0;
      this.count = last;
    }
  }

  private substep(dt: number): void {
    this.runNozzle(dt);
    const { count, vx, vy, x, y, qx, qy } = this;

    // The vessel's acceleration reaches the water through a low-pass: see DRIVE_LAG.
    const blend = Math.min(1, dt / DRIVE_LAG);
    this.driveX += (this.wantX - this.driveX) * blend;
    this.driveY += (this.wantY - this.driveY) * blend;

    const ax = this.driveX;
    const ay = this.driveY - GRAVITY;
    // No particle may cross more than half a smoothing radius in one substep; beyond that the
    // constraint solve has no neighbours to work with. A speed limit loses momentum, never water.
    const vMax = (this.radius * 0.5) / dt;

    for (let i = 0; i < count; i += 1) {
      let u = (vx[i] ?? 0) + ax * dt;
      let v = (vy[i] ?? 0) + ay * dt;
      const speed = Math.hypot(u, v);
      if (speed > vMax) {
        u = (u / speed) * vMax;
        v = (v / speed) * vMax;
      }
      vx[i] = u;
      vy[i] = v;
      qx[i] = (x[i] ?? 0) + u * dt;
      qy[i] = (y[i] ?? 0) + v * dt;
    }

    this.buildGrid();
    this.buildNeighbours();

    for (let it = 0; it < ITERATIONS; it += 1) {
      this.densities();
      this.corrections();
    }

    const inv = 1 / dt;
    for (let i = 0; i < count; i += 1) {
      this.bounds(i);
      vx[i] = ((qx[i] ?? 0) - (x[i] ?? 0)) * inv;
      vy[i] = ((qy[i] ?? 0) - (y[i] ?? 0)) * inv;
      x[i] = qx[i] ?? 0;
      y[i] = qy[i] ?? 0;
    }

    this.viscosity();

    const drag = Math.max(0, 1 - DRAG * dt);
    const bleed = STICTION * dt;
    for (let i = 0; i < count; i += 1) {
      const u = (vx[i] ?? 0) * drag;
      const v = (vy[i] ?? 0) * drag;
      const speed = Math.hypot(u, v);
      if (speed <= bleed) {
        vx[i] = 0;
        vy[i] = 0;
      } else {
        const keep = 1 - bleed / speed;
        vx[i] = u * keep;
        vy[i] = v * keep;
      }
    }

    this.wetWalls(dt);
  }

  private buildGrid(): void {
    const cell = Math.max(this.radius, 1e-4);
    const cols = Math.max(1, Math.ceil(this.wide / cell) + 2);
    const rows = Math.max(1, Math.ceil((LID + 0.2) / cell) + 2);
    const cells = cols * rows;
    if (cols !== this.cols || rows !== this.rows || this.cellStart.length !== cells + 1) {
      this.cols = cols;
      this.rows = rows;
      this.cellStart = new Int32Array(cells + 1);
      this.cellCount = new Int32Array(cells);
    }
    this.cellCount.fill(0);

    const { count, qx, qy, cellOf, cellCount } = this;
    for (let i = 0; i < count; i += 1) {
      const cx = clampInt(Math.floor((qx[i] ?? 0) / cell) + 1, 0, cols - 1);
      const cy = clampInt(Math.floor((qy[i] ?? 0) / cell) + 1, 0, rows - 1);
      const c = cy * cols + cx;
      cellOf[i] = c;
      cellCount[c] = (cellCount[c] ?? 0) + 1;
    }

    let sum = 0;
    for (let c = 0; c < cells; c += 1) {
      this.cellStart[c] = sum;
      sum += this.cellCount[c] ?? 0;
    }
    this.cellStart[cells] = sum;

    // Reuse cellCount as the write cursor; it is rebuilt from scratch next time anyway.
    for (let c = 0; c < cells; c += 1) this.cellCount[c] = this.cellStart[c] ?? 0;
    for (let i = 0; i < count; i += 1) {
      const c = cellOf[i] ?? 0;
      const at = this.cellCount[c] ?? 0;
      this.cellItems[at] = i;
      this.cellCount[c] = at + 1;
    }
  }

  /**
   * Neighbour lists, built once per substep and reused by both iterations.
   *
   * Positions move by a fraction of the spacing during the solve, so the neighbour SET is stable
   * across iterations even though the distances are not — which is standard PBF practice and cuts
   * the grid walks from six per substep to one.
   */
  private buildNeighbours(): void {
    const { count, qx, qy, nbrStart, nbrList, cellItems, cellStart, cols, rows } = this;
    const cell = Math.max(this.radius, 1e-4);
    const r2 = this.radius * this.radius;
    const perMax = 48;
    let write = 0;

    for (let i = 0; i < count; i += 1) {
      nbrStart[i] = write;
      const xi = qx[i] ?? 0;
      const yi = qy[i] ?? 0;
      const cx = clampInt(Math.floor(xi / cell) + 1, 0, cols - 1);
      const cy = clampInt(Math.floor(yi / cell) + 1, 0, rows - 1);
      let taken = 0;

      for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy += 1) {
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx += 1) {
          const c = gy * cols + gx;
          const from = cellStart[c] ?? 0;
          const to = cellStart[c + 1] ?? 0;
          for (let k = from; k < to; k += 1) {
            const j = cellItems[k] ?? 0;
            if (j === i) continue;
            const dx = xi - (qx[j] ?? 0);
            const dy = yi - (qy[j] ?? 0);
            if (dx * dx + dy * dy >= r2) continue;
            if (taken >= perMax) continue;
            nbrList[write] = j;
            write += 1;
            taken += 1;
          }
        }
      }
    }
    nbrStart[count] = write;
  }

  private densities(): void {
    const { count, qx, qy, nbrStart, nbrList, rho, lam } = this;
    const h = this.radius;
    const poly = poly6Norm(h);
    const spiky = spikyNorm(h);
    const h2 = h * h;
    const rho0 = this.restDensity;
    const inv0 = 1 / rho0;

    for (let i = 0; i < count; i += 1) {
      const xi = qx[i] ?? 0;
      const yi = qy[i] ?? 0;
      let density = poly * h2 * h2 * h2;
      let gx = 0;
      let gy = 0;
      let sumSq = 0;
      const from = nbrStart[i] ?? 0;
      const to = nbrStart[i + 1] ?? 0;

      for (let k = from; k < to; k += 1) {
        const j = nbrList[k] ?? 0;
        const dx = xi - (qx[j] ?? 0);
        const dy = yi - (qy[j] ?? 0);
        const r2 = dx * dx + dy * dy;
        const diff = h2 - r2;
        if (diff > 0) density += poly * diff * diff * diff;
        const r = Math.sqrt(r2);
        if (r > 1e-9 && r < h) {
          const g = (spiky * (h - r) * (h - r)) / r;
          const wx = g * dx * inv0;
          const wy = g * dy * inv0;
          gx += wx;
          gy += wy;
          sumSq += wx * wx + wy * wy;
        }
      }

      /*
       * The three walls stand in for the neighbours they displace — but only up to the hole they
       * are filling, never past it. Not the rim either: a glass is open at the top and a free
       * surface has to stay free, or the water would be held down by nothing.
       *
       * THE CAP IS THE WHOLE OF IT. Unbounded wall support is the standard treatment and it is
       * correct for water that is deeper than the kernel is wide. A glass at 4% is not: its water
       * is three particle rows deep and the kernel reaches two and a half of them, so a particle
       * near the floor collects a full half-plane of wall on top of a neighbourhood that was
       * already most of the way full, reads as 1.25 of rest density, and is told to decompress. It
       * decompresses in the only direction that is free — upwards. MEASURED: a 4% glass, untouched,
       * threw its water to 87% of the vessel's height within four seconds. Capping the support at
       * the deficit says the one thing the wall is there to say: a wall can fill a hole, it cannot
       * make one overflow.
       */
      /*
       * Two walls that meet are not two walls added together.
       *
       * Adding the floor's support to the near wall's counts the quadrant they share TWICE, so a
       * particle in the bottom corner of the glass reads as 1.0 of a missing neighbourhood when the
       * truth is 0.75 — and 0.25 of spurious density is a hard shove out of the corner, into the
       * wall clamp, and back again, every frame, forever. MEASURED: the still-water jitter of a
       * full glass was 1.5 percent of the vessel a frame and every one of the worst offenders was
       * within three particle spacings of a bottom corner, while the median particle moved a
       * hundredth of that. It is the reason a settled glass would not report itself settled.
       *
       * Combined as overlapping regions rather than summed — `a + b - ab`, which is exactly 0.75
       * where two half-planes meet at a right angle, and exactly `a` where the second wall is out
       * of reach.
       */
      let support = this.ghostAt(yi);
      support = union(support, this.ghostAt(xi));
      support = union(support, this.ghostAt(this.wide - xi));
      // The lid counts too, and only ever when water is actually up there — it sits a third of a
      // glass above the rim, which is further than the kernel reaches from any resting surface. A
      // lid with no support behind it crushes whatever reaches it into a single dense layer that
      // the solve can never resolve, and that layer is what kept an over-flung glass awake.
      support = union(support, this.ghostAt(LID - yi));
      density += rho0 * support;

      rho[i] = density;
      const sum = sumSq + gx * gx + gy * gy;
      /*
       * Only compression is resolved, never expansion — `lambda` is clamped at zero.
       *
       * This one `Math.min` is the difference between a fluid and a firework. A particle at the
       * free surface is missing half its neighbours, so its measured density is about 0.49 of rest
       * and the unclamped constraint reads that as "too thin" and pulls its neighbours in to fix
       * it. MEASURED, on the first substep of a still glass at half full: the correction it asks
       * for is 1.09 particle spacings, in one iteration, on water that nobody has touched. A solver
       * that moves a particle further than the distance to its neighbour has no idea where anything
       * is any more, and the glass filled to the brim within three frames.
       *
       * Physically it is the right clamp too: water resists being squeezed and does not resist
       * being pulled apart, which is exactly why it can separate into droplets at all.
       */
      /*
       * Compression is resolved in full; expansion only up to `TENSION`.
       *
       * Clamping at exactly zero — resisting compression and nothing else — is what stops a PBF
       * solver being a firework, and the measurement that settled it is in the note above. But it
       * also means the water offers NO resistance to being pulled apart, and a glass yanked hard
       * enough dilated until the drawn body covered the whole vessel: a glass at 62% reading as a
       * glass at 100% for a third of a second, which is the app lying about somebody's progress.
       *
       * Real water does resist. So the density error is floored before it is turned into a
       * multiplier: the solver will try to close a hole up to `TENSION` deep and ignores anything
       * deeper. That bound is what makes it surface tension rather than the collapse that unbounded
       * cohesion produces — a free surface reads about half of rest density, and asking the solver
       * to fix a deficit of 0.5 is what moved particles a whole spacing in one iteration.
       */
      // Only water that is going somewhere is held together: see `TENSION`.
      const speed = Math.hypot(this.vx[i] ?? 0, this.vy[i] ?? 0);
      const allow = TENSION * clamp((speed - TENSION_OFF) / (TENSION_ON - TENSION_OFF), 0, 1);
      const error = Math.max(-allow, density * inv0 - 1);
      lam[i] = -error / (sum + RELAXATION);
    }
  }

  private corrections(): void {
    const { count, qx, qy, nbrStart, nbrList, lam, dxs, dys } = this;
    const h = this.radius;
    const spiky = spikyNorm(h);
    const inv0 = 1 / this.restDensity;

    for (let i = 0; i < count; i += 1) {
      const xi = qx[i] ?? 0;
      const yi = qy[i] ?? 0;
      const li = lam[i] ?? 0;
      let sx = 0;
      let sy = 0;
      const from = nbrStart[i] ?? 0;
      const to = nbrStart[i + 1] ?? 0;

      for (let k = from; k < to; k += 1) {
        const j = nbrList[k] ?? 0;
        const dx = xi - (qx[j] ?? 0);
        const dy = yi - (qy[j] ?? 0);
        const r = Math.hypot(dx, dy);
        if (r <= 1e-9 || r >= h) continue;
        const g = (spiky * (h - r) * (h - r)) / r;
        const push = (li + (lam[j] ?? 0)) * g * inv0;
        sx += push * dx;
        sy += push * dy;
      }

      dxs[i] = sx;
      dys[i] = sy;
    }

    /*
     * Applied, and then put back inside the glass — inside the iteration, not after it.
     *
     * The correction is a position, and the velocity is read back out of how far the position moved.
     * So a particle pushed a long way into a wall by one iteration and teleported back by a clamp
     * afterwards reports the whole of that teleport as velocity, and comes off the wall as a JET:
     * with the clamp outside the loop, a hard fling sent particles to whatever height the lid was
     * put at — 1.2, 1.6, 2.2 glass-heights, always exactly the lid, which is the signature of an
     * energy source rather than of a splash.
     */
    for (let i = 0; i < count; i += 1) {
      qx[i] = (qx[i] ?? 0) + (dxs[i] ?? 0);
      qy[i] = (qy[i] ?? 0) + (dys[i] ?? 0);
      this.bounds(i);
    }
  }

  /**
   * Keep the water inside the glass.
   *
   * A hard wall, with the normal component of the motion simply removed rather than bounced: water
   * hitting glass does not rebound, it spreads. The three walls are the glass; the fourth is `LID`,
   * which is above the rim and exists only so that nothing can be lost.
   */
  private bounds(i: number): void {
    const { qx, qy } = this;
    const pad = this.spacing * 0.5;
    const loX = pad;
    const hiX = this.wide - pad;
    const loY = pad;
    const hiY = LID - pad;

    let px = qx[i] ?? 0;
    let py = qy[i] ?? 0;
    if (px < loX) px = loX;
    else if (px > hiX) px = hiX;
    if (py < loY) py = loY;
    else if (py > hiY) py = hiY;
    qx[i] = px;
    qy[i] = py;
  }

  /** XSPH: drift towards the neighbours' average velocity. This is what makes it a body. */
  private viscosity(): void {
    const { count, x, y, vx, vy, nbrStart, nbrList, dxs, dys } = this;
    const h = this.radius;
    const poly = poly6Norm(h);
    const h2 = h * h;

    for (let i = 0; i < count; i += 1) {
      const xi = x[i] ?? 0;
      const yi = y[i] ?? 0;
      let sx = 0;
      let sy = 0;
      let weight = 0;
      const from = nbrStart[i] ?? 0;
      const to = nbrStart[i + 1] ?? 0;
      for (let k = from; k < to; k += 1) {
        const j = nbrList[k] ?? 0;
        const dx = xi - (x[j] ?? 0);
        const dy = yi - (y[j] ?? 0);
        const diff = h2 - (dx * dx + dy * dy);
        if (diff <= 0) continue;
        const w = poly * diff * diff * diff;
        sx += ((vx[j] ?? 0) - (vx[i] ?? 0)) * w;
        sy += ((vy[j] ?? 0) - (vy[i] ?? 0)) * w;
        weight += w;
      }
      dxs[i] = weight > 0 ? (sx / weight) * VISCOSITY : 0;
      dys[i] = weight > 0 ? (sy / weight) * VISCOSITY : 0;
    }

    for (let i = 0; i < count; i += 1) {
      vx[i] = (vx[i] ?? 0) + (dxs[i] ?? 0);
      vy[i] = (vy[i] ?? 0) + (dys[i] ?? 0);
    }
  }

  /**
   * Wall wetting: water that touched the wall leaves a film, and the film runs down.
   *
   * Laid down by contact, advected downwards, and dried off. The advection is deliberately crude —
   * a fraction of each bin handed to the one below per second — because the thing worth having is
   * the READING: a streak above the waterline that is still there a moment after the water has
   * gone, moving the right way.
   */
  private wetWalls(dt: number): void {
    const { count, x, y, filmLeft, filmRight } = this;
    const reach = this.spacing * FILM_REACH;
    const soak = FILM_SOAK * dt;

    /*
     * Only water that went HIGHER than it belongs leaves a mark.
     *
     * The first version wetted a bin for any particle touching the wall, submerged ones included —
     * so a glass at rest had a permanently soaked wall below its own waterline, invisible because the
     * body is drawn over it, and the film never dried. Which mattered for a reason that has nothing
     * to do with the picture: a wet wall counts as something still happening, so the glass never
     * reported itself still and the whole board kept redrawing. The film is the record of a wave
     * that climbed, so the waterline is where it starts.
     */
    const climbed = this.levelValue + this.spacing;
    for (let i = 0; i < count; i += 1) {
      if ((y[i] ?? 0) <= climbed) continue;
      const px = x[i] ?? 0;
      const bin = clampInt(Math.floor((y[i] ?? 0) * FILM_BINS), 0, FILM_BINS - 1);
      if (px < reach) filmLeft[bin] = Math.min(1, (filmLeft[bin] ?? 0) + soak);
      if (px > this.wide - reach) filmRight[bin] = Math.min(1, (filmRight[bin] ?? 0) + soak);
    }

    const fall = Math.min(0.5, FILM_FALL * FILM_BINS * dt);
    const dry = Math.max(0, 1 - FILM_DRY * dt);
    for (const film of [filmLeft, filmRight]) {
      for (let k = 0; k < FILM_BINS - 1; k += 1) {
        const above = film[k + 1] ?? 0;
        if (above <= 0) continue;
        const moved = above * fall;
        film[k + 1] = above - moved;
        film[k] = Math.min(1, (film[k] ?? 0) + moved);
      }
      for (let k = 0; k < FILM_BINS; k += 1) film[k] = (film[k] ?? 0) * dry;
    }
  }

  /**
   * Has it gone quiet?
   *
   * The furthest any particle travelled in the last frame, against a measured threshold, for several
   * frames running — and when it is reached, velocities are zeroed outright, which is what actually
   * stops the loop. Zeroing is invisible at a movement below `STILL_MOVE`: that is what the
   * threshold was measured to mean.
   *
   * A wetted wall and a pour still in flight both count as moving, because both are things that
   * have to finish before the glass is done.
   */
  private settleCheck(): void {
    const { count, x, y, sx, sy } = this;
    let worst = 0;
    for (let i = 0; i < count; i += 1) {
      const dx = (x[i] ?? 0) - (sx[i] ?? 0);
      const dy = (y[i] ?? 0) - (sy[i] ?? 0);
      const d = dx * dx + dy * dy;
      if (d > worst) worst = d;
    }
    this.lastMove = Math.sqrt(worst);
    sx.set(x);
    sy.set(y);

    if (this.lastMove < STILL_MOVE && this.pending <= 0 && this.filmPeak() <= 0.02) {
      this.quiet += 1;
      if (this.quiet >= STILL_FRAMES) {
        this.vx.fill(0);
        this.vy.fill(0);
      }
    } else {
      this.quiet = 0;
    }
  }

  private filmPeak(): number {
    let peak = 0;
    for (let k = 0; k < FILM_BINS; k += 1) {
      peak = Math.max(peak, this.filmLeft[k] ?? 0, this.filmRight[k] ?? 0);
    }
    return peak;
  }

  /** A seeded generator, so a screenshot and a test see the same water twice. */
  private random(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}

/** Particle spacing for this much water: spend the budget, and never go finer than a pixel. */
export function spacingFor(level: number, wide: number, budget = BUDGET): number {
  if (level <= 0) return SPACING_MIN;
  const ideal = Math.sqrt((level * wide) / budget);
  return Math.min(SPACING_MAX, Math.max(SPACING_MIN, ideal));
}

/** 2D poly6 normalisation. */
export function poly6Norm(h: number): number {
  return 4 / (Math.PI * Math.pow(h, 8));
}

/** 2D spiky gradient normalisation, already negated for `(x_i - x_j)`. */
export function spikyNorm(h: number): number {
  return -30 / (Math.PI * Math.pow(h, 5));
}

/**
 * The nearest-neighbour distance of a hexagonal packing whose particles own `spacing^2` each.
 *
 * A two-dimensional fluid does not relax to a square grid, it relaxes to a hexagonal one — and the
 * difference is not cosmetic. Rest density computed for a square lattice is about a percent away
 * from the density the fluid actually settles at, so the body slowly compacts into the packing it
 * prefers and THE WATERLINE SINKS: measured, two percent of the vessel over four seconds, on a
 * glass nobody had touched. A goal's glass quietly emptying itself is the exact failure the
 * invariant at the top of this file exists to prevent, so the rest density is computed for the
 * packing the water is going to choose.
 */
export function hexPitch(spacing: number): number {
  return spacing * Math.sqrt(2 / Math.sqrt(3));
}

/**
 * The density a hexagonal packing of this spacing produces under this kernel.
 *
 * COMPUTED, NOT ASSUMED. Rest density is the one number a PBF solver is most sensitive to: a couple
 * of percent out and the fluid either slowly inflates or slowly collapses, and either way the water
 * drifts off the number the glass is meant to be showing. The kernel does not sum to exactly one
 * over a truncated lattice, so the value is summed here rather than guessed.
 */
export function latticeDensity(h: number, spacing: number): number {
  const poly = poly6Norm(h);
  const h2 = h * h;
  const a = hexPitch(spacing);
  const rowStep = (a * Math.sqrt(3)) / 2;
  const span = Math.ceil(h / Math.min(a, rowStep)) + 1;
  let total = 0;
  for (let row = -span; row <= span; row += 1) {
    const dy = row * rowStep;
    const shift = (row & 1) === 0 ? 0 : a / 2;
    for (let col = -span; col <= span; col += 1) {
      const dx = col * a + shift;
      const diff = h2 - (dx * dx + dy * dy);
      if (diff > 0) total += poly * diff * diff * diff;
    }
  }
  return total;
}

/** Two overlapping fractions of the same neighbourhood, combined without counting the overlap. */
function union(a: number, b: number): number {
  return a + b - a * b;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function clampInt(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
