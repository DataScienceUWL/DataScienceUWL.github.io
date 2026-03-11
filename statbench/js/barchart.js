// @ts-check
/**
 * Bar chart module for StatBench.
 * Used by explore/categorical. Supports frequency, relative frequency,
 * stacked, dodged, and filled bar modes.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, getColors, prefersReducedMotion, hasD3Transition, TRANSITION_MS } from './chart-utils.js';

/** Bar stroke (white separator). */
const BAR_STROKE = '#FFFFFF';

/**
 * @typedef {'frequency'|'relative'|'stacked'|'dodged'|'filled'} BarMode
 */

/**
 * Compute frequency counts from categorical data.
 *
 * @param {string[]} values - Categorical data
 * @param {string[]} [categoryOrder] - Explicit category order (default: order of appearance)
 * @returns {{ categories: string[], counts: Map<string, number>, total: number }}
 */
export function computeFrequencies(values, categoryOrder) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  const seen = [];
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!seen.includes(v)) seen.push(v);
  }
  const categories = categoryOrder ?? seen;
  return { categories, counts, total: values.length };
}

/**
 * Compute grouped frequency table for stacked/dodged/filled modes.
 *
 * @param {string[]} primary - Primary (x-axis) categories
 * @param {string[]} secondary - Secondary (fill/group) categories
 * @returns {{ primaryCats: string[], secondaryCats: string[], table: Map<string, Map<string, number>>, primaryTotals: Map<string, number> }}
 */
export function computeGroupedFrequencies(primary, secondary) {
  if (primary.length !== secondary.length) {
    throw new Error('primary and secondary must have the same length');
  }

  const primarySeen = [];
  const secondarySeen = [];
  /** @type {Map<string, Map<string, number>>} */
  const table = new Map();
  /** @type {Map<string, number>} */
  const primaryTotals = new Map();

  for (let i = 0; i < primary.length; i++) {
    const p = primary[i];
    const s = secondary[i];

    if (!primarySeen.includes(p)) primarySeen.push(p);
    if (!secondarySeen.includes(s)) secondarySeen.push(s);

    if (!table.has(p)) table.set(p, new Map());
    const row = table.get(p);
    row.set(s, (row.get(s) ?? 0) + 1);

    primaryTotals.set(p, (primaryTotals.get(p) ?? 0) + 1);
  }

  return { primaryCats: primarySeen, secondaryCats: secondarySeen, table, primaryTotals };
}

/**
 * Draw a bar chart into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {string[]} values - Categorical data
 * @param {object} [options]
 * @param {BarMode} [options.mode='frequency'] - Bar chart mode
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label (auto-set per mode if omitted)
 * @param {string} [options.titleText]
 * @param {string} [options.descText]
 * @param {string} [options.id]
 * @param {string[]} [options.groupValues] - Secondary grouping variable (for stacked/dodged/filled)
 * @param {string[]} [options.categoryOrder] - Explicit category order
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @returns {{ frame: ChartFrame }}
 */
