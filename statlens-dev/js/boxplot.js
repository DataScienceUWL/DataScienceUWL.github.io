// @ts-check
/**
 * Boxplot chart module for StatLens.
 * Horizontal orientation (IMS convention). Supports single and side-by-side grouped boxplots.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { quantile } from './stats.js';
import { createChart, addAxes, formatTick, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS, showTooltip, hideTooltip, attachTooltip, wrapTickLabels, getColors, ensurePatterns } from './chart-utils.js';

/** IMS blue for strokes and fills. */
const IMS_BLUE = '#569BBD';

/** Box fill (IMS blue at ~19% opacity). */
const BOX_FILL = '#569BBD30';

/** Outlier color — IMS red, distinct from box blue (matches textbook convention). */
const OUTLIER_COLOR = '#F05133';

/** Outlier dot radius. */
const OUTLIER_RADIUS = 3;

/**
 * @typedef {object} BoxplotStats
 * @property {number} q1
 * @property {number} median
 * @property {number} q3
 * @property {number} iqr
 * @property {number} whiskerLo - Lowest non-outlier value
 * @property {number} whiskerHi - Highest non-outlier value
 * @property {number[]} mildOutliers - Between 1.5 and 3 IQR from box
 * @property {number[]} extremeOutliers - Beyond 3 IQR from box
 */

/**
 * Compute boxplot statistics from numeric data.
 * Uses R-compatible type=7 quantile (from stats.js).
 *
 * @param {number[]} values - Numeric data (unsorted OK)
 * @returns {BoxplotStats}
 */
export function computeBoxplotStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const med = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqrVal = q3 - q1;

  const lowerFence = q1 - 1.5 * iqrVal;
  const upperFence = q3 + 1.5 * iqrVal;
  const lowerExtreme = q1 - 3 * iqrVal;
  const upperExtreme = q3 + 3 * iqrVal;

  const whiskerLo = d3Array.min(sorted.filter(d => d >= lowerFence)) ?? q1;
  const whiskerHi = d3Array.max(sorted.filter(d => d <= upperFence)) ?? q3;

  const mildOutliers = sorted.filter(d =>
    (d < lowerFence && d >= lowerExtreme) || (d > upperFence && d <= upperExtreme));
  const extremeOutliers = sorted.filter(d =>
    d < lowerExtreme || d > upperExtreme);

  return { q1, median: med, q3, iqr: iqrVal, whiskerLo, whiskerHi, mildOutliers, extremeOutliers };
}

/**
 * Draw a single or grouped boxplot into a container element.
 * Horizontal orientation: quantitative axis is x-axis.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[] | Record<string, number[]>} data - Single array or {groupName: values} for side-by-side
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {boolean} [options.showOutliers] - Whether to use 1.5×IQR fences and show outliers (default: true). When false, whiskers extend to min/max.
 * @param {boolean} [options.showMean] - Whether to show a diamond marker at the mean (default: false).
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names'/'none' (no numeric tooltips)
 * @returns {{ frame: ChartFrame, stats: Record<string, BoxplotStats> }}
 */
