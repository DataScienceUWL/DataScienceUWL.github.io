// @ts-check
/**
 * Dotplot (stacked dot plot) chart module for StatLens.
 * Used by simulation pages and explore/descriptive for small-to-medium datasets.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, drawHorizontalGridlines, formatTick, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS, attachTooltip } from './chart-utils.js';
import { sturgesBins } from './histogram.js';

/** Default dot fill — IMS blue. */
const DOT_FILL = '#569BBD';

/** Extreme dot fill (in tail) — same bold IMS blue. */
const EXTREME_FILL = '#569BBD';

/** Non-extreme dot fill when isExtreme is active — subdued gray. */
const BODY_FILL = '#a0a0a0';

/** Observed statistic line color (deep purple — distinct from orange highlight). */
const OBSERVED_COLOR = '#7B2D8E';

/** Minimum dot radius. */
const MIN_RADIUS = 3;

/** Maximum dot radius (explore dotplots may go up to this). */
const MAX_RADIUS = 12;

/** Maximum column stroke-width when in filled-column mode. */
const COLUMN_MAX_WIDTH = 10;

/**
 * Compute default bin count for dotplots — finer than Sturges so dots form
 * a cohesive shape (matching R/ggplot2 visual density).
 * Uses Freedman-Diaconis when IQR is available, otherwise range/30.
 * @param {number[]} values - Numeric data (unsorted is fine)
 * @returns {number}
 */
export function dotplotBins(values) {
  const n = values.length;
  if (n <= 1) return 3;
  const sorted = [...values].sort((a, b) => a - b);
  const xMin = sorted[0];
  const xMax = sorted[n - 1];
  const range = xMax - xMin;
  if (range === 0) return 3;
  // Freedman-Diaconis bin width
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqrVal = q3 - q1;
  let bins;
  if (iqrVal > 0) {
    const fdWidth = 2 * iqrVal * Math.pow(n, -1 / 3);
    bins = Math.ceil(range / fdWidth);
  } else {
    // Fallback: range/30 (ggplot2 default for dotplots)
    bins = 30;
  }
  // Dotplots need finer resolution than histograms — at least 15 bins
  return Math.min(40, Math.max(15, bins));
}

