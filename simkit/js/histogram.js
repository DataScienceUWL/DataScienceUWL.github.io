// @ts-check
/**
 * Histogram chart module for SimKit.
 * Used by simulation pages and explore/descriptive.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, prefersReducedMotion, TRANSITION_MS } from './chart-utils.js';

/** Default bar fill (IMS blue at 50% opacity). */
const BAR_FILL = '#569BBD80';

/** Tail/extreme bar fill (IMS red at 25% opacity). */
const TAIL_FILL = '#F0513340';

/** Bar stroke (white separator). */
const BAR_STROKE = '#FFFFFF';

/**
 * Compute the default bin count using Sturges' rule, clamped to [3, 50].
 * @param {number} n - Number of data values
 * @returns {number}
 */
export function sturgesBins(n) {
  if (n <= 0) return 3;
  const k = Math.ceil(1 + 3.322 * Math.log10(n));
  return Math.max(3, Math.min(50, k));
}

/**
 * Bin numeric data for a histogram.
 *
 * @param {number[]} values - Numeric data array
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins (default: Sturges' rule)
 * @param {[number, number]} [options.domain] - [min, max] domain override
 * @returns {{ bins: d3Array.Bin<number, number>[], binWidth: number, domain: [number, number] }}
 */
export function computeBins(values, options = {}) {
  const n = values.length;
  if (n === 0) {
    return { bins: [], binWidth: 1, domain: [0, 1] };
  }

  const xMin = d3Array.min(values);
  const xMax = d3Array.max(values);

  // Single-value edge case
  if (xMin === xMax) {
    const domain = /** @type {[number, number]} */ ([xMin - 0.5, xMax + 0.5]);
    const bin = /** @type {d3Array.Bin<number, number>} */ ([...values]);
    bin.x0 = domain[0];
    bin.x1 = domain[1];
    return { bins: [bin], binWidth: 1, domain };
  }

  const k = options.numBins ?? sturgesBins(n);
  const domain = options.domain ?? /** @type {[number, number]} */ ([xMin, xMax]);

  const binGenerator = d3Array.bin()
    .domain(domain)
    .thresholds(k);

  const bins = binGenerator(values);
  const binWidth = bins.length > 0 ? bins[0].x1 - bins[0].x0 : 1;

  return { bins, binWidth, domain };
}

/**
 * Draw a histogram into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins (default: Sturges' rule)
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label (default: "Frequency")
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {(value: number) => boolean} [options.isTail] - Predicate for tail shading
 * @param {number} [options.observedStat] - Value for observed statistic vertical line
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {boolean} [options.animate] - Whether to animate bars (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {number[]} [options.prevBinCounts] - Previous bin counts for stacked delta highlight
 * @returns {{ frame: ChartFrame, bins: d3Array.Bin<number, number>[], xScale: d3Scale.ScaleLinear<number,number>, update: (values: number[], opts?: object) => void }}
 */
export function drawHistogram(container, values, options = {}) {
  const {
    xLabel,
    yLabel = 'Frequency',
    titleText = 'Histogram',
    descText = '',
    id,
    isTail,
    observedStat,
    ciLines,
    animate = true,
    margin,
    numBins,
    domain,
    prevBinCounts,
  } = options;

  const frame = createChart(container, { titleText, descText, id, margin });
  const { bins, domain: finalDomain } = computeBins(values, { numBins, domain });

  const xScale = d3Scale.scaleLinear()
    .domain(finalDomain)
    .range([0, frame.width]);

  const yScale = d3Scale.scaleLinear()
    .domain([0, d3Array.max(bins, b => b.length) || 1])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  renderBars(dataGroup, bins, xScale, yScale, frame.height, isTail, animate);

  // Stacked delta highlight: show new portions of bars in orange
  if (prevBinCounts) {
    renderDeltaBars(dataGroup, bins, xScale, yScale, frame.height, prevBinCounts);
  }

  // Overlay lines
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null) {
    renderOverlayLine(overlays, observedStat, xScale, frame.height,
      '#F05133', 'Observed statistic');
  }
  if (ciLines) {
    renderOverlayLine(overlays, ciLines[0], xScale, frame.height,
      '#114B5F', 'CI lower bound');
    renderOverlayLine(overlays, ciLines[1], xScale, frame.height,
      '#114B5F', 'CI upper bound');
  }

  return {
    frame,
    bins,
    xScale,
    update: (newValues, opts = {}) => {
      const newNumBins = opts.numBins ?? numBins;
      const result = computeBins(newValues, { numBins: newNumBins });
      const newIsTail = opts.isTail ?? isTail;
      const newObserved = opts.observedStat ?? observedStat;
      const newCiLines = opts.ciLines ?? ciLines;

      xScale.domain(result.domain);
      yScale.domain([0, d3Array.max(result.bins, b => b.length) || 1]).nice();

      // Update axes
      d3Selection.select(frame.inner).select('.x-axis').call(xAxis);
      d3Selection.select(frame.inner).select('.y-axis').call(yAxis);

      // Re-render bars
      dataGroup.selectAll('rect').remove();
      renderBars(dataGroup, result.bins, xScale, yScale, frame.height, newIsTail, animate);

      // Re-render overlays
      overlays.selectAll('*').remove();
      if (newObserved != null) {
        renderOverlayLine(overlays, newObserved, xScale, frame.height,
          '#F05133', 'Observed statistic');
      }
      if (newCiLines) {
        renderOverlayLine(overlays, newCiLines[0], xScale, frame.height,
          '#114B5F', 'CI lower bound');
        renderOverlayLine(overlays, newCiLines[1], xScale, frame.height,
          '#114B5F', 'CI upper bound');
      }
    },
  };
}

