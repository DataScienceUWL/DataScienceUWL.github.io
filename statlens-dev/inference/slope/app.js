// @ts-check
/**
 * Regression Slope t-Test page controller.
 * Computes a t-test and CI for the regression slope, displays results
 * and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { slopeT, slopeTSummary } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { renderConditionsDiagnostic } from '../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../js/page-utils.js';

initHelp();
import { parseCSV } from '../../js/csv-parser.js';
import { formatStat, detectPrecision, linreg } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── Initialize jStat before anything else ──────────────────────────
const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));

const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));

const inputAlt = initHypToggle('input-alt', () => { if (currentRows.length || fromSummary) showResults(); });
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {Array<Record<string,any>>} */
let currentRows = [];
/** @type {string[]} */
let numericColumns = [];

/** @type {import('../../js/inference.js').SlopeResult|null} */
let lastSlopeResult = null;

// Summary-input state
let fromSummary = false;
let summarySlope = 0;
let summarySE = 0;
let summaryN = 0;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

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
initTabs({ hintTarget: resultsPanel, hintAction: 'click Compute' });

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

/** Update the data summary strip with dataset info. */
function updateDataSummary() {
  if (!dataSummary) return;
  const xy = extractXY();
  if (!xy) return;
  const name = dataPanel.currentSourceName;
  const prefix = name ? `${name}: ` : '';
  const reg = linreg(xy.x, xy.y);
  const d = Math.max(detectPrecision(xy.x), detectPrecision(xy.y));
  dataSummary.textContent = `${prefix}n = ${xy.x.length}, slope = ${formatStat(reg.slope, d)}, r\u00B2 = ${formatStat(reg.r2, d, 'correlation')}`;
}

// ── Data Panel ─────────────────────────────────────────────────────

function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  const ctx = findContext(ds, 'slope');
  currentContext = ctx;
  if (ctx && ctx.alternative) inputAlt.setValue(ctx.alternative);

  const numCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (numCols.length < 2) { announce('Need at least two numeric variables for regression.'); return; }
  currentRows = ds.rows;
  numericColumns = numCols;
  populateVarSelectors();
  updateDataSummary();
  showResults();
  announce(`Loaded ${ds.rows.length} observations.`);
}

function handleText(parsed, sourceName) {
  currentContext = null;
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
  updateDataSummary();
  showResults();
  announce(`Loaded ${currentRows.length} observations from "${sourceName}".`);
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.type === 'regression',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentRows = [];
    numericColumns = [];
    fromSummary = false;
    currentContext = null;
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'click Compute')}</p>`;
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
    currentContext = null;
    varSelector.hidden = true;
    showResults();
    announce(`Loaded summary: slope = ${slope}, SE = ${se}, n = ${n}.`);
  });
}

// ── Parameter + variable change listeners ──────────────────────────
// Note: alternative change handler is wired via initHypToggle callback above
inputConf.addEventListener('input', () => { if (currentRows.length || fromSummary) showResults(); });
xVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });
yVarSelect.addEventListener('change', () => { if (currentRows.length) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
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

  // Update page title
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentRows.length });

  // Conditions checkpoint — store current result for residual plot
  lastSlopeResult = fromSummary ? null : result;
  showConditionsCheckpoint();

  drawChart(result);
  renderResults(result, d, alternative, confLevel);

  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

// ── Conditions checkpoint ────────────────────────────────────────────

function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-slope/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-slope/');

  const hasRawData = !fromSummary && lastSlopeResult != null;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Alternative: <a href="${bootLink}">Bootstrap Slope CI</a> (no conditions required).</p>
    ${hasRawData ? '<div id="conditions-panel" class="conditions-panel" hidden><div id="conditions-chart"></div>' +
      (dsId ? `<p class="hint" style="margin-top:0.5rem">For further investigation, <a href="${buildSimLink('explore/regression/', { dataset: dsId })}" target="_blank" rel="noopener">explore this dataset</a> in a new tab.</p>` : '') +
      '</div>' : ''}`;
  conditionsCheckpoint.hidden = false;

  const toggle = conditionsCheckpoint.querySelector('.conditions-toggle');
  const panel = conditionsCheckpoint.querySelector('#conditions-panel');
  const chartEl = conditionsCheckpoint.querySelector('#conditions-chart');
  if (toggle && panel && chartEl) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        renderResidualPlot(/** @type {HTMLElement} */ (chartEl));
      }
    });
  }
}

/**
 * Render a residual plot (fitted values vs residuals) for condition checking.
 * @param {HTMLElement} container
 */
