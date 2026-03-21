// @ts-check
/**
 * Spike (lollipop) chart module for StatLens.
 * Shows vertical lines at each discrete value, ideal for proportion data.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, attachTooltip } from './chart-utils.js';

/** Default spike color (IMS blue) — used when no isTail predicate. */
const SPIKE_COLOR = '#569BBD';

/** Body spike color when isTail is active (subdued gray, WCAG 3:1). */
const BODY_SPIKE = '#8a8a8a';

/** Region-of-interest spike color when isTail is active (bold IMS blue). */
const REGION_SPIKE = '#569BBD';

/** Spike cap radius. */
const CAP_RADIUS = 3;

/**
 * Count occurrences of each unique value (rounded to avoid float issues).
 * @param {number[]} values
 * @param {number} [precision] - Decimal places to round to
 * @returns {Map<number, number>}
 */
function countValues(values, precision = 8) {
  const counts = new Map();
  for (const v of values) {
    const key = Math.round(v * 10 ** precision) / 10 ** precision;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Draw a spike chart into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label (default: "Frequency")
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {(value: number) => boolean} [options.isTail] - Predicate for tail shading
 * @param {number} [options.observedStat] - Value for observed statistic vertical line
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {number[]} [options.prevCounts] - Previous counts per value for delta highlight
 * @returns {{ frame: ChartFrame, xScale: d3Scale.ScaleLinear<number,number>, counts: Map<number, number> }}
 */
export function drawSpike(container, values, options = {}) {
  const {
    xLabel,
    yLabel = 'Frequency',
    titleText = 'Spike Chart',
    descText = '',
    id,
    isTail,
    observedStat,
    ciLines,
    animate = true,
    margin,
    domain: domainOpt,
    prevCounts,
  } = options;

  const frame = createChart(container, { titleText, descText, id, margin });
  const counts = countValues(values);
  const keys = [...counts.keys()].sort((a, b) => a - b);

  // Domain
  let lo, hi;
  if (domainOpt) {
    [lo, hi] = domainOpt;
  } else if (keys.length > 0) {
    lo = keys[0];
    hi = keys[keys.length - 1];
    const pad = (hi - lo) * 0.05 || 0.5;
    lo -= pad;
    hi += pad;
  } else {
    lo = 0;
    hi = 1;
  }

  const xScale = d3Scale.scaleLinear()
    .domain([lo, hi])
    .range([0, frame.width]);

  const maxCount = d3Array.max([...counts.values()]) ?? 1;
  const yScale = d3Scale.scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const dataGroup = d3Selection.select(frame.inner).select('.data');

  // Render spikes
  const spikeData = keys.map(k => ({ value: k, count: counts.get(k) ?? 0 }));

  // Lines
  dataGroup.selectAll('.spike-line')
    .data(spikeData)
    .join('line')
    .attr('class', 'spike-line')
    .attr('x1', d => xScale(d.value))
    .attr('x2', d => xScale(d.value))
    .attr('y1', frame.height)
    .attr('y2', d => yScale(d.count))
    .attr('stroke', d => {
      if (!isTail) return SPIKE_COLOR;
      return isTail(d.value) ? REGION_SPIKE : BODY_SPIKE;
    })
    .attr('stroke-width', 2)
    .attr('role', 'listitem')
    .attr('aria-label', d => `${d.value}: ${d.count}`);

  // Caps (small circles at top)
  dataGroup.selectAll('.spike-cap')
    .data(spikeData)
    .join('circle')
    .attr('class', 'spike-cap')
    .attr('cx', d => xScale(d.value))
    .attr('cy', d => yScale(d.count))
    .attr('r', CAP_RADIUS)
    .attr('fill', d => {
      if (!isTail) return SPIKE_COLOR;
      return isTail(d.value) ? REGION_SPIKE : BODY_SPIKE;
    });

  // Tooltips (mouse + keyboard)
  attachTooltip(dataGroup.selectAll('.spike-line'), frame.inner, (d) => ({
    lines: [formatTick(d.value), `Frequency: ${d.count}`],
    x: xScale(d.value),
    y: yScale(d.count),
  }));

  // Click spike → show count label
  dataGroup.selectAll('.spike-line')
    .style('cursor', 'pointer')
    .on('click', function (event, d) {
      dataGroup.selectAll('.spike-count-label').remove();
      dataGroup.selectAll('.spike-line').attr('stroke-width', 2);
      d3Selection.select(this).attr('stroke-width', 3.5);
      dataGroup.append('text')
        .attr('class', 'spike-count-label')
        .attr('x', xScale(d.value))
        .attr('y', yScale(d.count) - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#000')
        .attr('font-size', '0.75rem')
        .text(d.count);
    });

  // Overlay lines (observed stat, CI bounds)
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null) {
    renderOverlayLine(overlays, observedStat, xScale, frame.height,
      '#7B2D8E', 'Observed statistic');
  }
  if (ciLines) {
    renderOverlayLine(overlays, ciLines[0], xScale, frame.height,
      '#B5747A', 'CI lower bound', true);
    renderOverlayLine(overlays, ciLines[1], xScale, frame.height,
      '#B5747A', 'CI upper bound', true);
  }

  return { frame, xScale, counts };
}

/**
 * Render a vertical overlay line.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {number} innerHeight
 * @param {string} color
 * @param {string} label
 */
function renderOverlayLine(overlays, value, xScale, innerHeight, color, label, dashed = false) {
  const x = xScale(value);
  const line = overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', dashed ? 2 : 2.5)
    .attr('aria-label', `${label}: ${value}`);
  if (dashed) line.attr('stroke-dasharray', '6,3');
  overlays.append('text')
    .attr('class', 'overlay-value')
    .attr('x', x).attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .text(value.toFixed(2));
}
