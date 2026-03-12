// @ts-check
/**
 * Two-Proportion z-Test and Confidence Interval — StatBench
 * Parametric inference page using summary data input (successes + n for each group).
 */

import * as jstat from 'jstat';
import * as d3Selection from 'd3-selection';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { twoPropZ } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { announce } from '../../js/page-utils.js';

setJStat(jstat);

// ── DOM references ──────────────────────────────────────────────────
const inputLabel1 = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
const inputX1 = /** @type {HTMLInputElement} */ (document.getElementById('input-x1'));
const inputN1 = /** @type {HTMLInputElement} */ (document.getElementById('input-n1'));
const inputLabel2 = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));
const inputX2 = /** @type {HTMLInputElement} */ (document.getElementById('input-x2'));
const inputN2 = /** @type {HTMLInputElement} */ (document.getElementById('input-n2'));
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

// Compute on Enter in any numeric input
for (const el of [inputX1, inputN1, inputX2, inputN2, inputConfLevel]) {
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
 * Validate inputs, run the two-proportion z-test, display results, draw chart.
 */
function compute() {
  const x1 = Math.round(Number(inputX1.value));
  const n1 = Math.round(Number(inputN1.value));
  const x2 = Math.round(Number(inputX2.value));
  const n2 = Math.round(Number(inputN2.value));
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Number(inputConfLevel.value);
  const label1 = inputLabel1.value.trim() || 'Group 1';
  const label2 = inputLabel2.value.trim() || 'Group 2';

  // ── Validate ──
  if (!Number.isFinite(n1) || n1 < 1) {
    announce('Sample size n\u2081 must be at least 1.');
    return;
  }
  if (!Number.isFinite(n2) || n2 < 1) {
    announce('Sample size n\u2082 must be at least 1.');
    return;
  }
  if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) {
    announce('Successes for Group 1 must be between 0 and n\u2081.');
    return;
  }
  if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) {
    announce('Successes for Group 2 must be between 0 and n\u2082.');
    return;
  }
  if (!Number.isFinite(confLevel) || confLevel <= 0 || confLevel >= 1) {
    announce('Confidence level must be between 0 and 1 (exclusive).');
    return;
  }

  // ── Check conditions ──
  const pHat1 = x1 / n1;
  const pHat2 = x2 / n2;
  const cond1 = n1 * pHat1 >= 5;
  const cond2 = n1 * (1 - pHat1) >= 5;
  const cond3 = n2 * pHat2 >= 5;
  const cond4 = n2 * (1 - pHat2) >= 5;
  const conditionsMet = cond1 && cond2 && cond3 && cond4;
  conditionsWarning.hidden = conditionsMet;

  // ── Run test ──
  const result = twoPropZ(x1, n1, x2, n2, { alternative, confLevel });

  // ── Display results ──
  displayResults(result, label1, label2, conditionsMet);

  // ── Draw chart ──
  drawChart(result);

  // ── Screen reader announcement ──
  const pStr = formatStat(result.pValue, 0, 'pvalue');
  announce(`z = ${formatStat(result.zStat, 0, 'correlation')}, ${pStr}. ${(confLevel * 100).toFixed(0)}% CI for p\u2081 \u2212 p\u2082: (${formatStat(result.ciLower, 0, 'proportion')}, ${formatStat(result.ciUpper, 0, 'proportion')}).`);
}

// ── Display results ─────────────────────────────────────────────────

/**
 * Render results in the sidebar panel.
 * @param {import('../../js/inference.js').TwoPropResult} r
 * @param {string} label1
 * @param {string} label2
 * @param {boolean} conditionsMet
 */
function displayResults(r, label1, label2, conditionsMet) {
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
    `<p class="warning-text"><strong>Caution:</strong> Normal approximation conditions are not satisfied. Each group needs at least 5 successes and 5 failures. Results may be unreliable.</p>`;

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <thead>
        <tr><th></th><th scope="col">${escapeHTML(label1)}</th><th scope="col">${escapeHTML(label2)}</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Successes</th><td>${Math.round(r.pHat1 * r.n1)}</td><td>${Math.round(r.pHat2 * r.n2)}</td></tr>
        <tr><th scope="row">n</th><td>${r.n1}</td><td>${r.n2}</td></tr>
        <tr><th scope="row">p\u0302</th><td>${formatStat(r.pHat1, 0, 'proportion')}</td><td>${formatStat(r.pHat2, 0, 'proportion')}</td></tr>
      </tbody>
    </table>

    <h3>Hypothesis Test</h3>
    <p class="hypothesis-statement">H\u2080: p\u2081 \u2212 p\u2082 = 0<br>
       H\u2090: p\u2081 \u2212 p\u2082 ${altSymbol} 0</p>
    <table class="results-table" aria-label="Test results">
      <tbody>
        <tr><th scope="row">p\u0302\u2081 \u2212 p\u0302\u2082</th><td>${formatStat(r.diff, 0, 'proportion')}</td></tr>
        <tr><th scope="row">Pooled p\u0302</th><td>${formatStat(r.pooledP, 0, 'proportion')}</td></tr>
        <tr><th scope="row">SE (pooled)</th><td>${formatStat(r.sePooled, 0, 'proportion')}</td></tr>
        <tr><th scope="row">z-statistic</th><td>${formatStat(r.zStat, 0, 'correlation')}</td></tr>
        <tr><th scope="row">p-value</th><td>${formatStat(r.pValue, 0, 'pvalue')}</td></tr>
      </tbody>
    </table>

    <h3>${confPct}% Confidence Interval</h3>
    <table class="results-table" aria-label="Confidence interval">
      <tbody>
        <tr><th scope="row">SE (unpooled)</th><td>${formatStat(r.se, 0, 'proportion')}</td></tr>
        <tr><th scope="row">CI for p\u2081 \u2212 p\u2082</th><td>(${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')})</td></tr>
      </tbody>
    </table>

    <h3>Interpretation</h3>
    <div class="interpretation">
      <p>The difference in sample proportions p\u0302\u2081 \u2212 p\u0302\u2082 = ${formatStat(r.diff, 0, 'proportion')} is ${formatStat(seCount, 0, 'correlation')} standard errors ${seDirection} 0.</p>
      <p><strong>p-value = ${formatStat(r.pValue, 0, 'pvalue')}:</strong> ${pInterpretation}. There is ${pInterpretation.replace('H\u2080', 'the null hypothesis that the two population proportions are equal')}.</p>
      <p>We are ${confPct}% confident that the true difference in population proportions (p\u2081 \u2212 p\u2082) is between ${formatStat(r.ciLower, 0, 'proportion')} and ${formatStat(r.ciUpper, 0, 'proportion')}.</p>
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
 * @param {import('../../js/inference.js').TwoPropResult} r
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
