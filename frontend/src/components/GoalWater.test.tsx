import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { driverState } from '../lib/water/driver';
import type { Slosh } from '../lib/water/slosh';
import { GoalGlass } from './GoalGlass';
import { GoalWater } from './GoalWater';

/** Every glass `GoalWater` builds, so a test can read the water it is driving. */
const made = vi.hoisted(() => [] as Slosh[]);

vi.mock('../lib/water/vessel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/water/vessel')>();
  return {
    ...actual,
    createGlass: (...args: Parameters<typeof actual.createGlass>) => {
      const glass = actual.createGlass(...args);
      made.push(glass);
      return glass;
    },
  };
});

/** Runs the shared loop for a handful of frames: jsdom's animation frames are timers. */
async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve(null);
        });
      });
    });
  }
}

/** A media query the test answers, with `change` events it can send. */
function stubMedia(matches: (query: string) => boolean): { flip(query: string): void } {
  const lists = new Map<
    string,
    MediaQueryList & { listeners: Set<(e: MediaQueryListEvent) => void> }
  >();
  vi.stubGlobal('matchMedia', (query: string) => {
    let list = lists.get(query);
    if (list === undefined) {
      const listeners = new Set<(e: MediaQueryListEvent) => void>();
      list = {
        matches: matches(query),
        media: query,
        listeners,
        addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
          listeners.delete(fn),
      } as unknown as MediaQueryList & { listeners: Set<(e: MediaQueryListEvent) => void> };
      lists.set(query, list);
    }
    return list;
  });
  return {
    flip(query) {
      const list = lists.get(query);
      if (list === undefined) return;
      for (const fn of list.listeners) fn({ matches: true } as MediaQueryListEvent);
    },
  };
}

/** What jsdom lacks for the live path: a 2D context, Path2D, ResizeObserver and a measured box. */
function stubCanvas(box = { width: 96, height: 150 }, layout = { left: 0 }): { draws: number } {
  const counter = { draws: 0 };
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(target, key) {
      if (key === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (key === 'clearRect') {
        return () => {
          counter.draws += 1;
        };
      }
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo = (): undefined => undefined;
      lineTo = (): undefined => undefined;
      quadraticCurveTo = (): undefined => undefined;
      closePath = (): undefined => undefined;
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = (): undefined => undefined;
      disconnect = (): undefined => undefined;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(box.width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(box.height);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(() => layout.left);
  // On screen: jsdom has no layout, so every rect is empty and every glass would be out of sight.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: box.width,
    bottom: box.height,
    width: box.width,
    height: box.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return counter;
}

function host(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('.goal-tile__water');
  if (found === null) throw new Error('no water host');
  return found;
}

describe('GoalWater', () => {
  beforeEach(() => {
    made.length = 0;
  });

  afterEach(async () => {
    await frames(1);
  });

  it('stays the still liquid in jsdom, where there is no canvas context', async () => {
    stubMedia(() => false);
    const { container } = render(
      <span data-area="money">
        <GoalGlass size="large" level={62} minimumLevel={null} previousLevel={null} kept={false}>
          <GoalWater level={0.62} />
        </GoalGlass>
      </span>,
    );
    await frames(3);
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(false);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.goal-glass__still')).not.toBeNull();
    expect(made).toHaveLength(0);
  });

  it('never goes live for a reader who asked for less motion, and builds no water at all', async () => {
    stubMedia((query) => query.includes('reduced-motion'));
    stubCanvas();
    const { container } = render(<GoalWater level={0.5} />);
    await frames(3);
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(false);
    expect(container.querySelector('canvas')).toBeNull();
    expect(made).toHaveLength(0);
  });

  it('goes live only once a frame has been painted, at the level it was given, without pouring', async () => {
    stubMedia(() => false);
    const canvas = stubCanvas();
    const { container } = render(<GoalWater level={0.3} />);
    // Mounted, measured, joined — and not yet painted: the still liquid must still be showing.
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(false);
    await frames(2);
    expect(canvas.draws).toBeGreaterThan(0);
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(true);
    // The first level is a fact: the glass IS this full, nothing poured.
    expect(made[0]?.drawnLevel).toBe(0.3);
    expect(made[0]?.bubbles).toBe(0);
  });

  it('pours a tick in and drains an undo back, and the water is the level all the way', async () => {
    stubMedia(() => false);
    stubCanvas();
    const { rerender } = render(<GoalWater level={0.3} />);
    await frames(2);
    const glass = made[0];
    expect(glass).toBeDefined();

    rerender(<GoalWater level={0.6} />);
    await frames(3);
    // On its way up, not there at once: a pour, not a jump.
    expect(glass?.level).toBe(0.6);
    expect(glass?.drawnLevel ?? 0).toBeGreaterThan(0.3);
    expect(glass?.drawnLevel ?? 1).toBeLessThan(0.6);

    rerender(<GoalWater level={0.3} />);
    await frames(3);
    expect(glass?.level).toBe(0.3);
    expect(glass?.drawnLevel ?? 0).toBeGreaterThan(0.3);
  });

  it('holds a full glass still when it is carried, and sloshes one that is not', async () => {
    stubMedia(() => false);
    const layout = { left: 0 };
    stubCanvas({ width: 96, height: 150 }, layout);
    render(
      <>
        <GoalWater level={1} />
        <GoalWater level={0.5} />
      </>,
    );
    await frames(3);
    const [full, half] = made;
    const before = [full?.steps ?? 0, half?.steps ?? 0];
    // Both glasses carried 150 px along the shelf, as a rearrange does.
    layout.left = 150;
    // A rearrange comes with a key or a pointer, which is what wakes the loop to measure it.
    window.dispatchEvent(new Event('keydown'));
    await frames(6);
    expect(full?.asleep).toBe(true);
    expect(full?.steps).toBe(before[0]);
    expect((half?.steps ?? 0) - (before[1] ?? 0)).toBeGreaterThan(0);
  });

  it('lets go at once if less motion is asked for while it runs, and cleans up on unmounting', async () => {
    const media = stubMedia(() => false);
    stubCanvas();
    const { container, unmount } = render(<GoalWater level={0.5} />);
    await frames(2);
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(true);
    expect(driverState().glasses).toBe(1);

    act(() => {
      media.flip('(prefers-reduced-motion: reduce)');
    });
    expect(host(container).classList.contains('goal-tile__water--live')).toBe(false);
    expect(container.querySelector('canvas')).toBeNull();
    expect(driverState().glasses).toBe(0);
    unmount();
  });
});
