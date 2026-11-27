import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

/*
 * The particle-fluid experiment's tests (`src/lab/fluid.test.ts`, `mesh.test.ts`) are not run by
 * default. They are an experiment the owner has not approved deleting, and they are the two slowest
 * files in the suite by far — 91 s and 25 s of CPU against under 9 s for any other — which under a
 * parallel run starved the screen tests into timing out (`Dashboard`, `ArchiveScreen`), so the
 * suite failed while every test in it could pass. `LAB_PARTICLES=1 npm test` runs them.
 */
const LAB_PARTICLES = ['src/lab/fluid.test.ts', 'src/lab/mesh.test.ts'];

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    // Local dev only: forward health probes to the Express server so the browser sees a
    // single origin and no CORS is involved. In deployed builds VITE_API_BASE_URL points
    // at the Lambda Function URL instead, and CORS is handled there (see CLAUDE.md).
    proxy: {
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts', './src/test/asyncTimeout.ts'],
    restoreMocks: true,
    exclude:
      process.env.LAB_PARTICLES === '1'
        ? configDefaults.exclude
        : [...configDefaults.exclude, ...LAB_PARTICLES],
    unstubGlobals: true,
  },
});
