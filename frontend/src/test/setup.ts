import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * jsdom has no canvas, and says so loudly — once per tile rendered, which buries the actual test
 * output. Answering `null` is not a workaround: it is exactly what a browser with canvas disabled
 * returns, and `GoalWater` is built to treat it as "draw nothing and leave the CSS water in
 * charge". So this both quietens the noise and keeps that fallback under test on every run.
 */
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
});
