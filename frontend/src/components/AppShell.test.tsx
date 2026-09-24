import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppShell, type ShellSession } from './AppShell';
import { forgetBrowserMemory } from '../test/harness';

/*
 * The frame, on its own: where you are, and what the drawer does to the keyboard.
 *
 * The drawer is the part worth this much test. A panel that covers the page but leaves Tab walking
 * into it is worse than no panel — the focus ring goes somewhere invisible and there is no way back
 * except guessing — so every one of the four behaviours it promises is asserted here: focus in,
 * Tab held inside, Escape out, focus back where it came from. The page behind it being `inert` is
 * the same promise for a pointer and a screen reader.
 *
 * `AppShell` takes its session as a prop, so none of this needs a gate, a token or a stubbed fetch.
 */
const SESSION: ShellSession = { goalsOnBoard: 5, glassesFilled: 7, isAnonymous: true };

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell session={SESSION}>
        <section aria-label="A page">
          <button type="button">Something on the page</button>
        </section>
      </AppShell>
    </MemoryRouter>,
  );
}

/** The drawer, or nothing: it is only in the tree while it is open. */
function drawer(): HTMLElement | null {
  return screen.queryAllByRole('navigation', { name: 'Sections' })[1] ?? null;
}

function openDrawer(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const open = drawer();
  if (open === null) throw new Error('the drawer did not open');
  return open;
}

/** Every tab stop inside the drawer, in document order. */
function stops(within: HTMLElement): HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
}

describe('AppShell', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('heads the page with the section it is on, and marks that section current', () => {
    renderShell('/glasses');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My full glasses');
    expect(screen.getByRole('link', { name: /^My full glasses/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('says how many are on the board and how many are filled, in words', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Board, 5 on the board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My full glasses, 7 filled' })).toBeInTheDocument();
  });

  describe('the drawer', () => {
    it('is not in the tree until it is asked for', () => {
      renderShell();

      expect(drawer()).toBeNull();
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('takes focus when it opens, rather than leaving it behind the panel', () => {
      renderShell();
      const open = openDrawer();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
      expect(open).toContainElement(document.activeElement as HTMLElement);
    });

    it('holds Tab inside itself, wrapping at both ends', () => {
      renderShell();
      const open = openDrawer();

      const inside = stops(open);
      const first = inside[0];
      const last = inside[inside.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (first === undefined || last === undefined) return;

      last.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(first);

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('makes the page behind it inert, so nothing there can be reached by mistake', () => {
      renderShell();
      openDrawer();

      const page = screen.getByRole('region', { name: 'A page' });
      const body = page.closest('.shell__body');
      expect(body).not.toBeNull();
      expect(body).toHaveAttribute('inert');
      expect(screen.getByRole('banner')).toHaveAttribute('inert');
    });

    it('closes on Escape and hands focus back to the button that opened it', () => {
      renderShell();
      openDrawer();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
    });

    it('closes on its own close button, and hands focus back the same way', () => {
      renderShell();
      openDrawer();

      fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));

      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
    });

    it('closes when the scrim is clicked', () => {
      const { container } = renderShell();
      openDrawer();

      const scrim = container.querySelector('.scrim');
      expect(scrim).not.toBeNull();
      if (scrim !== null) fireEvent.click(scrim);

      expect(drawer()).toBeNull();
    });

    it('closes on a navigation, and puts focus on the page arrived at — not back on the menu', () => {
      renderShell();
      const open = openDrawer();

      const link = stops(open).find((stop) => stop.textContent.includes('Calendar'));
      expect(link).toBeDefined();
      if (link === undefined) return;
      fireEvent.click(link);

      expect(drawer()).toBeNull();

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Calendar');
      expect(document.activeElement).toBe(heading);
    });

    it('leaves the page alone once it is shut', () => {
      renderShell();
      openDrawer();
      fireEvent.keyDown(document, { key: 'Escape' });

      const page = screen.getByRole('region', { name: 'A page' });
      expect(page.closest('.shell__body')).not.toHaveAttribute('inert');
    });
  });

  describe('the column', () => {
    it('collapses to a rail, and the links keep their names', () => {
      renderShell();

      fireEvent.click(screen.getByRole('button', { name: /Collapse/ }));

      const column = screen.getByRole('navigation', { name: 'Sections' });
      expect(column).toHaveAttribute('data-collapsed', 'true');
      expect(screen.getByRole('link', { name: 'Board, 5 on the board' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Expand/ })).toBeInTheDocument();
    });

    it('opens collapsed next time, because that is what was asked for', () => {
      const first = renderShell();
      fireEvent.click(screen.getByRole('button', { name: /Collapse/ }));
      first.unmount();

      renderShell();
      expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveAttribute(
        'data-collapsed',
        'true',
      );
    });
  });
});
