/*
 * Turning a bag of particles back into something you can draw.
 *
 * The shipped renderer samples a height per x and strokes a curve through the samples, which is
 * the only thing it can do — the model it draws IS a curve. Particles have no such shape: at any
 * moment the water might be one body, or a body with three drops above it, or a sheet with a hole
 * torn in it. So the drawable thing is an ISO-SURFACE: splat every particle into a coarse density
 * grid, then trace the contour where the density crosses a threshold. Whatever the water is doing,
 * the contour is the outline of it — one loop, or five, or a loop with a loop inside it.
 *
 * Contours, not per-cell squares. The first version filled each grid cell that was inside the
 * surface and the result had a faint grid of seams through the body: two antialiased polygons
 * sharing an edge do not add up to an opaque one, they add up to that edge showing. Following the
 * contour into closed loops means one path, one fill, no internal edges — and it is what gives the
 * surface line for free, including a rim of light around every droplet.
 *
 * Holes come out right without being asked for: a hole traces in the opposite direction to the
 * body around it, so the nonzero winding rule both canvas and Pixi fill with leaves it empty.
 *
 * TWO NUMBERS HERE ARE MEASURED AND ONE IS DERIVED FROM THEM.
 *
 *  - `MESH_SMOOTH`, the splat radius as a multiple of particle spacing, is set by the smallest
 *    thing that has to be visible. A LONE PARTICLE MUST DRAW. Its peak density is
 *    `4 / (pi * MESH_SMOOTH^2)` — 0.22 at the solver's own radius of 2.4, which is below any
 *    sensible threshold, so at 2.4 a droplet that tore off the body would simply disappear in
 *    mid-air. That is the headline feature erased by a rendering constant. At 1.6 the peak is 0.50
 *    and a single particle draws as a disc about 1.2 spacings across, which is the area it stands
 *    for.
 *  - `MESH_ISO` is then chosen so that the disc that lone particle draws has the area the particle
 *    represents: `pi * R^2 = spacing^2`. That lands at 0.32, not at the 0.5 that a half-space
 *    argument suggests, and the difference is the whole of whether droplets exist.
 *  - `MESH_LIFT` pays for it. An iso below 0.5 puts the surface of a BODY of water outside the
 *    particles rather than on them, so the body is drawn slightly too big in every direction —
 *    which at the top of the glass is a waterline above the level the glass is supposed to be
 *    showing, and this app must not lie about somebody's number. The whole field is therefore
 *    drawn shifted down by `MESH_LIFT` spacings, measured against the simulation itself, so the
 *    inflation lands under the floor where the vessel clips it away. See `mesh.test.ts`.
 */

import type { PathSink } from '../lib/water/renderer';
import type { Fluid } from './fluid';

/** Splat radius as a multiple of particle spacing. See the note above: a lone particle must draw. */
export const MESH_SMOOTH = 1.6;

/** The contour's threshold, as a fraction of "solidly full". */
export const MESH_ISO = 0.32;

/**
 * How far down the drawn field is shifted, in particle spacings. Negative is up.
 *
 * MEASURED, and the test that pins it fails at the value it replaced. Two errors of about half a
 * particle spacing each were expected to be here and they turned out to point opposite ways.
 *
 * An iso of 0.32 puts the contour of a BODY of water outside the particles that make it, which
 * draws a glass fuller than it is — worth about +0.42 spacings, which is where this constant
 * started. But the solver has an error of its own in the other direction: a particle within a
 * smoothing radius of the free surface is missing neighbours it cannot get back, so it can only
 * generate the pressure holding up the water above it by packing tighter than rest, and the top of
 * the body compacts. Measured across six levels from 4% to full, that compaction is 0.41 to 0.57
 * particle spacings and does not vary with anything else.
 *
 * They very nearly cancel. What is left is 0.07 of a spacing, which at the coarsest spacing this
 * model uses is four tenths of a pixel, and the residual error in the drawn waterline is under half
 * a pixel at every level. Drawn with the 0.42 the analysis asked for, the same glasses read between
 * 0.5 and 3.7 pixels too empty — which is a glass understating somebody's progress, every tile,
 * every frame.
 */
