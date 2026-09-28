/*
 * A bench for the water, apart from the board.
 *
 * The simulation is tuned by eye and by hand, and the only way to do that honestly is to watch it.
 * `?script` runs a fixed sequence — pour, drag left, drag right, let go — so a screenshot catches
 * the surface mid-wave instead of always flat.
 *
 * TWO ROWS, ON PURPOSE. The top row is drawn in canvas 2D and the bottom row on the GPU, from the
 * same field and the same recipe. They are supposed to be indistinguishable: the last time they
 * were not, half a board came out flat and the other half deep, and it was reported as the water
 * looking glitchy. Now a divergence is a thing you can see in one screenshot rather than a thing
 * somebody notices in production.
 *
 * The levels include a nearly-empty glass, because "what does 4% look like" is the question the
 * rules about shallow water exist to answer.
 */

import { useEffect, useRef, useState } from 'react';
import { WaterField } from '../lib/water/field';
import { createPixiRenderer } from '../lib/water/pixiRenderer';
import { createCanvasRenderer, type WaterRenderer } from '../lib/water/renderer';
import { readWaterTints, type WaterTints } from '../lib/water/tints';

const AREAS = [
  { name: 'Health, 4%', color: 'rgb(95, 194, 148)', level: 0.04 },
  { name: 'Learning, 34%', color: 'rgb(154, 157, 245)', level: 0.34 },
  { name: 'Money, 62%', color: 'rgb(224, 180, 92)', level: 0.62 },
  { name: 'Creative, full', color: 'rgb(199, 154, 232)', level: 1 },
];

type Engine = 'canvas' | 'gpu';

interface GlassProps {
  name: string;
  color: string;
  level: number;
  drag: number;
  poured: number;
  engine: Engine;
}

function Glass({ name, color, level, drag, poured, engine }: GlassProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastDrag = useRef(drag);
  const [field] = useState(() => new WaterField());
  const [note, setNote] = useState('');

  useEffect(() => {
    field.setLevel(level, poured > 0);
  }, [field, level, poured]);

  useEffect(() => {
    const velocity = drag - lastDrag.current;
    lastDrag.current = drag;
    if (velocity !== 0) field.tilt(velocity);
  }, [field, drag]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    // Created here rather than rendered, for the reason `GoalWater` does it: a canvas that has lost
    // a WebGL context can never be given another, and React reuses nodes across an effect's re-run.
    const canvas = document.createElement('canvas');
    canvas.className = 'wd__canvas';
    host.appendChild(canvas);

    const unmounted = new AbortController();
    let renderer: WaterRenderer | null = null;
    let frame = 0;

    void (async () => {
      renderer = engine === 'gpu' ? await createPixiRenderer(canvas) : createCanvasRenderer(canvas);
      if (unmounted.signal.aborted) {
        renderer?.destroy();
        return;
      }
      if (renderer === null) {
        setNote('no GPU here — this row would fall back to 2D');
        return;
      }

      const box = host.getBoundingClientRect();
      renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
      const tints = readWaterTints(getComputedStyle(host));

      let previous = performance.now();
      const loop = (now: number): void => {
        field.advance(now - previous);
        previous = now;
        const full = field.level >= 1;
        const stops: WaterTints | undefined = full ? tints.full : tints.resting;
        renderer?.draw((at) => field.heightAt(at), {
          color,
          full,
          level: field.level,
          radius: 14,
          ...(stops === undefined ? {} : { stops }),
        });
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })();

    return () => {
      unmounted.abort();
      cancelAnimationFrame(frame);
      renderer?.destroy();
      canvas.remove();
    };
  }, [color, engine, field]);

  return (
    <figure className="wd__glass" style={{ transform: `translateX(${drag}px)` }}>
      <div ref={hostRef} className="wd__vessel" />
      <figcaption>
        {name}
        {note === '' ? null : <em> · {note}</em>}
      </figcaption>
    </figure>
  );
}

function Row({ engine, drag, poured, levels }: { engine: Engine } & RowState) {
  return (
    <section className="wd__section">
      <h2>{engine === 'gpu' ? 'GPU (Pixi)' : 'Canvas 2D'}</h2>
      <div className="wd__row">
        {AREAS.map((area, i) => (
          <Glass
            key={area.name}
            name={area.name}
            color={area.color}
            level={levels[i] ?? area.level}
            drag={drag}
            poured={poured}
            engine={engine}
          />
        ))}
      </div>
    </section>
  );
}

interface RowState {
  drag: number;
  poured: number;
  levels: number[];
}

export function WaterDemo() {
  const [drag, setDrag] = useState(0);
  const [poured, setPoured] = useState(0);
  const [levels, setLevels] = useState(AREAS.map((a) => a.level));
  const only = new URLSearchParams(window.location.search).get('only');

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

  const state = { drag, poured, levels };

  return (
    <div className="wd">
      <h1>Water bench</h1>
      <p className="wd__note">
        Drag the slider to shove the glasses sideways; the surface should lag, pile up against the
        wall it is being pushed towards, and rock for a moment after it stops. The two rows are the
        same recipe drawn twice — any difference between them is a bug.
      </p>

      {only === 'gpu' ? null : <Row engine="canvas" {...state} />}
      {only === 'canvas' ? null : <Row engine="gpu" {...state} />}

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
