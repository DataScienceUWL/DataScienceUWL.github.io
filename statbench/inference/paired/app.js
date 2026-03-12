// @ts-check
/**
 * Paired t-Test page controller.
 * Computes a paired t-test and CI on the differences (var1 - var2),
 * displays results and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { pairedT } from '../../js/inference.js';
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

const varSelectors = /** @type {HTMLElement} */ (document.getElementById('variable-selectors'));
const var1Select = /** @type {HTMLSelectElement} */ (document.getElementById('var1-select'));
const var2Select = /** @type {HTMLSelectElement} */ (document.getElementById('var2-select'));

// Result cells
const resN = /** @type {HTMLElement} */ (document.getElementById('res-n'));
const resDbar = /** @type {HTMLElement} */ (document.getElementById('res-dbar'));
const resSd = /** @type {HTMLElement} */ (document.getElementById('res-sd'));
const resSE = /** @type {HTMLElement} */ (document.getElementById('res-se'));
const resT = /** @type {HTMLElement} */ (document.getElementById('res-t'));
const resDf = /** @type {HTMLElement} */ (document.getElementById('res-df'));
const resP = /** @type {HTMLElement} */ (document.getElementById('res-p'));
const resLevel = /** @type {HTMLElement} */ (document.getElementById('res-level'));
const resCILower = /** @type {HTMLElement} */ (document.getElementById('res-ci-lower'));
const resCIUpper = /** @type {HTMLElement} */ (document.getElementById('res-ci-upper'));

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentDiffs = null;

/** @type {string} */
let var1Name = '';
/** @type {string} */
let var2Name = '';

/**
 * Stored dataset rows for variable switching.
 * @type {Array<Record<string, any>> | null}
 */
let currentRows = null;

/**
 * Available numeric column names from the current data source.
 * @type {string[]}
 */
let numericCols = [];

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

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Populate variable selector dropdowns with numeric column names.
 * Automatically selects the first two distinct columns.
 * @param {string[]} cols - Numeric column names
 */
function populateVarSelectors(cols) {
  numericCols = cols;

  if (cols.length < 2) {
    varSelectors.hidden = true;
    announce('Need at least 2 numeric columns for paired data.');
    return;
  }

  varSelectors.hidden = false;

  var1Select.innerHTML = '';
  var2Select.innerHTML = '';
  for (const col of cols) {
    const opt1 = document.createElement('option');
    opt1.value = col;
    opt1.textContent = col;
    var1Select.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = col;
    opt2.textContent = col;
    var2Select.appendChild(opt2);
  }

  // Default: first two columns
  var1Select.value = cols[0];
  var2Select.value = cols.length > 1 ? cols[1] : cols[0];
}

/**
 * Compute paired differences from the current rows and selected variables.
 * Updates state and triggers result display.
 */
function loadFromSelections() {
  if (!currentRows || numericCols.length < 2) return;

  const col1 = var1Select.value;
  const col2 = var2Select.value;

  if (col1 === col2) {
    announce('Please select two different variables.');
    return;
  }

  var1Name = col1;
  var2Name = col2;

  // Extract paired values, keeping only rows where both are valid numbers
  const diffs = [];
  for (const row of currentRows) {
    const v1 = Number(row[col1]);
    const v2 = Number(row[col2]);
    if (isFinite(v1) && isFinite(v2)) {
      diffs.push(v1 - v2);
    }
  }

  if (diffs.length < 2) {
    announce(`Fewer than 2 valid pairs found for "${col1}" and "${col2}".`);
    return;
  }

  currentDiffs = diffs;
  showResults();
  announce(`Loaded ${diffs.length} paired differences (${col1} \u2212 ${col2}).`);
}

// ── Data Panel ─────────────────────────────────────────────────────

/**
 * Process a loaded dataset object (from JSON).
 * @param {any} ds - Dataset JSON with .variables and .rows
 * @param {any} _meta - Dataset metadata
 */
