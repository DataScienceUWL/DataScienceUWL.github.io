// @ts-check
/**
 * Histogram chart module for StatBench.
 * Used by simulation pages and explore/descriptive.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS, attachTooltip } from './chart-utils.js';

/** Default bar fill (IMS blue at 50% opacity) — used when no isTail predicate. */
const BAR_FILL = '#569BBD80';

/** Body bar fill when isTail is active (subdued blue-gray, darkened for WCAG). */
const BODY_FILL = '#8aacbe80';

/** Region-of-interest bar fill when isTail is active (bold IMS blue). */
const REGION_FILL = '#569BBD';

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
 * Generate snapped bin thresholds for proportion data.
 * Uses Sturges' rule to pick a reasonable bin count, then rounds
 * bin edges to the nearest k/n boundary so bars don't split
 * discrete values across bins. Result: touching bars, clean display.
 *
 * @param {number} sampleSize - The denominator n in k/n proportions
 * @param {[number, number]} domain - [min, max] domain
 * @param {number} dataLength - Number of data values (for Sturges' rule)
 * @returns {number[]} Threshold values snapped to k/n grid
 */
export function snappedPropThresholds(sampleSize, domain, dataLength) {
  if (sampleSize <= 0) return [];
  const step = 1 / sampleSize;
  const range = domain[1] - domain[0];
  // How many discrete values fit in the domain?
  const discreteCount = Math.ceil(range / step);
  // Target bin count from Sturges' rule
  const targetBins = sturgesBins(dataLength);
  // How many discrete values per bin? Round up so we get ≤ targetBins bins
  const stepsPerBin = Math.max(1, Math.ceil(discreteCount / targetBins));
  const binWidth = stepsPerBin * step;

  const thresholds = [];
  // Start from the nearest k/n value at or below domain[0]
  const startK = Math.floor(domain[0] * sampleSize);
  let edge = (startK + stepsPerBin) * step;
  while (edge < domain[1]) {
    thresholds.push(edge);
    edge += binWidth;
  }
  return thresholds;
}

/**
 * Bin numeric data for a histogram.
 *
 * @param {number[]} values - Numeric data array
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins (default: Sturges' rule)
 * @param {[number, number]} [options.domain] - [min, max] domain override
 * @param {number[]} [options.thresholds] - Explicit threshold values (overrides numBins)
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

  const rawDomain = options.domain ?? /** @type {[number, number]} */ ([xMin, xMax]);

  // When using auto-thresholds (not explicit), "nice" the domain so that
  // edge bins have the same width as interior bins (no partial-width bars).
  const useNice = !options.thresholds;
  let domain = rawDomain;
  if (useNice) {
    const niceScale = d3Scale.scaleLinear().domain(rawDomain).nice();
    domain = /** @type {[number, number]} */ (niceScale.domain());
  }

  const binGenerator = d3Array.bin().domain(domain);
  if (options.thresholds) {
    binGenerator.thresholds(options.thresholds);
  } else {
    // Generate explicit evenly-spaced thresholds so the bin count is exact.
    // d3's .thresholds(n) treats n as a suggestion and picks "nice" values,
    // which ignores small changes (e.g. 7→8→9 all produce the same bins).
    const numBins = options.numBins ?? sturgesBins(n);
    const step = (domain[1] - domain[0]) / numBins;
    const thresholds = [];
    for (let i = 1; i < numBins; i++) {
      thresholds.push(domain[0] + i * step);
    }
    binGenerator.thresholds(thresholds);
  }

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
 * @param {number[]} [options.thresholds] - Explicit bin threshold values (overrides numBins)
 * @param {number[]} [options.prevBinCounts] - Previous bin counts for stacked delta highlight
 * @returns {{ frame: ChartFrame, bins: d3Array.Bin<number, number>[], xScale: d3Scale.ScaleLinear<number,number>, yScale: d3Scale.ScaleLinear<number,number>, update: (values: number[], opts?: object) => void }}
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
    thresholds,
    prevBinCounts,
  } = options;

  const frame = createChart(container, { titleText, descText, id, margin });
  const { bins, domain: finalDomain } = computeBins(values, { numBins, domain, thresholds });

  // Extend x-domain to encompass full first and last bins (no partial bars)
  const xDomain = bins.length > 0
    ? [bins[0].x0, bins[bins.length - 1].x1]
    : finalDomain;

  const xScale = d3Scale.scaleLinear()
    .domain(xDomain)
    .range([0, frame.width]);

  const yScale = d3Scale.scaleLinear()
    .domain([0, d3Array.max(bins, b => b.length) || 1])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  renderBars(dataGroup, bins, xScale, yScale, frame.height, isTail, animate, frame.inner, observedStat);

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
    yScale,
    update: (newValues, opts = {}) => {
      const newNumBins = opts.numBins ?? numBins;
      const result = computeBins(newValues, { numBins: newNumBins });
      const newIsTail = opts.isTail ?? isTail;
      const newObserved = opts.observedStat ?? observedStat;
      const newCiLines = opts.ciLines ?? ciLines;

      // Extend to full first/last bin edges
      const newXDomain = result.bins.length > 0
        ? [result.bins[0].x0, result.bins[result.bins.length - 1].x1]
        : result.domain;
      xScale.domain(newXDomain);
      yScale.domain([0, d3Array.max(result.bins, b => b.length) || 1]).nice();

      // Update axes
      const xAxisSel = d3Selection.select(frame.inner).select('.x-axis').call(xAxis);
      autoReduceTicks(xAxisSel, xAxis);
      d3Selection.select(frame.inner).select('.y-axis').call(yAxis);

      // Re-render bars
      dataGroup.selectAll('rect').remove();
      renderBars(dataGroup, result.bins, xScale, yScale, frame.height, newIsTail, animate, frame.inner, newObserved);

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

  // Fade out delta bars after 800ms (skip animation if reduced motion)
  setTimeout(() => {
    deltaRects.each(function() {
      const el = d3Selection.select(this);
      if (prefersReducedMotion()) {
        el.remove();
      } else {
        el.style('transition', 'opacity 0.5s');
        el.style('opacity', '0');
        setTimeout(() => el.remove(), 600);
      }
    });
  }, 800);
}

