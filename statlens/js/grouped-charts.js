// @ts-check
/**
 * Shared grouped-chart rendering helpers.
 * Renders stacked histograms and dotplots for numeric × categorical data.
 * Used by both explore/grouped and explore/multi (Data Explorer).
 */

import { drawHistogram, computeBins } from './histogram.js';
import { drawDotplot } from './dotplot.js';
import { getColors } from './chart-utils.js';
import { drawMeanOnHistogram, drawMeanOnDotplot } from './mean-marker.js';

/**
 * Render stacked histograms (one per group, shared x-axis and bin boundaries).
 * @param {HTMLElement} container
 * @param {Record<string, number[]>} grouped - { groupName: number[] }
 * @param {object} options
 * @param {string} options.xLabel
 * @param {number} [options.numBins] - Bin count (default: Sturges from total N)
 * @param {boolean} [options.relativeFrequency]
 * @param {boolean} [options.showMean]
 * @param {string} [options.idPrefix]
 * @param {string[]} [options.colors] - Override group colors
 * @returns {{ sharedBins: Array<{x0: any, x1: any, length: number}>, domain: [number, number], thresholds: number[] }}
 */
export function renderStackedHistograms(container, grouped, options) {
  const groupNames = Object.keys(grouped);
  const allValues = groupNames.flatMap(g => grouped[g]);
  const colors = options.colors ?? getColors(groupNames.length);
  const numBins = options.numBins ?? Math.ceil(1 + 3.322 * Math.log10(allValues.length));
  const idPrefix = options.idPrefix ?? 'grouped-hist';

  // Compute shared bin boundaries from all values
  const { bins: sharedBins } = computeBins(allValues, { numBins });
  const thresholds = /** @type {number[]} */ (sharedBins.slice(1).map(b => b.x0));
  /** @type {[number, number]} */
  const domain = [/** @type {number} */ (sharedBins[0].x0), /** @type {number} */ (sharedBins[sharedBins.length - 1].x1)];

  // Compact height: scale with max group size, clamp between 160–371
  const maxGroupN = Math.max(...groupNames.map(g => grouped[g].length));
  const compactHeight = Math.min(371, Math.max(160, 100 + maxGroupN * 4));

  for (let i = 0; i < groupNames.length; i++) {
    const name = groupNames[i];
    const values = grouped[name];
    const wrapper = document.createElement('div');

    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = `${name} (n = ${values.length})`;
    label.style.color = colors[i];
    wrapper.appendChild(label);

    const chartDiv = document.createElement('div');
    wrapper.appendChild(chartDiv);
    container.appendChild(wrapper);

    const histResult = drawHistogram(chartDiv, values, {
      xLabel: i === groupNames.length - 1 ? options.xLabel : '',
      titleText: `Histogram of ${options.xLabel} for ${name}`,
      descText: `Histogram of ${options.xLabel} for group ${name}`,
      id: `${idPrefix}-${i}`,
      animate: false,
      domain,
      thresholds,
      relativeFrequency: options.relativeFrequency,
      fillColor: colors[i],
      viewHeight: compactHeight,
    });

    if (options.showMean) {
      drawMeanOnHistogram(histResult, values);
    }
  }

  return { sharedBins, domain, thresholds };
}

/**
 * Render stacked dotplots (one per group, shared x-axis domain).
 * @param {HTMLElement} container
 * @param {Record<string, number[]>} grouped - { groupName: number[] }
 * @param {object} options
 * @param {string} options.xLabel
 * @param {number} [options.numBins]
 * @param {boolean} [options.showMean]
 * @param {string} [options.idPrefix]
 * @param {string[]} [options.colors] - Override group colors
 */
export function renderStackedDotplots(container, grouped, options) {
  const groupNames = Object.keys(grouped);
  const allValues = groupNames.flatMap(g => grouped[g]);
  const colors = options.colors ?? getColors(groupNames.length);
  const idPrefix = options.idPrefix ?? 'grouped-dot';

  const xMin = Math.min(...allValues);
  const xMax = Math.max(...allValues);
  const pad = (xMax - xMin) * 0.05 || 0.5;
  /** @type {[number, number]} */
  const domain = [xMin - pad, xMax + pad];

  // Compact height: scale with max group size, clamp between 160–371
  const maxGroupN = Math.max(...groupNames.map(g => grouped[g].length));
  const compactHeight = Math.min(371, Math.max(160, 100 + maxGroupN * 4));

  for (let i = 0; i < groupNames.length; i++) {
    const name = groupNames[i];
    const values = grouped[name];
    const wrapper = document.createElement('div');

    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = `${name} (n = ${values.length})`;
    label.style.color = colors[i];
    wrapper.appendChild(label);

    const chartDiv = document.createElement('div');
    wrapper.appendChild(chartDiv);
    container.appendChild(wrapper);

    const dotResult = drawDotplot(chartDiv, values, {
      xLabel: i === groupNames.length - 1 ? options.xLabel : '',
      titleText: `Dotplot of ${options.xLabel} for ${name}`,
      descText: `Dot plot of ${options.xLabel} for group ${name}`,
      id: `${idPrefix}-${i}`,
      animate: false,
      domain,
      fillColor: colors[i],
      viewHeight: compactHeight,
      numBins: options.numBins,
    });

    if (options.showMean) {
      drawMeanOnDotplot(dotResult, values);
    }
  }
}
