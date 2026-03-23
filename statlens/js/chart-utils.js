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
 * Okabe-Ito accessible color palette.
 * @type {readonly string[]}
 */
const OKABE_ITO = [
  '#0072B2',   // blue (5.19:1)
  '#C08700',   // orange (3.13:1) — darkened from #E69F00 for WCAG 3:1
  '#009E73',   // teal (3.42:1)
  '#D55E00',   // vermillion (3.87:1)
  '#CC79A7',   // rose (3.06:1)
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
 * Create a responsive SVG chart inside a container element.
 * Applies the D3 margin convention with StatLens's standard dimensions.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {object} [options]
 * @param {number} [options.viewWidth=600] - SVG viewBox width
 * @param {number} [options.viewHeight=371] - SVG viewBox height
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {string} [options.titleText] - Text for <title> element
 * @param {string} [options.descText] - Text for <desc> element
 * @param {string} [options.id] - Unique ID prefix for ARIA references
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
  } = options;

  const innerWidth = viewWidth - margin.left - margin.right;
  const innerHeight = viewHeight - margin.top - margin.bottom;

  const el = typeof container === 'string'
    ? d3Selection.select(container)
    : d3Selection.select(container);

  const svg = el.append('svg')
    .attr('role', 'img')
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

  return {
    svg: svg.node(),
    inner: inner.node(),
    width: innerWidth,
    height: innerHeight,
    margin,
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

  // Reduce y-axis ticks for phone viewports or compact charts
  const isPhone = detectPhoneMargin();
  if (typeof yAxis.ticks === 'function') {
    if (frame.height < 200) yAxis.ticks(3);
    else if (isPhone || frame.height < 280) yAxis.ticks(5);
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
  // Atkinson Hyperlegible at 15px: digits are ~9.5px wide, commas ~5px.
  // Use 11 as a conservative per-character estimate to avoid clipping.
  const CHAR_WIDTH = 11;
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

  // Measure widest y-axis tick label
  let maxTickWidth = 0;
  axes.select('.y-axis').selectAll('.tick text').each(function () {
    try {
      const w = /** @type {SVGTextElement} */ (this).getBBox().width;
      if (w > maxTickWidth) maxTickWidth = w;
    } catch { /* getBBox fails in JSDOM */ }
  });

  // Position: just outside the tick labels with a small gap
  const GAP = 10;
  const labelY = -(maxTickWidth + GAP);

  // Safety check: if label would be clipped, expand viewBox
  const LABEL_ASCENT = 18;
  const needed = maxTickWidth + GAP + LABEL_ASCENT + 4;
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
  const pillY = h * 0.22;

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
      const tailEdge = isLeft ? 0 : w;
      const tailWidth = isLeft ? obsX : (w - obsX);
      const narrow = tailWidth < w * 0.25;

      if (narrow) {
        // Pill floats above plot area, positioned close to the tail
        const pillX = isLeft
          ? Math.max(60, Math.min(w * 0.35, obsX))
          : Math.min(w - 40, Math.max(w * 0.78, obsX));
        _addSimPill(annotations, pText, pillX, pillY, false);
        // Leader line from pill down to the observed stat line (always visible)
        const lineTargetX = Math.max(4, Math.min(w - 4, obsX));
        annotations.append('line')
          .attr('class', 'sim-pill')
          .attr('x1', pillX)
          .attr('y1', pillY + 14)
          .attr('x2', lineTargetX)
          .attr('y2', h - 2)
          .attr('stroke', '#569BBD')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,2')
          .style('pointer-events', 'none');
      } else {
        // Normal: pill centered in tail region
        const tailX = isLeft
          ? Math.max(50, Math.min(obsX - 10, obsX / 2))
          : Math.min(w - 50, Math.max(obsX + 10, (obsX + w) / 2));
        _addSimPill(annotations, pText, tailX, pillY, false);
      }

      // Complement pill in body (always has room)
      const bodyX = isLeft
        ? Math.min(w - 50, Math.max(obsX + 10, (obsX + w) / 2))
        : Math.max(50, Math.min(obsX - 10, obsX / 2));
      _addSimPill(annotations, compText, bodyX, pillY, true);
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
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  const textWidth = text.length * (isPhone ? 13 : 8.5) + 16;
  const pillH = isPhone ? 34 : 24;
  g.append('rect')
    .attr('x', cx - textWidth / 2)
    .attr('y', cy - pillH / 2)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 4)
    .attr('fill', isComplement ? '#f5f5f5' : '#e8f4f8')
    .attr('stroke', isComplement ? '#ccc' : '#569BBD')
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

  let svg = `<svg class="mech-minibox" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">`;

  // Whisker lines
  svg += `<line x1="${x(whiskerLo)}" x2="${x(q1)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>`;
  svg += `<line x1="${x(q3)}" x2="${x(whiskerHi)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>`;

  // Whisker caps
  const capH = boxH * 0.5;
  svg += `<line x1="${x(whiskerLo)}" x2="${x(whiskerLo)}" y1="${cy - capH/2}" y2="${cy + capH/2}" stroke="${color}" stroke-width="1.5"/>`;
  svg += `<line x1="${x(whiskerHi)}" x2="${x(whiskerHi)}" y1="${cy - capH/2}" y2="${cy + capH/2}" stroke="${color}" stroke-width="1.5"/>`;

  // Box
  const bx = x(q1);
  const bw = x(q3) - bx;
  svg += `<rect x="${bx}" y="${boxTop}" width="${Math.max(bw, 1)}" height="${boxH}" fill="${color}30" stroke="${color}" stroke-width="1.5" rx="1"/>`;

  // Median line
  svg += `<line x1="${x(med)}" x2="${x(med)}" y1="${boxTop}" y2="${boxTop + boxH}" stroke="${color}" stroke-width="2"/>`;

  // Outliers
  for (const o of outliers) {
    svg += `<circle cx="${x(o)}" cy="${cy}" r="2" fill="none" stroke="${color}" stroke-width="1"/>`;
  }

  // Mean marker (diamond)
  if (meanValue !== undefined) {
    const mx = x(meanValue);
    const ms = 4; // half-size
    const mColor = highlightMean ? '#E07020' : color;
    svg += `<polygon points="${mx},${cy - ms} ${mx + ms},${cy} ${mx},${cy + ms} ${mx - ms},${cy}" fill="${mColor}" stroke="${mColor}" stroke-width="0.5"/>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
}