function renderResidualPlot(container) {
  if (!lastSlopeResult) return;
  const pair = extractXY();
  if (!pair) return;

  const { slope, intercept } = lastSlopeResult;
  const fitted = pair.x.map(xi => intercept + slope * xi);
  const residuals = pair.y.map((yi, i) => yi - fitted[i]);

  // Residual scatterplot (for L, I, E conditions)
  const scatterDiv = document.createElement('div');
  scatterDiv.style.maxWidth = '600px';
  drawScatterplot(scatterDiv, fitted, residuals, {
    xLabel: 'Fitted values',
    yLabel: 'Residuals',
    titleText: 'Residual plot',
    descText: 'Residuals vs fitted values for checking regression conditions.',
    id: 'conditions-residuals',
  });
  container.appendChild(scatterDiv);

  // Residual histogram + boxplot + QQ (for N condition)
  const normDiv = document.createElement('div');
  normDiv.style.marginTop = '0.75rem';
  renderConditionsDiagnostic(normDiv, residuals, {
    varName: 'Residuals',
    context: 'residuals',
  });
  container.appendChild(normDiv);
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
  const tStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const conclusions = generateConclusions({
    pValue: r.pValue, alpha, alternative,
    testType: 'slope',
    statName: 't',
    statValue: r.tStat.toFixed(3),
    context: {
      parameter: currentContext?.parameter,
      nullValue: 0,
      claim: currentContext?.claim,
    },
  });

  const hasFullRegression = isFinite(r.intercept) && isFinite(r.r);
  const xName = xVarSelect.value || 'x';
  const yName = yVarSelect.value || 'y';

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  let regressionRows = '';
  if (hasFullRegression) {
    regressionRows = `
        <tr><th scope="row">Intercept (${tex('b_0')})</th><td>${formatStat(r.intercept, d)}</td></tr>
        <tr><th scope="row">${tex('r')}</th><td>${formatStat(r.r, d, 'correlation')}</td></tr>
        <tr><th scope="row">${tex('R^2')}</th><td>${formatStat(r.rSquared, d, 'correlation')}</td></tr>`;
  }

  let regressionInterp = '';
  if (hasFullRegression) {
    const r2Pct = (r.rSquared * 100).toFixed(1);
    regressionInterp = `
      <p>${tex(`\\hat{y} = ${formatStat(r.intercept, d)} + ${formatStat(r.slope, d)} \\cdot \\text{${xName}}`)}</p>
      <p>${tex(`r = ${formatStat(r.r, d, 'correlation')}`)}, ${tex(`R^2 = ${r2Pct}\\%`)}.</p>`;
  }

  const testFormula = tex(`\\begin{aligned}
    t &= \\frac{b_1 - 0}{SE_{b_1}} \\\\[8pt]
    &= \\frac{${V}{${formatStat(r.slope, d)}}}{${V}{${formatStat(r.se, d)}}} \\\\[8pt]
    &= ${S}{${r.tStat.toFixed(4)}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &b_1 \\pm t^{\\!*} \\cdot SE_{b_1} \\\\[8pt]
    &${V}{${formatStat(r.slope, d)}} \\pm ${V}{${tStar}} \\cdot ${V}{${formatStat(r.se, d)}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, d)},\\; ${formatStat(r.ciUpper, d)})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Regression Summary</h3>
    <table class="results-table" aria-label="Regression summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td>${r.n}</td></tr>
        <tr><th scope="row">Slope (${tex('b_1')})</th><td>${formatStat(r.slope, d)}</td></tr>
        ${regressionRows}
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      ${testFormula}
      <p class="formula-detail">${tex(`\\text{df} = n - 2 = ${r.n} - 2 = ${P}{${r.df}}`)}</p>
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${pStr}}`)}</p>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% CI for ${tex('\\beta_1')}</h3>
      ${ciFormula}
    </div>

    <div class="interpretation" aria-live="polite">
      ${regressionInterp}
      <p>Slope ${tex('b_1')} = ${formatStat(r.slope, d)} is ${Math.abs(r.tStat).toFixed(2)} SEs from zero.</p>
      <p><strong>Formal conclusion:</strong> ${conclusions.formal}</p>
      ${conclusions.practical ? `<p><strong>Practical conclusion:</strong> ${conclusions.practical}</p>` : ''}
      <p>${confPct}% CI for ${tex('\\beta_1')}: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}).</p>
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

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't', yLabel: 'Density',
    titleText: `t distribution (df = ${df})`,
    descText: `t-distribution curve, shaded p-value area for slope test`,
    id: 'slope-t-chart',
    tail, critValue, critLow, critHigh,
  });

  addInferenceAnnotations(chart, {
    statValue: Math.abs(tStat),
    statLabel: 't',
    pValue: result.pValue,
    pdfFn,
    tail,
    statValueNeg: tail === 'both' ? -Math.abs(tStat) : undefined,
  });

}
