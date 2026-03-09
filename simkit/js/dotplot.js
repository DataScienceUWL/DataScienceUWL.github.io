// @ts-check
/**
 * Dotplot (stacked dot plot) chart module for SimKit.
 * Used by simulation pages (n <= 200) and explore/descriptive (small datasets).
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, prefersReducedMotion, TRANSITION_MS } from './chart-utils.js';

/** Default dot fill (non-extreme). */
const DOT_FILL = '#808080';

/** Extreme dot fill (in tail). */
const EXTREME_FILL = '#569BBD';

/** Observed statistic line color. */
const OBSERVED_COLOR = '#F05133';

/** Minimum dot radius. */
const MIN_RADIUS = 2;

/** Maximum dot radius. */
const MAX_RADIUS = 8;

/**
 * Compute stacked dot positions from numeric data.
 *
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins for stacking (default: min(n, 40))
 * @param {[number, number]} [options.domain] - [min, max] domain override
 * @returns {{ dots: Array<{value: number, binCenter: number, stackIndex: number}>, binWidth: number, maxStack: number, domain: [number, number] }}
 */
export function computeDots(values, options = {}) {
  const n = values.length;
  if (n === 0) {
    const fallback = options.domain ?? /** @type {[number, number]} */ ([0, 1]);
    return { dots: [], binWidth: 1, maxStack: 0, domain: fallback };
  }

  const xMin = d3Array.min(values);
  const xMax = d3Array.max(values);

  // Single-value edge case
  if (xMin === xMax) {
    const domain = options.domain ?? /** @type {[number, number]} */ ([xMin - 0.5, xMax + 0.5]);
    const dots = values.map((v, i) => ({ value: v, binCenter: v, stackIndex: i }));
    return { dots, binWidth: 1, maxStack: n, domain };
  }

  const domain = options.domain ?? /** @type {[number, number]} */ ([xMin, xMax]);
  const numBins = options.numBins ?? Math.min(n, 40);
  const binWidth = (domain[1] - domain[0]) / numBins;

  // Stack: group values by bin center, assign stack indices
  /** @type {Map<number, number>} */
  const stackCounts = new Map();
  const dots = values.map(v => {
    const binCenter = Math.round((v - domain[0]) / binWidth) * binWidth + domain[0];
    const stackIndex = stackCounts.get(binCenter) ?? 0;
    stackCounts.set(binCenter, stackIndex + 1);
    return { value: v, binCenter, stackIndex };
  });

  const maxStack = d3Array.max(Array.from(stackCounts.values())) ?? 0;

  return { dots, binWidth, maxStack, domain };
}

/**
 * Compute dot radius that fits the data in the chart area.
 *
 * @param {number} innerWidth
 * @param {number} innerHeight
 * @param {number} maxStack - Tallest stack count
 * @param {number} numBins - Number of bins
 * @returns {number}
 */
export function computeDotRadius(innerWidth, innerHeight, maxStack, numBins) {
  if (maxStack === 0 || numBins === 0) return MAX_RADIUS;
  return Math.max(
    MIN_RADIUS,
    Math.min(
      innerHeight / (maxStack * 2.2),
      innerWidth / (numBins * 2.2),
      MAX_RADIUS,
    ),
  );
}

/**
 * Draw a dotplot into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins for stacking
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {(value: number) => boolean} [options.isExtreme] - Predicate for extreme dot coloring
 * @param {number} [options.observedStat] - Value for observed statistic vertical line
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {number} [options.highlightIndex] - Index of single newest dot to highlight (yellow pulse)
 * @param {Set<number>} [options.highlightIndices] - Indices of batch-added dots to highlight (accent pulse)
 * @returns {{ frame: ChartFrame, dots: Array<{value: number, binCenter: number, stackIndex: number}>, xScale: d3Scale.ScaleLinear<number,number>, update: (values: number[], opts?: object) => void }}
 */
