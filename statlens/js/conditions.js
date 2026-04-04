// @ts-check
/**
 * Conditions diagnostic panel for inference pages.
 *
 * Renders histogram + boxplot (primary) and optional QQ plot for normality
 * assessment. Follows textbook pedagogy: visual check for strong skewness
 * and extreme outliers, with QQ plot as enrichment toggle.
 *
 * @module conditions
 */

import { drawHistogram } from './histogram.js';
import { drawBoxplot } from './boxplot.js';
import { mean, sd, quantile } from './stats.js';

/**
 * Compute normal quantiles for a QQ plot.
 * Uses the normal approximation via the inverse probit (Rational approximation).
 * @param {number} p - probability (0 < p < 1)
 * @returns {number} z-score
 */
function qnorm(p) {
  // Rational approximation (Abramowitz & Stegun 26.2.23)
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const sign = p < 0.5 ? -1 : 1;
  const pp = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(pp));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return sign * (t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t));
}

/**
 * Render a QQ plot (normal probability plot) into a container.
 * Plots sample quantiles (sorted data) vs theoretical normal quantiles.
 *
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {object} [options]
 * @param {string} [options.xLabel] - Label for x-axis (default: "Theoretical Quantiles")
 * @param {string} [options.titleText] - Chart title
 * @param {string} [options.id] - SVG id prefix
 */
export function drawQQPlot(container, values, options = {}) {
  if (!values || values.length < 3) {
    container.innerHTML = '<p class="hint">Need at least 3 values for a QQ plot.</p>';
    return;
  }

  const {
    xLabel = 'Theoretical Quantiles',
    titleText = 'Normal QQ Plot',
    id = 'qq-plot',
  } = options;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Theoretical quantiles using plotting positions (i - 0.375) / (n + 0.25)
  const theoretical = [];
  for (let i = 0; i < n; i++) {
    theoretical.push(qnorm((i + 0.625) / (n + 0.25)));
  }

  // Build SVG
  const margin = { top: 30, right: 20, bottom: 45, left: 55 };
  const width = 300;
  const height = 280;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const tMin = Math.min(...theoretical);
  const tMax = Math.max(...theoretical);
  const tPad = (tMax - tMin) * 0.08;
  const sMin = Math.min(...sorted);
  const sMax = Math.max(...sorted);
  const sPad = (sMax - sMin) * 0.08 || 1;

  const xScale = (/** @type {number} */ v) => margin.left + ((v - (tMin - tPad)) / ((tMax + tPad) - (tMin - tPad))) * innerW;
  const yScale = (/** @type {number} */ v) => margin.top + innerH - ((v - (sMin - sPad)) / ((sMax + sPad) - (sMin - sPad))) * innerH;

  let svg = `<svg class="conditions-qq" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" aria-label="${titleText}">`;

  // Title
  svg += `<text x="${width / 2}" y="16" text-anchor="middle" font-weight="700" font-size="12" fill="#333">${titleText}</text>`;

  // Reference line (through Q1/Q3 of data and theoretical)
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  const sQ1 = sorted[q1Idx], sQ3 = sorted[q3Idx];
  const tQ1 = theoretical[q1Idx], tQ3 = theoretical[q3Idx];
  const lineSlope = (sQ3 - sQ1) / (tQ3 - tQ1 || 1);
  const lineIntercept = sQ1 - lineSlope * tQ1;
  const lineY = (/** @type {number} */ t) => lineSlope * t + lineIntercept;

  // Draw reference line across full range
  const refX1 = tMin - tPad;
  const refX2 = tMax + tPad;
  svg += `<line x1="${xScale(refX1)}" y1="${yScale(lineY(refX1))}" x2="${xScale(refX2)}" y2="${yScale(lineY(refX2))}" stroke="#F05133" stroke-width="1.5" stroke-dasharray="5,3" stroke-opacity="0.7"/>`;

  // Points
  for (let i = 0; i < n; i++) {
    const cx = xScale(theoretical[i]);
    const cy = yScale(sorted[i]);
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="#569BBD" fill-opacity="0.7" stroke="#569BBD" stroke-width="0.5"/>`;
  }

  // X axis
  svg += `<line x1="${margin.left}" x2="${margin.left + innerW}" y1="${margin.top + innerH}" y2="${margin.top + innerH}" stroke="#666" stroke-width="0.75"/>`;
  // Y axis
  svg += `<line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + innerH}" stroke="#666" stroke-width="0.75"/>`;

  // X ticks
  const xTicks = niceTicksFor(tMin - tPad, tMax + tPad, 5);
  for (const t of xTicks) {
    const tx = xScale(t);
    svg += `<line x1="${tx}" x2="${tx}" y1="${margin.top + innerH}" y2="${margin.top + innerH + 4}" stroke="#666" stroke-width="0.75"/>`;
    svg += `<text x="${tx}" y="${margin.top + innerH + 16}" text-anchor="middle" fill="#555" font-size="10">${fmtTick(t)}</text>`;
  }

  // Y ticks
  const yTicks = niceTicksFor(sMin - sPad, sMax + sPad, 5);
  for (const t of yTicks) {
    const ty = yScale(t);
    svg += `<line x1="${margin.left - 4}" x2="${margin.left}" y1="${ty}" y2="${ty}" stroke="#666" stroke-width="0.75"/>`;
    svg += `<text x="${margin.left - 7}" y="${ty + 3}" text-anchor="end" fill="#555" font-size="10">${fmtTick(t)}</text>`;
  }

  // Axis labels
  svg += `<text x="${width / 2}" y="${height - 4}" text-anchor="middle" fill="#555" font-size="11">${xLabel}</text>`;
  svg += `<text x="14" y="${margin.top + innerH / 2}" text-anchor="middle" fill="#555" font-size="11" transform="rotate(-90, 14, ${margin.top + innerH / 2})">Sample Quantiles</text>`;

  svg += '</svg>';
  container.innerHTML = svg;
}

