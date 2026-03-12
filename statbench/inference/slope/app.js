// @ts-check
/**
 * Regression Slope t-Test page controller.
 * Computes a t-test and CI for the regression slope, displays results
 * and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { slopeT } from '../../js/inference.js';
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

const inputAlt = /** @type {HTMLSelectElement} */ (document.getElementById('input-alt'));
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));

// Result cells
const resN = /** @type {HTMLElement} */ (document.getElementById('res-n'));
const resSlope = /** @type {HTMLElement} */ (document.getElementById('res-slope'));
const resIntercept = /** @type {HTMLElement} */ (document.getElementById('res-intercept'));
const resR = /** @type {HTMLElement} */ (document.getElementById('res-r'));
const resR2 = /** @type {HTMLElement} */ (document.getElementById('res-r2'));
const resSE = /** @type {HTMLElement} */ (document.getElementById('res-se'));
const resT = /** @type {HTMLElement} */ (document.getElementById('res-t'));
const resDf = /** @type {HTMLElement} */ (document.getElementById('res-df'));
const resP = /** @type {HTMLElement} */ (document.getElementById('res-p'));
const resLevel = /** @type {HTMLElement} */ (document.getElementById('res-level'));
const resCILower = /** @type {HTMLElement} */ (document.getElementById('res-ci-lower'));
const resCIUpper = /** @type {HTMLElement} */ (document.getElementById('res-ci-upper'));

// ── State ──────────────────────────────────────────────────────────
/** @type {Array<Record<string,any>>} */
let currentRows = [];

/** @type {string[]} */
let numericColumns = [];

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

/**
 * Populate X and Y dropdowns from the available numeric columns.
 */
function populateVarSelectors() {
  xVarSelect.innerHTML = '';
  yVarSelect.innerHTML = '';

  for (const col of numericColumns) {
    const optX = document.createElement('option');
    optX.value = col;
    optX.textContent = col;
    xVarSelect.appendChild(optX);

    const optY = document.createElement('option');
    optY.value = col;
    optY.textContent = col;
    yVarSelect.appendChild(optY);
  }

  // Default: first column = X, second = Y
  if (numericColumns.length >= 2) {
    xVarSelect.value = numericColumns[0];
    yVarSelect.value = numericColumns[1];
  }

  varSelector.hidden = false;
}

/**
 * Extract paired numeric arrays from current rows using selected variables.
 * Filters out rows with missing/non-finite values in either column.
 * @returns {{ x: number[], y: number[] } | null}
 */
function extractXY() {
  const xCol = xVarSelect.value;
  const yCol = yVarSelect.value;

  if (!xCol || !yCol || xCol === yCol) return null;

  /** @type {number[]} */
  const x = [];
  /** @type {number[]} */
  const y = [];

  for (const row of currentRows) {
    const xv = Number(row[xCol]);
    const yv = Number(row[yCol]);
    if (isFinite(xv) && isFinite(yv)) {
      x.push(xv);
      y.push(yv);
    }
  }

  if (x.length < 3) return null;  // need at least 3 for df = n-2 >= 1
  return { x, y };
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

  const numCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);

  if (numCols.length < 2) {
    announce('Need at least two numeric variables for regression.');
    return;
  }

  currentRows = ds.rows;
  numericColumns = numCols;
  populateVarSelectors();
  showResults();
  announce(`Loaded ${ds.rows.length} observations with ${numCols.length} numeric variables.`);
}

/**
 * Process parsed CSV text data.
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  const numCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (numCols.length < 2) {
    announce('Need at least two numeric columns for regression.');
    return;
  }

  currentRows = parsed.data.map(row => {
    /** @type {Record<string,any>} */
    const out = {};
    for (const h of parsed.headers) {
      const val = row[h];
      if (numCols.includes(h)) {
        out[h] = val === '' || val === 'NA' ? NaN : Number(val);
      } else {
        out[h] = val;
      }
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
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartSection.hidden = true;
    resultsSection.hidden = true;
    interpretationDiv.hidden = true;
    chartContainer.innerHTML = '';
  },
});

