// @ts-check
/**
 * One-Sample t-Test page controller.
 * Computes a one-sample t-test and CI, displays results and a
 * t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { oneMeanT, oneMeanTSummary } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { initTabs, initDataPanel, announce } from '../../js/page-utils.js';
import { parseCSV } from '../../js/csv-parser.js';
import { formatStat, detectPrecision } from '../../js/stats.js';
import * as d3Selection from 'd3-selection';

// ── Initialize jStat before anything else ──────────────────────────
const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartSection = /** @type {HTMLElement} */ (document.getElementById('chart'));
const resultsSection = /** @type {HTMLElement} */ (document.getElementById('results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const interpretationDiv = /** @type {HTMLElement} */ (document.getElementById('interpretation'));

const inputMu0 = /** @type {HTMLInputElement} */ (document.getElementById('input-mu0'));
const inputAlt = /** @type {HTMLSelectElement} */ (document.getElementById('input-alt'));
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));

// Result cells
const resN = /** @type {HTMLElement} */ (document.getElementById('res-n'));
const resXbar = /** @type {HTMLElement} */ (document.getElementById('res-xbar'));
const resS = /** @type {HTMLElement} */ (document.getElementById('res-s'));
const resSE = /** @type {HTMLElement} */ (document.getElementById('res-se'));
const resT = /** @type {HTMLElement} */ (document.getElementById('res-t'));
const resDf = /** @type {HTMLElement} */ (document.getElementById('res-df'));
const resP = /** @type {HTMLElement} */ (document.getElementById('res-p'));
const resLevel = /** @type {HTMLElement} */ (document.getElementById('res-level'));
const resCILower = /** @type {HTMLElement} */ (document.getElementById('res-ci-lower'));
const resCIUpper = /** @type {HTMLElement} */ (document.getElementById('res-ci-upper'));

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentData = null;

/** @type {Array<{headers: string[], types: string[], data: Array<Record<string,any>>}> | null} */
let parsedDataset = null;

// Summary-input state
let fromSummary = false;
let summaryXbar = 0;
let summaryS = 0;
let summaryN = 0;

// ── Keyboard help dialog ───────────────────────────────────────────
const helpDialog = /** @type {HTMLDialogElement|null} */ (
  document.getElementById('keyboard-help'));
if (helpDialog) {
  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });
}

// ── Tabs ───────────────────────────────────────────────────────────
initTabs();

// ── Data Panel ─────────────────────────────────────────────────────

/**
 * Process a loaded dataset object (from JSON).
 * @param {any} ds - Dataset JSON with .variables and .rows
 * @param {any} meta - Dataset metadata
 */
function handleDataset(ds, meta) {
  if (!ds.variables || !ds.rows) {
    announce('Dataset has no usable data.');
    return;
  }

  // Find numeric columns
  const numericCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);

  if (numericCols.length === 0) {
    announce('No numeric variables found in this dataset.');
    return;
  }

  // Show variable selector if multiple numeric columns
  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  // Store rows for variable switching
  const rows = ds.rows;
  const loadColumn = (/** @type {string} */ col) => {
    const values = rows
      .map(/** @param {any} r */ r => r[col])
      .filter(/** @param {any} v */ v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Variable "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    showResults();
    announce(`Loaded ${values.length} values from "${col}".`);
  };

  loadColumn(numericCols[0]);

  // Wire variable selector
  varSelect.onchange = () => loadColumn(varSelect.value);
}

/**
 * Process parsed CSV text data.
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (numericCols.length === 0) {
    announce('No numeric columns found in pasted data.');
    return;
  }

  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  const loadColumn = (/** @type {string} */ col) => {
    const values = parsed.data
      .map(r => r[col])
      .filter(v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Column "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    showResults();
    announce(`Loaded ${values.length} values from "${sourceName}".`);
  };

  loadColumn(numericCols[0]);
  varSelect.onchange = () => loadColumn(varSelect.value);
}

initDataPanel({
  datasetFilter: ds => ds.hasNumeric !== false,
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentData = null;
    fromSummary = false;
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartSection.hidden = true;
    resultsSection.hidden = true;
    interpretationDiv.hidden = true;
    chartContainer.innerHTML = '';
  },
});

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const xbarInput = /** @type {HTMLInputElement} */ (document.getElementById('input-xbar'));
    const sInput = /** @type {HTMLInputElement} */ (document.getElementById('input-s'));
    const nInput = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));

    const xbar = parseFloat(xbarInput?.value);
    const s = parseFloat(sInput?.value);
    const n = parseInt(nInput?.value, 10);

    if (!isFinite(xbar)) { announce('Enter a valid sample mean.'); return; }
    if (!isFinite(s) || s <= 0) { announce('Enter a valid positive standard deviation.'); return; }
    if (!isFinite(n) || n < 2) { announce('Sample size must be at least 2.'); return; }

    fromSummary = true;
    summaryXbar = xbar;
    summaryS = s;
    summaryN = n;
    currentData = null;
    varSelector.hidden = true;
    showResults();
    announce(`Loaded summary statistics: x̄ = ${xbar}, s = ${s}, n = ${n}.`);
  });
}

// ── Null value mirror (auto-fill Hₐ display) ─────────────────────
const nullDisplay = document.getElementById('null-display');
function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputMu0.value || '0';
}
inputMu0.addEventListener('input', syncNullDisplay);
syncNullDisplay();