export const MESH_LIFT = -0.07;

/** Grid cells per splat radius. Below about 2 the contour is a staircase rather than a curve. */
const CELLS_PER_RADIUS = 2.6;

/** No point resolving the contour finer than this; a screen has pixels. */
const CELL_MIN_PX = 1.5;
const CELL_MAX_PX = 5;

/** Loops shorter than this are grid noise, not water. */
const MIN_LOOP = 3;

/**
 * The smallest hole that is allowed to be a hole, as a multiple of one particle's own area.
 *
 * A loop wound against the body is air inside the water. Real water at the size of a tile does not
 * hold air: a bubble that small rises through a centimetre of liquid in a few milliseconds. What
 * produces them here is the particle spacing — stretch a body of four hundred particles and the
 * density dips below the threshold in the gaps between them, and the contour dutifully draws a
 * pocket of air around every gap. Drawn, a glass thrown hard came out as FOAM, which is a thing
 * this product's rules say the liquid may never be.
 *
 * So holes smaller than a few particles are dropped and holes larger than that are kept, because
 * those are the water genuinely coming apart, which is the whole point of the exercise. Islands are
 * never dropped at any size: the smallest island is a droplet, and droplets are the headline.
 */
const HOLE_FLOOR = 9;

export class Mesh {
  private width = 0;
  private height = 0;
  private cell = CELL_MIN_PX;
  private cols = 0;
  private rows = 0;
  private originX = 0;
  private originY = 0;
  private hEdges = 0;

  private field = new Float32Array(0);
  private next = new Int32Array(0);
  private ex = new Float32Array(0);
  private ey = new Float32Array(0);

  /** The collected outline: `loops` closed runs of points, ending at `loopEnd[l]`. */
  private px = new Float32Array(4096);
  private py = new Float32Array(4096);
  private readonly loopEnd = new Int32Array(256);
  /** Points in the collected outline. Read by the bench, which reports the cost of a frame. */
  points = 0;
  /** Largest loop area seen while collecting: it is what decides which way "water" is wound. */
  private biggest = 0;
  /**
   * The area the contour actually encloses, in square pixels, holes subtracted.
   *
   * This is the other half of "water is moved, never made". The particles conserve it by
   * construction — the count never changes — but the PICTURE is what somebody reads, and a drawn
   * shape can be bigger than the water it stands for if the particles spread out. So it is measured
   * rather than assumed, and `mesh.test.ts` pins it.
   */
  drawnArea = 0;

  /** How many closed loops the last build found. One body is one; tearing shows up here. */
  loops = 0;

  /**
   * Splat the fluid into the grid and work out the contour's topology.
   *
   * Everything downstream — `trace`, `topAt` — reads what this leaves behind.
   */
  build(fluid: Fluid, width: number, height: number): void {
    const unit = height;
    const radiusPx = Math.max(1.2, MESH_SMOOTH * fluid.spacing * unit);
    const cell = Math.min(CELL_MAX_PX, Math.max(CELL_MIN_PX, radiusPx / CELLS_PER_RADIUS));
    // The margin is why every loop closes: beyond one splat radius plus a cell the field is
    // genuinely zero, so no contour can reach the edge of the grid and be left hanging.
    const margin = radiusPx + cell * 2;

    const cols = Math.max(2, Math.ceil((width + margin * 2) / cell));
    const rows = Math.max(2, Math.ceil((height + margin * 2) / cell));

    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.field = new Float32Array((cols + 1) * (rows + 1));
      this.hEdges = cols * (rows + 1);
      const edges = this.hEdges + (cols + 1) * rows;
      this.next = new Int32Array(edges);
      this.ex = new Float32Array(edges);
      this.ey = new Float32Array(edges);
    }

    this.width = width;
    this.height = height;
    this.cell = cell;
    this.originX = -margin;
    this.originY = -margin;
    this.field.fill(0);

