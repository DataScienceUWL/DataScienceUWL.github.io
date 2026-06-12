// @ts-check
/**
 * Shared D3 charting utilities for StatLens.
 * Establishes the D3 margin convention and common helpers.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';

/** Standard viewBox width. */
const VIEW_WIDTH = 600;

/** Standard viewBox height (600 * golden ratio inverse). */
const VIEW_HEIGHT = 371;

/** Default margins (desktop). */
const DEFAULT_MARGIN = { top: 28, right: 20, bottom: 50, left: 60 };

/** Phone margins (viewport < 480px) — left enlarged for scaled-up tick labels. */
const PHONE_MARGIN = { top: 30, right: 15, bottom: 60, left: 80 };

/**
 * Standard transition duration (ms). Use for D3 transitions on explore tools.
 * Simulation animations use requestAnimationFrame instead.
 * @type {number}
 */
export const TRANSITION_MS = 300;

/**
 * Compute responsive pill dimensions (charWidth, padding, pill height)
 * for SVG rounded-rect + text "pill" labels. All pill renderers in the
 * app should call this instead of hard-coding per-breakpoint values.
 *
 * @param {'prob'|'crit'} [variant='prob'] - 'prob' for probability pills,
 *   'crit' for smaller critical-value / k-label pills
 * @returns {{ charW: number, pad: number, pillH: number }}
 */
export function pillDimensions(variant = 'prob') {
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  const isTablet = !isPhone && typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 600px)').matches;

  if (variant === 'crit') {
    return {
      charW:  isPhone ? 15 : isTablet ? 12 : 8,
      pad:    isPhone ? 20 : isTablet ? 16 : 12,
      pillH:  isPhone ? 30 : isTablet ? 26 : 20,
    };
  }
  // 'prob' (default) — probability label pills
  return {
    charW:  isPhone ? 15 : isTablet ? 12 : 8.5,
    pad:    isPhone ? 24 : isTablet ? 20 : 16,
    pillH:  isPhone ? 34 : isTablet ? 30 : 24,
  };
}

/**
 * Okabe-Ito accessible color palette — reordered so the first 2-3 colors
 * are maximally distinguishable under protanopia and deuteranopia.
 *
 * Original Okabe-Ito order: blue, orange, teal, vermillion, rose, sky, gold, gray.
 * Problem: teal (#009E73) and vermillion (#D55E00) both shift to brownish-yellow
 * under deuteranopia, making 3- and 4-group charts hard to read.
 *
 * Reordered: blue, orange, rose, teal, vermillion, sky, gold, gray.
 * Rose (#CC79A7) appears as desaturated blue-gray under deuteranopia,
 * clearly distinct from both blue and orange.
 * @type {readonly string[]}
 */
const OKABE_ITO = [
  '#0072B2',   // blue (5.19:1)
  '#C08700',   // orange (3.13:1) — darkened from #E69F00 for WCAG 3:1
  '#CC79A7',   // rose (3.06:1) — moved up: distinct from blue+orange under all CVD types
  '#009E73',   // teal (3.42:1)
  '#D55E00',   // vermillion (3.87:1)
  '#2E8BC0',   // sky blue (3.77:1) — darkened from #56B4E9 for WCAG 3:1
  '#9A8C00',   // gold (3.43:1) — darkened from #F0E442 for WCAG 3:1
  '#767676',   // gray (4.54:1) — darkened from #999999 for WCAG 3:1
];

/**
 * Check if reduced motion should be active.
 * Respects the StatLens setting ('on'/'off'/'auto') with OS fallback.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  // Check StatLens setting if available (avoids circular import by reading localStorage directly)
  try {
    const raw = localStorage.getItem('statlens-settings');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.reducedMotion === 'on') return true;
      if (s.reducedMotion === 'off') return false;
    }
  } catch { /* fall through to OS check */ }
  // 'auto' or no setting — follow OS
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if d3-transition is available on selections.
 * When false, code must not call selection.transition().
 * @returns {boolean}
 */
export function hasD3Transition() {
  try {
    const tmp = d3Selection.select(
      typeof document !== 'undefined'
        ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
        : null
    );
    return typeof tmp.transition === 'function';
  } catch {
    return false;
  }
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} [ms=150]
 * @returns {Function}
 */
