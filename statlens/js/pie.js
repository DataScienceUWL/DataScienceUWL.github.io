// @ts-check
/**
 * Pie chart module for StatLens.
 * Renders a standard pie chart with labels and optional percentage display.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { createChart, getColors, ensurePatterns, showTooltip, hideTooltip } from './chart-utils.js';
import { computeFrequencies } from './barchart.js';

/**
 * Draw a pie chart into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {string[]} values - Categorical data
 * @param {object} [options]
 * @param {string} [options.titleText]
 * @param {string} [options.descText]
 * @param {string} [options.id]
 * @param {string} [options.xLabel] - Variable name (shown as title)
 * @param {string[]} [options.categoryOrder]
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names' (no numbers), 'none' (no labels/tooltips)
 * @returns {{ frame: ChartFrame }}
 */
export function drawPieChart(container, values, options = {}) {
  const {
    titleText = 'Pie chart',
    descText = '',
    id,
    xLabel,
    categoryOrder,
    labels = 'full',
  } = options;

  const frame = createChart(container, {
    titleText,
    descText,
    id,
    viewHeight: 400,
    margin: { top: 28, right: 200, bottom: 20, left: 20 },
  });

  const { categories, counts, total } = computeFrequencies(values, categoryOrder);
  const colors = getColors(categories.length);
  const patterns = ensurePatterns(/** @type {SVGSVGElement} */ (frame.svg), colors);

  // Radius fits inside the plot area
  const radius = Math.min(frame.width, frame.height) / 2 - 10;
  const centerX = frame.width / 2;
  const centerY = frame.height / 2;

  // Build pie data
  const pieData = categories.map(c => ({
    category: c,
    count: counts.get(c) ?? 0,
  }));

  const pie = d3Shape.pie()
    .value(/** @param {any} d */ d => d.count)
    .sort(null); // Preserve category order

  const arc = d3Shape.arc()
    .innerRadius(0)
    .outerRadius(radius);

  const labelArc = d3Shape.arc()
    .innerRadius(radius * 0.6)
    .outerRadius(radius * 0.6);

  const dataGroup = d3Selection.select(frame.inner).select('.data')
    .append('g')
    .attr('transform', `translate(${centerX}, ${centerY})`);

  const arcs = pie(/** @type {any} */ (pieData));

  for (const d of arcs) {
    const catIdx = categories.indexOf(d.data.category);
    const count = d.data.count;
    const pct = ((count / total) * 100).toFixed(1);
    const centroid = /** @type {[number, number]} */ (labelArc.centroid(/** @type {any} */ (d)));

    // Slice
    const ariaText = labels === 'full' ? `${d.data.category}: ${count} (${pct}%)` : d.data.category;
    const slice = dataGroup.append('path')
      .attr('d', /** @type {string} */ (arc(/** @type {any} */ (d))))
      .attr('fill', colors[catIdx % colors.length])
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('role', 'listitem')
      .attr('aria-label', ariaText);
    // Pattern overlay
    if (patterns[catIdx] && patterns[catIdx] !== 'none') {
      dataGroup.append('path')
        .attr('d', /** @type {string} */ (arc(/** @type {any} */ (d))))
        .attr('fill', patterns[catIdx])
        .attr('stroke', 'none')
        .style('pointer-events', 'none');
    }

    if (labels !== 'none') {
      const tipText = labels === 'full' ? `${d.data.category}: ${count} (${pct}%)` : d.data.category;
      slice
        .on('mouseenter', function () {
          showTooltip(frame.inner, [tipText], centerX + centroid[0], centerY + centroid[1]);
        })
        .on('mouseleave', () => hideTooltip(frame.inner));
    }

    // Labels on slices (only if big enough to read and labels=full)
    const angle = d.endAngle - d.startAngle;
    if (labels === 'full' && angle > 0.35) { // ~20 degrees minimum
      dataGroup.append('text')
        .attr('transform', `translate(${centroid[0]}, ${centroid[1]})`)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('class', 'slice-label')
        .attr('fill', '#fff')
        .style('pointer-events', 'none')
        .text(`${pct}%`);
    }
  }

  // Draw legend (skip in 'none' mode)
  if (labels !== 'none') {
    drawPieLegend(frame, categories, counts, total, colors, xLabel, labels, patterns);
  }

  return { frame };
}

/**
 * Draw legend for pie chart.
 * @param {ChartFrame} frame
 * @param {string[]} categories
 * @param {Map<string, number>} counts
 * @param {number} total
 * @param {string[]} colors
 * @param {string} [title]
 * @param {'full'|'names'|'none'} [labels]
 */
function drawPieLegend(frame, categories, counts, total, colors, title, labels = 'full', patterns = []) {
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const g = overlays.append('g')
    .attr('class', 'chart-legend')
    .attr('aria-label', `Legend: ${categories.join(', ')}`);

  const swatchSize = 14;
  const lineHeight = 22;
  const padX = 8;
  const padY = 6;
  let yOff = padY;

  if (title) {
    g.append('text')
      .attr('x', padX)
      .attr('y', yOff + 13)
      .attr('class', 'legend-title')
      .attr('fill', '#333')
      .text(title);
    yOff += lineHeight;
  }

  for (let i = 0; i < categories.length; i++) {
    const count = counts.get(categories[i]) ?? 0;
    const pct = ((count / total) * 100).toFixed(1);

    g.append('rect')
      .attr('x', padX)
      .attr('y', yOff)
      .attr('width', swatchSize)
      .attr('height', swatchSize)
      .attr('fill', colors[i % colors.length])
      .attr('stroke', '#999')
      .attr('stroke-width', 0.5)
      .attr('rx', 2);
    if (patterns[i] && patterns[i] !== 'none') {
      g.append('rect')
        .attr('x', padX).attr('y', yOff)
        .attr('width', swatchSize).attr('height', swatchSize)
        .attr('fill', patterns[i])
        .attr('stroke', 'none').attr('rx', 2);
    }

    g.append('text')
      .attr('x', padX + swatchSize + 6)
      .attr('y', yOff + swatchSize - 2)
      .attr('class', 'legend-text')
      .attr('fill', '#333')
      .text(labels === 'full' ? `${categories[i]}: ${count} (${pct}%)` : categories[i]);

    yOff += lineHeight;
  }

  // Position to the right of the pie
  g.attr('transform', `translate(${frame.width + 10}, ${frame.height / 2 - yOff / 2})`);

  const measureAndPosition = () => {
    try {
      const bbox = /** @type {SVGGElement} */ (g.node()).getBBox();
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
    } catch { /* getBBox fails in JSDOM */ }
  };
  measureAndPosition();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(measureAndPosition);
  }
}
