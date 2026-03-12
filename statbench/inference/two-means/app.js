// @ts-check
/**
 * Two-Sample t-Test (Welch's) page for StatBench.
 * Computes test statistic, p-value, and confidence interval for the
 * difference in means between two independent groups.
 */

import * as jstatModule from 'jstat';
import { setJStat, pdfT } from '../../js/distributions.js';
import { twoMeanT, twoMeanTSummary } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { initTabs, initDataPanel, announce } from '../../js/page-utils.js';
import { mean, detectPrecision, formatStat } from '../../js/stats.js';

// ── Initialize jStat ────────────────────────────────────────────────
const jStat = jstatModule.default || jstatModule;
setJStat(jStat);

// ── DOM elements ────────────────────────────────────────────────────
const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const varSelectorsDiv = document.getElementById('var-selectors');
const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const responseVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('response-var-select'));

// ── State ───────────────────────────────────────────────────────────
/** @type {number[]} */
let group1 = [];
/** @type {number[]} */
let group2 = [];
let group1Name = 'Group 1';
let group2Name = 'Group 2';
let dataPrecision = 1;

/** Cached parsed data for variable re-selection. @type {{ headers: string[], types: string[], data: Array<Record<string,any>> } | null} */
let parsedCache = null;

// Summary-input state
let fromSummary = false;
/** @type {import('../../js/inference.js').TwoMeanResult | null} */
let summaryResult = null;

// ── Initialization ──────────────────────────────────────────────────
initTabs();
initKeyboard();

initDataPanel({
  datasetFilter: ds => ds.hasNumeric && ds.hasCategorical,
  onDataset: loadFromDataset,
  onText: loadFromParsed,
  onClear: clearData,
});

// Listen for parameter changes
const altSelect = /** @type {HTMLSelectElement} */ (document.getElementById('input-alt'));
altSelect?.addEventListener('change', runAnalysis);
const confSelect = /** @type {HTMLSelectElement} */ (document.getElementById('conf-level'));
confSelect?.addEventListener('change', runAnalysis);

// Variable selector changes
groupVarSelect?.addEventListener('change', reExtractGroups);
responseVarSelect?.addEventListener('change', reExtractGroups);

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const xbar1 = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-xbar1'))?.value);
    const s1 = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-s1'))?.value);
    const n1 = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('input-n1'))?.value, 10);
    const xbar2 = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-xbar2'))?.value);
    const s2 = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-s2'))?.value);
    const n2 = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('input-n2'))?.value, 10);

    if (!isFinite(xbar1)) { announce('Enter a valid mean for Group 1.'); return; }
    if (!isFinite(s1) || s1 <= 0) { announce('Enter a valid positive SD for Group 1.'); return; }
    if (!isFinite(n1) || n1 < 2) { announce('Group 1 sample size must be at least 2.'); return; }
    if (!isFinite(xbar2)) { announce('Enter a valid mean for Group 2.'); return; }
    if (!isFinite(s2) || s2 <= 0) { announce('Enter a valid positive SD for Group 2.'); return; }
    if (!isFinite(n2) || n2 < 2) { announce('Group 2 sample size must be at least 2.'); return; }

    const label1El = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
    const label2El = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));
    group1Name = label1El?.value?.trim() || 'Group 1';
    group2Name = label2El?.value?.trim() || 'Group 2';

    fromSummary = true;
    group1 = [];
    group2 = [];
    parsedCache = null;
    if (varSelectorsDiv) varSelectorsDiv.hidden = true;
    if (dataPreview) dataPreview.hidden = true;

    dataPrecision = Math.max(
      ...([xbar1, s1, xbar2, s2].map(v => {
        const str = String(v);
        const dot = str.indexOf('.');
        return dot === -1 ? 0 : str.length - dot - 1;
      }))
    );

    // Store summary values for re-analysis on parameter change
    summaryResult = { xbar1, s1, n1, xbar2, s2, n2 };
    runAnalysis();
    announce(`Loaded summary: ${group1Name} (n=${n1}, x̄=${xbar1}) vs ${group2Name} (n=${n2}, x̄=${xbar2}).`);
  });
}

// ── Data loading ────────────────────────────────────────────────────

/**
 * Load data from a bundled dataset JSON.
 * @param {any} ds - Dataset object with .rows and .variables
 * @param {any} _meta - Dataset metadata (unused)
 */
function loadFromDataset(ds, _meta) {
  if (!ds.rows || !ds.variables) return;

  const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
  const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');

  if (catVars.length === 0 || numVars.length === 0) {
    announce('This dataset needs at least one categorical and one numeric variable.');
    return;
  }

  // Convert to parsed-style for unified extraction
  const headers = ds.variables.map(/** @param {any} v */ v => v.name);
  const types = ds.variables.map(/** @param {any} v */ v => v.type);
  parsedCache = { headers, types, data: ds.rows };

  showVarSelectors(catVars.map(/** @param {any} v */ v => v.name),
                   numVars.map(/** @param {any} v */ v => v.name));
  extractGroups();
}

