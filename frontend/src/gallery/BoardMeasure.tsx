/*
 * `?measure=1`: numbers about every real GoalTile on the gallery page, written into
 * `<pre id="board-measure">` for `--dump-dom`. Gallery only.
 *
 * Per tile: is every text box unclipped and inside its tile, does any text box overlap the vessel
 * (rim to foot), does the still liquid's surface cross any text, the clear space from the glass to
 * its label, the worst text contrast against whatever is behind it, and the size of every control.
 * Per board: do any two tiles overlap. And once: the glass outline's contrast against the room.
 *
 * The waterline is the still liquid's front edge, so run it with reduced motion (Chrome's
 * `--force-prefers-reduced-motion`) — with the live water running, the still edge is hidden.
 */

import { useEffect, useState } from 'react';

type Rgba = [number, number, number, number];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function colourReader(): (css: string) => Rgba {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (css) => {
    if (ctx === null) return [0, 0, 0, 1];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 255) / 255];
  };
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5
  );
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

const TEXT = ['.goal-tile__name', '.goal-tile__head', '.goal-tile__val', '.goal-tile__foot'];

function measure(): string {
  const read = colourReader();
  // The tokens straight from the root: each is a literal colour, so its computed value is the colour.
  // (A probe element re-styled once per token returned --bg for every one of them.)
  const root = getComputedStyle(document.documentElement);
  const token = (name: string): Rgba => read(root.getPropertyValue(name).trim());
  const room = ['--bg', '--bg-2', '--bg-3'].map(token);
  const ink = token('--vessel-ink');

  const lines: string[] = [];
  const outline = room.map((base) => contrast(over(ink, base), base));
  let clipped = 0;
  let outside = 0;
  let onGlass = 0;
  let crossings = 0;
  let overlaps = 0;
  let worst = Infinity;
  let worstAt = '';
  let smallest = Infinity;
  let smallestAt = '';
  let tiles = 0;

  for (const section of document.querySelectorAll<HTMLElement>('.gal__case')) {
    const title = section.querySelector('.gal__h')?.textContent ?? '?';
    const found = Array.from(section.querySelectorAll<HTMLElement>('.goal-tile'));
    if (found.length === 0) continue;
    lines.push(`## ${title}`);
    // Every box between the first tile and the stage, and its width: where a board shrinks, this
    // says which ancestor did it.
    const chain: string[] = [];
    for (
      let a = found[0]?.parentElement ?? null;
      a !== null && a !== section;
      a = a.parentElement
    ) {
      const cls = (a.getAttribute('class') ?? a.tagName.toLowerCase()).split(' ')[0] ?? '';
      const styles = getComputedStyle(a);
      // A grid's computed columns are its USED track sizes, which is what says why it is narrow.
      const tracks = styles.display === 'grid' ? ` [${styles.gridTemplateColumns}]` : '';
      chain.push(`${cls} ${r1(a.getBoundingClientRect().width)}${tracks}`);
    }
    lines.push(`  widths: ${chain.join(' < ')}`);
    const boxes = found.map(box);
    boxes.forEach((a, i) => {
      boxes.forEach((b, j) => {
        if (j > i && intersects(a, b)) overlaps += 1;
      });
    });

    found.forEach((tile, i) => {
      tiles += 1;
      const t = boxes[i] ?? box(tile);
      const name = tile.querySelector('.goal-tile__name')?.textContent ?? '?';
      const glass = tile.querySelector('.goal-glass');
      const slot = tile.querySelector('.goal-glass__liquid');
      if (glass === null || slot === null) {
        lines.push(`${name}: NO GLASS`);
        return;
      }
      const g = box(glass);
      const s = box(slot);
      // The vessel from the top of the rim's ellipse to the bottom of its foot.
      const vessel: Box = { left: s.left, right: s.right, top: s.top - 3.5, bottom: g.bottom - 7 };
      const edgeEl = tile.querySelector('.goal-glass__edge');
      const edgeShown =
        edgeEl !== null &&
        getComputedStyle(edgeEl).display !== 'none' &&
        edgeEl.closest('.goal-glass__still') !== null &&
        getComputedStyle(edgeEl.closest('.goal-glass__still') ?? edgeEl).display !== 'none';
      const water = edgeShown ? box(edgeEl) : null;

      let c = 0;
      let o = 0;
      let v = 0;
      let x = 0;
      let gap = Infinity;
      let low = Infinity;
      for (const selector of TEXT) {
        const text = tile.querySelector<HTMLElement>(selector);
        if (text === null) continue;
        const b = box(text);
        if (
          text.scrollWidth > text.clientWidth + 0.5 ||
          text.scrollHeight > text.clientHeight + 0.5
        ) {
          c += 1;
          lines.push(
            `  CLIPPED ${name} ${selector}: scroll ${String(text.scrollWidth)}x${String(text.scrollHeight)} client ${String(text.clientWidth)}x${String(text.clientHeight)}`,
          );
        }
        if (!inside(b, t)) o += 1;
        if (intersects(b, vessel)) v += 1;
        if (water !== null && intersects(b, water)) x += 1;
        gap = Math.min(gap, b.top - vessel.bottom);

        for (const el of [text, ...Array.from(text.querySelectorAll<HTMLElement>('*'))]) {
          if (el.closest('svg') !== null || el.tagName === 'I') continue;
          const own = Array.from(el.childNodes).some(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
          );
          if (!own) continue;
          const fg = read(getComputedStyle(el).color);
          const layers: Rgba[] = [];
          // Up to the body, not into it: the body's own colour is --bg under a gradient that runs to
          // --bg-3, and the three room stops below stand in for that gradient.
          for (
            let a: HTMLElement | null = el;
            a !== null && a !== document.body;
            a = a.parentElement
          ) {
            const bg = read(getComputedStyle(a).backgroundColor);
            if (bg[3] > 0) layers.push(bg);
            if (bg[3] >= 1) break;
          }
          for (const base of room) {
            let behind: Rgba = base;
            for (let k = layers.length - 1; k >= 0; k -= 1) {
              const layer = layers[k];
              if (layer !== undefined) behind = over(layer, behind);
            }
            const ratio = contrast(over(fg, behind), behind);
            low = Math.min(low, ratio);
            if (ratio < worst) {
              worst = ratio;
              worstAt = `${title} / ${name} "${el.textContent.trim().slice(0, 30)}"`;
            }
          }
        }
      }

      const targets = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'))
        .filter((button) => !button.classList.contains('goal-tile__open'))
        .map((button) => {
          const b = box(button);
          const w = b.right - b.left;
          const h = b.bottom - b.top;
          if (Math.min(w, h) < smallest) {
            smallest = Math.min(w, h);
            smallestAt = `${title} / ${button.getAttribute('aria-label') ?? ''}`;
          }
          if (!inside(b, t)) o += 1;
          return `${button.textContent.trim() || '?'} ${r1(w)}x${r1(h)}`;
        })
        .join(', ');

      clipped += c;
      outside += o;
      onGlass += v;
      crossings += x;
      const waterNote =
        water === null
          ? 'no still edge'
          : `water y ${r1(water.top - t.top)}–${r1(water.bottom - t.top)}`;
      lines.push(
        [
          `${name} (${tile.className.replace(/goal-tile /, '')})`,
          `tile ${r1(t.right - t.left)}x${r1(t.bottom - t.top)}`,
          `vessel ${r1(vessel.right - vessel.left)}x${r1(vessel.bottom - vessel.top)}`,
          waterNote,
          `clipped ${String(c)} outside ${String(o)} on-glass ${String(v)} crossings ${String(x)}`,
          `glass->label ${r1(gap)}px`,
          `min contrast ${low.toFixed(2)}`,
          targets,
        ].join(' | '),
      );
    });
  }

  lines.unshift(
    `  resolved: ink ${ink.map((n) => r1(n)).join(',')} room ${room.map((c) => c.map((n) => r1(n)).join(',')).join(' / ')}`,
  );
  lines.unshift(
    `TOTAL ${String(tiles)} tiles: clipped ${String(clipped)}, outside ${String(outside)}, text on glass ${String(onGlass)}, waterline crossings ${String(crossings)}, tile overlaps ${String(overlaps)}, worst text contrast ${worst.toFixed(2)} (${worstAt}), smallest target ${r1(smallest)}px (${smallestAt}), glass outline ${outline.map((n) => n.toFixed(2)).join(' / ')} against --bg / --bg-2 / --bg-3`,
  );
  return lines.join('\n');
}

export function BoardMeasure() {
  const [report, setReport] = useState('measuring…');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReport(measure());
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <pre id="board-measure" style={{ fontSize: '10px', whiteSpace: 'pre-wrap' }}>
      {report}
    </pre>
  );
}
