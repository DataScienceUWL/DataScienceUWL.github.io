// @ts-check
/**
 * Bar chart module for StatLens.
 * Used by explore/categorical. Supports frequency, relative frequency,
 * stacked, dodged, and filled bar modes.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, getColors, prefersReducedMotion, hasD3Transition, TRANSITION_MS, showTooltip, hideTooltip, attachTooltip, wrapTickLabels, autoRotateLabels } from './chart-utils.js';

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
 * @param {string} [options.groupLabel] - Label for the legend title (secondary variable name)
 * @returns {{ frame: ChartFrame, colorMap?: { categories: string[], colors: string[] } }}
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
    groupLabel,
  } = options;

  const isGrouped = groupValues != null && (mode === 'stacked' || mode === 'dodged' || mode === 'filled');
  // Categorical x-axis needs more bottom margin on phone for rotated labels
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  const effectiveMargin = margin || (isPhone
    ? { top: 30, right: 15, bottom: 70, left: 55 }
    : undefined);
  const frame = createChart(container, { titleText, descText, id, margin: effectiveMargin });
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();

  /** @type {{ categories: string[], colors: string[] } | undefined} */
  let colorMap;

  if (isGrouped) {
    colorMap = drawGroupedBars(frame, values, groupValues, mode, { xLabel, categoryOrder, shouldAnimate });
    drawLegend(frame, colorMap.categories, colorMap.colors, groupLabel);
  } else {
    drawSimpleBars(frame, values, mode, { xLabel, categoryOrder, shouldAnimate });
  }

  // Y-axis label — measure tick width to avoid overlap (same logic as addAxes)
  const yLabel = options.yLabel ?? defaultYLabel(mode);
  if (yLabel) {
    const axes = d3Selection.select(frame.inner).select('.axes');
    let maxTickWidth = 0;
    axes.select('.y-axis').selectAll('.tick text').each(function () {
      try {
        const w = /** @type {SVGTextElement} */ (this).getBBox().width;
        if (w > maxTickWidth) maxTickWidth = w;
      } catch { /* getBBox fails in JSDOM */ }
    });
    const labelY = Math.max(-(frame.margin.left - 6), -(maxTickWidth + 14));

    axes.append('text')
      .attr('class', 'y-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -frame.height / 2)
      .attr('y', labelY)
      .text(yLabel);
  }

  return { frame, colorMap };
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
 * Draw faint horizontal gridlines from y-axis ticks (ggplot2-style).
 * @param {import('./types.js').ChartFrame} frame
 */
function drawHorizontalGridlines(frame) {
  const axes = d3Selection.select(frame.inner).select('.axes');
  const dataGroup = d3Selection.select(frame.inner).select('.data');
  axes.select('.y-axis').selectAll('.tick').each(function () {
    const transform = d3Selection.select(this).attr('transform');
    const m = transform && transform.match(/translate\(\s*[\d.e+-]+\s*,\s*([\d.e+-]+)/);
    if (m) {
      const ty = parseFloat(m[1]);
      // Skip the baseline (y = frame.height)
      if (Math.abs(ty - frame.height) < 1) return;
      dataGroup.insert('line', ':first-child')
        .attr('class', 'grid-line')
        .attr('x1', 0)
        .attr('x2', frame.width)
        .attr('y1', ty)
        .attr('y2', ty)
        .attr('stroke', '#d8d8d8')
        .attr('stroke-width', 0.5);
    }
  });
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
  // Reduce y-axis ticks on phone to avoid crowding
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  if (isPhone) yAxis.ticks(5);

  const axes = d3Selection.select(frame.inner).select('.axes');
  const xAxisG = axes.append('g').attr('class', 'x-axis')
    .attr('transform', `translate(0, ${frame.height})`).call(xAxis);
  axes.append('g').attr('class', 'y-axis').call(yAxis);
  drawHorizontalGridlines(frame);

  // Rotate category labels if they overlap (common on phone with many categories)
  const rotated = autoRotateLabels(xAxisG, frame.margin.bottom);

  // Hide x-axis title when labels are rotated — it overlaps and is redundant
  if (opts.xLabel && !rotated) {
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
    })
  attachTooltip(bars, frame.inner, (c) => {
    const count = counts.get(c) ?? 0;
    const val = mode === 'relative' ? count / total : count;
    const label = mode === 'relative'
      ? `${c}: ${(count / total).toFixed(3)}`
      : `${c}: ${count}`;
    return {
      lines: [label],
      x: /** @type {number} */ (xScale(c)) + xScale.bandwidth() / 2,
      y: yScale(val),
    };
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
 * Draw a legend in the chart's overlays layer (top-right).
 * @param {ChartFrame} frame
 * @param {string[]} categories
 * @param {string[]} colors
 * @param {string} [title]
 */
function drawLegend(frame, categories, colors, title) {
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const legendLabel = title ? `Legend: ${title}` : 'Legend';
  const g = overlays.append('g')
    .attr('class', 'chart-legend')
    .attr('role', 'img')
    .attr('aria-label', `${legendLabel} — ${categories.join(', ')}`);

  const swatchSize = 12;
  const lineHeight = 18;
  const padX = 8;
  const padY = 6;
  let yOff = padY;

  // Optional title
  if (title) {
    g.append('text')
      .attr('x', padX)
      .attr('y', yOff + 11)
      .attr('class', 'legend-title')
      .attr('fill', '#333')
      .text(title);
    yOff += lineHeight;
  }

  for (let i = 0; i < categories.length; i++) {
    g.append('rect')
      .attr('x', padX)
      .attr('y', yOff)
      .attr('width', swatchSize)
      .attr('height', swatchSize)
      .attr('fill', colors[i % colors.length])
      .attr('stroke', '#999')
      .attr('stroke-width', 0.5)
      .attr('rx', 2);

    g.append('text')
      .attr('x', padX + swatchSize + 5)
      .attr('y', yOff + swatchSize - 1)
      .attr('class', 'legend-text')
      .attr('fill', '#333')
      .text(categories[i]);

    yOff += lineHeight;
  }

  // Position top-right (initial estimate before text is laid out)
  g.attr('transform', `translate(${frame.width - 120}, 0)`);

  // Defer getBBox measurements until the browser has rendered text —
  // on first load, fonts may not be ready, causing getBBox to return
  // near-zero width and pushing the legend off the right edge.
  const measureAndPosition = () => {
    try {
      const bbox = /** @type {SVGGElement} */ (g.node()).getBBox();
      // Add background rect sized to actual content
      const bgPad = 4;
      if (!g.select('.legend-bg').size()) {
        g.insert('rect', ':first-child')
          .attr('class', 'legend-bg')
          .attr('fill', 'white')
          .attr('fill-opacity', 0.9)
          .attr('stroke', '#ccc')
          .attr('stroke-width', 0.5)
          .attr('rx', 4);
      }
      g.select('.legend-bg')
        .attr('x', bbox.x - bgPad)
        .attr('y', bbox.y - bgPad)
        .attr('width', bbox.width + bgPad * 2)
        .attr('height', bbox.height + bgPad * 2);
      // Position based on measured width
      g.attr('transform', `translate(${frame.width - bbox.width - 4}, 0)`);
    } catch { /* getBBox fails in JSDOM */ }
  };

  // Try immediately (works when fonts are cached), then again after layout
  measureAndPosition();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(measureAndPosition);
  }
}

/**
 * Draw grouped bars (stacked, dodged, or filled).
 * @returns {{ categories: string[], colors: string[] }}
 */
function drawGroupedBars(frame, values, groupValues, mode, opts) {
  const { primaryCats, secondaryCats, table, primaryTotals } = computeGroupedFrequencies(values, groupValues);
  const colors = getColors(secondaryCats.length);
  const isPhone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;

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
    const yAxisDodged = d3Axis.axisLeft(yScale).tickFormat(formatTick);
    if (isPhone) yAxisDodged.ticks(5);
    const xAxisG2 = axes.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`).call(d3Axis.axisBottom(xScale));
    axes.append('g').attr('class', 'y-axis').call(yAxisDodged);
    drawHorizontalGridlines(frame);
    const rotated2 = autoRotateLabels(xAxisG2, frame.margin.bottom);

    if (opts.xLabel && !rotated2) {
      axes.append('text').attr('class', 'x-label').attr('text-anchor', 'middle')
        .attr('x', frame.width / 2).attr('y', frame.height + frame.margin.bottom - 8).text(opts.xLabel);
    }

    for (const p of primaryCats) {
      const gx = /** @type {number} */ (xScale(p));
      const g = dataGroup.append('g').attr('transform', `translate(${gx}, 0)`);
      for (let si = 0; si < secondaryCats.length; si++) {
        const s = secondaryCats[si];
        const count = table.get(p)?.get(s) ?? 0;
        const barX = /** @type {number} */ (xSubScale(s));
        const barY = yScale(count);
        const tipX = gx + barX + xSubScale.bandwidth() / 2;
        const tipLines = [`${s}: ${count}`];
        g.append('rect')
          .attr('x', barX)
          .attr('y', barY)
          .attr('width', xSubScale.bandwidth())
          .attr('height', frame.height - barY)
          .attr('fill', colors[si % colors.length])
          .attr('stroke', BAR_STROKE)
          .attr('stroke-width', 1)
          .attr('role', 'listitem')
          .attr('aria-label', `${p}, ${s}: ${count}`)
          .attr('tabindex', '0')
          .style('outline', 'none')
          .on('mouseenter', () => showTooltip(frame.inner, tipLines, tipX, barY))
          .on('mouseleave', () => hideTooltip(frame.inner))
          .on('focusin', () => showTooltip(frame.inner, tipLines, tipX, barY))
          .on('focusout', () => hideTooltip(frame.inner));
      }
    }
  } else {
    // Stacked or filled
    const yMax = mode === 'filled' ? 1 : d3Array.max(primaryCats.map(p => primaryTotals.get(p) ?? 0)) || 1;
    const yScale = d3Scale.scaleLinear().domain([0, yMax]).nice().range([frame.height, 0]);
    const yAxisStacked = d3Axis.axisLeft(yScale).tickFormat(formatTick);
    if (isPhone) yAxisStacked.ticks(5);

    const xAxisG3 = axes.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`).call(d3Axis.axisBottom(xScale));
    axes.append('g').attr('class', 'y-axis').call(yAxisStacked);
    drawHorizontalGridlines(frame);
    const rotated3 = autoRotateLabels(xAxisG3, frame.margin.bottom);

    if (opts.xLabel && !rotated3) {
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
        const barY = yScale(y0 + value);
        const barMidX = /** @type {number} */ (xScale(p)) + xScale.bandwidth() / 2;
        const label = mode === 'filled'
          ? `${s}: ${(value * 100).toFixed(1)}%`
          : `${s}: ${count}`;

        dataGroup.append('rect')
          .attr('x', xScale(p))
          .attr('y', barY)
          .attr('width', xScale.bandwidth())
          .attr('height', yScale(y0) - barY)
          .attr('fill', colors[si % colors.length])
          .attr('stroke', BAR_STROKE)
          .attr('stroke-width', 1)
          .attr('role', 'listitem')
          .attr('aria-label', `${p}, ${s}: ${count}`)
          .attr('tabindex', '0')
          .style('outline', 'none')
          .on('mouseenter', () => showTooltip(frame.inner, [label], barMidX, barY))
          .on('mouseleave', () => hideTooltip(frame.inner))
          .on('focusin', () => showTooltip(frame.inner, [label], barMidX, barY))
          .on('focusout', () => hideTooltip(frame.inner));

        cumulative += count;
      }
    }
  }

  return { categories: secondaryCats, colors };
}
