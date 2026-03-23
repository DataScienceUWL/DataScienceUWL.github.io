// @ts-check
/**
 * One-Proportion z-Test and Confidence Interval — StatLens
 * Supports dataset loading, paste/file input, and manual summary entry.
 */

import * as jstat from 'jstat';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { onePropZ } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import { announce, initTabs, initDataPanel, initKeyboardShortcuts, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../js/page-utils.js';
import { parseCSV } from '../../js/csv-parser.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

setJStat(jstat);

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM references ──────────────────────────────────────────────────
const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
const inputSuccessLabel = /** @type {HTMLInputElement} */ (document.getElementById('input-success-label'));
const inputP0 = /** @type {HTMLInputElement} */ (document.getElementById('input-p0'));
const inputAlt = initHypToggle('input-alternative', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});
const inputConfLevel = /** @type {HTMLInputElement} */ (document.getElementById('input-conf-level'));
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));
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
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop' || ds.type === 'one_cat',
  onDataset: (ds) => {
    const ctx = findContext(ds, 'one-prop');
    currentContext = ctx;
    if (ctx) {
      if (ctx.nullValue != null) inputP0.value = String(ctx.nullValue);
      if (ctx.alternative) inputAlt.setValue(ctx.alternative);
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

    if (dataSummary) {
      dataSummary.textContent = `Summary: n = ${currentN}, ${currentSuccessLabel} = ${currentSuccesses} (p\u0302 = ${formatStat(currentSuccesses / currentN, 0, 'proportion')})`;
    }
    dataPanel.triggerPostLoad();
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

// Note: alternative change handler is wired via initHypToggle callback above

// ── Main computation ────────────────────────────────────────────────

function compute() {
  if (currentN < 1) {
    announce('Load data or enter summary statistics first.');
    return;
  }

  const p0 = Number(inputP0.value);
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
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

  // ── Conditions checkpoint ──
  const np0 = currentN * p0;
  const nq0 = currentN * (1 - p0);
  if (conditionsCheckpoint) {
    const dsId = dataPanel.currentDatasetId;
    const linkBase = dsId
      ? { dataset: dsId }
      : { data: Array(currentSuccesses).fill(1).concat(Array(currentN - currentSuccesses).fill(0)) };
    const randLink = buildSimLink('simulate/randomization-one-prop/', {
      ...linkBase,
      params: { p: p0, direction: alternative },
    });
    const bootLink = buildSimLink('simulate/bootstrap-prop/', linkBase);
    conditionsCheckpoint.innerHTML = `
      <p><strong>Before interpreting:</strong> Have you checked the conditions for the one-proportion z-test?
      Verify: np\u2080 = ${formatStat(np0, 0, 'stat')} and n(1\u2212p\u2080) = ${formatStat(nq0, 0, 'stat')} (both should be \u2265 10).</p>
      <p>Alternatives: <a href="${randLink}">Randomization Test</a> | <a href="${bootLink}">Bootstrap CI</a> (no conditions required).</p>`;
    conditionsCheckpoint.hidden = false;
  }

  // ── Run test ──
  const result = onePropZ(currentSuccesses, currentN, { p0, alternative, confLevel });

  // ── Display results ──
  displayResults(result, currentSuccessLabel);

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
 */
function displayResults(r, successLabel) {
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentN });
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

  // z* for CI
  const zStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  const testFormula = tex(`\\begin{aligned}
    z &= \\frac{\\hat{p} - p_0}{\\sqrt{\\dfrac{p_0(1-p_0)}{n}}} \\\\[10pt]
    &= \\frac{${V}{${formatStat(r.pHat, 0, 'proportion')}} - ${V}{${formatStat(r.p0, 0, 'proportion')}}}{\\sqrt{\\dfrac{${V}{${formatStat(r.p0, 0, 'proportion')}} \\cdot ${V}{${formatStat(1 - r.p0, 0, 'proportion')}}}{${V}{${r.n}}}}} \\\\[10pt]
    &= ${S}{${formatStat(r.zStat, 0, 'correlation')}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &\\hat{p} \\pm z^* \\cdot \\sqrt{\\frac{\\hat{p}(1-\\hat{p})}{n}} \\\\[8pt]
    &${V}{${formatStat(r.pHat, 0, 'proportion')}} \\pm ${V}{${zStar}} \\cdot ${V}{${formatStat(r.se, 0, 'proportion')}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, 0, 'proportion')},\\; ${formatStat(r.ciUpper, 0, 'proportion')})}
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
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${formatStat(r.pValue, 0, 'pvalue')}}`)}</p>
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
    addInferenceAnnotations(chart, {
      statValue: Math.abs(r.zStat),
      statLabel: 'z',
      pValue: r.pValue,
      pdfFn,
      tail,
      statValueNeg: tail === 'both' ? -Math.abs(r.zStat) : undefined,
    });
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