export function drawBoxplot(container, data, options = {}) {
  const {
    xLabel,
    titleText = 'Boxplot',
    descText = '',
    id,
    animate = true,
    showOutliers = true,
    showMean = false,
    margin,
    showExport,
    filename,
    labels = 'full',
  } = options;

  // Normalize to grouped format
  /** @type {Record<string, number[]>} */
  const groups = Array.isArray(data) ? { '': data } : data;
  const groupNames = Object.keys(groups);
  const isGrouped = groupNames.length > 1 || groupNames[0] !== '';

  // Compute stats for each group
  /** @type {Record<string, BoxplotStats>} */
  const stats = {};
  for (const name of groupNames) {
    stats[name] = computeBoxplotStats(groups[name]);
  }

  // Global x domain across all groups
  const allValues = Object.values(groups).flat();
  const xMin = d3Array.min(allValues);
  const xMax = d3Array.max(allValues);
  const xPad = (xMax - xMin) * 0.05 || 0.5;

  // Auto-widen left margin for grouped boxplots based on longest group name
  // On phone (CSS bumps chart font to 22px), chars are wider in viewBox units
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  const effectiveMargin = margin || (isGrouped
    ? (() => {
        const maxLen = Math.max(...groupNames.map(n => n.length));
        const charWidth = isPhone ? 12 : 8;
        const needed = Math.max(isPhone ? 80 : 60, maxLen * charWidth + 15);
        return { top: 28, right: 20, bottom: 50, left: needed };
      })()
    : undefined);

  const frame = createChart(container, { titleText, descText, id, margin: effectiveMargin, showExport, filename });

  const xScale = d3Scale.scaleLinear()
    .domain([xMin - xPad, xMax + xPad])
    .range([0, frame.width]);

  // Y scale: band scale for groups
  const yScale = d3Scale.scaleBand()
    .domain(groupNames)
    .range([0, frame.height])
    .paddingInner(0.3)
    .paddingOuter(0.15);

  // X axis
  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const axes = d3Selection.select(frame.inner).select('.axes');
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

  // Y axis (group labels) — only for grouped
  if (isGrouped) {
    const yAxis = d3Axis.axisLeft(yScale);
    const yAxisG = axes.append('g')
      .attr('class', 'y-axis')
      .call(yAxis);
    // Wrap long group labels (e.g., "Nonsmoker" → "Non-\nsmoker" on narrow screens)
    wrapTickLabels(yAxisG, frame.margin.left - 15);
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  // Per-group colors: use Okabe-Ito palette for grouped boxplots, IMS blue for single
  const rawColors = isGrouped ? getColors(groupNames.length) : [IMS_BLUE];
  const groupColors = isGrouped
    ? rawColors.map(c => ({ stroke: c, fill: c + '30' }))
    : [{ stroke: IMS_BLUE, fill: BOX_FILL }];

  // Boxplots skip patterns — y-axis labels identify groups, and patterns
  // obscure the median line and mean diamond.
  const patterns = [];

  for (let gi = 0; gi < groupNames.length; gi++) {
    const name = groupNames[gi];
    const gc = groupColors[gi % groupColors.length];
    const s = stats[name];
    const vals = groups[name];
    const bandY = yScale(name);
    const bandH = yScale.bandwidth();
    const boxH = bandH * 0.4;
    const boxY = bandY + (bandH - boxH) / 2;
    const capH = boxH / 2;
    const capY = bandY + (bandH - capH) / 2;

    // Whisker endpoints: 1.5×IQR fences (with outliers) or min/max (without)
    const wLo = showOutliers ? s.whiskerLo : d3Array.min(vals);
    const wHi = showOutliers ? s.whiskerHi : d3Array.max(vals);

    const g = dataGroup.append('g')
      .attr('class', 'boxplot-group')
      .attr('aria-label', isGrouped
        ? `${name}: median ${s.median}, Q1 ${s.q1}, Q3 ${s.q3}`
        : `Median ${s.median}, Q1 ${s.q1}, Q3 ${s.q3}`);

    // Box (IQR)
    g.append('rect')
      .attr('class', 'box')
      .attr('x', xScale(s.q1))
      .attr('y', boxY)
      .attr('width', shouldAnimate ? 0 : xScale(s.q3) - xScale(s.q1))
      .attr('height', boxH)
      .attr('fill', gc.fill)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 1.5);

    if (shouldAnimate) {
      g.select('.box')
        .transition()
        .duration(TRANSITION_MS)
        .attr('width', xScale(s.q3) - xScale(s.q1));
    }

    // Pattern overlay (grouped only — adds hatching/dots as secondary visual cue)
    if (isGrouped && patterns[gi] && patterns[gi] !== 'none') {
      const patRect = g.append('rect')
        .attr('class', 'box-pattern')
        .attr('x', xScale(s.q1))
        .attr('y', boxY)
        .attr('width', shouldAnimate ? 0 : xScale(s.q3) - xScale(s.q1))
        .attr('height', boxH)
        .attr('fill', patterns[gi])
        .attr('stroke', 'none')
        .style('pointer-events', 'none');
      if (shouldAnimate) {
        patRect.transition().duration(TRANSITION_MS)
          .attr('width', xScale(s.q3) - xScale(s.q1));
      }
    }

    // Median line — white outline for visibility against hatched patterns
    g.append('line')
      .attr('class', 'median-outline')
      .attr('x1', xScale(s.median))
      .attr('x2', xScale(s.median))
      .attr('y1', boxY)
      .attr('y2', boxY + boxH)
      .attr('stroke', '#fff')
      .attr('stroke-width', 4)
      .style('pointer-events', 'none');
    g.append('line')
      .attr('class', 'median')
      .attr('x1', xScale(s.median))
      .attr('x2', xScale(s.median))
      .attr('y1', boxY)
      .attr('y2', boxY + boxH)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 2);

    // Lower whisker
    g.append('line')
      .attr('class', 'whisker-lo')
      .attr('x1', xScale(wLo))
      .attr('x2', xScale(s.q1))
      .attr('y1', bandY + bandH / 2)
      .attr('y2', bandY + bandH / 2)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 1);

    // Upper whisker
    g.append('line')
      .attr('class', 'whisker-hi')
      .attr('x1', xScale(s.q3))
      .attr('x2', xScale(wHi))
      .attr('y1', bandY + bandH / 2)
      .attr('y2', bandY + bandH / 2)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 1);

    // Lower whisker cap
    g.append('line')
      .attr('class', 'cap-lo')
      .attr('x1', xScale(wLo))
      .attr('x2', xScale(wLo))
      .attr('y1', capY)
      .attr('y2', capY + capH)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 1);

    // Upper whisker cap
    g.append('line')
      .attr('class', 'cap-hi')
      .attr('x1', xScale(wHi))
      .attr('x2', xScale(wHi))
      .attr('y1', capY)
      .attr('y2', capY + capH)
      .attr('stroke', gc.stroke)
      .attr('stroke-width', 1);

    // Actual data min/max for five-number summary tooltip
    const dataMin = d3Array.min(vals);
    const dataMax = d3Array.max(vals);

    // Helper: attach mouse + keyboard tooltip to a single element (suppressed in names/none mode)
    const tipEl = (el, lines, tx, ty) => {
      if (labels === 'none') return;
      el.attr('tabindex', '0').style('outline', 'none')
        .style('cursor', 'pointer')
        .on('mouseenter', () => showTooltip(frame.inner, lines, tx, ty))
        .on('mouseleave', () => hideTooltip(frame.inner))
        .on('focusin', () => showTooltip(frame.inner, lines, tx, ty))
        .on('focusout', () => hideTooltip(frame.inner));
    };

    // Invisible hit rect spanning full whisker-to-whisker range for easy hover/focus
    const hitRect = g.append('rect')
      .attr('class', 'boxplot-hit')
      .attr('x', xScale(wLo))
      .attr('y', bandY)
      .attr('width', xScale(wHi) - xScale(wLo))
      .attr('height', bandH)
      .attr('fill', 'transparent')
      .attr('aria-label', `Five-number summary: Min ${dataMin}, Q1 ${s.q1}, Median ${s.median}, Q3 ${s.q3}, Max ${dataMax}`);
    const fiveNumLines = labels === 'full'
      ? [`Min = ${dataMin}`, `Q1 = ${s.q1}`, `Median = ${s.median}`, `Q3 = ${s.q3}`, `Max = ${dataMax}`]
      : ['Five-number summary'];
    tipEl(hitRect, fiveNumLines,
      (xScale(s.q1) + xScale(s.q3)) / 2, boxY);

    // Whisker cap hit zones — label depends on whether outliers exist on that side
    if (showOutliers) {
      const hasLowOutliers = s.mildOutliers.some(d => d < s.q1) || s.extremeOutliers.some(d => d < s.q1);
      const hasHighOutliers = s.mildOutliers.some(d => d > s.q3) || s.extremeOutliers.some(d => d > s.q3);
      const capHitW = 16;

      const loLabel = labels === 'full'
        ? (hasLowOutliers ? ['Smallest non-outlier', String(wLo)] : [`Min = ${wLo}`])
        : (hasLowOutliers ? ['Smallest non-outlier'] : ['Min']);
      const capLo = g.append('rect')
        .attr('class', 'cap-hit-lo')
        .attr('x', xScale(wLo) - capHitW / 2)
        .attr('y', bandY)
        .attr('width', capHitW)
        .attr('height', bandH)
        .attr('fill', 'transparent')
        .attr('aria-label', loLabel.join(': '));
      tipEl(capLo, loLabel, xScale(wLo), capY);

      const hiLabel = labels === 'full'
        ? (hasHighOutliers ? ['Largest non-outlier', String(wHi)] : [`Max = ${wHi}`])
        : (hasHighOutliers ? ['Largest non-outlier'] : ['Max']);
      const capHi = g.append('rect')
        .attr('class', 'cap-hit-hi')
        .attr('x', xScale(wHi) - capHitW / 2)
        .attr('y', bandY)
        .attr('width', capHitW)
        .attr('height', bandH)
        .attr('fill', 'transparent')
        .attr('aria-label', hiLabel.join(': '));
      tipEl(capHi, hiLabel, xScale(wHi), capY);
    }

    if (showOutliers) {
      const outlierCy = bandY + bandH / 2;
      const allOutlierValues = [...s.mildOutliers, ...s.extremeOutliers];
      // Use group color for outliers in grouped mode, IMS red for single boxplots
      const oColor = isGrouped ? gc.stroke : OUTLIER_COLOR;

      // Mild outliers (open circles)
      g.selectAll('.outlier-mild')
        .data(s.mildOutliers)
        .join('circle')
        .attr('class', 'outlier-mild')
        .attr('cx', d => xScale(d))
        .attr('cy', outlierCy)
        .attr('r', OUTLIER_RADIUS)
        .attr('fill', 'none')
        .attr('stroke', oColor)
        .attr('stroke-width', 1.5)
        .attr('role', 'listitem')
        .attr('aria-label', d => `Mild outlier: ${d}`);

      // Extreme outliers (filled circles)
      g.selectAll('.outlier-extreme')
        .data(s.extremeOutliers)
        .join('circle')
        .attr('class', 'outlier-extreme')
        .attr('cx', d => xScale(d))
        .attr('cy', outlierCy)
        .attr('r', OUTLIER_RADIUS)
        .attr('fill', oColor)
        .attr('stroke', oColor)
        .attr('stroke-width', 1.5)
        .attr('role', 'listitem')
        .attr('aria-label', d => `Extreme outlier: ${d}`);

      // Invisible wider hit circles on top of each outlier for easier hover/focus
      const outlierHits = g.selectAll('.outlier-hit')
        .data(allOutlierValues)
        .join('circle')
        .attr('class', 'outlier-hit')
        .attr('cx', d => xScale(d))
        .attr('cy', outlierCy)
        .attr('r', Math.max(OUTLIER_RADIUS * 3, 8))
        .attr('fill', 'transparent');
      if (labels !== 'none') {
        const outlierTipLines = labels === 'full'
          ? (/** @param {number} d */ d) => [`Outlier: ${d}`]
          : () => ['Outlier'];
        attachTooltip(outlierHits, frame.inner, (/** @type {number} */ d) => ({
          lines: outlierTipLines(d),
          x: xScale(d),
          y: outlierCy - OUTLIER_RADIUS * 3,
        }));
      }
    }

    // Mean marker (diamond)
    if (showMean) {
      const meanVal = d3Array.mean(vals);
      if (meanVal != null) {
        const mx = xScale(meanVal);
        const my = bandY + bandH / 2;
        const ds = Math.max(7, boxH * 0.5); // diamond half-size = box half-height
        g.append('path')
          .attr('class', 'mean-marker')
          .attr('d', `M${mx},${my - ds} L${mx + ds},${my} L${mx},${my + ds} L${mx - ds},${my} Z`)
          .attr('fill', '#F05133')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
          .attr('aria-label', `Mean: ${meanVal.toFixed(2)}`);

        // Hit zone for tooltip
        if (labels !== 'none') {
          const meanHit = g.append('circle')
            .attr('cx', mx)
            .attr('cy', my)
            .attr('r', Math.max(ds * 2, 8))
            .attr('fill', 'transparent');
          const meanTipLines = labels === 'full' ? [`Mean: ${meanVal.toFixed(2)}`] : ['Mean'];
          attachTooltip(meanHit, frame.inner, () => ({
            lines: meanTipLines,
            x: mx,
            y: my - ds - 4,
          }));
        }
      }
    }
  }

  return { frame, stats };
}
