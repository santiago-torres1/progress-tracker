/*
 * Water in a glass as a SUM OF STANDING WAVES: linear potential-flow sloshing in a rectangular tank.
 *
 * WHY THIS AND NOT THE HEIGHT FIELD. The shipped `field.ts` is a row of springs, and a row of springs
 * shoved at its two end columns carries the shove as a pulse: 0.9 s after a drag its surface is flat
 * shelves joined by ramps, bouncing between the walls. Liquid in a container does not do that. It
 * rocks as a smooth standing slosh dominated by its lowest mode, at a frequency set by how wide the
 * container is and how deep the water is. Four releases of tuning the springs did not produce that,
 * because the springs cannot. This can produce nothing else.
 *
 * THE MODEL, IN FOUR LINES.
 *
 *   surface      η(x, t) = Σ a_n(t) · cos(nπx / W),   n = 1..N,   x ∈ [0, W]
 *   each mode    ä_n + 2σ_n ȧ_n + ω_n² a_n = ω_n² · target_n
 *   frequency    ω_n² = (g_eff · k_n + (γ/ρ) · k_n³) · tanh(k_n · h),   k_n = nπ / W
 *   sideways     target_n = c_n · a_x / g_eff,   c_n = 4W / (n²π²) for odd n, 0 for even
 *
 * Every cosine with n ≥ 1 integrates to exactly zero across the glass, so WATER IS MOVED, NEVER MADE
 * by construction: there is no operation in this file that can change the volume, because volume is
 * not one of its variables. The level is set from outside (by the goal) and nothing in here writes it
 * except a pour, which eases it from one given number to another.
 *
 * `tanh(k·h)` is the whole of "water that knows how deep it is": a shallow glass sloshes visibly
 * slower than a full one, which the shipped field could only approximate by tuning, and here is the
 * dispersion relation of water.
 *
 * UNITS. Lengths are CSS pixels and time is seconds, with gravity converted once through a stated
 * scale (`METRES_PER_PX`), so every equation above is used as written. Nothing here knows about
 * canvases, React or the DOM; the drawing lives in `liquidPaint.ts`.
 *
 * ROUND TWO: ONE BODY THAT BREAKS UP. The owner liked the motion and called it jelly: one body that
 * bends and never comes apart. So the modal surface stays, and around it:
 *
 *   - a STRENGTH gain on the drive, because at the honest scale a drag sloshed to the rim;
 *   - a per-glass SCALE (`realScale`) that lets a small vessel rock like a real drinking glass;
 *   - BREAKUP on three physical tests — the surface falling away faster than gravity can hold the
 *     water on it, a crest past the steepest a wave can stand, water arriving at a wall fast — which
 *     throws droplets (`spray.ts`) and wall sheets. Their water leaves the body as a dent and comes
 *     back as a bump: body plus airborne is the level, always;
 *   - a CASCADE that takes energy out of a big slosh at a violent moment and puts a smaller share
 *     into short choppy waves that die in a fraction of a second, so a wave meeting a wall does not
 *     bounce back whole.
 *
 * At rest none of it exists: no droplets, no sampling, a bound of 24 numbers per step, and sleep.
 */

import { Droplets, FLYING, SLIDING, sharedBudget, type DropletBudget } from './spray';

/**
 * THE PHYSICAL SCALE: 0.4 mm per CSS pixel, so a 250px tile is a glass 10 cm across.
 *
 * Chosen so the board's commonest tiles land in the range of real cups. A desktop small tile is
 * about 250×88, a medium one about 516×192, a phone tile about 170×156: 10 cm, 21 cm and 7 cm wide.
 * At 62% full their fundamentals come out at about 2.2, 1.5 and 3.3 Hz, which is what a cup, a bowl
 * and a tumbler do. One scale for every tile, so a large tile sloshes slower than a small one for
 * the same reason a bowl does.
 */
export const METRES_PER_PX = 0.0004;

/** Standard gravity, m/s². */
export const GRAVITY = 9.81;

/** Gravity in the units this file works in: CSS px/s². About 24,500. */
export const G_PX = GRAVITY / METRES_PER_PX;

/**
 * Surface tension over density for water, m³/s², in px³/s².
 *
 * Irrelevant to the slosh (at n = 1 it is a hundredth of a percent of the restoring force) and the
 * whole of the ripple: at n = 24 across a 200px glass it is six times gravity's share. Without it a
 * tap's ripples crawl like long waves instead of shivering.
 */
export const CAPILLARITY = 7.28e-5;
export const CAPILLARITY_PX = CAPILLARITY / METRES_PER_PX ** 3;

/**
 * THE DRIVE'S GAIN. Screen motion reaches the water at this fraction of its honest strength.
 *
 * At 0.4 mm/px a hand dragging a tile 300 px in 450 ms accelerates it at 0.36 g, and at full
 * strength the bench's glass answered with a crest near the rim: true of a real cup moved 12 cm that
 * briskly, and far too much for a calm app. The owner: "Yes it is too strong for this app." So one
 * number scales the drive.
 *
 * MEASURED on the bench's glass (96×150 at 62%, the vessel the owner liked): at 0.5 a drag peaks at
 * 21% of the room above the water (17% as an 8 cm glass) and throws nothing, while a flick reaches
 * 85% and breaks up. `sloshBreakup.test.ts` pins the drag between 15% and 25%.
 *
 * A WIDE TILE IS NOT A GLASS. The same drag at the same strength peaks at 57% of the room in a
 * 200×90 tile and 78% in a 250×88 one, because a wide shallow vessel tips further for the same lean
 * — by its aspect ratio, which is physics, not a bug. MEASURED for the same 20% on the board's
 * tiles: about 0.10 for a 250×88 desktop small tile, 0.15 for 200×90 and for a 516×192 medium. That
 * choice belongs to whoever puts this on the board.
 *
 * CHOSEN (2026-11-25): the owner watched the bench and picked 0.5 together with `realScale` —
 * "8cm with 0.50 strength seems like a good balance". That pair is the decision for a glass; the
 * per-tile numbers above only matter if the water ever ships in wide tiles.
 */
export const DEFAULT_STRENGTH = 0.5;

/**
 * A REAL DRINKING GLASS, WHATEVER ITS SIZE ON SCREEN.
 *
 * At one scale for everything, the bench's 96 px glass is 3.8 cm across — a shot glass — and rocks
 * at 5 Hz, and a fast whole-body wobble is exactly what reads as jelly. `realScale` instead makes a
 * 96 px glass 8 cm across, and keeps a mild size dependence (`width^0.3`) so a large tile is a
 * somewhat larger glass and rocks somewhat slower: 250 px is 10.7 cm, 516 px is 13.2 cm.
 *
 * It changes how fast the glass rocks and nothing else: the drive is converted at the fixed
 * `METRES_PER_PX`, so a gesture leans the water the same amount at either scale.
 *
 * CHOSEN (2026-11-25) as the scale for every glass, with `DEFAULT_STRENGTH`. The model's own
 * default stays `METRES_PER_PX` so it remains a plain physical model; whatever creates a glass —
 * the bench's `real` row now, the board later — passes `metresPerPx: realScale(width)`.
 */
export const REAL_GLASS_M = 0.08;
export const REAL_REF_PX = 96;
export const REAL_SIZE_EXP = 0.3;

/** Metres per CSS px that make a vessel this wide read as a real drinking glass. */
export function realScale(widthPx: number): number {
  const w = Math.max(1, widthPx);
  return (REAL_GLASS_M * (w / REAL_REF_PX) ** REAL_SIZE_EXP) / w;
}

/** How many standing waves the surface is made of. Enough for a tap's ripple; see `tap`. */
export const MODE_COUNT = 24;

/** A fixed step, so the water does not change character with the frame rate. */
export const STEP_S = 1 / 60;

/** Past this many steps in one frame, give up catching up: the tab was in the background. */
const MAX_CATCH_UP_STEPS = 6;

/**
 * The fastest a mode is allowed to oscillate, rad/s: 20 Hz.
 *
 * Capillarity makes the top modes of a small glass ring at 40 Hz, which a 60 Hz screen cannot show:
 * sampled, a standing wave that fast aliases into a slow crawl going the wrong way. Clamped here,
 * the ripple shivers at the fastest rate a frame can draw, and it is gone in a third of a second.
 */
const OMEGA_MAX = 2 * Math.PI * 20;

/**
 * Damping, as a decay RATE (1/s) rather than a ratio, because what the brief fixes is a time.
 *
 * `σ_n = SIGMA_1 · (1 + SIGMA_GROWTH · (n - 1))`: the fundamental loses 63% of its swing in
 * 1/SIGMA_1 seconds and mode 24 in a fifteenth of that, so a fling (mostly mode 1) rocks for three
 * seconds and a tap (modes 6–24) shivers for a third of one. Real water in a real cup rocks for ten
 * seconds; this product is calm, so its water is a little more viscous than water.
 *
 * MEASURED against the settle target rather than chosen: see `slosh.test.ts`, which pins a fling at
 * the largest wave this bench produces as visually still (under a third of a pixel) inside 4 s.
 */
const SIGMA_1 = 1.3;
const SIGMA_GROWTH = 0.6;

/**
 * Extra damping for big waves, 1/s at the cap.
 *
 * A wave near the depth of its water breaks, and breaking is where a real slosh loses most of its
 * energy. Quadratic in the fraction of the cap in use, so ordinary motion never feels it and a
 * flung glass comes down from the cap quickly instead of ringing against it.
 */
const SIGMA_BREAK = 3.5;

/**
 * A WAVE IS NEVER TALLER THAN THE WATER IT IS MADE OF.
 *
 * The trough may come down at most this fraction of the depth, so it never reaches the floor and a
 * glass at 0% has a cap of zero — inert, which is the point: a goal at nothing has nothing to slosh.
 */
const DEPTH_CAP = 0.75;

/**
 * How far above the rim a crest may go, as a fraction of the glass. The rim holds the rest.
 *
 * Not zero, or a full glass could not move at all. Above the rim the drawing clips, so a full glass
 * shows its troughs and a flattened crest — which is what a brim-full glass that cannot spill does.
 */
const BRIM_ALLOW = 0.04;

/** How much of the room above the water a crest may use. */
const CREST_ROOM = 0.85;

/**
 * Below this the water is asleep: no mode can move the surface by more than this, in px.
 *
 * A twentieth of a pixel, so the moment it sleeps is invisible. Asleep, `advance` reports false and
 * a board nobody is touching draws nothing.
 */