export function drawDotplot(container, values, options = {}) {
  const {
    xLabel,
    titleText = 'Dot plot',
    descText = '',
    id,
    isExtreme,
    observedStat,
    ciLines,
    animate = true,
    margin,
    numBins,
    domain,
    highlightIndex = -1,
    highlightIndices,
  } = options;

  const result = computeDots(values, { numBins, domain });
  const { dots, maxStack, domain: finalDomain } = result;
  const effectiveBins = numBins ?? Math.min(values.length, 40);

  const frame = createChart(container, { titleText, descText, id, margin });

  const xScale = d3Scale.scaleLinear()
    .domain(finalDomain)
    .range([0, frame.width]);

  const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, effectiveBins);

  // Y axis is implicit (stacking height), no y-axis labels needed
  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const axes = d3Selection.select(frame.inner).select('.axes');
  axes.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${frame.height})`)
    .call(xAxis);

  if (xLabel) {
    axes.append('text')
      .attr('class', 'x-label')
      .attr('text-anchor', 'middle')
      .attr('x', frame.width / 2)
      .attr('y', frame.height + frame.margin.bottom - 8)
      .text(xLabel);
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  renderDots(dataGroup, dots, xScale, frame.height, dotRadius, isExtreme, animate, highlightIndex, highlightIndices);

  // Observed statistic line
  const overlaysGroup = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null) {
    renderObservedLine(overlaysGroup, observedStat, xScale, frame.height);
  }
  if (ciLines) {
    renderCILine(overlaysGroup, ciLines[0], xScale, frame.height);
    renderCILine(overlaysGroup, ciLines[1], xScale, frame.height);
  }

  return {
    frame,
    dots,
    xScale,
    update: (newValues, opts = {}) => {
      const newNumBins = opts.numBins ?? numBins;
      const newIsExtreme = opts.isExtreme ?? isExtreme;
      const newObserved = opts.observedStat ?? observedStat;
      const newCiLines = opts.ciLines ?? ciLines;
      const newResult = computeDots(newValues, { numBins: newNumBins });
      const newEffectiveBins = newNumBins ?? Math.min(newValues.length, 40);

      xScale.domain(newResult.domain);
      d3Selection.select(frame.inner).select('.x-axis').call(xAxis);

      const newRadius = computeDotRadius(
        frame.width, frame.height, newResult.maxStack, newEffectiveBins);

      dataGroup.selectAll('circle').remove();
      renderDots(dataGroup, newResult.dots, xScale, frame.height, newRadius, newIsExtreme, animate);

      const overlays = d3Selection.select(frame.inner).select('.overlays');
      overlays.selectAll('*').remove();
      if (newObserved != null) {
        renderObservedLine(overlays, newObserved, xScale, frame.height);
      }
      if (newCiLines) {
        renderCILine(overlays, newCiLines[0], xScale, frame.height);
        renderCILine(overlays, newCiLines[1], xScale, frame.height);
      }
    },
  };
}

/** Highlight color for new dots (accessible warm orange, 3.4:1 on white). */
const HIGHLIGHT_FILL = '#E07020';

/**
 * Render dots into a D3 selection.
 * @param {d3Selection.Selection} group
 * @param {Array<{value: number, binCenter: number, stackIndex: number}>} dots
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 * @param {number} radius
 * @param {((value: number) => boolean)} [isExtreme]
 * @param {boolean} animate
 * @param {number} [highlightIndex] - Single newest dot (+1): yellow pulse
 * @param {Set<number>} [highlightIndices] - Batch new dots (+10): accent pulse
 */
function renderDots(group, dots, xScale, innerHeight, radius, isExtreme, animate, highlightIndex = -1, highlightIndices) {
  const shouldAnimate = animate && !prefersReducedMotion();

  /** Normal fill for a dot at index i. */
  function normalFill(d) {
    if (!isExtreme) return DOT_FILL;
    return isExtreme(d.value) ? EXTREME_FILL : DOT_FILL;
  }

  const circles = group.selectAll('circle')
    .data(dots)
    .join('circle')
    .attr('cx', d => xScale(d.binCenter))
    .attr('cy', d => innerHeight - (d.stackIndex + 0.5) * radius * 2)
    .attr('r', radius)
    .attr('fill', normalFill)
    .attr('stroke', normalFill)
    .attr('stroke-width', 1)
    .attr('role', 'listitem')
    .attr('aria-label', d => String(d.value));

  if (shouldAnimate) {
    circles
      .attr('cy', innerHeight)
      .transition()
      .duration(TRANSITION_MS)
      .attr('cy', d => innerHeight - (d.stackIndex + 0.5) * radius * 2);
  }

  // Highlight new dots, then revert after delay.
  // Color highlights always apply; only CSS transitions are skipped for reduced-motion.
  if (highlightIndex >= 0) {
    const single = circles.filter((d, i) => i === highlightIndex);
    single
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 2)
      .attr('r', radius * 1.5);
    setTimeout(() => {
      single.each(function(d) {
        const el = d3Selection.select(this);
        el.style('transition', 'fill 0.4s, stroke 0.4s, r 0.3s, stroke-width 0.3s');
        el.attr('fill', normalFill(d))
          .attr('stroke', normalFill(d))
          .attr('stroke-width', 1)
          .attr('r', radius);
        setTimeout(() => el.style('transition', null), 500);
      });
    }, 800);
  } else if (highlightIndices && highlightIndices.size > 0) {
    const batch = circles.filter((d, i) => highlightIndices.has(i));
    batch
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 1.5)
      .attr('r', radius * 1.2);
    setTimeout(() => {
      batch.each(function(d) {
        const el = d3Selection.select(this);
        el.style('transition', 'fill 0.4s, stroke 0.4s, stroke-width 0.3s, r 0.3s');
        el.attr('fill', normalFill(d))
          .attr('stroke', normalFill(d))
          .attr('stroke-width', 1)
          .attr('r', radius);
        setTimeout(() => el.style('transition', null), 500);
      });
    }, 800);
  }
}

/**
 * Render the observed statistic vertical line.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 */
function renderObservedLine(overlays, value, xScale, innerHeight) {
  overlays.append('line')
    .attr('x1', xScale(value))
    .attr('x2', xScale(value))
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', OBSERVED_COLOR)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,3')
    .attr('aria-label', `Observed statistic: ${value}`);
}

/** CI line color (green). */
const CI_COLOR = '#2E7D32';

/**
 * Render a CI bound vertical line with label.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 */
function renderCILine(overlays, value, xScale, innerHeight) {
  const x = xScale(value);
  overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', CI_COLOR)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,3')
    .attr('aria-label', `CI bound: ${value}`);
  overlays.append('text')
    .attr('class', 'overlay-value')
    .attr('x', x).attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', CI_COLOR)
    .text(value.toFixed(3));
}