/**
 * Load data from parsed CSV/TSV text.
 * @param {{ headers: string[], types: string[], data: Array<Record<string,any>> }} parsed
 * @param {string} _sourceName
 */
function loadFromParsed(parsed, _sourceName) {
  const catCols = parsed.headers.filter((_, i) => parsed.types[i] === 'categorical');
  const numCols = parsed.headers.filter((_, i) => parsed.types[i] === 'numeric');

  if (catCols.length === 0 || numCols.length === 0) {
    announce('Data needs at least one categorical column (groups) and one numeric column (values).');
    return;
  }

  parsedCache = parsed;
  showVarSelectors(catCols, numCols);
  extractGroups();
}

/**
 * Show or update the variable selector dropdowns.
 * @param {string[]} catCols
 * @param {string[]} numCols
 */
function showVarSelectors(catCols, numCols) {
  if (!varSelectorsDiv || !groupVarSelect || !responseVarSelect) return;

  // Only show selectors if there are multiple options
  const needSelector = catCols.length > 1 || numCols.length > 1;

  groupVarSelect.innerHTML = '';
  for (const col of catCols) {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = col;
    groupVarSelect.appendChild(opt);
  }

  responseVarSelect.innerHTML = '';
  for (const col of numCols) {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = col;
    responseVarSelect.appendChild(opt);
  }

  varSelectorsDiv.hidden = !needSelector;
}

/** Re-extract groups when variable selection changes. */
function reExtractGroups() {
  extractGroups();
}

/** Extract two groups from cached parsed data using current variable selections. */
function extractGroups() {
  if (!parsedCache || !groupVarSelect || !responseVarSelect) return;

  const groupCol = groupVarSelect.value;
  const valCol = responseVarSelect.value;

  if (!groupCol || !valCol) return;

  const groups = [...new Set(parsedCache.data.map(r => r[groupCol]))];
  if (groups.length < 2) {
    announce('The grouping variable must have at least two levels.');
    return;
  }

  group1Name = String(groups[0]);
  group2Name = String(groups[1]);

  group1 = parsedCache.data
    .filter(r => r[groupCol] === groups[0])
    .map(r => parseFloat(r[valCol]))
    .filter(v => isFinite(v));

  group2 = parsedCache.data
    .filter(r => r[groupCol] === groups[1])
    .map(r => parseFloat(r[valCol]))
    .filter(v => isFinite(v));

  if (group1.length === 0 || group2.length === 0) {
    announce('One or both groups have no valid numeric values.');
    return;
  }

  dataPrecision = Math.max(detectPrecision(group1), detectPrecision(group2));
  showDataSummary();
  runAnalysis();
}

/** Display data summary above the chart. */
function showDataSummary() {
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    dataSummary.textContent =
      `${group1Name}: n = ${group1.length}, x\u0304 = ${formatStat(mean(group1), dataPrecision)} | ` +
      `${group2Name}: n = ${group2.length}, x\u0304 = ${formatStat(mean(group2), dataPrecision)}`;
  }
}

/** Clear all loaded data and reset the page. */
function clearData() {
  group1 = [];
  group2 = [];
  parsedCache = null;
  fromSummary = false;
  summaryResult = null;
  if (dataPreview) dataPreview.hidden = true;
  if (varSelectorsDiv) varSelectorsDiv.hidden = true;
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) {
    resultDiv.innerHTML = '<p class="placeholder">Load a dataset to see results.</p>';
  }
}

// ── Analysis ────────────────────────────────────────────────────────

/** Get current alternative hypothesis direction. */
function getAlternative() {
  return /** @type {'less'|'greater'|'two-sided'} */ (altSelect?.value ?? 'two-sided');
}

/** Get current confidence level. */
function getConfLevel() {
  return parseFloat(confSelect?.value ?? '0.95');
}

/** Run the two-sample t-test and update chart + results. */
function runAnalysis() {
  const alternative = getAlternative();
  const confLevel = getConfLevel();

  /** @type {import('../../js/inference.js').TwoMeanResult} */
  let result;

  if (fromSummary && summaryResult) {
    const { xbar1, s1, n1, xbar2, s2, n2 } = summaryResult;
    result = twoMeanTSummary(xbar1, s1, n1, xbar2, s2, n2, { alternative, confLevel });
  } else {
    if (group1.length === 0 || group2.length === 0) return;
    result = twoMeanT(group1, group2, { alternative, confLevel });
  }

  renderChart(result);
  renderResults(result);
  announceResult(result);
}

// ── Chart rendering ─────────────────────────────────────────────────

/**
 * Draw the t-distribution curve with shaded p-value region.
 * @param {import('../../js/inference.js').TwoMeanResult} r
 */
