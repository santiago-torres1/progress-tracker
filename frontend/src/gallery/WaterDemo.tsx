/*
 * A bench for the water, apart from the board.
 *
 * The simulation is tuned by eye and by hand, and the only way to do that honestly is to watch it.
 * `?script` runs a fixed sequence — pour, drag left, drag right, let go — so a screenshot catches
 * the surface mid-wave instead of always flat.
 */

import { useEffect, useRef, useState } from 'react';
import { WaterField } from '../lib/water/field';
import { createCanvasRenderer } from '../lib/water/renderer';

const AREAS = [
  { name: 'Health & Wellbeing', color: 'rgb(95, 194, 148)', level: 0.34 },
  { name: 'Learning & Skills', color: 'rgb(154, 157, 245)', level: 0.62 },
  { name: 'Money & Finances', color: 'rgb(224, 180, 92)', level: 1 },
];

interface GlassProps {
  name: string;
  color: string;
  level: number;
  drag: number;
  poured: number;
}

function Glass({ name, color, level, drag, poured }: GlassProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrag = useRef(drag);
  const [field] = useState(() => new WaterField());

  useEffect(() => {
    field.setLevel(level, poured > 0);
  }, [field, level, poured]);

  useEffect(() => {
    const velocity = drag - lastDrag.current;
    lastDrag.current = drag;
    if (velocity !== 0) field.tilt(velocity * 0.06);
  }, [field, drag]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = createCanvasRenderer(canvas);
    if (renderer === null) return;

    const box = canvas.getBoundingClientRect();
    renderer.resize(box.width, box.height, window.devicePixelRatio || 1);

    let frame = 0;
    let previous = performance.now();
    const loop = (now: number): void => {
      field.advance(now - previous);
      previous = now;
      renderer.draw((at) => field.heightAt(at), {
        color,
        full: field.level >= 1,
        radius: 14,
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      renderer.destroy();
    };
  }, [color, field]);

  return (
    <figure className="wd__glass" style={{ transform: `translateX(${drag}px)` }}>
      <div className="wd__vessel">
        <canvas ref={canvasRef} className="wd__canvas" />
      </div>
      <figcaption>{name}</figcaption>
    </figure>
  );
}

export function WaterDemo() {
  const [drag, setDrag] = useState(0);
  const [poured, setPoured] = useState(0);
  const [levels, setLevels] = useState(AREAS.map((a) => a.level));

  useEffect(() => {
    if (!window.location.search.includes('script')) return;

    // Pour, then shove the glasses about, then let them settle.
    const timers = [
      setTimeout(() => {
        setLevels((current) => current.map((l) => Math.min(1, l + 0.25)));
        setPoured((n) => n + 1);
      }, 300),
      setTimeout(() => {
        setDrag(-70);
      }, 1100),
      setTimeout(() => {
        setDrag(60);
      }, 1400),
      setTimeout(() => {
        setDrag(0);
      }, 1700),
    ];
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  return (
    <div className="wd">
      <h1>Water bench</h1>
      <p className="wd__note">
        Drag the slider to shove the glasses sideways; the surface should lag, pile up against the
        wall it is being pushed towards, and rock for a moment after it stops.
      </p>

      <div className="wd__row">
        {AREAS.map((area, i) => (
          <Glass
            key={area.name}
            name={area.name}
            color={area.color}
            level={levels[i] ?? area.level}
            drag={drag}
            poured={poured}
          />
        ))}
      </div>

      <div className="wd__controls">
        <label>
          Drag
          <input
            type="range"
            min={-90}
            max={90}
            value={drag}
            onChange={(e) => {
              setDrag(Number(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setLevels((current) => current.map((l) => Math.min(1, l + 0.15)));
            setPoured((n) => n + 1);
          }}
        >
          Pour
        </button>
        <button
          type="button"
          onClick={() => {
            setLevels(AREAS.map((a) => a.level));
            setPoured((n) => n + 1);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
