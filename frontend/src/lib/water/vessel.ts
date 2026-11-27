/*
 * The inside of a glass: the shape the liquid fills and is clipped to.
 *
 * The numbers are design-agent's tokens (`--vessel-*` in tokens.css), read once per measure, so the
 * liquid this canvas draws and the glass the SVG around it draws are the same shape. The glass
 * itself — walls, rim, base, etches — is the SVG's; this file knows only where its inside is.
 *
 * The geometry is the bench's: the rim is the top edge of the box, the walls lean in to a floor
 * `taper` times as wide, and the floor's corners are rounded by `floor-r` times the rim width. The
 * foot under the floor (`--vessel-foot`) is glass, outside the liquid, and not read here.
 */

import type { PathSink } from './path';
import { DEFAULT_STRENGTH, Slosh, realScale, type SloshOptions } from './slosh';

/** The inside of a vessel, CSS px. */
export interface LiquidVessel {
  width: number;
  height: number;
  /** Floor width over rim width: 1 for straight walls, 0.86 for the board's glasses. */
  taper: number;
  /** Radius of the floor's corners, px. */
  radius: number;
}

export type VesselSize = 'small' | 'medium' | 'large';

const KEY: Record<VesselSize, string> = { small: 'sm', medium: 'md', large: 'lg' };

/**
 * The tokens' own values, for a page with no stylesheet — jsdom, chiefly, where nothing is painted
 * anyway. Change them with the tokens, or a test page and a real one draw different glasses.
 */
export const VESSEL_FALLBACK = {
  small: { width: 64, height: 100 },
  medium: { width: 80, height: 125 },
  large: { width: 96, height: 150 },
  taper: 0.86,
  floorRadius: 0.146,
} as const;

function readNumber(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The inside of a glass of this size, from whatever theme is in force where `styles` came from. */
export function readVessel(styles: CSSStyleDeclaration, size: VesselSize): LiquidVessel {
  const key = KEY[size];
  const width = readNumber(styles, `--vessel-${key}-w`, VESSEL_FALLBACK[size].width);
  const height = readNumber(styles, `--vessel-${key}-h`, VESSEL_FALLBACK[size].height);
  const taper = readNumber(styles, '--vessel-taper', VESSEL_FALLBACK.taper);
  const floorRadius = readNumber(styles, '--vessel-floor-r', VESSEL_FALLBACK.floorRadius);
  return { width, height, taper, radius: floorRadius * width };
}

/**
 * The inside of a glass whose box has been MEASURED — the slot `GoalGlass` gives the liquid is
 * exactly the vessel's inside — with the taper and the floor's radius from the tokens. This is how
 * the live water knows its size without being told it, and why a tile resized by `+` / `−` needs
 * nothing more than its box being measured again.
 */
export function readVesselBox(
  styles: CSSStyleDeclaration,
  width: number,
  height: number,
): LiquidVessel {
  const taper = readNumber(styles, '--vessel-taper', VESSEL_FALLBACK.taper);
  const floorRadius = readNumber(styles, '--vessel-floor-r', VESSEL_FALLBACK.floorRadius);
  return { width, height, taper, radius: floorRadius * width };
}

/** How far in a wall is at height `y` above the floor, px: the taper, measured from the rim. */
export function wallInsetAt(vessel: LiquidVessel, y: number): number {
  const half = ((1 - vessel.taper) * vessel.width) / 2;
  return half * (1 - Math.max(0, Math.min(vessel.height, y)) / vessel.height);
}

/**
 * The vessel's inside: square at the rim, tapered, rounded where the floor is. The same path the
 * SVG glass draws its cavity with — `GlassStudy.tsx`'s `vessel` — so the two cannot disagree.
 */
export function traceVessel(sink: PathSink, vessel: LiquidVessel): void {
  const { width: W, height: H, taper } = vessel;
  const inset = ((1 - taper) * W) / 2;
  const r = Math.max(0, Math.min(vessel.radius, (W - 2 * inset) / 2, H));
  sink.moveTo(0, 0);
  sink.lineTo(W, 0);
  sink.lineTo(W - inset, H - r);
  sink.quadraticCurveTo(W - inset, H, W - inset - r, H);
  sink.lineTo(inset + r, H);
  sink.quadraticCurveTo(inset, H, inset, H - r);
  sink.closePath();
}

/**
 * The water for a glass this shape, as the owner chose it (2026-11-25): an 8 cm drinking glass
 * (`realScale`) at `DEFAULT_STRENGTH`. Everything else is the model's default and may be overridden.
 */
export function createGlass(
  vessel: LiquidVessel,
  options: Partial<Omit<SloshOptions, 'width' | 'height' | 'taper'>> = {},
): Slosh {
  return new Slosh({
    metresPerPx: realScale(vessel.width),
    strength: DEFAULT_STRENGTH,
    ...options,
    width: vessel.width,
    height: vessel.height,
    taper: vessel.taper,
  });
}