function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) {
    announce('Dataset has no usable data.');
    return;
  }

  const cols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);

  if (cols.length < 2) {
    announce('This dataset needs at least 2 numeric variables for a paired test.');
    return;
  }

  currentRows = ds.rows;
  populateVarSelectors(cols);
  loadFromSelections();
}

/**
 * Process parsed CSV text data.
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  const cols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (cols.length < 2) {
    announce('Need at least 2 numeric columns for paired data. Found ' + cols.length + '.');
    return;
  }

  currentRows = parsed.data;
  populateVarSelectors(cols);
  loadFromSelections();
}

initDataPanel({
  datasetFilter: ds => ds.type === 'paired',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentDiffs = null;
    currentRows = null;
    numericCols = [];
    varSelectors.hidden = true;
    controlsSection.hidden = true;
    chartSection.hidden = true;
    resultsSection.hidden = true;
    interpretationDiv.hidden = true;
    chartContainer.innerHTML = '';
  },
});

// ── Variable selector change listeners ────────────────────────────
var1Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });
var2Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });

// ── Parameter change listeners ─────────────────────────────────────
inputMu0.addEventListener('input', () => { if (currentDiffs) showResults(); });
inputAlt.addEventListener('change', () => { if (currentDiffs) showResults(); });
inputConf.addEventListener('input', () => { if (currentDiffs) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  if (!currentDiffs || currentDiffs.length < 2) return;

  const mu0 = Number(inputMu0.value) || 0;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  // Compute
  const result = pairedT(currentDiffs, { mu0, alternative, confLevel });

  // Detect precision for formatting
  const d = detectPrecision(currentDiffs);

  // Show sections
  controlsSection.hidden = false;
  chartSection.hidden = false;
  resultsSection.hidden = false;
  interpretationDiv.hidden = false;

  // Populate results
  resN.textContent = String(result.n);
  resDbar.textContent = formatStat(result.dbar, d);
  resSd.textContent = formatStat(result.sd, d);
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
  writeInterpretation(result, d, mu0);

  // Screen reader announcement
  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Draw the t-distribution curve with shaded p-value region and t-statistic marker.
 * @param {import('../../js/inference.js').PairedResult} result
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
  const descText = `t-distribution curve with df = ${df}, shaded region showing p-value area for paired t-test`;

  const { xScale, yScale, frame } = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'paired-t-chart',
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
 * @param {import('../../js/inference.js').PairedResult} result
 * @param {number} d - Decimal precision from source data
 * @param {number} mu0 - Null hypothesis mean difference
 */
function writeInterpretation(result, d, mu0) {
  const { dbar, tStat, pValue, se, confLevel, ciLower, ciUpper, alternative, n } = result;

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

  const diffLabel = var1Name && var2Name
    ? `${var1Name} \u2212 ${var2Name}`
    : 'group 1 \u2212 group 2';

  interpretationDiv.innerHTML = `
    <p><strong>Hypotheses:</strong>
      H<sub>0</sub>: &mu;<sub>d</sub> = ${mu0} vs.
      H<sub>a</sub>: &mu;<sub>d</sub> ${haSymbol} ${mu0}</p>
    <p><strong>Differences:</strong> d = ${diffLabel}</p>
    <p>The mean difference d&#772; = ${formatStat(dbar, d)} is ${seCount} standard errors
      ${direction} the null value &mu;<sub>d</sub> = ${mu0}
      (based on n = ${n} pairs, SE = ${formatStat(se, d)}).</p>
    <p>If the true mean difference were ${mu0}, we would see a result this extreme
      about ${pPct} of the time (p = ${formatStat(pValue, d, 'pvalue')}).</p>
    <p>The ${levelPct}% confidence interval for &mu;<sub>d</sub> is
      (${formatStat(ciLower, d)}, ${formatStat(ciUpper, d)}).</p>
  `;
}
