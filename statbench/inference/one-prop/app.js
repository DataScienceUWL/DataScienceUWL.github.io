// @ts-check
/**
 * One-Proportion z-Test and Confidence Interval — StatBench
 * Supports dataset loading, paste/file input, and manual summary entry.
 */

import * as jstat from 'jstat';
import * as d3Selection from 'd3-selection';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { onePropZ } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import { announce, initTabs, initDataPanel, initKeyboardShortcuts, getActiveTabId, getTabHintText, buildSimLink } from '../../js/page-utils.js';
import { parseCSV } from '../../js/csv-parser.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

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
const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const variableSelector = document.getElementById('variable-selector');
const varSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('var-select'));
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement|null} */ (document.getElementById('success-outcome'));
const loadSummaryBtn = document.getElementById('load-summary');

initTabs({ hintTarget: resultsPanel, hintAction: 'click Compute' });
initKeyboardShortcuts();

// ── State ───────────────────────────────────────────────────────────
/** @type {string[]} Raw categorical values from loaded data */
let rawValues = [];
/** Currently loaded successes count */
let currentSuccesses = 0;
/** Currently loaded sample size */
let currentN = 0;
/** Success label */
let currentSuccessLabel = '';
/** Whether data was loaded from a dataset/paste/file (vs. summary) */
let fromRawData = false;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