/**
 * Compute stacked dot positions from numeric data.
 *
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins for stacking (default: dotplotBins heuristic)
 * @param {[number, number]} [options.domain] - [min, max] domain override
 * @param {number} [options.binWidth] - Locked bin width (overrides domain/numBins computation)
 * @param {number} [options.binOrigin] - Locked bin origin for grid alignment (default: domain[0])
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
  const numBins = options.numBins ?? dotplotBins(values);
  // Allow locked binWidth (for stable dotplot grids across re-renders)
  const binWidth = options.binWidth ?? (domain[1] - domain[0]) / numBins;
  // Use the bin origin from the locked grid if provided, else from domain
  const binOrigin = options.binOrigin ?? domain[0];

  // Stack: group values by bin center, assign stack indices
  /** @type {Map<number, number>} */
  const stackCounts = new Map();
  const dots = values.map(v => {
    const binCenter = Math.round((v - binOrigin) / binWidth) * binWidth + binOrigin;
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
      innerHeight / (maxStack * 2.05),
      innerWidth / (numBins * 2.05),
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
 * @param {string} [options.observedLabel] - Label for observed line (default: 'observed')
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {number} [options.binWidth] - Locked bin width for stable grid across re-renders
 * @param {number} [options.binOrigin] - Locked bin origin for stable grid alignment
 * @param {number} [options.highlightIndex] - Index of single newest dot to highlight (yellow pulse)
 * @param {Set<number>} [options.highlightIndices] - Indices of batch-added dots to highlight (accent pulse)
 * @param {number} [options.precision] - Decimal places for overlay value labels (default: 2)
 * @param {boolean} [options.forceColumns] - Force filled-column mode even if dots would fit (for consistent grouped rendering)
 * @param {string} [options.fillColor] - Override default dot fill color (hex, sets both base and extreme)
 * @param {string} [options.baseFill] - Override non-extreme dot fill (when isExtreme returns false)
 * @param {string} [options.extremeFill] - Override extreme dot fill (when isExtreme returns true)
 * @param {number} [options.viewHeight] - Override default viewBox height (for compact stacked charts)
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names'/'none' (no value tooltips)
 * @returns {{ frame: ChartFrame, dots: Array<{value: number, binCenter: number, stackIndex: number}>, xScale: d3Scale.ScaleLinear<number,number>, maxStack: number, binWidth: number, update: (values: number[], opts?: object) => void }}
 */
export function drawDotplot(container, values, options = {}) {
  const {
    xLabel,
    titleText = 'Dot plot',
    descText = '',
    id,
    isExtreme,
    observedStat,
    observedLabel = 'observed',
    ciLines,
    animate = true,
    margin,
    numBins,
    domain,
    binWidth: lockedBinWidth,
    binOrigin: lockedBinOrigin,
    highlightIndex = -1,
    highlightIndices,
    precision = 2,
    forceColumns = false,
    fillColor,
    baseFill: optBaseFill,
    extremeFill: optExtremeFill,
    viewHeight,
    showExport,
    filename,
    labels = 'full',
  } = options;

  const result = computeDots(values, { numBins, domain, binWidth: lockedBinWidth, binOrigin: lockedBinOrigin });
  const { dots, maxStack, domain: finalDomain, binWidth: actualBinWidth } = result;
  // Compute effective bin count from the actual domain span and bin width,
  // not from numBins which may be the theoretical max (e.g. sampleSize for
  // proportions) rather than how many bins are visible in the current domain.
  const effectiveBins = (actualBinWidth && finalDomain)
    ? Math.ceil((finalDomain[1] - finalDomain[0]) / actualBinWidth)
    : numBins ?? dotplotBins(values);

  const frame = createChart(container, { titleText, descText, id, margin, showExport, filename, ...(viewHeight != null && { viewHeight }) });

  const xScale = d3Scale.scaleLinear()
    .domain(finalDomain)
    .range([0, frame.width]);

  const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, effectiveBins);

  // Detect if stacks overflow even at minimum radius — switch to filled columns
  const wouldOverflow = forceColumns || (maxStack > 0 && maxStack * MIN_RADIUS * 2 > frame.height);

  // Y axis is implicit (stacking height) for dots; column mode gets a y-axis
  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const axes = d3Selection.select(frame.inner).select('.axes');

  /** @type {d3Scale.ScaleLinear<number,number>|null} */
  let yScale = null;
  if (wouldOverflow) {
    yScale = d3Scale.scaleLinear()
      .domain([0, maxStack])
      .nice()
      .range([frame.height, 0]);
    const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
    addAxes(frame, xAxis, yAxis, xLabel, 'Frequency');
    drawHorizontalGridlines(frame);
  } else {
    const xAxisG = axes.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`)
      .call(xAxis);
    autoReduceTicks(xAxisG, xAxis);

    // Faint vertical grid lines aligned to the rendered axis ticks
    const gridGroup = d3Selection.select(frame.inner).select('.data');
    xAxisG.selectAll('.tick').each(function () {
      // Each tick <g> has transform="translate(x, 0)" — extract x
      const transform = d3Selection.select(this).attr('transform');
      const m = transform && transform.match(/translate\(\s*([\d.e+-]+)/);
      if (m) {
        const tx = parseFloat(m[1]);
        gridGroup.append('line')
          .attr('class', 'grid-line')
          .attr('x1', tx)
          .attr('x2', tx)
          .attr('y1', 0)
          .attr('y2', frame.height)
          .attr('stroke', '#d0d0d0')
          .attr('stroke-width', 0.5)
          .attr('stroke-dasharray', '2,2');
      }
    });

    if (xLabel) {
      axes.append('text')
        .attr('class', 'x-label')
        .attr('text-anchor', 'middle')
        .attr('x', frame.width / 2)
        .attr('y', frame.height + frame.margin.bottom - 8)
        .text(xLabel);
    }
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const tooltipNode = labels === 'none' ? undefined : frame.inner;
  if (wouldOverflow) {
    renderColumns(dataGroup, dots, xScale, /** @type {d3Scale.ScaleLinear<number,number>} */ (yScale), frame.height, isExtreme, highlightIndex, highlightIndices, tooltipNode, fillColor, optBaseFill, optExtremeFill);
  } else {
    renderDots(dataGroup, dots, xScale, frame.height, dotRadius, isExtreme, animate, highlightIndex, highlightIndices, tooltipNode, fillColor, optBaseFill, optExtremeFill);
  }

  // Observed statistic line
  const overlaysGroup = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null) {
    renderObservedLine(overlaysGroup, observedStat, xScale, frame.height, precision, observedLabel);
  }
  if (ciLines) {
    renderCILine(overlaysGroup, ciLines[0], xScale, frame.height, precision);
    renderCILine(overlaysGroup, ciLines[1], xScale, frame.height, precision);
  }

  return {
    frame,
    dots,
    xScale,
    maxStack: result.maxStack,
    binWidth: result.binWidth,
    update: (newValues, opts = {}) => {
      const newNumBins = opts.numBins ?? numBins;
      const newIsExtreme = opts.isExtreme ?? isExtreme;
      const newObserved = opts.observedStat ?? observedStat;
      const newCiLines = opts.ciLines ?? ciLines;
      const newHighlight = opts.highlightIndex ?? -1;
      const newHighlightSet = opts.highlightIndices;
      const newResult = computeDots(newValues, { numBins: newNumBins });
      const newEffectiveBins = newNumBins ?? dotplotBins(newValues);
      const newOverflow = newResult.maxStack > 0 && newResult.maxStack * MIN_RADIUS * 2 > frame.height;

      xScale.domain(newResult.domain);

      // Clear existing data
      dataGroup.selectAll('circle').remove();
      dataGroup.selectAll('.col-line').remove();
      dataGroup.selectAll('.col-highlight').remove();

      if (newOverflow) {
        // Switch to column mode — need y-axis
        if (!yScale) {
          yScale = d3Scale.scaleLinear().range([frame.height, 0]);
          axes.selectAll('*').remove();
        }
        yScale.domain([0, newResult.maxStack]).nice();
        const yAxisFn = d3Axis.axisLeft(yScale).tickFormat(formatTick);
        axes.selectAll('*').remove();
        addAxes(frame, xAxis, yAxisFn, xLabel, 'Frequency');

        renderColumns(dataGroup, newResult.dots, xScale, yScale, frame.height, newIsExtreme, newHighlight, newHighlightSet, tooltipNode, undefined, optBaseFill, optExtremeFill);
      } else {
        // Dot mode — remove y-axis if it was added
        if (yScale) {
          yScale = null;
          axes.selectAll('*').remove();
          const xAxisG = axes.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0, ${frame.height})`)
            .call(xAxis);
          autoReduceTicks(xAxisG, xAxis);
          if (xLabel) {
            axes.append('text')
              .attr('class', 'x-label')
              .attr('text-anchor', 'middle')
              .attr('x', frame.width / 2)
              .attr('y', frame.height + frame.margin.bottom - 8)
              .text(xLabel);
          }
        } else {
          const xAxisSel = d3Selection.select(frame.inner).select('.x-axis').call(xAxis);
          autoReduceTicks(xAxisSel, xAxis);
        }

        const newRadius = computeDotRadius(
          frame.width, frame.height, newResult.maxStack, newEffectiveBins);
        renderDots(dataGroup, newResult.dots, xScale, frame.height, newRadius, newIsExtreme, animate, newHighlight, newHighlightSet, tooltipNode, undefined, optBaseFill, optExtremeFill);
      }

      const overlays = d3Selection.select(frame.inner).select('.overlays');
      overlays.selectAll('*').remove();
      if (newObserved != null) {
        renderObservedLine(overlays, newObserved, xScale, frame.height, precision, opts.observedLabel ?? observedLabel);
      }
      if (newCiLines) {
        renderCILine(overlays, newCiLines[0], xScale, frame.height, precision);
        renderCILine(overlays, newCiLines[1], xScale, frame.height, precision);
      }
    },
  };
}