/** Highlight color for new data (accessible warm orange). */
const HIGHLIGHT_FILL = '#E07020';

/**
 * Render delta overlay bars showing newly added data in each bin.
 * Only the growth portion (from prevCount to currentCount) is highlighted.
 * @param {d3Selection.Selection} group
 * @param {d3Array.Bin<number, number>[]} bins
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {number[]} prevCounts - Count per bin before the new batch
 */
function renderDeltaBars(group, bins, xScale, yScale, innerHeight, prevCounts) {
  const deltas = bins
    .map((bin, i) => {
      const prev = prevCounts[i] ?? 0;
      const delta = bin.length - prev;
      return { bin, prev, delta };
    })
    .filter(d => d.delta > 0);

  if (deltas.length === 0) return;

  const deltaRects = group.selectAll('.delta-bar')
    .data(deltas)
    .join('rect')
    .attr('class', 'delta-bar')
    .attr('x', d => xScale(d.bin.x0) + 0.5)
    .attr('width', d => Math.max(0, xScale(d.bin.x1) - xScale(d.bin.x0) - 1))
    .attr('y', d => yScale(d.prev + d.delta))
    .attr('height', d => yScale(d.prev) - yScale(d.prev + d.delta))
    .attr('fill', HIGHLIGHT_FILL)
    .attr('stroke', BAR_STROKE)
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');

  // Fade out delta bars after 800ms
  setTimeout(() => {
    deltaRects.each(function() {
      const el = d3Selection.select(this);
      el.style('transition', 'opacity 0.5s');
      el.style('opacity', '0');
      setTimeout(() => el.remove(), 600);
    });
  }, 800);
}

/**
 * Render histogram bars into a D3 selection.
 * @param {d3Selection.Selection} group - The .data group
 * @param {d3Array.Bin<number, number>[]} bins
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {((value: number) => boolean)} [isTail]
 * @param {boolean} animate
 */
function renderBars(group, bins, xScale, yScale, innerHeight, isTail, animate) {
  const shouldAnimate = animate && !prefersReducedMotion();

  const bars = group.selectAll('rect')
    .data(bins)
    .join('rect')
    .attr('x', d => xScale(d.x0) + 0.5)
    .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
    .attr('fill', d => {
      if (!isTail) return BAR_FILL;
      // A bin is "tail" if its midpoint satisfies the predicate
      const mid = (d.x0 + d.x1) / 2;
      return isTail(mid) ? TAIL_FILL : BAR_FILL;
    })
    .attr('stroke', BAR_STROKE)
    .attr('stroke-width', 1)
    .attr('role', 'listitem')
    .attr('aria-label', d => `${d.x0} to ${d.x1}: ${d.length}`);

  if (shouldAnimate) {
    bars
      .attr('y', innerHeight)
      .attr('height', 0)
      .transition()
      .duration(TRANSITION_MS)
      .attr('y', d => yScale(d.length))
      .attr('height', d => innerHeight - yScale(d.length));
  } else {
    bars
      .attr('y', d => yScale(d.length))
      .attr('height', d => innerHeight - yScale(d.length));
  }

  // Hover tooltip: show count on mouseover
  bars.append('title').text(d => `${d.x0.toFixed(2)} to ${d.x1.toFixed(2)}: ${d.length}`);

  // Click bar → show count label above it
  bars.style('cursor', 'pointer')
    .on('click', function(event, d) {
      // Remove any existing count label
      group.selectAll('.bar-count-label').remove();
      // Highlight: reset all bars, then stroke this one
      bars.attr('stroke', BAR_STROKE).attr('stroke-width', 1);
      d3Selection.select(this).attr('stroke', '#000').attr('stroke-width', 2);
      // Add count label above bar
      const barX = xScale(d.x0) + (xScale(d.x1) - xScale(d.x0)) / 2;
      const barY = yScale(d.length);
      group.append('text')
        .attr('class', 'bar-count-label')
        .attr('x', barX)
        .attr('y', barY - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#000')
        .text(d.length);
    });
}

/**
 * Render a vertical overlay line (observed stat or CI bound).
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {number} innerHeight
 * @param {string} color
 * @param {string} label
 */
function renderOverlayLine(overlays, value, xScale, innerHeight, color, label) {
  const x = xScale(value);
  overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,3')
    .attr('aria-label', `${label}: ${value}`);
  overlays.append('text')
    .attr('class', 'overlay-value')
    .attr('x', x).attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .text(value.toFixed(3));
}
