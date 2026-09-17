import type { CSSProperties } from 'react';

/**
 * A style object that may also carry CSS custom properties.
 *
 * The glass level, the "was" hairline, the habit minimum and the stagger index are numbers that
 * belong to one element, so they travel as `--p`, `--from`, `--min` and `--i` rather than as
 * generated classes. Everything those numbers mean is still decided in CSS.
 */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;