export function debounce(fn, ms = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Format tick values for display (remove trailing zeros, handle large numbers).
 * @param {number} value
 * @returns {string}
 */
export function formatTick(value) {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  // Large numbers: use SI-like suffix
  if (abs >= 1e9) return _siClean(value / 1e9) + 'B';
  if (abs >= 1e6) return _siClean(value / 1e6) + 'M';
  if (abs >= 1e4) return _siClean(value / 1e3) + 'K';
  // Small decimals: up to 4 significant digits, strip trailing zeros
  if (abs < 0.001) return value.toExponential(2);
  // General case: up to 4 significant digits
  const s = Number(value.toPrecision(4));
  return String(s);
}

/**
 * Check if SVG text elements overlap horizontally (with a small gap).
 * @param {SVGTextElement[]} nodes
 * @returns {boolean}
 */
function _ticksOverlap(nodes) {
  const GAP = 4; // minimum px gap between labels
  for (let i = 1; i < nodes.length; i++) {
    const prev = typeof nodes[i - 1].getBBox === 'function' ? nodes[i - 1].getBBox() : null;
    const curr = typeof nodes[i].getBBox === 'function' ? nodes[i].getBBox() : null;
    if (!prev || !curr) return false; // Can't measure (e.g. jsdom) — assume no overlap
    if (prev.x + prev.width + GAP > curr.x) return true;
  }
  return false;
}

/**
 * Auto-reduce x-axis ticks if labels overlap. Call after initial axis render.
 * @param {d3Selection.Selection} axisG - The axis <g> element
 * @param {*} xAxis - d3.axisBottom with .ticks() method
 */
export function autoReduceTicks(axisG, xAxis) {
  if (typeof xAxis.ticks !== 'function') return;
  const tickTexts = axisG.selectAll('.tick text').nodes();
  if (!_ticksOverlap(tickTexts)) return;
  const isPhone = detectPhoneMargin();
  const maxTicks = isPhone ? 5 : 8;
  for (let n = maxTicks; n >= 3; n--) {
    axisG.call(xAxis.ticks(n));
    if (!_ticksOverlap(axisG.selectAll('.tick text').nodes())) break;
  }
}

/** Up to 3 sig figs, strip trailing zeros (40.0 → 40, 1.50 → 1.5). */
function _siClean(v) {
  return String(Number(v.toPrecision(3)));
}

/**
 * Get the Okabe-Ito accessible color palette for chart data elements.
 * @param {number} [n=5] - Number of colors needed
 * @returns {string[]} Array of hex color strings
 */
export function getColors(n = 5) {
  const count = Math.max(1, Math.min(n, OKABE_ITO.length));
  return OKABE_ITO.slice(0, count);
}

/**
 * SVG pattern definitions for distinguishing groups without relying on color alone.
 * Each pattern is a function that creates a <pattern> element inside an SVG <defs>.
 *
 * Pattern types (in order, matching Okabe-Ito palette positions):
 *  0: solid (no pattern — just the base color)
 *  1: diagonal lines (45°, ////)
 *  2: dots (regular grid)
 *  3: crosshatch (X pattern)
 *  4: horizontal lines (----)
 *  5: diagonal lines (135°, \\\\)
 *  6: dense dots
 *  7: vertical lines (||||)
 *
 * @type {readonly {id: string, create: (defs: SVGDefsElement, color: string, idx: number) => void}[]}
 */
const PATTERN_DEFS = [
  { id: 'solid', create: () => {} }, // slot 0 = no pattern, just solid fill
  {
    id: 'diag',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-diag-${idx}`, 6, 6);
      _line(p, 0, 6, 6, 0, color, 1.5);
    },
  },
  {
    id: 'dots',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-dots-${idx}`, 6, 6);
      _circle(p, 3, 3, 1.4, color);
    },
  },
  {
    id: 'cross',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-cross-${idx}`, 7, 7);
      _line(p, 0, 7, 7, 0, color, 1.2);
      _line(p, 0, 0, 7, 7, color, 1.2);
    },
  },
  {
    id: 'horiz',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-horiz-${idx}`, 6, 6);
      _line(p, 0, 3, 6, 3, color, 1.5);
    },
  },
  {
    id: 'diag2',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-diag2-${idx}`, 6, 6);
      _line(p, 0, 0, 6, 6, color, 1.5);
    },
  },
  {
    id: 'dots2',
    create: (defs, color, idx) => {
      const p = _mkPattern(defs, `sl-pat-dots2-${idx}`, 4, 4);
      _circle(p, 2, 2, 1.2, color);
    },
  },
  {
    id: 'checker',
    create: (defs, color, idx) => {
      const ns = 'http://www.w3.org/2000/svg';
      const p = _mkPattern(defs, `sl-pat-checker-${idx}`, 6, 6);
      const r1 = document.createElementNS(ns, 'rect');
      r1.setAttribute('width', '3'); r1.setAttribute('height', '3');
      r1.setAttribute('fill', color); r1.setAttribute('opacity', '0.5');
      p.appendChild(r1);
      const r2 = document.createElementNS(ns, 'rect');
      r2.setAttribute('x', '3'); r2.setAttribute('y', '3');
      r2.setAttribute('width', '3'); r2.setAttribute('height', '3');
      r2.setAttribute('fill', color); r2.setAttribute('opacity', '0.5');
      p.appendChild(r2);
    },
  },
];

/** Create a <pattern> element inside defs.
 * @param {SVGDefsElement} defs @param {string} id @param {number} w @param {number} h */
function _mkPattern(defs, id, w, h) {
  const ns = 'http://www.w3.org/2000/svg';
  const p = document.createElementNS(ns, 'pattern');
  p.setAttribute('id', id);
  p.setAttribute('patternUnits', 'userSpaceOnUse');
  p.setAttribute('width', String(w));
  p.setAttribute('height', String(h));
  defs.appendChild(p);
  return p;
}

/** Append a <line> to a pattern element.
 * @param {SVGPatternElement} parent @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {string} color @param {number} sw */
function _line(parent, x1, y1, x2, y2, color, sw) {
  const ns = 'http://www.w3.org/2000/svg';
  const l = document.createElementNS(ns, 'line');
  l.setAttribute('x1', String(x1));
  l.setAttribute('y1', String(y1));
  l.setAttribute('x2', String(x2));
  l.setAttribute('y2', String(y2));
  l.setAttribute('stroke', color);
  l.setAttribute('stroke-width', String(sw));
  l.setAttribute('stroke-linecap', 'square');
  parent.appendChild(l);
}

/** Append a <circle> to a pattern element.
 * @param {SVGPatternElement} parent @param {number} cx @param {number} cy @param {number} r @param {string} color */
function _circle(parent, cx, cy, r, color) {
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('fill', color);
  parent.appendChild(c);
}

/**
 * Inject pattern <defs> into an SVG and return fill references for each group.
 * Call this once per chart after creating the SVG. Patterns use a darkened
 * version of each group color so they're visible on the lighter fill.
 *
 * @param {SVGSVGElement} svgEl - The chart's <svg> element
 * @param {string[]} colors - Array of hex colors (from getColors)
 * @returns {string[]} Array of CSS fill values — 'url(#sl-pat-diag-1)' or 'none' for solid
 */
export function ensurePatterns(svgEl, colors) {
  let defs = svgEl.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  /** @type {string[]} */
  const fills = [];
  for (let i = 0; i < colors.length; i++) {
    const patIdx = i % PATTERN_DEFS.length;
    const pat = PATTERN_DEFS[patIdx];
    if (patIdx === 0) {
      fills.push('none'); // solid fill — no pattern overlay needed
    } else {
      // Darken the color for pattern strokes so they show on light fill
      const patColor = _darken(colors[i], 0.35);
      pat.create(/** @type {SVGDefsElement} */ (defs), patColor, i);
      fills.push(`url(#sl-pat-${pat.id}-${i})`);
    }
  }
  return fills;
}

/**
 * Darken a hex color by mixing toward black.
 * @param {string} hex - e.g. '#0072B2'
 * @param {number} amount - 0 = unchanged, 1 = black
 * @returns {string} Darkened hex
 */