    this.splat(fluid, radiusPx, unit);
    // Zero the outer ring, so no contour can cross the edge of the grid and be left open. It is two
    // cells beyond the vessel on every side, and water above the rim is clipped away regardless.
    this.clearBorder();
    this.link();
    if (this.px.length < this.next.length) {
      this.px = new Float32Array(this.next.length);
      this.py = new Float32Array(this.next.length);
    }
    this.biggest = 0;
    this.drawnArea = 0;
    this.collect(fluid.spacing * unit);
  }

  private clearBorder(): void {
    const { field, cols, rows } = this;
    const last = rows * (cols + 1);
    for (let a = 0; a <= cols; a += 1) {
      field[a] = 0;
      field[last + a] = 0;
    }
    for (let b = 0; b <= rows; b += 1) {
      field[b * (cols + 1)] = 0;
      field[b * (cols + 1) + cols] = 0;
    }
  }

  private splat(fluid: Fluid, radiusPx: number, unit: number): void {
    const { field, cols, rows, cell, originX, originY } = this;
    const h2 = radiusPx * radiusPx;
    // The kernel integrates to one over its own disc, and each particle carries the area it stands
    // for — so a solidly packed region reads exactly 1.0 and the threshold is a fill fraction.
    const norm = (4 / (Math.PI * Math.pow(radiusPx, 8))) * Math.pow(fluid.spacing * unit, 2);
    const lift = MESH_LIFT * fluid.spacing;
    const span = Math.ceil(radiusPx / cell);

    for (let i = 0; i < fluid.count; i += 1) {
      const px = (fluid.x[i] ?? 0) * unit;
      const py = this.height - ((fluid.y[i] ?? 0) - lift) * unit;
      const ca = Math.round((px - originX) / cell);
      const cb = Math.round((py - originY) / cell);

      for (let b = Math.max(0, cb - span); b <= Math.min(rows, cb + span); b += 1) {
        const dy = originY + b * cell - py;
        const row = b * (cols + 1);
        for (let a = Math.max(0, ca - span); a <= Math.min(cols, ca + span); a += 1) {
          const dx = originX + a * cell - px;
          const diff = h2 - (dx * dx + dy * dy);
          if (diff <= 0) continue;
          field[row + a] = (field[row + a] ?? 0) + norm * diff * diff * diff;
        }
      }
    }
  }

  /**
   * Marching squares, as a directed graph instead of a pile of segments.
   *
   * Every cell edge the contour crosses gets exactly one outgoing link, chosen so that the water is
   * always on the LEFT of the direction of travel. That one convention does three jobs: the loops
   * come out closed without any endpoint matching, they come out consistently wound so the fill
   * rule can tell a hole from a body, and following them is a pointer chase rather than a search.
   */
  private link(): void {
    const { field, cols, rows, cell, originX, originY, next, ex, ey, hEdges } = this;
    const iso = MESH_ISO;
    next.fill(-1);

    // Crossing points, one per edge, computed once.
    for (let b = 0; b <= rows; b += 1) {
      const row = b * (cols + 1);
      const y = originY + b * cell;
      for (let a = 0; a < cols; a += 1) {
        const f0 = field[row + a] ?? 0;
        const f1 = field[row + a + 1] ?? 0;
        if (f0 < iso === f1 < iso) continue;
        const t = (iso - f0) / (f1 - f0);
        const e = b * cols + a;
        ex[e] = originX + (a + t) * cell;
        ey[e] = y;
      }
    }
    for (let b = 0; b < rows; b += 1) {
      const row = b * (cols + 1);
      for (let a = 0; a <= cols; a += 1) {
        const f0 = field[row + a] ?? 0;
        const f1 = field[row + cols + 1 + a] ?? 0;
        if (f0 < iso === f1 < iso) continue;
        const t = (iso - f0) / (f1 - f0);
        const e = hEdges + b * (cols + 1) + a;
        ex[e] = originX + a * cell;
        ey[e] = originY + (b + t) * cell;
      }
    }

    for (let b = 0; b < rows; b += 1) {
      const row = b * (cols + 1);
      for (let a = 0; a < cols; a += 1) {
        const n0 = (field[row + a] ?? 0) >= iso ? 1 : 0;
        const n1 = (field[row + a + 1] ?? 0) >= iso ? 2 : 0;
        const n2 = (field[row + cols + 1 + a + 1] ?? 0) >= iso ? 4 : 0;
        const n3 = (field[row + cols + 1 + a] ?? 0) >= iso ? 8 : 0;
        const code = n0 | n1 | n2 | n3;
        if (code === 0 || code === 15) continue;

        const top = b * cols + a;
        const bottom = (b + 1) * cols + a;
        const left = hEdges + b * (cols + 1) + a;
        const right = left + 1;

        switch (code) {
          case 1:
            next[left] = top;
            break;
          case 2:
            next[top] = right;
            break;
          case 3:
            next[left] = right;
            break;
          case 4:
            next[right] = bottom;
            break;
          case 5:
            next[left] = top;
            next[right] = bottom;
            break;
          case 6:
            next[top] = bottom;
            break;
          case 7:
            next[left] = bottom;
            break;
          case 8:
            next[bottom] = left;
            break;
          case 9:
            next[bottom] = top;
            break;
          case 10:
            next[top] = right;
            next[bottom] = left;
            break;
          case 11:
            next[bottom] = right;
            break;
          case 12:
            next[right] = left;
            break;
          case 13:
            next[right] = top;
            break;
          case 14:
            next[top] = left;
            break;
          default:
            break;
        }
      }
    }
  }

  /**
   * Follow the links into closed loops, once, into buffers the drawing then reads.
   *
   * Collected rather than traced straight into a path because the same outline is wanted three
   * times in a frame — filled, stroked, and lit along the facets that face the window — and the
   * walk destroys the links as it goes.
   */
  private collect(spacingPx: number): void {
    const { next, ex, ey } = this;
    const holeFloor = HOLE_FLOOR * spacingPx * spacingPx;
    let write = 0;
    let loops = 0;
    let bodySign = 0;

    for (let start = 0; start < next.length; start += 1) {
      if ((next[start] ?? -1) < 0) continue;

      const from = write;
      let cur = start;
      while (cur >= 0 && write < this.px.length) {
        this.px[write] = ex[cur] ?? 0;
        this.py[write] = ey[cur] ?? 0;
        write += 1;
        const step = next[cur] ?? -1;
        next[cur] = -1;
        cur = step === start ? -1 : step;
      }

      if (write - from < MIN_LOOP) {
        write = from;
        continue;
      }

      /*
       * The shoelace area, signed — which is how a hole announces itself.
       *
       * Every outline is traced with the water on the left, so a body and a hole inside it come out
       * wound opposite ways and their signed areas have opposite signs. The biggest loop seen so far
       * is water by definition, so its sign is what "water" means for this frame, and anything wound
       * the other way is air.
       */
      let twice = 0;
      for (let k = from; k < write; k += 1) {
        const n = k + 1 === write ? from : k + 1;
        twice += (this.px[k] ?? 0) * (this.py[n] ?? 0) - (this.px[n] ?? 0) * (this.py[k] ?? 0);
      }
      const area = twice / 2;
      if (bodySign === 0 || Math.abs(area) > this.biggest) {
        this.biggest = Math.abs(area);
        bodySign = Math.sign(area);
      }
      if (bodySign !== 0 && Math.sign(area) !== bodySign && Math.abs(area) < holeFloor) {
        write = from;
        continue;
      }

      this.loopEnd[loops] = write;
      this.drawnArea += area;
      loops += 1;
      if (loops >= this.loopEnd.length) break;
    }

    this.loops = loops;
    this.points = write;
    // Signed by the winding the body came out with, so the answer is positive whichever way it went.
    if (bodySign < 0) this.drawnArea = -this.drawnArea;
  }

  /**
   * Trace every loop into a sink.
   *
   * Quadratics through the midpoints rather than the corner points, which is the trick
   * `traceSurface` uses in the shipped renderer and for the same reason: a contour on a three-pixel
   * grid is made of three-pixel facets, and a facet on a curve is the loudest "drawn by a computer"
   * tell there is.
   */
  trace(sink: PathSink): boolean {
    const { px, py } = this;
    let from = 0;
    for (let l = 0; l < this.loops; l += 1) {
      const to = this.loopEnd[l] ?? 0;
      const n = to - from;
      if (n >= MIN_LOOP) {
        let mx = ((px[to - 1] ?? 0) + (px[from] ?? 0)) / 2;
        let my = ((py[to - 1] ?? 0) + (py[from] ?? 0)) / 2;
        sink.moveTo(mx, my);
        for (let k = from; k < to; k += 1) {
          const cx = px[k] ?? 0;
          const cy = py[k] ?? 0;
          const nk = k + 1 === to ? from : k + 1;
          mx = (cx + (px[nk] ?? 0)) / 2;
          my = (cy + (py[nk] ?? 0)) / 2;
          sink.quadraticCurveTo(cx, cy, mx, my);
        }
        sink.closePath();
      }
      from = to;
    }
    return this.loops > 0;
  }

  /**
   * The lit facets, as loose segments: the parts of the outline that face the window.
   *
   * The shipped renderer lights the flanks of the waves that descend to the right, because the room
   * light in this design is top-left and that is the family of facets that turns towards it. The
   * same rule, expressed on an outline instead of on a height function — which means a droplet in
   * mid-air is lit on the same side as the body it left, and that is what makes the two read as the
   * same material.
   *
   * Returned as disconnected two-point subpaths so one stroke draws all of them.
   */
  traceLit(sink: PathSink, minSlope: number): boolean {
    const { px, py } = this;
    let from = 0;
    let any = false;
    for (let l = 0; l < this.loops; l += 1) {
      const to = this.loopEnd[l] ?? 0;
      for (let k = from; k < to; k += 1) {
        const nk = k + 1 === to ? from : k + 1;
        const ax = px[k] ?? 0;
        const ay = py[k] ?? 0;
        const bx = px[nk] ?? 0;
        const by = py[nk] ?? 0;
        const dx = bx - ax;
        const dy = by - ay;
        // Water on the left of the direction of travel, so `dx < 0` is an outline facing upwards.
        if (dx >= 0) continue;
        if (dy >= 0 || -dy < -dx * minSlope) continue;
        sink.moveTo(ax, ay);
        sink.lineTo(bx, by);
        any = true;
      }
      from = to;
    }
    return any;
  }

  /**
   * The highest the water reaches at this x, in pixels from the top. Infinity where there is none.
   *
   * Reads the vertical edges of the nearest grid column, top down, and stops at the first crossing
   * — so it answers for a droplet in mid-air as readily as for the body, which is what the wall
   * film needs in order not to be drawn inside the water.
   */
  topAt(xPx: number): number {
    const { field, cols, rows, cell, originX, originY } = this;
    const a = Math.min(cols, Math.max(0, Math.round((xPx - originX) / cell)));
    for (let b = 0; b < rows; b += 1) {
      const f0 = field[b * (cols + 1) + a] ?? 0;
      const f1 = field[(b + 1) * (cols + 1) + a] ?? 0;
      if (f0 < MESH_ISO && f1 >= MESH_ISO) {
        const t = (MESH_ISO - f0) / (f1 - f0);
        return originY + (b + t) * cell;
      }
    }
    return Infinity;
  }

  /**
   * The waterline over the middle of the glass, in glass units.
   *
   * What a reader judges the glass by, and therefore what `MESH_LIFT` is calibrated against: a
   * glass whose level is 0.62 has to DRAW a waterline at 0.62. The middle only, because the two
   * walls are where the film and the meniscus live and neither is the level.
   */
  waterline(): number {
    const { width, height } = this;
    let total = 0;
    let taken = 0;
    for (let k = 0; k <= 10; k += 1) {
      const x = width * (0.25 + (k / 10) * 0.5);
      const y = this.topAt(x);
      if (!Number.isFinite(y)) continue;
      total += (height - y) / height;
      taken += 1;
    }
    return taken === 0 ? 0 : total / taken;
  }
}