const SLEEP_PX = 0.05;

/** An acceleration this small (px/s², a ten-thousandth of g) is measurement noise, not a drive. */
const DRIVE_QUIET = 1e-4 * G_PX;

/**
 * Crest sharpening, 0–1: how far each point of the surface is carried sideways with the water.
 *
 * Linear modes give sine crests, symmetric top and bottom, which is the look of a skipping rope.
 * Real water's crests are sharp and its troughs flat. The cheapest honest way to get that is the
 * Lagrangian one — draw each surface point where the water that was there has MOVED to, not just how
 * high it went. A standing mode's water moves sideways by `-a_n · sin(k_n x)`, which crowds the
 * points under a crest and spreads them along a trough. That is Gerstner's trick, and for a standing
 * wave it is just the linear solution drawn in the right coordinates.
 *
 * It costs volume — the crests narrow more than the troughs widen — by exactly `Q/2 · Σ k_n a_n²`
 * per unit width, which is the mean-level rise of second-order Stokes theory, and that is added
 * back. The drawn area therefore equals the level times the width; `liquidPaint.test.ts` pins it.
 */
const SHARPEN = 0.7;

/** The sharpening never folds the surface over: `1 - Q·Σ|a_n k_n|` is kept above this. */
const SHARPEN_FOLD = 0.45;

/** Only the first modes are sharpened: the slosh, not the chop. */
const SHARPEN_MODES = 6;

/**
 * Effective gravity never drops below this fraction of g in the mode equations.
 *
 * A glass yanked down faster than gravity leaves its water behind: in the water's own frame there
 * is no gravity at all, and every mode's restoring force goes to zero. The floor keeps the equations
 * well-posed while the water is in flight; the flight itself is `heave`, below.
 */
const G_FLOOR_FRACTION = 0.05;

/*
 * THE VERTICAL RESPONSE.
 *
 * Linear theory gives a flat surface nothing to do under vertical acceleration: `g_eff = g + a_y`
 * changes every ω_n, which is a parametric effect (it bends a slosh already running) and moves still
 * water not at all. The owner asked for two things that theory leaves out, and each has a cheap
 * physical answer.
 *
 *  1. YANKED DOWN, THE WATER STAYS BEHIND, THEN LANDS. If the glass accelerates downward faster than
 *     gravity, `g_eff` goes negative and nothing holds the water on the floor. It is then a body in
 *     flight inside the glass: one more degree of freedom, its height above the floor, ballistic
 *     until it comes down. The same happens at the END of a fast lift — the glass stops and the
 *     water carries on up. This is real; it is the only vertical effect a flat-bottomed glass of
 *     water actually has, and it is what the owner described.
 *
 *  2. WHAT LANDING DOES. Water arriving on a floor is stopped there and spreads outward along it, so
 *     it runs up the walls and leaves the middle low. The landing speed goes into the EVEN modes in
 *     that shape (wall-high, centre-low), which then rock as a symmetric slosh and settle.
 *
 *  3. PRESSED INTO THE BASE. Under 2 g the meniscus — the water standing up the wall — is held to
 *     less height, because its height goes as the capillary length, `sqrt(γ / ρ g)`. That is the one
 *     place in a glass where effective gravity changes the SHAPE of still water, and it is at the
 *     walls. So the even modes are driven toward a wall-localised target that follows
 *     `sqrt(g / g_eff) - 1`: lifted, the water at the walls is pressed down; released, it rebounds
 *     and rings. It is exaggerated (`PRESS_PX`) — the true meniscus at this scale is a pixel or two.
 */

/** How much of the landing speed comes back up the walls, as a surface velocity at the wall. */
const LAND_GAIN = 0.7;

/** The landing shape's reach from each wall, as a fraction of the width. */
const LAND_REACH = 0.22;

/** How far the wall water moves when effective gravity doubles or halves, in px. */
const PRESS_PX = 8;

/** The press shape's reach from each wall: the capillary length of water, 2.7 mm. */
const PRESS_REACH_M = 0.0027;

/** How much each mode's share of a landing is jittered, and how much of one wall leans it. */
const LAND_JITTER = 0.35;
const LAND_ASYMMETRY = 0.2;

/** How much of the press target the ratio of gravities may ask for, either way. */
const PRESS_RATIO_MAX = 1.6;

/*
 * POURING.
 *
 * Water arrives where the stream lands, as a bump the width of the stream, and the level rises
 * smoothly under it. The bump has had its mean taken out — which happens by itself, since it is
 * projected onto modes that integrate to zero — so it displaces water and does not make any: the
 * volume is the eased level, and the bump is that volume arriving in one place before it spreads.
 */

/** How long a pour takes: a base, plus more for more water, in seconds. */
const POUR_BASE_S = 0.35;
const POUR_PER_ROOT_S = 1.0;

/** The stream's width at the surface, as a fraction of the glass, and never under this many px. */
const POUR_WIDTH = 0.05;
const POUR_WIDTH_MIN_PX = 3;

/**
 * The stream's push, 1/s: how hard the falling water drives the surface down where it lands, per
 * px/s of level rise.
 *
 * The arriving VOLUME is deposited honestly, as a bump at the stream — but that alone is a mound
 * under a tap, which is not what a stream makes. A stream carries momentum and digs a dimple, and
 * that dimple and the ring it throws off are what read as pouring. Tuned against the bench so a pour
 * of a third of a glass rocks a tile by about 5 px, as the shipped pour did.
 */
const POUR_PLUNGE = 120;

/** A tap's ripple: how many modes it reaches into, and how narrow the knock is. */
const TAP_FROM_MODE = 5;
const TAP_WIDTH = 0.03;

/*
 * BUBBLES. A handful, only while pouring, area-coloured, gone in about a second. At rest the array is
 * empty and costs a length check.
 */
export const MAX_BUBBLES = 14;
/** Bubbles per second of pouring, at a pour of a third of a glass. */
const BUBBLE_RATE = 30;
/** Rise speed, px/s: about 4–8 cm/s at this scale, which is a bubble of half a millimetre. */
const BUBBLE_RISE_MIN = 100;
const BUBBLE_RISE_MAX = 200;
const BUBBLE_LIFE_S = 1.0;

/*
 * THE WALL FILM. Water that has been up a wall leaves a film that runs back down.
 *
 * Two numbers per wall: the highest the water has reached, and how long ago. The film clings for a
 * moment, then slides down accelerating to `FILM_SPEED`, and is gone when it meets the surface. It is
 * drawn, not counted: it is a few px wide and a fraction of a pixel thick, the same status as the
 * meniscus. It is also bounded — never more than the swing that left it.
 */
const FILM_HOLD_S = 0.18;
const FILM_ACCEL = 260;
const FILM_SPEED = 90;
/** Below this many px of film above the surface, there is no film. */
const FILM_MIN_PX = 0.6;

/*
 * BREAKUP. Three physical tests, each a threshold with a reason; `sloshCalibrate.test.ts` measures
 * what every gesture actually produces against each, and pins that a drag throws nothing.
 *
 * ONLY GRAVITY'S SHARE OF THE MOTION COUNTS. In a 3.8 cm glass every wave shorter than about 4 cm
 * is held more by surface tension than by gravity (the capillary length of water is 2.7 mm), and
 * surface tension is exactly what keeps water attached: capillary ripples stand far steeper than
 * the Stokes limit without breaking. Counting them in full, the approved pour's dimple — a ring of
 * short ripples — threw 71 droplets in the glass, and even once droplets had to clear the surface
 * to be thrown, it measured 1.66 times the Stokes limit and set the cascade off, changing the pour
 * the owner approved. Each mode's contribution to the acceleration and the slope is weighted by
 * `gk / (gk + (γ/ρ)k³)`, and the pour is untouched. `sloshBreakup.test.ts` pins both.
 */

/**
 * Detach where the surface, moving up, decelerates faster than gravity: the water on it cannot
 * follow and carries on as a droplet. In units of effective gravity, so exactly 1 — this is the
 * Faraday criterion, not a tuning knob.
 */
export const DETACH_G = 1;

/**
 * A crest steeper than this breaks: the slope of a sine wave at the Stokes limit, H/L = 1/7, which
 * is π/7 ≈ 0.45.
 */
export const BREAK_SLOPE = Math.PI / 7;

/**
 * Water arriving at a wall faster than this, m/s, runs up it as a sheet. MEASURED at the default
 * strength: a drag brings the wall water up at 0.09–0.11 m/s, a yank or lift at 0.09–0.21, a flick
 * at 0.44–0.67 and a shake at 0.36–0.73 — so the sheet belongs to the flick and the shake.
 */
export const RUNUP_M_S = 0.25;

/** Below this fraction of every threshold, nothing is sampled at all. */
const GATE = 0.7;

/** At most this many droplets thrown per step, at least this many samples apart. */
const SPAWN_PER_STEP = 2;
const SPAWN_SPACING = 4;

/** Droplet radius, CSS px. Small: they are a tile's droplets. */
const DROP_R_MIN = 1.3;
const DROP_R_MAX = 2.6;

/** A droplet that meets a wall runs down it, accelerating to this, px/s. */
const SLIDE_ACCEL = 300;
const SLIDE_SPEED = 70;

/** How much of a landing droplet's momentum knocks the surface, as a ring of ripples. */
const SPLASH_GAIN = 0.4;

/** A wall sheet: climbs at this multiple of the wall water's speed, sprays at this multiple of the
 * run-up threshold, feels this much wall drag on top of gravity, reaches at most this fraction of
 * the glass, and is this thick at its foot. */
const SHEET_GAIN = 1.4;
const SHEET_SPRAY = 1.6;
const SHEET_DRAG = 0.6;
const SHEET_MAX = 0.35;
export const SHEET_THICK_PX = 2.5;

/**
 * The cascade: above `CASCADE_ON` of a breakup threshold, energy leaves modes 1–4 at
 * `CASCADE_RATE` per second per unit of violence over it, and `CASCADE_KEEP` of it arrives in modes
 * 8–20, banded around mode 11 and jittered by `CASCADE_JITTER`. Keep is under 1, so total energy
 * only falls. First tried at 0.55 across 8–24 with no band: a sawtooth across the whole surface.
 */
const CASCADE_ON = 0.8;
const CASCADE_RATE = 4;
const CASCADE_KEEP = 0.35;
const CASCADE_LOW = 4;
const CASCADE_FROM = 8;
const CASCADE_TO = 20;
const CASCADE_JITTER = 0.4;
/** The chop's spectrum: centred on this mode, this many modes wide. A ripple, not white noise. */
const CASCADE_PEAK = 11;
const CASCADE_SPREAD = 3.5;

