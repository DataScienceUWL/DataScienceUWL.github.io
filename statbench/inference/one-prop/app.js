// @ts-check
/**
 * One-Proportion z-Test and Confidence Interval — StatBench
 * Parametric inference page using summary data input (successes + n).
 */

import * as jstat from 'jstat';
import * as d3Selection from 'd3-selection';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { onePropZ } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { announce } from '../../js/page-utils.js';

setJStat(jstat);

// ── DOM references ──────────────────────────────────────────────────
const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
const inputSuccessLabel = /** @type {HTMLInputElement} */ (document.getElementById('input-success-label'));
const inputP0 = /** @type {HTMLInputElement} */ (document.getElementById('input-p0'));
const inputAlt = /** @type {HTMLSelectElement} */ (document.getElementById('input-alternative'));
const inputConfLevel = /** @type {HTMLInputElement} */ (document.getElementById('input-conf-level'));
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const conditionsWarning = /** @type {HTMLElement} */ (document.getElementById('conditions-warning'));
const resultBanner = /** @type {HTMLElement} */ (document.getElementById('result-summary'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));

// ── Keyboard shortcut for help dialog ───────────────────────────────
const helpDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('keyboard-help'));
if (helpDialog) {
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });
  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
}

// ── Event listeners ─────────────────────────────────────────────────
computeBtn.addEventListener('click', compute);

// Compute on Enter in any input field
for (const el of [inputSuccesses, inputN, inputP0, inputConfLevel]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); compute(); }
  });
}

// Recompute when alternative changes (if results are already showing)
inputAlt.addEventListener('change', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});

// ── Main computation ────────────────────────────────────────────────

/**
 * Validate inputs, run the one-proportion z-test, display results, draw chart.
 */
function compute() {
  const successes = Math.round(Number(inputSuccesses.value));
  const n = Math.round(Number(inputN.value));
  const p0 = Number(inputP0.value);
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Number(inputConfLevel.value);
  const successLabel = inputSuccessLabel.value.trim() || 'successes';

  // ── Validate ──
  if (!Number.isFinite(n) || n < 1) {
    announce('Sample size must be at least 1.');
    return;
  }
  if (!Number.isFinite(successes) || successes < 0 || successes > n) {
    announce('Successes must be between 0 and n.');
    return;
  }
  if (!Number.isFinite(p0) || p0 <= 0 || p0 >= 1) {
    announce('Null proportion must be between 0 and 1 (exclusive).');
    return;
  }
  if (!Number.isFinite(confLevel) || confLevel <= 0 || confLevel >= 1) {
    announce('Confidence level must be between 0 and 1 (exclusive).');
    return;
  }

  // ── Check conditions ──
  const np0 = n * p0;
  const nq0 = n * (1 - p0);
  const conditionsMet = np0 >= 10 && nq0 >= 10;
  conditionsWarning.hidden = conditionsMet;

  // ── Run test ──
  const result = onePropZ(successes, n, { p0, alternative, confLevel });

  // ── Display results ──
  displayResults(result, successLabel, conditionsMet);

  // ── Draw chart ──
  drawChart(result);

  // ── Screen reader announcement ──
  const pStr = formatStat(result.pValue, 0, 'pvalue');
  announce(`z = ${formatStat(result.zStat, 0, 'correlation')}, ${pStr}. ${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, 0, 'proportion')}, ${formatStat(result.ciUpper, 0, 'proportion')}).`);
}

// ── Display results ─────────────────────────────────────────────────

/**
 * Render results in the sidebar panel.
 * @param {import('../../js/inference.js').OnePropResult} r
 * @param {string} successLabel
 * @param {boolean} conditionsMet
 */
