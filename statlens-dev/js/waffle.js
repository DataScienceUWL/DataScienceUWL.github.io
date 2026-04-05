// @ts-check
/**
 * Waffle chart module for StatLens.
 * Renders a 10×10 grid of colored squares representing proportions.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Selection from 'd3-selection';
import { createChart, getColors, ensurePatterns, showTooltip, hideTooltip } from './chart-utils.js';
import { computeFrequencies } from './barchart.js';

/**
 * Draw a waffle chart into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {string[]} values - Categorical data
 * @param {object} [options]
 * @param {string} [options.titleText]
 * @param {string} [options.descText]
 * @param {string} [options.id]
 * @param {string} [options.xLabel] - Variable name (shown in legend)
 * @param {string[]} [options.categoryOrder]
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names' (no numbers), 'none' (no labels/tooltips/legend)
 * @returns {{ frame: ChartFrame }}
 */
export function drawWaffleChart(container, values, options = {}) {
  const {
    titleText = 'Waffle chart',
    descText = '',
    id,
    xLabel,
    categoryOrder,
    labels = 'full',
  } = options;

  // Use a square-ish viewBox for the waffle grid
  const frame = createChart(container, {
    titleText,
    descText,
    id,
    viewHeight: 420,
    margin: { top: 28, right: 200, bottom: 20, left: 20 },
  });

  const { categories, counts, total } = computeFrequencies(values, categoryOrder);
  const colors = getColors(categories.length);
  const patterns = ensurePatterns(/** @type {SVGSVGElement} */ (frame.svg), colors);

  // Build the 100-cell grid assignment
  // Each cell represents total/100 of the data
  const cells = 100;
  const gridCols = 10;
  const gridRows = 10;

  // Assign cells proportionally (largest-remainder method for fairness)
  const cellAssignment = assignCells(categories, counts, total, cells);

  // Compute cell size to fit the plot area
  const gap = 3;
  const cellSize = Math.min(
    (frame.width - gap * (gridCols - 1)) / gridCols,
    (frame.height - gap * (gridRows - 1)) / gridRows,
  );

  // Center the grid
  const gridW = gridCols * cellSize + (gridCols - 1) * gap;
  const gridH = gridRows * cellSize + (gridRows - 1) * gap;
  const offsetX = (frame.width - gridW) / 2;
  const offsetY = (frame.height - gridH) / 2;

  const dataGroup = d3Selection.select(frame.inner).select('.data');

  // Draw cells left-to-right, top-to-bottom so each category forms a contiguous block
  for (let i = 0; i < cells; i++) {
    const row = Math.floor(i / gridCols);
    const col = i % gridCols;

    const x = offsetX + col * (cellSize + gap);
    const y = offsetY + row * (cellSize + gap);

    const catIdx = cellAssignment[i];
    const cat = categories[catIdx];
    const count = counts.get(cat) ?? 0;
    const pct = ((count / total) * 100).toFixed(1);

    const cell = dataGroup.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', cellSize)
      .attr('height', cellSize)
      .attr('rx', 2)
      .attr('fill', colors[catIdx % colors.length])
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .attr('role', 'listitem')
      .attr('aria-label', labels === 'full' ? `${cat}: ${count} (${pct}%)` : `${cat}`);
    // Pattern overlay
    if (patterns[catIdx] && patterns[catIdx] !== 'none') {
      dataGroup.append('rect')
        .attr('x', x).attr('y', y)
        .attr('width', cellSize).attr('height', cellSize)
        .attr('rx', 2)
        .attr('fill', patterns[catIdx])
        .attr('stroke', 'none')
        .style('pointer-events', 'none');
    }

    if (labels !== 'none') {
      const tipText = labels === 'full' ? `${cat}: ${count} (${pct}%)` : cat;
      cell
        .on('mouseenter', function () {
          showTooltip(frame.inner, [tipText], x + cellSize / 2, y);
        })
        .on('mouseleave', () => hideTooltip(frame.inner));
    }
  }

  // Draw legend (skip in 'none' mode)
  if (labels !== 'none') {
    drawWaffleLegend(frame, categories, counts, total, colors, xLabel, labels, patterns);
  }

  return { frame };
}

/**
 * Assign cells to categories proportionally using largest-remainder method.
 * @param {string[]} categories
 * @param {Map<string, number>} counts
 * @param {number} total
 * @param {number} cells
 * @returns {number[]} Array of category indices, one per cell
 */
function assignCells(categories, counts, total, cells) {
  // Compute exact proportional shares
  const shares = categories.map(c => ((counts.get(c) ?? 0) / total) * cells);
  const floors = shares.map(s => Math.floor(s));
  let remaining = cells - floors.reduce((a, b) => a + b, 0);

  // Distribute remaining cells by largest fractional remainder
  const remainders = shares.map((s, i) => ({ idx: i, rem: s - floors[i] }));
  remainders.sort((a, b) => b.rem - a.rem);
  for (let r = 0; r < remaining; r++) {
    floors[remainders[r].idx]++;
  }

  // Build cell array
  /** @type {number[]} */
  const result = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = 0; j < floors[i]; j++) {
      result.push(i);
    }
  }
  return result;
}

/**
 * Draw legend for waffle chart showing category, count, and percentage.
 * @param {ChartFrame} frame
 * @param {string[]} categories
 * @param {Map<string, number>} counts
 * @param {number} total
 * @param {string[]} colors
 * @param {string} [title]
 * @param {'full'|'names'|'none'} [labels]
 */
function drawWaffleLegend(frame, categories, counts, total, colors, title, labels = 'full', patterns = []) {
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

  // Position to the right of the grid
  g.attr('transform', `translate(${frame.width + 10}, ${frame.height / 2 - yOff / 2})`);

  // Background rect
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