/** A droplet is only thrown if it would rise at least this many of its radii clear of the surface. */
const LAUNCH_RISE = 1.5;

/** A landing faster than this, m/s, splashes; it throws at most this many droplets. */
const LAND_SPRAY_M_S = 0.1;
const LAND_SPRAY_MAX = 8;

/**
 * How long after a pour breakup keeps standing aside, s. The stream's dimple is a ring of ripples
 * that, in the 8 cm glass, measures past the Stokes limit and would set the cascade off — changing
 * the pour the owner approved. The pour throws droplets only when `pourSpray` asks it to.
 */
const POUR_QUIET_S = 0.6;

/** Droplets a second from a pour's stream, when `pourSpray` is on. Off by default. */
const POUR_SPRAY_RATE = 8;

export interface SloshOptions {
  /** Width of the vessel at its rim, CSS px. */
  width: number;
  /** Height of the vessel, CSS px. */
  height: number;
  /**
   * Width of the floor over width of the rim, 1 for straight walls.
   *
   * A TAPERED GLASS IS APPROXIMATED BY THE RECTANGULAR TANK AS WIDE AS ITS WATERLINE. The true modes
   * of a trapezoidal section are not cosines, but for a taper of 10–15% the fundamental differs from
   * the waterline-width tank's by a few percent, which nobody can see and everybody can afford.
   */
  taper?: number;
  /** Seed for the bubbles, so a frozen bench frame is the same picture every time. */
  seed?: number;
  /**
   * How big the glass is, metres per CSS px, which sets how fast it rocks and nothing else. Default
   * `METRES_PER_PX`; `realScale(width)` makes any vessel a real drinking glass. See `realScale`.
   */
  metresPerPx?: number;
  /** The gain on the drive, see `DEFAULT_STRENGTH`. */
  strength?: number;
  /** Let the surface break up into droplets and wall sheets. Default on. */
  spray?: boolean;
  /** Let violent moments bleed the slosh into short chop. Default on; off only for tests. */
  cascade?: boolean;
  /**
   * Count only gravity's share of each wave towards breakup (default). Off is the first version,
   * kept so a test can show what it did to the approved pour.
   */
  capillaryHolds?: boolean;
  /** Throw a few droplets where a pour's stream lands. Default OFF: the pour is approved as it is. */
  pourSpray?: boolean;
  /** Whose droplet budget to draw from. Default the one every glass shares. */
  budget?: DropletBudget;
}

/** The surface for one frame, in px. Reused between calls: read it and draw, never keep it. */
export interface SurfaceFrame {
  /** Samples across the waterline: `x` from its left end, `h` above the floor. Heave NOT included. */
  readonly xs: Float64Array;
  readonly hs: Float64Array;
  readonly count: number;
  /** Width of the waterline, px. */
  readonly waterline: number;
  /**
   * Depth of the BODY, px: the level times the height, less whatever is in the air or up a wall.
   * The water that left is the water that is not here.
   */
  readonly depth: number;
  /** The level times the height, px: the goal's number, droplets and all. */
  readonly level: number;
  /** How far the whole body has lifted off the floor, px. */
  readonly heave: number;
}

/** One wall's sheet: a tongue of water thrown up the wall by a slosh that hit it hard. */
export interface Sheet {
  /** Tip of the tongue and the surface at its foot, px above the floor. 0 length: no sheet. */
  readonly tip: number;
  readonly foot: number;
  /** Thickness at the foot, px. */
  readonly thick: number;
}

export class Slosh {
  private width: number;
  private height: number;
  private readonly taper: number;

  /** This glass's own scale, and gravity, capillarity and the capillary length in its px. */
  private readonly gPx: number;
  private readonly capPx: number;
  private readonly pressReachPx: number;
  private readonly gFloor: number;
  private strengthValue: number;

  /** Mode amplitudes (px) and their rates (px/s), index `i` is mode `n = i + 1`. */
  private readonly a = new Float64Array(MODE_COUNT);
  private readonly v = new Float64Array(MODE_COUNT);
  /** Where each mode was being driven to last step, px: the static tilt and the press. */
  private readonly goal = new Float64Array(MODE_COUNT);

  /** The exact one-step propagator for each mode, rebuilt only when ω or σ change. */
  private readonly omega = new Float64Array(MODE_COUNT);
  private readonly sigma = new Float64Array(MODE_COUNT);
  /**
   * The share of each mode's restoring force that is gravity rather than surface tension, 0–1.
   * Only that share can throw water off the surface or break a crest: see `breakup`.
   */
  private readonly gravityShare = new Float64Array(MODE_COUNT);
  private readonly p11 = new Float64Array(MODE_COUNT);
  private readonly p12 = new Float64Array(MODE_COUNT);
  private readonly p21 = new Float64Array(MODE_COUNT);
  private readonly p22 = new Float64Array(MODE_COUNT);
  private builtW = -1;
  private builtH = -1;
  private builtG = -1;

  /** Unit shapes, projected once per waterline width. */
  private readonly landShape = new Float64Array(MODE_COUNT);
  private readonly landTilt = new Float64Array(MODE_COUNT);
  private readonly pressShape = new Float64Array(MODE_COUNT);
  private shapesFor = -1;

  /** Surface sampling: cos/sin of every mode at every sample, built once per sample count. */
  private samples = 0;
  private cosTable = new Float64Array(0);
  private sinTable = new Float64Array(0);
  private readonly frame: {
    xs: Float64Array;
    hs: Float64Array;
    count: number;
    waterline: number;
    depth: number;
    level: number;
    heave: number;
  } = {
    xs: new Float64Array(0),
    hs: new Float64Array(0),
    count: 0,
    waterline: 0,
    depth: 0,
    level: 0,
    heave: 0,
  };

  /** The level as a fraction of the height, as drawn right now (eased during a pour). */
  private levelNow = 0;
  private target = 0;
  private pourFrom = 0;
  private pourT = 0;
  private pourDuration = 0;
  private pourAt = 0.5;
  private pouring = false;

  /** The glass's own acceleration, px/s² IN THIS GLASS'S UNITS, x right and y UP, after `strength`. */
  private ax = 0;
  private ay = 0;
  /** Effective gravity the modes saw last step, px/s². Read by the bench and the tests. */
  private gEff: number;

  /** The body's lift off the floor (px) and its rate (px/s). Zero unless the water is in flight. */
  private z = 0;
  private vz = 0;
  /** The fastest the water has hit the floor since construction, px/s. For the tests. */
  landedAt = 0;

  /** Film top above the floor per wall (px), and how long it has been draining. */
  private readonly filmTop = new Float64Array(2);
  private readonly filmAge = new Float64Array(2);

  /** Bubbles, struct-of-arrays: x as a fraction of the waterline, depth below the surface in px. */
  private readonly bx = new Float64Array(MAX_BUBBLES);
  private readonly by = new Float64Array(MAX_BUBBLES);
  private readonly br = new Float64Array(MAX_BUBBLES);
  private readonly bv = new Float64Array(MAX_BUBBLES);
  private readonly bage = new Float64Array(MAX_BUBBLES);
  private readonly bphase = new Float64Array(MAX_BUBBLES);
  bubbles = 0;
  private bubbleDebt = 0;
  private seed: number;

  /** Breakup: on or off, the droplets, the two wall sheets, and a second random stream for them. */
  private readonly spray: boolean;
  private readonly cascadeOn: boolean;
  private readonly capillaryHolds: boolean;
  private readonly pourSpray: boolean;
  readonly droplets: Droplets;
  private readonly sheetTip = new Float64Array(2);
  private readonly sheetV = new Float64Array(2);
  private readonly sheetFoot = new Float64Array(2);
  private readonly sheetSpray = new Float64Array(2);
  private sheetArea = 0;
  private spraySeed: number;
  private pourSprayDebt = 0;
  private pourQuiet = 0;

  /** The surface at the samples this step: height, rate, acceleration, slope, sideways speed. */
  private etaS = new Float64Array(0);
  private etaT = new Float64Array(0);
  private etaTT = new Float64Array(0);
  private slopeS = new Float64Array(0);
  private flowS = new Float64Array(0);
  private sampled = false;

  /** How violent the surface was last step, as a fraction of the nearest breakup threshold. */
  violence = 0;
  /**
   * The three breakup measures last step, each as a fraction of its threshold: the surface's fall
   * against gravity, the steepest crest against the Stokes limit, the fastest wall run-up against
   * `RUNUP_M_S`. Upper bounds when the surface was calm enough not to be sampled. For calibration.
   */
  readonly measures = { fall: 0, steep: 0, runup: 0 };
  /** Steps on which the surface was sampled for breakup. At rest this does not move. */
  sampledSteps = 0;
  /** Steps taken in all. Asleep, `advance` takes none. The tests count work with these, not time. */
  steps = 0;
  /** Energy moved from the slosh into chop so far, and the share of it that arrived. For tests. */
  cascaded = 0;

  private carryS = 0;
  private sleeping = true;

  constructor(options: SloshOptions) {
    this.width = Math.max(1, options.width);
    this.height = Math.max(1, options.height);
    this.taper = Math.min(1, Math.max(0.3, options.taper ?? 1));
    this.seed = (options.seed ?? 0x5eed) >>> 0;
    this.spraySeed = (this.seed ^ 0x9e3779b9) >>> 0;
    const mpp = options.metresPerPx ?? METRES_PER_PX;
    this.gPx = GRAVITY / mpp;
    this.capPx = CAPILLARITY / mpp ** 3;
    this.pressReachPx = PRESS_REACH_M / mpp;
    this.gFloor = G_FLOOR_FRACTION * this.gPx;
    this.gEff = this.gPx;
    this.strengthValue = Math.max(0, options.strength ?? DEFAULT_STRENGTH);
    this.spray = options.spray ?? true;
    this.cascadeOn = options.cascade ?? true;
    this.capillaryHolds = options.capillaryHolds ?? true;
    this.pourSpray = options.pourSpray ?? false;
    this.droplets = new Droplets(options.budget ?? sharedBudget);
    this.buildTables();
  }

  /** The level the surface returns to, 0 (empty) to 1 (brim): the goal's number. */
  get level(): number {
    return this.target;
  }

  /** The level as drawn this instant: the goal's number, or on its way there during a pour. */
  get drawnLevel(): number {
    return this.levelNow;
  }

