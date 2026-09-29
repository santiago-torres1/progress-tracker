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
 * The brand mark: the favicon's glass, as a component so the top bar can carry it.
 *
 * Two paths on a 32 box — a tumbler, and the same tumbler cut at the waterline — filled, never
 * stroked. The waterline has no line of its own: it is the alpha step from 0.26 to 1, which is a
 * harder edge than any hairline and costs nothing at this size. `currentColor` is the whole theme
 * story, so there is one artwork and no `<style>` block.
 *
 * It is NOT the nav's `GlassIcon`, and the difference is technique rather than shape: this is solid
 * two-tone, that is a 1.4px outline on a 16 box. Making either look like the other collapses the
 * separation between the product's mark and a section of it. Also: never a ring (a half-filled
 * circle is the system dark-mode glyph), never a second horizontal (an etched line inside a glass
 * means a habit's minimum here), never a hue, and never any motion — the water is the thing that
 * moves and a logo that fills is a progress bar.
 */
export function MarkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
      <path opacity="0.26" d="M6 2H26L24.154 26Q24 28 22 28H10Q8 28 7.846 26Z" />
      <path d="M6.923 14H25.077L24.154 26Q24 28 22 28H10Q8 28 7.846 26Z" />
    </svg>
  );
}