/** Highlight color for new dots (accessible warm orange, 3.4:1 on white). */
const HIGHLIGHT_FILL = '#E07020';

/** Pending highlight timeouts — cancelled on re-render to prevent stale animations. */
let pendingHighlightTimers = [];

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
 * @param {SVGGElement} [innerNode] - chart-inner node for custom tooltips
 */
function renderDots(group, dots, xScale, innerHeight, radius, isExtreme, animate, highlightIndex = -1, highlightIndices, innerNode, fillColor, optBaseFill, optExtremeFill) {
  // Cancel any pending highlight timers from previous render
  for (const t of pendingHighlightTimers) clearTimeout(t);
  pendingHighlightTimers = [];
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();
  const extremeFill = optExtremeFill || fillColor || EXTREME_FILL;
  const baseFill = optBaseFill || fillColor || (isExtreme ? BODY_FILL : DOT_FILL);

  /** Normal fill for a dot at index i. */
  function normalFill(d) {
    if (!isExtreme) return baseFill;
    return isExtreme(d.value) ? extremeFill : baseFill;
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

  // Hover/focus tooltip: show original value
  if (innerNode) {
    attachTooltip(circles, innerNode, (d) => ({
      lines: [String(d.value)],
      x: xScale(d.binCenter),
      y: innerHeight - (d.stackIndex + 0.5) * radius * 2 - radius,
    }));
  }

  if (shouldAnimate) {
    circles
      .attr('cy', innerHeight)
      .transition()
      .duration(TRANSITION_MS)
      .attr('cy', d => innerHeight - (d.stackIndex + 0.5) * radius * 2);
  }

  // Highlight new dots, then revert.
  // Color highlights always apply (color change is not motion).
  // Smooth fade-back uses rAF animation; reduced-motion gets instant revert after delay.
  const reducedMotion = prefersReducedMotion();
  if (highlightIndex >= 0) {
    const selected = circles.filter((d, i) => i === highlightIndex);
    selected
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 2)
      .attr('r', radius * 1.5);
    // Shrink back to normal size but keep orange fill — persists until next render
    // connects visually to the orange resample mean in the mechanism strip
    pendingHighlightTimers.push(setTimeout(() => {
      selected.each(function() {
        if (reducedMotion) {
          this.setAttribute('stroke', HIGHLIGHT_FILL);
          this.setAttribute('stroke-width', '1');
          this.setAttribute('r', String(radius));
        } else {
          animateDotRevert(this, HIGHLIGHT_FILL, radius, 400);
        }
      });
    }, 800));
  } else if (highlightIndices && highlightIndices.size > 0) {
    const selected = circles.filter((d, i) => highlightIndices.has(i));
    selected
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 1.5)
      .attr('r', radius * 1.2);
    pendingHighlightTimers.push(setTimeout(() => {
      selected.each(function(d) {
        if (reducedMotion) {
          this.setAttribute('fill', normalFill(d));
          this.setAttribute('stroke', normalFill(d));
          this.setAttribute('stroke-width', '1');
          this.setAttribute('r', String(radius));
        } else {
          animateDotRevert(this, normalFill(d), radius, 400);
        }
      });
    }, 800));
  }
}

