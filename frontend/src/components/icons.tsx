import { useId } from 'react';

interface IconProps {
  className?: string;
}

/**
 * The one mark that means "this happened". Decorative: every place it appears, the surrounding
 * text says the same thing, so a tick is never the only carrier of meaning.
 */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

/**
 * Back a period, and on a period: the same stroke as the tick, drawn on the same 16px box.
 *
 * Decorative, like every icon here. The button around one of these always carries its own
 * label — "Previous week", "Next month" — so the shape is never the only thing that says so.
 */
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/*
 * The navigation set.
 *
 * All decorative — every one of them sits beside a text label, or inside a button that carries
 * its own `aria-label`, so no shape is ever the only thing that says what a control does. They
 * are drawn on the same 16px box and with the same stroke as the two above, so the column reads
 * as one family.
 */

/** The board: an unsorted canvas of tiles at different sizes, which is what it is. */
export function BoardIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="5.5" height="7" rx="1.2" />
      <rect x="9.5" y="2" width="4.5" height="4" rx="1.2" />
      <rect x="2" y="11" width="5.5" height="3" rx="1.2" />
      <rect x="9.5" y="8" width="4.5" height="6" rx="1.2" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
      <path d="M2 6.5h12M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

/** A glass with something in it — the app's one metaphor, at nav size. */
export function GlassIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2h8l-1 11.2a1.2 1.2 0 0 1-1.2 1.1H6.2A1.2 1.2 0 0 1 5 13.2Z" />
      <path d="M4.45 7.5h7.1" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 14a5.25 5.25 0 0 1 10.5 0" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/**
 * The six lights on the mark's plate, in the order `GET /api/areas` returns them, clockwise from
 * the left. Not one of these centres lies inside the glass: the vessel sits at x 7.54–24.46,
 * y 4–26, so the glass stays colourless and the room around it does the colouring.
 */
const MARK_LIGHTS = [
  { area: 'health', cx: 4, cy: 10.5 },
  { area: 'learning', cx: 11, cy: 3 },
  { area: 'money', cx: 21, cy: 3 },
  { area: 'relationships', cx: 28, cy: 10.5 },
  { area: 'work', cx: 27.5, cy: 24.5 },
  { area: 'creative', cx: 4.5, cy: 24.5 },
] as const;

/**
 * The brand mark: the favicon's glass, as a component so the top bar can carry it.
 *
 * A tumbler and the same tumbler cut at the waterline, filled and never stroked, on a plate lit by
 * six lights — one per life area, clockwise from the left. The waterline has no line of its own: it
 * is the alpha step from --mark-ink-empty to --mark-ink, a harder edge than any hairline at this
 * size. The alpha rides in the colour rather than in an `opacity` attribute so that this component
 * depends on `var()` resolving in one kind of place, a `fill`, rather than in two.
 *
 * THE SCALE IS 11/13 AND THAT IS ARITHMETIC. It puts the 26-unit vessel on 22 units, so at a 16px
 * favicon the lip lands on row 2.000, the waterline on 7.077 and the base on 13.000, and the step
 * from empty glass to water is carried by a single device-pixel row (measured: 16.0, 16.1, 16.0,
 * then 82.9, with nothing in between). At 1.0 the glass fills the plate and the lights have nowhere
 * to stand; at 0.72 that row reads 55.6 and the waterline is a smear. Keep this geometry in step
 * with public/favicon.svg, which draws the same thing for a browser that cannot read a token.
 *
 * THE GLASS IS COLOURLESS AND THE ROOM IS NOT. Colour means life area in this app and may never
 * appear alone, so the question a coloured mark has to answer is not "are there six hues" but "does
 * any single coloured element silently claim one area?". All six are here, the set rather than a
 * member, and none of them is on the glass or in the water — which is also why --accent is nowhere
 * near this component: it sits four points from --area-health, so a single green glass eighteen
 * pixels tall would read as a health goal above a board where green means exactly that.
 *
 * THE PLATE IS ALWAYS THE NIGHT, on both themes, which is why the six values are --mark-area-*
 * rather than --area-*: the mark carries its own room instead of following the app's, so it is one
 * artwork in a pale top bar, a dark one, and a browser tab.
 *
 * It is NOT the nav's `GlassIcon`, and the difference is technique rather than shape: this is a
 * solid two-tone glass on a plate, that is a 1.4px outline on a 16 box with nothing behind it.
 * Making either look like the other collapses the separation between the product's mark and a
 * section of it. Also: never a ring (a half-filled circle is the system dark-mode glyph), never a
 * second horizontal (an etched line inside a glass means a habit's minimum here), never a hue on
 * the glass, and never any motion — the water is the thing that moves and a logo that fills is a
 * progress bar.
 *
 * The ids are per-instance. The top bar and the drawer both render this, and two `<linearGradient
 * id="plate">` in one document is one gradient with two references to it — which survives until one
 * of the two unmounts and takes the definition with it.
 */
export function MarkIcon({ className }: IconProps) {
  // `useId` returns something like `:r3:`, and a colon inside `url(#…)` is a fragment a browser is
  // entitled to read as a selector. Strip them rather than find out per browser.
  const uid = useId().replace(/:/g, '');
  const ref = (name: string) => `${name}-${uid}`;

  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient
          id={ref('plate')}
          gradientUnits="userSpaceOnUse"
          x1="14.16"
          y1="-1.49"
          x2="17.84"
          y2="33.49"
        >
          <stop offset="0" stopColor="var(--mark-plate-top)" />
          <stop offset="1" stopColor="var(--mark-plate-bottom)" />
        </linearGradient>

        {MARK_LIGHTS.map(({ area }) => (
          <radialGradient key={area} id={ref(area)}>
            <stop offset="0" stopColor={`var(--mark-area-${area})`} stopOpacity="0.82" />
            <stop offset="0.28" stopColor={`var(--mark-area-${area})`} stopOpacity="0.344" />
            <stop offset="0.62" stopColor={`var(--mark-area-${area})`} stopOpacity="0.093" />
            <stop offset="1" stopColor={`var(--mark-area-${area})`} stopOpacity="0" />
          </radialGradient>
        ))}

        <clipPath id={ref('tile')}>
          <rect width="32" height="32" rx="7" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${ref('tile')})`}>
        <rect width="32" height="32" fill={`url(#${ref('plate')})`} />
        {MARK_LIGHTS.map(({ area, cx, cy }) => (
          <circle key={area} cx={cx} cy={cy} r="7.4" fill={`url(#${ref(area)})`} />
        ))}
      </g>

      <g transform="translate(2.4615 2.3077) scale(0.846154)">
        <path fill="var(--mark-ink-empty)" d="M6 2H26L24.154 26Q24 28 22 28H10Q8 28 7.846 26Z" />
        <path fill="var(--mark-ink)" d="M6.923 14H25.077L24.154 26Q24 28 22 28H10Q8 28 7.846 26Z" />
      </g>
    </svg>
  );
}