function displayResults(r, successLabel, conditionsMet) {
  const altSymbol = r.alternative === 'two-sided' ? '\u2260'
    : r.alternative === 'less' ? '<' : '>';
  const altWord = r.alternative === 'two-sided' ? 'different from'
    : r.alternative === 'less' ? 'less than' : 'greater than';

  // p-value interpretation
  let pInterpretation;
  if (r.pValue < 0.001) {
    pInterpretation = 'very strong evidence against H\u2080';
  } else if (r.pValue < 0.01) {
    pInterpretation = 'strong evidence against H\u2080';
  } else if (r.pValue < 0.05) {
    pInterpretation = 'moderate evidence against H\u2080';
  } else if (r.pValue < 0.10) {
    pInterpretation = 'weak evidence against H\u2080';
  } else {
    pInterpretation = 'little to no evidence against H\u2080';
  }

  const confPct = (r.confLevel * 100).toFixed(0);
  const seCount = Math.abs(r.zStat);
  const seDirection = r.zStat > 0 ? 'above' : r.zStat < 0 ? 'below' : 'at';

  const condWarning = conditionsMet ? '' :
    `<p class="warning-text"><strong>Caution:</strong> Normal approximation conditions are not satisfied (np\u2080 = ${formatStat(r.n * r.p0, 0, 'stat')} and n(1\u2212p\u2080) = ${formatStat(r.n * (1 - r.p0), 0, 'stat')}; both should be \u2265 10). Results may be unreliable.</p>`;

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">n</th><td>${r.n}</td></tr>
        <tr><th scope="row">${escapeHTML(successLabel)}</th><td>${r.successes}</td></tr>
        <tr><th scope="row">p\u0302</th><td>${formatStat(r.pHat, 0, 'proportion')}</td></tr>
      </tbody>
    </table>

    <h3>Hypothesis Test</h3>
    <p class="hypothesis-statement">H\u2080: p = ${formatStat(r.p0, 0, 'proportion')}<br>
       H\u2090: p ${altSymbol} ${formatStat(r.p0, 0, 'proportion')}</p>
    <table class="results-table" aria-label="Test results">
      <tbody>
        <tr><th scope="row">SE (null)</th><td>${formatStat(r.seNull, 0, 'proportion')}</td></tr>
        <tr><th scope="row">z-statistic</th><td>${formatStat(r.zStat, 0, 'correlation')}</td></tr>
        <tr><th scope="row">p-value</th><td>${formatStat(r.pValue, 0, 'pvalue')}</td></tr>
      </tbody>
    </table>

    <h3>${confPct}% Confidence Interval</h3>
    <table class="results-table" aria-label="Confidence interval">
      <tbody>
        <tr><th scope="row">SE (Wald)</th><td>${formatStat(r.se, 0, 'proportion')}</td></tr>
        <tr><th scope="row">CI</th><td>(${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')})</td></tr>
      </tbody>
    </table>

    <h3>Interpretation</h3>
    <div class="interpretation">
      <p>The sample proportion p\u0302 = ${formatStat(r.pHat, 0, 'proportion')} is ${formatStat(seCount, 0, 'correlation')} standard errors ${seDirection} the null value p\u2080 = ${formatStat(r.p0, 0, 'proportion')}.</p>
      <p><strong>p-value = ${formatStat(r.pValue, 0, 'pvalue')}:</strong> ${pInterpretation}.</p>
      <p>We are ${confPct}% confident that the true population proportion is between ${formatStat(r.ciLower, 0, 'proportion')} and ${formatStat(r.ciUpper, 0, 'proportion')}.</p>
      ${condWarning}
    </div>
  `;

  // Result banner above chart
  resultBanner.innerHTML =
    `z = ${formatStat(r.zStat, 0, 'correlation')}, ${formatStat(r.pValue, 0, 'pvalue')} &nbsp;|&nbsp; ${confPct}% CI: (${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')})`;
}

// ── Chart ───────────────────────────────────────────────────────────

/**
 * Draw the standard normal curve with z-statistic marked and p-value shaded.
 * @param {import('../../js/inference.js').OnePropResult} r
 */
function drawChart(r) {
  chartContainer.innerHTML = '';

  const domain = computeDomain('normal', { mu: 0, sigma: 1 });
  const pdfFn = (/** @type {number} */ x) => pdfNormal(x, 0, 1);

  // Determine shading based on alternative
  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue;
  /** @type {number|undefined} */
  let critLow;
  /** @type {number|undefined} */
  let critHigh;

  if (r.alternative === 'less') {
    tail = 'left';
    critValue = r.zStat;
  } else if (r.alternative === 'greater') {
    tail = 'right';
    critValue = r.zStat;
  } else {
    tail = 'both';
    critLow = -Math.abs(r.zStat);
    critHigh = Math.abs(r.zStat);
  }

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 'z',
    yLabel: 'Density',
    titleText: 'Standard Normal Distribution (z-test)',
    descText: `Standard normal curve with z = ${r.zStat.toFixed(3)} marked and p-value region shaded.`,
    id: 'z-curve',
    tail,
    critValue,
    critLow,
    critHigh,
  });

  // Mark the z-statistic with a vertical dashed line
  if (chart && isFinite(r.zStat)) {
    const { xScale, yScale, frame } = chart;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    const zX = xScale(r.zStat);
    const yTop = yScale(pdfFn(r.zStat));

    overlays.append('line')
      .attr('class', 'z-stat-line')
      .attr('x1', zX)
      .attr('x2', zX)
      .attr('y1', yScale(0))
      .attr('y2', yTop)
      .attr('stroke', '#F05133')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3');

    overlays.append('text')
      .attr('class', 'z-stat-label')
      .attr('x', zX)
      .attr('y', yTop - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', '#F05133')
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .text(`z = ${r.zStat.toFixed(3)}`);

    // For two-sided, also mark the mirror z value
    if (r.alternative === 'two-sided' && r.zStat !== 0) {
      const mirrorZ = -r.zStat;
      const mirrorX = xScale(mirrorZ);
      const mirrorYTop = yScale(pdfFn(mirrorZ));

      overlays.append('line')
        .attr('class', 'z-stat-line')
        .attr('x1', mirrorX)
        .attr('x2', mirrorX)
        .attr('y1', yScale(0))
        .attr('y2', mirrorYTop)
        .attr('stroke', '#F05133')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,3');
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS in user-provided labels.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