function _darken(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - amount;
  const dr = Math.round(r * f);
  const dg = Math.round(g * f);
  const db = Math.round(b * f);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/**
 * Create a responsive SVG chart inside a container element.
 * Applies the D3 margin convention with StatLens's standard dimensions.
 * Wraps the SVG in a `.statlens-chart` div with auto-attached export buttons.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {object} [options]
 * @param {number} [options.viewWidth=600] - SVG viewBox width
 * @param {number} [options.viewHeight=371] - SVG viewBox height
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {string} [options.titleText] - Text for <title> element
 * @param {string} [options.descText] - Text for <desc> element
 * @param {string} [options.id] - Unique ID prefix for ARIA references
 * @param {string} [options.filename] - PNG download filename (default: derived from titleText)
 * @param {boolean} [options.showExport] - Auto-attach export buttons (default: true)
 * @returns {ChartFrame}
 */
export function createChart(container, options = {}) {
  const {
    viewWidth = VIEW_WIDTH,
    viewHeight = VIEW_HEIGHT,
    margin = detectPhoneMargin() ? PHONE_MARGIN : DEFAULT_MARGIN,
    titleText = 'Chart',
    descText = '',
    id = 'chart-' + Math.random().toString(36).slice(2, 8),
    filename,
    showExport,
  } = options;

  const innerWidth = viewWidth - margin.left - margin.right;
  const innerHeight = viewHeight - margin.top - margin.bottom;

  // Resolve container element
  const containerEl = /** @type {Element} */ (typeof container === 'string'
    ? document.querySelector(container) : container);

  // Create wrapper div for the chart + export buttons
  const wrapper = document.createElement('div');
  wrapper.className = 'statlens-chart';
  wrapper.style.position = 'relative';
  containerEl.appendChild(wrapper);

  // Deliberately NO role="img" here: charts contain keyboard-focusable
  // children (tabindex=0 tooltips), and role="img" would flatten the
  // subtree out of the accessibility tree. aria-label alone is announced.
  const svg = d3Selection.select(wrapper).append('svg')
    .attr('aria-label', [titleText, descText].filter(Boolean).join(' — '))
    .attr('viewBox', `0 0 ${viewWidth} ${viewHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', 'auto');

  const inner = svg.append('g')
    .attr('class', 'chart-inner')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  inner.append('g').attr('class', 'axes');
  inner.append('g').attr('class', 'data');
  inner.append('g').attr('class', 'overlays');
  inner.append('g').attr('class', 'annotations');
  inner.append('g').attr('class', 'chart-tooltip')
    .style('pointer-events', 'none')
    .attr('visibility', 'hidden');

  // Auto-attach export buttons (download + copy) via dynamic import
  if (showExport !== false) {
    const exportFilename = filename
      ?? titleText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.png';
    import('./export.js').then(({ addChartSaveButton }) => {
      addChartSaveButton(wrapper, exportFilename);
    }).catch(() => { /* test environments without export.js */ });
  }

  return {
    svg: svg.node(),
    inner: inner.node(),
    width: innerWidth,
    height: innerHeight,
    margin,
    wrapper,
  };
}

/**
 * Add X and Y axes to a chart frame.
 * @param {ChartFrame} frame
 * @param {*} xAxis - d3.axisBottom scale
 * @param {*} yAxis - d3.axisLeft scale
 * @param {string} [xLabel] - X-axis label text
 * @param {string} [yLabel] - Y-axis label text
 */
export function addAxes(frame, xAxis, yAxis, xLabel, yLabel) {
  const inner = d3Selection.select(frame.inner);
  const axes = inner.select('.axes');

  // Limit y-axis ticks: compact charts get fewer, desktop caps at 7
  const isPhone = detectPhoneMargin();
  if (typeof yAxis.ticks === 'function') {
    if (frame.height < 200) yAxis.ticks(3);
    else if (isPhone || frame.height < 280) yAxis.ticks(5);
    else yAxis.ticks(7);
  }

  // X axis — render, then auto-reduce ticks if labels overlap
  const xAxisG = axes.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${frame.height})`)
    .call(xAxis);
  autoReduceTicks(xAxisG, xAxis);

  // Y axis
  axes.append('g')
    .attr('class', 'y-axis')
    .call(yAxis);

  // X-axis label
  if (xLabel) {
    const xLabelEl = axes.append('text')
      .attr('class', 'x-label')
      .attr('text-anchor', 'middle')
      .attr('x', frame.width / 2)
      .attr('y', frame.height + frame.margin.bottom - 8);
    renderStatLabel(xLabelEl, xLabel);
  }

  // Y-axis label — adaptive placement with viewBox expansion if needed
  if (yLabel) {
    fitYLabel(frame, yLabel);
  }
}

/**
 * Draw faint horizontal gridlines from y-axis ticks (ggplot2-style).
 * Inserted behind the data layer so bars/dots paint on top.
 * @param {ChartFrame} frame
 */
export function drawHorizontalGridlines(frame) {
  const dataGroup = d3Selection.select(frame.inner).select('.data');
  d3Selection.select(frame.inner).select('.axes .y-axis')
    .selectAll('.tick').each(function () {
      const transform = d3Selection.select(this).attr('transform');
      const m = transform && transform.match(/translate\(\s*[\d.e+-]+\s*,\s*([\d.e+-]+)/);
      if (m) {
        const ty = parseFloat(m[1]);
        // Skip the baseline (y = frame.height)
        if (Math.abs(ty - frame.height) < 1) return;
        dataGroup.insert('line', ':first-child')
          .attr('class', 'grid-line')
          .attr('x1', 0)
          .attr('x2', frame.width)
          .attr('y1', ty)
          .attr('y2', ty)
          .attr('stroke', '#d8d8d8')
          .attr('stroke-width', 0.5);
      }
    });
}

/**
 * Estimate the left margin needed for y-axis tick labels + a rotated y-label.
 *
 * Call BEFORE createChart() to get the correct margin from the start,
 * avoiding mid-render viewBox adjustments and visual flicker.
 *
 * @param {number[]} yTickValues - Representative tick values (e.g. from yScale.ticks())
 * @param {object} [options]
 * @param {boolean} [options.hasLabel] - Whether a y-axis label will be shown (default: true)
 * @param {(v: number) => string} [options.format] - Tick formatter (default: formatTick)
 * @returns {number} Recommended left margin in viewBox units
 */
export function estimateLeftMargin(yTickValues, options) {
  const hasLabel = options?.hasLabel ?? true;
  const fmt = options?.format ?? formatTick;

  // Estimate widest tick label width from character count.
  // Atkinson Hyperlegible at 15px: digits measure ~10–11px via getBBox().
  // Use 13 as a generous per-character estimate to prevent clipping.
  const CHAR_WIDTH = 13;
  let maxChars = 1;
  for (const v of yTickValues) {
    const len = fmt(v).length;
    if (len > maxChars) maxChars = len;
  }
  const tickWidth = maxChars * CHAR_WIDTH;

  // Gap between ticks and label, plus the label's ascent after rotation.
  // Rotated 90°, the text ascent (~14px for 16px font) extends leftward.
  const GAP = 10;
  const LABEL_ASCENT = hasLabel ? 18 : 0;
  const EDGE_PAD = 4;

  return Math.ceil(tickWidth + GAP + LABEL_ASCENT + EDGE_PAD);
}

/**
 * Place a y-axis label with correct positioning based on measured tick widths.
 *
 * Call AFTER drawing the y-axis. If estimateLeftMargin() was used to set the
 * margin, the label will always fit without viewBox adjustment.
 *
 * @param {ChartFrame} frame - Chart frame from createChart
 * @param {string} yLabel - Y-axis label text
 */
export function fitYLabel(frame, yLabel) {
  const inner = d3Selection.select(frame.inner);
  const axes = inner.select('.axes');

  // Measure widest y-axis tick label.
  // Try getComputedTextLength() first (works before layout in most browsers),
  // fall back to getBBox(), then estimate from character count.
  let maxTickWidth = 0;
  let tickCount = 0;
  let maxChars = 0;
  axes.select('.y-axis').selectAll('.tick text').each(function () {
    tickCount++;
    const el = /** @type {SVGTextElement} */ (this);
    const chars = (el.textContent || '').length;
    if (chars > maxChars) maxChars = chars;
    try {
      const w = el.getComputedTextLength?.() || el.getBBox().width;
      if (w > maxTickWidth) maxTickWidth = w;
    } catch { /* JSDOM */ }
  });

  // If measurement returned 0 (common during synchronous DOM construction),
  // estimate from character count. ~8.5px per char at 15px Atkinson Hyperlegible.
  if (maxTickWidth === 0 && maxChars > 0) {
    maxTickWidth = maxChars * 8.5;
  }

  // Position: just outside the tick labels with a comfortable gap
  const GAP = 14;
  const labelY = -(maxTickWidth + GAP);

  // Safety check: if label would be clipped, expand viewBox.
  // LABEL_EXTENT accounts for the rotated label's full visual extent leftward
  // from its baseline: font ascent + padding at 16px font-weight 500.
  const LABEL_EXTENT = 26;
  const needed = maxTickWidth + GAP + LABEL_EXTENT;
  if (needed > frame.margin.left) {
    const extra = Math.ceil(needed - frame.margin.left);
    const svg = d3Selection.select(frame.svg);
    const oldVB = svg.attr('viewBox').split(' ').map(Number);
    svg.attr('viewBox', `${oldVB[0] - extra} ${oldVB[1]} ${oldVB[2] + extra} ${oldVB[3]}`);
    inner.attr('transform', `translate(${frame.margin.left + extra}, ${frame.margin.top})`);
    frame.margin = { ...frame.margin, left: frame.margin.left + extra };
  }

  axes.append('text')
    .attr('class', 'y-label')
    .attr('text-anchor', 'middle')
    .attr('transform', 'rotate(-90)')
    .attr('x', -frame.height / 2)
    .attr('y', labelY)
    .text(yLabel);
}

/**
 * Detect if phone margins should be used.
 * @returns {boolean}
 */
function detectPhoneMargin() {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(max-width: 480px)').matches;
}

/**
 * Auto-rotate x-axis categorical tick labels when they overlap horizontally.
 * Rotates to -40 degrees, truncates labels that would overflow the bottom margin,
 * and returns true if rotation was applied (so caller can hide x-axis title).
 *
 * @param {d3Selection.Selection} axisG - The x-axis <g> element
 * @param {number} maxBottomMargin - Available bottom margin (viewBox units)
 * @returns {boolean} Whether rotation was applied
 */
export function autoRotateLabels(axisG, maxBottomMargin) {
  const tickTexts = axisG.selectAll('.tick text').nodes();
  if (!tickTexts.length || !_ticksOverlap(tickTexts)) return false;

  // Max label length (in characters) that fits within bottom margin at -40°.
  // At ~7 viewBox units per char, rotated height ≈ len * 7 * sin(40°) ≈ len * 4.5.
  // Leave 12 units for tick mark + gap.
  const maxChars = Math.max(8, Math.floor((maxBottomMargin - 12) / 4.5));

  axisG.selectAll('.tick text').each(function () {
    const el = d3Selection.select(this);
    const text = el.text();
    if (text.length > maxChars) {
      el.text(text.slice(0, maxChars - 1) + '…');
    }
  });

  axisG.selectAll('.tick text')
    .attr('text-anchor', 'end')
    .attr('dx', '-0.5em')
    .attr('dy', '0.15em')
    .attr('transform', 'rotate(-40)');

  return true;
}

/**
 * Wrap long tick labels in an axis group by splitting into multiple <tspan> lines.
 * Works for both x-axis (horizontal text) and y-axis (horizontal text on left axis).
 * Labels are split at natural break points (spaces, hyphens, underscores, camelCase).
 *
 * @param {d3Selection.Selection} axisG - The axis <g> element (e.g., `.y-axis`)
 * @param {number} maxWidth - Maximum allowed width in viewBox units before wrapping
 */
export function wrapTickLabels(axisG, maxWidth) {
  axisG.selectAll('.tick text').each(function () {
    const textEl = d3Selection.select(this);
    const fullText = textEl.text();

    // Quick check: does the label even need wrapping?
    let textWidth = 0;
    try { textWidth = /** @type {SVGTextElement} */ (this).getBBox().width; }
    catch { return; /* getBBox fails in JSDOM */ }
    if (textWidth <= maxWidth) return;

    // Split at spaces, hyphens (keep hyphen), underscores, or camelCase boundaries
    const words = fullText
      .replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase → separate words
      .replace(/[_]/g, ' ')                       // underscores → spaces
      .split(/\s+/)                                // split on whitespace
      .filter(Boolean);

    if (words.length <= 1) return; // can't split a single word

    const x = textEl.attr('x') || '0';
    const dy = parseFloat(textEl.attr('dy') || '0');
    const anchor = textEl.attr('text-anchor') || 'end';

    textEl.text(null); // clear existing text

    let currentLine = '';
    let lineNumber = 0;
    const lineHeight = 1.1; // em

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
      const tspan = textEl.append('tspan')
        .attr('x', x)
        .attr('text-anchor', anchor)
        .text(testLine);

      let tspanWidth = 0;
      try { tspanWidth = /** @type {SVGTSpanElement} */ (tspan.node()).getComputedTextLength(); }
      catch { tspanWidth = testLine.length * 7; } // fallback estimate

      if (tspanWidth > maxWidth && currentLine) {
        // This word pushes over — finalize previous line, start new one
        tspan.text(currentLine);
        tspan.attr('dy', lineNumber === 0 ? '0em' : `${lineHeight}em`);
        currentLine = words[i];
        lineNumber++;
      } else {
        currentLine = testLine;
        tspan.remove(); // will re-add on finalize
      }
    }

    // Add final line
    if (currentLine) {
      const lastTspan = textEl.append('tspan')
        .attr('x', x)
        .attr('text-anchor', anchor)
        .attr('dy', lineNumber === 0 ? '0em' : `${lineHeight}em`)
        .text(currentLine);
    }

    // Re-center vertically: shift up by half the total height added
    const totalLines = lineNumber + 1;
    if (totalLines > 1) {
      const shiftUp = ((totalLines - 1) * lineHeight) / 2;
      textEl.selectAll('tspan').each(function (_, i) {
        const ts = d3Selection.select(this);
        if (i === 0) {
          ts.attr('dy', `-${shiftUp}em`);
        } else {
          ts.attr('dy', `${lineHeight}em`);
        }
      });
    }
  });
}

/**
 * Render a statistical label in SVG, converting combining overline (U+0304)
 * into proper SVG `<tspan text-decoration="overline">` for reliable rendering.
 *
 * Splits the input on sequences like "x̄" (char + \u0304) and wraps the base
 * character in an overlined tspan. Everything else is appended as plain text.
 *
 * @param {d3Selection.Selection} textEl - SVG <text> element
 * @param {string} label - Label text, may contain combining overline chars
 */
export function renderStatLabel(textEl, label) {
  // Pattern: any character followed by combining overline (U+0304)
  const parts = label.split(/(.(?:\u0304))/u);
  let hasOverline = false;
  for (const part of parts) {
    if (!part) continue;
    if (part.includes('\u0304')) {
      hasOverline = true;
      const base = part.replace('\u0304', '');
      textEl.append('tspan')
        .attr('text-decoration', 'overline')
        .text(base);
    } else {
      textEl.append('tspan').text(part);
    }
  }
  // Fallback: if no combining chars found, just set text directly
  if (!hasOverline) {
    textEl.text(label);
  }
}

/**
 * Render probability pills on a simulation/test chart.
 * For randomization: p-value pill in the tail, complement pill in the body.
 * For bootstrap CI: proportion pill centered between CI bounds.
 *
 * When the tail region is narrow (< 25% of chart width), the p-value pill
 * floats above the bars with a leader line pointing down to the tail.
 *
 * @param {ChartFrame} frame - Chart frame from createChart
 * @param {any} xScale - D3 linear scale for x-axis
 * @param {object} opts
 * @param {'randomization'|'bootstrap'} opts.mode
 * @param {number} [opts.pValue] - P-value (randomization mode)
 * @param {number} [opts.observedStat] - Observed test statistic (randomization mode)
 * @param {'left'|'right'|'both'} [opts.direction] - Tail direction (randomization mode)
 * @param {string} [opts.pLabel] - Pre-formatted p-value text (overrides default formatting)
 * @param {string} [opts.proportionLabel] - Pre-formatted proportion text (bootstrap mode)
 * @param {[number,number]} [opts.ci] - CI bounds (bootstrap mode)
 */
export function renderSimPills(frame, xScale, opts) {
  const annotations = d3Selection.select(frame.inner).select('.annotations');
  annotations.selectAll('.sim-pill').remove();

  const w = frame.width;
  const h = frame.height;
  const pillY = h * 0.6;

  if (opts.mode === 'randomization' && opts.pValue != null && opts.observedStat != null && opts.direction) {
    const obsX = xScale(opts.observedStat);
    const p = opts.pValue;
    const comp = 1 - p;

    // Format p-value text
    let pText = opts.pLabel;
    if (!pText) {
      if (p === 0) pText = 'p ≈ 0';
      else if (p < 0.0001) pText = 'p < 0.0001';
      else pText = `p = ${p.toFixed(4)}`;
    }
    const compText = comp.toFixed(4);

    if (opts.direction === 'both') {
      const labelX = Math.max(60, Math.min(w - 60, obsX));
      _addSimPill(annotations, `${pText}  (two-tailed)`, labelX, pillY, false);
    } else {
      // Determine tail and body regions
      const isLeft = opts.direction === 'left';

      // Tail pill: centered in tail region, clamped to chart
      const tailMidX = isLeft ? obsX / 2 : (obsX + w) / 2;
      const clampedTailX = Math.max(35, Math.min(w - 35, tailMidX));
      _addSimPill(annotations, pText, clampedTailX, pillY, false);

      // Complement pill: centered in body region, clamped to chart
      const bodyMidX = isLeft ? (obsX + w) / 2 : obsX / 2;
      const clampedBodyX = Math.max(35, Math.min(w - 35, bodyMidX));
      _addSimPill(annotations, compText, clampedBodyX, pillY, true);

      // Leader lines only when pill is displaced from its region
      const { charW: _lCharW, pad: _lPad } = pillDimensions('prob');
      const leaderEndY = h - 4;
      for (const [cx, midX, color, text] of [
        [clampedTailX, tailMidX, '#569BBD', pText],
        [clampedBodyX, bodyMidX, '#888', compText],
      ]) {
        const tw = /** @type {string} */ (text).length * _lCharW + _lPad;
        const displaced = Math.abs(cx - midX) > tw * 0.5;
        if (displaced) {
          const targetX = Math.max(4, Math.min(w - 4, midX));
          annotations.append('line')
            .attr('class', 'sim-pill')
            .attr('x1', cx).attr('y1', pillY + 14)
            .attr('x2', targetX).attr('y2', leaderEndY)
            .attr('stroke', color)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '3,2')
            .style('pointer-events', 'none');
        }
      }
    }
  } else if (opts.mode === 'bootstrap' && opts.proportionLabel && opts.ci) {
    const [ciLo, ciHi] = opts.ci;
    const loX = xScale(ciLo);
    const hiX = xScale(ciHi);
    const midX = Math.max(50, Math.min(w - 50, (loX + hiX) / 2));
    _addSimPill(annotations, opts.proportionLabel, midX, pillY, false);
  }
}

