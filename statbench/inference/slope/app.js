// @ts-check
/**
 * Regression Slope t-Test page controller.
 * Computes a t-test and CI for the regression slope, displays results
 * and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { slopeT, slopeTSummary } from '../../js/inference.js';
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

const inputAlt = /** @type {HTMLSelectElement} */ (document.getElementById('input-alt'));
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));

// ── State ──────────────────────────────────────────────────────────
/** @type {Array<Record<string,any>>} */
let currentRows = [];
/** @type {string[]} */
let numericColumns = [];

// Summary-input state
let fromSummary = false;
let summarySlope = 0;
let summarySE = 0;
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

// ── Variable selectors ─────────────────────────────────────────────

function populateVarSelectors() {
  xVarSelect.innerHTML = '';
  yVarSelect.innerHTML = '';
  for (const col of numericColumns) {
    const optX = document.createElement('option');
    optX.value = col; optX.textContent = col;
    xVarSelect.appendChild(optX);
    const optY = document.createElement('option');
    optY.value = col; optY.textContent = col;
    yVarSelect.appendChild(optY);
  }
  if (numericColumns.length >= 2) {
    xVarSelect.value = numericColumns[0];
    yVarSelect.value = numericColumns[1];
  }
  varSelector.hidden = false;
}

/**
 * Extract paired numeric arrays from current rows.
 * @returns {{ x: number[], y: number[] } | null}
 */
function extractXY() {
  const xCol = xVarSelect.value;
  const yCol = yVarSelect.value;
  if (!xCol || !yCol || xCol === yCol) return null;

  const x = [], y = [];
  for (const row of currentRows) {
    const xv = Number(row[xCol]);
    const yv = Number(row[yCol]);
    if (isFinite(xv) && isFinite(yv)) { x.push(xv); y.push(yv); }
  }
  if (x.length < 3) return null;
  return { x, y };
}

// ── Data Panel ─────────────────────────────────────────────────────

function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  const numCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (numCols.length < 2) { announce('Need at least two numeric variables for regression.'); return; }
  currentRows = ds.rows;
  numericColumns = numCols;
  populateVarSelectors();
  showResults();
  announce(`Loaded ${ds.rows.length} observations.`);
}

function handleText(parsed, sourceName) {
  const numCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
  if (numCols.length < 2) { announce('Need at least two numeric columns for regression.'); return; }
  currentRows = parsed.data.map(row => {
    const out = {};
    for (const h of parsed.headers) {
      out[h] = numCols.includes(h)
        ? (row[h] === '' || row[h] === 'NA' ? NaN : Number(row[h]))
        : row[h];
    }
    return out;
  });
  numericColumns = numCols;
  populateVarSelectors();
  showResults();
  announce(`Loaded ${currentRows.length} observations from "${sourceName}".`);
}

initDataPanel({
  datasetFilter: ds => ds.type === 'regression',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentRows = [];
    numericColumns = [];
    fromSummary = false;
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = '<p class="placeholder">Load data to see results.</p>';
  },
});

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const slopeInput = /** @type {HTMLInputElement} */ (document.getElementById('input-slope'));
    const seInput = /** @type {HTMLInputElement} */ (document.getElementById('input-se'));
    const nInput = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));

    const slope = parseFloat(slopeInput?.value);
    const se = parseFloat(seInput?.value);
    const n = parseInt(nInput?.value, 10);

    if (!isFinite(slope)) { announce('Enter a valid slope.'); return; }
    if (!isFinite(se) || se <= 0) { announce('Enter a valid positive SE.'); return; }
    if (!isFinite(n) || n < 3) { announce('Sample size must be at least 3.'); return; }

    fromSummary = true;
    summarySlope = slope;
    summarySE = se;
    summaryN = n;
    currentRows = [];
    varSelector.hidden = true;
    showResults();
    announce(`Loaded summary: slope = ${slope}, SE = ${se}, n = ${n}.`);
  });
}

// ── Parameter + variable change listeners ──────────────────────────
inputAlt.addEventListener('change', () => { if (currentRows.length || fromSummary) showResults(); });
inputConf.addEventListener('input', () => { if (currentRows.length || fromSummary) showResults(); });
xVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });
yVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  /** @type {import('../../js/inference.js').SlopeResult} */
  let result;
  let d;

  if (fromSummary) {
    result = slopeTSummary(summarySlope, summarySE, summaryN, { alternative, confLevel });
    d = Math.max(detectPrecision([summarySlope]), detectPrecision([summarySE]));
  } else {
    const pair = extractXY();
    if (!pair) {
      if (xVarSelect.value === yVarSelect.value && xVarSelect.value) {
        announce('X and Y variables must be different.');
      } else {
        announce('Need at least 3 valid data points for regression.');
      }
      controlsSection.hidden = true;
      chartAndResults.hidden = true;
      return;
    }
    result = slopeT(pair.x, pair.y, { alternative, confLevel });
    d = Math.max(detectPrecision(pair.x), detectPrecision(pair.y));
  }

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  drawChart(result);
  renderResults(result, d, alternative, confLevel);

  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Render results panel with formula display.
 * @param {import('../../js/inference.js').SlopeResult} r
 * @param {number} d
 * @param {string} alternative
 * @param {number} confLevel
 */