/**
 * Render filled-column display when dotplot stacks overflow at minimum dot radius.
 * Each bin becomes a narrow rounded-top column (line with stroke-linecap: round).
 * Supports highlightIndex/highlightIndices for orange highlight animation.
 *
 * @param {d3Selection.Selection} group
 * @param {Array<{value: number, binCenter: number, stackIndex: number}>} dots
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {((value: number) => boolean)} [isExtreme]
 * @param {number} [highlightIndex] - Index of single newest dot
 * @param {Set<number>} [highlightIndices] - Indices of batch-added dots
 * @param {SVGGElement} [innerNode]
 */
function renderColumns(group, dots, xScale, yScale, innerHeight, isExtreme, highlightIndex = -1, highlightIndices, innerNode, fillColor, optBaseFill, optExtremeFill) {
  // Cancel any pending highlight timers from previous render
  for (const t of pendingHighlightTimers) clearTimeout(t);
  pendingHighlightTimers = [];
  // Aggregate dots by binCenter → count
  /** @type {Map<number, {count: number}>} */
  const bins = new Map();
  for (const d of dots) {
    const entry = bins.get(d.binCenter);
    if (entry) {
      entry.count++;
    } else {
      bins.set(d.binCenter, { count: 1 });
    }
  }

  const columnData = [...bins.entries()]
    .map(([center, { count }]) => ({ center, count }))
    .sort((a, b) => a.center - b.center);

  // Compute column width: fraction of bin pixel spacing, clamped
  const binPixelWidth = columnData.length > 1
    ? Math.abs(xScale(columnData[1].center) - xScale(columnData[0].center))
    : 10;
  const colWidth = Math.max(MIN_RADIUS * 2, Math.min(COLUMN_MAX_WIDTH, binPixelWidth * 0.75));

  /** Color for a column based on its bin center value. */
  function colColor(center) {
    const extreme = optExtremeFill || fillColor || EXTREME_FILL;
    const base = optBaseFill || fillColor || (isExtreme ? BODY_FILL : DOT_FILL);
    if (!isExtreme) return base;
    return isExtreme(center) ? extreme : base;
  }

  // Draw columns as lines with round linecap for rounded tops
  const lines = group.selectAll('.col-line')
    .data(columnData)
    .join('line')
    .attr('class', 'col-line')
    .attr('x1', d => xScale(d.center))
    .attr('x2', d => xScale(d.center))
    .attr('y1', innerHeight)
    .attr('y2', d => yScale(d.count))
    .attr('stroke', d => colColor(d.center))
    .attr('stroke-width', colWidth)
    .attr('stroke-linecap', 'round')
    .attr('role', 'listitem')
    .attr('aria-label', d => `${formatTick(d.center)}: ${d.count}`);

  // Highlight only the NEW portion of columns that received new dots
  if (highlightIndex >= 0 || (highlightIndices && highlightIndices.size > 0)) {
    // Count how many new dots landed in each bin
    /** @type {Map<number, number>} */
    const newCountByCenter = new Map();
    for (let i = 0; i < dots.length; i++) {
      if (i === highlightIndex || (highlightIndices && highlightIndices.has(i))) {
        const c = dots[i].binCenter;
        newCountByCenter.set(c, (newCountByCenter.get(c) ?? 0) + 1);
      }
    }

    // Draw overlay segments for just the new portion of each affected column
    const isOneShot = highlightIndex >= 0 && (!highlightIndices || highlightIndices.size === 0);
    const hlWidth = isOneShot ? colWidth + 2 : colWidth + 1;

    /** @type {Array<{center: number, totalCount: number, newCount: number}>} */
    const hlData = [];
    for (const [center, newCount] of newCountByCenter) {
      const total = bins.get(center)?.count ?? newCount;
      hlData.push({ center, totalCount: total, newCount });
    }

    const hlLines = group.selectAll('.col-highlight')
      .data(hlData)
      .join('line')
      .attr('class', 'col-highlight')
      .attr('x1', d => xScale(d.center))
      .attr('x2', d => xScale(d.center))
      .attr('y1', d => yScale(d.totalCount - d.newCount))  // bottom of new portion
      .attr('y2', d => yScale(d.totalCount))                // top of column
      .attr('stroke', HIGHLIGHT_FILL)
      .attr('stroke-width', hlWidth)
      .attr('stroke-linecap', 'round');

    // Revert: for +1, keep last highlight persistent; for batches, fade out
    const reducedMotion = prefersReducedMotion();
    if (!isOneShot) {
      pendingHighlightTimers.push(setTimeout(() => {
        if (reducedMotion) {
          hlLines.remove();
        } else {
          hlLines.each(function() {
            const el = /** @type {SVGLineElement} */ (this);
            animateColumnRevert(el, 'transparent', 0, 400, () => el.remove());
          });
        }
      }, 800));
    } else {
      // +1: shrink to normal width but keep orange — persists until next render
      pendingHighlightTimers.push(setTimeout(() => {
        hlLines.attr('stroke-width', colWidth);
      }, 800));
    }
  }

  // Tooltips
  if (innerNode) {
    attachTooltip(lines, innerNode, (d) => ({
      lines: [`${formatTick(d.center)}`, `Frequency: ${d.count}`],
      x: xScale(d.center),
      y: yScale(d.count),
    }));
  }
}