/**
 * Render a single pill (rounded rect + text) on a chart annotation layer.
 * @param {d3Selection.Selection} group
 * @param {string} text
 * @param {number} cx - Center x
 * @param {number} cy - Center y
 * @param {boolean} isComplement - If true, use subdued gray style
 */
function _addSimPill(group, text, cx, cy, isComplement) {
  const g = group.append('g').attr('class', 'sim-pill');
  const { charW, pad, pillH } = pillDimensions('prob');
  const textWidth = text.length * charW + pad;
  g.append('rect')
    .attr('x', cx - textWidth / 2)
    .attr('y', cy - pillH / 2)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 4)
    .attr('fill', isComplement ? '#ffffff' : '#e8f4f8')
    .attr('stroke', isComplement ? '#888' : '#569BBD')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');
  g.append('text')
    .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', cx)
    .attr('y', cy)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComplement ? '#6B6B6B' : '#7B2D8E')
    .style('pointer-events', 'none')
    .text(text);
}

/**
 * Show a custom SVG tooltip above a point inside a chart.
 * The tooltip is rendered in the chart's .chart-tooltip layer so it
 * appears on top of all chart elements and is positioned in viewBox
 * coordinates (not screen pixels).
 *
 * @param {SVGGElement} innerNode - The chart-inner <g> node (frame.inner)
 * @param {string[]} lines - Lines of text to display
 * @param {number} x - X position in inner coordinates (center of tooltip)
 * @param {number} y - Y position in inner coordinates (tooltip appears above this)
 */
