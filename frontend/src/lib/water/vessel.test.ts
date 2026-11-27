import { describe, expect, it } from 'vitest';
import type { PathSink } from './path';
import { DEFAULT_STRENGTH, realScale } from './slosh';
import { LIQUID_STOPS, liquidStops } from './liquidPaint';
import { readLiquidTints } from './tints';
import { VESSEL_FALLBACK, createGlass, readVessel, traceVessel, wallInsetAt } from './vessel';

/** A computed style with just these custom properties set. */
function styles(values: Record<string, string>): CSSStyleDeclaration {
  const fake = { getPropertyValue: (name: string): string => values[name] ?? '' };
  return fake as unknown as CSSStyleDeclaration;
}

describe('the vessel, from the tokens', () => {
  it('reads the glass sizes, taper and floor radius design-agent set', () => {
    const vessel = readVessel(
      styles({
        '--vessel-md-w': '80',
        '--vessel-md-h': '125',
        '--vessel-taper': '0.86',
        '--vessel-floor-r': '0.146',
      }),
      'medium',
    );
    expect(vessel).toEqual({ width: 80, height: 125, taper: 0.86, radius: 0.146 * 80 });
  });

  it('falls back to the tokens’ own values where there is no stylesheet (jsdom)', () => {
    const vessel = readVessel(styles({}), 'small');
    expect(vessel.width).toBe(VESSEL_FALLBACK.small.width);
    expect(vessel.height).toBe(VESSEL_FALLBACK.small.height);
    expect(vessel.taper).toBe(VESSEL_FALLBACK.taper);
  });

  it('traces the inside the SVG glass draws: rim, tapered walls, rounded floor', () => {
    const points: [number, number][] = [];
    const sink: PathSink = {
      moveTo: (x, y) => points.push([x, y]),
      lineTo: (x, y) => points.push([x, y]),
      quadraticCurveTo: (_cx, _cy, x, y) => points.push([x, y]),
      closePath: () => undefined,
    };
    const vessel = { width: 96, height: 150, taper: 0.86, radius: 14 };
    traceVessel(sink, vessel);
    const inset = (0.14 * 96) / 2;
    expect(points).toEqual([
      [0, 0],
      [96, 0],
      [96 - inset, 136],
      [96 - inset - 14, 150],
      [inset + 14, 150],
      [inset, 136],
    ]);
    expect(wallInsetAt(vessel, 150)).toBe(0);
    expect(wallInsetAt(vessel, 0)).toBeCloseTo(inset, 9);
  });

  it('makes the glass the owner chose: an 8 cm drinking glass at the default strength', () => {
    const vessel = { width: 64, height: 100, taper: 0.86, radius: 9.3 };
    const glass = createGlass(vessel);
    expect(glass.strength).toBe(DEFAULT_STRENGTH);
    // The scale is `realScale(64)`: a 64 px glass is a 7 cm one, so it rocks like one.
    expect(realScale(64) * 64).toBeCloseTo(0.08 * (64 / 96) ** 0.3, 9);
    expect(glass.waterlineAt(1)).toBe(64);
    expect(glass.waterlineAt(0)).toBeCloseTo(64 * 0.86, 9);
  });
});

describe('the liquid tints', () => {
  it('reads --liquid-* in either theme, and falls back to the tokens’ values in jsdom', () => {
    const read = readLiquidTints(
      styles({
        '--liquid-top': '30%',
        '--liquid-mid': '50%',
        '--liquid-deep': '64%',
        '--liquid-top-full': '34%',
        '--liquid-mid-full': '54%',
        '--liquid-deep-full': '68%',
      }),
    );
    expect(read.resting).toEqual([0.3, 0.5, 0.64]);
    expect(read.full).toEqual([0.34, 0.54, 0.68]);
    const none = readLiquidTints(styles({}));
    expect(none.resting).toBeUndefined();
    expect(liquidStops(none, false)).toEqual(LIQUID_STOPS.resting);
    expect(liquidStops(none, true)).toEqual(LIQUID_STOPS.full);
  });
});
