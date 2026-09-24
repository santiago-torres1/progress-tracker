import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { borrowGpu, poolState, resetPool } from './pool';
import type { WaterRenderer } from './renderer';

const created = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock('./pixiRenderer', () => ({
  createPixiRenderer: async (): Promise<WaterRenderer | null> => {
    created.count += 1;
    await Promise.resolve();
    if (created.fail) return null;
    return {
      resize: () => undefined,
      draw: () => undefined,
      destroy: () => undefined,
    };
  },
  lastGpuFailure: () => null,
}));

function canvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

describe('the GPU pool', () => {
  beforeEach(() => {
    resetPool();
    created.count = 0;
    created.fail = false;
  });

  afterEach(() => {
    resetPool();
  });

  it('lends up to its cap and refuses politely after that', async () => {
    const { cap } = poolState();
    const leases = [];
    for (let i = 0; i < cap; i += 1) leases.push(await borrowGpu(canvas()));

    expect(leases.every((lease) => lease !== null)).toBe(true);
    expect(poolState().lent).toBe(cap);

    // The board is bigger than the pool, and that is the normal case, not an error.
    expect(await borrowGpu(canvas())).toBeNull();
  });

  it('takes a returned context and lends it again', async () => {
    const first = await borrowGpu(canvas());
    expect(poolState().lent).toBe(1);

    first?.release();
    expect(poolState().lent).toBe(0);

    // Releasing twice must not lend the same slot away twice over.
    first?.release();
    expect(poolState().lent).toBe(0);
  });

  /*
   * The rule that matters on a machine with no usable WebGL: ask once, believe the answer. A
   * hundred tiles each paying for their own failed initialisation is a visible stall on exactly
   * the hardware least able to afford one.
   */
  it('stops asking after the first refusal', async () => {
    created.fail = true;

    expect(await borrowGpu(canvas())).toBeNull();
    expect(await borrowGpu(canvas())).toBeNull();
    expect(await borrowGpu(canvas())).toBeNull();

    expect(created.count).toBe(1);
    expect(poolState().gpu).toBe(false);
    expect(poolState().lent).toBe(0);
  });

  it('gives nothing to a tile that has already gone away', async () => {
    const gone = new AbortController();
    gone.abort();

    expect(await borrowGpu(canvas(), gone.signal)).toBeNull();
    expect(created.count).toBe(0);
    expect(poolState().lent).toBe(0);
  });

  /*
   * Twelve tiles mount in one frame. Without serialising, each reserves a slot before finding out
   * whether it is still wanted, so a wave of tiles that are about to be thrown away can hold the
   * whole pool while the tiles replacing them fall back. StrictMode stages precisely this.
   */
  it('never lends more than its cap, however many ask at once', async () => {
    const { cap } = poolState();
    const leases = await Promise.all(Array.from({ length: cap * 3 }, () => borrowGpu(canvas())));

    const lent = leases.filter((lease) => lease !== null);
    expect(lent).toHaveLength(cap);
    expect(poolState().lent).toBe(cap);
    expect(created.count).toBe(cap);
  });
});
