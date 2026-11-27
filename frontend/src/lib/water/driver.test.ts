import { afterEach, describe, expect, it, vi } from 'vitest';
import { driverState, join, layoutCentre, wake } from './driver';
import { CARRY_S } from './motion';

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
    const leave = join({ element: element(), render: () => false });
    expect(driverState().glasses).toBe(1);

    leave();
    expect(driverState().glasses).toBe(0);
  });

  /*
   * A board nobody is touching must cost nothing. If the loop kept requesting frames for still
   * water, a laptop would spin its fan over a page that is not moving.
   */
  it('stops asking for frames once every glass is still', async () => {
    const leave = join({ element: element(), render: () => false });
    await frames(3);

    expect(driverState().running).toBe(false);
    leave();
  });

  it('keeps going while something is still moving', async () => {
    const render = vi.fn(() => true);
    const leave = join({ element: element(), render });
    await frames(3);

    expect(render.mock.calls.length).toBeGreaterThan(1);
    expect(driverState().running).toBe(true);
    leave();
    await frames(1);
  });

  it('reports a glass moving, and says nothing when it did not', async () => {
    const layout = { left: 0 };
    const node = element(0);
    Object.defineProperty(node, 'offsetLeft', { get: () => layout.left });
    const accelerated = vi.fn();
    const leave = join({ element: node, render: () => true, accelerated });

    await frames(2);
    expect(accelerated.mock.calls.every(([ax, ay]) => ax === 0 && ay === 0)).toBe(true);

    layout.left = 24;
    await frames(2);

    expect(accelerated.mock.calls.some(([ax]) => (ax as number) > 0)).toBe(true);
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
    const layout = { left: 0 };
    const node = element(0);
    Object.defineProperty(node, 'offsetLeft', { get: () => layout.left });
    const accelerated = vi.fn();
    const leave = join({ element: node, render: () => false, accelerated });

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

    layout.left = 18;
    await frames(2);

    expect(accelerated.mock.calls.some(([ax]) => (ax as number) > 0)).toBe(true);

    window.dispatchEvent(new Event('pointerup'));
    // The hand that carried the glass 18 px has to arrive before the loop may stop: about a second.
    for (let i = 0; i < 150 && driverState().running; i += 1) await frames(1);
    expect(driverState().running).toBe(false);

    leave();
  });

  it('can be woken again after everything went quiet', async () => {
    let moving = false;
    const leave = join({ element: element(), render: () => moving });
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

  describe('acceleration, both axes', () => {
    /** An element whose LAYOUT position is ours to set, and whose drawn rect is set separately. */
    function placed(layout: { left: number; top: number }): HTMLElement {
      const node = element(0);
      Object.defineProperty(node, 'offsetLeft', { get: () => layout.left });
      Object.defineProperty(node, 'offsetTop', { get: () => layout.top });
      Object.defineProperty(node, 'offsetWidth', { get: () => 100 });
      Object.defineProperty(node, 'offsetHeight', { get: () => 150 });
      Object.defineProperty(node, 'offsetParent', { get: () => null });
      return node;
    }

    it('measures a move in both axes, y up, as a hand carrying the glass', async () => {
      const layout = { left: 0, top: 0 };
      const calls: [number, number][] = [];
      const leave = join({
        element: placed(layout),
        render: () => true,
        accelerated: (ax, ay) => calls.push([ax, ay]),
      });
      await frames(3);
      expect(calls.every(([ax, ay]) => ax === 0 && ay === 0)).toBe(true);

      // Reordered one cell to the right: the layout jumps, the hand sets off right.
      layout.left = 150;
      calls.length = 0;
      await frames(3);
      expect(Math.max(...calls.map(([ax]) => ax))).toBeGreaterThan(0);
      expect(calls.every(([, ay]) => Math.abs(ay) < 1e-9)).toBe(true);
      // Never harder than the hand's own limit: a jump D peaks at D / τ².
      expect(Math.max(...calls.map(([ax]) => Math.abs(ax)))).toBeLessThanOrEqual(
        (150 / CARRY_S ** 2) * 1.01,
      );

      // A row down: layout y grows downwards, so the water feels the glass accelerate DOWN.
      layout.top = 150;
      calls.length = 0;
      await frames(3);
      expect(Math.min(...calls.map(([, ay]) => ay))).toBeLessThan(0);
      leave();
      await frames(1);
    });

    /*
     * A picked-up tile is lifted by `translateY(-2px) scale(1.015)`, a hovered one by
     * `translateY(-2px)`, and the page scrolls. All of it moves the CLIENT rect and none of it is
     * the glass being moved, so none of it may reach the water.
     */
    it('ignores the lift, the hover, the press and the page scrolling', async () => {
      const layout = { left: 40, top: 300 };
      const node = placed(layout);
      const calls: [number, number][] = [];
      const leave = join({
        element: node,
        render: () => true,
        accelerated: (ax, ay) => calls.push([ax, ay]),
      });
      await frames(2);
      for (const [dy, scale] of [
        [-2, 1.015],
        [-2, 1],
        [0, 0.988],
        [-480, 1],
      ] as const) {
        node.getBoundingClientRect = () =>
          ({
            left: 40 - (scale - 1) * 50,
            top: 300 + dy - (scale - 1) * 75,
            right: 140 + (scale - 1) * 50,
            bottom: 450 + dy + (scale - 1) * 75,
            width: 100 * scale,
            height: 150 * scale,
            x: 40,
            y: 300 + dy,
          }) as DOMRect;
        await frames(2);
      }
      expect(calls.length).toBeGreaterThan(4);
      expect(calls.every(([ax, ay]) => ax === 0 && ay === 0)).toBe(true);
      leave();
      await frames(1);
    });

    it('keeps the loop running until the hand has arrived, then lets it stop', async () => {
      const layout = { left: 0, top: 0 };
      const leave = join({
        element: placed(layout),
        render: () => false,
        accelerated: () => undefined,
      });
      await frames(3);
      expect(driverState().running).toBe(false);

      layout.left = 150;
      // A key: the keyboard is the real way to rearrange, and it has to wake the loop.
      window.dispatchEvent(new Event('keydown'));
      await frames(4);
      expect(driverState().running).toBe(true);
      leave();
      await frames(1);
    });

    it('counts the border of each offset parent, so a cell becoming positioned is not a move', () => {
      const parent = document.createElement('div');
      Object.defineProperty(parent, 'offsetLeft', { get: () => 100 });
      Object.defineProperty(parent, 'offsetTop', { get: () => 50 });
      Object.defineProperty(parent, 'clientLeft', { get: () => 2 });
      Object.defineProperty(parent, 'clientTop', { get: () => 3 });
      Object.defineProperty(parent, 'offsetParent', { get: () => null });
      const child = document.createElement('div');
      Object.defineProperty(child, 'offsetLeft', { get: () => 10 });
      Object.defineProperty(child, 'offsetTop', { get: () => 20 });
      Object.defineProperty(child, 'offsetWidth', { get: () => 96 });
      Object.defineProperty(child, 'offsetHeight', { get: () => 150 });
      Object.defineProperty(child, 'offsetParent', { get: () => parent });
      expect(layoutCentre(child)).toEqual({ x: 10 + 2 + 100 + 48, y: 20 + 3 + 50 + 75 });
    });
  });
});