export function showTooltip(innerNode, lines, x, y) {
  const g = d3Selection.select(innerNode).select('.chart-tooltip');
  g.selectAll('*').remove();
  g.attr('visibility', 'visible');

  const text = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('fill', '#333')
    .style('font-weight', '600');

  lines.forEach((line, i) => {
    text.append('tspan')
      .attr('x', 0)
      .attr('dy', i === 0 ? '0' : '1.3em')
      .text(line);
  });

  // Measure and add background rect behind text
  try {
    const bbox = /** @type {SVGTextElement} */ (text.node()).getBBox();
    const pad = 6;
    g.insert('rect', 'text')
      .attr('x', bbox.x - pad)
      .attr('y', bbox.y - pad)
      .attr('width', bbox.width + pad * 2)
      .attr('height', bbox.height + pad * 2)
      .attr('fill', 'white')
      .attr('fill-opacity', 0.95)
      .attr('stroke', '#999')
      .attr('stroke-width', 0.75)
      .attr('rx', 4);

    // Position centered above the target point
    let tooltipY = y - (-bbox.y) - pad - 6;
    // Clamp: don't go above the chart area
    if (tooltipY + bbox.y - pad < -20) {
      tooltipY = y + 20; // flip below instead
    }
    g.attr('transform', `translate(${x}, ${tooltipY})`);
  } catch {
    // getBBox fails in JSDOM — position without measurement
    g.attr('transform', `translate(${x}, ${y - 20})`);
  }
}

/**
 * Hide the custom SVG tooltip.
 * @param {SVGGElement} innerNode - The chart-inner <g> node (frame.inner)
 */
export function hideTooltip(innerNode) {
  const g = d3Selection.select(innerNode).select('.chart-tooltip');
  g.attr('visibility', 'hidden').selectAll('*').remove();
}

/**
 * Attach tooltip show/hide to a D3 selection for both mouse and keyboard.
 * Makes elements focusable (tabindex=0) and wires mouseenter/mouseleave
 * plus focusin/focusout so keyboard users can trigger tooltips.
 *
 * @param {d3Selection.Selection} selection - D3 selection of elements
 * @param {SVGGElement} innerNode - The chart-inner <g> node (frame.inner)
 * @param {(d: any, i: number) => { lines: string[], x: number, y: number }} tooltipFn
 *   Callback that returns tooltip content and position for each datum.
 */
export function attachTooltip(selection, innerNode, tooltipFn) {
  selection
    .attr('tabindex', '0')
    .style('outline', 'none')
    .on('mouseenter', function(event, d) {
      const i = selection.nodes().indexOf(this);
      const { lines, x, y } = tooltipFn(d, i);
      showTooltip(innerNode, lines, x, y);
    })
    .on('mouseleave', () => hideTooltip(innerNode))
    .on('focusin', function(event, d) {
      const i = selection.nodes().indexOf(this);
      const { lines, x, y } = tooltipFn(d, i);
      showTooltip(innerNode, lines, x, y);
    })
    .on('focusout', () => hideTooltip(innerNode));
}

// ─── Mechanism strip utilities ──────────────────────────────────────

