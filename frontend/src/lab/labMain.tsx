import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from './Lab';
import '../index.css';

const host = document.getElementById('root');
if (host === null) throw new Error('lab.html has no #root');

createRoot(host).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