// ── Parameter + variable change listeners ──────────────────────────
inputAlt.addEventListener('change', () => { if (currentRows.length) showResults(); });
inputConf.addEventListener('input', () => { if (currentRows.length) showResults(); });
xVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });
yVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  const pair = extractXY();

  if (!pair) {
    if (xVarSelect.value === yVarSelect.value && xVarSelect.value) {
      announce('X and Y variables must be different.');
    } else {
      announce('Need at least 3 valid data points for regression.');
    }
    controlsSection.hidden = true;
    chartSection.hidden = true;
    resultsSection.hidden = true;
    interpretationDiv.hidden = true;
    return;
  }

  const { x, y } = pair;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.value);
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  // Compute
  const result = slopeT(x, y, { alternative, confLevel });

  // Detect precision from both variables
  const d = Math.max(detectPrecision(x), detectPrecision(y));

  // Show sections
  controlsSection.hidden = false;
  chartSection.hidden = false;
  resultsSection.hidden = false;
  interpretationDiv.hidden = false;

  // Populate results
  resN.textContent = String(result.n);
  resSlope.textContent = formatStat(result.slope, d);
  resIntercept.textContent = formatStat(result.intercept, d);
  resR.textContent = formatStat(result.r, d, 'correlation');
  resR2.textContent = formatStat(result.rSquared, d, 'correlation');
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
    `${(confLevel * 100).toFixed(0)}% CI for slope: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Draw the t-distribution curve with shaded p-value region and t-statistic marker.
 * @param {import('../../js/inference.js').SlopeResult} result
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
  const descText = `t-distribution curve with df = ${df}, shaded region showing p-value area for slope test`;

  const { xScale, yScale, frame } = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'slope-t-chart',
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
 * @param {import('../../js/inference.js').SlopeResult} result
 * @param {number} d - Decimal precision from source data
 */
function writeInterpretation(result, d) {
  const { slope, intercept, se, tStat, pValue, confLevel, ciLower, ciUpper, alternative, n, r, rSquared } = result;

  const direction = slope >= 0 ? 'positive' : 'negative';
  const seCount = Math.abs(tStat).toFixed(2);

  const pPct = pValue < 0.0001
    ? 'less than 0.01%'
    : (pValue * 100).toFixed(2) + '%';

  const levelPct = (confLevel * 100).toFixed(0);

  const xName = xVarSelect.value;
  const yName = yVarSelect.value;

  // Hypothesis symbols
  let haSymbol;
  if (alternative === 'less') haSymbol = '<';
  else if (alternative === 'greater') haSymbol = '>';
  else haSymbol = '\u2260';

  const r2Pct = (rSquared * 100).toFixed(1);

  interpretationDiv.innerHTML = `
    <p><strong>Hypotheses:</strong>
      H<sub>0</sub>: &beta;<sub>1</sub> = 0 (no linear relationship) vs.
      H<sub>a</sub>: &beta;<sub>1</sub> ${haSymbol} 0</p>
    <p><strong>Regression equation:</strong>
      &#375; = ${formatStat(intercept, d)} + ${formatStat(slope, d)} &middot; ${xName}</p>
    <p>The sample slope b<sub>1</sub> = ${formatStat(slope, d)} is ${seCount} standard errors
      from zero (SE = ${formatStat(se, d)}), indicating a ${direction} relationship
      between ${xName} and ${yName}.</p>
    <p>If there were no linear relationship (&beta;<sub>1</sub> = 0),
      we would see a slope this extreme about ${pPct} of the time
      (p = ${formatStat(pValue, d, 'pvalue')}).</p>
    <p>The ${levelPct}% confidence interval for the true slope &beta;<sub>1</sub> is
      (${formatStat(ciLower, d)}, ${formatStat(ciUpper, d)}).</p>
    <p>The correlation is r = ${formatStat(r, d, 'correlation')} and
      R&sup2; = ${r2Pct}%, meaning ${r2Pct}% of the variability in ${yName}
      is explained by the linear relationship with ${xName}.</p>
  `;
}