function renderChart(r) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  const df = r.df;
  const pdfFn = /** @param {number} x */ (x) => pdfT(x, df);
  const domain = computeDomain('t', { df });

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
    critValue = r.tStat;
  } else if (r.alternative === 'greater') {
    tail = 'right';
    critValue = r.tStat;
  } else {
    tail = 'both';
    critLow = -Math.abs(r.tStat);
    critHigh = Math.abs(r.tStat);
  }

  drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't',
    yLabel: 'Density',
    titleText: `t-distribution (df = ${r.df.toFixed(1)})`,
    descText: `Welch two-sample t-test: t = ${r.tStat.toFixed(3)}, shaded area = p-value`,
    id: 'two-means-t-curve',
    tail,
    critValue,
    critLow,
    critHigh,
  });
}

// ── Results rendering ───────────────────────────────────────────────

/**
 * Render the results panel.
 * @param {import('../../js/inference.js').TwoMeanResult} r
 */
function renderResults(r) {
  if (!resultDiv) return;

  const d = dataPrecision;
  const altSymbol = r.alternative === 'less' ? '&lt;' :
                    r.alternative === 'greater' ? '&gt;' : '&ne;';
  const confPct = (r.confLevel * 100).toFixed(0);

  // Format p-value
  const pStr = formatStat(r.pValue, d, 'pvalue');

  // Significance interpretation
  const alpha = 1 - r.confLevel;
  const sig = r.pValue < alpha;
  const sigWord = sig ? 'sufficient' : 'insufficient';
  const rejectWord = sig ? 'reject' : 'fail to reject';

  // CI interpretation
  const ciContainsZero = r.ciLower <= 0 && r.ciUpper >= 0;
  const ciInterpretation = ciContainsZero
    ? 'The confidence interval contains 0, suggesting no significant difference.'
    : 'The confidence interval does not contain 0, suggesting a significant difference.';

  resultDiv.innerHTML = `
    <h2>Results</h2>

    <h3>Group Summaries</h3>
    <table class="result-table" aria-label="Group summary statistics">
      <thead>
        <tr><th>Group</th><th>n</th><th>x&#772;</th><th>s</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(group1Name)}</td>
          <td>${r.n1}</td>
          <td>${formatStat(r.xbar1, d)}</td>
          <td>${formatStat(r.s1, d)}</td>
        </tr>
        <tr>
          <td>${esc(group2Name)}</td>
          <td>${r.n2}</td>
          <td>${formatStat(r.xbar2, d)}</td>
          <td>${formatStat(r.s2, d)}</td>
        </tr>
      </tbody>
    </table>

    <h3>Hypothesis Test</h3>
    <p class="hypothesis-display-inline">
      H<sub>0</sub>: &mu;<sub>1</sub> &minus; &mu;<sub>2</sub> = 0 &nbsp;&nbsp;
      H<sub>a</sub>: &mu;<sub>1</sub> &minus; &mu;<sub>2</sub> ${altSymbol} 0
    </p>
    <table class="result-table" aria-label="Test results">
      <tbody>
        <tr><td>Difference (x&#772;<sub>1</sub> &minus; x&#772;<sub>2</sub>)</td><td>${formatStat(r.diff, d)}</td></tr>
        <tr><td>SE</td><td>${formatStat(r.se, d)}</td></tr>
        <tr><td>t-statistic</td><td>${r.tStat.toFixed(3)}</td></tr>
        <tr><td>Welch df</td><td>${r.df.toFixed(1)}</td></tr>
        <tr><td>p-value</td><td>${pStr}</td></tr>
      </tbody>
    </table>

    <h3>${confPct}% Confidence Interval for &mu;<sub>1</sub> &minus; &mu;<sub>2</sub></h3>
    <p class="ci-display">(${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)})</p>

    <h3>Interpretation</h3>
    <div class="interpretation">
      <p>The difference x&#772;<sub>${esc(group1Name)}</sub> &minus; x&#772;<sub>${esc(group2Name)}</sub> = ${formatStat(r.diff, d)} with Welch's df = ${r.df.toFixed(1)}.</p>
      <p>p-value = ${pStr}. There is ${sigWord} evidence to ${rejectWord} H<sub>0</sub> at the &alpha; = ${alpha} level.</p>
      <p>${confPct}% CI for &mu;<sub>1</sub> &minus; &mu;<sub>2</sub>: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}). ${ciInterpretation}</p>
    </div>
  `;
}

/**
 * Announce results to screen readers.
 * @param {import('../../js/inference.js').TwoMeanResult} r
 */
function announceResult(r) {
  const pStr = formatStat(r.pValue, dataPrecision, 'pvalue');
  announce(
    `Two-sample t-test: t = ${r.tStat.toFixed(3)}, df = ${r.df.toFixed(1)}, ` +
    `${pStr}. ${(r.confLevel * 100).toFixed(0)}% CI: (${formatStat(r.ciLower, dataPrecision)}, ${formatStat(r.ciUpper, dataPrecision)}).`
  );
}

// ── Keyboard shortcuts ──────────────────────────────────────────────

function initKeyboard() {
  const helpDialog = /** @type {HTMLDialogElement|null} */ (
    document.getElementById('keyboard-help'));
  if (!helpDialog) return;

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });

  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
}

// ── Utility ─────────────────────────────────────────────────────────

/**
 * Escape HTML entities in a string.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
