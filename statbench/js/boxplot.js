// @ts-check
/**
 * Boxplot chart module for StatBench.
 * Horizontal orientation (IMS convention). Supports single and side-by-side grouped boxplots.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { quantile } from './stats.js';
import { createChart, addAxes, formatTick, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS } from './chart-utils.js';

/** IMS blue for strokes and fills. */
const IMS_BLUE = '#569BBD';

/** Box fill (IMS blue at ~19% opacity). */
const BOX_FILL = '#569BBD30';

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
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
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
    margin,
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

  const frame = createChart(container, { titleText, descText, id, margin });

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
    axes.append('g')
      .attr('class', 'y-axis')
      .call(yAxis);
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  for (const name of groupNames) {
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
    const box = g.append('rect')
      .attr('class', 'box')
      .attr('x', xScale(s.q1))
      .attr('y', boxY)
      .attr('width', shouldAnimate ? 0 : xScale(s.q3) - xScale(s.q1))
      .attr('height', boxH)
      .attr('fill', BOX_FILL)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 1.5);
    box.append('title').text(`Q1 = ${s.q1}\nMedian = ${s.median}\nQ3 = ${s.q3}\nIQR = ${s.iqr}`);

    if (shouldAnimate) {
      g.select('.box')
        .transition()
        .duration(TRANSITION_MS)
        .attr('width', xScale(s.q3) - xScale(s.q1));
    }

    // Median line
    const medLine = g.append('line')
      .attr('class', 'median')
      .attr('x1', xScale(s.median))
      .attr('x2', xScale(s.median))
      .attr('y1', boxY)
      .attr('y2', boxY + boxH)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 2);
    medLine.append('title').text(`Median = ${s.median}`);

    // Lower whisker
    g.append('line')
      .attr('class', 'whisker-lo')
      .attr('x1', xScale(wLo))
      .attr('x2', xScale(s.q1))
      .attr('y1', bandY + bandH / 2)
      .attr('y2', bandY + bandH / 2)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 1);

    // Upper whisker
    g.append('line')
      .attr('class', 'whisker-hi')
      .attr('x1', xScale(s.q3))
      .attr('x2', xScale(wHi))
      .attr('y1', bandY + bandH / 2)
      .attr('y2', bandY + bandH / 2)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 1);

    // Lower whisker cap
    const capLo = g.append('line')
      .attr('class', 'cap-lo')
      .attr('x1', xScale(wLo))
      .attr('x2', xScale(wLo))
      .attr('y1', capY)
      .attr('y2', capY + capH)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 1);
    capLo.append('title').text(showOutliers ? `Min (non-outlier) = ${wLo}` : `Min = ${wLo}`);

    // Upper whisker cap
    const capHi = g.append('line')
      .attr('class', 'cap-hi')
      .attr('x1', xScale(wHi))
      .attr('x2', xScale(wHi))
      .attr('y1', capY)
      .attr('y2', capY + capH)
      .attr('stroke', IMS_BLUE)
      .attr('stroke-width', 1);
    capHi.append('title').text(showOutliers ? `Max (non-outlier) = ${wHi}` : `Max = ${wHi}`);

    if (showOutliers) {
      // Mild outliers (open circles)
      const mild = g.selectAll('.outlier-mild')
        .data(s.mildOutliers)
        .join('circle')
        .attr('class', 'outlier-mild')
        .attr('cx', d => xScale(d))
        .attr('cy', bandY + bandH / 2)
        .attr('r', OUTLIER_RADIUS)
        .attr('fill', 'none')
        .attr('stroke', IMS_BLUE)
        .attr('stroke-width', 1.5)
        .attr('role', 'listitem')
        .attr('aria-label', d => `Mild outlier: ${d}`)
        .style('cursor', 'pointer');
      mild.append('title').text(d => d);

      // Extreme outliers (filled circles)
      const extreme = g.selectAll('.outlier-extreme')
        .data(s.extremeOutliers)
        .join('circle')
        .attr('class', 'outlier-extreme')
        .attr('cx', d => xScale(d))
        .attr('cy', bandY + bandH / 2)
        .attr('r', OUTLIER_RADIUS)
        .attr('fill', IMS_BLUE)
        .attr('stroke', IMS_BLUE)
        .attr('stroke-width', 1.5)
        .attr('role', 'listitem')
        .attr('aria-label', d => `Extreme outlier: ${d}`)
        .style('cursor', 'pointer');
      extreme.append('title').text(d => d);

      // Enlarge outlier dots on hover for easier identification
      const allOutliers = g.selectAll('.outlier-mild, .outlier-extreme');
      allOutliers
        .on('mouseenter', function() {
          d3Selection.select(this).attr('r', OUTLIER_RADIUS * 1.8).attr('stroke-width', 2.5);
        })
        .on('mouseleave', function() {
          d3Selection.select(this).attr('r', OUTLIER_RADIUS).attr('stroke-width', 1.5);
        });
    }
  }

  return { frame, stats };
}
