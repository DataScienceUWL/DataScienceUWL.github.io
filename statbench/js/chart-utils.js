// @ts-check
/**
 * Shared D3 charting utilities for StatBench.
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

/** Phone margins (viewport < 480px). */
const PHONE_MARGIN = { top: 30, right: 15, bottom: 50, left: 55 };

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
 * Check if the user prefers reduced motion (OS/browser setting only).
 * @returns {boolean}
 */
export function prefersReducedMotion() {
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
 * Applies the D3 margin convention with StatBench's standard dimensions.
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

  // On phone viewports, reduce y-axis ticks
  const isPhone = detectPhoneMargin();
  if (isPhone) {
    if (typeof yAxis.ticks === 'function') yAxis.ticks(5);
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
    axes.append('text')
      .attr('class', 'x-label')
      .attr('text-anchor', 'middle')
      .attr('x', frame.width / 2)
      .attr('y', frame.height + frame.margin.bottom - 8)
      .text(xLabel);
  }

  // Y-axis label (rotated) — positioned dynamically based on tick width
  if (yLabel) {
    // Measure widest y-axis tick label
    let maxTickWidth = 0;
    axes.select('.y-axis').selectAll('.tick text').each(function () {
      try {
        const w = /** @type {SVGTextElement} */ (this).getBBox().width;
        if (w > maxTickWidth) maxTickWidth = w;
      } catch { /* getBBox fails in JSDOM */ }
    });
    // Place label just outside the tick labels with a small gap
    const labelY = -(maxTickWidth + 14);

    axes.append('text')
      .attr('class', 'y-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -frame.height / 2)
      .attr('y', labelY)
      .text(yLabel);
  }
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
 * Render a p-value annotation on a hypothesis test chart.
 * Positions the label in the tail area(s) with a white background for contrast.
 *
 * @param {ChartFrame} frame - Chart frame from createChart
 * @param {d3Selection.Selection|any} xScale - D3 linear scale for x-axis
 * @param {number} pValue - Computed p-value
 * @param {number} observedStat - Observed test statistic
 * @param {'left'|'right'|'both'} direction - Tail direction
 */
export function renderPValueAnnotation(frame, xScale, pValue, observedStat, direction) {
  const annotations = d3Selection.select(frame.inner).select('.annotations');
  annotations.selectAll('.p-value-group').remove();

  // Format p-value text
  let pText;
  if (pValue === 0) pText = 'p ≈ 0';
  else if (pValue < 0.0001) pText = 'p < 0.0001';
  else if (pValue < 0.001) pText = `p = ${pValue.toFixed(4)}`;
  else pText = `p = ${pValue.toFixed(4)}`;

  const obsX = xScale(observedStat);
  const h = frame.height;
  const w = frame.width;

  if (direction === 'both') {
    // Two-sided: label near observed stat, slightly above mid-height
    const labelX = Math.max(60, Math.min(w - 60, obsX));
    _addPLabel(annotations, `${pText}  (two-tailed)`, labelX, h * 0.18);
  } else if (direction === 'left') {
    // Left tail: label between left edge and observed
    const tailMidX = obsX / 2;
    const labelX = Math.max(50, Math.min(obsX - 10, tailMidX));
    _addPLabel(annotations, pText, labelX, h * 0.25);
  } else {
    // Right tail: label between observed and right edge
    const tailMidX = (obsX + w) / 2;
    const labelX = Math.min(w - 50, Math.max(obsX + 10, tailMidX));
    _addPLabel(annotations, pText, labelX, h * 0.25);
  }
}

/**
 * Add a p-value text label with white background rect.
 * @param {d3Selection.Selection} group
 * @param {string} text
 * @param {number} x
 * @param {number} y
 */
function _addPLabel(group, text, x, y) {
  const g = group.append('g').attr('class', 'p-value-group');

  // Add text first to measure, then add background rect
  const textEl = g.append('text')
    .attr('class', 'p-value-label')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .attr('fill', '#B71C1C')
    .text(text);

  // Add background rect behind text for readability
  try {
    const bbox = /** @type {SVGTextElement} */ (textEl.node()).getBBox();
    const pad = 4;
    g.insert('rect', 'text')
      .attr('x', bbox.x - pad)
      .attr('y', bbox.y - pad)
      .attr('width', bbox.width + pad * 2)
      .attr('height', bbox.height + pad * 2)
      .attr('fill', 'white')
      .attr('fill-opacity', 0.85)
      .attr('rx', 3);
  } catch {
    // getBBox may fail in test/JSDOM — skip background
  }
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
    .style('font-size', '14px')
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