/**
 * Generate nice tick values for an axis.
 * @param {number} lo
 * @param {number} hi
 * @param {number} approxCount
 * @returns {number[]}
 */
function niceTicksFor(lo, hi, approxCount) {
  const range = hi - lo || 1;
  const rough = range / approxCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  const nice = residual <= 1.5 ? 1 : residual <= 3.5 ? 2 : residual <= 7.5 ? 5 : 10;
  const step = nice * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.01; v += step) {
    ticks.push(Math.round(v / step) * step); // avoid floating point drift
  }
  return ticks;
}

/**
 * Format a tick value concisely.
 * @param {number} v
 * @returns {string}
 */
function fmtTick(v) {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(2);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Render a full conditions diagnostic panel with histogram, boxplot,
 * and optional QQ plot toggle.
 *
 * @param {HTMLElement} container - The #conditions-chart element
 * @param {number[]|Record<string, number[]>} data - Single array or grouped data
 * @param {object} [options]
 * @param {string} [options.varName] - Variable name for labels
 * @param {string} [options.context] - 'one-sample' | 'two-sample' | 'paired' | 'anova' | 'residuals'
 * @param {boolean} [options.showQQ] - Whether to include QQ toggle (default: true)
 */
export function renderConditionsDiagnostic(container, data, options = {}) {
  const {
    varName = '',
    context = 'one-sample',
    showQQ = true,
  } = options;

  container.innerHTML = '';

  // Determine if grouped or single
  const isGrouped = !Array.isArray(data);
  const allValues = isGrouped
    ? Object.values(/** @type {Record<string, number[]>} */ (data)).flat()
    : /** @type {number[]} */ (data);

  if (allValues.length < 2) {
    container.innerHTML = '<p class="hint">Not enough data for diagnostic plots.</p>';
    return;
  }

  const n = allValues.length;

  // Toggle bar
  const toggleBar = document.createElement('div');
  toggleBar.className = 'conditions-view-toggle';
  toggleBar.innerHTML = `
    <button type="button" class="seg-btn active" data-view="hist-box">Histogram + Boxplot</button>
    ${showQQ ? '<button type="button" class="seg-btn" data-view="qq">QQ Plot</button>' : ''}
  `;
  container.appendChild(toggleBar);

  // Sample size note
  const noteEl = document.createElement('p');
  noteEl.className = 'conditions-note';
  if (n < 30) {
    noteEl.textContent = `Small sample (n = ${n}): look carefully for strong skewness and extreme outliers.`;
  } else {
    noteEl.textContent = `Large sample (n = ${n}): CLT applies. Check mainly for extreme outliers.`;
  }
  container.appendChild(noteEl);

  // Chart container
  const chartArea = document.createElement('div');
  chartArea.className = 'conditions-charts';
  container.appendChild(chartArea);

  // Render initial view
  renderHistBox(chartArea, data, varName, context, isGrouped);

  // Wire toggle
  const btns = toggleBar.querySelectorAll('.seg-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = /** @type {HTMLElement} */ (btn).dataset.view;
      if (view === 'qq') {
        renderQQView(chartArea, data, varName, context, isGrouped);
      } else {
        renderHistBox(chartArea, data, varName, context, isGrouped);
      }
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {number[]|Record<string, number[]>} data
 * @param {string} varName
 * @param {string} context
 * @param {boolean} isGrouped
 */
function renderHistBox(container, data, varName, context, isGrouped) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'conditions-hist-box';

  // Compact margins and viewBox for conditions diagnostics
  const compactMargin = { top: 22, right: 10, bottom: 34, left: 40 };
  const compactBoxMargin = { top: 22, right: 10, bottom: 34, left: 55 };

  if (isGrouped) {
    const groups = /** @type {Record<string, number[]>} */ (data);
    // Histogram per group — side by side
    const histDiv = document.createElement('div');
    histDiv.className = 'conditions-histograms';
    for (const [name, vals] of Object.entries(groups)) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'conditions-group-hist';
      drawHistogram(groupDiv, vals, {
        xLabel: varName,
        titleText: name,
        id: `cond-hist-${name.replace(/\W/g, '')}`,
        animate: false,
        showExport: false,
        margin: compactMargin,
        viewHeight: 220,
      });
      histDiv.appendChild(groupDiv);
    }
    wrapper.appendChild(histDiv);

    // Grouped boxplot
    const boxDiv = document.createElement('div');
    boxDiv.className = 'conditions-boxplot';
    drawBoxplot(boxDiv, groups, {
      xLabel: varName,
      titleText: 'Boxplot by Group',
      id: 'cond-boxplot',
      animate: false,
      showOutliers: true,
      margin: compactBoxMargin,
    });
    wrapper.appendChild(boxDiv);
  } else {
    const vals = /** @type {number[]} */ (data);
    // Single histogram + boxplot side by side
    const histDiv = document.createElement('div');
    histDiv.className = 'conditions-single-hist';
    const label = context === 'paired' ? 'Differences' : (context === 'residuals' ? 'Residuals' : varName);
    drawHistogram(histDiv, vals, {
      xLabel: label,
      titleText: `Histogram of ${label}`,
      id: 'cond-hist',
      animate: false,
      showExport: false,
      margin: compactMargin,
      viewHeight: 220,
    });
    wrapper.appendChild(histDiv);

    // Single boxplot
    const boxDiv = document.createElement('div');
    boxDiv.className = 'conditions-single-box';
    drawBoxplot(boxDiv, vals, {
      xLabel: label,
      titleText: `Boxplot of ${label}`,
      id: 'cond-boxplot',
      animate: false,
      showOutliers: true,
      margin: compactBoxMargin,
    });
    wrapper.appendChild(boxDiv);
  }

  container.appendChild(wrapper);
}

/**
 * @param {HTMLElement} container
 * @param {number[]|Record<string, number[]>} data
 * @param {string} varName
 * @param {string} context
 * @param {boolean} isGrouped
 */
function renderQQView(container, data, varName, context, isGrouped) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'conditions-qq-view';

  if (isGrouped) {
    const groups = /** @type {Record<string, number[]>} */ (data);
    for (const [name, vals] of Object.entries(groups)) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'conditions-group-qq';
      drawQQPlot(groupDiv, vals, {
        titleText: `QQ Plot: ${name}`,
        id: `cond-qq-${name.replace(/\W/g, '')}`,
      });
      wrapper.appendChild(groupDiv);
    }
  } else {
    const vals = /** @type {number[]} */ (data);
    const label = context === 'paired' ? 'Differences' : varName;
    drawQQPlot(wrapper, vals, {
      titleText: `QQ Plot: ${label}`,
      id: 'cond-qq',
    });
  }

  // Interpretation hint
  const hint = document.createElement('p');
  hint.className = 'conditions-qq-hint';
  hint.innerHTML = 'Points near the <span style="color:#F05133">reference line</span> suggest normality. Systematic curves indicate skewness or heavy tails.';
  wrapper.appendChild(hint);

  container.appendChild(wrapper);
}
