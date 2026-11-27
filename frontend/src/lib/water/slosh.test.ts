import { describe, expect, it } from 'vitest';
import { GESTURES, handAt, type Gesture } from './gestures';
import { Motion } from './motion';
import {
  CAPILLARITY_PX,
  G_PX,
  MODE_COUNT,
  STEP_S,
  Slosh,
  fundamentalPeriod,
  naturalFrequency,
  propagator,
} from './slosh';
import { DropletBudget } from './spray';

const TILE = { width: 200, height: 90 };
const GLASS_PX = { width: 96, height: 150, taper: 0.86 };

function gesture(id: string): Gesture {
  const found = GESTURES.find((g) => g.id === id);
  if (found === undefined) throw new Error(`no gesture ${id}`);
  return found;
}

/** Drive a model through a gesture the way the bench does, calling `each` after every step. */
function play(
  model: Slosh,
  g: Gesture,
  height: number,
  ms: number,
  each?: (t: number) => void,
  level = model.level,
): void {
  const motion = new Motion();
  let poured = false;
  for (let t = 0; t <= ms; t += STEP_S * 1000) {
    if (g.pour !== undefined && !poured && t >= g.pour.at) {
      poured = true;
      model.setLevel(Math.min(1, level + g.pour.by));
    }
    const here = handAt(g, t);
    const { ax, ay } = motion.feed(here.x / height, -here.y / height, STEP_S);
    model.drive(ax * height, ay * height);
    model.step(STEP_S);
    each?.(t);
  }
}

/** The surface's mean height over a fine grid, px. Should be the level times the height, exactly. */
function meanHeight(model: Slosh): number {
  let total = 0;
  const n = 2000;
  // Midpoint rule over [0, 1]: exact for every cosine mode up to n.
  for (let i = 0; i < n; i += 1) total += model.heightAt((i + 0.5) / n);
  return total / n;
}

/** The deepest trough and highest crest along the surface, px above the floor. */
function extremes(model: Slosh): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i <= 200; i += 1) {
    const h = model.heightAt(i / 200);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  return { low, high };
}

/** Zero crossings of mode 1, to time the fundamental. */
function measuredPeriod(
  width: number,
  height: number,
  level: number,
  metresPerPx?: number,
): number {
  const model = new Slosh({
    width,
    height,
    strength: 1,
    spray: false,
    cascade: false,
    ...(metresPerPx === undefined ? {} : { metresPerPx }),
  });
  model.setLevel(level, false);
  // One step of a sideways shove, then let it ring.
  model.drive(0.15 * G_PX, 0);
  model.step(STEP_S);
  model.drive(0, 0);
  const crossings: number[] = [];
  let previous = model.mode(1);
  for (let i = 1; i < 600; i += 1) {
    model.step(STEP_S);
    // Asleep, every mode is set to exactly zero, which is not a crossing.
    if (model.asleep) break;
    const now = model.mode(1);
    if (previous < 0 && now >= 0) {
      // Interpolated within the step, so the period is not quantised to 1/60 s.
      crossings.push((i - 1 + previous / (previous - now)) * STEP_S);
    }
    previous = now;
  }
  const first = crossings[0] ?? 0;
  const last = crossings[crossings.length - 1] ?? 0;
  return (last - first) / Math.max(1, crossings.length - 1);
}

const report = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.SLOSH_REPORT;

describe('Slosh: water is moved, never made', () => {
  /*
   * Every mode is a cosine with n ≥ 1, which integrates to zero across the glass, so the volume is
   * not one of the model's variables. This proves it through everything the model can be asked to
   * do: sideways, vertically, landing, a tap, the cap, the breaking.
   */
  /*
   * The body's mean height plus the water in the air, over the width, is the level. Exactly —
   * through droplets leaving and landing, sheets climbing walls and falling back, the cap, the
   * cascade and a tap.
   */
  it('keeps body plus airborne at the level through every gesture', () => {
    for (const id of ['drag', 'flick', 'shake', 'drop', 'lift']) {
      const model = new Slosh({ ...TILE, budget: new DropletBudget() });
      model.setLevel(0.47, false);
      let worst = 0;
      let airborne = 0;
      const check = (): void => {
        const total = meanHeight(model) + model.aside / TILE.width;
        worst = Math.max(worst, Math.abs(total - 0.47 * TILE.height));
        airborne = Math.max(airborne, model.aside);
      };
      play(model, gesture(id), TILE.height, 2500, check);
      model.tap(0.3, 200);
      for (let i = 0; i < 30; i += 1) {
        model.step(STEP_S);
        check();
      }
      expect(worst).toBeLessThan(1e-9);
      if (id === 'flick' || id === 'shake') expect(airborne).toBeGreaterThan(0);
    }
  });

  it('only changes its level when told to, and a pour arrives smoothly at exactly that level', () => {
    const model = new Slosh({ ...TILE, budget: new DropletBudget() });
    model.setLevel(0.3, false);
    play(model, gesture('shake'), TILE.height, 2000);
    expect(model.drawnLevel).toBe(0.3);

    model.setLevel(0.6);
    const seen: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      model.step(STEP_S);
      seen.push(model.drawnLevel);
    }
    // Monotonic, never past the target, and exactly there at the end.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i] ?? 0).toBeGreaterThanOrEqual((seen[i - 1] ?? 0) - 1e-12);
      expect(seen[i] ?? 0).toBeLessThanOrEqual(0.6);
    }
    expect(model.drawnLevel).toBe(0.6);
    expect(Math.abs(meanHeight(model) + model.aside / TILE.width - 0.6 * TILE.height)).toBeLessThan(
      1e-9,
    );
  });
});