function renderResults(r, d, alternative, confLevel) {
  const confPct = (confLevel * 100).toFixed(0);
  const pStr = formatStat(r.pValue, d, 'pvalue');
  const alpha = 1 - confLevel;
  const sig = r.pValue < alpha;
  const sigWord = sig ? 'sufficient' : 'insufficient';
  const rejectWord = sig ? 'reject' : 'fail to reject';
  const tStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const hasFullRegression = isFinite(r.intercept) && isFinite(r.r);
  const xName = xVarSelect.value || 'x';
  const yName = yVarSelect.value || 'y';

  let regressionRows = '';
  if (hasFullRegression) {
    regressionRows = `
        <tr><th scope="row">Intercept (b&#8320;)</th><td>${formatStat(r.intercept, d)}</td></tr>
        <tr><th scope="row">r</th><td>${formatStat(r.r, d, 'correlation')}</td></tr>
        <tr><th scope="row">R&sup2;</th><td>${formatStat(r.rSquared, d, 'correlation')}</td></tr>`;
  }

  let regressionInterp = '';
  if (hasFullRegression) {
    const r2Pct = (r.rSquared * 100).toFixed(1);
    regressionInterp = `
      <p>&#375; = ${formatStat(r.intercept, d)} + ${formatStat(r.slope, d)} &middot; ${xName}</p>
      <p>r = ${formatStat(r.r, d, 'correlation')}, R&sup2; = ${r2Pct}%.</p>`;
  }

  resultsPanel.innerHTML = `
    <h3>Regression Summary</h3>
    <table class="results-table" aria-label="Regression summary">
      <tbody>
        <tr><th scope="row">n</th><td>${r.n}</td></tr>
        <tr><th scope="row">Slope (b&#8321;)</th><td>${formatStat(r.slope, d)}</td></tr>
        ${regressionRows}
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      <div class="formula-step">
        <span>t =</span>
        <span class="frac">
          <span class="frac-num">b<sub>1</sub> &minus; 0</span>
          <span class="frac-den">SE<sub>b<sub>1</sub></sub></span>
        </span>
      </div>
      <div class="formula-step">
        <span>&nbsp; =</span>
        <span class="frac">
          <span class="frac-num"><span class="formula-val">${formatStat(r.slope, d)}</span></span>
          <span class="frac-den"><span class="formula-val">${formatStat(r.se, d)}</span></span>
        </span>
      </div>
      <div class="formula-step">
        <span>&nbsp; = <span class="formula-result">${r.tStat.toFixed(4)}</span></span>
      </div>
      <div class="formula-step" style="margin-top:0.15rem;">
        <span>df = n &minus; 2 = ${r.n} &minus; 2 = <span class="formula-result">${r.df}</span></span>
      </div>
      <div class="formula-step">
        <span>p-value = <span class="formula-result">${pStr}</span></span>
      </div>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% CI for &beta;<sub>1</sub></h3>
      <div class="formula-step">
        <span>b<sub>1</sub> &plusmn; t* &middot; SE<sub>b<sub>1</sub></sub></span>
      </div>
      <div class="formula-step">
        <span><span class="formula-val">${formatStat(r.slope, d)}</span> &plusmn; <span class="formula-val">${tStar}</span> &middot; <span class="formula-val">${formatStat(r.se, d)}</span></span>
      </div>
      <div class="formula-step">
        <span>= <span class="formula-result">(${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)})</span></span>
      </div>
    </div>

    <div class="interpretation" aria-live="polite">
      ${regressionInterp}
      <p>Slope b<sub>1</sub> = ${formatStat(r.slope, d)} is ${Math.abs(r.tStat).toFixed(2)} SEs from zero.</p>
      <p>p-value = ${pStr}: ${sigWord} evidence to ${rejectWord} H<sub>0</sub> at &alpha; = ${alpha}.</p>
      <p>${confPct}% CI for &beta;<sub>1</sub>: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}).</p>
    </div>
  `;
}

/**
 * Draw the t-distribution curve with shaded p-value region.
 * @param {import('../../js/inference.js').SlopeResult} result
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
    descText: `t-distribution curve, shaded p-value area for slope test`,
    id: 'slope-t-chart',
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