/**
 * Animate a highlighted column back to its normal stroke color and width,
 * or fade it out (when onComplete is provided for overlay removal).
 * @param {SVGLineElement} el
 * @param {string} targetColor - Normal stroke color (hex), or 'transparent' to fade out
 * @param {number} targetWidth - Normal stroke-width
 * @param {number} duration - Animation duration in ms
 * @param {(() => void)} [onComplete] - Called when animation finishes
 */
function animateColumnRevert(el, targetColor, targetWidth, duration, onComplete) {
  const fadeOut = targetColor === 'transparent';
  const startColor = hexToRGB(el.getAttribute('stroke') ?? HIGHLIGHT_FILL);
  const endColor = fadeOut ? startColor : hexToRGB(targetColor);
  const startW = parseFloat(el.getAttribute('stroke-width') ?? String(targetWidth));
  const startOpacity = 1;
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const e = 1 - (1 - t) * (1 - t); // ease-out quad
    if (fadeOut) {
      el.setAttribute('opacity', String(1 - e));
    } else {
      el.setAttribute('stroke', lerpColor(startColor, endColor, e));
      el.setAttribute('stroke-width', String(startW + (targetWidth - startW) * e));
    }
    if (t < 1) {
      requestAnimationFrame(tick);
    } else if (onComplete) {
      onComplete();
    }
  }
  requestAnimationFrame(tick);
}