// ── Data loading ────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop' || ds.type === 'one_cat',
  onDataset: (ds) => {
    const ctx = findContext(ds, 'one-prop');
    currentContext = ctx;
    if (ctx) {
      if (ctx.nullValue != null) inputP0.value = String(ctx.nullValue);
      if (ctx.alternative) inputAlt.value = ctx.alternative;
      syncNullDisplay();
    }
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length === 0) {
      announce('This dataset has no categorical variables.');
      return;
    }

    // If multiple categorical variables, show variable selector
    if (catVars.length > 1 && varSelect && variableSelector) {
      varSelect.innerHTML = '';
      for (const v of catVars) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.label || v.name;
        varSelect.appendChild(opt);
      }
      variableSelector.hidden = false;
      varSelect.addEventListener('change', () => {
        rawValues = ds.rows.map(/** @param {any} r */ r => String(r[varSelect.value]));
        showSuccessSelector(rawValues, ds.name);
      });
    } else {
      if (variableSelector) variableSelector.hidden = true;
    }

    const varName = catVars[0].name;
    rawValues = ds.rows.map(/** @param {any} r */ r => String(r[varName]));
    showSuccessSelector(rawValues, ds.name);
  },
  onText: (parsed, sourceName) => {
    currentContext = null;
    // Find first categorical column
    const catIdx = parsed.types.findIndex(t => t === 'categorical');
    if (catIdx < 0) {
      announce('No categorical column found in the data.');
      return;
    }
    const colName = parsed.headers[catIdx];
    rawValues = parsed.data.map(row => String(row[colName]));
    if (variableSelector) variableSelector.hidden = true;
    showSuccessSelector(rawValues, sourceName);
  },
  onClear: () => {
    rawValues = [];
    currentSuccesses = 0;
    currentN = 0;
    fromRawData = false;
    currentContext = null;
    if (dataPreview) dataPreview.hidden = true;
    if (successSelector) successSelector.hidden = true;
    if (variableSelector) variableSelector.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'click Compute')}</p>`;
    resultBanner.innerHTML = '';
    announce('Data cleared.');
  },
});

/**
 * Show the success outcome selector and auto-count.
 * @param {string[]} values
 * @param {string} sourceName
 */
function showSuccessSelector(values, sourceName) {
  const categories = [...new Set(values)];
  fromRawData = true;

  if (successOutcome && successSelector) {
    successOutcome.innerHTML = '';
    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      successOutcome.appendChild(opt);
    }
    successSelector.hidden = false;

    // Auto-select and count
    const selectedSuccess = categories[0];
    countAndLoad(values, selectedSuccess, sourceName);

    successOutcome.addEventListener('change', () => {
      countAndLoad(values, successOutcome.value, sourceName);
    });
  }
}

/**
 * Count successes from raw data and update the UI.
 * @param {string[]} values
 * @param {string} successValue
 * @param {string} sourceName
 */
function countAndLoad(values, successValue, sourceName) {
  currentN = values.length;
  currentSuccesses = values.filter(v => v === successValue).length;
  currentSuccessLabel = successValue;

  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    dataSummary.textContent = `${sourceName}: n = ${currentN}, ${successValue} = ${currentSuccesses} (p\u0302 = ${formatStat(currentSuccesses / currentN, 0, 'proportion')})`;
  }

  announce(`Loaded ${currentN} observations. ${currentSuccesses} "${successValue}" (p\u0302 = ${formatStat(currentSuccesses / currentN, 0, 'proportion')}).`);
}

// ── Summary input ───────────────────────────────────────────────────

if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const successes = Math.round(Number(inputSuccesses.value));
    const n = Math.round(Number(inputN.value));
    if (!Number.isFinite(n) || n < 1) {
      announce('Sample size must be at least 1.');
      return;
    }
    if (!Number.isFinite(successes) || successes < 0 || successes > n) {
      announce('Successes must be between 0 and n.');
      return;
    }
    currentSuccesses = successes;
    currentN = n;
    currentSuccessLabel = inputSuccessLabel.value.trim() || 'successes';
    fromRawData = false;

    if (dataPreview) dataPreview.hidden = false;
    if (dataSummary) {
      dataSummary.textContent = `Summary: n = ${currentN}, ${currentSuccessLabel} = ${currentSuccesses} (p\u0302 = ${formatStat(currentSuccesses / currentN, 0, 'proportion')})`;
    }
    announce(`Loaded summary: n = ${n}, successes = ${successes}.`);
  });
}

// ── Null value mirror (auto-fill Hₐ display) ─────────────────────
const nullDisplay = document.getElementById('null-display');
function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputP0.value || '0.5';
}
inputP0.addEventListener('input', syncNullDisplay);
syncNullDisplay();

// ── Event listeners ─────────────────────────────────────────────────
computeBtn.addEventListener('click', compute);

for (const el of [inputP0, inputConfLevel]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); compute(); }
  });
}

// Recompute when alternative changes (if results are already showing)
inputAlt.addEventListener('change', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});

// ── Main computation ────────────────────────────────────────────────

function compute() {
  if (currentN < 1) {
    announce('Load data or enter summary statistics first.');
    return;
  }

  const p0 = Number(inputP0.value);
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Number(inputConfLevel.value);

  // ── Validate ──
  if (!Number.isFinite(p0) || p0 <= 0 || p0 >= 1) {
    announce('Null proportion must be between 0 and 1 (exclusive).');
    return;
  }
  if (!Number.isFinite(confLevel) || confLevel <= 0 || confLevel >= 1) {
    announce('Confidence level must be between 0 and 1 (exclusive).');
    return;
  }

  // ── Check conditions ──
  const np0 = currentN * p0;
  const nq0 = currentN * (1 - p0);
  const conditionsMet = np0 >= 10 && nq0 >= 10;
  conditionsWarning.hidden = conditionsMet;
  if (!conditionsMet) {
    const dsId = dataPanel.currentDatasetId;
    const linkBase = dsId
      ? { dataset: dsId }
      : { data: Array(currentSuccesses).fill(1).concat(Array(currentN - currentSuccesses).fill(0)) };
    const randLink = buildSimLink('simulate/randomization-one-prop/', {
      ...linkBase,
      params: { p: p0, direction: alternative },
    });
    const bootLink = buildSimLink('simulate/bootstrap-prop/', linkBase);
    conditionsWarning.innerHTML = `<p><strong>Warning:</strong> Normal approximation conditions not met
      (np\u2080 = ${formatStat(np0, 0, 'stat')}, n(1\u2212p\u2080) = ${formatStat(nq0, 0, 'stat')}; both should be \u2265 10).</p>
      <p>Consider the <a href="${randLink}">Randomization Test</a> or <a href="${bootLink}">Bootstrap CI</a> instead.</p>`;
  }

  // ── Run test ──
  const result = onePropZ(currentSuccesses, currentN, { p0, alternative, confLevel });

  // ── Display results ──
  displayResults(result, currentSuccessLabel, conditionsMet);

  // ── Draw chart ──
  drawChart(result);

  // ── Screen reader announcement ──
  const pStr = formatStat(result.pValue, 0, 'pvalue');
  announce(`z = ${formatStat(result.zStat, 0, 'correlation')}, ${pStr}. ${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, 0, 'proportion')}, ${formatStat(result.ciUpper, 0, 'proportion')}).`);
}

// ── Display results ─────────────────────────────────────────────────

/**
 * @param {import('../../js/inference.js').OnePropResult} r
 * @param {string} successLabel
 * @param {boolean} conditionsMet
 */
function displayResults(r, successLabel, conditionsMet) {
  const altSymbol = r.alternative === 'two-sided' ? '\u2260'
    : r.alternative === 'less' ? '<' : '>';

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

  let condWarning = '';
  if (!conditionsMet) {
    const dsId2 = dataPanel.currentDatasetId;
    const lb2 = dsId2
      ? { dataset: dsId2 }
      : { data: Array(r.successes).fill(1).concat(Array(r.n - r.successes).fill(0)) };
    const bootLink = buildSimLink('simulate/bootstrap-prop/', lb2);
    const randLink = buildSimLink('simulate/randomization-one-prop/', {
      ...lb2,
      params: { p: r.p0, direction: r.alternative === 'two-sided' ? 'two-sided' : r.alternative },
    });
    condWarning = `<p class="warning-text"><strong>Caution:</strong> Normal approximation conditions not satisfied
      (np\u2080 = ${formatStat(r.n * r.p0, 0, 'stat')} and n(1\u2212p\u2080) = ${formatStat(r.n * (1 - r.p0), 0, 'stat')};
      both should be \u2265 10). These results may be unreliable.</p>
      <p class="warning-text">Try the <a href="${randLink}">Randomization Test</a> for hypothesis testing
      or <a href="${bootLink}">Bootstrap CI</a> for confidence intervals \u2014 no sample size conditions required.</p>`;
  }

  // z* for CI
  const zStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const V = '\\textcolor{#569BBD}';
  const R = '\\textcolor{#2e7d32}';

  const testFormula = tex(`\\begin{aligned}
    z &= \\frac{\\hat{p} - p_0}{\\sqrt{\\dfrac{p_0(1-p_0)}{n}}} \\\\[10pt]
    &= \\frac{${V}{${formatStat(r.pHat, 0, 'proportion')}} - ${V}{${formatStat(r.p0, 0, 'proportion')}}}{\\sqrt{\\dfrac{${V}{${formatStat(r.p0, 0, 'proportion')}} \\cdot ${V}{${formatStat(1 - r.p0, 0, 'proportion')}}}{${V}{${r.n}}}}} \\\\[10pt]
    &= ${R}{${formatStat(r.zStat, 0, 'correlation')}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &\\hat{p} \\pm z^* \\cdot \\sqrt{\\frac{\\hat{p}(1-\\hat{p})}{n}} \\\\[8pt]
    &${V}{${formatStat(r.pHat, 0, 'proportion')}} \\pm ${V}{${zStar}} \\cdot ${V}{${formatStat(r.se, 0, 'proportion')}} \\\\[8pt]
    &= ${R}{(${formatStat(r.ciLower, 0, 'proportion')},\\; ${formatStat(r.ciUpper, 0, 'proportion')})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td>${r.n}</td></tr>
        <tr><th scope="row">${escapeHTML(successLabel)}</th><td>${r.successes}</td></tr>
        <tr><th scope="row">${tex('\\hat{p}')}</th><td>${formatStat(r.pHat, 0, 'proportion')}</td></tr>
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      ${testFormula}
      <p class="formula-detail">${tex(`\\text{p-value} = ${R}{${formatStat(r.pValue, 0, 'pvalue')}}`)}</p>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      ${ciFormula}
    </div>

    <div class="interpretation">
      <p>${tex('\\hat{p}')} = ${formatStat(r.pHat, 0, 'proportion')} is ${formatStat(seCount, 0, 'correlation')} SEs ${seDirection} ${tex('p_0')} = ${formatStat(r.p0, 0, 'proportion')}.</p>
      <p><strong>Formal conclusion:</strong> ${(() => {
        const alpha = 1 - r.confLevel;
        const c = generateConclusions({
          pValue: r.pValue, alpha, alternative: r.alternative,
          testType: 'one-prop', statName: 'z',
          statValue: formatStat(r.zStat, 0, 'correlation'),
          context: { parameter: currentContext?.parameter, nullValue: r.p0, claim: currentContext?.claim },
        });
        return c.formal + (c.practical ? `</p><p><strong>Practical conclusion:</strong> ${c.practical}` : '');
      })()}</p>
      <p>${confPct}% CI: (${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')}).</p>
      ${condWarning}
    </div>
  `;

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
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