describe('Slosh: a wave is never taller than the water it is made of', () => {
  it('leaves a glass at 0% inert, whatever is done to it', () => {
    const model = new Slosh(TILE);
    model.setLevel(0, false);
    for (const id of ['fling', 'shake', 'drop', 'lift']) {
      play(model, gesture(id), TILE.height, 1500, () => {
        const { low, high } = extremes(model);
        expect(low).toBe(0);
        expect(high).toBe(0);
        expect(model.heave).toBe(0);
        expect(model.droplets.count).toBe(0);
      });
    }
    model.tap(0.5, 500);
    model.step(STEP_S);
    expect(extremes(model).high).toBe(0);
    for (let i = 0; i < 10; i += 1) model.step(STEP_S);
    expect(model.asleep).toBe(true);
  });

  it('never lets a trough reach the floor or a crest leave the glass, even shaken at 4%', () => {
    for (const level of [0.04, 0.1, 0.62, 0.95]) {
      const model = new Slosh({ ...TILE, strength: 1, budget: new DropletBudget() });
      model.setLevel(level, false);
      for (const id of ['shake', 'flick', 'fling', 'drop', 'lift']) {
        play(model, gesture(id), TILE.height, 1500, () => {
          const { low, high } = extremes(model);
          // The body is the level less what is in the air, and that is the water a wave is made of.
          const depth = level * TILE.height - model.aside / TILE.width;
          // The trough keeps a quarter of it underneath — less a tenth of a pixel, because a droplet
          // thrown after this step's cap leaves its hollow behind before the next one.
          expect(low).toBeGreaterThanOrEqual(depth * 0.25 - 0.1);
          expect(low).toBeGreaterThan(0);
          expect(high).toBeLessThanOrEqual(TILE.height + 0.04 * TILE.height + 1e-9);
        });
      }
    }
  });
});

describe('Slosh: water that knows how deep it is', () => {
  it('rocks at the frequency the dispersion relation gives, and slower when shallow', () => {
    const periods: Record<string, number> = {};
    for (const level of [0.1, 0.34, 0.62, 0.9]) {
      const measured = measuredPeriod(TILE.width, TILE.height, level);
      const theory = fundamentalPeriod(TILE.width, level * TILE.height);
      // Damping lengthens the period by a hair (ω_d = √(ω² − σ²)); 3% covers it.
      expect(Math.abs(measured - theory) / theory).toBeLessThan(0.03);
      periods[String(level)] = measured;
    }
    expect(periods['0.1'] ?? 0).toBeGreaterThan(1.8 * (periods['0.62'] ?? 0));
    expect(periods['0.34'] ?? 0).toBeGreaterThan(periods['0.62'] ?? 0);
    expect(periods['0.62'] ?? 0).toBeGreaterThan(periods['0.9'] ?? 0);
  });

  it('sloshes a larger glass more slowly, at the same fill', () => {
    expect(fundamentalPeriod(516, 0.62 * 192)).toBeGreaterThan(fundamentalPeriod(250, 0.62 * 88));
    expect(fundamentalPeriod(250, 0.62 * 88)).toBeGreaterThan(fundamentalPeriod(170, 0.62 * 156));
  });

  it('puts a typical tile in the range of a real cup, 2–4 Hz at 62%', () => {
    for (const [w, h] of [
      [250, 88],
      [170, 156],
    ] as const) {
      const hz = 1 / fundamentalPeriod(w, 0.62 * h);
      expect(hz).toBeGreaterThan(2);
      expect(hz).toBeLessThan(4);
    }
  });

  it('prints the fundamental at four fills when asked', () => {
    if (report === undefined) return;
    const rows: string[] = [];
    for (const [name, w, h, taper] of [
      ['bench tile 200x90', 200, 90, 1],
      ['board small 250x88', 250, 88, 1],
      ['board medium 516x192', 516, 192, 1],
      ['phone small 170x156', 170, 156, 1],
      ['bench glass 96x150', 96, 150, 0.86],
    ] as const) {
      const cells = [0.1, 0.34, 0.62, 0.9].map((level) => {
        const waterline = w * (taper + (1 - taper) * level);
        const t = fundamentalPeriod(waterline, level * h);
        return `${Math.round(level * 100)}% ${(t * 1000).toFixed(0)} ms (${(1 / t).toFixed(2)} Hz)`;
      });
      rows.push(`${name.padEnd(22)} ${cells.join('   ')}`);
    }
    console.log(`\n${rows.join('\n')}`);
  });
});