/**
 * Build HTML for a mechanism stat line with highlight on the NUMBER only.
 * Returns e.g. `<span class="mech-stat-label">Resample mean</span> = <span class="mech-stat-value highlight-last">12.34</span>`
 *
 * @param {string} label - Text label (e.g. "Resample mean", "χ²", "diff")
 * @param {string} formattedValue - Already-formatted number string
 * @param {boolean} [highlight=false] - Whether to apply orange highlight to the value
 * @returns {string} HTML string
 */
export function formatMechStat(label, formattedValue, highlight = false) {
  const hlClass = highlight ? ' highlight-last' : '';
  return `<span class="mech-stat-label">${label}</span> = <span class="mech-stat-value${hlClass}">${formattedValue}</span>`;
}

/**
 * Draw a minimal inline-SVG boxplot into a mechanism strip container.
 * No D3 dependency — uses plain DOM. Horizontal orientation.
 *
 * @param {HTMLElement} container - DOM element to render into (cleared first)
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.width=200] - SVG width
 * @param {number} [options.height=32] - SVG height
 * @param {number} [options.meanValue] - If provided, draw a mean marker (diamond)
 * @param {boolean} [options.highlightMean=false] - Draw mean marker in orange
 * @param {[number, number]} [options.domain] - Fixed x domain [lo, hi]; auto if omitted
 * @param {string} [options.color='#569BBD'] - Box/whisker color
 * @param {string} [options.label] - aria-label for the SVG
 */
