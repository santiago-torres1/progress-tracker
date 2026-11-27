import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from './Lab';
import { runBoardBench } from './boardBench';
import { runSloshBench } from './sloshBench';
import '../index.css';
import './lab.css';

const host = document.getElementById('root');
if (host === null) throw new Error('lab.html has no #root');

/*
 * `?bench=100` runs before React and without it: synchronously, while the page is still loading,
 * which is the only time headless Chrome's virtual clock advances through synchronous work. The
 * result is written into `<pre id="bench-result">` for `--dump-dom`.
 */
const params = new URLSearchParams(window.location.search);
const bench = params.get('bench');
if (params.get('board') !== null) {
  // The real board, stepped one frame at a time: see boardBench.ts.
  const page = document.createElement('div');
  page.className = 'lab';
  const out = document.createElement('pre');
  out.id = 'bench-result';
  out.className = 'lab-bench__result';
  const board = document.createElement('div');
  page.append(board, out);
  host.appendChild(page);
  out.textContent = JSON.stringify(runBoardBench(board, params), null, 2);
} else if (bench !== null) {
  const tiles = Number.parseInt(bench, 10) || 100;
  const page = document.createElement('div');
  page.className = 'lab';
  const title = document.createElement('h1');
  title.textContent = `${tiles} live glasses`;
  const out = document.createElement('pre');
  out.id = 'bench-result';
  out.className = 'lab-bench__result';
  const board = document.createElement('div');
  board.className = 'lab-bench';
  page.append(title, out, board);
  host.appendChild(page);
  out.textContent = JSON.stringify(runSloshBench(board, tiles), null, 2);
} else {
  createRoot(host).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
}
