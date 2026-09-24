/*
 * Keeping Tab inside an open drawer, and letting Escape out of it.
 *
 * A drawer that merely covers the page is a trap for a mouse and a lie for a keyboard: Tab walks
 * straight off the end of it into a menu the person cannot see, and the only way back is to guess
 * how many stops it takes. The rest of the page being `inert` is what stops a pointer and a screen
 * reader reaching it; this is what stops the Tab key.
 *
 * It deliberately does NOT restore focus. Where focus belongs afterwards depends on why the panel
 * closed — back to the trigger when a person dismissed it, on to the new page's heading when they
 * navigated — and only the caller knows which happened.
 */

import { useEffect, type RefObject } from 'react';

/**
 * The things a browser will stop on, as a selector.
 *
 * `[tabindex]:not([tabindex="-1"])` catches anything made focusable by hand; the `tabIndex`
 * filter below catches the rest, because a disabled or programmatically-skipped control matches
 * the selector but is not a stop.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Every tab stop inside `root`, in document order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute('hidden'),
  );
}

export interface FocusTrapOptions {
  /** While false the hook does nothing at all — no listener, no focus moved. */
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** Escape, or Tab with nothing to land on. Usually "close me". */
  onEscape: () => void;
}

export function useFocusTrap({ active, containerRef, onEscape }: FocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (container === null) return;

    // Opening a panel and leaving focus behind it is the same bug as not trapping at all.
    focusablesIn(container)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;

      const stops = focusablesIn(container);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing to land on: holding Tab still is better than letting it escape unseen.
        event.preventDefault();
        return;
      }

      const focused = container.ownerDocument.activeElement;
      const outside = !container.contains(focused);

      if (event.shiftKey && (focused === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    const document = container.ownerDocument;
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, containerRef, onEscape]);
}