describe('Slosh: sideways', () => {
  it('piles the water against the LEFT wall when the glass accelerates RIGHT', () => {
    const model = new Slosh({ ...TILE, strength: 1 });
    model.setLevel(0.5, false);
    model.drive(0.3 * G_PX, 0);
    for (let i = 0; i < 4; i += 1) model.step(STEP_S);
    expect(model.heightAt(0)).toBeGreaterThan(0.5 * TILE.height + 1);
    expect(model.heightAt(1)).toBeLessThan(0.5 * TILE.height - 1);
  });

  it('drives only the odd modes, which are the ones a tilt has in it', () => {
    const model = new Slosh({ ...TILE, strength: 1, spray: false, cascade: false });
    model.setLevel(0.5, false);
    model.drive(0.3 * G_PX, 0);
    for (let i = 0; i < 6; i += 1) model.step(STEP_S);
    for (let n = 2; n <= MODE_COUNT; n += 2) expect(model.mode(n)).toBe(0);
    expect(Math.abs(model.mode(1))).toBeGreaterThan(1);
  });

  it('is visually still within 4 s of a flick and asleep soon after, losing energy all the way', () => {
    for (const [w, h] of [
      [200, 90],
      [250, 88],
      [96, 150],
    ] as const) {
      // Breakup off: droplets landing put their water back as bumps, which is energy coming home.
      // The cascade stays on — it is pinned here as never adding energy.
      const model = new Slosh({ width: w, height: h, spray: false });
      model.setLevel(0.62, false);
      let still = -1;
      let asleep = -1;
      const energy: number[] = [];
      play(model, gesture('flick'), h, 8000, (t) => {
        const { low, high } = extremes(model);
        const swing = Math.max(high - 0.62 * h, 0.62 * h - low);
        if (swing > 0.3) still = -1;
        else if (still < 0) still = t;
        // It is asleep before the fling begins; what matters is when it sleeps after.
        if (asleep < 0 && t > 200 && model.asleep) asleep = t;
        if (t > 200 && Math.round(t) % 250 < STEP_S * 1000) energy.push(model.energy());
      });
      expect(still).toBeGreaterThan(0);
      expect(still).toBeLessThan(4000);
      expect(asleep).toBeGreaterThan(0);
      expect(asleep).toBeLessThan(7000);
      for (let i = 1; i < energy.length; i += 1) {
        expect(energy[i] ?? 0).toBeLessThanOrEqual((energy[i - 1] ?? 0) * 1.0001);
      }
      if (report !== undefined) {
        console.log(
          `flick ${w}x${h}: visually still at ${Math.round(still)} ms, asleep at ${Math.round(asleep)} ms`,
        );
      }
    }
  });
});