  /** Is the water still, with nothing left to draw differently next frame? */
  get asleep(): boolean {
    return this.sleeping;
  }

  /** How far the body has lifted off the floor, px. */
  get heave(): number {
    return this.z;
  }

  /** The effective gravity the water felt last step, in g. */
  get gravity(): number {
    return this.gEff / this.gPx;
  }

  /** The gain on the drive. The bench has a slider on it. */
  get strength(): number {
    return this.strengthValue;
  }

  set strength(value: number) {
    this.strengthValue = Math.max(0, Number.isFinite(value) ? value : DEFAULT_STRENGTH);
  }

  /**
   * Water that is not in the body right now, px²: the droplets and the wall sheets. The body is
   * the level less this, so body plus this is the level, always.
   */
  get aside(): number {
    return this.droplets.area() + this.sheetArea;
  }

  /** Match a new box. Amplitudes are kept, so a tile resized mid-slosh carries on. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.buildTables();
    this.builtW = -1;
  }

  /** Width of the waterline at a level, px. Straight walls: the width. */
  waterlineAt(level: number): number {
    return this.width * (this.taper + (1 - this.taper) * Math.min(1, Math.max(0, level)));
  }

  /**
   * Move the level, and let the water notice.
   *
   * `disturb` is off for a glass that simply IS this full when the board loads: performing a pour
   * nobody caused would tell somebody something happened when nothing did. `at` is where the stream
   * lands, 0–1 across the glass. Off centre by default, so the pour rocks the glass as well as
   * dimpling it — a stream down the exact middle excites only the even modes.
   */
  setLevel(next: number, disturb = true, at = 0.32): void {
    const clamped = Math.min(1, Math.max(0, next));
    if (!disturb) {
      this.target = clamped;
      this.levelNow = clamped;
      this.pouring = false;
      this.sleeping = false;
      return;
    }
    if (clamped === this.target) return;
    const change = Math.abs(clamped - this.levelNow);
    this.target = clamped;
    this.pourFrom = this.levelNow;
    this.pourT = 0;
    this.pourDuration = POUR_BASE_S + POUR_PER_ROOT_S * Math.sqrt(change);
    this.pourAt = Math.min(0.9, Math.max(0.1, at));
    this.pouring = true;
    this.sleeping = false;
  }

  /**
   * The glass's acceleration, in SCREEN px/s², x to the right and y UP. Held until the next call.
   *
   * Converted to g through the drive scale (`METRES_PER_PX`, the same for every glass) and the
   * strength, then into this glass's own units. So `strength` decides how hard a gesture pushes, and
   * the glass's scale decides only how fast it then rocks — the two are separate on purpose.
   */
  drive(ax: number, ay: number): void {
    const toGlass = (this.strengthValue * METRES_PER_PX * this.gPx) / GRAVITY;
    const x = Number.isFinite(ax) ? ax : 0;
    const y = Number.isFinite(ay) ? ay : 0;
    this.ax = x * toGlass;
    this.ay = y * toGlass;
    if (
      Math.abs(x) * this.strengthValue > DRIVE_QUIET ||
      Math.abs(y) * this.strengthValue > DRIVE_QUIET
    )
      this.sleeping = false;
  }

  /**
   * A knock on the glass at `at` (0–1 across): a ripple in the high modes, gone in a third of a
   * second. `strength` is the surface speed at the knock, px/s.
   */
  tap(at: number, strength = 60): void {
    const W = this.waterlineAt(this.levelNow);
    const s = Math.max(1.5, TAP_WIDTH * W);
    const x0 = Math.min(1, Math.max(0, at)) * W;
    const scale = this.depthScale();
    // `gaussianMode` is a bump of unit VOLUME; times `s·√(2π)` it is a bump of unit HEIGHT.
    const peak = strength * scale * s * Math.sqrt(2 * Math.PI);
    for (let i = TAP_FROM_MODE - 1; i < MODE_COUNT; i += 1) {
      const k = ((i + 1) * Math.PI) / W;
      this.v[i] = (this.v[i] ?? 0) - peak * gaussianMode(k, x0, s, W);
    }
    this.sleeping = false;
  }

  /** Put the water flat at its level with nothing moving, and nothing in the air. */
  still(): void {
    this.a.fill(0);
    this.v.fill(0);
    this.z = 0;
    this.vz = 0;
    this.filmTop.fill(0);
    this.bubbles = 0;
    this.droplets.release();
    this.sheetTip.fill(0);
    this.sheetV.fill(0);
    this.sheetArea = 0;
    this.levelNow = this.target;
    this.pouring = false;
    this.carryS = 0;
    this.sleeping = true;
  }

  /** The glass is going away: give its droplets back to the shared budget. */
  dispose(): void {
    this.droplets.release();
  }

  /**
   * Advance by however long really passed, in fixed steps. Returns whether anything is still moving,
   * so the caller can stop drawing a glass that has gone quiet.
   */
  advance(elapsedMs: number): boolean {
    if (this.sleeping) return false;
    this.carryS += Math.max(0, elapsedMs) / 1000;
    let steps = Math.floor(this.carryS / STEP_S + 1e-9);
    this.carryS -= steps * STEP_S;
    if (steps > MAX_CATCH_UP_STEPS) {
      steps = MAX_CATCH_UP_STEPS;
      this.carryS = 0;
    }
    for (let i = 0; i < steps; i += 1) this.step(STEP_S);
    return !this.sleeping;
  }

  /** One fixed step. Public for the tests and the bench, which replay a gesture step by step. */
  step(dt: number): void {
    this.steps += 1;
    this.stepPour(dt);

    const W = this.waterlineAt(this.levelNow);
    // The body is the level less what is in the air: that is the whole of volume conservation.
    const h = this.levelNow * this.height - (W > 0 ? this.aside / W : 0);
    if (this.shapesFor !== W) this.buildShapes(W);

    this.stepHeave(dt, h, W);

    // Effective gravity for the waves: what the floor pushes the water with. In flight there is
    // none, and the floor keeps the equations defined.
    const gRaw = this.gPx + this.ay;
    const gModes = this.z > 0 ? this.gFloor : Math.max(this.gFloor, gRaw);
    this.gEff = gModes;

    // The depth moves by a hair every time a droplet leaves or lands; a quarter of a pixel changes
    // no frequency anyone could see, and rebuilding 24 propagators each step for it was most of the
    // cost of a breaking glass.
    // Only the droplets' share is rounded: a pour's rising level must stay exact, or the approved
    // pour changes.
    const away = W > 0 ? Math.round((this.aside / W) * 4) / 4 : 0;
    this.buildPropagator(W, this.levelNow * this.height - away, gModes);

    // Sideways: the tilted plane `(a_x / g)(W/2 - x)`, projected. Accelerating RIGHT piles the water
    // against the LEFT wall, where x = 0 and every cosine is +1.
    const tilt = this.ax / gModes;
    // Pressed: the meniscus's height goes as sqrt(g / g_eff). Clamped either way.
    const ratio = Math.min(
      PRESS_RATIO_MAX,
      Math.max(1 / PRESS_RATIO_MAX, Math.sqrt(this.gPx / gModes)),
    );
    const press = PRESS_PX * (ratio - 1) * this.depthScale();

    for (let i = 0; i < MODE_COUNT; i += 1) {
      const n = i + 1;
      const c = n % 2 === 1 ? (4 * W) / (n * n * Math.PI * Math.PI) : 0;
      const goal = c * tilt + press * (this.pressShape[i] ?? 0);
      this.goal[i] = goal;
      const e = (this.a[i] ?? 0) - goal;
      const v = this.v[i] ?? 0;
      this.a[i] = goal + (this.p11[i] ?? 0) * e + (this.p12[i] ?? 0) * v;
      this.v[i] = (this.p21[i] ?? 0) * e + (this.p22[i] ?? 0) * v;
    }

    this.sampled = false;
    // A pour is approved as it is: breakup stands aside while one runs and while its ring settles.
    if (this.pouring) this.pourQuiet = POUR_QUIET_S;
    else this.pourQuiet = Math.max(0, this.pourQuiet - dt);
    if ((this.spray || this.cascadeOn) && this.pourQuiet <= 0) this.breakup(dt, h, W, gModes);
    if (this.droplets.count > 0) this.stepDroplets(dt, h, W);
    // The cap runs last, over everything this step did — the hollow a droplet leaves and the bump
    // one lands as included — against the body the water in the air has left behind.
    this.limit(this.bodyDepth(), dt);
    this.stepFilm(dt, h, W);
    this.stepBubbles(dt, h);

    if (this.canSleep()) {
      this.a.fill(0);
      this.v.fill(0);
      this.filmTop.fill(0);
      this.sheetArea = 0;
      this.sleeping = true;
    }
  }

  /**
   * The surface as drawn, into a shared frame.
   *
   * Each sample is a piece of the surface carried sideways by the waves (see `SHARPEN`) and lifted
   * by the second-order mean that pays for it. `xs` run from 0 to the waterline width; `hs` are
   * heights above the floor in px, without the heave, which the painter applies as a translation.
   */
  surface(): SurfaceFrame {
    const frame = this.frame;
    const count = this.samples;
    const W = this.waterlineAt(this.levelNow);
    const level = this.levelNow * this.height;
    const h = level - (W > 0 ? this.aside / W : 0);
    frame.count = count;
    frame.waterline = W;
    frame.depth = h;
    frame.level = level;
    frame.heave = this.z;

    // Which modes are worth summing. Most of the time it is the first three. Only the long waves
    // are sharpened: drawn the same way, the cascade's short chop came out as a sawtooth.
    let steep = 0;
    let lift = 0;
    let top = -1;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const a = this.a[i] ?? 0;
      if (Math.abs(a) < 1e-4) continue;
      top = i;
      if (i >= SHARPEN_MODES) continue;
      const k = ((i + 1) * Math.PI) / W;
      steep += Math.abs(a * k);
      lift += k * a * a;
    }
    const q = steep > 0 ? Math.min(SHARPEN, (1 - SHARPEN_FOLD) / steep) : 0;
    const rise = 0.5 * q * lift;

