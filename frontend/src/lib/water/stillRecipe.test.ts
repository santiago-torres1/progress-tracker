/*
 * THE STILL LIQUID AND THE LIVE ONE ARE ONE RECIPE.
 *
 * `GoalGlass` draws the liquid at rest in SVG for anyone the canvas does not run for (less motion,
 * no context, jsdom), and the live painter hands over to it and back. Its geometry already IS the
 * painter's — it imports `buildEdge`, `traceBody`, `traceTopSurface` and the constants — but its fill
 * alphas are CSS (`GoalGlass.css`), which cannot import a number. So this reads that stylesheet and
 * pins each of them to the constant it mirrors. Change either side alone and this fails, naming the
 * number: the two drawing different liquids is the bug CLAUDE.md records twice.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  BAND_MIX,
  EDGE_ALPHA,
  EDGE_WIDTH,
  FILM_SHARE,
  LIQUID_STOPS,
  WALL_ALPHA_ROUND,
  WALL_FAR_SHARE,
  bandAlpha,
} from './liquidPaint';

/*
 * Read from disk: vitest strips stylesheets, `?raw` included, and the app's TypeScript has no Node
 * types — so `fs` comes in through an import the type checker does not resolve.
 */
let css = '';

beforeAll(async () => {
  const name = 'node:fs';
  const fs = (await import(/* @vite-ignore */ name)) as {
    readFileSync(path: string, encoding: 'utf8'): string;
  };
  // Relative to the package, which is where vitest runs; jsdom's `import.meta.url` is not a file.
  css = fs.readFileSync('src/components/GoalGlass.css', 'utf8');
});

/** The declarations of one rule, by its selector. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`GoalGlass.css has no ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

function number(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) throw new Error(`no ${String(pattern)} in ${text}`);
  return Number.parseFloat(match[1]);
}

describe("GoalGlass's still liquid mirrors the live painter", () => {
  it('lightens the film under the surface by the same share', () => {
    expect(number(rule('.goal-glass__stop-film'), /var\(--lq-top\) \* ([\d.]+)/)).toBe(FILM_SHARE);
  });

  it('darkens the walls by the same strips', () => {
    expect(number(rule('.goal-glass__stop-wall-near'), /([\d.]+)%/) / 100).toBeCloseTo(
      WALL_ALPHA_ROUND,
      9,
    );
    expect(number(rule('.goal-glass__stop-wall-far'), /([\d.]+)%/) / 100).toBeCloseTo(
      WALL_ALPHA_ROUND * WALL_FAR_SHARE,
      9,
    );
  });

  it('lights the top surface with the same mix and strength, resting and full', () => {
    const band = rule('.goal-glass__band');
    expect(1 - number(band, /var\(--goal\) ([\d.]+)%, white/) / 100).toBeCloseTo(BAND_MIX, 9);
    const opacity = number(band, /fill-opacity: ([\d.]+)/);
    expect(opacity).toBe(bandAlpha(LIQUID_STOPS.resting[0]));
    expect(opacity).toBe(bandAlpha(LIQUID_STOPS.full[0]));
  });

  it('strokes the front edge the same', () => {
    const edge = rule('.goal-glass__edge');
    expect(number(edge, /stroke-opacity: ([\d.]+)/)).toBe(EDGE_ALPHA);
    expect(number(edge, /stroke-width: ([\d.]+)/)).toBe(EDGE_WIDTH);
  });
});