describe('Slosh: vertical', () => {
  it('leaves the water behind when the glass is yanked down, then lands it', () => {
    const model = new Slosh({ ...TILE, budget: new DropletBudget() });
    model.setLevel(0.62, false);
    let lifted = 0;
    let landedBy = -1;
    play(model, gesture('drop'), TILE.height, 1000, (t) => {
      lifted = Math.max(lifted, model.heave);
      if (lifted > 0 && model.heave === 0 && landedBy < 0) landedBy = t;
    });
    expect(lifted).toBeGreaterThan(1);
    expect(landedBy).toBeGreaterThan(0);
    expect(landedBy).toBeLessThan(200);
    expect(model.landedAt).toBeGreaterThan(300);
  });

  /*
   * Round one landed the slam into the even modes alone, exactly in phase, and 130 ms later the two
   * wall run-ups met in the middle as one perfect cusp. A slam now splashes: droplets off the walls,
   * sheets up them, and a landing that is not symmetric to the pixel.
   */
  it('splashes a slam up BOTH walls, throws droplets, and does not land it perfectly symmetric', () => {
    const model = new Slosh({ ...GLASS_PX, budget: new DropletBudget() });
    model.setLevel(0.62, false);
    let left = 0;
    let right = 0;
    let lean = 0;
    play(model, gesture('drop'), GLASS_PX.height, 300, () => {
      const rest = model.heightAt(0.5) * 0 + 0.62 * GLASS_PX.height - model.aside / GLASS_PX.width;
      left = Math.max(left, model.heightAt(0) - rest);
      right = Math.max(right, model.heightAt(1) - rest);
      for (let n = 1; n <= MODE_COUNT; n += 2) lean = Math.max(lean, Math.abs(model.mode(n)));
    });
    expect(left).toBeGreaterThan(2);
    expect(right).toBeGreaterThan(2);
    expect(model.droplets.thrown).toBeGreaterThanOrEqual(3);
    expect(lean).toBeGreaterThan(0.05);
  });

  it('presses the water at the walls down while the glass is lifted hard, and it rebounds', () => {
    const model = new Slosh({ ...TILE, strength: 1, spray: false, cascade: false });
    model.setLevel(0.62, false);
    // A steady 1 g upward for a third of a second: effective gravity doubles.
    model.drive(0, G_PX);
    let pressed = 0;
    for (let i = 0; i < 20; i += 1) {
      model.step(STEP_S);
      pressed = Math.min(pressed, model.heightAt(0) - 0.62 * TILE.height);
    }
    model.drive(0, 0);
    let rebound = 0;
    for (let i = 0; i < 30; i += 1) {
      model.step(STEP_S);
      rebound = Math.max(rebound, model.heightAt(0) - 0.62 * TILE.height);
    }
    expect(pressed).toBeLessThan(-1.5);
    expect(rebound).toBeGreaterThan(0.3);
    expect(model.gravity).toBeCloseTo(1, 6);
  });

  it('does nothing to still water under gentle vertical motion beyond the press, and sleeps after', () => {
    const model = new Slosh(TILE);
    model.setLevel(0.62, false);
    for (let i = 0; i < 60; i += 1) {
      model.drive(0, 0.05 * G_PX * Math.sin(i / 5));
      model.step(STEP_S);
      expect(model.heave).toBe(0);
    }
    model.drive(0, 0);
    for (let i = 0; i < 600; i += 1) model.step(STEP_S);
    expect(model.asleep).toBe(true);
  });
});

describe('Slosh: a board nobody touches costs nothing', () => {
  it('sleeps, reports nothing to draw, and is not woken by measurement noise', () => {
    const model = new Slosh(TILE);
    model.setLevel(0.5, false);
    model.advance(1000 / 60);
    expect(model.asleep).toBe(true);
    expect(model.advance(1000 / 60)).toBe(false);
    model.drive(1e-6, 0);
    expect(model.advance(1000 / 60)).toBe(false);
    model.tap(0.4);
    expect(model.advance(1000 / 60)).toBe(true);
  });

  it('settles a tap in well under a second', () => {
    const model = new Slosh(TILE);
    model.setLevel(0.5, false);
    model.tap(0.4, 120);
    let steps = 0;
    while (!model.asleep && steps < 600) {
      model.step(STEP_S);
      steps += 1;
    }
    expect(steps * STEP_S).toBeLessThan(1.5);
  });

  it('lets its bubbles go within about a second of the pour ending', () => {
    const model = new Slosh(TILE);
    model.setLevel(0.3, false);
    model.setLevel(0.6);
    let most = 0;
    let gone = -1;
    for (let i = 0; i < 300; i += 1) {
      model.step(STEP_S);
      most = Math.max(most, model.bubbles);
      if (most > 0 && model.bubbles === 0 && gone < 0) gone = i * STEP_S;
    }
    expect(most).toBeGreaterThan(3);
    expect(gone).toBeGreaterThan(0);
    expect(gone).toBeLessThan(2.2);
  });
});

