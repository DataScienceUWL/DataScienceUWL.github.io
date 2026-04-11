// @ts-check
/**
 * Histogram chart module for StatLens.
 * Used by simulation pages and explore/descriptive.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, /* drawHorizontalGridlines, */ formatTick, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS, attachTooltip } from './chart-utils.js';

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
 * @param {string} [options.observedLabel] - Label for observed line (default: 'observed')
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {boolean} [options.animate] - Whether to animate bars (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {number[]} [options.thresholds] - Explicit bin threshold values (overrides numBins)
 * @param {number[]} [options.prevBinCounts] - Previous bin counts for stacked delta highlight
 * @param {number} [options.highlightValue] - Single new value to highlight (flashes the receiving bin)
 * @param {number} [options.precision] - Decimal places for overlay value labels (default: 2)
 * @param {boolean} [options.relativeFrequency] - Show relative frequency (proportion) on y-axis instead of count
 * @param {string} [options.fillColor] - Override default bar fill color (hex, will be used at 50% opacity)
 * @param {number} [options.viewHeight] - Override default viewBox height (for compact stacked charts)
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names' (no numeric tooltips/click labels), 'none' (no tooltips at all)
 * @returns {{ frame: ChartFrame, bins: d3Array.Bin<number, number>[], xScale: d3Scale.ScaleLinear<number,number>, yScale: d3Scale.ScaleLinear<number,number>, update: (values: number[], opts?: object) => void }}
 */
export function drawHistogram(container, values, options = {}) {
  const {
    xLabel,
    yLabel,
    titleText = 'Histogram',
    descText = '',
    id,
    isTail,
    observedStat,
    observedLabel = 'observed',
    ciLines,
    animate = true,
    margin,
    numBins,
    domain,
    thresholds,
    prevBinCounts,
    highlightValue,
    precision = 2,
    relativeFrequency = false,
    fillColor,
    viewHeight,
    showExport,
    filename,
    labels = 'full',
  } = options;
  const effectiveYLabel = yLabel ?? (relativeFrequency ? 'Proportion' : 'Frequency');

  const frame = createChart(container, { titleText, descText, id, margin, showExport, filename, ...(viewHeight != null && { viewHeight }) });
  const { bins, domain: finalDomain } = computeBins(values, { numBins, domain, thresholds });

  // Extend x-domain to encompass full first and last bins (no partial bars)
  const xDomain = bins.length > 0
    ? [bins[0].x0, bins[bins.length - 1].x1]
    : finalDomain;

  const xScale = d3Scale.scaleLinear()
    .domain(xDomain)
    .range([0, frame.width]);

  const maxCount = d3Array.max(bins, b => b.length) || 1;
  const totalN = values.length || 1;
  const yScale = d3Scale.scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const yAxis = relativeFrequency
    ? d3Axis.axisLeft(yScale).tickFormat(/** @param {any} d */ d => {
        const v = +d / totalN;
        if (v === 0) return '0';
        // Keep labels compact: up to 3 sig figs, strip trailing zeros
        return String(Number(v.toPrecision(3)));
      })
    : d3Axis.axisLeft(yScale).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, effectiveYLabel);
  // drawHorizontalGridlines(frame); // disabled — bars are readable without gridlines (theme_classic style)

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  renderBars(dataGroup, bins, xScale, yScale, frame.height, isTail, animate, frame.inner, observedStat, ciLines, relativeFrequency, totalN, fillColor, labels);

  // Stacked delta highlight: show new portions of bars in orange
  if (prevBinCounts) {
    renderDeltaBars(dataGroup, bins, xScale, yScale, frame.height, prevBinCounts);
  }

  // Single-value highlight: flash the bin that received the new value (+1 case)
  if (highlightValue != null && !prevBinCounts) {
    renderSingleHighlight(dataGroup, bins, xScale, yScale, frame.height, highlightValue);
  }

  // Overlay lines
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null) {
    renderOverlayLine(overlays, observedStat, xScale, frame.height,
      '#7B2D8E', observedLabel, precision, observedLabel);
  }
  if (ciLines) {
    renderOverlayLine(overlays, ciLines[0], xScale, frame.height,
      '#B5747A', 'CI lower bound', precision, undefined, true);
    renderOverlayLine(overlays, ciLines[1], xScale, frame.height,
      '#B5747A', 'CI upper bound', precision, undefined, true);
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
      renderBars(dataGroup, result.bins, xScale, yScale, frame.height, newIsTail, animate, frame.inner, newObserved, newCiLines, relativeFrequency, newValues.length || 1, undefined, labels);

      // Re-render overlays
      overlays.selectAll('*').remove();
      if (newObserved != null) {
        const newLabel = /** @type {any} */ (opts).observedLabel ?? observedLabel;
        renderOverlayLine(overlays, newObserved, xScale, frame.height,
          '#7B2D8E', newLabel, precision, newLabel);
      }
      if (newCiLines) {
        renderOverlayLine(overlays, newCiLines[0], xScale, frame.height,
          '#B5747A', 'CI lower bound', precision, undefined, true);
        renderOverlayLine(overlays, newCiLines[1], xScale, frame.height,
          '#B5747A', 'CI upper bound', precision, undefined, true);
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
    .attr('x', d => xScale(d.bin.x0))
    .attr('width', d => Math.max(0, xScale(d.bin.x1) - xScale(d.bin.x0)))
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
 * Flash the single bin that received a new value (+1 animation).
 * Draws a thin orange stripe at the top of the target bin, then fades it out.
 * @param {d3Selection.Selection} group
 * @param {d3Array.Bin<number, number>[]} bins
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {number} value - The new stat value to locate
 */
function renderSingleHighlight(group, bins, xScale, yScale, innerHeight, value) {
  // Find the bin containing this value
  const targetBin = bins.find(b => value >= b.x0 && value < b.x1)
    // Last bin includes upper bound
    || bins.find(b => value >= b.x0 && value <= b.x1);
  if (!targetBin || targetBin.length === 0) return;

  // Draw a stripe at the top of the bar representing 1 unit of height
  const prevCount = targetBin.length - 1;
  const rect = group.append('rect')
    .attr('class', 'delta-bar')
    .attr('x', xScale(targetBin.x0))
    .attr('width', Math.max(0, xScale(targetBin.x1) - xScale(targetBin.x0)))
    .attr('y', yScale(targetBin.length))
    .attr('height', Math.max(2, yScale(prevCount) - yScale(targetBin.length)))
    .attr('fill', HIGHLIGHT_FILL)
    .attr('stroke', BAR_STROKE)
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');

  // Fade out after 800ms
  setTimeout(() => {
    if (prefersReducedMotion()) {
      rect.remove();
    } else {
      rect.style('transition', 'opacity 0.5s');
      rect.style('opacity', '0');
      setTimeout(() => rect.remove(), 600);
    }
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
 * @param {[number, number]} [ciLines] - CI bounds for split-bar rendering
 */
function renderBars(group, bins, xScale, yScale, innerHeight, isTail, animate, innerNode, observedStat, ciLines, relativeFrequency = false, totalN = 1, fillColor, labels = 'full') {
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  // Collect all boundary values that can split bars
  const boundaries = [];
  if (observedStat != null) boundaries.push(observedStat);
  if (ciLines) { boundaries.push(ciLines[0]); boundaries.push(ciLines[1]); }

  // Build bar data: split bins at any boundary that falls strictly inside
  /** @type {Array<{x0: number, x1: number, length: number, fill: string, binIndex: number, isSplit: boolean}>} */
  const barData = [];
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    if (bin.length === 0) continue;

    const defaultFill = fillColor ? fillColor + '80' : BAR_FILL;
    if (!isTail) {
      barData.push({ x0: bin.x0, x1: bin.x1, length: bin.length, fill: defaultFill, binIndex: i, isSplit: false });
      continue;
    }

    // Find boundaries that fall strictly inside this bin
    const splits = boundaries.filter(b => b > bin.x0 && b < bin.x1);
    splits.sort((a, b) => a - b);

    if (splits.length > 0) {
      // Build segments: [bin.x0, split1], [split1, split2], ..., [splitN, bin.x1]
      const edges = [bin.x0, ...splits, bin.x1];
      for (let j = 0; j < edges.length - 1; j++) {
        const segMid = (edges[j] + edges[j + 1]) / 2;
        barData.push({
          x0: edges[j], x1: edges[j + 1], length: bin.length,
          fill: isTail(segMid) ? REGION_FILL : BODY_FILL,
          binIndex: i, isSplit: true,
        });
      }
    } else {
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
    .attr('x', d => xScale(d.x0))
    .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0)))
    .attr('fill', d => d.fill)
    .attr('stroke', d => {
      if (d.isSplit) return 'none';
      const w = xScale(d.x1) - xScale(d.x0);
      return w < 2 ? 'none' : BAR_STROKE;
    })
    .attr('stroke-width', d => {
      if (d.isSplit) return 0;
      const w = xScale(d.x1) - xScale(d.x0);
      return w < 4 ? 0.5 : 1;
    })
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

  // Hover/focus tooltip: show bin range and frequency (or relative frequency)
  if (innerNode && labels !== 'none') {
    attachTooltip(bars, innerNode, (d) => {
      if (labels === 'names') {
        return {
          lines: [`${formatTick(d.x0)} to ${formatTick(d.x1)}`],
          x: (xScale(d.x0) + xScale(d.x1)) / 2,
          y: yScale(d.length),
        };
      }
      const valLabel = relativeFrequency
        ? `Proportion: ${(d.length / totalN).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
        : `Frequency: ${d.length}`;
      return {
        lines: [`${formatTick(d.x0)} to ${formatTick(d.x1)}`, valLabel],
        x: (xScale(d.x0) + xScale(d.x1)) / 2,
        y: yScale(d.length),
      };
    });
  }

  // Click bar → show count label above it (suppressed in names/none mode)
  if (labels === 'full') {
    bars.style('cursor', 'pointer')
      .on('click', function(event, d) {
        group.selectAll('.bar-count-label').remove();
        bars.attr('stroke', d2 => d2.isSplit ? 'none' : BAR_STROKE)
          .attr('stroke-width', d2 => d2.isSplit ? 0 : 1);
        d3Selection.select(this).attr('stroke', '#000').attr('stroke-width', 2);
        const barX = xScale(d.x0) + (xScale(d.x1) - xScale(d.x0)) / 2;
        const barY = yScale(d.length);
        const labelText = relativeFrequency
          ? (d.length / totalN).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
          : String(d.length);
        group.append('text')
          .attr('class', 'bar-count-label')
          .attr('x', barX)
          .attr('y', barY - 5)
          .attr('text-anchor', 'middle')
          .attr('fill', '#000')
          .text(labelText);
      });
  }
}

/**
 * Render a vertical overlay line (observed stat or CI bound).
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {number} innerHeight
 * @param {string} color
 * @param {string} label - aria-label prefix
 * @param {number} [precision] - Decimal places for value label (default: 2)
 * @param {string} [microLabel] - Small text above the value (e.g. 'observed', 'parameter')
 */
function renderOverlayLine(overlays, value, xScale, innerHeight, color, label, precision = 2, microLabel, dashed = false) {
  const x = xScale(value);
  const w = xScale.range()[1];
  const line = overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 14).attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', dashed ? 2 : 2.5)
    .attr('aria-label', `${label}: ${value}`);
  if (dashed) line.attr('stroke-dasharray', '6,3');
  // Clamp label so it doesn't clip at chart edges
  const anchor = x < w * 0.15 ? 'start' : x > w * 0.85 ? 'end' : 'middle';
  const clampedX = Math.max(4, Math.min(w - 4, x));
  if (microLabel) {
    overlays.append('text')
      .attr('class', 'overlay-value observed-label')
      .attr('x', clampedX).attr('y', 10)
      .attr('text-anchor', anchor)
      .attr('fill', color)
      .attr('font-weight', 700)
      .text(`${microLabel} = ${value.toFixed(precision)}`);
  } else {
    overlays.append('text')
      .attr('class', 'overlay-value')
      .attr('x', clampedX).attr('y', 10)
      .attr('text-anchor', anchor)
      .attr('fill', color)
      .text(value.toFixed(precision));
  }
}
