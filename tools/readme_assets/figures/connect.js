// Arrows between the boxes of a figure.
//
// A figure lays its boxes out with plain CSS. This file measures them and draws the arrows in an
// <svg class="overlay"> that covers the card, so a box can change size without the arrows being
// redrawn by hand. Every arrow ends in a small filled head that points the way the flow goes.
//
//   connect(card, svg, [
//     { from: ['a', 'bottom', 0.25], to: ['b', 'top', 0.25] },
//     { from: ['a', 'right'], to: ['b', 'left'], both: true, dash: true, accent: true,
//       label: { en: 'text', zh: '文字', x: 460, y: 181, width: 150, accent: true } },
//   ])
//
// A box is found by its id, and an end is [id, side, t]: the side is top, bottom, left or right,
// and t (0 to 1, default 0.5) says how far along that side the arrow leaves or arrives. A path
// whose ends are not in line makes one elbow, at `mid` (a y for top and bottom ends, an x for left
// and right ones; default: half way). `both` puts a head at each end, `dash` draws a dashed line,
// `accent` uses the accent colour, and `gap` is the distance between a box and the end of its arrow.

(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const HEAD = 7; // half the width of an arrow head, in pixels
  const GAP = 4;

  function box(card, id) {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`no box with id ${id}`);
    const r = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }

  function add(svg, tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.appendChild(node);
    return node;
  }

  /** The point on a side of a box, pushed out by `gap`, and the way an arrow that arrives there points. */
  function end(card, [id, side, t = 0.5], gap) {
    const b = box(card, id);
    switch (side) {
      case 'top': return { x: b.x + b.w * t, y: b.y - gap, into: 'down' };
      case 'bottom': return { x: b.x + b.w * t, y: b.y + b.h + gap, into: 'up' };
      case 'left': return { x: b.x - gap, y: b.y + b.h * t, into: 'right' };
      case 'right': return { x: b.x + b.w + gap, y: b.y + b.h * t, into: 'left' };
      default: throw new Error(`unknown side ${side}`);
    }
  }

  /** A filled triangle whose tip is at (x, y) and that points in `dir`. */
  function head(svg, x, y, dir, accent) {
    const l = HEAD * 1.5;
    const w = HEAD * 0.85;
    const pts = {
      right: [[x, y], [x - l, y - w], [x - l, y + w]],
      left: [[x, y], [x + l, y - w], [x + l, y + w]],
      down: [[x, y], [x - w, y - l], [x + w, y - l]],
      up: [[x, y], [x - w, y + l], [x + w, y + l]],
    }[dir];
    add(svg, 'polygon', { points: pts.map((p) => p.join(',')).join(' '), class: accent ? 'fill-accent' : 'fill-line' });
  }

  function label(svg, { en, zh, x, y, width = 120, accent = false }) {
    const holder = add(svg, 'foreignObject', { x: x - width / 2, y: y - 18, width, height: 36 });
    const div = document.createElement('div');
    div.className = `arrow-label${accent ? ' accent' : ''}`;
    div.innerHTML = `<span class="en">${en}</span><span class="zh">${zh}</span>`;
    holder.appendChild(div);
  }

  /** Move a point `by` pixels along the way from `p` to `q`. */
  const toward = (p, q, by) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return d === 0 ? p : [p[0] + ((q[0] - p[0]) * by) / d, p[1] + ((q[1] - p[1]) * by) / d];
  };

  window.connect = (card, svg, arrows) => {
    for (const arrow of arrows) {
      const { both = false, dash = false, accent = false, gap = GAP, mid } = arrow;
      const a = end(card, arrow.from, gap);
      const b = end(card, arrow.to, gap);
      const vertical = arrow.from[1] === 'top' || arrow.from[1] === 'bottom';
      const points = [[a.x, a.y]];
      if (vertical && Math.abs(a.x - b.x) >= 1) {
        const m = mid ?? (a.y + b.y) / 2;
        points.push([a.x, m], [b.x, m]);
      } else if (!vertical && Math.abs(a.y - b.y) >= 1) {
        const m = mid ?? (a.x + b.x) / 2;
        points.push([m, a.y], [m, b.y]);
      }
      points.push([b.x, b.y]);
      const back = HEAD * 1.5 - 1; // the line stops where the head begins
      const last = points.length - 1;
      const drawn = points.map((p) => [...p]);
      drawn[last] = toward(points[last], points[last - 1], back);
      if (both) drawn[0] = toward(points[0], points[1], back);
      const path = add(svg, 'path', { d: drawn.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '), class: accent ? 'stroke-accent' : 'stroke-line' });
      if (dash) path.setAttribute('stroke-dasharray', '5 5');
      head(svg, b.x, b.y, b.into, accent);
      if (both) head(svg, a.x, a.y, a.into, accent);
      if (arrow.label) label(svg, arrow.label);
    }
  };
})();
