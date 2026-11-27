/*
 * `water.html`: the board's glasses, alone — the REAL components (`GoalGlass` with `GoalWater` in
 * its slot), at the three sizes and four fills, with nothing else on the page.
 *
 * It used to compare the first liquid's two renderers, canvas 2D and Pixi, drawn from one spring
 * field; both, and the field, were deleted in round four. What is left to look at here is the
 * production composition: the live water in the glass, behind its walls and rim, and moving.
 *
 * The slider moves the row in LAYOUT, as a rearrange on the board does (`useArrange` reorders the
 * grid) — the water is driven by the layout position, carried by a hand (`driver.ts`), not by
 * transforms, which are decoration. `?script` runs a fixed sequence — pour, move left, move right,
 * set down — so a screenshot catches the water mid-slosh. The deep bench is `lab.html`.
 */

import { useEffect, useState } from 'react';
import { GoalGlass } from '../components/GoalGlass';
import { GoalWater } from '../components/GoalWater';
import type { GoalSize } from '../types/api';

const GLASSES: readonly { name: string; area: string; size: GoalSize; level: number }[] = [
  { name: 'Health · small · 4%', area: 'health', size: 'small', level: 0.04 },
  { name: 'Learning · medium · 34%', area: 'learning', size: 'medium', level: 0.34 },
  { name: 'Money · large · 62%', area: 'money', size: 'large', level: 0.62 },
  { name: 'Creative · large · full', area: 'creative', size: 'large', level: 1 },
];

export function WaterDemo() {
  const [shift, setShift] = useState(0);
  const [levels, setLevels] = useState(() => GLASSES.map((g) => g.level));

  useEffect(() => {
    if (!window.location.search.includes('script')) return;
    const timers = [
      setTimeout(() => {
        setLevels((current) => current.map((l) => Math.min(1, l + 0.25)));
      }, 300),
      setTimeout(() => {
        setShift(-70);
      }, 1500),
      setTimeout(() => {
        setShift(60);
      }, 2100),
      setTimeout(() => {
        setShift(0);
      }, 2700),
    ];
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  return (
    <div className="wd">
      <h1>Water bench</h1>
      <p className="wd__note">
        The board&rsquo;s own glasses. Move the slider to carry them sideways, the way a rearrange
        moves a glass to its new place; pour to fill them. A full glass holds still.
      </p>

      <section className="wd__section">
        <div className="wd__row" style={{ marginLeft: shift + 90 }}>
          {GLASSES.map((glass, i) => {
            const level = levels[i] ?? glass.level;
            return (
              <figure key={glass.name} className="wd__glass" data-area={glass.area}>
                <GoalGlass
                  size={glass.size}
                  level={level * 100}
                  minimumLevel={null}
                  previousLevel={null}
                  kept={false}
                >
                  <GoalWater level={level} />
                </GoalGlass>
                <figcaption>{glass.name}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <div className="wd__controls">
        <label>
          Move
          <input
            type="range"
            min={-90}
            max={90}
            value={shift}
            onChange={(e) => {
              setShift(Number(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setLevels((current) => current.map((l) => Math.min(1, l + 0.15)));
          }}
        >
          Pour
        </button>
        <button
          type="button"
          onClick={() => {
            setLevels(GLASSES.map((g) => g.level));
          }}
        >
          Drain back
        </button>
      </div>
    </div>
  );
}