export function drawMiniBoxplot(container, values, options = {}) {
  const {
    width = 200,
    height = 32,
    meanValue,
    highlightMean = false,
    domain,
    color = '#569BBD',
    label = 'Mini boxplot',
  } = options;

  if (!values || values.length < 2) {
    container.innerHTML = '';
    return;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Quartiles (R type=7 compatible via linear interpolation)
  const q = (/** @type {number} */ p) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  };
  const q1 = q(0.25);
  const med = q(0.5);
  const q3 = q(0.75);
  const iqr = q3 - q1;

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLo = sorted.find(d => d >= lowerFence) ?? q1;
  const whiskerHi = sorted.findLast(d => d <= upperFence) ?? q3;
  const outliers = sorted.filter(d => d < lowerFence || d > upperFence);

  // Scale
  const pad = 6; // px padding
  const allPts = domain ? [] : [...sorted];
  if (meanValue !== undefined && !domain) allPts.push(meanValue);
  const lo = domain ? domain[0] : Math.min(...allPts);
  const hi = domain ? domain[1] : Math.max(...allPts);
  const range = hi - lo || 1;
  const x = (/** @type {number} */ v) => pad + ((v - lo) / range) * (width - 2 * pad);

  const cy = height / 2;
  const boxH = height * 0.55;
  const boxTop = cy - boxH / 2;

  let svg = `<svg class="mech-minibox" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${label}">`;

  // Whisker lines
  svg += `<line class="bp-wlo" x1="${x(whiskerLo)}" x2="${x(q1)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>`;
  svg += `<line class="bp-whi" x1="${x(q3)}" x2="${x(whiskerHi)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>`;

  // Whisker caps
  const capH = boxH * 0.5;
  svg += `<line class="bp-clo" x1="${x(whiskerLo)}" x2="${x(whiskerLo)}" y1="${cy - capH/2}" y2="${cy + capH/2}" stroke="${color}" stroke-width="1.5"/>`;
  svg += `<line class="bp-chi" x1="${x(whiskerHi)}" x2="${x(whiskerHi)}" y1="${cy - capH/2}" y2="${cy + capH/2}" stroke="${color}" stroke-width="1.5"/>`;

  // Box
  const bx = x(q1);
  const bw = x(q3) - bx;
  svg += `<rect class="bp-box" x="${bx}" y="${boxTop}" width="${Math.max(bw, 1)}" height="${boxH}" fill="${color}30" stroke="${color}" stroke-width="1.5" rx="1"/>`;

  // Median line
  svg += `<line class="bp-med" x1="${x(med)}" x2="${x(med)}" y1="${boxTop}" y2="${boxTop + boxH}" stroke="${color}" stroke-width="2"/>`;

  // Outliers
  for (const o of outliers) {
    svg += `<circle cx="${x(o)}" cy="${cy}" r="2" fill="none" stroke="${color}" stroke-width="1"/>`;
  }

  // Mean marker (diamond)
  if (meanValue !== undefined) {
    const mx = x(meanValue);
    const ms = 4; // half-size
    const mColor = highlightMean ? '#E07020' : color;
    svg += `<polygon class="bp-mean" points="${mx},${cy - ms} ${mx + ms},${cy} ${mx},${cy + ms} ${mx - ms},${cy}" fill="${mColor}" stroke="${mColor}" stroke-width="0.5"/>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
}

/**
 * Animate an existing mini boxplot to new data values.
 * Falls back to instant drawMiniBoxplot if no existing SVG or reduced motion.
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ width?: number, height?: number, meanValue?: number, highlightMean?: boolean, domain?: [number, number], color?: string, label?: string }} options
 * @returns {number} Animation duration in ms (0 if instant)
 */
export function morphMiniBoxplot(container, values, options = {}) {
  const width = options.width ?? 200;
  const height = options.height ?? 32;
  const meanValue = options.meanValue;
  const highlightMean = options.highlightMean ?? false;
  const domain = options.domain;
  const color = options.color ?? '#569BBD';

  const svgEl = container.querySelector('svg.mech-minibox');
  if (!svgEl || !values || values.length < 2 || prefersReducedMotion()) {
    drawMiniBoxplot(container, values, options);
    return 0;
  }

  // Compute new boxplot stats
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const qFn = (/** @type {number} */ p) => {
    const h = (n - 1) * p;
    const flo = Math.floor(h);
    const fhi = Math.ceil(h);
    return sorted[flo] + (sorted[fhi] - sorted[flo]) * (h - flo);
  };
  const q1 = qFn(0.25);
  const med = qFn(0.5);
  const q3 = qFn(0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLo = sorted.find(d => d >= lowerFence) ?? q1;
  const whiskerHi = sorted.findLast(d => d <= upperFence) ?? q3;

  // Scale (same as drawMiniBoxplot)
  const pad = 6;
  const lo = domain ? domain[0] : Math.min(...sorted);
  const hi = domain ? domain[1] : Math.max(...sorted);
  const range = hi - lo || 1;
  const x = (/** @type {number} */ v) => pad + ((v - lo) / range) * (width - 2 * pad);

  const cy = height / 2;

  // Target positions
  const targets = {
    wloX1: x(whiskerLo), wloX2: x(q1),
    whiX1: x(q3), whiX2: x(whiskerHi),
    cloX: x(whiskerLo), chiX: x(whiskerHi),
    boxX: x(q1), boxW: Math.max(x(q3) - x(q1), 1),
    medX: x(med),
    meanX: meanValue !== undefined ? x(meanValue) : null,
  };

  // Read current positions from SVG elements
  const wlo = svgEl.querySelector('.bp-wlo');
  const whi = svgEl.querySelector('.bp-whi');
  const clo = svgEl.querySelector('.bp-clo');
  const chi = svgEl.querySelector('.bp-chi');
  const box = svgEl.querySelector('.bp-box');
  const medLine = svgEl.querySelector('.bp-med');
  const meanEl = svgEl.querySelector('.bp-mean');

  if (!wlo || !whi || !clo || !chi || !box || !medLine) {
    drawMiniBoxplot(container, values, options);
    return 0;
  }

  /** @param {string|null} a */
  const num = (a) => +(a ?? '0');

  const starts = {
    wloX1: num(wlo.getAttribute('x1')), wloX2: num(wlo.getAttribute('x2')),
    whiX1: num(whi.getAttribute('x1')), whiX2: num(whi.getAttribute('x2')),
    cloX: num(clo.getAttribute('x1')), chiX: num(chi.getAttribute('x1')),
    boxX: num(box.getAttribute('x')), boxW: num(box.getAttribute('width')),
    medX: num(medLine.getAttribute('x1')),
    meanX: meanEl ? num((meanEl.getAttribute('points') ?? '').split(',')[0]) : null,
  };

  const MORPH_MS = 400;
  const easeOut = (/** @type {number} */ t) => 1 - (1 - t) ** 3;
  let startTime = 0;

  /**
   * @param {number} from
   * @param {number} to
   * @param {number} e
   */
  const lerp = (from, to, e) => from + (to - from) * e;

  /** @param {number} now */
  function frame(now) {
    if (!startTime) startTime = now;
    const t = Math.min(1, (now - startTime) / MORPH_MS);
    const e = easeOut(t);

    // Whisker lo
    wlo.setAttribute('x1', String(lerp(starts.wloX1, targets.wloX1, e)));
    wlo.setAttribute('x2', String(lerp(starts.wloX2, targets.wloX2, e)));

    // Whisker hi
    whi.setAttribute('x1', String(lerp(starts.whiX1, targets.whiX1, e)));
    whi.setAttribute('x2', String(lerp(starts.whiX2, targets.whiX2, e)));

    // Caps
    const cloX = lerp(starts.cloX, targets.cloX, e);
    const chiX = lerp(starts.chiX, targets.chiX, e);
    clo.setAttribute('x1', String(cloX));
    clo.setAttribute('x2', String(cloX));
    chi.setAttribute('x1', String(chiX));
    chi.setAttribute('x2', String(chiX));

    // Box
    const bx = lerp(starts.boxX, targets.boxX, e);
    const bw = lerp(starts.boxW, targets.boxW, e);
    box.setAttribute('x', String(bx));
    box.setAttribute('width', String(Math.max(bw, 1)));

    // Median
    const mx = lerp(starts.medX, targets.medX, e);
    medLine.setAttribute('x1', String(mx));
    medLine.setAttribute('x2', String(mx));

    // Mean diamond
    if (meanEl && starts.meanX !== null && targets.meanX !== null) {
      const meanX = lerp(starts.meanX, targets.meanX, e);
      const ms = 4;
      meanEl.setAttribute('points',
        `${meanX},${cy - ms} ${meanX + ms},${cy} ${meanX},${cy + ms} ${meanX - ms},${cy}`);
      const mColor = highlightMean ? '#E07020' : color;
      meanEl.setAttribute('fill', mColor);
      meanEl.setAttribute('stroke', mColor);
    }

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      // Rebuild outliers (too many to track individually — just swap)
      svgEl.querySelectorAll('circle').forEach(c => c.remove());
      const outliers = sorted.filter(d => d < lowerFence || d > upperFence);
      for (const o of outliers) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(x(o)));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '2');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '1');
        if (meanEl) svgEl.insertBefore(circle, meanEl);
        else svgEl.appendChild(circle);
      }
    }
  }

  requestAnimationFrame(frame);
  return MORPH_MS;
}

// ─── Mini dotplot / histogram for mechanism strip ───

/**
 * Choose ~3-5 "nice" tick values for a mini axis.
 * @param {number} lo
 * @param {number} hi
 * @returns {number[]}
 */
function miniAxisTicks(lo, hi) {
  const range = hi - lo;
  if (range === 0) return [lo];
  // Target ~4 ticks
  const rawStep = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10];
  const match = candidates.find(c => c * mag >= rawStep);
  let step = (match ?? 1) * mag;
  if (!step) step = rawStep;
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) {
    ticks.push(Math.round(v / (step * 0.1)) * (step * 0.1)); // avoid FP noise
  }
  return ticks;
}

/**
 * Format a tick value compactly (drop trailing zeros).
 * @param {number} v
 * @returns {string}
 */
function fmtTick(v) {
  if (Number.isInteger(v)) return String(v);
  // Up to 2 decimal places
  const s = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/**
 * Draw a mini dotplot in a mechanism strip panel.
 * Uses stacked dots on an x-axis with ticks and a mean marker line.
 * Best for n ≤ 30.
 *
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ width?: number, height?: number, meanValue?: number, highlightMean?: boolean, domain?: [number, number], color?: string, label?: string }} options
 */
export function drawMiniDotplot(container, values, options = {}) {
  const {
    width = 220,
    height = 60,
    meanValue,
    highlightMean = false,
    domain,
    color = '#569BBD',
    label = 'Mini dotplot',
  } = options;

  if (!values || values.length < 1) { container.innerHTML = ''; return; }

  const axisH = 14; // space for axis ticks + labels
  const plotH = height - axisH;
  const padX = 10;

  // Domain
  const sorted = [...values].sort((a, b) => a - b);
  const dLo = domain ? domain[0] : sorted[0];
  const dHi = domain ? domain[1] : sorted[sorted.length - 1];
  const range = dHi - dLo || 1;
  const x = (/** @type {number} */ v) => padX + ((v - dLo) / range) * (width - 2 * padX);

  // Bin values into stacks (snap to nearest pixel)
  const dotR = Math.min(4, Math.max(2, (width - 2 * padX) / (values.length * 2.5)));
  const binWidth = dotR * 2.2;
  /** @type {Map<number, number[]>} */
  const stacks = new Map();
  for (const v of sorted) {
    const bin = Math.round(x(v) / binWidth) * binWidth;
    if (!stacks.has(bin)) stacks.set(bin, []);
    /** @type {number[]} */ (stacks.get(bin)).push(v);
  }

  const maxStack = Math.max(...[...stacks.values()].map(s => s.length));
  const dotSpacing = dotR * 2.1;
  const neededH = maxStack * dotSpacing + dotR;
  const scale = neededH > plotH ? plotH / neededH : 1;
  const effectiveR = dotR * scale;
  const effectiveSpacing = dotSpacing * scale;

  let svg = `<svg class="mech-minichart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${label}">`;

  // Dots (bottom-up stacking) — cx is the bin center, not the raw data x
  const baseY = plotH - effectiveR;
  for (const [binCenter, stack] of stacks) {
    for (let i = 0; i < stack.length; i++) {
      const cx = binCenter;
      const cy = baseY - i * effectiveSpacing;
      svg += `<circle class="mc-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${effectiveR.toFixed(1)}" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="0.5"/>`;
    }
  }

  // Mean marker line (vertical, full height of plot area)
  if (meanValue !== undefined) {
    const mx = x(meanValue);
    const mColor = highlightMean ? '#E07020' : '#D33';
    svg += `<line class="mc-mean" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="0" y2="${plotH}" stroke="${mColor}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    // Small triangle at top
    svg += `<polygon class="mc-mean-tri" points="${mx - 3},0 ${mx + 3},0 ${mx},4" fill="${mColor}"/>`;
  }

  // X-axis line
  svg += `<line x1="${padX}" x2="${width - padX}" y1="${plotH}" y2="${plotH}" stroke="#666" stroke-width="0.75"/>`;

  // Tick marks and labels
  const ticks = miniAxisTicks(dLo, dHi);
  for (const t of ticks) {
    const tx = x(t);
    if (tx < padX - 1 || tx > width - padX + 1) continue;
    svg += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${plotH}" y2="${plotH + 3}" stroke="#666" stroke-width="0.75"/>`;
    svg += `<text x="${tx.toFixed(1)}" y="${height - 1}" text-anchor="middle" fill="#555" font-size="8">${fmtTick(t)}</text>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
}

/**
 * Draw a mini histogram in a mechanism strip panel.
 * Uses bars on an x-axis with ticks and a mean marker line.
 * Best for n > 30.
 *
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ width?: number, height?: number, meanValue?: number, highlightMean?: boolean, domain?: [number, number], color?: string, label?: string, numBins?: number }} options
 */
export function drawMiniHistogram(container, values, options = {}) {
  const {
    width = 220,
    height = 60,
    meanValue,
    highlightMean = false,
    domain,
    color = '#569BBD',
    label = 'Mini histogram',
    numBins = 10,
  } = options;

  if (!values || values.length < 1) { container.innerHTML = ''; return; }

  const axisH = 14;
  const plotH = height - axisH;
  const padX = 10;

  const sorted = [...values].sort((a, b) => a - b);
  const dLo = domain ? domain[0] : sorted[0];
  const dHi = domain ? domain[1] : sorted[sorted.length - 1];
  const range = dHi - dLo || 1;
  const x = (/** @type {number} */ v) => padX + ((v - dLo) / range) * (width - 2 * padX);

  // Build bins
  const binW = range / numBins;
  /** @type {number[]} */
  const counts = new Array(numBins).fill(0);
  for (const v of sorted) {
    let idx = Math.floor((v - dLo) / binW);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  const maxCount = Math.max(...counts, 1);
  const barH = (/** @type {number} */ c) => (c / maxCount) * (plotH - 2);

  let svg = `<svg class="mech-minichart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${label}">`;

  // Bars
  for (let i = 0; i < numBins; i++) {
    if (counts[i] === 0) continue;
    const bx = x(dLo + i * binW);
    const bw = x(dLo + (i + 1) * binW) - bx;
    const bh = barH(counts[i]);
    const by = plotH - bh;
    svg += `<rect class="mc-bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(bw - 0.5, 0.5).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="0.5"/>`;
  }

  // Mean marker line
  if (meanValue !== undefined) {
    const mx = x(meanValue);
    const mColor = highlightMean ? '#E07020' : '#D33';
    svg += `<line class="mc-mean" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="0" y2="${plotH}" stroke="${mColor}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    svg += `<polygon class="mc-mean-tri" points="${mx - 3},0 ${mx + 3},0 ${mx},4" fill="${mColor}"/>`;
  }

  // X-axis line
  svg += `<line x1="${padX}" x2="${width - padX}" y1="${plotH}" y2="${plotH}" stroke="#666" stroke-width="0.75"/>`;

  // Tick marks and labels
  const ticks = miniAxisTicks(dLo, dHi);
  for (const t of ticks) {
    const tx = x(t);
    if (tx < padX - 1 || tx > width - padX + 1) continue;
    svg += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${plotH}" y2="${plotH + 3}" stroke="#666" stroke-width="0.75"/>`;
    svg += `<text x="${tx.toFixed(1)}" y="${height - 1}" text-anchor="middle" fill="#555" font-size="8">${fmtTick(t)}</text>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
}

/**
 * Convenience: draw whichever mini chart is appropriate for the sample size.
 * n ≤ 30 → dotplot, n > 30 → histogram.
 *
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ width?: number, height?: number, meanValue?: number, highlightMean?: boolean, domain?: [number, number], color?: string, label?: string }} options
 */
export function drawMiniChart(container, values, options = {}) {
  if (!values || values.length === 0) { container.innerHTML = ''; return; }
  if (values.length <= 30) {
    drawMiniDotplot(container, values, options);
  } else {
    drawMiniHistogram(container, values, options);
  }
}

/**
 * Animate a mini dotplot or histogram to new data by shifting all elements horizontally.
 * Used for the observed→null morph in the mechanism strip.
 * Falls back to instant redraw if no SVG exists or reduced motion is preferred.
 *
 * @param {HTMLElement} container
 * @param {number[]} newValues
 * @param {{ width?: number, height?: number, meanValue?: number, highlightMean?: boolean, domain?: [number, number], color?: string, label?: string }} options
 * @returns {number} Animation duration in ms (0 if instant)
 */
export function morphMiniChart(container, newValues, options = {}) {
  const svgEl = container.querySelector('svg.mech-minichart');
  if (!svgEl || !newValues || newValues.length < 1 || prefersReducedMotion()) {
    drawMiniChart(container, newValues, options);
    return 0;
  }

  const width = options.width ?? 220;
  const domain = options.domain;
  const padX = 10;

  // Compute horizontal shift: domain is the same, but data positions change.
  // We'll shift the entire SVG content, then redraw at the end.
  // For a clean morph: compute shift in data space and convert to pixel offset.

  // Compute the old mean x position from the existing mean marker
  const oldMeanLine = svgEl.querySelector('.mc-mean');
  if (!oldMeanLine) {
    drawMiniChart(container, newValues, options);
    return 0;
  }

  const oldMeanPx = parseFloat(oldMeanLine.getAttribute('x1') ?? '0');

  // New scale (same domain, shared for smooth morph)
  const dLo = domain ? domain[0] : Math.min(...newValues);
  const dHi = domain ? domain[1] : Math.max(...newValues);
  const range = dHi - dLo || 1;
  const x = (/** @type {number} */ v) => padX + ((v - dLo) / range) * (width - 2 * padX);

  const newMeanPx = options.meanValue !== undefined ? x(options.meanValue) : oldMeanPx;
  const shiftPx = newMeanPx - oldMeanPx;

  // If shift is negligible, just redraw
  if (Math.abs(shiftPx) < 0.5) {
    drawMiniChart(container, newValues, options);
    return 0;
  }

  const MORPH_MS = 400;
  const easeOut = (/** @type {number} */ t) => 1 - (1 - t) ** 3;
  let startTime = 0;

  // Create a <g> wrapper around all content (except axis) for smooth translation
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('mc-morph-group');
  // Move dots, bars, mean line, mean triangle into the group
  const moveable = svgEl.querySelectorAll('.mc-dot, .mc-bar, .mc-mean, .mc-mean-tri');
  for (const el of moveable) g.appendChild(el);
  svgEl.appendChild(g);

  // Also update mean marker color immediately
  const meanLine = g.querySelector('.mc-mean');
  const meanTri = g.querySelector('.mc-mean-tri');
  if (options.highlightMean) {
    if (meanLine) { meanLine.setAttribute('stroke', '#E07020'); }
    if (meanTri) { meanTri.setAttribute('fill', '#E07020'); }
  }

  /** @param {number} now */
  function frame(now) {
    if (!startTime) startTime = now;
    const t = Math.min(1, (now - startTime) / MORPH_MS);
    const e = easeOut(t);
    const dx = shiftPx * e;
    g.setAttribute('transform', `translate(${dx.toFixed(1)}, 0)`);

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      // Replace with final clean render
      drawMiniChart(container, newValues, options);
    }
  }

  requestAnimationFrame(frame);
  return MORPH_MS;
}
