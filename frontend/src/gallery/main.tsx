/* Mounts the gallery. Kept apart from `Gallery.tsx` so the entry exports nothing, exactly as
 * `main.tsx` is kept apart from `App.tsx`. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery } from './Gallery';
import '../index.css';

const host = document.getElementById('root');
if (host === null) throw new Error('gallery.html has no #root');

createRoot(host).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