/**
 * Parse a hex color (#RRGGBB) to [r, g, b].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Interpolate [r,g,b] and format as hex.
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @param {number} t - 0..1
 * @returns {string}
 */
function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Animate a highlighted dot back to its normal fill/stroke/radius.
 * Uses requestAnimationFrame for reliable cross-browser SVG animation.
 * @param {SVGCircleElement} el - The circle DOM element
 * @param {string} targetFill - Normal fill color (hex)
 * @param {number} targetRadius - Normal radius
 * @param {number} duration - Animation duration in ms
 */
function animateDotRevert(el, targetFill, targetRadius, duration) {
  const startFill = hexToRGB(el.getAttribute('fill') ?? HIGHLIGHT_FILL);
  const startStroke = hexToRGB(el.getAttribute('stroke') ?? '#000000');
  const endFill = hexToRGB(targetFill);
  const endStroke = hexToRGB(targetFill);
  const startR = parseFloat(el.getAttribute('r') ?? String(targetRadius));
  const startSW = parseFloat(el.getAttribute('stroke-width') ?? '1');
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // Ease-out quad
    const e = 1 - (1 - t) * (1 - t);
    el.setAttribute('fill', lerpColor(startFill, endFill, e));
    el.setAttribute('stroke', lerpColor(startStroke, endStroke, e));
    el.setAttribute('r', String(startR + (targetRadius - startR) * e));
    el.setAttribute('stroke-width', String(startSW + (1 - startSW) * e));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Render the observed statistic vertical line.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 */
function renderObservedLine(overlays, value, xScale, innerHeight, precision = 2, label = 'observed') {
  const x = xScale(value);
  const w = xScale.range()[1];
  overlays.append('line')
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', 14)
    .attr('y2', innerHeight)
    .attr('stroke', OBSERVED_COLOR)
    .attr('stroke-width', 2.5)
    .attr('aria-label', `${label}: ${value}`);
  // Clamp label so it doesn't clip at chart edges
  const labelText = `${label} = ${value.toFixed(precision)}`;
  const anchor = x < w * 0.15 ? 'start' : x > w * 0.85 ? 'end' : 'middle';
  const clampedX = Math.max(4, Math.min(w - 4, x));
  overlays.append('text')
    .attr('class', 'overlay-value observed-label')
    .attr('x', clampedX).attr('y', 10)
    .attr('text-anchor', anchor)
    .attr('fill', OBSERVED_COLOR)
    .attr('font-weight', 700)
    .text(labelText);
}

/** CI line color (dark pink — distinct from purple observed stat). */
const CI_COLOR = '#B5747A';

/**
 * Render a CI bound vertical line with label.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 * @param {number} [precision=2] - Decimal places for value label
 */
function renderCILine(overlays, value, xScale, innerHeight, precision = 2) {
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
    .text(value.toFixed(precision));
}
