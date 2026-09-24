import { afterEach, describe, expect, it, vi } from 'vitest';
import { driverState, join, wake } from './driver';

/** Runs the loop for a handful of frames, since jsdom's rAF is a timer. */
async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(null);
      });
    });
  }
}

function element(left = 0): HTMLElement {
  const node = document.createElement('div');
  node.getBoundingClientRect = () =>
    ({
      left,
      top: 0,
      right: left + 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: left,
      y: 0,
    }) as DOMRect;
  document.body.appendChild(node);
  return node;
}

describe('the water driver', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('carries a glass and lets it go', () => {
    const leave = join({ element: element(), moved: () => undefined, render: () => false });
    expect(driverState().glasses).toBe(1);

    leave();
    expect(driverState().glasses).toBe(0);
  });

  /*
   * A board nobody is touching must cost nothing. If the loop kept requesting frames for still
   * water, a laptop would spin its fan over a page that is not moving.
   */
  it('stops asking for frames once every glass is still', async () => {
    const leave = join({ element: element(), moved: () => undefined, render: () => false });
    await frames(3);

    expect(driverState().running).toBe(false);
    leave();
  });

  it('keeps going while something is still moving', async () => {
    const render = vi.fn(() => true);
    const leave = join({ element: element(), moved: () => undefined, render });
    await frames(3);

    expect(render.mock.calls.length).toBeGreaterThan(1);
    expect(driverState().running).toBe(true);
    leave();
    await frames(1);
  });

  it('reports how far a tile moved, and says nothing when it did not', async () => {
    const node = element(0);
    const moved = vi.fn();
    const leave = join({ element: node, moved, render: () => true });

    await frames(2);
    expect(moved).not.toHaveBeenCalled();

    node.getBoundingClientRect = () =>
      ({
        left: 24,
        top: 0,
        right: 124,
        bottom: 100,
        width: 100,
        height: 100,
        x: 24,
        y: 0,
      }) as DOMRect;
    await frames(2);

    expect(moved).toHaveBeenCalledWith(24);
    leave();
    await frames(1);
  });

  /*
   * The bug this exists to prevent, reported from the live app: "the water only works when logging
   * a value, and only for 30 seconds or so".
   *
   * Movement is detected by measuring, and measuring only happens inside this loop — so once the
   * loop stops over still water it has switched off the only sense it has, and no amount of
   * dragging will ever wake it. Everything else about the feature worked; it was simply asleep.
   */
  it('wakes when a pointer goes down, so a drag on still water is seen', async () => {
    const node = element(0);
    const moved = vi.fn();
    const leave = join({ element: node, moved, render: () => false });

    await frames(3);
    expect(driverState().running).toBe(false);

    window.dispatchEvent(new Event('pointerdown'));
    expect(driverState().running).toBe(true);

    /*
     * The pause is the whole test. A finger goes down and rests for a moment before it moves, and
     * over still water those frames give the loop every reason to stop. Waking on `pointerdown`
     * alone is not enough — it has to KEEP running for as long as the pointer is down, because the
     * movement it exists to notice has not happened yet.
     */
    await frames(4);
    expect(driverState().running).toBe(true);

    node.getBoundingClientRect = () =>
      ({
        left: 18,
        top: 0,
        right: 118,
        bottom: 100,
        width: 100,
        height: 100,
        x: 18,
        y: 0,
      }) as DOMRect;
    await frames(2);

    expect(moved).toHaveBeenCalledWith(18);

    window.dispatchEvent(new Event('pointerup'));
    await frames(3);
    expect(driverState().running).toBe(false);

    leave();
  });

  it('can be woken again after everything went quiet', async () => {
    let moving = false;
    const leave = join({ element: element(), moved: () => undefined, render: () => moving });
    await frames(3);
    expect(driverState().running).toBe(false);

    moving = true;
    wake();
    await frames(2);
    expect(driverState().running).toBe(true);

    moving = false;
    leave();
    await frames(2);
  });
});
