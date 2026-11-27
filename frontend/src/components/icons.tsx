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
 * The logo's symbol, as drawn by the designer (docs/brand/mark-small.svg, unchanged): an ink
 * tumbler with teal water to its middle, on the 16-unit grid that docs/brand/NOTE.md specifies for
 * 16–24px. The top bar draws it at 20px and the front door at 24px, so the small geometry is the
 * right one at both; mark.svg is for 32px and up.
 *
 * The colours come from --logo-ink and --logo-water, which flip with the theme to the designer's
 * dark-ground pair. Decorative: the "Half Full" beside it is the accessible name.
 */
export function MarkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path fill="var(--logo-water)" d="M5 8 H11 V11.5 Q11 13 9.5 13 H6.5 Q5 13 5 11.5 Z" />
      <path
        fill="var(--logo-ink)"
        fillRule="evenodd"
        d="M4 2 H12 V11.5 Q12 14 9.5 14 H6.5 Q4 14 4 11.5 Z M5 3 V11.5 Q5 13 6.5 13 H9.5 Q11 13 11 11.5 V3 Z"
      />
    </svg>
  );
}
