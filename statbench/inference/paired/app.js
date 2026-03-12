// @ts-check
/**
 * Paired t-Test page controller.
 * Computes a paired t-test and CI on the differences (var1 - var2),
 * displays results and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { pairedT, pairedTSummary } from '../../js/inference.js';
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
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));

const inputMu0 = /** @type {HTMLInputElement} */ (document.getElementById('input-mu0'));
const inputAlt = /** @type {HTMLSelectElement} */ (document.getElementById('input-alt'));
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelectors = /** @type {HTMLElement} */ (document.getElementById('variable-selectors'));
const var1Select = /** @type {HTMLSelectElement} */ (document.getElementById('var1-select'));
const var2Select = /** @type {HTMLSelectElement} */ (document.getElementById('var2-select'));

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentDiffs = null;
let var1Name = '';
let var2Name = '';
/** @type {Array<Record<string, any>> | null} */
let currentRows = null;
/** @type {string[]} */
let numericCols = [];

// Summary-input state
let fromSummary = false;
let summaryDbar = 0;
let summarySd = 0;
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

// ── Helpers ────────────────────────────────────────────────────────

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
    opt1.value = col; opt1.textContent = col;
    var1Select.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = col; opt2.textContent = col;
    var2Select.appendChild(opt2);
  }
  var1Select.value = cols[0];
  var2Select.value = cols.length > 1 ? cols[1] : cols[0];
}

function loadFromSelections() {
  if (!currentRows || numericCols.length < 2) return;
  const col1 = var1Select.value;
  const col2 = var2Select.value;
  if (col1 === col2) { announce('Please select two different variables.'); return; }

  var1Name = col1;
  var2Name = col2;
  const diffs = [];
  for (const row of currentRows) {
    const v1 = Number(row[col1]);
    const v2 = Number(row[col2]);
    if (isFinite(v1) && isFinite(v2)) diffs.push(v1 - v2);
  }

  if (diffs.length < 2) {
    announce(`Fewer than 2 valid pairs found for "${col1}" and "${col2}".`);
    return;
  }

  currentDiffs = diffs;
  fromSummary = false;
  showResults();
  announce(`Loaded ${diffs.length} paired differences (${col1} \u2212 ${col2}).`);
}

// ── Data Panel ─────────────────────────────────────────────────────

function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  const cols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (cols.length < 2) { announce('This dataset needs at least 2 numeric variables for a paired test.'); return; }
  currentRows = ds.rows;
  populateVarSelectors(cols);
  loadFromSelections();
}

function handleText(parsed, sourceName) {
  const cols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
  if (cols.length < 2) { announce('Need at least 2 numeric columns for paired data.'); return; }
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
    fromSummary = false;
    varSelectors.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = '<p class="placeholder">Load data to see results.</p>';
  },
});

// ── Variable selector change listeners ────────────────────────────
var1Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });
var2Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const dbarInput = /** @type {HTMLInputElement} */ (document.getElementById('input-dbar'));
    const sdInput = /** @type {HTMLInputElement} */ (document.getElementById('input-sd'));
    const nInput = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));

    const dbar = parseFloat(dbarInput?.value);
    const sd = parseFloat(sdInput?.value);
    const n = parseInt(nInput?.value, 10);

    if (!isFinite(dbar)) { announce('Enter a valid mean difference.'); return; }
    if (!isFinite(sd) || sd <= 0) { announce('Enter a valid positive standard deviation.'); return; }
    if (!isFinite(n) || n < 2) { announce('Sample size must be at least 2.'); return; }

    fromSummary = true;
    summaryDbar = dbar;
    summarySd = sd;
    summaryN = n;
    currentDiffs = null;
    currentRows = null;
    varSelectors.hidden = true;
    showResults();
    announce(`Loaded summary: d̄ = ${dbar}, s_d = ${sd}, n = ${n}.`);
  });
}

// ── Null value mirror ─────────────────────────────────────────────
const nullDisplay = document.getElementById('null-display');
function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputMu0.value || '0';
}
inputMu0.addEventListener('input', syncNullDisplay);
syncNullDisplay();