// ── Parameter change listeners ─────────────────────────────────────
inputMu0.addEventListener('input', () => { if (currentData || fromSummary) showResults(); });
inputAlt.addEventListener('change', () => { if (currentData || fromSummary) showResults(); });
inputConf.addEventListener('input', () => { if (currentData || fromSummary) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  if (!currentData && !fromSummary) return;
  if (currentData && currentData.length < 2) return;

  const mu0 = Number(inputMu0.value) || 0;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  // Compute
  const result = fromSummary
    ? oneMeanTSummary(summaryXbar, summaryS, summaryN, { mu0, alternative, confLevel })
    : oneMeanT(currentData, { mu0, alternative, confLevel });

  // Detect precision for formatting
  const d = fromSummary
    ? Math.max(detectPrecision([summaryXbar]), detectPrecision([summaryS]))
    : detectPrecision(currentData);

  // Show sections
  controlsSection.hidden = false;
  chartSection.hidden = false;
  resultsSection.hidden = false;
  interpretationDiv.hidden = false;

  // Populate results
  resN.textContent = String(result.n);
  resXbar.textContent = formatStat(result.xbar, d);
  resS.textContent = formatStat(result.s, d);
  resSE.textContent = formatStat(result.se, d);
  resT.textContent = result.tStat.toFixed(4);
  resDf.textContent = String(result.df);
  resP.textContent = formatStat(result.pValue, d, 'pvalue');
  resLevel.textContent = (result.confLevel * 100).toFixed(0) + '%';
  resCILower.textContent = formatStat(result.ciLower, d);
  resCIUpper.textContent = formatStat(result.ciUpper, d);

  // Draw chart
  drawChart(result);

  // Plain language interpretation
  writeInterpretation(result, d);

  // Screen reader announcement
  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Draw the t-distribution curve with shaded p-value region and t-statistic marker.
 * @param {import('../../js/inference.js').OneMeanResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { tStat, df, alternative } = result;
  const pdfFn = (/** @type {number} */ x) => pdfT(x, df);
  const domain = computeDomain('t', { df });

  // Determine shading parameters
  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue;
  /** @type {number|undefined} */
  let critLow;
  /** @type {number|undefined} */
  let critHigh;

  if (alternative === 'less') {
    tail = 'left';
    critValue = tStat;
  } else if (alternative === 'greater') {
    tail = 'right';
    critValue = tStat;
  } else {
    // two-sided: shade both tails at |t|
    tail = 'both';
    critLow = -Math.abs(tStat);
    critHigh = Math.abs(tStat);
  }

  const titleText = `t distribution (df = ${df})`;
  const descText = `t-distribution curve with df = ${df}, shaded region showing p-value area`;

  const { xScale, yScale, frame } = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'one-mean-t-chart',
    tail,
    critValue,
    critLow,
    critHigh,
  });

  // Add vertical line at the test statistic
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const tX = xScale(tStat);
  const yTop = yScale(pdfFn(tStat));

  // Only draw marker if t-stat is within visible domain
  if (tStat >= domain[0] && tStat <= domain[1]) {
    overlays.append('line')
      .attr('class', 't-stat-line')
      .attr('x1', tX)
      .attr('x2', tX)
      .attr('y1', yScale(0))
      .attr('y2', yTop)
      .attr('stroke', '#F05133')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3');

    // Label
    const labelY = Math.max(yTop - 12, 4);
    overlays.append('text')
      .attr('class', 't-stat-label')
      .attr('x', tX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('fill', '#F05133')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text(`t = ${tStat.toFixed(3)}`);
  }
}

/**
 * Write the plain-language interpretation.
 * @param {import('../../js/inference.js').OneMeanResult} result
 * @param {number} d - Decimal precision from source data
 */
function writeInterpretation(result, d) {
  const { xbar, mu0, tStat, pValue, se, confLevel, ciLower, ciUpper, alternative, n } = result;

  const direction = tStat >= 0 ? 'above' : 'below';
  const seCount = Math.abs(tStat).toFixed(2);

  const pPct = pValue < 0.0001
    ? 'less than 0.01%'
    : (pValue * 100).toFixed(2) + '%';

  const levelPct = (confLevel * 100).toFixed(0);

  // Hypothesis symbols
  let haSymbol;
  if (alternative === 'less') haSymbol = '<';
  else if (alternative === 'greater') haSymbol = '>';
  else haSymbol = '\u2260';

  interpretationDiv.innerHTML = `
    <p><strong>Hypotheses:</strong>
      H<sub>0</sub>: &mu; = ${mu0} vs.
      H<sub>a</sub>: &mu; ${haSymbol} ${mu0}</p>
    <p>The sample mean x&#772; = ${formatStat(xbar, d)} is ${seCount} standard errors
      ${direction} the null value &mu;<sub>0</sub> = ${mu0}
      (based on n = ${n}, SE = ${formatStat(se, d)}).</p>
    <p>If the true mean were ${mu0}, we would see a result this extreme
      about ${pPct} of the time (p = ${formatStat(pValue, d, 'pvalue')}).</p>
    <p>The ${levelPct}% confidence interval for &mu; is
      (${formatStat(ciLower, d)}, ${formatStat(ciUpper, d)}).</p>
  `;
}