    const { xs, hs } = frame;
    const { cosTable, sinTable } = this;
    for (let j = 0; j < count; j += 1) {
      const x0 = (j / (count - 1)) * W;
      let eta = 0;
      let drift = 0;
      for (let i = 0; i <= top; i += 1) {
        const a = this.a[i] ?? 0;
        if (a === 0) continue;
        eta += a * (cosTable[i * count + j] ?? 0);
        if (i < SHARPEN_MODES) drift += a * (sinTable[i * count + j] ?? 0);
      }
      xs[j] = x0 - q * drift;
      hs[j] = h + rise + eta;
    }
    return frame;
  }

  /** The body's surface height at a fraction across, px above the floor, unsharpened. For tests. */
  heightAt(at: number): number {
    const W = this.waterlineAt(this.levelNow);
    const x = Math.min(1, Math.max(0, at)) * W;
    let eta = 0;
    for (let i = 0; i < MODE_COUNT; i += 1)
      eta += (this.a[i] ?? 0) * Math.cos(((i + 1) * Math.PI * x) / W);
    return this.bodyDepth() + eta;
  }

  /** The film on each wall: how far above the surface it reaches (px) and how strong it is, 0–1. */
  film(side: 0 | 1): { above: number; strength: number } {
    const top = this.filmTop[side] ?? 0;
    const wall = this.wallHeight(side);
    const above = top - wall;
    if (above < FILM_MIN_PX) return { above: 0, strength: 0 };
    const age = this.filmAge[side] ?? 0;
    return { above, strength: Math.max(0, 1 - age / 1.6) };
  }

  /** The sheet on one wall, or a zero-length one. */
  sheet(side: 0 | 1): Sheet {
    const tip = this.sheetTip[side] ?? 0;
    const foot = this.sheetFoot[side] ?? 0;
    return { tip: Math.max(tip, foot), foot, thick: SHEET_THICK_PX };
  }

  /** Bubble `i`: x in px across the waterline, depth below the resting surface in px, radius. */
  bubble(i: number): { x: number; depth: number; r: number } {
    const W = this.waterlineAt(this.levelNow);
    const wobble = Math.sin(this.bphase[i] ?? 0) * 1.2;
    return { x: (this.bx[i] ?? 0) * W + wobble, depth: this.by[i] ?? 0, r: this.br[i] ?? 1 };
  }

  /** Natural frequency of mode `n` right now, rad/s. */
  omegaOf(n: number): number {
    return this.omega[n - 1] ?? 0;
  }

  /** Mode amplitude, px. For the tests. */
  mode(n: number): number {
    return this.a[n - 1] ?? 0;
  }

  /**
   * The largest the surface could get from what is already in it, px: every mode at the top of its
   * swing at once. An upper bound, and what sleep and the tests are judged against.
   */
  reach(): number {
    let total = 0;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const w = this.omega[i] ?? 0;
      const a = this.a[i] ?? 0;
      const v = this.v[i] ?? 0;
      total += w > 0 ? Math.sqrt(a * a + (v / w) ** 2) : Math.abs(a);
    }
    return total;
  }

  /** Energy in the waves, in arbitrary but consistent units. For the tests. */
  energy(): number {
    let total = 0;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const w = this.omega[i] ?? 0;
      const a = this.a[i] ?? 0;
      const v = this.v[i] ?? 0;
      total += 0.5 * (v * v + w * w * a * a);
    }
    return total;
  }

  /** Energy in modes `from..to` (1-based, inclusive). For the tests of the cascade. */
  energyIn(from: number, to: number): number {
    let total = 0;
    for (let i = from - 1; i < Math.min(MODE_COUNT, to); i += 1) {
      const w = this.omega[i] ?? 0;
      const a = this.a[i] ?? 0;
      const v = this.v[i] ?? 0;
      total += 0.5 * (v * v + w * w * a * a);
    }
    return total;
  }

  // ------------------------------------------------------------------------------------------------

  private bodyDepth(): number {
    const W = this.waterlineAt(this.levelNow);
    return this.levelNow * this.height - (W > 0 ? this.aside / W : 0);
  }

  private stepPour(dt: number): void {
    if (!this.pouring) {
      this.levelNow = this.target;
      return;
    }
    const before = this.levelNow;
    this.pourT += dt;
    const u = Math.min(1, this.pourT / this.pourDuration);
    this.levelNow = this.pourFrom + (this.target - this.pourFrom) * ease(u);
    if (u >= 1) this.pouring = false;

    const rate = ((this.levelNow - before) * this.height) / dt;
    if (rate === 0) return;

    // The arriving water, as a bump where the stream lands. A fall drains from the same place.
    const W = this.waterlineAt(this.levelNow);
    const s = Math.max(POUR_WIDTH_MIN_PX, POUR_WIDTH * W);
    const x0 = this.pourAt * W;
    const scale = this.depthScale();
    // `rate * W * dt` is the volume arriving this step; the Gaussian puts it at the stream. The
    // push is a surface speed at the stream, so it is the unit-height Gaussian, `s·√(2π)` times.
    const deposit = rate * W * dt * scale;
    const push = POUR_PLUNGE * rate * dt * scale * s * Math.sqrt(2 * Math.PI);
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const k = ((i + 1) * Math.PI) / W;
      const g = gaussianMode(k, x0, s, W);
      this.a[i] = (this.a[i] ?? 0) + deposit * g;
      this.v[i] = (this.v[i] ?? 0) - push * g;
    }

    // Air carried down by the stream.
    if (rate > 0) {
      const amount = Math.abs(this.target - this.pourFrom);
      this.bubbleDebt += BUBBLE_RATE * Math.min(1, amount * 3) * dt;
      while (this.bubbleDebt >= 1) {
        this.bubbleDebt -= 1;
        this.spawnBubble(x0 / W);
      }
      // Off unless asked for: a crown of droplets where the stream lands.
      if (this.pourSpray && this.spray) {
        this.pourSprayDebt += POUR_SPRAY_RATE * Math.min(1, amount * 3) * dt;
        while (this.pourSprayDebt >= 1) {
          this.pourSprayDebt -= 1;
          this.throwFromStream(x0, W);
        }
      }
    }
  }

  private spawnBubble(at: number): void {
    if (this.bubbles >= MAX_BUBBLES) return;
    const depth = this.levelNow * this.height;
    if (depth < 6) return;
    const i = this.bubbles;
    this.bubbles += 1;
    this.bx[i] = Math.min(0.95, Math.max(0.05, at + (this.random() - 0.5) * 0.12));
    this.by[i] = Math.min(depth - 2, 3 + this.random() * depth * 0.55);
    this.br[i] = 1 + this.random() * 1.4;
    this.bv[i] = BUBBLE_RISE_MIN + this.random() * (BUBBLE_RISE_MAX - BUBBLE_RISE_MIN);
    this.bage[i] = 0;
    this.bphase[i] = this.random() * Math.PI * 2;
  }

  private stepBubbles(dt: number, h: number): void {
    let i = 0;
    while (i < this.bubbles) {
      this.by[i] = (this.by[i] ?? 0) - (this.bv[i] ?? 0) * dt;
      this.bage[i] = (this.bage[i] ?? 0) + dt;
      this.bphase[i] = (this.bphase[i] ?? 0) + dt * 14;
      const gone =
        (this.by[i] ?? 0) <= (this.br[i] ?? 0) || (this.bage[i] ?? 0) > BUBBLE_LIFE_S || h < 4;
      if (gone) {
        // Swap-remove: order does not matter and nothing is allocated.
        const last = this.bubbles - 1;
        this.bx[i] = this.bx[last] ?? 0;
        this.by[i] = this.by[last] ?? 0;
        this.br[i] = this.br[last] ?? 0;
        this.bv[i] = this.bv[last] ?? 0;
        this.bage[i] = this.bage[last] ?? 0;
        this.bphase[i] = this.bphase[last] ?? 0;
        this.bubbles = last;
      } else {
        i += 1;
      }
    }
  }

  /** The body in flight: lifts off when nothing holds it down, lands, and the landing runs up the walls. */
  private stepHeave(dt: number, h: number, W: number): void {
    if (h <= 0) {
      this.z = 0;
      this.vz = 0;
      return;
    }
    const gRaw = this.gPx + this.ay;
    if (this.z <= 0 && gRaw >= 0) {
      this.z = 0;
      this.vz = 0;
      return;
    }
    this.vz -= gRaw * dt;
    this.z += this.vz * dt;

    // It cannot leave the glass.
    const room = Math.max(0, this.height - h);
    if (this.z > room) {
      this.z = room;
      this.vz = Math.min(0, this.vz);
    }

    if (this.z <= 0) {
      const speed = Math.max(0, -this.vz);
      this.z = 0;
      this.vz = 0;
      this.landedAt = Math.max(this.landedAt, speed);
      const kick = LAND_GAIN * speed * this.depthScale();
      /*
       * A real slam is never symmetric to the pixel. With every even mode in exact phase, the two
       * wall run-ups met in the middle 130 ms later as one perfect cusp — the spike the owner saw.
       * Each mode's share is jittered and a little of one wall's shape is added, so the run-ups
       * arrive out of step and the middle is a jumble rather than a needle. The jitter is seeded.
       */
      const lean = (this.sprayRandom() - 0.5) * 2 * LAND_ASYMMETRY;
      for (let i = 0; i < MODE_COUNT; i += 1) {
        const jitter = 1 + (this.sprayRandom() - 0.5) * 2 * LAND_JITTER;
        const share = (this.landShape[i] ?? 0) * jitter + lean * (this.landTilt[i] ?? 0);
        this.v[i] = (this.v[i] ?? 0) + kick * share;
      }
      if (this.spray) this.slam(speed, h, W);
    }
  }

  /**
   * A HARD LANDING SPLASHES. Water arriving on a floor faster than `LAND_SPRAY_M_S` is thrown up
   * where it meets resistance: jets up both walls, which also launch the wall sheets, and a little
   * from the middle where the two run-ups will meet. The middle is then knocked into chop by the
   * cascade, so what arrives there 130 ms later is a jumble, not a needle.
   */
  private slam(speed: number, h: number, W: number): void {
    const threshold = LAND_SPRAY_M_S * (this.gPx / GRAVITY);
    if (speed < threshold || h < 6) return;
    const inset = (this.width - W) / 2;
    const count = Math.min(LAND_SPRAY_MAX, 2 + Math.floor((speed / threshold) * 1.5));
    for (let k = 0; k < count; k += 1) {
      const where = k % 3;
      if (where === 2) {
        const x = inset + W * (0.5 + (this.sprayRandom() - 0.5) * 0.2);
        this.throwDroplet(x, h + this.z, (this.sprayRandom() - 0.5) * 80, speed * 0.8, W, h);
      } else {
        const left = where === 0;
        const x = left ? inset + 2.5 : inset + W - 2.5;
        const across = (left ? 1 : -1) * (20 + 60 * this.sprayRandom());
        const up = speed * (1.1 + 0.6 * this.sprayRandom());
        this.throwDroplet(x, h + this.z, across, up, W, h);
      }
    }
    for (let side = 0; side < 2; side += 1) {
      const foot = h + this.z;
      this.sheetFoot[side] = foot;
      this.sheetTip[side] = foot + 0.5;
      this.sheetV[side] = SHEET_GAIN * speed;
      this.sheetSpray[side] = 0;
    }
    this.cascade(STEP_S, CASCADE_ON + 1.5, W * (0.5 + (this.sprayRandom() - 0.5) * 0.15), W);
  }

  /** Keep every wave inside the water it is made of, and let big ones break. */
  private limit(h: number, dt: number): void {
    const trough = DEPTH_CAP * h;
    // Crests stay under the rim, where the drawing would clip them flat. A brim-full glass keeps a
    // sliver of motion, and shows its troughs.
    const crest = Math.max(CREST_ROOM * (this.height - h) - 1.5, BRIM_ALLOW * this.height);
    const cap = Math.min(trough, crest);

    if (cap <= 0) {
      this.a.fill(0);
      this.v.fill(0);
      return;
    }

    let bound = 0;
    for (let i = 0; i < MODE_COUNT; i += 1) bound += Math.abs(this.a[i] ?? 0);

    // Breaking: big waves lose energy fast. Quadratic, so ordinary motion never feels it.
    const use = Math.min(1, bound / cap);
    if (use > 0.2) {
      const keep = Math.exp(-SIGMA_BREAK * use * use * dt);
      for (let i = 0; i < MODE_COUNT; i += 1) {
        this.a[i] = (this.a[i] ?? 0) * keep;
        this.v[i] = (this.v[i] ?? 0) * keep;
      }
    }

    if (bound <= Math.min(trough, crest)) return;

    // The bound is pessimistic; check the real surface before scaling anything. Through a table
    // shared by every glass, because under a shake this runs every step on every tile on the board.
    const table = probeTable();
    let high = 0;
    let low = 0;
    for (let j = 0; j <= PROBES; j += 1) {
      let eta = 0;
      for (let i = 0; i < MODE_COUNT; i += 1) {
        const a = this.a[i] ?? 0;
        if (a !== 0) eta += a * (table[i * (PROBES + 1) + j] ?? 0);
      }
      if (eta > high) high = eta;
      if (eta < low) low = eta;
    }
    // A hair under the cap, so what the probes missed between them still lands inside it.
    const scale = Math.min(
      1,
      high > crest ? (0.98 * crest) / high : 1,
      -low > trough ? (0.98 * trough) / -low : 1,
    );
    if (scale >= 1) return;
    // Scaling every mode by one number keeps every mode's zero mean: this cannot touch the volume.
    for (let i = 0; i < MODE_COUNT; i += 1) {
      this.a[i] = (this.a[i] ?? 0) * scale;
      this.v[i] = (this.v[i] ?? 0) * scale;
    }
  }

  /*
   * BREAKUP ---------------------------------------------------------------------------------------
   *
   * Each step, a cheap bound decides whether the surface could possibly be doing anything violent.
   * Almost always it cannot, and this costs a sum of 24 numbers. When it might, the surface is
   * sampled — height, rate, acceleration, slope and the sideways speed of the water at the top —
   * and three physical tests run at every sample.
   */
  private breakup(dt: number, h: number, W: number, gModes: number): void {
    // Upper bounds on what any sample could show, from the modes alone.
    let accel = 0;
    let slope = 0;
    let speed = 0;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const a = this.a[i] ?? 0;
      const v = this.v[i] ?? 0;
      const w = this.omega[i] ?? 0;
      const share = this.gravityShare[i] ?? 1;
      accel += share * Math.abs(-2 * (this.sigma[i] ?? 0) * v - w * w * (a - (this.goal[i] ?? 0)));
      slope += share * Math.abs((a * (i + 1) * Math.PI) / W);
      speed += Math.abs(v);
    }
    const runup = RUNUP_M_S * (this.gPx / GRAVITY);
    const sheets = (this.sheetTip[0] ?? 0) > 0 || (this.sheetTip[1] ?? 0) > 0;
    const calm =
      accel < GATE * DETACH_G * gModes && slope < GATE * BREAK_SLOPE && speed < GATE * runup;
    if (calm && !sheets) {
      this.measures.fall = accel / (DETACH_G * gModes);
      this.measures.steep = slope / BREAK_SLOPE;
      this.measures.runup = speed / runup;
      this.violence = Math.max(this.measures.fall, this.measures.steep, this.measures.runup);
      return;
    }

    this.sampleSurface(h, W);
    this.sampledSteps += 1;
    let fallMax = 0;
    let steepMax = 0;
    const count = this.samples;
    const inset = (this.width - W) / 2;

    // The three tests, as fractions of their thresholds; the most violent sample wins.
    let worst = 0;
    let worstAt = 0;
    let budgetLeft = SPAWN_PER_STEP;
    let lastSpawn = -10;
    for (let j = 0; j < count; j += 1) {
      const rate = this.etaT[j] ?? 0;
      const fall = -(this.etaTT[j] ?? 0) / (DETACH_G * gModes);
      const steep = Math.abs(this.slopeS[j] ?? 0) / BREAK_SLOPE;
      const detach = rate > 0 ? fall : 0;
      const v = Math.max(detach, steep);
      fallMax = Math.max(fallMax, detach);
      steepMax = Math.max(steepMax, steep);
      if (v > worst) {
        worst = v;
        worstAt = j;
      }
      // Detach where the surface falls away faster than gravity can hold the water on it, or where
      // the crest is past the steepest a wave can stand. Spaced, so one crest is not a fountain.
      if (this.spray && budgetLeft > 0 && v >= 1 && j - lastSpawn > SPAWN_SPACING) {
        const crest = steep >= 1 && detach < 1 ? this.crestNear(j) : j;
        const xc = (crest / (count - 1)) * W;
        const vx =
          (this.flowS[crest] ?? 0) * 0.8 +
          (steep >= 1 ? Math.sign(-(this.slopeS[j] ?? 0)) * 0.25 * Math.sqrt(gModes * h) : 0);
        const vy = Math.max(rate, this.etaT[crest] ?? 0, 0.15 * Math.sqrt(gModes * Math.max(1, h)));
        if (this.throwDroplet(inset + xc, h + (this.etaS[crest] ?? 0) + this.z, vx, vy, W, h))
          budgetLeft -= 1;
        lastSpawn = j;
      }
    }

    // The walls: water arriving fast throws a sheet up the glass, and a sheet thrown hard sprays.
    let runupMax = 0;
    for (let side = 0; side < 2; side += 1) {
      const j = side === 0 ? 0 : count - 1;
      const rate = this.etaT[j] ?? 0;
      const ratio = rate / runup;
      runupMax = Math.max(runupMax, ratio);
      if (ratio > worst) {
        worst = ratio;
        worstAt = j;
      }
      const foot = h + (this.etaS[j] ?? 0) + this.z;
      this.sheetFoot[side] = foot;
      const tip = this.sheetTip[side] ?? 0;
      if (this.spray && tip <= foot && ratio >= 1) {
        // Launched half a pixel up, so it exists before its first step.
        this.sheetTip[side] = foot + 0.5;
        this.sheetV[side] = SHEET_GAIN * rate;
        this.sheetSpray[side] = ratio >= SHEET_SPRAY ? Math.min(3, Math.floor(ratio)) : 0;
      }
    }
    this.stepSheets(dt, gModes, W);

    this.measures.fall = fallMax;
    this.measures.steep = steepMax;
    this.measures.runup = runupMax;
    this.violence = worst;
    if (this.cascadeOn && worst > CASCADE_ON) {
      this.cascade(dt, worst, (worstAt / (count - 1)) * W, W);
    }
  }

  /** The highest sample uphill of `j`: where a crest past its limit spills from. */
  private crestNear(j: number): number {
    const step = (this.slopeS[j] ?? 0) > 0 ? 1 : -1;
    let at = j;
    while (
      at + step >= 0 &&
      at + step < this.samples &&
      (this.etaS[at + step] ?? 0) > (this.etaS[at] ?? 0)
    )
      at += step;
    return at;
  }

  /** Sample the surface's height, rate, acceleration, slope and flow at every sample, once a step. */
  private sampleSurface(h: number, W: number): void {
    if (this.sampled) return;
    this.sampled = true;
    const count = this.samples;
    const { cosTable, sinTable, flowGain } = this;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const k = ((i + 1) * Math.PI) / W;
      flowGain[i] = 1 / Math.max(0.05, Math.tanh(k * Math.max(1, h)));
    }
    for (let j = 0; j < count; j += 1) {
      let eta = 0;
      let rate = 0;
      let acc = 0;
      let slope = 0;
      let flow = 0;
      for (let i = 0; i < MODE_COUNT; i += 1) {
        const a = this.a[i] ?? 0;
        const v = this.v[i] ?? 0;
        if (a === 0 && v === 0) continue;
        const c = cosTable[i * count + j] ?? 0;
        const sn = sinTable[i * count + j] ?? 0;
        const k = ((i + 1) * Math.PI) / W;
        const w = this.omega[i] ?? 0;
        const share = this.gravityShare[i] ?? 1;
        eta += a * c;
        rate += v * c;
        // Only gravity's share: a ripple pulled back by surface tension is held, not thrown.
        acc += share * (-2 * (this.sigma[i] ?? 0) * v - w * w * (a - (this.goal[i] ?? 0))) * c;
        slope -= share * a * k * sn;
        // Linear potential flow: the water at the top moves sideways at -ȧ sin(kx) / tanh(kh).
        flow -= v * sn * (flowGain[i] ?? 1);
      }
      this.etaS[j] = eta;
      this.etaT[j] = rate;
      this.etaTT[j] = acc;
      this.slopeS[j] = slope;
      this.flowS[j] = flow;
    }
  }

  /**
   * Throw a droplet from the surface at vessel coordinates (x, y) with this velocity.
   *
   * Its water comes OUT of the body there: a dent of exactly its area, projected onto the modes.
   * The mean of that dent is the droplet itself, which `aside` counts; the shape of it is the
   * hollow it leaves. Returns false if the budget said no, in which case nothing happened at all.
   */
  private throwDroplet(
    x: number,
    y: number,
    vx: number,
    vy: number,
    W: number,
    h: number,
  ): boolean {
    if (h < 6) return false;
    // In shallow water a droplet is a large part of what is there: kept to an eighth of the depth.
    const r = Math.min(DROP_R_MIN + this.sprayRandom() * (DROP_R_MAX - DROP_R_MIN), 0.12 * h);
    // Never high enough to leave the glass: a droplet over the rim is water lost.
    const room = Math.max(0, this.height - 2 * r - y);
    const vyMax = Math.sqrt(2 * this.gPx * room);
    const jitter = 1 + (this.sprayRandom() - 0.5) * 0.3;
    const up = Math.min(vy * jitter, vyMax);
    // Too slow to rise clear of the surface: it is a crest, not a droplet, and stays in the body.
    if (up < Math.sqrt(2 * this.gPx * LAUNCH_RISE * r)) return false;
    const across = vx + (this.sprayRandom() - 0.5) * 0.3 * Math.abs(up);
    const i = this.droplets.add(x, y + r * 0.5, across, up, r);
    if (i < 0) return false;
    this.dent(x - (this.width - W) / 2, Math.PI * r * r, -1, W, r);
    return true;
  }

  /** A stream's crown: off by default, see `pourSpray`. */
  private throwFromStream(x0: number, W: number): void {
    const h = this.bodyDepth();
    // A plunging stream's crown leaves at a good fraction of the shallow-water speed √(gh): enough
    // to clear the dimple it rises from. At a quarter of it, it lived a frame and nobody saw it.
    const up = (0.6 + 0.4 * this.sprayRandom()) * Math.sqrt(this.gPx * Math.max(4, h));
    const side = this.sprayRandom() < 0.5 ? -1 : 1;
    this.throwDroplet((this.width - W) / 2 + x0, h + this.z, side * up * 0.35, up, W, h);
  }

  /**
   * Add (`sign` +1) or take away (-1) `area` px² of water at `x` across the waterline, as a Gaussian
   * as wide as the droplet, projected onto the modes. The modes integrate to zero; the mean of it is
   * the droplet, counted by `aside`.
   */
  private dent(x: number, area: number, sign: 1 | -1, W: number, r: number): void {
    const s = Math.max(1.5, 1.4 * r);
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const k = ((i + 1) * Math.PI) / W;
      this.a[i] = (this.a[i] ?? 0) + sign * area * gaussianMode(k, x, s, W);
    }
  }

  /** Every droplet: fly, meet a wall and run down it, or land and give its water back. */
  private stepDroplets(dt: number, h: number, W: number): void {
    this.sampleSurface(h, W);
    const d = this.droplets;
    const inset = (this.width - W) / 2;
    const count = this.samples;
    // In the glass's frame, gravity and the glass's own acceleration both pull on what is in the air.
    const gx = -this.ax;
    const gy = -(this.gPx + this.ay);
    const half = ((1 - this.taper) * this.width) / 2;

    let i = 0;
    while (i < d.count) {
      const r = d.r[i] ?? 1;
      let x = d.x[i] ?? 0;
      let y = d.y[i] ?? 0;
      let vx = d.vx[i] ?? 0;
      let vy = d.vy[i] ?? 0;
      d.age[i] = (d.age[i] ?? 0) + dt;

      if (d.state[i] === FLYING) {
        vx += gx * dt;
        vy += gy * dt;
        x += vx * dt;
        y += vy * dt;
        // The rim is a ceiling: in a real glass this would spill, and this water is not ours to lose.
        if (y > this.height - r) {
          y = this.height - r;
          vy = -Math.abs(vy) * 0.3;
        }
        // The walls, which lean in towards the floor if the glass tapers. A droplet that meets one
        // wets it and runs down.
        const wallInset = half * (1 - Math.max(0, Math.min(this.height, y)) / this.height);
        if (x - r < wallInset || x + r > this.width - wallInset) {
          x = x - r < wallInset ? wallInset + r * 0.6 : this.width - wallInset - r * 0.6;
          vx = 0;
          vy = Math.min(0, vy) * 0.3;
          d.state[i] = SLIDING;
        }
      } else {
        vy = Math.max(vy - SLIDE_ACCEL * dt, -SLIDE_SPEED);
        y += vy * dt;
        const wallInset = half * (1 - Math.max(0, Math.min(this.height, y)) / this.height);
        x = x < this.width / 2 ? wallInset + r * 0.6 : this.width - wallInset - r * 0.6;
      }

      // Back into the body: where the surface is, under it.
      const u = Math.min(1, Math.max(0, (x - inset) / W)) * (count - 1);
      const lo = Math.floor(u);
      const hi = Math.min(count - 1, lo + 1);
      const t = u - lo;
      const surface = h + (this.etaS[lo] ?? 0) * (1 - t) + (this.etaS[hi] ?? 0) * t + this.z;
      if (vy <= 0 && y - r * 0.4 <= surface) {
        this.landDroplet(i, x - inset, vy, W);
        continue;
      }
      d.x[i] = x;
      d.y[i] = y;
      d.vx[i] = vx;
      d.vy[i] = vy;
      i += 1;
    }
  }

  /**
   * A droplet comes home: its water back into the body as a bump where it lands, and its momentum
   * as a downward kick there — which spreads as a small ring of ripples.
   */
  private landDroplet(i: number, xw: number, vy: number, W: number): void {
    const d = this.droplets;
    const r = d.r[i] ?? 1;
    const area = Math.PI * r * r;
    const s = Math.max(1.5, 1.4 * r);
    const kick = (SPLASH_GAIN * area * Math.abs(vy)) / s;
    for (let n = 0; n < MODE_COUNT; n += 1) {
      const k = ((n + 1) * Math.PI) / W;
      const g = gaussianMode(k, xw, s, W);
      this.a[n] = (this.a[n] ?? 0) + area * g;
      this.v[n] = (this.v[n] ?? 0) - kick * g;
    }
    d.remove(i);
  }

  /**
   * The two wall sheets. A tongue thrown up the wall faster than the bulk climbs under gravity and
   * a little wall drag, throws its spray from the tip on the way up, and falls back into the body —
   * leaving the film it wetted. Its water is `0.5 · thick · length`, counted by `aside` while it is
   * up there.
   */
  private stepSheets(dt: number, gModes: number, W: number): void {
    let area = 0;
    const half = ((1 - this.taper) * this.width) / 2;
    for (let side = 0; side < 2; side += 1) {
      const foot = this.sheetFoot[side] ?? 0;
      let tip = this.sheetTip[side] ?? 0;
      if (tip <= foot) {
        this.sheetTip[side] = 0;
        continue;
      }
      let v = this.sheetV[side] ?? 0;
      v -= gModes * (1 + SHEET_DRAG) * dt;
      tip = Math.min(this.height - 1, foot + SHEET_MAX * this.height, tip + v * dt);
      if (tip <= foot + 0.25) {
        this.sheetTip[side] = 0;
        this.sheetV[side] = 0;
        continue;
      }
      // Spray off the tip while it is still climbing.
      const left = this.sheetSpray[side] ?? 0;
      if (left > 0 && v > 0 && tip - foot > 3) {
        this.sheetSpray[side] = left - 1;
        const y = tip;
        const wallInset = half * (1 - Math.max(0, Math.min(this.height, y)) / this.height);
        const x = side === 0 ? wallInset + 2 : this.width - wallInset - 2;
        const away = (side === 0 ? 1 : -1) * (20 + 40 * this.sprayRandom());
        this.throwDroplet(x, y, away, v * (0.8 + 0.2 * this.sprayRandom()), W, this.bodyDepth());
      }
      this.sheetTip[side] = tip;
      this.sheetV[side] = v;
      area += 0.5 * SHEET_THICK_PX * (tip - foot);
    }
    this.sheetArea = area;
  }

  /**
   * THE CASCADE: a big wave meeting a wall, or a crest past breaking, does not come back whole.
   *
   * A share of the slosh's energy (modes 1–4) is taken out and a smaller share put into short waves
   * (modes 8–24) where the violence was, as a jittered knock. Those damp in a fraction of a second,
   * so a hard event leaves the surface briefly choppy, then calm — rather than a jelly that bounces
   * back intact. TOTAL ENERGY ONLY FALLS: what arrives is `CASCADE_KEEP` of what left, solved
   * exactly for the knock's amplitude. `slosh.test.ts` pins it.
   */
  private cascade(dt: number, violence: number, x: number, W: number): void {
    const f = Math.min(0.5, CASCADE_RATE * (violence - CASCADE_ON) * dt);
    if (f <= 0) return;
    const keep = Math.sqrt(1 - f);
    let removed = 0;
    for (let i = 0; i < CASCADE_LOW; i += 1) {
      const w = this.omega[i] ?? 0;
      const a = this.a[i] ?? 0;
      const v = this.v[i] ?? 0;
      removed += 0.5 * (v * v + w * w * a * a) * f;
      this.a[i] = a * keep;
      this.v[i] = v * keep;
    }
    const wanted = CASCADE_KEEP * removed;
    if (wanted <= 0) return;
    // The knock's shape, and the exact amplitude that delivers `wanted`: ½s²D + sB = wanted.
    const shape = this.knock;
    let D = 0;
    let B = 0;
    for (let i = CASCADE_FROM - 1; i < CASCADE_TO; i += 1) {
      const k = ((i + 1) * Math.PI) / W;
      const band = Math.exp(-(((i + 1 - CASCADE_PEAK) / CASCADE_SPREAD) ** 2));
      const c = band * Math.cos(k * x) * (1 + (this.sprayRandom() - 0.5) * 2 * CASCADE_JITTER);
      shape[i] = c;
      D += c * c;
      B += (this.v[i] ?? 0) * c;
    }
    if (D <= 0) return;
    const s = (-B + Math.sqrt(B * B + 2 * D * wanted)) / D;
    for (let i = CASCADE_FROM - 1; i < CASCADE_TO; i += 1) {
      this.v[i] = (this.v[i] ?? 0) + s * (shape[i] ?? 0);
    }
    this.cascaded += removed;
  }

  private readonly knock = new Float64Array(MODE_COUNT);
  private readonly flowGain = new Float64Array(MODE_COUNT);

  private stepFilm(dt: number, h: number, W: number): void {
    if (h <= 0 || W <= 0) {
      this.filmTop.fill(0);
      return;
    }
    for (let side = 0; side < 2; side += 1) {
      // A sheet wets the wall as high as it reaches.
      const wall = Math.max(this.wallHeight(side === 0 ? 0 : 1), this.sheetTip[side] ?? 0);
      const top = this.filmTop[side] ?? 0;
      if (wall >= top) {
        this.filmTop[side] = wall;
        this.filmAge[side] = 0;
        continue;
      }
      const age = (this.filmAge[side] ?? 0) + dt;
      this.filmAge[side] = age;
      if (age > FILM_HOLD_S) {
        const speed = Math.min(FILM_SPEED, FILM_ACCEL * (age - FILM_HOLD_S));
        this.filmTop[side] = Math.max(this.wallHeight(side === 0 ? 0 : 1), top - speed * dt);
      }
    }
  }

  /** The water's height at one wall, px above the floor, without the meniscus. */
  private wallHeight(side: 0 | 1): number {
    let eta = 0;
    for (let i = 0; i < MODE_COUNT; i += 1) {
      const a = this.a[i] ?? 0;
      eta += side === 0 || i % 2 === 1 ? a : -a;
    }
    return this.bodyDepth() + eta;
  }

  /**
   * How much of a disturbance this much water can carry, 0–1. A shallow glass carries small waves;
   * an empty one carries none. The cap in `limit` is the hard version of the same sentence.
   */
  private depthScale(): number {
    const h = this.levelNow * this.height;
    return Math.min(1, Math.max(0, h / 12));
  }

  private canSleep(): boolean {
    if (this.pouring || this.z > 0 || this.vz !== 0 || this.bubbles > 0) return false;
    if (this.droplets.count > 0 || (this.sheetTip[0] ?? 0) > 0 || (this.sheetTip[1] ?? 0) > 0)
      return false;
    // Held still in a moving frame is still being driven; a rounding error's worth is not.
    const quiet = (DRIVE_QUIET * this.gPx) / G_PX;
    if (Math.abs(this.ax) > quiet || Math.abs(this.ay) > quiet) return false;
    if (this.reach() > SLEEP_PX) return false;
    for (let side = 0; side < 2; side += 1) {
      if ((this.filmTop[side] ?? 0) - this.wallHeight(side === 0 ? 0 : 1) >= FILM_MIN_PX)
        return false;
    }
    return true;
  }

  /** Every mode's ω and σ for this width, depth and gravity, and the exact step that follows. */
  private buildPropagator(W: number, h: number, g: number): void {
    if (W === this.builtW && h === this.builtH && g === this.builtG) return;
    this.builtW = W;
    this.builtH = h;
    this.builtG = g;

    for (let i = 0; i < MODE_COUNT; i += 1) {
      const n = i + 1;
      const w = Math.min(OMEGA_MAX, naturalFrequency(n, W, h, g, this.capPx));
      const s = SIGMA_1 * (1 + SIGMA_GROWTH * (n - 1));
      const k = (n * Math.PI) / W;
      this.gravityShare[i] = this.capillaryHolds ? (g * k) / (g * k + this.capPx * k * k * k) : 1;
      this.omega[i] = w;
      this.sigma[i] = s;
      const [p11, p12, p21, p22] = propagator(w, s, STEP_S);
      this.p11[i] = p11;
      this.p12[i] = p12;
      this.p21[i] = p21;
      this.p22[i] = p22;
    }
  }

  private buildShapes(W: number): void {
    this.shapesFor = W;
    projectWallShape(this.landShape, W, LAND_REACH * W);
    projectOneWall(this.landTilt, W, LAND_REACH * W);
    projectWallShape(this.pressShape, W, this.pressReachPx);
  }

  private buildTables(): void {
    // One sample every 2 px, between 49 and 97: the 24th mode — the chop the cascade makes — gets
    // four samples a wavelength on the bench's glass instead of aliasing into a zigzag.
    const count = Math.max(49, Math.min(97, Math.round(this.width / 2) + 1));
    if (count === this.samples) return;
    this.samples = count;
    this.cosTable = new Float64Array(MODE_COUNT * count);
    this.sinTable = new Float64Array(MODE_COUNT * count);
    for (let i = 0; i < MODE_COUNT; i += 1) {
      for (let j = 0; j < count; j += 1) {
        const phase = ((i + 1) * Math.PI * j) / (count - 1);
        this.cosTable[i * count + j] = Math.cos(phase);
        this.sinTable[i * count + j] = Math.sin(phase);
      }
    }
    this.frame.xs = new Float64Array(count);
    this.frame.hs = new Float64Array(count);
    this.etaS = new Float64Array(count);
    this.etaT = new Float64Array(count);
    this.etaTT = new Float64Array(count);
    this.slopeS = new Float64Array(count);
    this.flowS = new Float64Array(count);
  }

  /** mulberry32: small, fast, and the same bubbles every time for the same seed. */
  private random(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * A second stream for everything breakup does, so turning breakup on cannot change a single
   * bubble of the pour the owner approved.
   */
  private sprayRandom(): number {
    this.spraySeed = (this.spraySeed + 0x6d2b79f5) >>> 0;
    let t = this.spraySeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * ω for mode `n` of a tank `W` px wide holding `h` px of water under gravity `g` px/s², in rad/s.
 * The dispersion relation of capillary-gravity waves, used as written.
 */
export function naturalFrequency(
  n: number,
  W: number,
  h: number,
  g: number = G_PX,
  cap: number = CAPILLARITY_PX,
): number {
  if (W <= 0 || h <= 0) return 0;
  const k = (n * Math.PI) / W;
  return Math.sqrt((g * k + cap * k * k * k) * Math.tanh(k * h));
}

/** The fundamental's period, seconds, for a glass this wide holding this much water. */
export function fundamentalPeriod(
  W: number,
  h: number,
  g: number = G_PX,
  cap: number = CAPILLARITY_PX,
): number {
  const w = naturalFrequency(1, W, h, g, cap);
  return w > 0 ? (2 * Math.PI) / w : Infinity;
}

/** The static-tilt projection coefficient for mode `n`: `4W / (n²π²)` for odd n, else 0. */
export function tiltCoefficient(n: number, W: number): number {
  return n % 2 === 1 ? (4 * W) / (n * n * Math.PI * Math.PI) : 0;
}

/**
 * The exact step of a damped oscillator `ë + 2σė + ω²e = 0` over `dt`, as a 2×2 matrix.
 *
 * Exact rather than integrated, because capillarity puts the top modes of a small glass at hundreds
 * of rad/s and any explicit scheme at a 60 Hz step would explode on them. With the forcing held for
 * the step, the update is exact for any ω, at the price of a sin, a cos and an exp per mode — and
 * only when ω changes, which is when the level or the effective gravity does.
 */
export function propagator(w: number, s: number, dt: number): [number, number, number, number] {
  const E = Math.exp(-s * dt);
  if (w <= 0) return [E, 0, 0, E];
  if (s < w) {
    const wd = Math.sqrt(w * w - s * s);
    const c = Math.cos(wd * dt);
    const sn = Math.sin(wd * dt);
    return [
      E * (c + (s / wd) * sn),
      (E * sn) / wd,
      (-E * w * w * sn) / wd,
      E * (c - (s / wd) * sn),
    ];
  }
  const b = Math.sqrt(Math.max(0, s * s - w * w));
  const ch = Math.cosh(b * dt);
  const sh = b * dt < 1e-6 ? dt : Math.sinh(b * dt) / b;
  return [E * (ch + s * sh), E * sh, -E * w * w * sh, E * (ch - s * sh)];
}

/** Probes across the glass for the cap: four per wavelength of the top mode. */
const PROBES = 4 * MODE_COUNT;
let probes: Float64Array | null = null;

/** `cos(nπ j / PROBES)` for every mode and probe. Width-free, so one table serves every glass. */
function probeTable(): Float64Array {
  if (probes !== null) return probes;
  const table = new Float64Array(MODE_COUNT * (PROBES + 1));
  for (let i = 0; i < MODE_COUNT; i += 1) {
    for (let j = 0; j <= PROBES; j += 1)
      table[i * (PROBES + 1) + j] = Math.cos(((i + 1) * Math.PI * j) / PROBES);
  }
  probes = table;
  return table;
}

/**
 * The cosine coefficient of a Gaussian of unit volume centred at `x0` with width `s`, in a glass `W`
 * wide: `(2/W) cos(k x0) exp(-(k s)² / 2)`. The tails beyond the walls are ignored, which near a wall
 * is the same as reflecting them back in — the even extension the cosines already assume.
 */
function gaussianMode(k: number, x0: number, s: number, W: number): number {
  return (2 / W) * Math.cos(k * x0) * Math.exp(-0.5 * (k * s) ** 2);
}

/**
 * Project a wall-high shape — `exp(-d / reach)` from each wall, mean removed — onto the modes,
 * normalised so the shape is 1 at the walls. Only the even modes survive: it is symmetric.
 */
function projectWallShape(out: Float64Array, W: number, reach: number): void {
  const r = Math.max(0.5, reach);
  // Exact: ∫₀^W e^{-x/r} cos(kx) dx = r (1 - e^{-W/r} cos(kW)) / (1 + k²r²), doubled for both walls.
  for (let i = 0; i < out.length; i += 1) {
    const n = i + 1;
    if (n % 2 === 1) {
      out[i] = 0;
      continue;
    }
    const k = (n * Math.PI) / W;
    const one = (r * (1 - Math.exp(-W / r) * Math.cos(k * W))) / (1 + k * k * r * r);
    out[i] = (2 / W) * 2 * one;
  }
  // The shape's value at the wall, from the modes alone, so "1 at the wall" is true of what is drawn.
  let atWall = 0;
  for (const value of out) atWall += value;
  if (atWall > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) / atWall;
}

function ease(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/**
 * The odd half of one wall's shape — `exp(-x / reach)` from the LEFT wall only — normalised like
 * `projectWallShape`. Added to a landing in a small random amount, it leans the slam to one side.
 */
function projectOneWall(out: Float64Array, W: number, reach: number): void {
  const r = Math.max(0.5, reach);
  let atWall = 0;
  for (let i = 0; i < out.length; i += 1) {
    const n = i + 1;
    if (n % 2 === 0) {
      out[i] = 0;
      continue;
    }
    const k = (n * Math.PI) / W;
    out[i] = ((2 / W) * r * (1 + Math.exp(-W / r))) / (1 + k * k * r * r);
    atWall += out[i] ?? 0;
  }
  if (atWall > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) / atWall;
}