// ── Parameter change listeners ─────────────────────────────────────
inputMu0.addEventListener('input', () => { if (currentDiffs || fromSummary) showResults(); });
inputAlt.addEventListener('change', () => { if (currentDiffs || fromSummary) showResults(); });
inputConf.addEventListener('input', () => { if (currentDiffs || fromSummary) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  if (!currentDiffs && !fromSummary) return;
  if (currentDiffs && currentDiffs.length < 2) return;

  const mu0 = Number(inputMu0.value) || 0;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  const result = fromSummary
    ? pairedTSummary(summaryDbar, summarySd, summaryN, { mu0, alternative, confLevel })
    : pairedT(currentDiffs, { mu0, alternative, confLevel });

  const d = fromSummary
    ? Math.max(detectPrecision([summaryDbar]), detectPrecision([summarySd]))
    : detectPrecision(currentDiffs);

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  drawChart(result);
  renderResults(result, d, mu0, alternative, confLevel);

  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Render results panel with formula display.
 * @param {import('../../js/inference.js').PairedResult} r
 * @param {number} d
 * @param {number} mu0
 * @param {string} alternative
 * @param {number} confLevel
 */
function renderResults(r, d, mu0, alternative, confLevel) {
  const confPct = (confLevel * 100).toFixed(0);
  const pStr = formatStat(r.pValue, d, 'pvalue');
  const alpha = 1 - confLevel;
  const sig = r.pValue < alpha;
  const sigWord = sig ? 'sufficient' : 'insufficient';
  const rejectWord = sig ? 'reject' : 'fail to reject';
  const tStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const diffLabel = var1Name && var2Name
    ? `${var1Name} \u2212 ${var2Name}`
    : 'group 1 \u2212 group 2';

  resultsPanel.innerHTML = `
    <h3>Paired Differences</h3>
    <table class="results-table" aria-label="Paired differences summary">
      <tbody>
        <tr><th scope="row">n (pairs)</th><td>${r.n}</td></tr>
        <tr><th scope="row">d&#772;</th><td>${formatStat(r.dbar, d)}</td></tr>
        <tr><th scope="row">s<sub>d</sub></th><td>${formatStat(r.sd, d)}</td></tr>
        <tr><th scope="row">SE</th><td>${formatStat(r.se, d)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      <div class="formula-step">
        <span>t =</span>
        <span class="frac">
          <span class="frac-num">d&#772; &minus; &mu;<sub>0</sub></span>
          <span class="frac-den">s<sub>d</sub> &frasl; &radic;n</span>
        </span>
      </div>
      <div class="formula-step">
        <span>&nbsp; =</span>
        <span class="frac">
          <span class="frac-num"><span class="formula-val">${formatStat(r.dbar, d)}</span> &minus; <span class="formula-val">${mu0}</span></span>
          <span class="frac-den"><span class="formula-val">${formatStat(r.sd, d)}</span> &frasl; &radic;<span class="formula-val">${r.n}</span></span>
        </span>
      </div>
      <div class="formula-step">
        <span>&nbsp; = <span class="formula-result">${r.tStat.toFixed(4)}</span></span>
      </div>
      <div class="formula-step" style="margin-top:0.15rem;">
        <span>df = n &minus; 1 = ${r.n} &minus; 1 = <span class="formula-result">${r.df}</span></span>
      </div>
      <div class="formula-step">
        <span>p-value = <span class="formula-result">${pStr}</span></span>
      </div>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      <div class="formula-step">
        <span>d&#772; &plusmn; t* &middot;</span>
        <span class="frac">
          <span class="frac-num">s<sub>d</sub></span>
          <span class="frac-den">&radic;n</span>
        </span>
      </div>
      <div class="formula-step">
        <span><span class="formula-val">${formatStat(r.dbar, d)}</span> &plusmn; <span class="formula-val">${tStar}</span> &middot;</span>
        <span class="frac">
          <span class="frac-num"><span class="formula-val">${formatStat(r.sd, d)}</span></span>
          <span class="frac-den">&radic;<span class="formula-val">${r.n}</span></span>
        </span>
      </div>
      <div class="formula-step">
        <span>= <span class="formula-result">(${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)})</span></span>
      </div>
    </div>

    <div class="interpretation" aria-live="polite">
      <p><strong>Differences:</strong> d = ${diffLabel}</p>
      <p>The mean difference d&#772; = ${formatStat(r.dbar, d)} is ${Math.abs(r.tStat).toFixed(2)} SEs
        ${r.tStat >= 0 ? 'above' : 'below'} &mu;<sub>0</sub> = ${mu0}.</p>
      <p>p-value = ${pStr}: ${sigWord} evidence to ${rejectWord} H<sub>0</sub> at &alpha; = ${alpha}.</p>
      <p>${confPct}% CI for &mu;<sub>d</sub>: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}).</p>
    </div>
  `;
}

/**
 * Draw the t-distribution curve with shaded p-value region.
 * @param {import('../../js/inference.js').PairedResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { tStat, df, alternative } = result;
  const pdfFn = (/** @type {number} */ x) => pdfT(x, df);
  const domain = computeDomain('t', { df });

  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue, critLow, critHigh;

  if (alternative === 'less') { tail = 'left'; critValue = tStat; }
  else if (alternative === 'greater') { tail = 'right'; critValue = tStat; }
  else { tail = 'both'; critLow = -Math.abs(tStat); critHigh = Math.abs(tStat); }

  const { xScale, yScale, frame } = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't', yLabel: 'Density',
    titleText: `t distribution (df = ${df})`,
    descText: `t-distribution curve, shaded p-value area for paired t-test`,
    id: 'paired-t-chart',
    tail, critValue, critLow, critHigh,
  });

  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const tX = xScale(tStat);
  const yTop = yScale(pdfFn(tStat));

  if (tStat >= domain[0] && tStat <= domain[1]) {
    overlays.append('line')
      .attr('class', 't-stat-line')
      .attr('x1', tX).attr('x2', tX)
      .attr('y1', yScale(0)).attr('y2', yTop)
      .attr('stroke', '#F05133').attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3');

    overlays.append('text')
      .attr('class', 't-stat-label')
      .attr('x', tX).attr('y', Math.max(yTop - 12, 4))
      .attr('text-anchor', 'middle')
      .attr('fill', '#F05133').attr('font-size', '11px').attr('font-weight', '700')
      .text(`t = ${tStat.toFixed(3)}`);
  }
}
