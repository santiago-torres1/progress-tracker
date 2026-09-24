import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WaterDemo } from './WaterDemo';
import '../index.css';
import './water.css';

const host = document.getElementById('root');
if (host === null) throw new Error('water.html has no #root');

createRoot(host).render(
  <StrictMode>
    <WaterDemo />
  </StrictMode>,
);