describe('Slosh: the exact step', () => {
  it('matches a fine-grained integration of the same oscillator', () => {
    for (const [w, s] of [
      [16, 1.3],
      [250, 9],
      [4, 6],
    ] as const) {
      const [p11, p12, p21, p22] = propagator(w, s, STEP_S);
      let e = 1;
      let v = 0;
      let fe = 1;
      let fv = 0;
      const fine = 2000;
      const h = STEP_S / fine;
      for (let step = 0; step < 30; step += 1) {
        const ne = p11 * e + p12 * v;
        v = p21 * e + p22 * v;
        e = ne;
        // RK4 on ë = -2σė - ω²e.
        for (let k = 0; k < fine; k += 1) {
          const f = (x: number, y: number): [number, number] => [y, -2 * s * y - w * w * x];
          const [a1, b1] = f(fe, fv);
          const [a2, b2] = f(fe + (h / 2) * a1, fv + (h / 2) * b1);
          const [a3, b3] = f(fe + (h / 2) * a2, fv + (h / 2) * b2);
          const [a4, b4] = f(fe + h * a3, fv + h * b3);
          fe += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
          fv += (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4);
        }
      }
      expect(e).toBeCloseTo(fe, 8);
      expect(v / Math.max(1, w)).toBeCloseTo(fv / Math.max(1, w), 6);
    }
  });

  it('agrees with the dispersion relation it is built on', () => {
    // Deep water: ω² → g k + (γ/ρ) k³. Shallow: ω → k √(g h).
    const k = Math.PI / 200;
    expect(naturalFrequency(1, 200, 10_000) ** 2).toBeCloseTo(
      G_PX * k + CAPILLARITY_PX * k ** 3,
      6,
    );
    // Shallow, capillarity is still a percent of the restoring force at this wavelength.
    expect(naturalFrequency(1, 200, 1) / (k * Math.sqrt(G_PX * 1)) - 1).toBeLessThan(0.01);
    expect(naturalFrequency(1, 200, 1) / (k * Math.sqrt(G_PX * 1)) - 1).toBeGreaterThan(0);
  });
});

describe('Slosh: cost', () => {
  /*
   * Counted, not timed. A test that asserted milliseconds failed whenever the whole suite ran in
   * parallel, which is exactly when CI runs it. What the board's cost actually depends on is how
   * much WORK a glass does, and that is deterministic: none while asleep, a bounded number of steps
   * per frame, and the breakup sampling only while the surface could be violent. The time itself is
   * measured in the browser, by `lab.html?bench=100`.
   */
  it('does no work at all while asleep: no steps, no sampling, however many frames pass', () => {
    const models = Array.from({ length: 100 }, (_, i) => {
      const model = new Slosh({ width: 96, height: 150, seed: i, budget: new DropletBudget() });
      model.setLevel(0.2 + ((i * 37) % 70) / 100, false);
      model.advance(STEP_S * 1000);
      return model;
    });
    for (const model of models) expect(model.asleep).toBe(true);
    const before = models.map((m) => m.steps);
    for (let f = 0; f < 600; f += 1) for (const model of models) model.advance(STEP_S * 1000);
    models.forEach((model, i) => {
      expect(model.steps).toBe(before[i]);
      expect(model.sampledSteps).toBe(0);
    });
  });

  it('takes at most six steps in a frame, however long the frame was', () => {
    const model = new Slosh({ ...TILE, budget: new DropletBudget() });
    model.setLevel(0.5, false);
    model.tap(0.4, 200);
    const before = model.steps;
    model.advance(5000);
    expect(model.steps - before).toBeLessThanOrEqual(6);
  });

  it('samples the surface for breakup on few of the steps of a drag', () => {
    const model = new Slosh({ ...GLASS_PX, budget: new DropletBudget() });
    model.setLevel(0.62, false);
    play(model, gesture('drag'), GLASS_PX.height, 4000);
    expect(model.sampledSteps).toBeLessThan(0.1 * model.steps);
  });

  it.runIf(report !== undefined)(
    'reports the time of a hundred live glasses (not asserted)',
    () => {
      const models = Array.from({ length: 100 }, (_, i) => {
        const model = new Slosh({ width: 96, height: 150, seed: i, budget: new DropletBudget() });
        model.setLevel(0.2 + ((i * 37) % 70) / 100, false);
        return { model, phase: i * 2.4 };
      });
      const frames = 600;
      const started = performance.now();
      for (let f = 0; f < frames; f += 1) {
        for (const { model, phase } of models) {
          model.drive(0.5 * G_PX * Math.sin(f * 0.21 + phase), 0);
          model.step(STEP_S);
        }
      }
      console.log(
        `100 live glasses: ${((performance.now() - started) / frames).toFixed(3)} ms/frame`,
      );
    },
  );
});