export function drawBarChart(container, values, options = {}) {
  const {
    mode = 'frequency',
    xLabel,
    titleText = 'Bar chart',
    descText = '',
    id,
    groupValues,
    categoryOrder,
    animate = true,
    margin,
  } = options;

  const isGrouped = groupValues != null && (mode === 'stacked' || mode === 'dodged' || mode === 'filled');
  const frame = createChart(container, { titleText, descText, id, margin });
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  if (isGrouped) {
    drawGroupedBars(frame, values, groupValues, mode, { xLabel, categoryOrder, shouldAnimate });
  } else {
    drawSimpleBars(frame, values, mode, { xLabel, categoryOrder, shouldAnimate });
  }

  // Y-axis label
  const yLabel = options.yLabel ?? defaultYLabel(mode);
  if (yLabel) {
    d3Selection.select(frame.inner).select('.axes').append('text')
      .attr('class', 'y-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -frame.height / 2)
      .attr('y', -frame.margin.left + 16)
      .text(yLabel);
  }

  return { frame };
}

/**
 * @param {BarMode} mode
 * @returns {string}
 */
function defaultYLabel(mode) {
  switch (mode) {
    case 'frequency': return 'Count';
    case 'relative': return 'Proportion';
    case 'stacked': return 'Count';
    case 'dodged': return 'Count';
    case 'filled': return 'Proportion';
    default: return 'Count';
  }
}

/**
 * Draw simple (non-grouped) bars.
 */
function drawSimpleBars(frame, values, mode, opts) {
  const { categories, counts, total } = computeFrequencies(values, opts.categoryOrder);
  const colors = getColors(categories.length);

  const xScale = d3Scale.scaleBand()
    .domain(categories)
    .range([0, frame.width])
    .paddingInner(0.2)
    .paddingOuter(0.1);

  const yValues = categories.map(c => {
    const count = counts.get(c) ?? 0;
    return mode === 'relative' ? count / total : count;
  });
  const yMax = d3Array.max(yValues) || 1;

  const yScale = d3Scale.scaleLinear()
    .domain([0, yMax])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);

  const axes = d3Selection.select(frame.inner).select('.axes');
  axes.append('g').attr('class', 'x-axis')
    .attr('transform', `translate(0, ${frame.height})`).call(xAxis);
  axes.append('g').attr('class', 'y-axis').call(yAxis);

  if (opts.xLabel) {
    axes.append('text')
      .attr('class', 'x-label')
      .attr('text-anchor', 'middle')
      .attr('x', frame.width / 2)
      .attr('y', frame.height + frame.margin.bottom - 8)
      .text(opts.xLabel);
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const bars = dataGroup.selectAll('rect')
    .data(categories)
    .join('rect')
    .attr('x', c => xScale(c))
    .attr('width', xScale.bandwidth())
    .attr('fill', (_, i) => colors[i % colors.length])
    .attr('stroke', BAR_STROKE)
    .attr('stroke-width', 1)
    .attr('role', 'listitem')
    .attr('aria-label', c => {
      const count = counts.get(c) ?? 0;
      return mode === 'relative'
        ? `${c}: ${(count / total).toFixed(3)}`
        : `${c}: ${count}`;
    });

  if (opts.shouldAnimate) {
    bars
      .attr('y', frame.height)
      .attr('height', 0)
      .transition()
      .duration(TRANSITION_MS)
      .attr('y', c => yScale(mode === 'relative' ? (counts.get(c) ?? 0) / total : counts.get(c) ?? 0))
      .attr('height', c => frame.height - yScale(mode === 'relative' ? (counts.get(c) ?? 0) / total : counts.get(c) ?? 0));
  } else {
    bars
      .attr('y', c => yScale(mode === 'relative' ? (counts.get(c) ?? 0) / total : counts.get(c) ?? 0))
      .attr('height', c => frame.height - yScale(mode === 'relative' ? (counts.get(c) ?? 0) / total : counts.get(c) ?? 0));
  }
}

/**
 * Draw grouped bars (stacked, dodged, or filled).
 */
function drawGroupedBars(frame, values, groupValues, mode, opts) {
  const { primaryCats, secondaryCats, table, primaryTotals } = computeGroupedFrequencies(values, groupValues);
  const colors = getColors(secondaryCats.length);

  const xScale = d3Scale.scaleBand()
    .domain(primaryCats)
    .range([0, frame.width])
    .paddingInner(0.2)
    .paddingOuter(0.1);

  const axes = d3Selection.select(frame.inner).select('.axes');
  const dataGroup = d3Selection.select(frame.inner).select('.data');

  if (mode === 'dodged') {
    const xSubScale = d3Scale.scaleBand()
      .domain(secondaryCats)
      .range([0, xScale.bandwidth()])
      .padding(0.05);

    let yMax = 0;
    for (const p of primaryCats) {
      for (const s of secondaryCats) {
        const v = table.get(p)?.get(s) ?? 0;
        if (v > yMax) yMax = v;
      }
    }

    const yScale = d3Scale.scaleLinear().domain([0, yMax || 1]).nice().range([frame.height, 0]);
    axes.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`).call(d3Axis.axisBottom(xScale));
    axes.append('g').attr('class', 'y-axis').call(d3Axis.axisLeft(yScale).tickFormat(formatTick));

    if (opts.xLabel) {
      axes.append('text').attr('class', 'x-label').attr('text-anchor', 'middle')
        .attr('x', frame.width / 2).attr('y', frame.height + frame.margin.bottom - 8).text(opts.xLabel);
    }

    for (const p of primaryCats) {
      const g = dataGroup.append('g').attr('transform', `translate(${xScale(p)}, 0)`);
      for (let si = 0; si < secondaryCats.length; si++) {
        const s = secondaryCats[si];
        const count = table.get(p)?.get(s) ?? 0;
        g.append('rect')
          .attr('x', xSubScale(s))
          .attr('y', yScale(count))
          .attr('width', xSubScale.bandwidth())
          .attr('height', frame.height - yScale(count))
          .attr('fill', colors[si % colors.length])
          .attr('stroke', BAR_STROKE)
          .attr('stroke-width', 1)
          .attr('role', 'listitem')
          .attr('aria-label', `${p}, ${s}: ${count}`);
      }
    }
  } else {
    // Stacked or filled
    const yMax = mode === 'filled' ? 1 : d3Array.max(primaryCats.map(p => primaryTotals.get(p) ?? 0)) || 1;
    const yScale = d3Scale.scaleLinear().domain([0, yMax]).nice().range([frame.height, 0]);

    axes.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`).call(d3Axis.axisBottom(xScale));
    axes.append('g').attr('class', 'y-axis').call(d3Axis.axisLeft(yScale).tickFormat(formatTick));

    if (opts.xLabel) {
      axes.append('text').attr('class', 'x-label').attr('text-anchor', 'middle')
        .attr('x', frame.width / 2).attr('y', frame.height + frame.margin.bottom - 8).text(opts.xLabel);
    }

    for (const p of primaryCats) {
      const pTotal = primaryTotals.get(p) ?? 1;
      let cumulative = 0;
      for (let si = 0; si < secondaryCats.length; si++) {
        const s = secondaryCats[si];
        const count = table.get(p)?.get(s) ?? 0;
        const value = mode === 'filled' ? count / pTotal : count;
        const y0 = mode === 'filled' ? cumulative / pTotal : cumulative;

        dataGroup.append('rect')
          .attr('x', xScale(p))
          .attr('y', yScale(y0 + value))
          .attr('width', xScale.bandwidth())
          .attr('height', yScale(y0) - yScale(y0 + value))
          .attr('fill', colors[si % colors.length])
          .attr('stroke', BAR_STROKE)
          .attr('stroke-width', 1)
          .attr('role', 'listitem')
          .attr('aria-label', `${p}, ${s}: ${count}`);

        cumulative += count;
      }
    }
  }
}
