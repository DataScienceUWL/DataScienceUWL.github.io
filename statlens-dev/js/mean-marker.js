// @ts-check
/**
 * Shared mean-marker drawing helpers.
 * Used by descriptive, grouped, and multi (Data Explorer) apps.
 */

import * as d3Selection from 'd3-selection';
import { mean, detectPrecision, formatStat } from './stats.js';
import { renderStatLabel } from './chart-utils.js';

/**
 * Draw a mean marker (red dashed vertical line + label) on a histogram.
 * @param {any} histResult - Return value from drawHistogram
 * @param {number[]} values
 * @param {{ color?: string }} [options]
 */
export function drawMeanOnHistogram(histResult, values, options) {
  if (!histResult || !histResult.frame || values.length === 0) return;
  const color = options?.color ?? '#F05133';
  const dp = detectPrecision(values);
  const meanVal = mean(values);
  const mx = histResult.xScale(meanVal);
  const overlays = d3Selection.select(histResult.frame.inner).select('.overlays');
  overlays.append('line')
    .attr('x1', mx).attr('x2', mx)
    .attr('y1', 0).attr('y2', histResult.frame.height)
    .attr('stroke', color).attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,3')
    .attr('aria-label', `Mean = ${formatStat(meanVal, dp)}`);
  const meanText = overlays.append('text')
    .attr('x', mx).attr('y', -6)
    .attr('text-anchor', 'middle')
    .attr('fill', color).attr('class', 'stat-marker-label');
  renderStatLabel(meanText, `x\u0304 = ${formatStat(meanVal, dp)}`);
}

/**
 * Draw a mean marker (red triangle below x-axis) on a dotplot.
 * @param {any} dotResult - Return value from drawDotplot
 * @param {number[]} values
 * @param {{ color?: string }} [options]
 */
export function drawMeanOnDotplot(dotResult, values, options) {
  if (!dotResult || !dotResult.frame || values.length === 0) return;
  const color = options?.color ?? '#F05133';
  const dp = detectPrecision(values);
  const meanVal = mean(values);
  const mx = dotResult.xScale(meanVal);
  const triangleY = dotResult.frame.height + 12;
  const size = 6;
  const triangle = `M${mx},${triangleY - size} L${mx - size},${triangleY + size} L${mx + size},${triangleY + size} Z`;
  const overlays = d3Selection.select(dotResult.frame.inner).select('.overlays');
  overlays.append('path')
    .attr('d', triangle)
    .attr('fill', color)
    .attr('stroke', 'none')
    .attr('aria-label', `Mean = ${formatStat(meanVal, dp)}`)
    .append('title')
    .text(`Mean = ${formatStat(meanVal, dp)}`);
}

/**
 * Draw mean markers on a grouped density chart (one per group).
 * @param {any} densityResult - Return value from drawGroupedDensity
 * @param {Record<string, number[]>} grouped
 * @param {string[]} groupNames
 * @param {string[]} colors - One color per group
 */
export function drawMeanOnGroupedDensity(densityResult, grouped, groupNames, colors) {
  if (!densityResult || !densityResult.frame) return;
  const dp = detectPrecision(Object.values(grouped).flat());
  const overlays = d3Selection.select(densityResult.frame.inner).select('.overlays');
  for (let i = 0; i < groupNames.length; i++) {
    const vals = grouped[groupNames[i]];
    if (!vals || vals.length === 0) continue;
    const meanVal = mean(vals);
    const mx = densityResult.xScale(meanVal);
    overlays.append('line')
      .attr('x1', mx).attr('x2', mx)
      .attr('y1', 0).attr('y2', densityResult.frame.height)
      .attr('stroke', colors[i])
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,3')
      .attr('aria-label', `${groupNames[i]} mean = ${formatStat(meanVal, dp)}`);
  }
}