/**
 * Render histogram bars into a D3 selection.
 * When isTail is provided and the observed stat falls inside a bin,
 * that bin is split into two rects at the boundary for accurate shading.
 *
 * @param {d3Selection.Selection} group - The .data group
 * @param {d3Array.Bin<number, number>[]} bins
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {((value: number) => boolean)} [isTail]
 * @param {boolean} animate
 * @param {SVGGElement} [innerNode] - chart-inner node for custom tooltips
 * @param {number} [observedStat] - Observed stat value for split-bar rendering
 */
function renderBars(group, bins, xScale, yScale, innerHeight, isTail, animate, innerNode, observedStat) {
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  // Build bar data: split bins that contain the observed stat boundary
  /** @type {Array<{x0: number, x1: number, length: number, fill: string, binIndex: number, isSplit: boolean}>} */
  const barData = [];
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    if (bin.length === 0) continue;

    if (!isTail) {
      barData.push({ x0: bin.x0, x1: bin.x1, length: bin.length, fill: BAR_FILL, binIndex: i, isSplit: false });
      continue;
    }

    // Check if observed stat splits this bin
    const needsSplit = observedStat != null && observedStat > bin.x0 && observedStat < bin.x1;
    if (needsSplit) {
      // Split: left portion and right portion get different fills
      const leftIsTail = isTail(bin.x0);
      const rightIsTail = isTail(bin.x1);
      barData.push({
        x0: bin.x0, x1: observedStat, length: bin.length,
        fill: leftIsTail ? REGION_FILL : BODY_FILL,
        binIndex: i, isSplit: true,
      });
      barData.push({
        x0: observedStat, x1: bin.x1, length: bin.length,
        fill: rightIsTail ? REGION_FILL : BODY_FILL,
        binIndex: i, isSplit: true,
      });
    } else {
      // Whole bin: use left edge to classify (avoids midpoint ambiguity)
      const mid = (bin.x0 + bin.x1) / 2;
      barData.push({
        x0: bin.x0, x1: bin.x1, length: bin.length,
        fill: isTail(mid) ? REGION_FILL : BODY_FILL,
        binIndex: i, isSplit: false,
      });
    }
  }

  const bars = group.selectAll('rect')
    .data(barData)
    .join('rect')
    .attr('x', d => xScale(d.x0) + (d.isSplit ? 0 : 0.5))
    .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - (d.isSplit ? 0 : 1)))
    .attr('fill', d => d.fill)
    .attr('stroke', d => d.isSplit ? 'none' : BAR_STROKE)
    .attr('stroke-width', d => d.isSplit ? 0 : 1)
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

  // Hover/focus tooltip: show bin range and frequency
  if (innerNode) {
    attachTooltip(bars, innerNode, (d) => ({
      lines: [`${formatTick(d.x0)} to ${formatTick(d.x1)}`, `Frequency: ${d.length}`],
      x: (xScale(d.x0) + xScale(d.x1)) / 2,
      y: yScale(d.length),
    }));
  }

  // Click bar → show count label above it
  bars.style('cursor', 'pointer')
    .on('click', function(event, d) {
      group.selectAll('.bar-count-label').remove();
      bars.attr('stroke', d2 => d2.isSplit ? 'none' : BAR_STROKE)
        .attr('stroke-width', d2 => d2.isSplit ? 0 : 1);
      d3Selection.select(this).attr('stroke', '#000').attr('stroke-width', 2);
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
    .text(value.toFixed(2));
}
